/**
 * Git worktree capture for parked tasks (DUST2.12 / r029).
 *
 * A parked session resumes in "the directory it was in". With linked worktrees
 * (`git worktree add`, parallel agents) that directory is not the repo root, and a
 * task that forgets it resumes against the wrong checkout. So a park records where
 * it was: worktree path, branch, HEAD and the files that were dirty.
 *
 * Argument-array `execFile` only (no shell), fail-open: outside a git repo, or with
 * no `git` on PATH, capture returns `undefined` and the park proceeds without it.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import nodePath from "node:path";
import { promisify } from "node:util";
import type { Worktree } from "./types.js";

const run = promisify(execFile);

/** The subset of `node:path` the normaliser needs, so tests can pass `path.win32`. */
export type PathModule = Pick<typeof nodePath, "normalize" | "sep"> & { readonly win32?: unknown };

/**
 * Git prints paths with forward slashes on every OS (`C:/Users/x/proj` on Windows).
 * Normalise to the platform's own form before storing or comparing, so a recorded
 * path is the same string `node:path` and `fs` would produce. Trailing separators go
 * too (but a bare root keeps its one).
 */
export function normalizeGitPath(p: string, pathMod: PathModule = nodePath): string {
  const normalized = pathMod.normalize(p);
  const root = pathMod.normalize(pathMod.sep === "\\" ? `${normalized.slice(0, 2)}\\` : "/");
  let out = normalized;
  while (out.length > root.length && (out.endsWith("\\") || out.endsWith("/"))) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * Do two paths name the same place? Both are normalised first; on a Windows path
 * module the comparison is case-insensitive (drive letters, and NTFS names, differ in
 * case between git, `realpath` and `process.cwd()`).
 */
export function samePath(a: string, b: string, pathMod: PathModule = nodePath): boolean {
  const x = normalizeGitPath(a, pathMod);
  const y = normalizeGitPath(b, pathMod);
  return pathMod.sep === "\\" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** Cap so a huge dirty tree cannot bloat a task record. */
const MAX_DIRTY_FILES = 50;

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", args, { cwd, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch {
    return undefined;
  }
}

/** Paths from `git status --porcelain -z` (rename/copy entries carry a second path token). */
function dirtyPaths(porcelainZ: string): string[] {
  const tokens = porcelainZ.split("\0").filter((t) => t !== "");
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    out.push(normalizeGitPath(token.slice(3)));
    if (token[0] === "R" || token[0] === "C") i += 1;
  }
  return out;
}

/** The worktree `dir` is in, or `undefined` when it is not inside a git checkout. */
export async function captureWorktree(dir: string): Promise<Worktree | undefined> {
  const top = (await git(dir, ["rev-parse", "--show-toplevel"]))?.trim();
  if (top === undefined || top === "") return undefined;
  const head = (await git(dir, ["rev-parse", "HEAD"]))?.trim();
  if (head === undefined || head === "") return undefined; // a repo with no commits yet
  const branch = (await git(dir, ["symbolic-ref", "--short", "-q", "HEAD"]))?.trim();
  const status = (await git(dir, ["status", "--porcelain", "-z"])) ?? "";
  return {
    path: normalizeGitPath(top),
    baseCommit: head,
    ...(branch !== undefined && branch !== "" ? { branch } : {}),
    dirtyFiles: dirtyPaths(status).slice(0, MAX_DIRTY_FILES),
  };
}

/** The directory to launch a resumed session in: the recorded worktree if it still exists. */
export function resumeCwd(w: Worktree | undefined): string | undefined {
  if (w === undefined) return undefined;
  const dir = normalizeGitPath(w.path);
  return existsSync(dir) ? dir : undefined;
}

/** One line for resume output: `path [branch] @ commit`. */
export function describeWorktree(w: Worktree): string {
  const branch = w.branch !== undefined ? ` [${w.branch}]` : "";
  return `${normalizeGitPath(w.path)}${branch} @ ${w.baseCommit.slice(0, 10)}`;
}

/**
 * Warnings for a resume: the recorded worktree is gone, or has moved on since the park.
 * Empty when it is as it was left (or when nothing was captured).
 */
export async function worktreeDrift(w: Worktree | undefined): Promise<string[]> {
  if (w === undefined) return [];
  const dir = normalizeGitPath(w.path);
  if (!existsSync(dir)) return [`recorded worktree no longer exists: ${dir}`];
  const head = (await git(dir, ["rev-parse", "HEAD"]))?.trim();
  if (head !== undefined && head !== "" && head !== w.baseCommit) {
    return [
      `worktree HEAD moved since the park (${w.baseCommit.slice(0, 10)} -> ${head.slice(0, 10)})`,
    ];
  }
  return [];
}
