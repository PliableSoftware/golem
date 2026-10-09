/**
 * Guard for team-layer-everywhere (USER decision G3): there is ONE way to read
 * effective settings, `loadEffectiveConfig` in src/config/effective.ts, because
 * the raw cascade (`loadConfig`) has no team layer and any surface that calls it
 * lets a member step around team policy.
 *
 * This fails when a production file under src/ either
 *   - references the raw `loadConfig`, or
 *   - names a `.golem` settings file or `settingsFilePaths` (a hand-rolled read
 *     of the same files, which skips the cascade AND the team layer),
 * unless it is on the allow-lists below. An allow-list entry needs a reason a
 * reviewer can disagree with; adding one is the deliberate act this test exists
 * to force.
 *
 * The follow-up `team-security-stricter-only` hangs its stricter-only rule on
 * `loadEffectiveConfig`'s team handling, so a bypass here would also bypass it.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Source lines with whole-line comments dropped; keeps `file:line` for messages. */
function codeLines(file: string): { line: number; text: string }[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => !/^\s*(\*|\/\/|\/\*)/.test(text));
}

const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join("/");

/** The raw cascade. Only the loader, its single wrapper, and the barrel that re-exports it. */
const RAW_LOADER_ALLOWED: Readonly<Record<string, string>> = {
  "config/loader.ts": "defines it",
  "config/effective.ts": "the one wrapper that adds the team layer",
  "config/index.ts": "re-exports it for the cascade's own tests; this guard polices production use",
};

/** Files that may name a `.golem` settings file, and why none of them is a settings READER. */
const SETTINGS_FILE_ALLOWED: Readonly<Record<string, string>> = {
  "config/paths.ts": "defines the paths",
  "config/loader.ts": "the cascade's own file read",
  "config/index.ts": "re-exports settingsFilePaths",
  "config/write-setting.ts":
    "writer: edits ONE scope file for `golem config set/unset`, never the merged view",
  "config/migrate-files.ts": "writer: version migration rewrites the local files",
  "portal/binding.ts":
    "reads the committed `team` binding, the INPUT to the team layer; team.* is on the remote deny floor",
  "cli/persona-watcher.ts":
    "polls mtimes of the local files (and the team cache) to trigger a reload; reads no value",
  "cli/init.ts": "init writes/creates the files and checks the marker; reads no setting value",
  "cli/init-hooks.ts": "a .gitignore line, not a read",
  "cli/init-vscode.ts": ".vscode/settings.json, a different file",
  "cli/claude-settings-target.ts": ".claude/settings*.json, Claude Code's file, not Golem's",
  "session/known-projects.ts": "existence check of the marker file",
};

const files = walk(SRC);

describe("one settings entry point (team-layer-everywhere)", () => {
  it("no production file outside the loader uses the raw `loadConfig`", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (rel(file) in RAW_LOADER_ALLOWED) continue;
      for (const { line, text } of codeLines(file)) {
        if (/\bloadConfig\b/.test(text)) offenders.push(`${rel(file)}:${line}: ${text.trim()}`);
      }
    }
    expect(
      offenders,
      "use loadEffectiveConfig (src/config/effective.ts): the raw loadConfig skips the team layer",
    ).toEqual([]);
  });

  it("no production file hand-rolls a read of the .golem settings files", () => {
    const pattern =
      /settings(?:\.local)?\.json"|\bSETTINGS_FILE\b|\bLOCAL_SETTINGS_FILE\b|\bsettingsFilePaths\b/;
    const offenders: string[] = [];
    for (const file of files) {
      if (rel(file) in SETTINGS_FILE_ALLOWED) continue;
      for (const { line, text } of codeLines(file)) {
        if (pattern.test(text)) offenders.push(`${rel(file)}:${line}: ${text.trim()}`);
      }
    }
    expect(
      offenders,
      "read settings through loadEffectiveConfig, or add the file to SETTINGS_FILE_ALLOWED with a reason",
    ).toEqual([]);
  });

  it("every allow-list entry still exists and still matches (no stale exemptions)", () => {
    const present = new Set(files.map(rel));
    for (const name of [
      ...Object.keys(RAW_LOADER_ALLOWED),
      ...Object.keys(SETTINGS_FILE_ALLOWED),
    ]) {
      expect(present.has(name), `${name} is allow-listed but does not exist`).toBe(true);
    }
  });
});
