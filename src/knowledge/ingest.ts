/**
 * WS-C C2 — ingestion traversal: walk a file or directory, pick chunkable
 * files, and produce prepared chunks. Cross-platform (node:fs/node:path);
 * skips vendored/build/VCS dirs and oversized files so a `golem index .` on a
 * real repo stays bounded. Embedding + vector upsert happen in the
 * KnowledgeBase (needs the WS-D embedder) — this module is pure I/O + chunking.
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { chunkFile, isChunkableExtension, type RawChunk } from "./chunker.js";
import { extractHtmlText, extractPdfText } from "./extractors.js";
import { chunkCodeSyntaxAware } from "./tree-sitter-chunker.js";

/** A chunk ready to embed + store: raw chunk + its stored source-path key. */
export interface PreparedChunk extends RawChunk {
  /** Stored key (see {@link sourcePathFor}): base-relative POSIX, or `external:<abs>` outside the base. */
  readonly sourcePath: string;
}

export interface IngestPlan {
  readonly chunks: readonly PreparedChunk[];
  readonly filesSeen: number;
  readonly filesSkipped: number;
}

/** Shared ingest tuning knobs — every field optional, all default off/unset. */
export interface IngestOptions {
  /** R3.3: try `web-tree-sitter` syntax-aware chunking for TS/JS before the heuristic. */
  readonly syntaxAwareChunking?: boolean;
  /**
   * Directory `sourcePath` is made relative to. Defaults to the ingest target
   * (its parent for a file). Pass the PROJECT root so a sub-path ingest names
   * files the way a full index does and cannot duplicate them (DUST3.7 D5).
   */
  readonly baseDir?: string;
}

/**
 * The directory source paths are relative to for an ingest of `absTarget`: the
 * project root when `projectId` is an absolute path, else the target itself (its
 * parent for a file). A target outside the project root still gets the project
 * root as its base, so {@link sourcePathFor} keys its files in the `external:`
 * namespace instead of colliding with project files.
 */
export function projectBaseDir(
  projectId: string,
  absTarget: string,
  targetIsFile: boolean,
): string {
  const own = targetIsFile ? path.dirname(absTarget) : absTarget;
  if (!path.isAbsolute(projectId)) return own;
  const root = path.resolve(projectId);
  // Compare real paths so a target that IS the project, spelled through a symlink
  // (or macOS /tmp vs /private/tmp), is not mistaken for an outside one.
  const relReal = path.relative(realOrResolved(root), realOrResolved(absTarget));
  if (relReal === "" || relReal === ".." || relReal.startsWith(`..${path.sep}`)) {
    // Same dir (own is the project) or outside it: outside targets keep the
    // project root as base and get `external:` keys from sourcePathFor.
    return relReal === "" ? own : root;
  }
  if (path.isAbsolute(relReal)) return root; // different drive
  // Inside by real path. If the spelled paths already agree, the root is the base;
  // otherwise express the root in the TARGET's spelling by climbing the real
  // relative path, so files walked under `absTarget` stay relative to it.
  const spelled = path.relative(root, absTarget);
  if (
    spelled !== "" &&
    spelled !== ".." &&
    !spelled.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(spelled)
  )
    return root;
  const depth = relReal.split(path.sep).length;
  const climbed = path.resolve(absTarget, ...Array<string>(depth).fill(".."));
  // Climbing the real depth up the SPELLED path is only valid when that spelling
  // really leads back to the project root (a link to the root itself). A link into
  // a subdirectory climbs to an unrelated directory: treat it as outside.
  return realOrResolved(climbed) === realOrResolved(root) ? climbed : root;
}

/** `realpath` of `p`, falling back to `path.resolve` when it cannot be resolved. */
function realOrResolved(p: string): string {
  try {
    // The native call canonicalises like the async `realpath` (expands Windows 8.3
    // short names, fixes the case on case-insensitive filesystems); the JS one does not,
    // so the same directory could compare unequal across the two spellings.
    return realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** Directories never walked (vendored, build output, VCS, Golem state). */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "coverage",
  ".golem",
  ".claude",
  ".next",
  ".cache",
  ".venv",
  "__pycache__",
  "target",
]);

/** Files larger than this are skipped (bytes) — avoids huge generated blobs. */
export const MAX_FILE_BYTES = 1_000_000;

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Source-path namespace for files indexed from OUTSIDE the project root. */
export const EXTERNAL_SOURCE_PREFIX = "external:";

/**
 * The stored `sourcePath` key for `abs` when indexing relative to `baseDir`.
 * A file inside `baseDir` keeps its relative POSIX path; a file outside it (an
 * index target beside, not under, the project) gets `external:<absolute POSIX
 * path>`, so it can never share a key with a project file of the same relative
 * name — and a watch edit or delete on it can never touch that file's chunks.
 */
export function sourcePathFor(baseDir: string, abs: string): string {
  const rel = path.relative(baseDir, abs);
  const posixRel = toPosix(rel);
  const escapes =
    rel === "" || path.isAbsolute(rel) || posixRel === ".." || posixRel.startsWith("../");
  return escapes ? `${EXTERNAL_SOURCE_PREFIX}${toPosix(path.resolve(abs))}` : posixRel;
}

/**
 * Read a file's content as chunkable plain text: `.pdf` gets its text layer
 * extracted (binary read), `.html` gets tags/scripts/styles stripped (utf8
 * read); every other chunkable extension is read as-is. `chunkFile` still
 * dispatches on the original extension, so extracted `.pdf`/`.html` content
 * falls through to `chunkText` exactly like today's plain-text files.
 */
async function readChunkableContent(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") return extractPdfText(await readFile(file));
  const raw = await readFile(file, "utf8");
  return ext === ".html" ? extractHtmlText(raw) : raw;
}

/**
 * Chunk one file's content: try syntax-aware chunking first when enabled and
 * applicable, falling back to the heuristic `chunkFile` otherwise (package
 * not installed, unsupported extension, or a parse failure).
 */
async function chunkFileContent(
  file: string,
  content: string,
  options: IngestOptions,
): Promise<RawChunk[]> {
  if (options.syntaxAwareChunking === true) {
    const ext = path.extname(file).toLowerCase();
    const syntaxAware = await chunkCodeSyntaxAware(ext, content);
    if (syntaxAware !== null) return syntaxAware;
  }
  return chunkFile(file, content);
}

/** The walk saw more files than its limit allows (see {@link collectFiles}). */
export class WalkLimitError extends Error {
  constructor(readonly walked: number) {
    super(`walk stopped after ${walked} files`);
    this.name = "WalkLimitError";
  }
}

/** One walked, chunkable file: its path and the ONE stat taken for it. */
interface WalkedFile {
  readonly abs: string;
  readonly mtimeMs: number;
  readonly size: number;
}

/**
 * Recursively collect chunkable files under `root` (a dir or a file), with the single
 * stat taken for each (a second stat per file was the scan's dominant cost). `walked`
 * counts EVERY regular file seen, chunkable or not; `walkLimit` aborts the walk with
 * {@link WalkLimitError} once that count passes it, so a data directory of tens of
 * thousands of non-chunkable files cannot make a poll unbounded.
 */
async function collectFiles(
  root: string,
  walkLimit = Number.POSITIVE_INFINITY,
): Promise<{ seen: WalkedFile[]; skipped: number; walked: number; rootIsFile: boolean }> {
  const seen: WalkedFile[] = [];
  let skipped = 0;
  let walked = 0;

  const info = await stat(root);
  if (info.isFile()) {
    if (isChunkableExtension(path.extname(root)) && info.size <= MAX_FILE_BYTES) {
      seen.push({ abs: root, mtimeMs: info.mtimeMs, size: info.size });
    } else skipped += 1;
    return { seen, skipped, walked: 1, rootIsFile: true };
  }

  const walk = async (dir: string): Promise<void> => {
    // Inline options literal so TS picks the withFileTypes overload; `.catch`
    // avoids an explicit (mis-resolving) return-type annotation.
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (entries === null) return; // unreadable dir — skip quietly
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        await walk(full);
      } else if (entry.isFile()) {
        walked += 1;
        if (walked > walkLimit) throw new WalkLimitError(walked);
        if (!isChunkableExtension(path.extname(entry.name))) {
          continue; // not a skip we count — just not a target type
        }
        try {
          const st = await stat(full);
          if (st.size > MAX_FILE_BYTES) {
            skipped += 1;
            continue;
          }
          seen.push({ abs: full, mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          skipped += 1;
        }
      }
    }
  };
  await walk(root);
  return { seen, skipped, walked, rootIsFile: false };
}

/**
 * Traverse `root`, chunk every chunkable file, and return prepared chunks with
 * repo-relative source paths. Does not embed or store.
 */
export async function planIngest(root: string, options: IngestOptions = {}): Promise<IngestPlan> {
  const absRoot = path.resolve(root);
  const { seen: walkedFiles, skipped, rootIsFile } = await collectFiles(absRoot);
  const seen = walkedFiles.map((f) => f.abs);
  const baseDir = options.baseDir ?? (rootIsFile ? path.dirname(absRoot) : absRoot);

  const chunks: PreparedChunk[] = [];
  let filesSkipped = skipped;
  for (const file of seen) {
    let content: string;
    try {
      content = await readChunkableContent(file);
    } catch {
      filesSkipped += 1;
      continue;
    }
    const sourcePath = sourcePathFor(baseDir, file);
    for (const raw of await chunkFileContent(file, content, options)) {
      chunks.push({ ...raw, sourcePath });
    }
  }
  return { chunks, filesSeen: seen.length, filesSkipped };
}

/** Deterministic chunk id from project + source + line span + content. */
export function chunkIdFor(projectId: string, chunk: PreparedChunk): string {
  return createHash("sha256")
    .update(`${projectId}\0${chunk.sourcePath}\0${chunk.startLine}\0${chunk.text}`)
    .digest("hex")
    .slice(0, 20);
}

/** One indexable file's identity for incremental change detection. */
export interface FileState {
  /** Absolute path. */
  readonly abs: string;
  /** Stored key (see {@link sourcePathFor}) — matches chunk `sourcePath`. */
  readonly sourcePath: string;
  /** Last-modified epoch ms + byte size — the change signal. */
  readonly mtimeMs: number;
  readonly size: number;
}

/**
 * List the indexable files under `root` with their mtime/size — the same
 * traversal `planIngest` uses, but returning file identity instead of chunks, so
 * the auto-index can detect what changed since last time.
 */
export async function scanFiles(root: string, baseDirOverride?: string): Promise<FileState[]> {
  return (await scanTree(root, baseDirOverride)).files;
}

/**
 * {@link scanFiles} plus the count of every regular file the walk saw, one stat per
 * chunkable file. `walkLimit` bounds the walk (throws {@link WalkLimitError}).
 */
export async function scanTree(
  root: string,
  baseDirOverride?: string,
  walkLimit?: number,
): Promise<{ files: FileState[]; walked: number }> {
  const absRoot = path.resolve(root);
  const { seen, walked, rootIsFile } = await collectFiles(absRoot, walkLimit);
  const baseDir = baseDirOverride ?? (rootIsFile ? path.dirname(absRoot) : absRoot);
  const files = seen.map((f) => ({
    abs: f.abs,
    sourcePath: sourcePathFor(baseDir, f.abs),
    mtimeMs: f.mtimeMs,
    size: f.size,
  }));
  return { files, walked };
}

/**
 * Chunk specific files with `sourcePath` from {@link sourcePathFor}`(baseDir, file)`
 * (relative to `baseDir`, NOT each file's own dir; `external:` outside it), so
 * incremental re-ingest of one file produces the same source paths as the
 * original full index of the project root.
 */
export async function chunkFilesRelativeTo(
  files: readonly string[],
  baseDir: string,
  options: IngestOptions = {},
): Promise<PreparedChunk[]> {
  return (await chunkFilesChecked(files, baseDir, options)).chunks;
}

/**
 * {@link chunkFilesRelativeTo} that says which files could NOT be read (a transient
 * EBUSY/EPERM on Windows, a file that vanished). Such a file is a failure to retry,
 * not a file with no content: the caller must neither record it as indexed nor drop
 * its existing chunks.
 */
export async function chunkFilesChecked(
  files: readonly string[],
  baseDir: string,
  options: IngestOptions = {},
): Promise<{ chunks: PreparedChunk[]; unreadable: string[] }> {
  const chunks: PreparedChunk[] = [];
  const unreadable: string[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await readChunkableContent(file);
    } catch {
      unreadable.push(file);
      continue;
    }
    const sourcePath = sourcePathFor(baseDir, file);
    for (const raw of await chunkFileContent(file, content, options)) {
      chunks.push({ ...raw, sourcePath });
    }
  }
  return { chunks, unreadable };
}
