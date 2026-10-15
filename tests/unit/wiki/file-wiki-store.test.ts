/**
 * WS-W W2 — FileWikiStore behavior beyond the generic WikiStore contract:
 * date stamping across a changing clock, and the on-disk file shape.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FileWikiStore } from "../../../src/wiki/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

let dir: string;
let today: string;

const newTempDir = useTempDirs("golem-wiki-store-");

beforeEach(async () => {
  dir = await newTempDir();
  today = "2026-07-10";
});

describe("FileWikiStore", () => {
  it("stamps created and updated to the injected clock, keeping created stable across updates", async () => {
    const store = new FileWikiStore({ wikiDir: dir, now: () => today });
    const first = await store.upsertPage({
      relPath: "concepts/Prompt Caching.md",
      frontmatter: { title: "Prompt Caching", type: "concept", tags: [], sources: [] },
      body: "day one",
    });
    expect(first.frontmatter.created).toBe("2026-07-10");
    expect(first.frontmatter.updated).toBe("2026-07-10");

    today = "2026-07-15";
    const second = await store.upsertPage({
      relPath: "concepts/Prompt Caching.md",
      frontmatter: { title: "Prompt Caching", type: "concept", tags: [], sources: [] },
      body: "day two",
    });
    expect(second.frontmatter.created).toBe("2026-07-10");
    expect(second.frontmatter.updated).toBe("2026-07-15");
  });

  it("writes a well-formed frontmatter block + body to disk", async () => {
    const store = new FileWikiStore({ wikiDir: dir, now: () => today });
    await store.upsertPage({
      relPath: "concepts/Prompt Caching.md",
      frontmatter: { title: "Prompt Caching", type: "concept", tags: ["cache"], sources: [] },
      body: "Body text.",
    });
    const raw = await readFile(path.join(dir, "concepts", "Prompt Caching.md"), "utf8");
    expect(raw).toBe(
      [
        "---",
        "title: Prompt Caching",
        "type: concept",
        "tags: [cache]",
        "sources: []",
        "created: 2026-07-10",
        "updated: 2026-07-10",
        "---",
        "",
        "Body text.",
        "",
      ].join("\n"),
    );
  });

  it("refuses paths that escape the wiki directory (traversal or absolute)", async () => {
    const store = new FileWikiStore({ wikiDir: dir, now: () => today });
    const input = (relPath: string) => ({
      relPath,
      frontmatter: { title: "Evil", type: "concept" as const, tags: [], sources: [] },
      body: "nope",
    });
    await expect(store.upsertPage(input("../escape.md"))).rejects.toThrow(/escapes the wiki/);
    await expect(store.upsertPage(input(path.join(tmpdir(), "abs.md")))).rejects.toThrow(
      /escapes the wiki/,
    );
    await expect(store.readPage("../../outside.md")).rejects.toThrow(/escapes the wiki/);
  });

  it("creates nested zone directories on demand", async () => {
    const store = new FileWikiStore({ wikiDir: dir, now: () => today });
    await store.upsertPage({
      relPath: "entities/Some Thing.md",
      frontmatter: { title: "Some Thing", type: "entity", tags: [], sources: [] },
      body: "body",
    });
    const page = await store.readPage("entities/Some Thing.md");
    expect(page.frontmatter.title).toBe("Some Thing");
  });

  it("listPages skips unparsable files instead of throwing", async () => {
    const store = new FileWikiStore({ wikiDir: dir, now: () => today });
    await store.upsertPage({
      relPath: "concepts/Good.md",
      frontmatter: { title: "Good", type: "concept", tags: [], sources: [] },
      body: "fine",
    });
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(path.join(dir, "concepts", "Bad.md"), "not frontmatter at all", "utf8");

    await expect(store.resolveLink("Good")).resolves.toBe("concepts/Good.md");
    await expect(store.backlinks("Good")).resolves.toEqual([]);
  });

  it("returns an empty page list (not a throw) when wikiDir does not exist yet", async () => {
    const store = new FileWikiStore({ wikiDir: path.join(dir, "missing"), now: () => today });
    await expect(store.resolveLink("Anything")).resolves.toBeUndefined();
  });
});

describe("FileWikiStore upsert keeps untouched frontmatter as written (DUST3 leftover 8)", () => {
  const HAND_WRITTEN = [
    "---",
    "title: Quoted Page",
    "type: concept",
    'tags: ["cache", plain]',
    'sources: ["src/a.ts", "docs/b.md (R8d)", https://example.com/x]',
    "updated: 2026-07-01",
    "created: 2026-06-01",
    "---",
    "",
    "Original body.",
    "",
  ].join("\n");

  it("changes only the updated line and the body when the page is appended to", async () => {
    const file = path.join(dir, "concepts", "Quoted Page.md");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, HAND_WRITTEN, "utf8");

    const store = new FileWikiStore({ wikiDir: dir, now: () => "2026-10-14" });
    await store.upsertPage({
      relPath: "concepts/Quoted Page.md",
      frontmatter: { title: "Quoted Page", type: "concept", tags: ["cache"], sources: [] },
      body: "More.",
    });

    const after = (await readFile(file, "utf8")).split("\n");
    const before = HAND_WRITTEN.split("\n");
    // Frontmatter block is lines 0..7; everything but `updated` is byte-identical.
    expect(after.slice(0, 8).filter((l, i) => l !== before[i])).toEqual(["updated: 2026-10-14"]);
  });
});
