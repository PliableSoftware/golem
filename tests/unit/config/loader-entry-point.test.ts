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

/**
 * Source lines with COMMENTS blanked but all code kept, even when code follows a
 * comment on the same line (`/* x *\/ readFile(...)`) or precedes a trailing `//`.
 * A small scanner rather than a regex: strings and template literals are kept
 * verbatim (a path inside a string IS the thing being looked for), comment
 * markers inside strings are not comments, and `'` / `"` strings end at the line
 * break so one stray quote cannot swallow the rest of the file.
 */
function codeLines(file: string): { line: number; text: string }[] {
  return stripComments(readFileSync(file, "utf8"))
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }));
}

function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let mode: "code" | "block" | "line" | "'" | '"' | "`" = "code";
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "*") {
        mode = "block";
        out += "  ";
        i += 2;
      } else if (c === "/" && next === "/") {
        mode = "line";
        out += "  ";
        i += 2;
      } else {
        if (c === "'" || c === '"' || c === "`") mode = c;
        out += c;
        i += 1;
      }
    } else if (mode === "block") {
      if (c === "*" && next === "/") {
        mode = "code";
        out += "  ";
        i += 2;
      } else {
        out += c === "\n" ? "\n" : " ";
        i += 1;
      }
    } else if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += c;
      } else out += " ";
      i += 1;
    } else {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === mode) mode = "code";
      else if (c === "\n" && mode !== "`") mode = "code";
      i += 1;
    }
  }
  return out;
}

const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join("/");

/** One exempted line: the file, a pattern the line must match, and why it is not a settings READ. */
interface Exemption {
  readonly file: string;
  readonly line: RegExp;
  readonly reason: string;
}

/** The raw cascade. Only the loader, its single wrapper, and the barrel that re-exports it. */
const RAW_LOADER_EXEMPT: readonly Exemption[] = [
  { file: "config/loader.ts", line: /\bloadConfig\b/, reason: "defines it" },
  {
    file: "config/effective.ts",
    line: /\bloadConfig\b/,
    reason: "the one wrapper that adds the team layer",
  },
  {
    file: "config/index.ts",
    line: /export \{ loadConfig,/,
    reason: "re-exports it for the cascade's own tests; this guard polices production use",
  },
];

/**
 * Lines that name a `.golem` settings file or a resolved settings path. Per LINE, not per
 * file: exempting a whole file would let a new read slip in beside an old exemption.
 */
const SETTINGS_FILE_EXEMPT: readonly Exemption[] = [
  { file: "config/loader.ts", line: /./, reason: "the cascade's own file read" },
  { file: "config/paths.ts", line: /./, reason: "defines the paths" },
  {
    file: "config/index.ts",
    line: /^\s*(LOCAL_SETTINGS_FILE|SETTINGS_FILE|settingsFilePaths),$/,
    reason: "re-exports",
  },
  {
    file: "config/write-setting.ts",
    line: /settingsFilePaths/,
    reason: "writer: edits ONE scope file for `golem config set/unset`, never the merged view",
  },
  {
    file: "config/migrate-files.ts",
    line: /settingsFilePaths/,
    reason: "writer: version migration rewrites the local files",
  },
  {
    file: "portal/binding.ts",
    line: /path\.join\(projectDir, "\.golem", "settings\.json"\)/,
    reason:
      "`golem team unlink` must report what the PROJECT FILE says (not the resolved value) so it can remove it",
  },
  {
    file: "cli/persona-watcher.ts",
    line: /path\.join\(projectDir, "\.golem", "settings(\.local)?\.json"\)/,
    reason: "polls mtimes to trigger a reload (and the team cache dir); reads no value",
  },
  {
    file: "cli/init.ts",
    line: /path\.join\(projectDir, "\.golem", "settings(\.local)?\.json"\)/,
    reason:
      "init/uninit decide what to WRITE into those two files, so they must see only what the files hold: " +
      "`proxy.port` (explicit port, back-compat) and `proxy.upstream_base_url` (idempotency check) are read " +
      "RAW on purpose, because an effective read would persist env/team values into the local file. " +
      "The marker-presence check (line `golemSettingsPresent`) reads no value",
  },
  {
    file: "cli/init-hooks.ts",
    line: /"!\.golem\/settings\.json"/,
    reason: "a .gitignore line, not a read",
  },
  {
    file: "cli/init-vscode.ts",
    line: /"\.vscode", "settings\.json"/,
    reason: ".vscode/settings.json, a different file",
  },
  {
    file: "cli/claude-settings-target.ts",
    line: /^\s*(local|project): "settings(\.local)?\.json",$/,
    reason: "Claude Code's .claude/settings*.json names, not Golem's",
  },
  {
    file: "session/known-projects.ts",
    line: /settings\.json/,
    reason: "existence check of the marker file; reads no value",
  },
  {
    file: "cli/status-render.ts",
    line: /\.golem\/settings\.json present/,
    reason: "label text of the marker checkbox",
  },
  {
    file: "config/control-surface-types.ts",
    line: /settings(\.local)?\.json/,
    reason: "scope description strings shown to the user",
  },
  {
    file: "config/ui-model.ts",
    line: /settings(\.local)?\.json/,
    reason: "prose in setting descriptions",
  },
];

const files = walk(SRC);

/** Every non-comment code line matching `pattern` that no exemption covers. */
function offenders(pattern: RegExp, exempt: readonly Exemption[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const name = rel(file);
    for (const { line, text } of codeLines(file)) {
      if (!pattern.test(text)) continue;
      if (exempt.some((e) => e.file === name && e.line.test(text))) continue;
      out.push(`${name}:${line}: ${text.trim()}`);
    }
  }
  return out;
}

/** An exemption that matches no line any more is stale and must go. */
function staleExemptions(pattern: RegExp, exempt: readonly Exemption[]): string[] {
  return exempt
    .filter(
      (e) =>
        !files.some(
          (f) =>
            rel(f) === e.file &&
            codeLines(f).some(({ text }) => pattern.test(text) && e.line.test(text)),
        ),
    )
    .map((e) => `${e.file} ${e.line}`);
}

/**
 * Any spelling of a settings file: double or single quotes, a template literal, a path
 * constant, `settingsFilePaths`, or a resolved `files.user|project|local` handed to a reader
 * (e.g. `readFile(config.files.local)`).
 */
const SETTINGS_FILE_PATTERN =
  /settings(?:\.local)?\.json|\bSETTINGS_FILE\b|\bLOCAL_SETTINGS_FILE\b|\bsettingsFilePaths\b|\bfiles\.(?:user|project|local)\b|\bfiles\[\s*["'`]?(?:user|project|local)/;
const RAW_LOADER_PATTERN = /\bloadConfig\b/;

describe("one settings entry point (team-layer-everywhere)", () => {
  it("no production file outside the loader uses the raw `loadConfig`", () => {
    expect(
      offenders(RAW_LOADER_PATTERN, RAW_LOADER_EXEMPT),
      "use loadEffectiveConfig (src/config/effective.ts): the raw loadConfig skips the team layer",
    ).toEqual([]);
  });

  it("no production file hand-rolls a read of the .golem settings files", () => {
    expect(
      offenders(SETTINGS_FILE_PATTERN, SETTINGS_FILE_EXEMPT),
      "read settings through loadEffectiveConfig, or add an exemption for that exact line with a reason",
    ).toEqual([]);
  });

  it("every exemption still matches a line (no stale exemptions)", () => {
    expect(staleExemptions(RAW_LOADER_PATTERN, RAW_LOADER_EXEMPT)).toEqual([]);
    expect(staleExemptions(SETTINGS_FILE_PATTERN, SETTINGS_FILE_EXEMPT)).toEqual([]);
  });

  describe("comment stripping", () => {
    const code = (src: string): string => stripComments(src).trim();
    it("keeps code that follows a block comment on the same line", () => {
      expect(code("/* why */ readFile('.golem/settings.json')")).toContain("settings.json");
    });
    it("keeps code before a trailing line comment and drops the comment", () => {
      const out = code("const a = loadConfig(); // loadEffectiveConfig");
      expect(out).toContain("loadConfig()");
      expect(out).not.toContain("loadEffectiveConfig");
    });
    it("drops whole comment lines and multi-line block comments", () => {
      expect(code("/**\n * loadConfig\n */\nconst x = 1;")).not.toContain("loadConfig");
    });
    it("does not treat // inside a string as a comment", () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test is a template literal
      expect(code("const u = 'http://x'; readFile(`${d}/.golem/settings.json`);")).toContain(
        "settings.json",
      );
    });
  });

  describe("the detector itself", () => {
    const hits = (text: string): boolean => SETTINGS_FILE_PATTERN.test(text);
    it.each([
      `readFile(path.join(d, ".golem", "settings.json"))`,
      `readFile(path.join(d, '.golem', 'settings.local.json'))`,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test is a template literal
      "readFile(`${d}/.golem/settings.json`)",
      "await readFile(config.files.local, 'utf8')",
      "const p = settingsFilePaths({ projectDir });",
      "path.join(dir, LOCAL_SETTINGS_FILE)",
      "readFileSync(files['project'])",
    ])("flags %s", (text) => {
      expect(hits(text)).toBe(true);
    });
    it("does not flag unrelated code", () => {
      expect(hits("const settings = await loadEffectiveConfig({ projectDir });")).toBe(false);
    });
  });
});
