/** R8.29 — ingestion validation and read-side compatibility trim. */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CredentialBackend, fileBackend } from "../../../src/credentials/backends.js";
import { createCredentialStore } from "../../../src/credentials/store.js";
import {
  assertUsableSecret,
  MalformedSecretError,
  normalizeGatewayKey,
  normalizePipedSecret,
} from "../../../src/credentials/validate.js";
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

describe("store read-side compatibility trim (R8.29)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "golem-val-"));
    await fileBackend(dir).set("seed", K); // creates credentials/
  });
  afterAll(async () => {
    await rm(dir, rmTemp);
  });

  const mk = (keychain: CredentialBackend | null = null) =>
    createCredentialStore({ userDir: dir, keychain });
  const put = (account: string, body: string) =>
    writeFile(join(dir, "credentials", `${account}.key`), body);

  it("a gateway key stored untrimmed by an older build is trimmed on read", async () => {
    await put("old", `  ${K} mid \t\n`);
    expect((await mk().resolve("old"))?.secret).toBe(`${K} mid`);
    expect((await mk().resolveMany(["old"])).get("old")?.secret).toBe(`${K} mid`);
  });

  it("a whitespace-only gateway value reads as absent", async () => {
    await put("blank", "   \n");
    expect(await mk().resolve("blank")).toBeNull();
  });

  it("portal and buzz values stay byte-exact", async () => {
    await put("portal-oauth", `  {"a":1}  \n`);
    expect((await mk().resolve("portal-oauth"))?.secret).toBe(`  {"a":1}  `);
    await fileBackend(dir).set("buzz:p:c", ` ${K} `);
    expect((await mk().resolve("buzz:p:c"))?.secret).toBe(` ${K} `);
  });

  it("applies to a batched keychain read too", async () => {
    const stub = {
      id: "keychain",
      available: async () => true,
      get: async () => null,
      set: async () => {},
      remove: async () => {},
      describe: () => ({ backend: "keychain", protection: "os-keychain", label: "stub" }),
      getMany: async () => new Map([["b", { secret: `  ${K}  ` }]]),
    } as unknown as CredentialBackend;
    expect((await mk(stub).resolveMany(["b"])).get("b")?.secret).toBe(K);
  });
});
