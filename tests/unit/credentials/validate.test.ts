/** R8.29 — ingestion and read-time validation of API keys. */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CredentialBackend, fileBackend } from "../../../src/credentials/backends.js";
import { createCredentialStore } from "../../../src/credentials/store.js";
import {
  assertUsableSecret,
  MalformedSecretError,
  normalizePipedSecret,
} from "../../../src/credentials/validate.js";
import { rmTemp } from "../../helpers/tmp.js";

// Built at runtime: no secret-shaped literal in the repo.
const K = ["k", String(Date.now())].join("-");
const BOM = String.fromCharCode(0xfeff);

describe("normalizePipedSecret", () => {
  it.each([
    ["LF", `${K}\n`, K],
    ["CRLF", `${K}\r\n`, K],
    ["no terminator", K, K],
    ["BOM + LF", `${BOM}${K}\n`, K],
    ["BOM + CRLF", `${BOM}${K}\r\n`, K],
    ["leading spaces kept", `  ${K}\n`, `  ${K}`],
    ["interior spaces kept", `${K} mid ${K}\n`, `${K} mid ${K}`],
    // Decision: trailing space is harmless in a header value, so it is KEPT.
    ["cmd-style 'KEY \\r\\n' keeps the trailing space", `${K} \r\n`, `${K} `],
    ["newline only is empty", "\n", ""],
    ["empty", "", ""],
  ])("%s", (_n, raw, want) => {
    expect(normalizePipedSecret(raw)).toBe(want);
  });

  it.each([
    ["trailing blank line", `${K}\n\n`],
    ["CRLF blank line", `${K}\r\n\r\n`],
    ["double CR", `${K}\r\r\n`],
    ["embedded LF", `${K}\n${K}\n`],
    ["embedded NUL", `${K}\u0000${K}`],
    ["embedded tab", `${K}\t${K}`],
    ["embedded ESC", `${K}\u001b[0m`],
    ["DEL", `${K}\u007f`],
    ["interior BOM", `${K}${BOM}${K}`],
    ["double BOM", `${BOM}${BOM}${K}`],
  ])("refuses %s without echoing the key", (_n, raw) => {
    let err: unknown;
    try {
      normalizePipedSecret(raw);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MalformedSecretError);
    expect((err as Error).message).not.toContain(K);
  });
});

describe("assertUsableSecret", () => {
  it("accepts spaces and printable text", () => {
    expect(() => assertUsableSecret(`  ${K} x `)).not.toThrow();
  });
  it("refuses CR", () => {
    expect(() => assertUsableSecret(`${K}\r`)).toThrow(MalformedSecretError);
  });
});

describe("store read validation (malformed stored key is never handed out)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "golem-val-"));
    await fileBackend(dir).set("seed", K); // creates credentials/
  });
  afterAll(async () => {
    await rm(dir, rmTemp);
  });

  const mk = () => createCredentialStore({ userDir: dir, keychain: null });

  it("returns a good padded key", async () => {
    await writeFile(join(dir, "credentials", "ok.key"), `  ${K} \n`);
    expect((await mk().resolve("ok"))?.secret).toBe(`  ${K} `);
  });

  it.each([
    ["extra trailing blank line", `${K}\n\n`],
    ["BOM", `${BOM}${K}\n`],
    ["embedded control char", `${K}\u0007${K}\n`],
  ])("treats a hand-edited file with %s as unusable, with a re-enter message", async (_n, body) => {
    await writeFile(join(dir, "credentials", "bad.key"), body);
    const store = mk();
    const r = await store.resolve("bad");
    expect(r).toBeNull();
    const st = await store.status("bad");
    expect(st.present).toBe(false);
    expect(st.faults[0]?.message).toMatch(/malformed.*re-enter/);
    expect(JSON.stringify(st)).not.toContain(K);
  });

  it("a malformed key from a batched keychain read is a fault, not a hit", async () => {
    const stub = {
      id: "keychain",
      available: async () => true,
      get: async () => null,
      set: async () => {},
      remove: async () => {},
      describe: () => ({ backend: "keychain", protection: "os-keychain", label: "stub" }),
      getMany: async () => new Map([["b", { secret: `${K}\r` }]]),
    } as unknown as CredentialBackend;
    const store = createCredentialStore({ userDir: dir, keychain: stub });
    expect((await store.resolveMany(["b"])).get("b")).toBeNull();
  });

  it("a newline-only file reads as absent (backend level)", async () => {
    await writeFile(join(dir, "credentials", "nl.key"), "\n\n");
    expect(await fileBackend(dir).get("nl")).toBeNull();
    await writeFile(join(dir, "credentials", "nl2.key"), "\r\n");
    expect(await fileBackend(dir).get("nl2")).toBeNull();
  });
});
