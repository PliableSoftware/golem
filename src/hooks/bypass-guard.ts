/**
 * DUSTSEC.3 (USER decision R4) — the PreToolUse deny for turning redaction off.
 *
 * ADR-0004 makes `proxy.bypass_all` CLI-only: persisted, never a dial, set by the
 * human. The MCP setter refuses it (`src/mcp/deps.ts`), but an agent's own Bash
 * tool could still run `golem off`. This is the guard that closes that, and it is
 * a REDACTION guard, not an autonomy rule: the hook runs it before the autonomy
 * gate, so it holds at every level (including `manual`) and whether or not the
 * gate is enabled.
 *
 * WHAT IS CAUGHT (and so what the `golem-bypass` skill may claim):
 *  - Bash: `golem off` (any wrapper that leaves the token stream readable:
 *    leading env assignments, `npx`/`pnpm dlx`, a path or `@scope/` prefix,
 *    `bash -c '…'`, and any of `;` `&&` `||` `|` `&` newline, `$(…)`, backticks);
 *  - Bash: `golem config set` naming `proxy.bypass_all`, or `proxy` as a whole
 *    object (which could carry it);
 *  - Bash: a `GOLEM_PROXY_BYPASS_ALL=<truthy>` assignment (the env layer);
 *  - Write / Edit / MultiEdit of a `.json` file under a `.golem` directory whose
 *    new text names `bypass_all` with anything but `false`.
 *
 * WHAT IS NOT CAUGHT, said plainly rather than implied: a shell that writes a
 * settings file by other means (`echo … >`, `jq`, `sed -i`, a script), an
 * obfuscated or aliased command (`g=golem; $g off`, base64, a binary renamed
 * away from `golem`), and a process the agent was never going to need a tool for.
 * An agent with arbitrary shell has process authority; this deny stops the
 * documented spellings and the casual path, it is not a sandbox.
 *
 * Fail-safe direction: this only ever DENIES. It never emits `allow`, and the
 * caller treats a throw here as "no decision" (the native prompt), never as a
 * pass to the autonomy gate that follows.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isRecord } from "../shared/json.js";

/** The executable names `golem` goes by once a path, scope, version and extension are stripped. */
const GOLEM_NAMES: ReadonlySet<string> = new Set(["golem", "golem-run"]);

const TRUTHY = new Set(["true", "1", "yes", "on"]);

/** The reason attached to every deny from this guard. Names the setting, per R4. */
export const BYPASS_DENY_REASON =
  "Golem: denied. This would set proxy.bypass_all, which turns REDACTION off so " +
  "secrets and PII reach the upstream unredacted. bypass_all is CLI-only " +
  "(ADR-0004): it is not an agent action. Ask the user to run `golem off` in " +
  "their own terminal if they want it. To stop compression but keep redaction, " +
  "`golem compression off` is allowed.";

/** `/usr/bin/golem`, `C:\x\golem.cmd`, `@pliable/golem@1.2`, `golem-run@latest` → the bare name. */
function executableName(token: string): string {
  const base = token.split(/[\\/]/).pop() ?? token;
  const noVersion = base.replace(/@[^@]*$/, "");
  return noVersion.replace(/\.(?:cmd|exe|js|mjs|cjs|ps1|sh)$/i, "").toLowerCase();
}

/** True when `args` (the tokens after a `golem` word) turn the master switch off. */
function isGolemOff(args: readonly string[]): boolean {
  let prevWasFlag = false;
  for (const tok of args) {
    if (tok.startsWith("-")) {
      // `--flag=value` carries its own value; a bare flag may take the next token.
      prevWasFlag = !tok.includes("=");
      continue;
    }
    if (tok.toLowerCase() === "off") return true; // first subcommand, or a flag's "value"
    if (prevWasFlag) {
      prevWasFlag = false; // a flag value, e.g. `--dir /x`
      continue;
    }
    return false; // the real subcommand, and it is not `off`
  }
  return false;
}

/** True when `args` are `config … set …` that names `bypass_all`, or writes `proxy` whole. */
function isConfigSetBypass(args: readonly string[]): boolean {
  const lower = args.map((a) => a.toLowerCase());
  const configAt = lower.indexOf("config");
  if (configAt === -1) return false;
  const setAt = lower.indexOf("set", configAt + 1);
  if (setAt === -1) return false;
  const rest = lower.slice(setAt + 1);
  return rest.some((a) => a.includes("bypass_all") || a === "proxy");
}

/**
 * Words that run the next word as a command, so the program they launch is still
 * what the segment is about: package runners, `sudo`/`env`/`time`/`timeout`/`nice`,
 * `xargs`, shells (`-c`).
 */
const SHELLS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "dash"]);
const WRAPPERS: ReadonlySet<string> = new Set([
  "npx",
  "pnpx",
  "bunx",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "dlx",
  "exec",
  "x",
  "sudo",
  "doas",
  "env",
  "command",
  "time",
  "timeout",
  "nohup",
  "nice",
  "ionice",
  "stdbuf",
  "setsid",
  "xargs",
  "eval",
  "node",
  ...SHELLS,
]);

/** Flags whose NEXT token is their value, per wrapper: that value is not the program. */
const WRAPPER_VALUE_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["sudo", new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U", "--user", "--group"])],
  ["doas", new Set(["-u", "-C"])],
  ["nice", new Set(["-n", "--adjustment"])],
  ["ionice", new Set(["-c", "-n", "-p", "--class", "--classdata"])],
  ["timeout", new Set(["-s", "-k", "--signal", "--kill-after"])],
  ["env", new Set(["-u", "-C", "-S", "--unset", "--chdir"])],
  ["stdbuf", new Set(["-i", "-o", "-e"])],
  ["xargs", new Set(["-n", "-P", "-I", "-L", "-s", "-d", "-E", "-a", "-l"])],
  ["npx", new Set(["-p", "--package"])],
  // `bash -o pipefail -c '…'`: `-o`/`-O` take a value before `-c`; `+o` is the unset form.
  ...[...SHELLS].map((sh): [string, ReadonlySet<string>] => [
    sh,
    new Set(["-o", "+o", "-O", "+O", "--rcfile", "--init-file"]),
  ]),
]);

interface CommandPosition {
  at: number;
  viaXargs: boolean;
  /** The command string a shell `-c`, `eval` or `env -S` would run, when this segment is one. */
  inner: string | null;
  /** The last wrapper word seen, e.g. `bash` in `sudo bash -o pipefail`. */
  wrapper: string | null;
}

/** Where the program a simple command runs sits, past env assignments, wrappers and their flags. */
function commandPosition(tokens: readonly string[]): CommandPosition | null {
  let wrapper: string | null = null;
  let viaXargs = false;
  let shellC = false;
  let isEval = false;
  let wantDuration = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i] ?? "";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) continue;
    if (tok === "export") continue;
    if (wrapper === "env" && (tok === "-S" || tok === "--split-string")) {
      // `env -S 'cmd args'` splits its value into a command line and runs it.
      const inner = tokens.slice(i + 1).join(" ");
      return { at: tokens.length, viaXargs, inner, wrapper };
    }
    if (wrapper === "env" && /^(?:--split-string=|-S.)/.test(tok)) {
      const value = tok.startsWith("--") ? tok.slice("--split-string=".length) : tok.slice(2);
      const inner = [value, ...tokens.slice(i + 1)].join(" ");
      return { at: tokens.length, viaXargs, inner, wrapper };
    }
    const unsetFlag = wrapper !== null && SHELLS.has(wrapper) && /^\+[A-Za-z]$/.test(tok);
    if ((i > 0 && tok.startsWith("-")) || unsetFlag) {
      if (wrapper !== null && SHELLS.has(wrapper) && /^-[A-Za-z]*c$/.test(tok)) shellC = true;
      if (wrapper !== null && !tok.includes("=") && WRAPPER_VALUE_FLAGS.get(wrapper)?.has(tok)) {
        i += 1; // the flag's value, e.g. `nice -n 5`, `sudo -u me`
      }
      continue;
    }
    const name = executableName(tok);
    if (WRAPPERS.has(name)) {
      wrapper = name;
      if (name === "xargs") viaXargs = true;
      if (name === "timeout") wantDuration = true;
      if (name === "eval") isEval = true;
      continue;
    }
    if (wantDuration && /^\d+(?:\.\d+)?[smhd]?$/.test(tok)) {
      wantDuration = false;
      continue;
    }
    const rest = tokens.slice(i);
    const inner = shellC || isEval ? (rest.length === 1 ? (rest[0] ?? "") : rest.join(" ")) : null;
    return { at: i, viaXargs, inner, wrapper };
  }
  return wrapper === null ? null : { at: tokens.length, viaXargs, inner: null, wrapper };
}

/** True for a shell with no script or `-c` operand: it reads its commands from stdin. */
function readsStdin(words: readonly string[]): boolean {
  const pos = commandPosition(words);
  return pos !== null && pos.wrapper !== null && SHELLS.has(pos.wrapper) && pos.at >= words.length;
}

interface Heredoc {
  delimiter: string;
  /** `<<-`: leading tabs are stripped from the body and the delimiter line. */
  stripTabs: boolean;
  /** The heredoc is stdin of a shell, so its body is a script rather than data. */
  feedsShell: boolean;
  /** Index just past the delimiter word on the operator's line. */
  end: number;
}

/** Parse the `[-]DELIM` after a `<<` at `from`; `null` when no delimiter word follows. */
function readHeredocStart(command: string, from: number, feedsShell: boolean): Heredoc | null {
  let i = from;
  const stripTabs = command[i] === "-";
  if (stripTabs) i += 1;
  while (command[i] === " " || command[i] === "\t") i += 1;
  let delimiter = "";
  let quote: string | null = null;
  const start = i;
  for (; i < command.length; i += 1) {
    const ch = command[i] ?? "";
    if (quote !== null) {
      if (ch === quote) quote = null;
      else delimiter += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "\\") {
      // `<<\EOF` quotes the delimiter too.
    } else if (/[\s;&|()<>]/.test(ch)) {
      break;
    } else {
      delimiter += ch;
    }
  }
  return i === start || delimiter === "" ? null : { delimiter, stripTabs, feedsShell, end: i };
}

/** The body lines from `from` up to the delimiter line; `end` is the start of the line after it. */
function readHeredocBody(
  command: string,
  from: number,
  doc: Heredoc,
): { text: string; end: number } {
  let lineStart = from;
  while (lineStart < command.length) {
    const nl = command.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? command.length : nl;
    let line = command.slice(lineStart, lineEnd);
    if (doc.stripTabs) line = line.replace(/^\t+/, "");
    if (line.replace(/\r$/, "") === doc.delimiter) {
      return { text: command.slice(from, lineStart), end: nl === -1 ? command.length : nl + 1 };
    }
    lineStart = nl === -1 ? command.length : nl + 1;
  }
  return { text: command.slice(from), end: command.length };
}

/**
 * Index of the `)` closing a `$(` whose body starts at `from`, skipping nested
 * quotes, parentheses and heredoc bodies (a commit message body may hold a `)`).
 */
function findSubstEnd(command: string, from: number): number {
  let depth = 1;
  const pending: Heredoc[] = [];
  for (let i = from; i < command.length; i += 1) {
    const ch = command[i] ?? "";
    if (ch === "\\") {
      i += 1;
    } else if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      if (close === -1) return -1;
      i = close;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < command.length && command[j] !== '"') j += command[j] === "\\" ? 2 : 1;
      i = j;
    } else if (ch === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      const doc = readHeredocStart(command, i + 2, false);
      if (doc !== null) {
        pending.push(doc);
        i = doc.end - 1;
      }
    } else if (ch === "\n" && pending.length > 0) {
      for (const doc of pending.splice(0)) i = readHeredocBody(command, i + 1, doc).end - 1;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Split a command into simple-command segments of words, quote-aware: a `|`, `;`
 * or `(` inside quotes is text, not a boundary (`grep -E "x|golem off" docs`,
 * `git commit -m "docs (golem off)"`). Quotes are removed from the words. A
 * `$(…)` or backtick body inside double quotes DOES run, so it is returned in
 * `nested` to be judged as a command of its own.
 */
function splitCommand(command: string): {
  segments: string[][];
  piped: boolean[];
  nested: string[];
} {
  const segments: string[][] = [];
  /** Parallel to `segments`: true when the segment's stdin is the previous one's stdout. */
  const piped: boolean[] = [];
  const nested: string[] = [];
  let words: string[] = [];
  let cur = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;
  let pipeNext = false;
  let hereString = false;
  const heredocs: Heredoc[] = [];
  const endWord = () => {
    if (inWord) {
      // `bash <<< 'golem off'`: the here-string is the command line a shell would run.
      if (hereString && readsStdin(words)) nested.push(cur);
      hereString = false;
      words.push(cur);
    }
    cur = "";
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0) {
      segments.push(words);
      piped.push(pipeNext);
      pipeNext = false;
    }
    words = [];
  };
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i] ?? "";
    const next = command[i + 1] ?? "";
    if (quote === null && c === "<" && next === "<") {
      endWord();
      if (command[i + 2] === "<") {
        hereString = true;
        i += 2;
        continue;
      }
      const doc = readHeredocStart(command, i + 2, readsStdin(words));
      if (doc !== null) {
        heredocs.push(doc);
        i = doc.end - 1;
        continue;
      }
    }
    if (quote === null && c === "\n" && heredocs.length > 0) {
      endSegment();
      for (const doc of heredocs.splice(0)) {
        const body = readHeredocBody(command, i + 1, doc);
        if (doc.feedsShell) nested.push(body.text);
        i = body.end - 1;
      }
      continue;
    }
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
      continue;
    }
    if (quote === '"') {
      if (c === "\\" && next !== "") {
        cur += next;
        i += 1;
      } else if (c === '"') {
        quote = null;
      } else if (c === "`" || (c === "$" && next === "(")) {
        const close = c === "`" ? "`" : ")";
        const start = i + (c === "`" ? 1 : 2);
        const end = c === "`" ? command.indexOf(close, start) : findSubstEnd(command, start);
        const stop = end === -1 ? command.length : end;
        nested.push(command.slice(start, stop));
        cur += command.slice(i, stop);
        i = stop - 1;
      } else {
        cur += c;
      }
      continue;
    }
    // A backslash escapes only a shell-special next char; elsewhere it is a Windows path separator.
    if (c === "\\" && next !== "" && /[\s"'\\;&|(){}`$]/.test(next)) {
      if (next === "\n") endWord();
      else {
        cur += next;
        inWord = true;
      }
      i += 1;
    } else if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === " " || c === "\t") {
      endWord();
    } else if (/[;&|\n\r(){}`]/.test(c)) {
      endSegment();
      // `a | b` pipes; `a || b` does not.
      if (c === "|" && next === "|") i += 1;
      else if (c === "|") pipeNext = true;
    } else if (c === "$" && next === "(") {
      endSegment();
      i += 1;
    } else {
      cur += c;
      inWord = true;
    }
  }
  endSegment();
  return { segments, piped, nested };
}

function bashDenied(command: string): boolean {
  const { segments, piped, nested } = splitCommand(command);
  if (nested.some(bashDenied)) return true;
  for (const [index, tokens] of segments.entries()) {
    // `echo golem off | sh`: the previous stage's text is what the shell runs.
    const feeder = segments[index - 1];
    if (piped[index] === true && feeder !== undefined && readsStdin(tokens)) {
      for (let from = 0; from < feeder.length; from += 1) {
        // `printf` turns a literal `\n` into the newline the shell then splits on.
        const text = feeder
          .slice(from)
          .join(" ")
          .replace(/\\[nt]/g, "\n");
        if (bashDenied(text)) return true;
      }
    }
    for (const tok of tokens) {
      const env = /^(?:export\s+)?GOLEM_PROXY_BYPASS_ALL=(.*)$/i.exec(tok);
      if (env !== null && TRUTHY.has((env[1] ?? "").toLowerCase())) return true;
    }

    // Only a `golem` in COMMAND position counts: `grep -rn "golem off" docs` and
    // `echo golem off` name the phrase without running it, and an agent searching
    // the docs for it must not be denied.
    const pos = commandPosition(tokens);
    if (pos === null) continue;
    if (pos.inner !== null && bashDenied(pos.inner)) return true;
    if (!GOLEM_NAMES.has(executableName(tokens[pos.at] ?? ""))) continue;
    const args = tokens.slice(pos.at + 1);
    if (isGolemOff(args) || isConfigSetBypass(args)) return true;
    // `echo off | xargs golem`: the subcommand arrives on stdin, so a bare or
    // placeholder-only invocation is judged by whether `off` appears anywhere.
    if (pos.viaXargs && args.every((a) => a.startsWith("-") || a.startsWith("{"))) {
      if (segments.some((seg) => seg.some((w) => /^off$/i.test(w)))) return true;
    }
  }
  return false;
}

/** True when a parsed JSON value holds a `bypass_all` key (at any depth) that is not `false`. */
function jsonSetsBypass(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(jsonSetsBypass);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, v]) => {
    if (key.toLowerCase() === "bypass_all") {
      return !(v === false || (typeof v === "string" && v.toLowerCase() === "false"));
    }
    return jsonSetsBypass(v);
  });
}

/**
 * Whether `text` writes `bypass_all` with anything other than literal `false`.
 * Valid JSON is judged as the loader reads it (an escaped key `bypass_all`
 * is the same key); anything else falls back to the raw-text check.
 */
function textSetsBypass(text: string): boolean {
  try {
    return jsonSetsBypass(JSON.parse(text));
  } catch {
    // not JSON: judge the raw text
  }
  const mentions = text.match(/bypass_all/gi);
  if (mentions === null) return false;
  const pattern = /bypass_all["']?\s*[:=]\s*["']?([^\s,}"']*)/gi;
  let parsed = 0;
  for (const m of text.matchAll(pattern)) {
    parsed += 1;
    if ((m[1] ?? "").toLowerCase() !== "false") return true;
  }
  // A mention we could not read a value from: deny rather than guess.
  return parsed < mentions.length;
}

function isGolemJsonPath(filePath: string): boolean {
  const normal = filePath.replace(/\\/g, "/");
  return /\.json$/i.test(normal) && /(?:^|\/)\.golem\//.test(normal);
}

/** Apply one Edit's replacement; `undefined` when `old_string` is not in `text`. */
function applyEdit(text: string, edit: Record<string, unknown>): string | undefined {
  const oldS = edit.old_string;
  const newS = edit.new_string;
  if (typeof oldS !== "string" || typeof newS !== "string") return undefined;
  if (oldS === "") return newS;
  if (!text.includes(oldS)) return undefined;
  return edit.replace_all === true ? text.split(oldS).join(newS) : text.replace(oldS, () => newS);
}

/**
 * The text(s) a Write/Edit/MultiEdit would leave in the settings file. A Write is
 * its content; an Edit is judged on the file AFTER the edit is applied to what is
 * on disk, because flipping the value alone names no setting in the new text.
 * When the result cannot be computed a bare mention is returned, which
 * {@link textSetsBypass} refuses to read, so the call fails closed.
 */
function resultingTexts(
  toolName: string,
  filePath: string,
  toolInput: Record<string, unknown>,
): string[] {
  if (toolName === "Write") {
    return typeof toolInput.content === "string" ? [toolInput.content] : [];
  }
  const cannotCompute = ["bypass_all"];
  const edits: unknown[] = Array.isArray(toolInput.edits) ? toolInput.edits : [toolInput];
  let text: string;
  try {
    text = readFileSync(resolve(filePath), "utf8");
  } catch {
    return cannotCompute;
  }
  for (const e of edits) {
    if (!isRecord(e)) return cannotCompute;
    const next = applyEdit(text, e);
    if (next === undefined) return cannotCompute;
    text = next;
  }
  return [text];
}

/**
 * The deny reason when this tool call would set `proxy.bypass_all`, else
 * `undefined`. No config, no autonomy level; the only I/O is reading the settings file an
 * Edit/MultiEdit targets, to judge the content it would leave behind.
 */
export function bypassGuardReason(toolName: string, toolInput: unknown): string | undefined {
  if (!isRecord(toolInput)) return undefined;
  if (toolName === "Bash") {
    const command = toolInput.command;
    return typeof command === "string" && bashDenied(command) ? BYPASS_DENY_REASON : undefined;
  }
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    const filePath = toolInput.file_path;
    if (typeof filePath !== "string" || !isGolemJsonPath(filePath)) return undefined;
    return resultingTexts(toolName, filePath, toolInput).some(textSetsBypass)
      ? BYPASS_DENY_REASON
      : undefined;
  }
  return undefined;
}
