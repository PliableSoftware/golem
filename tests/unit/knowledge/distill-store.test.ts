/**
 * T3 (WS-W W3) — zone-1 draft storage: `.golem/distill/<slug>.md`, wiki-page
 * shaped from the start (frontmatter type "source").
 */

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { DistillDraft, NoteDraft, SynthesisDraft } from "../../../src/knowledge/distill.js";
import {
  distillDir,
  findDraftByNoteTs,
  findDraftByUrl,
  listDraftFiles,
  readDraftFile,
  writeDraftFile,
  writeNoteDraftFile,
  writeSynthesisDraftFile,
} from "../../../src/knowledge/distill-store.js";
import { useTempDirs } from "../../helpers/tmp.js";

let projectDir: string;
const newTempDir = useTempDirs("golem-distill-");

beforeEach(async () => {
  projectDir = await newTempDir();
});

const url = "https://example.com/widgets";
const draft: DistillDraft = {
  title: "Widget Factory Basics",
  slug: "widget-factory-basics",
  tags: ["widgets", "factory"],
  summary: "Widgets are small rotating gears.",
  wikilinks: ["Widget Factory"],
};

describe("writeDraftFile / readDraftFile", () => {
  it("writes a wiki-shaped draft file with type=source and the URL in sources", async () => {
    const file = await writeDraftFile(projectDir, url, draft, "2026-07-11T00:00:00.000Z");
    expect(file).toBe(path.join(distillDir(projectDir), "widget-factory-basics.md"));

    const raw = await readFile(file, "utf8");
    expect(raw).toContain("type: source");
    expect(raw).toContain(`sources: [${url}]`);
    expect(raw).toContain("Widgets are small rotating gears.");
    expect(raw).toContain("[[Widget Factory]]");

    const read = await readDraftFile(projectDir, "widget-factory-basics");
    expect(read?.frontmatter.title).toBe("Widget Factory Basics");
    expect(read?.frontmatter.sources).toEqual([url]);
    expect(read?.frontmatter.tags).toEqual(["widgets", "factory"]);
  });

  it("strips known secrets from the summary before writing (redaction floor)", async () => {
    // Assembled from fragments so no contiguous PEM header is a literal in
    // this source file (this repo's own Golem proxy would otherwise redact it
    // in tooling views).
    const begin = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    const end = ["-----END", "PRIVATE KEY-----"].join(" ");
    const leaky: DistillDraft = {
      ...draft,
      summary: `notes\n${begin}\nZmFrZWtleWRhdGE=\n${end}\nend`,
    };
    const file = await writeDraftFile(projectDir, url, leaky, "2026-07-11T00:00:00.000Z");
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("ZmFrZWtleWRhdGE=");
    // The pipeline stage runs first now (DUST3.8), so its placeholder wins over the floor's.
    expect(raw).not.toContain("PRIVATE KEY");
    expect(raw).toMatch(/redacted/i);
  });

  it("overwrites the same slug on a second write (idempotent by slug)", async () => {
    await writeDraftFile(projectDir, url, draft, "2026-07-11T00:00:00.000Z");
    const updated: DistillDraft = { ...draft, summary: "Updated summary." };
    await writeDraftFile(projectDir, url, updated, "2026-07-11T00:00:01.000Z");
    const drafts = await listDraftFiles(projectDir);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.body).toContain("Updated summary.");
  });

  // DUST3.8 D11: the slug is the model's choice, so two sources can pick the same one.
  it("does not overwrite a draft from a different URL that picked the same slug", async () => {
    const other = "https://example.com/other";
    await writeDraftFile(projectDir, url, draft, "2026-07-11T00:00:00.000Z");
    await writeDraftFile(
      projectDir,
      other,
      { ...draft, summary: "A different page entirely." },
      "2026-07-11T00:00:01.000Z",
    );
    const drafts = await listDraftFiles(projectDir);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.frontmatter.sources[0]).sort()).toEqual([other, url].sort());
    expect((await findDraftByUrl(projectDir, url))?.body).toContain("small rotating gears");
    expect((await findDraftByUrl(projectDir, other))?.body).toContain("different page");
  });

  it("re-distilling the colliding URL rewrites its own draft, not the other's", async () => {
    const other = "https://example.com/other";
    await writeDraftFile(projectDir, url, draft, "2026-07-11T00:00:00.000Z");
    await writeDraftFile(
      projectDir,
      other,
      { ...draft, summary: "Other." },
      "2026-07-11T00:00:01Z",
    );
    await writeDraftFile(
      projectDir,
      other,
      { ...draft, summary: "Other v2." },
      "2026-07-11T00:00:02Z",
    );
    const drafts = await listDraftFiles(projectDir);
    expect(drafts).toHaveLength(2);
    expect((await findDraftByUrl(projectDir, other))?.body).toContain("Other v2.");
    expect((await findDraftByUrl(projectDir, url))?.body).toContain("small rotating gears");
  });

  it("does not let a note draft overwrite a URL draft with the same slug", async () => {
    await writeDraftFile(projectDir, url, draft, "2026-07-11T00:00:00.000Z");
    await writeNoteDraftFile(
      projectDir,
      "2026-07-12T09:00:00.000Z",
      { ...noteDraft, slug: draft.slug },
      "2026-07-12T10:00:00.000Z",
    );
    expect(await listDraftFiles(projectDir)).toHaveLength(2);
    expect(await findDraftByUrl(projectDir, url)).not.toBeNull();
  });

  // DUST3.8: drafts are zone-1 storage; the pipeline redactor runs before the write.
  it("redacts secret-shaped text in the title, tags, source and summary", async () => {
    const token = (seed: string) => `ghp_${seed.repeat(5)}`;
    const [t, g, u, b] = [
      token("a1B2c3D4"),
      token("z9Y8x7W6"),
      token("q1w2e3r4"),
      token("m5n6b7v8"),
    ];
    const file = await writeDraftFile(
      projectDir,
      `https://example.com/?k=${u}`,
      { ...draft, title: `Title ${t}`, tags: [g], summary: `Body ${b}` },
      "2026-07-11T00:00:00.000Z",
    );
    const raw = await readFile(file, "utf8");
    for (const secret of [t, g, u, b]) expect(raw).not.toContain(secret);
  });

  it("never uses a slug that carries a long opaque token as the file name", async () => {
    const hex = randomBytes(20).toString("hex");
    const file = await writeDraftFile(
      projectDir,
      url,
      { ...draft, slug: `notes-${hex}` },
      "2026-07-11T00:00:00.000Z",
    );
    expect(path.basename(file)).toMatch(/^draft-[0-9a-f]{8}\.md$/);
    expect(file).not.toContain(hex.slice(0, 12));
  });

  it("keeps two URLs that differ only in a redacted secret apart", async () => {
    const tok = (seed: string) => `ghp_${seed.repeat(5)}`;
    const a = `https://example.com/page?k=${tok("a1B2c3D4")}`;
    const b = `https://example.com/page?k=${tok("z9Y8x7W6")}`;
    await writeDraftFile(projectDir, a, { ...draft, summary: "From A." }, "2026-07-11T00:00:00Z");
    await writeDraftFile(projectDir, b, { ...draft, summary: "From B." }, "2026-07-11T00:00:01Z");
    const drafts = await listDraftFiles(projectDir);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.body).join("\n")).toContain("From A.");
    expect(drafts.map((d) => d.body).join("\n")).toContain("From B.");
    // And rewriting A hits A's own file.
    await writeDraftFile(
      projectDir,
      a,
      { ...draft, summary: "From A v2." },
      "2026-07-11T00:00:02Z",
    );
    const after = await listDraftFiles(projectDir);
    expect(after).toHaveLength(2);
    expect(after.map((d) => d.body).join("\n")).toContain("From A v2.");
    expect(after.map((d) => d.body).join("\n")).toContain("From B.");
  });

  it("readDraftFile returns null for a missing slug", async () => {
    expect(await readDraftFile(projectDir, "does-not-exist")).toBeNull();
  });
});

describe("listDraftFiles", () => {
  it("returns an empty array when the distill dir doesn't exist yet", async () => {
    expect(await listDraftFiles(projectDir)).toEqual([]);
  });

  it("lists all drafts sorted by slug", async () => {
    await writeDraftFile(
      projectDir,
      "https://example.com/b",
      { ...draft, slug: "b-page", title: "B" },
      "2026-07-11T00:00:00.000Z",
    );
    await writeDraftFile(
      projectDir,
      "https://example.com/a",
      { ...draft, slug: "a-page", title: "A" },
      "2026-07-11T00:00:00.000Z",
    );
    const drafts = await listDraftFiles(projectDir);
    expect(drafts.map((d) => d.slug)).toEqual(["a-page", "b-page"]);
  });
});

describe("findDraftByUrl", () => {
  it("finds a draft citing the given URL", async () => {
    await writeDraftFile(projectDir, url, draft, "2026-07-11T00:00:00.000Z");
    const found = await findDraftByUrl(projectDir, url);
    expect(found?.slug).toBe("widget-factory-basics");
  });

  it("returns null when no draft cites the URL", async () => {
    await writeDraftFile(projectDir, url, draft, "2026-07-11T00:00:00.000Z");
    expect(await findDraftByUrl(projectDir, "https://example.com/other")).toBeNull();
  });
});

const noteTs = "2026-07-12T00:00:00.000Z";
const noteDraft: NoteDraft = {
  title: "Should notes support tagging?",
  slug: "should-notes-support-tagging",
  tags: ["notes"],
  type: "question",
  summary: "Whether captured notes should support inline #tags.",
  wikilinks: [],
};

describe("writeNoteDraftFile / findDraftByNoteTs", () => {
  it("writes a wiki-shaped draft file with the note's type and a note: provenance marker", async () => {
    const file = await writeNoteDraftFile(projectDir, noteTs, noteDraft, noteTs);
    expect(file).toBe(path.join(distillDir(projectDir), "should-notes-support-tagging.md"));

    const raw = await readFile(file, "utf8");
    expect(raw).toContain("type: question");
    expect(raw).toContain(`sources: [note:${noteTs}]`);
    expect(raw).toContain("Whether captured notes should support inline #tags.");
    expect(raw).not.toContain("Source:");

    const read = await readDraftFile(projectDir, "should-notes-support-tagging");
    expect(read?.frontmatter.type).toBe("question");
    expect(read?.frontmatter.sources).toEqual([`note:${noteTs}`]);
  });

  it("finds a draft shaped from the given note timestamp", async () => {
    await writeNoteDraftFile(projectDir, noteTs, noteDraft, noteTs);
    const found = await findDraftByNoteTs(projectDir, noteTs);
    expect(found?.slug).toBe("should-notes-support-tagging");
  });

  it("returns null when no draft cites the note timestamp", async () => {
    await writeNoteDraftFile(projectDir, noteTs, noteDraft, noteTs);
    expect(await findDraftByNoteTs(projectDir, "2026-07-12T01:00:00.000Z")).toBeNull();
  });

  it("keeps note-derived and url-derived drafts distinguishable by provenance marker", async () => {
    await writeDraftFile(projectDir, url, draft, "2026-07-11T00:00:00.000Z");
    await writeNoteDraftFile(projectDir, noteTs, noteDraft, noteTs);
    expect(await findDraftByUrl(projectDir, url)).not.toBeNull();
    expect((await findDraftByUrl(projectDir, url))?.slug).toBe("widget-factory-basics");
    expect(await findDraftByNoteTs(projectDir, noteTs)).not.toBeNull();
    expect((await findDraftByNoteTs(projectDir, noteTs))?.slug).toBe(
      "should-notes-support-tagging",
    );
    // A raw URL never matches a note's `note:<ts>` marker, and vice versa.
    expect(await findDraftByNoteTs(projectDir, url)).toBeNull();
  });
});

const synthesisDraft: SynthesisDraft = {
  title: "Week of 2026-07-07 synthesis",
  slug: "week-of-2026-07-07-synthesis",
  tags: ["synthesis"],
  summary: "This week's thread: chunking quality work paid off.",
  wikilinks: ["Widget Factory"],
};

describe("writeSynthesisDraftFile", () => {
  it("writes a wiki-shaped draft file with type=synthesis and the given sources", async () => {
    const sources = ["docs/wiki/debriefs/r3-3.md", "note:2026-07-08T10:00:00.000Z"];
    const file = await writeSynthesisDraftFile(
      projectDir,
      sources,
      synthesisDraft,
      "2026-07-11T00:00:00.000Z",
    );
    expect(file).toBe(path.join(distillDir(projectDir), "week-of-2026-07-07-synthesis.md"));

    const raw = await readFile(file, "utf8");
    expect(raw).toContain("type: synthesis");
    expect(raw).toContain("docs/wiki/debriefs/r3-3.md");
    expect(raw).toContain("note:2026-07-08T10:00:00.000Z");
    expect(raw).toContain("chunking quality work paid off");
    expect(raw).toContain("[[Widget Factory]]");

    const read = await readDraftFile(projectDir, "week-of-2026-07-07-synthesis");
    expect(read?.frontmatter.type).toBe("synthesis");
    expect(read?.frontmatter.sources).toEqual(sources);
  });

  it("overwrites the same slug on a second write (idempotent by slug)", async () => {
    await writeSynthesisDraftFile(
      projectDir,
      ["note:a"],
      synthesisDraft,
      "2026-07-11T00:00:00.000Z",
    );
    const updated: SynthesisDraft = { ...synthesisDraft, summary: "Updated summary." };
    await writeSynthesisDraftFile(
      projectDir,
      ["note:a", "note:b"],
      updated,
      "2026-07-11T00:00:01.000Z",
    );
    const drafts = await listDraftFiles(projectDir);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.body).toContain("Updated summary.");
    expect(drafts[0]?.frontmatter.sources).toEqual(["note:a", "note:b"]);
  });
});

describe("synthesis drafts and slug collisions (DUST3.8 review)", () => {
  it("does not overwrite a URL draft that has the same slug", async () => {
    await writeDraftFile(
      projectDir,
      url,
      { ...draft, slug: synthesisDraft.slug },
      "2026-07-11T00:00:00Z",
    );
    await writeSynthesisDraftFile(projectDir, ["note:a"], synthesisDraft, "2026-07-11T00:00:01Z");
    const drafts = await listDraftFiles(projectDir);
    expect(drafts).toHaveLength(2);
    expect((await findDraftByUrl(projectDir, url))?.frontmatter.type).toBe("source");
  });

  it("re-synthesising the same week still rewrites its own file", async () => {
    await writeDraftFile(
      projectDir,
      url,
      { ...draft, slug: synthesisDraft.slug },
      "2026-07-11T00:00:00Z",
    );
    await writeSynthesisDraftFile(projectDir, ["note:a"], synthesisDraft, "2026-07-11T00:00:01Z");
    await writeSynthesisDraftFile(
      projectDir,
      ["note:a", "note:b"],
      { ...synthesisDraft, summary: "Updated summary." },
      "2026-07-11T00:00:02Z",
    );
    const drafts = await listDraftFiles(projectDir);
    expect(drafts).toHaveLength(2);
    const synth = drafts.find((d) => d.frontmatter.type === "synthesis");
    expect(synth?.body).toContain("Updated summary.");
    expect(synth?.frontmatter.sources).toEqual(["note:a", "note:b"]);
  });
});
