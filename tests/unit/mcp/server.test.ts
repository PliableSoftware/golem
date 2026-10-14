/**
 * WS-W W1c — `boostWikiHits`: rank wiki-dir hits above equal-scoring non-wiki
 * hits (spec Decision 28), inert when `wikiDir` is unset or nothing matches.
 *
 * T5 — `graphFirstWikiHits`/`pageToHit`: exact-title + 1-hop wikilink lookup
 * against a fake WikiReader, no real vector store involved.
 */

import { describe, expect, it } from "vitest";
import type { Hit, WikiPage, WikiReader } from "../../../src/interfaces/index.js";
import { boostWikiHits, graphFirstWikiHits, pageToHit } from "../../../src/mcp/server.js";

function hit(chunkId: string, sourcePath: string | undefined, score: number): Hit {
  return {
    chunk: {
      chunkId,
      projectId: "p",
      text: "",
      ...(sourcePath !== undefined ? { sourcePath } : {}),
      metadata: {},
    },
    score,
    scope: "knowledge",
  };
}

describe("boostWikiHits", () => {
  it("is a no-op when wikiDir is undefined", () => {
    const hits = [hit("a", "docs/wiki/x.md", 0.5), hit("b", "src/y.ts", 0.9)];
    expect(boostWikiHits(hits, undefined)).toEqual(hits);
  });

  it("promotes an equal-scoring wiki hit above a non-wiki hit", () => {
    const wiki = hit("a", "docs/wiki/x.md", 0.8);
    const other = hit("b", "src/y.ts", 0.8);
    const result = boostWikiHits([other, wiki], "docs/wiki");
    expect(result.map((h) => h.chunk.chunkId)).toEqual(["a", "b"]);
  });

  it("does not promote a lower-scoring wiki hit past a much stronger non-wiki hit", () => {
    const wiki = hit("a", "docs/wiki/x.md", 0.1);
    const other = hit("b", "src/y.ts", 0.9);
    const result = boostWikiHits([other, wiki], "docs/wiki");
    expect(result.map((h) => h.chunk.chunkId)).toEqual(["b", "a"]);
  });

  it("is separator-safe: a sibling directory sharing the prefix is not boosted", () => {
    const wiki = hit("a", "docs/wiki/x.md", 0.5);
    const sibling = hit("b", "docs/wiki-other/y.md", 0.5);
    const result = boostWikiHits([sibling, wiki], "docs/wiki");
    // Both score 0.5; only "a" is boosted, so it must sort first.
    expect(result.map((h) => h.chunk.chunkId)).toEqual(["a", "b"]);
  });

  it("treats the wiki root file itself (sourcePath === wikiDir) as under the wiki", () => {
    const root = hit("a", "docs/wiki", 0.5);
    const other = hit("b", "src/y.ts", 0.5);
    const result = boostWikiHits([other, root], "docs/wiki");
    expect(result.map((h) => h.chunk.chunkId)).toEqual(["a", "b"]);
  });

  it("leaves hits with no sourcePath un-boosted and order-stable among ties", () => {
    const noSource = hit("a", undefined, 0.5);
    const other = hit("b", "src/y.ts", 0.5);
    const result = boostWikiHits([noSource, other], "docs/wiki");
    expect(result.map((h) => h.chunk.chunkId)).toEqual(["a", "b"]);
  });
});

function page(relPath: string, title: string, body: string): WikiPage {
  return {
    relPath,
    frontmatter: {
      title,
      type: "concept",
      tags: [],
      sources: [],
      created: "2026-07-10",
      updated: "2026-07-10",
    },
    body,
  };
}

class FakeWikiReader implements WikiReader {
  constructor(private readonly pages: readonly WikiPage[]) {}
  async listPages(): Promise<readonly WikiPage[]> {
    return this.pages;
  }
  async readPage(titleOrPath: string): Promise<WikiPage> {
    const found = this.pages.find(
      (p) => p.relPath === titleOrPath || p.frontmatter.title === titleOrPath,
    );
    if (found === undefined) throw new Error(`not found: ${titleOrPath}`);
    return found;
  }
  async resolveLink(title: string): Promise<string | undefined> {
    return this.pages.find((p) => p.frontmatter.title === title)?.relPath;
  }
  async backlinks(): Promise<readonly string[]> {
    return [];
  }
}

describe("pageToHit", () => {
  it("builds a synthetic Hit whose sourcePath matches the vector-ingest convention", () => {
    const result = pageToHit(page("concepts/A.md", "A", "body text"), "docs/wiki", "proj-1", 2);
    expect(result).toEqual({
      chunk: {
        chunkId: "wiki:concepts/A.md",
        projectId: "proj-1",
        text: "body text",
        sourcePath: "docs/wiki/concepts/A.md",
        metadata: { kind: "wiki", title: "A" },
      },
      score: 2,
      scope: "knowledge",
    });
  });
});

describe("graphFirstWikiHits", () => {
  it("returns no hits when the wiki is empty", async () => {
    const wiki = new FakeWikiReader([]);
    expect(await graphFirstWikiHits("Prompt Caching", wiki, "docs/wiki", "p")).toEqual([]);
  });

  it("returns no hits when the query doesn't match any page title", async () => {
    const wiki = new FakeWikiReader([
      page("concepts/Prompt Caching.md", "Prompt Caching", "no links here"),
    ]);
    expect(await graphFirstWikiHits("nonexistent topic", wiki, "docs/wiki", "p")).toEqual([]);
  });

  it("matches a page title case-insensitively and builds a synthetic hit", async () => {
    const wiki = new FakeWikiReader([
      page("concepts/Prompt Caching.md", "Prompt Caching", "no links here"),
    ]);
    const hits = await graphFirstWikiHits("prompt caching", wiki, "docs/wiki", "proj-1");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.chunk.chunkId).toBe("wiki:concepts/Prompt Caching.md");
    expect(hits[0]?.chunk.sourcePath).toBe("docs/wiki/concepts/Prompt Caching.md");
    expect(hits[0]?.chunk.projectId).toBe("proj-1");
  });

  it("expands one hop along the matched page's outgoing wikilinks, scored below the exact match", async () => {
    const wiki = new FakeWikiReader([
      page("concepts/A.md", "A", "See [[B]] for more."),
      page("concepts/B.md", "B", "no links here"),
    ]);
    const hits = await graphFirstWikiHits("A", wiki, "docs/wiki", "p");
    expect(hits.map((h) => h.chunk.chunkId)).toEqual(["wiki:concepts/A.md", "wiki:concepts/B.md"]);
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? Number.POSITIVE_INFINITY);
  });

  it("skips wikilinks that don't resolve to a page and de-duplicates repeated links", async () => {
    const wiki = new FakeWikiReader([
      page("concepts/A.md", "A", "See [[B]], [[B]] again, and [[Missing]]."),
      page("concepts/B.md", "B", "no links here"),
    ]);
    const hits = await graphFirstWikiHits("A", wiki, "docs/wiki", "p");
    expect(hits.map((h) => h.chunk.chunkId)).toEqual(["wiki:concepts/A.md", "wiki:concepts/B.md"]);
  });

  it("does not duplicate the matched page when it wikilinks itself", async () => {
    const wiki = new FakeWikiReader([page("concepts/A.md", "A", "See [[A]] for background.")]);
    const hits = await graphFirstWikiHits("A", wiki, "docs/wiki", "p");
    expect(hits.map((h) => h.chunk.chunkId)).toEqual(["wiki:concepts/A.md"]);
  });
});

function aliased(relPath: string, title: string, aliases: string[], body = ""): WikiPage {
  const base = page(relPath, title, body);
  return { ...base, frontmatter: { ...base.frontmatter, aliases } };
}

describe("graphFirstWikiHits aliases (DUST2.15)", () => {
  const ids = (hits: Hit[]) => hits.map((h) => h.chunk.chunkId);

  it("surfaces a page when the query names one of its aliases, case-insensitively", async () => {
    const wiki = new FakeWikiReader([
      aliased("concepts/Prompt Caching.md", "Prompt Caching", ["PC"]),
    ]);
    expect(ids(await graphFirstWikiHits("  pc ", wiki, "docs/wiki", "p"))).toEqual([
      "wiki:concepts/Prompt Caching.md",
    ]);
  });

  it("scores an alias match above a one-hop link and below-or-equal an exact title match", async () => {
    const wiki = new FakeWikiReader([
      aliased("a/A.md", "A", ["Alpha"], "See [[B]]"),
      page("b/B.md", "B", ""),
    ]);
    const hits = await graphFirstWikiHits("alpha", wiki, "docs/wiki", "p");
    expect(ids(hits)).toEqual(["wiki:a/A.md", "wiki:b/B.md"]);
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 99);
  });

  it("surfaces BOTH pages sharing an alias, ordered by relPath regardless of list order", async () => {
    const forward = new FakeWikiReader([
      aliased("z/Zed.md", "Zed", ["shared"]),
      aliased("a/Ay.md", "Ay", ["Shared"]),
    ]);
    const reversed = new FakeWikiReader([
      aliased("a/Ay.md", "Ay", ["Shared"]),
      aliased("z/Zed.md", "Zed", ["shared"]),
    ]);
    const want = ["wiki:a/Ay.md", "wiki:z/Zed.md"];
    expect(ids(await graphFirstWikiHits("SHARED", forward, "docs/wiki", "p"))).toEqual(want);
    expect(ids(await graphFirstWikiHits("SHARED", reversed, "docs/wiki", "p"))).toEqual(want);
  });

  it("ranks the title match first when another page carries the same string as an alias", async () => {
    const wiki = new FakeWikiReader([
      aliased("a/Other.md", "Other", ["Topic"]),
      page("z/Topic.md", "Topic", ""),
    ]);
    expect(ids(await graphFirstWikiHits("topic", wiki, "docs/wiki", "p"))).toEqual([
      "wiki:z/Topic.md",
      "wiki:a/Other.md",
    ]);
  });

  it("does not duplicate a page whose alias repeats or equals its own title", async () => {
    const wiki = new FakeWikiReader([aliased("a/A.md", "A", ["a", "A", "x", "X"])]);
    expect(ids(await graphFirstWikiHits("a", wiki, "docs/wiki", "p"))).toEqual(["wiki:a/A.md"]);
    expect(ids(await graphFirstWikiHits("x", wiki, "docs/wiki", "p"))).toEqual(["wiki:a/A.md"]);
  });

  it("resolves a one-hop [[wikilink]] that names an alias, title winning over an alias", async () => {
    const wiki = new FakeWikiReader([
      page("a/A.md", "A", "[[Beta]] and [[Gamma]]"),
      aliased("b/B.md", "B", ["Beta"]),
      aliased("c/C.md", "C", ["Gamma"]),
      page("d/Gamma.md", "Gamma", ""),
    ]);
    expect(ids(await graphFirstWikiHits("A", wiki, "docs/wiki", "p"))).toEqual([
      "wiki:a/A.md",
      "wiki:b/B.md",
      "wiki:d/Gamma.md",
    ]);
  });

  it("ignores blank aliases and a blank query matches nothing", async () => {
    const wiki = new FakeWikiReader([aliased("a/A.md", "A", ["", "  "])]);
    expect(await graphFirstWikiHits("   ", wiki, "docs/wiki", "p")).toEqual([]);
  });

  it("stays linear on a large wiki (one list pass, no per-link scan)", async () => {
    const n = 20_000;
    const pages: WikiPage[] = [];
    for (let i = 0; i < n; i++) {
      pages.push(
        aliased(
          `p/${i}.md`,
          `T${i}`,
          [`al${i}`, "common"],
          `[[T${(i + 1) % n}]] [[al${(i + 2) % n}]]`,
        ),
      );
    }
    const wiki = new FakeWikiReader(pages);
    const start = performance.now();
    const hits = await graphFirstWikiHits("common", wiki, "docs/wiki", "p");
    expect(hits).toHaveLength(n);
    expect(performance.now() - start).toBeLessThan(3000);
    expect(ids(hits).slice(0, 2)).toEqual(["wiki:p/0.md", "wiki:p/1.md"]);
  });
});
