/**
 * The wiki store writes files; it never commits. Generated surfaces must not
 * claim "every write is committed to git" — git review only exists once the
 * user commits (stale-committed-to-git-claims).
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { P0_SKILLS } from "../../../src/cli/skills.js";
import { golemWikiInit } from "../../../src/cli/wiki.js";
import { GUIDANCE_FEATURES, guidanceRuleBody } from "../../../src/hooks/guidance.js";

const STALE = /(?:write|writes)[^.\n]{0,40}\bcommitted to git|git makes (?:every )?(?:write|them)/i;

describe("wiki write wording", () => {
  it("generated WIKI.md says writes are files, not commits", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "golem-wiki-claims-"));
    try {
      const wikiDir = path.join(dir, "docs", "wiki");
      await golemWikiInit({ projectDir: dir, wikiDir });
      const body = await readFile(path.join(wikiDir, "WIKI.md"), "utf8");
      expect(body).toContain("Writes are plain files, not commits");
      expect(body).not.toMatch(STALE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skills and the wiki-first rule do not claim writes are committed", () => {
    for (const [name, content] of Object.entries(P0_SKILLS)) {
      expect(content, name).not.toMatch(STALE);
    }
    expect(P0_SKILLS.research).toContain("not commits");
    const feature = GUIDANCE_FEATURES.find((f) => f.name === "wiki-kb-first");
    if (!feature) throw new Error("wiki-kb-first guidance feature missing");
    const rule = guidanceRuleBody(feature);
    expect(rule).not.toMatch(STALE);
    expect(rule).toContain("files, not commits");
  });
});
