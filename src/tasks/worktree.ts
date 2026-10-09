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
import { promisify } from "node:util";
import type { Worktree } from "./types.js";

const run = promisify(execFile);

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
    out.push(token.slice(3));
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
    path: top,
    baseCommit: head,
    ...(branch !== undefined && branch !== "" ? { branch } : {}),
    dirtyFiles: dirtyPaths(status).slice(0, MAX_DIRTY_FILES),
  };
}

/** One line for resume output: `path [branch] @ commit`. */
export function describeWorktree(w: Worktree): string {
  const branch = w.branch !== undefined ? ` [${w.branch}]` : "";
  return `${w.path}${branch} @ ${w.baseCommit.slice(0, 10)}`;
}

/**
 * Warnings for a resume: the recorded worktree is gone, or has moved on since the park.
 * Empty when it is as it was left (or when nothing was captured).
 */
export async function worktreeDrift(w: Worktree | undefined): Promise<string[]> {
  if (w === undefined) return [];
  if (!existsSync(w.path)) return [`recorded worktree no longer exists: ${w.path}`];
  const head = (await git(w.path, ["rev-parse", "HEAD"]))?.trim();
  if (head !== undefined && head !== "" && head !== w.baseCommit) {
    return [
      `worktree HEAD moved since the park (${w.baseCommit.slice(0, 10)} -> ${head.slice(0, 10)})`,
    ];
  }
  return [];
}
