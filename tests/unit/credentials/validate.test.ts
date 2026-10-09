/** R8.29 — ingestion and read-time validation of API keys. */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buzzAccount, mintIdentity, projectKey } from "../../../src/buzz/identity.js";
import { type CredentialBackend, fileBackend } from "../../../src/credentials/backends.js";
import {
  createCredentialStore,
  credentialKind,
  MalformedCredentialError,
} from "../../../src/credentials/store.js";
import {
  assertUsableSecret,
  MalformedSecretError,
  normalizeGatewayKey,
  normalizePipedSecret,
} from "../../../src/credentials/validate.js";
import { PORTAL_ACCOUNT } from "../../../src/portal/tokens.js";
import { rmTemp } from "../../helpers/tmp.js";

// Built at runtime: no secret-shaped literal in the repo.
const K = ["k", String(Date.now())].join("-");
const BOM = String.fromCharCode(0xfeff);
const ZWSP = String.fromCharCode(0x200b);
const NBSP = String.fromCharCode(0xa0);
const CURLY = String.fromCharCode(0x2019);

describe("normalizeGatewayKey (ingestion)", () => {
  it.each([
    ["LF", `${K}\n`, K],
    ["CRLF", `${K}\r\n`, K],
    ["no terminator", K, K],
    ["BOM + LF", `${BOM}${K}\n`, K],
    ["BOM + CRLF", `${BOM}${K}\r\n`, K],
    ["trailing blank line", `${K}\n\n`, K],
    ["double CR", `${K}\r\r\n`, K],
    ["leading spaces trimmed", `  ${K}\n`, K],
    ["cmd-style 'KEY \\r\\n' (echo adds a space)", `${K} \r\n`, K],
    ["tabs at the edges", `\t${K}\t`, K],
    ["NBSP at the edges", `${NBSP}${K}${NBSP}`, K],
    ["interior spaces kept", ` ${K} mid ${K} \n`, `${K} mid ${K}`],
    ["newline only is empty", "\n", ""],
    ["whitespace only is empty", " \r\n\t ", ""],
    ["empty", "", ""],
  ])("%s", (_n, raw, want) => {
    expect(normalizeGatewayKey(raw)).toBe(want);
    expect(normalizePipedSecret(raw)).toBe(want);
  });

  it.each([
    ["embedded LF", `${K}\n${K}\n`],
    ["embedded CRLF", `${K}\r\n${K}`],
    ["embedded NUL", `${K}\u0000${K}`],
    ["embedded tab", `${K}\t${K}`],
    ["embedded ESC", `${K}\u001b[0m`],
    ["trailing BEL", `${K}\u0007`],
    ["DEL", `${K}\u007f`],
    ["interior BOM", `${K}${BOM}${K}`],
    ["zero-width space", `${K}${ZWSP}`],
    ["curly quote", `${CURLY}${K}`],
    ["CJK", `${K}中`],
  ])("refuses %s without echoing the key", (_n, raw) => {
    let err: unknown;
    try {
      normalizeGatewayKey(raw);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MalformedSecretError);
    expect((err as Error).message).not.toContain(K);
  });
});

describe("assertUsableSecret", () => {
  it("accepts spaces, Latin-1 and printable text", () => {
    expect(() => assertUsableSecret(` ${K} é`)).not.toThrow();
  });
  it("refuses CR and non-Latin-1", () => {
    expect(() => assertUsableSecret(`${K}\r`)).toThrow(MalformedSecretError);
    expect(() => assertUsableSecret(`${K}${ZWSP}`)).toThrow(MalformedSecretError);
  });
});

describe("credentialKind", () => {
  it("is pinned to the accounts' owners", () => {
    expect(credentialKind(PORTAL_ACCOUNT)).toBe("portal");
    expect(credentialKind(buzzAccount("proj", "coder"))).toBe("buzz");
    expect(credentialKind("work")).toBe("gateway");
    expect(credentialKind("default")).toBe("gateway");
  });
});

describe("store read validation (a malformed stored value is never handed out)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "golem-val-"));
    await fileBackend(dir).set("seed", K); // creates credentials/
  });
  afterAll(async () => {
    await rm(dir, rmTemp);
  });

  const mk = () => createCredentialStore({ userDir: dir, keychain: null });
  const put = (account: string, body: string) =>
    writeFile(join(dir, "credentials", `${account}.key`), body);

  it("returns a good key", async () => {
    await put("ok", `${K}\n`);
    expect((await mk().resolve("ok"))?.secret).toBe(K);
  });

  it.each([
    ["surrounding spaces", `  ${K} \n`],
    ["extra trailing blank line", `${K}\n\n`],
    ["BOM", `${BOM}${K}\n`],
    ["embedded control char", `${K}\u0007${K}\n`],
    ["zero-width space", `${K}${ZWSP}\n`],
    ["curly quote", `${K}${CURLY}\n`],
  ])("gateway key with %s: resolve throws, status faults, nothing leaks", async (_n, body) => {
    await put("bad", body);
    const store = mk();
    await expect(store.resolve("bad")).rejects.toBeInstanceOf(MalformedCredentialError);
    const st = await store.status("bad");
    expect(st.present).toBe(false);
    expect(st.faults[0]?.malformed).toBe(true);
    expect(st.faults[0]?.message).toMatch(/golem gateway login bad/);
    expect(JSON.stringify(st)).not.toContain(K);
    const err = await store.resolve("bad").catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(K);
  });

  it("a newline-only file reads as absent (backend level)", async () => {
    await put("nl", "\n\n");
    expect(await fileBackend(dir).get("nl")).toBeNull();
    await put("nl2", "\r\n");
    expect(await fileBackend(dir).get("nl2")).toBeNull();
  });

  describe("per-kind strictness and remedy", () => {
    it("portal token: surrounding whitespace is fine (JSON), a control char is not; remedy is team link", async () => {
      await put(PORTAL_ACCOUNT, `  {"a":1}  \n`);
      expect((await mk().resolve(PORTAL_ACCOUNT))?.secret).toBe(`  {"a":1}  `);
      await put(PORTAL_ACCOUNT, `{"a":"x\u0001"}\n`);
      await expect(mk().resolve(PORTAL_ACCOUNT)).rejects.toThrow(/golem team link/);
    });
    it("buzz secret: control char is malformed, remedy never says gateway login", async () => {
      const acct = buzzAccount("p", "c");
      await fileBackend(dir).set(acct, `${K}\u0002`);
      const err = await mk()
        .resolve(acct)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MalformedCredentialError);
      expect((err as Error).message).not.toMatch(/gateway login/);
      expect((err as Error).message).toMatch(/NOT overwrite/);
    });
  });

  describe("chain behaviour with an injected keychain", () => {
    const keychain = (
      get: Record<string, string>,
      many?: Record<string, string>,
    ): CredentialBackend =>
      ({
        id: "keychain",
        available: async () => true,
        get: async (a: string) => get[a] ?? null,
        set: async () => {},
        remove: async () => {},
        describe: () => ({ backend: "keychain", protection: "os-keychain", label: "stub" }),
        ...(many !== undefined
          ? {
              getMany: async (accts: readonly string[]) =>
                new Map(accts.map((a) => [a, many[a] !== undefined ? { secret: many[a] } : {}])),
            }
          : {}),
      }) as unknown as CredentialBackend;

    it("a malformed keychain hit does NOT fall through to a stale plaintext file (single)", async () => {
      await put("stale", `${K}-stale\n`);
      const store = createCredentialStore({
        userDir: dir,
        keychain: keychain({ stale: `${K}\r\n` }),
      });
      await expect(store.resolve("stale")).rejects.toBeInstanceOf(MalformedCredentialError);
    });

    it("batched: a malformed hit does not fall through; others resolve per account", async () => {
      await put("file-only", `${K}-file\n`);
      await put("stale2", `${K}-stale\n`);
      const store = createCredentialStore({
        userDir: dir,
        keychain: keychain({}, { good: K, stale2: `${K}${ZWSP}` }),
      });
      const got = await store.resolveManyDetailed(["good", "stale2", "file-only", "nowhere"]);
      expect(got.get("good")?.hit?.secret).toBe(K);
      // absent from the keychain -> falls through to the file, per account
      expect(got.get("file-only")?.hit?.secret).toBe(`${K}-file`);
      expect(got.get("file-only")?.hit?.location.backend).toBe("file");
      // malformed in the keychain -> no hit, no stale file value, a malformed fault
      expect(got.get("stale2")?.hit).toBeNull();
      expect(got.get("stale2")?.faults.some((f) => f.malformed === true)).toBe(true);
      // absent everywhere -> plain null, no fault
      expect(got.get("nowhere")).toEqual({ hit: null, faults: [] });
      // resolveMany stays non-throwing for the proxy-start path
      expect((await store.resolveMany(["stale2"])).get("stale2")).toBeNull();
    });
  });
});

describe("mintIdentity never overwrites a malformed secret", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "golem-mint-"));
  });
  afterAll(async () => {
    await rm(dir, rmTemp);
  });

  it("refuses with a clear error and keeps the stored value", async () => {
    const proj = join(dir, "proj");
    const account = buzzAccount(projectKey(proj), "coder");
    const bad = `${K}\u0003`;
    await fileBackend(dir).set(account, bad);
    let generated = 0;
    const store = createCredentialStore({ userDir: dir, keychain: null });
    await expect(
      mintIdentity("coder", {
        projectDir: proj,
        store,
        generateKeypair: async () => {
          generated++;
          return { pubkeyHex: "a".repeat(64), secretHex: "b".repeat(64) };
        },
      }),
    ).rejects.toBeInstanceOf(MalformedCredentialError);
    expect(generated).toBe(0);
    expect(await fileBackend(dir).get(account)).toBe(bad);
  });
});
