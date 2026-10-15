/**
 * T3 (WS-W W3) — zone-1 draft storage for distilled source notes, extended by
 * R3.5 to also store `golem note` captures shaped into `question`/`artifact`
 * drafts. Drafts live at `.golem/distill/<slug>.md` (gitignored, never
 * auto-committed to the wiki) and are shaped like a wiki page from the start
 * — same frontmatter schema, `type` set to whatever zone-2 page it will
 * become — so promoting one is a copy/paste into `docs/wiki/<zone>/`, not a
 * reformat.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WikiFrontmatter } from "../interfaces/index.js";
import { ensurePluginRedactionRules } from "../plugins/redaction-init.js";
import { parseFrontmatter, serializeFrontmatter } from "../wiki/frontmatter.js";
import { redactWikiText as redact, safeDraftSlug, sha8 } from "../wiki/write-redaction.js";
import type { DistillDraft, NoteDraft, SynthesisDraft } from "./distill.js";

/** Provenance marker stored in `sources` for a note-derived draft (R3.5). */
function noteSourceMarker(noteTs: string): string {
  return `note:${noteTs}`;
}

/** Where a project's distill drafts live. */
export function distillDir(projectDir: string): string {
  return path.join(projectDir, ".golem", "distill");
}

function draftPath(projectDir: string, slug: string): string {
  return path.join(distillDir(projectDir), `${slug}.md`);
}

/**
 * Redact every model- or source-derived string of a draft before it is stored.
 * Plugin rules are loaded first (DUSTSEC.8); built-ins always run.
 */
async function redactedDraft<T extends DistillDraft | NoteDraft | SynthesisDraft>(
  projectDir: string,
  draft: T,
): Promise<T> {
  await ensurePluginRedactionRules(projectDir);
  return {
    ...draft,
    // A slug is a file name, then a committed wiki path (see write-redaction.ts).
    slug: safeDraftSlug(draft.slug),
    title: redact(draft.title),
    tags: draft.tags.map(redact),
    summary: redact(draft.summary),
    wikilinks: draft.wikilinks.map(redact),
  };
}

/**
 * Where a draft goes. The slug is the model's choice, so two sources can pick the
 * same one: the plain `<slug>.md` is used when it is free or `owns` says it is
 * this source's, otherwise `<slug>-<sha8 of the ORIGINAL source>` is used, so a
 * colliding slug never overwrites another source's draft (DUST3.8 D11).
 *
 * `key` is what is stored in the draft (redacted); `original` is what the caller
 * passed. When redaction changed it, the stored value cannot tell two sources
 * apart (they differ only in the redacted secret), so the hashed path is used
 * outright. A truncated hash does not expose the secret.
 */
async function sourceKeyedPath(
  projectDir: string,
  slug: string,
  original: string,
  key: string,
  owns: (frontmatter: WikiFrontmatter) => boolean,
): Promise<string> {
  const hashed = draftPath(projectDir, `${slug}-${sha8(original)}`);
  if (original !== key) return hashed;
  const plain = draftPath(projectDir, slug);
  let raw: string;
  try {
    raw = await readFile(plain, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return plain;
    throw err;
  }
  try {
    if (owns(parseFrontmatter(raw).frontmatter)) return plain;
  } catch {
    // An unparsable file is not this source's draft either.
  }
  return hashed;
}

function draftBody(draft: DistillDraft, url: string): string {
  const summary = draft.summary;
  const lines = [`# ${draft.title}`, "", summary, "", `Source: ${url}`];
  if (draft.wikilinks.length > 0) {
    lines.push("", "## Candidate wikilinks", "", ...draft.wikilinks.map((t) => `- [[${t}]]`));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Write (or overwrite) the draft file for a distilled page, keyed by slug —
 * calling this again for the same URL after a re-distill replaces the prior
 * draft rather than accumulating stale copies. Returns the file path written.
 */
export async function writeDraftFile(
  projectDir: string,
  rawUrl: string,
  rawDraft: DistillDraft,
  nowIso: string,
): Promise<string> {
  const draft = await redactedDraft(projectDir, rawDraft);
  const url = redact(rawUrl);
  const date = nowIso.slice(0, 10);
  const frontmatter: WikiFrontmatter = {
    title: draft.title,
    type: "source",
    tags: draft.tags,
    sources: [url],
    created: date,
    updated: date,
  };
  const file = await sourceKeyedPath(projectDir, draft.slug, rawUrl, url, (fm) =>
    fm.sources.includes(url),
  );
  await mkdir(distillDir(projectDir), { recursive: true });
  await writeFile(file, `${serializeFrontmatter(frontmatter)}\n\n${draftBody(draft, url)}`, "utf8");
  return file;
}

function noteDraftBody(draft: NoteDraft): string {
  const summary = draft.summary;
  const lines = [`# ${draft.title}`, "", summary];
  if (draft.wikilinks.length > 0) {
    lines.push("", "## Candidate wikilinks", "", ...draft.wikilinks.map((t) => `- [[${t}]]`));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * R3.5 — write (or overwrite) the draft file for a `golem note` capture
 * shaped by {@link distillNote}, keyed by slug like {@link writeDraftFile}.
 * `noteTs` (the note's own timestamp) is stored as a `note:<ts>` provenance
 * marker in `sources`, since there's no URL to cite. Returns the file path
 * written.
 */
export async function writeNoteDraftFile(
  projectDir: string,
  noteTs: string,
  rawDraft: NoteDraft,
  nowIso: string,
): Promise<string> {
  const draft = await redactedDraft(projectDir, rawDraft);
  const date = nowIso.slice(0, 10);
  const frontmatter: WikiFrontmatter = {
    title: draft.title,
    type: draft.type,
    tags: draft.tags,
    sources: [noteSourceMarker(noteTs)],
    created: date,
    updated: date,
  };
  const marker = noteSourceMarker(noteTs);
  const file = await sourceKeyedPath(projectDir, draft.slug, marker, marker, (fm) =>
    fm.sources.includes(marker),
  );
  await mkdir(distillDir(projectDir), { recursive: true });
  await writeFile(file, `${serializeFrontmatter(frontmatter)}\n\n${noteDraftBody(draft)}`, "utf8");
  return file;
}

function synthesisDraftBody(draft: SynthesisDraft): string {
  const summary = draft.summary;
  const lines = [`# ${draft.title}`, "", summary];
  if (draft.wikilinks.length > 0) {
    lines.push("", "## Candidate wikilinks", "", ...draft.wikilinks.map((t) => `- [[${t}]]`));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * R3.4 — write (or overwrite) the draft file for a weekly synthesis shaped
 * by {@link synthesizeWeekly}, keyed by slug like {@link writeDraftFile}.
 * `sources` cites the debrief/note provenance the caller drew on (debrief
 * wiki-relative paths, `note:<ts>` markers) — there's no single URL to cite.
 * Returns the file path written.
 */
export async function writeSynthesisDraftFile(
  projectDir: string,
  rawSources: readonly string[],
  rawDraft: SynthesisDraft,
  nowIso: string,
): Promise<string> {
  const draft = await redactedDraft(projectDir, rawDraft);
  const sources = rawSources.map(redact);
  const date = nowIso.slice(0, 10);
  const frontmatter: WikiFrontmatter = {
    title: draft.title,
    type: "synthesis",
    tags: draft.tags,
    sources: [...sources],
    created: date,
    updated: date,
  };
  // A weekly synthesis is keyed by its slug among synthesis drafts only: a
  // re-synthesis rewrites its own file, but never a URL or note draft.
  const synthKey = `synthesis:${draft.slug}`;
  const file = await sourceKeyedPath(
    projectDir,
    draft.slug,
    synthKey,
    synthKey,
    (fm) => fm.type === "synthesis",
  );
  await mkdir(distillDir(projectDir), { recursive: true });
  await writeFile(
    file,
    `${serializeFrontmatter(frontmatter)}\n\n${synthesisDraftBody(draft)}`,
    "utf8",
  );
  return file;
}

export interface DraftFile {
  readonly slug: string;
  readonly path: string;
  readonly frontmatter: WikiFrontmatter;
  readonly body: string;
}

/** Read one draft by slug. Null on a missing or unparseable file — never throws for those. */
export async function readDraftFile(projectDir: string, slug: string): Promise<DraftFile | null> {
  const file = draftPath(projectDir, slug);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const { frontmatter, body } = parseFrontmatter(raw);
    return { slug, path: file, frontmatter, body };
  } catch {
    return null;
  }
}

/** All pending drafts, sorted by slug. Empty (not an error) if the dir doesn't exist yet. */
export async function listDraftFiles(projectDir: string): Promise<DraftFile[]> {
  let entries: string[];
  try {
    entries = await readdir(distillDir(projectDir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const slugs = entries
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
  const drafts: DraftFile[] = [];
  for (const slug of slugs) {
    const draft = await readDraftFile(projectDir, slug);
    if (draft !== null) drafts.push(draft);
  }
  return drafts;
}

/**
 * R4.5 — remove a draft file once it has been promoted into the wiki (or
 * dropped). Idempotent: a missing file is not an error (the draft is a
 * transient zone-1 artifact, regenerable by re-distilling).
 */
export async function removeDraftFile(projectDir: string, slug: string): Promise<void> {
  await rm(draftPath(projectDir, slug), { force: true });
}

/** Find an existing draft citing `url`, for the lazy-backfill pointer note in the fetch hook. */
export async function findDraftByUrl(projectDir: string, url: string): Promise<DraftFile | null> {
  const drafts = await listDraftFiles(projectDir);
  return drafts.find((draft) => draft.frontmatter.sources.includes(url)) ?? null;
}

/** R3.5 — find an existing draft shaped from the note with timestamp `noteTs`. */
export async function findDraftByNoteTs(
  projectDir: string,
  noteTs: string,
): Promise<DraftFile | null> {
  const marker = noteSourceMarker(noteTs);
  const drafts = await listDraftFiles(projectDir);
  return drafts.find((draft) => draft.frontmatter.sources.includes(marker)) ?? null;
}
