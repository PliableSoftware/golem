/**
 * R13.3 — the hosted-session audit log: attribution before delivery.
 *
 * ADR-0007 invariant 4 says a turn nobody can attribute must not run. So every
 * relayed turn is written here **before** it is handed to the runner, and every
 * tool decision the host makes is written here as it is made.
 *
 * ## Why this is not `src/autonomy/log.ts`
 *
 * That log is tool-call shaped (`tool`, `action`, `level`, `decision`) and its
 * `decision` union is `allow | ask | defer` — the three things a *guest hook*
 * can emit. It is written from inside someone else's session by a hook process.
 *
 * This log records a different kind of fact: who said what, to which hosted
 * session, at what time, and what the host did about the tool calls that
 * followed. Squeezing turns into a tool-shaped record would mean a `tool` field
 * holding `"(turn)"`, and widening that union with `deny` would tell every
 * existing reader that guest hooks can now refuse — which they cannot. Two
 * logs, because there are two relationships. See `host-gate.ts` for the same
 * argument about the decision type.
 *
 * Append-only JSONL, one live file per project, bounded by ROTATION BY RENAME
 * so a long-lived session cannot fill a disk (DUST3.15, USER decision LOG,
 * 2026-10-09). Past {@link HOST_LOG_MAX_BYTES} the live file is renamed aside to
 * `host-log.<epoch-ms>-<pid>-<rand>.jsonl` and the next append starts a fresh
 * one; only the newest {@link HOST_LOG_KEEP_ROTATED} rotated files are kept.
 *
 * Nothing on the append path reads the file back and rewrites it. An earlier
 * trim-on-append did, without a lock, and lost concurrent appends — including
 * `turn` attribution lines, which ADR-0007 invariant 4 says must survive. A
 * rename moves the inode: an append already holding the old file lands in the
 * rotated file, and one that opens after lands in the new file. Either way the
 * line exists. The cost is that two writers can both decide to rotate; the
 * loser's rename finds nothing (ENOENT, ignored) or, rarely, renames a young
 * file early. That shortens retention; it never drops a line.
 *
 * Retention is a constant, not a setting: 5 MiB x (1 live + 3 rotated) caps the
 * trail near 20 MiB, far above what a session's turns and decisions produce.
 */

import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { renameWithRetry } from "../shared/win-fs-retry.js";
import type { HostDecision } from "./host-gate.js";

/** Rotate the live log aside once it grows past this many bytes. */
export const HOST_LOG_MAX_BYTES = 5 * 1024 * 1024;

/** Rotated files kept beside the live one; the oldest beyond this are deleted. */
export const HOST_LOG_KEEP_ROTATED = 3;

export interface HostLogRotation {
  readonly maxBytes?: number;
  readonly keep?: number;
}

/** Strictly increasing within this process, so two rotations in one ms still sort in order. */
let lastStamp = 0;

const ROTATED_RE = /^host-log\.(\d{13})-[^/\\]+\.jsonl$/;

export function hostLogPath(projectDir: string): string {
  return path.join(projectDir, ".golem", "state", "host-log.jsonl");
}

/** A turn relayed INTO a hosted session — written before the runner sees it. */
export interface HostTurnEntry {
  readonly kind: "turn";
  readonly ts: string;
  readonly sessionId: string;
  /**
   * Who authored it: a device id, or `"local"` for the CLI/dashboard. Never
   * optional — an unattributable turn is exactly what invariant 4 forbids.
   */
  readonly origin: string;
  /** The exact text relayed. Redacted transcripts live in the conversation store; this is the audit copy. */
  readonly text: string;
}

/** A tool call the host decided about. */
export interface HostDecisionEntry {
  readonly kind: "decision";
  readonly ts: string;
  readonly sessionId: string;
  readonly tool: string;
  readonly action: string;
  readonly decision: HostDecision;
  readonly reason: string;
}

/** A lifecycle event: started, stopped, crashed, parked. */
export interface HostLifecycleEntry {
  readonly kind: "lifecycle";
  readonly ts: string;
  readonly sessionId: string;
  readonly event: "started" | "stopped" | "crashed" | "parked" | "attached" | "detached";
  readonly detail?: string;
}

export type HostLogEntry = HostTurnEntry | HostDecisionEntry | HostLifecycleEntry;

/**
 * Append one entry. Awaited by callers that must not proceed until it lands —
 * notably {@link HostTurnEntry}, whose whole point is that it is written first.
 *
 * Rotation runs AFTER the line is durable and its failure is swallowed: a
 * housekeeping error must never turn into an unattributed turn.
 */
export async function appendHostLog(
  projectDir: string,
  entry: HostLogEntry,
  rotation: HostLogRotation = {},
): Promise<void> {
  const file = hostLogPath(projectDir);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
  try {
    await rotateIfLarge(
      file,
      rotation.maxBytes ?? HOST_LOG_MAX_BYTES,
      rotation.keep ?? HOST_LOG_KEEP_ROTATED,
    );
  } catch {
    // Retention is best-effort; the audit line above has already landed.
  }
}

async function statOrNull(file: string): Promise<{ size: number; ino: number } | null> {
  try {
    const st = await stat(file);
    return { size: st.size, ino: st.ino };
  } catch (err) {
    // A concurrent writer already rotated it away.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function rotateIfLarge(file: string, maxBytes: number, keep: number): Promise<void> {
  const measured = await statOrNull(file);
  if (measured === null || measured.size <= maxBytes) return;
  // Re-check right before the rename: if another writer rotated meanwhile, the path
  // now names a young file (different inode, or back under the threshold) and
  // renaming it would shorten retention for nothing. ino is 0 on some Windows
  // filesystems, where only the size check is meaningful. A rename is atomic on the
  // path and cannot be conditioned on identity, so a window of microseconds remains;
  // it costs early rotation, never a line.
  const now = await statOrNull(file);
  if (now === null || now.size <= maxBytes) return;
  if (measured.ino !== 0 && now.ino !== measured.ino) return;
  const dir = path.dirname(file);
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  const aside = path.join(
    dir,
    `host-log.${String(lastStamp).padStart(13, "0")}-${process.pid}-${randomBytes(4).toString("hex")}.jsonl`,
  );
  try {
    await renameWithRetry(file, aside);
  } catch (err) {
    // Another writer rotated first: nothing left to move.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const rotated = await listRotated(dir);
  for (const name of rotated.slice(0, Math.max(0, rotated.length - keep))) {
    await unlink(path.join(dir, name)).catch(() => undefined);
  }
}

/** Rotated file names, oldest first (the name leads with a fixed-width epoch). */
async function listRotated(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names.filter((n) => ROTATED_RE.test(n)).sort();
}

/**
 * Newest last. A malformed line is skipped rather than failing the read. When
 * the live file holds fewer than `limit` lines (just after a rotation) the
 * newest rotated files fill the rest, so a rotation never makes the trail
 * look empty.
 */
export async function readHostLog(
  projectDir: string,
  limit = 200,
): Promise<readonly HostLogEntry[]> {
  const live = hostLogPath(projectDir);
  const dir = path.dirname(live);
  let lines: string[] = [];
  // A rotation can land between listing and reading (a file renamed away, or a new
  // rotated name appearing). Re-list after reading and retry when the set changed.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const listed = await listRotated(dir);
    const files = [...listed.map((n) => path.join(dir, n)), live];
    lines = [];
    let vanished = false;
    for (let i = files.length - 1; i >= 0 && lines.length < limit; i -= 1) {
      let raw: string;
      try {
        raw = await readFile(files[i] as string, "utf8");
      } catch {
        if (files[i] !== live) vanished = true;
        continue;
      }
      lines = [...raw.split("\n").filter((l) => l.trim() !== ""), ...lines];
    }
    const after = await listRotated(dir);
    const stable = after.length === listed.length && after.every((n, i) => n === listed[i]);
    if (stable && !vanished) break;
  }
  const out: HostLogEntry[] = [];
  for (const line of lines.slice(-limit)) {
    try {
      out.push(JSON.parse(line) as HostLogEntry);
    } catch {
      // A truncated final line (a kill mid-append) is expected, not exceptional.
    }
  }
  return out;
}
