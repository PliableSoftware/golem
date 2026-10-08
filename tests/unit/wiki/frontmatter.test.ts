/**
 * WS-W W2 — frontmatter parse/serialize/wikilink extraction (no filesystem).
 */

import { describe, expect, it } from "vitest";
import {
  extractWikilinks,
  parseFrontmatter,
  serializeFrontmatter,
} from "../../../src/wiki/index.js";

const SAMPLE = [
  "---",
  "title: Prompt Caching",
  "type: concept",
  "tags: [cache, prompts]",
  "sources: [https://example.com, docs/wiki/WIKI.md]",
  "created: 2026-07-10",
  "updated: 2026-07-10",
  "---",
  "",
  "# Prompt Caching",
  "",
  "See [[Wiki-First Knowledge]] for context.",
].join("\n");

describe("parseFrontmatter", () => {
  it("parses required keys, bracketed lists, and the body", () => {
    const { frontmatter, body } = parseFrontmatter(SAMPLE);
    expect(frontmatter).toEqual({
      title: "Prompt Caching",
      type: "concept",
      tags: ["cache", "prompts"],
      sources: ["https://example.com", "docs/wiki/WIKI.md"],
      created: "2026-07-10",
      updated: "2026-07-10",
    });
    expect(body).toBe("# Prompt Caching\n\nSee [[Wiki-First Knowledge]] for context.");
  });

  it("parses empty bracketed lists", () => {
    const raw = SAMPLE.replace("tags: [cache, prompts]", "tags: []").replace(
      "sources: [https://example.com, docs/wiki/WIKI.md]",
      "sources: []",
    );
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.tags).toEqual([]);
    expect(frontmatter.sources).toEqual([]);
  });

  it("parses CRLF pages the same as LF pages (checkout without eol=lf)", () => {
    const { frontmatter, body } = parseFrontmatter(SAMPLE.replaceAll("\n", "\r\n"));
    expect(frontmatter.title).toBe("Prompt Caching");
    expect(frontmatter.tags).toEqual(["cache", "prompts"]);
    // Body lines keep their CR (content is untouched); the blank separator
    // line after the closing delimiter is skipped like in the LF case.
    expect(body.replaceAll("\r\n", "\n")).toBe(
      "# Prompt Caching\n\nSee [[Wiki-First Knowledge]] for context.",
    );
  });

  it("throws when the leading --- delimiter is missing", () => {
    expect(() => parseFrontmatter("title: X\n---\nbody")).toThrow(/leading/);
  });

  it("throws when the closing --- delimiter is missing", () => {
    expect(() => parseFrontmatter("---\ntitle: X\nbody")).toThrow(/closing/);
  });

  it("throws when a required key is missing", () => {
    const raw = SAMPLE.split("\n")
      .filter((line) => !line.startsWith("updated:"))
      .join("\n");
    expect(() => parseFrontmatter(raw)).toThrow(/updated/);
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips through parseFrontmatter", () => {
    const { frontmatter } = parseFrontmatter(SAMPLE);
    const reparsed = parseFrontmatter(`${serializeFrontmatter(frontmatter)}\n\nbody`);
    expect(reparsed.frontmatter).toEqual(frontmatter);
  });
});

describe("extractWikilinks", () => {
  it("extracts plain, aliased, and section-anchored wikilinks", () => {
    const body =
      "[[Prompt Caching]] and [[Wiki-First Knowledge|the pattern]] and [[Other#Section]].";
    expect(extractWikilinks(body)).toEqual(["Prompt Caching", "Wiki-First Knowledge", "Other"]);
  });

  it("returns an empty array when there are no wikilinks", () => {
    expect(extractWikilinks("no links here")).toEqual([]);
  });

  it("keeps duplicates in order of appearance", () => {
    expect(extractWikilinks("[[A]] then [[B]] then [[A]] again")).toEqual(["A", "B", "A"]);
  });
});

// DUST3.8 D12: list items were split on every comma, so a comma inside one split it in two.
describe("frontmatter list items containing commas", () => {
  const base = {
    title: "T",
    type: "concept" as const,
    created: "2026-07-10",
    updated: "2026-07-10",
  };

  it("parses a quoted item with a comma as one item", () => {
    const raw = SAMPLE.replace("tags: [cache, prompts]", "tags: [\"a, b\", 'c, d', plain]");
    expect(parseFrontmatter(raw).frontmatter.tags).toEqual(["a, b", "c, d", "plain"]);
  });

  it("round-trips items with commas, brackets and quotes", () => {
    const fm = {
      ...base,
      tags: ["a, b", 'say "hi"', "x]y", "plain"],
      sources: ["https://example.com/?q=1,2"],
    };
    const raw = `${serializeFrontmatter(fm)}\n\nbody\n`;
    expect(parseFrontmatter(raw).frontmatter).toEqual(fm);
  });

  it("leaves plain lists serialised exactly as before", () => {
    expect(serializeFrontmatter({ ...base, tags: ["a", "b"], sources: [] })).toContain(
      "tags: [a, b]",
    );
  });

  it("keeps the whole raw item when text follows a closing quote", () => {
    const raw = SAMPLE.replace("tags: [cache, prompts]", 'tags: ["a, b" extra, plain]');
    expect(parseFrontmatter(raw).frontmatter.tags).toEqual(['"a, b" extra', "plain"]);
  });

  it("reads a doubled single quote inside single quotes as one quote", () => {
    const raw = SAMPLE.replace("tags: [cache, prompts]", "tags: ['it''s, ok', plain]");
    expect(parseFrontmatter(raw).frontmatter.tags).toEqual(["it's, ok", "plain"]);
  });

  it("round-trips a newline, a backslash and text after a quote", () => {
    const fm = {
      ...base,
      tags: ["line1\nline2", "back\\slash, comma", '"quoted" tail'],
      sources: [],
    };
    const raw = `${serializeFrontmatter(fm)}\n\nbody\n`;
    expect(parseFrontmatter(raw).frontmatter).toEqual(fm);
  });
});
