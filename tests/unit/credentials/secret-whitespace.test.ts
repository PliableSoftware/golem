/**
 * R8.29 — a stored secret is returned byte-exact. The only thing a backend may
 * remove on read is the ONE trailing newline its own encoding added; leading
 * whitespace, trailing spaces and interior spaces belong to the secret.
 *
 * The OS helpers (`secret-tool`, `security`, `pwsh.exe`) are stood in for by
 * tiny PATH shims, so the real spawn/stdin/stdout path of the backend runs.
 */

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fileBackend, keychainBackend } from "../../../src/credentials/backends.js";
import { rmTemp } from "../../helpers/tmp.js";

// Built at runtime: no secret-shaped literal in the repo.
const BODY = ["k", String(Date.now())].join("-");
const SECRETS: Record<string, string> = {
  "leading + trailing spaces": `  ${BODY}  `,
  "interior spaces": `${BODY} mid ${BODY}`,
  "leading tab, trailing space": `\t${BODY} `,
  "all of it": `  ${BODY} mid ${BODY}\t `,
};

let dir: string;
const realPath = process.env.PATH;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "golem-ws-"));
});
afterEach(() => {
  process.env.PATH = realPath;
});
afterAll(async () => {
  await rm(dir, rmTemp);
});

async function shim(name: string, body: string): Promise<void> {
  const file = join(dir, "bin", name);
  await mkdir(join(dir, "bin"), { recursive: true });
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
}
function useShims(): void {
  process.env.PATH = `${join(dir, "bin")}${delimiter}${realPath ?? ""}`;
}

describe.each(Object.entries(SECRETS))("file backend — %s", (_n, secret) => {
  it("round-trips unchanged", async () => {
    const b = fileBackend(dir);
    await b.set("ws-file", secret);
    expect(await b.get("ws-file")).toBe(secret);
  });
  it("stores the secret plus exactly one newline", async () => {
    const b = fileBackend(dir);
    await b.set("ws-file-raw", secret);
    expect(await readFile(join(dir, "credentials", "ws-file-raw.key"), "utf8")).toBe(`${secret}\n`);
  });
});

describe("file backend — newlines", () => {
  it("strips only the one newline the encoding added", async () => {
    const b = fileBackend(dir);
    await b.set("ws-nl", `${BODY}\n`);
    expect(await b.get("ws-nl")).toBe(`${BODY}\n`);
  });
  it("tolerates a CRLF-terminated file (hand edit / Windows)", async () => {
    await writeFile(join(dir, "credentials", "ws-crlf.key"), ` ${BODY} \r\n`);
    expect(await fileBackend(dir).get("ws-crlf")).toBe(` ${BODY} `);
  });
  it("reads an empty file as absent", async () => {
    await writeFile(join(dir, "credentials", "ws-empty.key"), "\n");
    expect(await fileBackend(dir).get("ws-empty")).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("keychain helpers via shims", () => {
  describe.each(Object.entries(SECRETS))("libsecret — %s", (_n, secret) => {
    it("round-trips unchanged (secret-tool prints no trailing newline)", async () => {
      const store = join(dir, "libsecret.store");
      await shim(
        "secret-tool",
        `case "$1" in --help) exit 0;; store) cat > "${store}";; lookup) cat "${store}";; esac`,
      );
      useShims();
      const b = keychainBackend("linux", dir);
      await b?.set("ws-ls", secret);
      expect(await b?.get("ws-ls")).toBe(secret);
    });
  });

  describe("a helper that exits before reading stdin", () => {
    it("is a failed store, not an unhandled EPIPE that takes the process down", async () => {
      // Larger than a pipe buffer, so the write cannot complete before the exit.
      const big = "x".repeat(1_000_000);
      await shim("secret-tool", `case "$1" in --help) exit 0;; *) exit 1;; esac`);
      useShims();
      const b = keychainBackend("linux", dir);
      await expect(b?.set("ws-epipe", big)).rejects.toBeTruthy();
    });
  });

  describe.each(Object.entries(SECRETS))("macOS keychain — %s", (_n, secret) => {
    it("round-trips unchanged, dropping only the newline `security -w` appends", async () => {
      const store = join(dir, "mac.store");
      await shim(
        "security",
        `case "$1" in add-generic-password) cat > "${store}";; find-generic-password) cat "${store}"; echo;; esac`,
      );
      useShims();
      const b = keychainBackend("darwin", dir);
      await b?.set("ws-mac", secret);
      expect(await b?.get("ws-mac")).toBe(secret);
    });
  });

  describe.each(Object.entries(SECRETS))("DPAPI host output — %s", (_n, secret) => {
    it("decrypt drops only the newline PowerShell appends", async () => {
      // Stand-in host: "encrypt" = base64 of stdin; "decrypt" = decode + newline,
      // which is what an unredirected PowerShell expression statement emits.
      // Batch protocol (R9.20): one blob per stdin line in, `=<base64 secret>` per line out.
      // Real PowerShell terminates every output line with CRLF.
      await shim(
        "pwsh.exe",
        `case "$*" in
  *ConvertFrom-SecureString*) base64 -w0;;
  *ReadLine*) while read -r l; do printf '=%s\\r\\n' "$l"; done;;
  *) base64 -d; printf '\\r\\n';;
esac`,
      );
      useShims();
      const b = keychainBackend("win32", dir);
      await b?.set("ws-dpapi", secret);
      expect(await b?.get("ws-dpapi")).toBe(secret);
    });
    it("batch decrypt (getMany) returns the padded secret unchanged", async () => {
      await shim(
        "pwsh.exe",
        `case "$*" in
  *ConvertFrom-SecureString*) base64 -w0;;
  *ReadLine*) while read -r l; do printf '=%s\\r\\n' "$l"; done;;
  *) base64 -d; printf '\\r\\n';;
esac`,
      );
      useShims();
      const b = keychainBackend("win32", dir);
      await b?.set("ws-batch", secret);
      const got = await b?.getMany?.(["ws-batch", "ws-missing"]);
      expect(got?.get("ws-batch")).toEqual({ secret });
      expect(got?.get("ws-missing")).toEqual({});
    });
  });
});

describe("DPAPI encrypt script", () => {
  it("never trims the plaintext it reads from stdin", async () => {
    const src = await readFile(join(process.cwd(), "src/credentials/backends.ts"), "utf8");
    const m = /const DPAPI_ENCRYPT =([\s\S]*?);\n/.exec(src);
    expect(m).not.toBeNull();
    expect(m?.[1]).not.toMatch(/\.Trim\(/);
  });
});
