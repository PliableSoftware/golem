import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolResultCache } from "../../../src/compression/tool-result-cache.js";

describe("ToolResultCache", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "golem-trc-"));
    file = join(dir, "a.txt");
    writeFileSync(file, "one");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("hits while the file is unchanged", async () => {
    const c = new ToolResultCache();
    await c.set(file, "R");
    expect(await c.get(file)).toBe("R");
  });

  it("invalidates when mtime changes, even at the same size", async () => {
    const c = new ToolResultCache();
    await c.set(file, "R");
    const future = new Date(Date.now() + 60_000);
    utimesSync(file, future, future);
    expect(await c.get(file)).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it("invalidates when size changes under an unchanged mtime", async () => {
    const c = new ToolResultCache();
    await c.set(file, "R");
    const { statSync } = await import("node:fs");
    const m = statSync(file).mtime;
    writeFileSync(file, "longer content");
    utimesSync(file, m, m);
    expect(await c.get(file)).toBeUndefined();
  });

  it("invalidates when the file vanishes and refuses to cache a missing file", async () => {
    const c = new ToolResultCache();
    await c.set(file, "R");
    rmSync(file);
    expect(await c.get(file)).toBeUndefined();
    expect(await c.set(file, "R")).toBe(false);
  });
});
