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

import { isRecord } from "../shared/json.js";

/** A Bash command is split into simple-command segments on these. */
const SEGMENT_SPLIT = /[;&|\n\r(){}`]|\$\(/;

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

function unquote(token: string): string {
  return token.replace(/["']/g, "");
}

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
 * what the segment is about: package runners, `sudo`/`env`/`time`, shells (`-c`).
 */
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
  "env",
  "command",
  "time",
  "nohup",
  "nice",
  "eval",
  "bash",
  "sh",
  "zsh",
  "dash",
  "node",
]);

/** Index of the program a simple command runs, past env assignments, wrappers and their flags. */
function commandPosition(tokens: readonly string[]): number {
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i] ?? "";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) continue;
    if (tok === "export") continue;
    if (i > 0 && tok.startsWith("-")) continue;
    if (WRAPPERS.has(executableName(tok))) continue;
    return i;
  }
  return -1;
}

function bashDenied(command: string): boolean {
  for (const segment of command.split(SEGMENT_SPLIT)) {
    const tokens = segment
      .split(/\s+/)
      .map(unquote)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) continue;

    for (const tok of tokens) {
      const env = /^(?:export\s+)?GOLEM_PROXY_BYPASS_ALL=(.*)$/i.exec(tok);
      if (env !== null && TRUTHY.has((env[1] ?? "").toLowerCase())) return true;
    }

    // Only a `golem` in COMMAND position counts: `grep -rn "golem off" docs` and
    // `echo golem off` name the phrase without running it, and an agent searching
    // the docs for it must not be denied.
    const at = commandPosition(tokens);
    if (at === -1 || !GOLEM_NAMES.has(executableName(tokens[at] ?? ""))) continue;
    const args = tokens.slice(at + 1);
    if (isGolemOff(args) || isConfigSetBypass(args)) return true;
  }
  return false;
}

/** Whether `text` writes `bypass_all` with anything other than literal `false`. */
function textSetsBypass(text: string): boolean {
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

function newTextOf(toolInput: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["content", "new_string"]) {
    const v = toolInput[key];
    if (typeof v === "string") out.push(v);
  }
  const edits = toolInput.edits;
  if (Array.isArray(edits)) {
    for (const e of edits) {
      if (isRecord(e) && typeof e.new_string === "string") out.push(e.new_string);
    }
  }
  return out;
}

/**
 * The deny reason when this tool call would set `proxy.bypass_all`, else
 * `undefined`. Pure: no I/O, no config, no autonomy level.
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
    return newTextOf(toolInput).some(textSetsBypass) ? BYPASS_DENY_REASON : undefined;
  }
  return undefined;
}
