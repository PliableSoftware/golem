/**
 * Pins the DUST2.15 amendment to the frozen wiki contract: the optional
 * `WikiFrontmatter.aliases`.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { WikiFrontmatter, WikiUpsertInput } from "../../src/interfaces/index.js";
import { FileWikiStore, parseFrontmatter } from "../../src/wiki/index.js";
import { rmTemp } from "../helpers/tmp.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, rmTemp)));
});

const RAW = (extra: string) =>
  `---\ntitle: A\ntype: concept\ntags: []\nsources: []\ncreated: 2026-10-01\nupdated: 2026-10-01\n${extra}---\n\nbody\n`;

describe("WikiFrontmatter.aliases contract (DUST2.15)", () => {
  it("is an optional readonly string[]", () => {
    expectTypeOf<WikiFrontmatter["aliases"]>().toEqualTypeOf<readonly string[] | undefined>();
    const without: WikiFrontmatter = {
      title: "A",
      type: "concept",
      tags: [],
      sources: [],
      created: "2026-10-01",
      updated: "2026-10-01",
    };
    expect(without.aliases).toBeUndefined();
  });

  it("is absent (no key) when a page declares none, present when it does", () => {
    expect("aliases" in parseFrontmatter(RAW("")).frontmatter).toBe(false);
    expect(parseFrontmatter(RAW("aliases: [X, y]\n")).frontmatter.aliases).toEqual(["X", "y"]);
  });

  it("is not part of WikiUpsertInput", () => {
    expectTypeOf<keyof WikiUpsertInput["frontmatter"]>().toEqualTypeOf<
      "title" | "type" | "tags" | "sources"
    >();
  });

  it("upsertPage never writes aliases, and keeps a hand-authored line on rewrite", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "golem-wiki-aliases-"));
    dirs.push(dir);
    const store = new FileWikiStore({ wikiDir: dir, now: () => "2026-10-14" });
    const smuggled = { title: "N", type: "concept", tags: [], sources: [], aliases: ["no"] };
    const created = await store.upsertPage({
      relPath: "N.md",
      frontmatter: smuggled as WikiUpsertInput["frontmatter"],
      body: "x",
    });
    expect("aliases" in created.frontmatter).toBe(false);
    expect(await readFile(path.join(dir, "N.md"), "utf8")).not.toContain("aliases");

    await writeFile(path.join(dir, "A.md"), RAW("aliases: [keep]\n"));
    await store.upsertPage({
      relPath: "A.md",
      frontmatter: { title: "A", type: "concept", tags: ["t"], sources: [] },
      body: "more",
    });
    expect(await readFile(path.join(dir, "A.md"), "utf8")).toContain("aliases: [keep]");
  });
});
