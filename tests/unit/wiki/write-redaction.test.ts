/**
 * DUST3.8 review — the wiki path check must judge SEGMENTS, never the whole
 * path: the high-entropy sweep over `a/b/c.md` flagged real, committed pages.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertSafeWikiPath, safeDraftSlug } from "../../../src/wiki/index.js";

const WIKI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/wiki");

describe("assertSafeWikiPath over the real wiki", () => {
  it("refuses and renames none of the existing pages", async () => {
    const entries = (await readdir(WIKI_DIR, { recursive: true }))
      .map((e) => e.split(path.sep).join("/"))
      .filter((e) => e.endsWith(".md"));
    expect(entries.length).toBeGreaterThan(100);
    const refused: string[] = [];
    const renamed: string[] = [];
    for (const rel of entries) {
      try {
        assertSafeWikiPath(rel);
      } catch {
        refused.push(rel);
      }
      const stem = path.posix.basename(rel, ".md");
      if (safeDraftSlug(stem) !== stem) renamed.push(rel);
    }
    expect(refused).toEqual([]);
    expect(renamed).toEqual([]);
  });

  it("still refuses a segment carrying a long opaque run", () => {
    const run = "a1b2c3d4".repeat(5);
    expect(() => assertSafeWikiPath(`concepts/${run}.md`)).toThrow();
    expect(() => assertSafeWikiPath(`${run}/page.md`)).toThrow();
  });
});
