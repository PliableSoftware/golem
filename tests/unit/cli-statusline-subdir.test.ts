/**
 * `workspace.current_dir` follows every `cd` in the session, so it is often a
 * subdirectory of the project. The status line must resolve the project root
 * from it, or `.golem/proxy.pid` is not found and the proxy is drawn as "off".
 */

import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFastPath } from "../../src/cli/fast-path.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "golem-sl-subdir-"));
  await mkdir(path.join(root, ".golem"), { recursive: true });
  await mkdir(path.join(root, "src", "deep"), { recursive: true });
  await writeFile(path.join(root, ".golem", "settings.json"), "{}\n");
  await writeFile(
    path.join(root, ".golem", "proxy.pid"),
    `${JSON.stringify({ pid: process.pid, port: 4930, ts: "" })}\n`,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function render(currentDir: string): Promise<string> {
  const stdin = Object.assign(new EventEmitter(), { isTTY: false });
  const original = Object.getOwnPropertyDescriptor(process, "stdin");
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  let out = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  });
  try {
    const done = runFastPath("statusline", ["node", "golem", "statusline"]);
    // let the handler attach its listeners before the payload lands
    await new Promise((r) => setImmediate(r));
    stdin.emit("data", Buffer.from(JSON.stringify({ workspace: { current_dir: currentDir } })));
    await done;
  } finally {
    if (original !== undefined) Object.defineProperty(process, "stdin", original);
  }
  return out;
}

describe("statusline project root", () => {
  it("does not draw 'off' when current_dir is a subdirectory", async () => {
    expect(await render(path.join(root, "src", "deep"))).not.toContain("off");
  });

  it("matches the root rendering from a subdirectory", async () => {
    expect(await render(path.join(root, "src"))).toBe(await render(root));
  });
});

describe("statusline with an unusable pid file", () => {
  it("still sees a listening proxy on the configured port (as `golem status` does)", async () => {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    try {
      await writeFile(
        path.join(root, ".golem", "settings.json"),
        `${JSON.stringify({ proxy: { port } })}\n`,
      );
      await rm(path.join(root, ".golem", "proxy.pid"));
      expect(await render(root)).not.toContain("off");
      // mid-rewrite: file exists but is empty
      await writeFile(path.join(root, ".golem", "proxy.pid"), "");
      expect(await render(root)).not.toContain("off");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("still says off when nothing listens", async () => {
    await rm(path.join(root, ".golem", "proxy.pid"));
    await writeFile(
      path.join(root, ".golem", "settings.json"),
      `${JSON.stringify({ proxy: { port: 1 } })}\n`,
    );
    expect(await render(root)).toContain("off");
  });
});
