import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileResultCache, stampFile } from "../../../src/compression/file-result-cache.js";

describe("FileResultCache", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "golem-frc-"));
    file = join(dir, "a.txt");
    writeFileSync(file, "one");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const put = async (c: FileResultCache, v = "R"): Promise<void> => {
    const stamp = await stampFile(file);
    if (stamp === null) throw new Error("no stamp");
    expect(await c.set(file, v, stamp)).toBe(true);
  };

  it("hits while the file is unchanged", async () => {
    const c = new FileResultCache();
    await put(c);
    expect(await c.get(file)).toBe("R");
  });

  it("invalidates when mtime changes, even at the same size", async () => {
    const c = new FileResultCache();
    await put(c);
    const future = new Date(Date.now() + 60_000);
    utimesSync(file, future, future);
    expect(await c.get(file)).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it("invalidates a same-size rewrite whose mtime was restored (ctime moves)", async () => {
    const c = new FileResultCache();
    await put(c);
    const m = statSync(file).mtime;
    writeFileSync(file, "two");
    utimesSync(file, m, m);
    expect(await c.get(file)).toBeUndefined();
  });

  it("invalidates when the file vanishes", async () => {
    const c = new FileResultCache();
    await put(c);
    rmSync(file);
    expect(await c.get(file)).toBeUndefined();
  });

  it("refuses a value derived before a write that landed before set()", async () => {
    const c = new FileResultCache();
    const stamp = await stampFile(file);
    if (stamp === null) throw new Error("no stamp");
    writeFileSync(file, "changed after the read began");
    expect(await c.set(file, "stale", stamp)).toBe(false);
    expect(await c.get(file)).toBeUndefined();
  });

  it("fill() does not cache a result whose file changed while it was read", async () => {
    const c = new FileResultCache();
    const v = await c.fill(file, async () => {
      writeFileSync(file, "rewritten mid-read, longer");
      return "stale";
    });
    expect(v).toBe("stale");
    expect(c.size).toBe(0);
    expect(await c.fill(file, async () => "fresh")).toBe("fresh");
    expect(await c.get(file)).toBe("fresh");
  });

  it("refuses values over the size cap and evicts the oldest past maxEntries", async () => {
    const c = new FileResultCache({ maxEntries: 2, maxValueChars: 4 });
    const stamp = await stampFile(file);
    if (stamp === null) throw new Error("no stamp");
    expect(await c.set(file, "too long", stamp)).toBe(false);
    const files = ["x", "y", "z"].map((n) => {
      const p = join(dir, n);
      writeFileSync(p, n);
      return p;
    });
    for (const p of files) {
      const s = await stampFile(p);
      if (s === null) throw new Error("no stamp");
      await c.set(p, "v", s);
    }
    expect(c.size).toBe(2);
    expect(await c.get(files[0] as string)).toBeUndefined();
    expect(await c.get(files[2] as string)).toBe("v");
  });
});
