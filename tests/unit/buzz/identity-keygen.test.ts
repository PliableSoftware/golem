/**
 * DUSTSEC.6 — the keygen parser must never hand the secret key out as the
 * pubkey. The old shared global `HEX64_RE` carried `lastIndex` between `.exec`
 * calls, which broke the labelled branch and let the positional fallback swap
 * the two keys; the pubkey is committed to `.golem/buzz/agents.json`.
 */

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseGenerateKeyOutput } from "../../../src/buzz/identity.js";
import { buzzManifestPath, provisionBuzz } from "../../../src/buzz/provision.js";
import { useTempDirs } from "../../helpers/tmp.js";

const makeTempDir = useTempDirs("golem-buzz-keygen");

const S = randomBytes(32).toString("hex");
const P = randomBytes(32).toString("hex");

describe("parseGenerateKeyOutput", () => {
  it("labelled secret-then-public: pubkey is the public key", () => {
    expect(parseGenerateKeyOutput(`secret: ${S}\npublic: ${P}\n`)).toEqual({
      pubkeyHex: P,
      secretHex: S,
    });
  });
  it("labelled public-then-secret", () => {
    expect(parseGenerateKeyOutput(`public: ${P}\nsecret: ${S}\n`)).toEqual({
      pubkeyHex: P,
      secretHex: S,
    });
  });
  it("is stable across repeated calls (no shared lastIndex state)", () => {
    for (let i = 0; i < 3; i++) {
      expect(parseGenerateKeyOutput(`secret: ${S}\npublic: ${P}\n`).pubkeyHex).toBe(P);
    }
  });
  it("never guesses by position: unlabelled hex pair is refused", () => {
    expect(() => parseGenerateKeyOutput(`${P}\n${S}\n`)).toThrow(/ambiguous/);
  });
  it("bech32 label lines without hex do not trigger the positional guess", () => {
    const bech = (p: string) => `${p}1${"q".repeat(40)}`;
    const head = `npub: ${bech("npub")}\nnsec: ${bech("nsec")}\n`;
    // hex lines labelled: resolved by label, not order
    expect(parseGenerateKeyOutput(`${head}secret: ${S}\npublic: ${P}\n`)).toEqual({
      pubkeyHex: P,
      secretHex: S,
    });
    // hex lines unlabelled: no label line carries the hex -> refuse
    expect(() => parseGenerateKeyOutput(`${head}${S}\n${P}\n`)).toThrow(/ambiguous/);
  });
  it("refuses ambiguous output instead of guessing", () => {
    const C = randomBytes(32).toString("hex");
    // three keys, no labels
    expect(() => parseGenerateKeyOutput(`${P}\n${S}\n${C}\n`)).toThrow(/ambiguous/);
    // only one label resolves; the other key is unlabelled
    expect(() => parseGenerateKeyOutput(`secret: ${S}\n${P}\n`)).toThrow(/ambiguous/);
    // both labels on one line
    expect(() => parseGenerateKeyOutput(`pubkey=${P} secret=${S}\n`)).toThrow(/ambiguous/);
    // fewer than two keys
    expect(() => parseGenerateKeyOutput(`public: ${P}\n`)).toThrow(/two 64-hex/);
  });
  it("refuses a pair whose public key equals its secret", () => {
    expect(() => parseGenerateKeyOutput(`public: ${S}\nsecret: ${S}\n`)).toThrow(/same key twice/);
  });
});

describe("provisionBuzz never commits the secret", () => {
  function memStore() {
    const m = new Map<string, string>();
    return {
      m,
      resolve: async (a: string) =>
        m.has(a)
          ? { secret: m.get(a) as string, location: { backend: "keychain" as const } }
          : null,
      store: async (a: string, s: string) => {
        m.set(a, s);
        return { backend: "keychain" as const, label: "t", protection: "os-keychain" as const };
      },
      forget: async (a: string) => {
        m.delete(a);
        return [];
      },
    };
  }

  it("writes the public key, not the secret, for secret-first output", async () => {
    const projectDir = await makeTempDir();
    const userDir = await makeTempDir();
    const store = memStore();
    const result = await provisionBuzz({
      projectDir,
      userDir,
      store: store as never,
      generateKeypair: async () => parseGenerateKeyOutput(`secret: ${S}\npublic: ${P}\n`),
    });
    const onDisk = await readFile(buzzManifestPath(projectDir), "utf8");
    expect(onDisk).not.toContain(S);
    expect(onDisk).toContain(P);
    expect(result.content).not.toContain(S);
    expect([...store.m.values()]).toEqual(expect.arrayContaining([S]));
  });

  it("refuses to mint when a generator returns pubkey === secret, writing nothing", async () => {
    const projectDir = await makeTempDir();
    const userDir = await makeTempDir();
    await expect(
      provisionBuzz({
        projectDir,
        userDir,
        store: memStore() as never,
        generateKeypair: async () => ({ pubkeyHex: S, secretHex: S }),
      }),
    ).rejects.toThrow(/equals its secret/);
    await expect(readFile(buzzManifestPath(projectDir), "utf8")).rejects.toThrow();
  });

  it("refuses to write a manifest that contains a stored secret", async () => {
    const projectDir = await makeTempDir();
    const userDir = await makeTempDir();
    const store = memStore();
    // An already-stored secret whose pubkey was (wrongly) recorded as the secret.
    // Simulated via a stale manifest carrying the secret as the pubkey.
    await provisionBuzz({
      projectDir,
      userDir,
      store: store as never,
      generateKeypair: async () => ({ pubkeyHex: P, secretHex: S }),
    });
    const { writeFile } = await import("node:fs/promises");
    const text = (await readFile(buzzManifestPath(projectDir), "utf8")).replaceAll(P, S);
    await writeFile(buzzManifestPath(projectDir), text, "utf8");
    await expect(provisionBuzz({ projectDir, userDir, store: store as never })).rejects.toThrow(
      /contains its secret/,
    );
  });
});
