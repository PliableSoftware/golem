/**
 * R4.5 — `golem wiki promote`: routes a distill draft to its zone, writes it
 * through append-and-refine, consumes the draft, and enforces the Decision 26
 * consent convention (non-TTY refuses without --yes).
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  draftTargetRelPath,
  listPendingPromotions,
  PromoteRefusedError,
  renderPendingPromotions,
  runPromote,
} from "../../../src/cli/promote.js";
import type { NoteDraft } from "../../../src/knowledge/distill.js";
import { readDraftFile, writeNoteDraftFile } from "../../../src/knowledge/distill-store.js";
import { resetExtraRedactionRulesForTests } from "../../../src/pipeline/redaction-rules.js";
import { resetEnsurePluginRedactionRulesForTests } from "../../../src/plugins/redaction-init.js";
import { FileWikiStore, serializeFrontmatter } from "../../../src/wiki/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

let projectDir: string;
let wikiDir: string;
const NOW = "2026-07-16T12:00:00.000Z";

const newTempDir = useTempDirs("golem-promote-");

beforeEach(async () => {
  projectDir = await newTempDir();
  wikiDir = path.join(projectDir, "docs", "wiki");
});

const questionDraft: NoteDraft = {
  title: "Should promotion archive or delete drafts?",
  slug: "promotion-archive-or-delete",
  type: "question",
  tags: ["planning"],
  summary: "A question captured from a note.",
  wikilinks: ["Distillation Pipeline"],
};

async function seedDraft(): Promise<string> {
  await writeNoteDraftFile(projectDir, "2026-07-16T00:00:00.000Z", questionDraft, NOW);
  return questionDraft.slug;
}

describe("draftTargetRelPath", () => {
  it("routes each type to its zone directory", async () => {
    const slug = await seedDraft();
    const draft = await readDraftFile(projectDir, slug);
    if (draft === null) throw new Error("expected draft");
    expect(draftTargetRelPath(draft)).toBe("questions/promotion-archive-or-delete.md");
  });
});

describe("runPromote", () => {
  it("creates the wiki page from the draft and consumes the draft", async () => {
    const slug = await seedDraft();
    const outcome = await runPromote({ projectDir, wikiDir, slug, nowIso: NOW, yes: true });

    expect(outcome).toMatchObject({
      kind: "promoted",
      relPath: "questions/promotion-archive-or-delete.md",
      created: true,
    });
    // The page exists with the draft's title/type and body.
    const store = new FileWikiStore({ wikiDir });
    const page = await store.readPage("questions/promotion-archive-or-delete.md");
    expect(page.frontmatter.title).toBe(questionDraft.title);
    expect(page.frontmatter.type).toBe("question");
    expect(page.body).toContain("A question captured from a note.");
    // The draft is gone.
    expect(await readDraftFile(projectDir, slug)).toBeNull();
    expect(await listPendingPromotions(projectDir)).toHaveLength(0);
  });

  it("appends (append-and-refine) when the target page already exists", async () => {
    const slug = await seedDraft();
    // Pre-create the page with an existing body.
    const store = new FileWikiStore({ wikiDir, now: () => "2026-07-15" });
    await store.upsertPage({
      relPath: "questions/promotion-archive-or-delete.md",
      frontmatter: {
        title: questionDraft.title,
        type: "question",
        tags: ["prior"],
        sources: ["note:earlier"],
      },
      body: "EXISTING BODY",
    });

    const outcome = await runPromote({ projectDir, wikiDir, slug, nowIso: NOW, yes: true });
    expect(outcome).toMatchObject({ kind: "promoted", created: false });

    const raw = await readFile(
      path.join(wikiDir, "questions", "promotion-archive-or-delete.md"),
      "utf8",
    );
    // Both the old body and the promoted body, under a bare `---` separator; tags unioned.
    expect(raw).toContain("EXISTING BODY");
    expect(raw).toContain("A question captured from a note.");
    expect(raw).toContain("\n---\n");
    expect(raw).toContain("prior");
    expect(raw).toContain("planning");
  });

  it("refuses in a non-interactive session without --yes (Decision 26)", async () => {
    const slug = await seedDraft();
    await expect(
      runPromote({ projectDir, wikiDir, slug, nowIso: NOW, yes: false, isTTY: false }),
    ).rejects.toBeInstanceOf(PromoteRefusedError);
    // Nothing was written or consumed.
    expect(await readDraftFile(projectDir, slug)).not.toBeNull();
  });

  it("cancels (leaving the draft) when a TTY user declines", async () => {
    const slug = await seedDraft();
    const outcome = await runPromote({
      projectDir,
      wikiDir,
      slug,
      nowIso: NOW,
      yes: false,
      isTTY: true,
      confirm: async () => false,
      onPreview: () => {},
    });
    expect(outcome).toStrictEqual({ kind: "cancelled" });
    expect(await readDraftFile(projectDir, slug)).not.toBeNull();
  });

  it("promotes when a TTY user confirms", async () => {
    const slug = await seedDraft();
    let previewed = "";
    const outcome = await runPromote({
      projectDir,
      wikiDir,
      slug,
      nowIso: NOW,
      yes: false,
      isTTY: true,
      confirm: async () => true,
      onPreview: (t) => {
        previewed = t;
      },
    });
    expect(outcome.kind).toBe("promoted");
    expect(previewed).toContain(questionDraft.title);
    expect(await readDraftFile(projectDir, slug)).toBeNull();
  });

  it("throws for an unknown draft id", async () => {
    await expect(
      runPromote({ projectDir, wikiDir, slug: "no-such-draft", nowIso: NOW, yes: true }),
    ).rejects.toThrow(/no pending draft/);
  });
});

describe("renderPendingPromotions", () => {
  it("lists id, target, provenance, and age; friendly message when empty", async () => {
    expect(renderPendingPromotions([], NOW)).toContain("No pending distill drafts");
    await seedDraft();
    const drafts = await listPendingPromotions(projectDir);
    const rendered = renderPendingPromotions(drafts, NOW);
    expect(rendered).toContain("promotion-archive-or-delete");
    expect(rendered).toContain("questions/promotion-archive-or-delete.md");
    expect(rendered).toContain("note:2026-07-16T00:00:00.000Z");
  });
});

// DUST3.8 review: promote writes the COMMITTED wiki, so plugin rules (R6) and a
// promote-time re-redaction must apply even to drafts written without them.
describe("runPromote redaction", () => {
  const PLUGIN_SRC = `export default {
  name: "acme",
  version: "0.1.0",
  setup(api) {
    api.addRedactionRule({
      id: "employee-id",
      description: "ACME employee ids",
      pattern: /ACME-EMP-\\d{6}/g,
    });
  },
};
`;

  beforeEach(() => {
    resetExtraRedactionRulesForTests();
    resetEnsurePluginRedactionRulesForTests();
  });
  afterEach(() => {
    resetExtraRedactionRulesForTests();
    resetEnsurePluginRedactionRulesForTests();
  });

  async function handDraft(stem: string, fields: { title: string; tag: string; body: string }) {
    const dir = path.join(projectDir, ".golem", "distill");
    await mkdir(dir, { recursive: true });
    const fm = serializeFrontmatter({
      title: fields.title,
      type: "question",
      tags: [fields.tag],
      sources: [`note:${fields.tag}`],
      created: "2026-07-16",
      updated: "2026-07-16",
    });
    await writeFile(path.join(dir, `${stem}.md`), `${fm}\n\n${fields.body}\n`, "utf8");
  }

  it("applies plugin rules to a draft written before the rule existed", async () => {
    await mkdir(path.join(projectDir, ".golem"), { recursive: true });
    await writeFile(
      path.join(projectDir, ".golem", "settings.json"),
      JSON.stringify({ plugins: { load: ["./acme-plugin.mjs"] } }),
      "utf8",
    );
    await writeFile(path.join(projectDir, "acme-plugin.mjs"), PLUGIN_SRC, "utf8");
    const emp = `ACME-EMP-${String(Math.floor(Math.random() * 900000) + 100000)}`;
    await handDraft("plugin-draft", { title: `Who is ${emp}`, tag: emp, body: `Body ${emp} end` });

    await runPromote({ projectDir, wikiDir, slug: "plugin-draft", nowIso: NOW, yes: true });
    const raw = await readFile(path.join(wikiDir, "questions", "plugin-draft.md"), "utf8");
    expect(raw).not.toContain(emp);
    expect(raw).toContain("Body");
  });

  it("promotes a draft whose file stem carries a token to a draft-<sha8> page", async () => {
    const hex = randomBytes(20).toString("hex");
    await handDraft(`note-${hex}`, { title: "Plain title", tag: "plain", body: "Plain body" });
    const outcome = await runPromote({
      projectDir,
      wikiDir,
      slug: `note-${hex}`,
      nowIso: NOW,
      yes: true,
    });
    if (outcome.kind !== "promoted") throw new Error("expected promoted");
    expect(outcome.relPath).toMatch(/^questions\/draft-[0-9a-f]{8}\.md$/);
    expect(outcome.relPath).not.toContain(hex.slice(0, 12));
  });

  // Validate the destination BEFORE the user is asked: a failure after "yes" leaves the draft stuck.
  it("rejects a title conflict before asking for consent and leaves the draft in place", async () => {
    const slug = await seedDraft();
    const store = new FileWikiStore({ wikiDir });
    await store.upsertPage({
      relPath: "questions/promotion-archive-or-delete.md",
      frontmatter: { title: "A different title", type: "question", tags: [], sources: [] },
      body: "existing",
    });
    let asked = 0;
    await expect(
      runPromote({
        projectDir,
        wikiDir,
        slug,
        nowIso: NOW,
        yes: false,
        isTTY: true,
        onPreview: () => {},
        confirm: async () => {
          asked += 1;
          return true;
        },
      }),
    ).rejects.toThrow();
    expect(asked).toBe(0);
    expect(await readDraftFile(projectDir, slug)).not.toBeNull();
  });

  it("promotes a draft whose slug is a real wiki page name after confirmation", async () => {
    const stem = "2026-08-12-dust3-4-wiki-store-debrief";
    await handDraft(stem, { title: "Plain title", tag: "plain", body: "Plain body" });
    let asked = 0;
    const outcome = await runPromote({
      projectDir,
      wikiDir,
      slug: stem,
      nowIso: NOW,
      yes: false,
      isTTY: true,
      onPreview: () => {},
      confirm: async () => {
        asked += 1;
        return true;
      },
    });
    expect(asked).toBe(1);
    expect(outcome.kind).toBe("promoted");
    expect(await readDraftFile(projectDir, stem)).toBeNull();
  });
});
