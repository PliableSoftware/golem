/**
 * R13.8 item 1 — the project list a device can trust.
 *
 * A hosted session, the audit log and the conversation store are all scoped
 * PER PROJECT (`host-registry.ts`, `conversation-store.ts`) — there was no
 * cross-project index a device could ask "what projects does Golem know
 * about" before this. This is that index, kept at the USER scope
 * (`~/.golem/state/known-projects.json`, mirroring `config/paths.ts`'s
 * `defaultUserDir()`) because a device is not confined to one project's own
 * `.golem/` directory the way a hosted session is.
 *
 * "Known" means "recorded", never "reachable right now" — every read
 * re-checks the root and its wiring live rather than trusting the record, and
 * names exactly what is missing (task item 6: a stale or unreachable root is
 * FLAGGED, never silently offered as if it were fine).
 */

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "../config/file-io.js";
import { defaultUserDir } from "../config/paths.js";
import { resolveWorktreeRoot } from "../shared/git-worktree.js";

export function knownProjectsPath(userDir: string = defaultUserDir()): string {
  return path.join(userDir, "state", "known-projects.json");
}

export interface KnownProjectRecord {
  /** Absolute path, already collapsed through `resolveWorktreeRoot` (item 5). */
  readonly root: string;
  /** A short human label — defaults to the root's own basename. */
  readonly label: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

interface KnownProjectsFile {
  readonly version: 1;
  readonly projects: readonly KnownProjectRecord[];
}

const EMPTY: KnownProjectsFile = { version: 1, projects: [] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function read(userDir: string): Promise<KnownProjectsFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(knownProjectsPath(userDir), "utf8"));
    if (!isRecord(parsed) || !Array.isArray(parsed.projects)) return EMPTY;
    return {
      version: 1,
      projects: parsed.projects.filter(
        (p): p is KnownProjectRecord =>
          isRecord(p) && typeof p.root === "string" && typeof p.label === "string",
      ),
    };
  } catch {
    return EMPTY;
  }
}

async function write(userDir: string, file: KnownProjectsFile): Promise<void> {
  const p = knownProjectsPath(userDir);
  await mkdir(path.dirname(p), { recursive: true });
  await writeAtomic(p, `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * Record (or touch) a project root as known. Called from the device
 * start-conversation flow the moment a root is actually used — "known" is
 * earned by use, not declared.
 */
export async function recordKnownProject(
  root: string,
  opts: { readonly label?: string; readonly nowIso?: string; readonly userDir?: string } = {},
): Promise<void> {
  const resolved = resolveWorktreeRoot(path.resolve(root));
  const userDir = opts.userDir ?? defaultUserDir();
  const file = await read(userDir);
  const now = opts.nowIso ?? new Date().toISOString();
  const existing = file.projects.find((p) => p.root === resolved);
  const label = opts.label ?? existing?.label ?? path.basename(resolved);
  const projects = [
    ...file.projects.filter((p) => p.root !== resolved),
    { root: resolved, label, firstSeenAt: existing?.firstSeenAt ?? now, lastSeenAt: now },
  ];
  await write(userDir, { version: 1, projects });
}

export async function forgetKnownProject(
  root: string,
  userDir: string = defaultUserDir(),
): Promise<boolean> {
  const resolved = resolveWorktreeRoot(path.resolve(root));
  const file = await read(userDir);
  const next = file.projects.filter((p) => p.root !== resolved);
  if (next.length === file.projects.length) return false;
  await write(userDir, { version: 1, projects: next });
  return true;
}

/** Why a known root cannot be offered right now — named, never silent. */
export type ProjectReachability =
  | { readonly status: "ok" }
  | { readonly status: "unreachable"; readonly reason: string }
  | { readonly status: "not_wired"; readonly reason: string };

export interface KnownProjectStatus extends KnownProjectRecord {
  readonly reachability: ProjectReachability;
}

/**
 * Exported so `device-sessions.ts` can apply the same check to a root a
 * device asks to ORIGINATE in, before it is necessarily "known" yet — a
 * root only becomes known by being recorded, but reachability can and must
 * be checked before that (item 6: name what is missing, don't wait for a
 * record to exist first).
 */
export function checkReachability(root: string): ProjectReachability {
  if (!existsSync(root)) {
    return {
      status: "unreachable",
      reason: `project root does not exist on this machine: ${root}`,
    };
  }
  if (!existsSync(path.join(root, ".golem", "settings.json"))) {
    return {
      status: "not_wired",
      reason: `${root} has no .golem/settings.json — Golem was never initialised here (run \`golem init\`)`,
    };
  }
  if (!existsSync(path.join(root, ".claude"))) {
    return {
      status: "not_wired",
      reason: `${root} has no .claude/ directory — Claude Code is not wired into this project`,
    };
  }
  return { status: "ok" };
}

/**
 * Every known root, newest-used first, each checked live. A device list built
 * from this can safely offer only `reachability.status === "ok"` entries and
 * show the rest greyed out with their `reason` — never silently drop them,
 * since "why isn't my project here" is exactly the question item 6 answers.
 */
export async function listKnownProjects(
  userDir: string = defaultUserDir(),
): Promise<readonly KnownProjectStatus[]> {
  const file = await read(userDir);
  return file.projects
    .slice()
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .map((p) => ({ ...p, reachability: checkReachability(p.root) }));
}
