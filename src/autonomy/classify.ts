/**
 * R5.4 — action classifier (conservative allow-list).
 *
 * Governing rule (ADR-0002): anything NOT positively recognized as read/write
 * is `unknown`, and `unknown` is never auto-allowed. Bash is `unknown` unless it
 * matches the positive safe-read allow-list; destructive/outward patterns only
 * ever ESCALATE the class, never downgrade it.
 */

/** Risk class of a pending tool call, least→most gated. */
export type ActionClass = "read" | "write" | "destructive" | "outward" | "unknown";

/** Tools that only read (no mutation, no outward side effect). */
const READ_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "NotebookRead",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  // Golem read-only MCP tools (short verb names, Decision 27). `level` was
  // never here — it wrote the persistent slider, and R11.1 retired both.
  "mcp__golem__search",
  "mcp__golem__fetch",
  "mcp__golem__stats",
  "mcp__golem__expand",
  "mcp__golem__devices",
  "mcp__golem__wiki_read",
  // snooze just WAITS (no read/write/outward side effect) — harmless to auto-allow.
  "mcp__golem__snooze",
]);

/** Tools that write locally (files / local drafts) but nothing outward. */
const WRITE_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "mcp__golem__coder",
  "mcp__golem__ingest",
]);

/** Tools that reach OUTSIDE the machine / are hard to reverse. Always gated. */
const OUTWARD_TOOLS = new Set(["mcp__golem__wiki_upsert"]);

/**
 * `git branch` listing forms only. A ref after `--contains`/`--merged`/... is a
 * filter, and `--sort` takes a key; neither creates or deletes anything. A bare
 * name, `-m`, `-f`, `-d`/`-D` never match, so they stay gated or destructive.
 */
const GIT_REF = String.raw`[\w./@^~][\w./@^~-]*`;
const GIT_BRANCH_LIST_FLAG = [
  String.raw`-a|-r|-v|-vv|-i|--all|--remotes|--verbose|--list|-l|--show-current`,
  String.raw`--(?:no-)?(?:contains|merged)(?:\s+${GIT_REF})?`,
  String.raw`--points-at\s+${GIT_REF}`,
  String.raw`--sort(?:=|\s+)-?[\w:.-]+`,
].join("|");
const GIT_BRANCH_LIST_RE = new RegExp(
  String.raw`^git\s+branch(?:\s+(?:${GIT_BRANCH_LIST_FLAG}))*\s*$`,
);

/** Bash commands safe to treat as read-only (exact leading-token / phrase match). */
const SAFE_BASH = [
  /^ls(\s|$)/,
  /^cat\s/,
  /^pwd(\s|$)/,
  /^echo\s/,
  /^head\s/,
  /^tail\s/,
  /^wc\s/,
  /^which\s/,
  /^git\s+(status|diff|log|show|remote\s+-v)(\s|$)/,
  // `git branch` creates, renames and deletes branches, so only the listing
  // forms are read. Anything else (`-D`, `-m`, a bare branch name) is gated.
  GIT_BRANCH_LIST_RE,
  /^npm\s+(test|run\s+(test|lint|typecheck|format:check))(\s|$)/,
  /^(npx\s+)?(tsc|vitest|biome)(\s|$)/,
  /^node\s+--version/,
];

/** Bash patterns that make a command DESTRUCTIVE (local data loss). */
const DESTRUCTIVE_BASH = [
  /\brm\s+-[a-z]*[rf]/i,
  // R8.9: the change ledger's write half. `restore`/`undo` overwrite and delete
  // worktree files; `drop`/`prune` destroy snapshots. The CLI asks too, but this
  // is the gate the task's brief requires: destructive is in ADR-0002's
  // never-auto set, so no autonomy level can approve it for the agent.
  /\bgolem\s+(checkpoint|cp)\s+(restore|undo|drop|prune)\b/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+checkout\s+--\s/i,
  // Branch deletion (`-d`, `-D`, `--delete`, in any flag position): local data
  // loss, and `-D` skips the merged check.
  /\bgit\s+branch\s+(?:\S+\s+)*(?:-[a-z]*d[a-z]*|--delete)(?=\s|$)/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\btruncate\b/i,
  /\bdrop\s+table\b/i,
  /\bdel\s+\/[a-z]/i,
  /\brmdir\s+\/s/i,
  /\b>\s*\/dev\/sd/i,
];

/** Bash patterns that make a command OUTWARD (leaves the machine / publishes). */
const OUTWARD_BASH = [
  /\bgit\s+push\b/i,
  /\bgh\s+(pr|release|repo)\b/i,
  /\bnpm\s+publish\b/i,
  /\b(curl|wget)\b.*(-X\s*(POST|PUT|DELETE|PATCH)|--data|-d\s)/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\brsync\b.*::/i,
  /\bdeploy\b/i,
  /\bkubectl\s+(apply|delete)\b/i,
  /\bdocker\s+push\b/i,
  /\bterraform\s+apply\b/i,
];

/**
 * Shell metacharacters that void a safe-read classification: redirection can
 * truncate/overwrite files (`echo x > ~/.bashrc` leads with a "safe" token),
 * and separators/substitution can smuggle an arbitrary second command past a
 * safe-looking prefix (`ls -la; anything`). The destructive/outward pattern
 * lists only catch their specific shapes, so a command that composes at all is
 * `unknown` (gated), never `read`. `<` (input redirection) stays allowed.
 */
const SHELL_COMPOSITION_RE = /[;&|>`\n\r]|\$\(/;

/**
 * Flags that make an otherwise read-only safe-listed command WRITE to disk:
 * linter autofix (`biome check --write`, `--fix`, `--apply`), snapshot update
 * (`vitest -u`), and `--output=<path>` on the git diff family. Checked with a
 * build tool's quotes removed (data quotes blanked otherwise), only for commands that matched {@link SAFE_BASH}; the
 * result is `write`, never `read`.
 */
const WRITE_FLAG_RE =
  /(?:^|\s)(?:--write|--fix|--fix-type|--apply|--apply-unsafe|--unsafe|--output|--output-file|--outfile|--out-dir|--outdir|--update|--update-snapshots?|--updateSnapshot)(?=[\s=]|$)/i;
const VITEST_UPDATE_RE = /^(?:npx\s+)?(?:vitest|npm\s+(?:run\s+)?test)\b.*\s-u(?=\s|$)/;
/** Commands whose arguments are all flags/paths for a build tool, so a quoted flag still reaches it. */
const TOOL_COMMAND_RE = /^(?:npx\s+)?(?:tsc|vitest|biome|npm|git)(?:\s|$)/;
/** Split a command into the words a shell would hand the program: quotes removed, escapes resolved. */
function shellWords(cmd: string): string[] {
  const words: string[] = [];
  let cur = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < cmd.length; i += 1) {
    const c = cmd[i] ?? "";
    const next = cmd[i + 1] ?? "";
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
    } else if (quote === '"') {
      if (c === "\\" && /["\\$`]/.test(next)) {
        cur += next;
        i += 1;
      } else if (c === '"') quote = null;
      else cur += c;
    } else if (c === "\\" && next !== "") {
      cur += next; // an unquoted backslash escapes any char: `--outpu\t` is `--output`
      inWord = true;
      i += 1;
    } else if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) words.push(cur);
      cur = "";
      inWord = false;
    } else {
      cur += c;
      inWord = true;
    }
  }
  if (inWord) words.push(cur);
  return words;
}

/** `git` options whose NEXT word is a search term or name, never a flag (`git log --grep "--fix"`). */
const GIT_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--grep",
  "--author",
  "--committer",
  "--since",
  "--until",
  "--after",
  "--before",
  "-S",
  "-G",
  "-e",
]);

/** Words of a git command that git itself would read as options (not values, not paths after `--`). */
function gitOptionWords(words: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i] ?? "";
    if (w === "--") break;
    if (GIT_VALUE_FLAGS.has(w)) {
      i += 1; // the value
      continue;
    }
    out.push(w);
  }
  return out;
}

function writesToDisk(cmd: string): boolean {
  if (!TOOL_COMMAND_RE.test(cmd)) {
    const seen = blankQuoted(cmd);
    return WRITE_FLAG_RE.test(seen) || VITEST_UPDATE_RE.test(seen);
  }
  // A tool sees `"--write"` as `--write` (the shell strips the quotes), so the flag
  // is judged on the words the program receives; for `cat '--write'` it is data.
  const words = shellWords(cmd);
  const isGit = (words[0] === "npx" ? words[1] : words[0]) === "git";
  const seen = (isGit ? gitOptionWords(words) : words).join(" ");
  return WRITE_FLAG_RE.test(seen) || VITEST_UPDATE_RE.test(seen);
}

function bashCommand(input: unknown): string | null {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const c = (input as Record<string, unknown>).command;
    if (typeof c === "string") return c;
  }
  return null;
}

/**
 * Output-compacting wrappers that rewrite a Bash command in front of Golem
 * (R8.12, spec Decision 53 tier-3a peers — currently RTK, whose PreToolUse hook
 * turns `git status` into `rtk git status`).
 *
 * Why this list exists: the danger patterns above are `\b`-anchored, so they
 * already see straight through a wrapper (`rtk git push` matches
 * `\bgit\s+push\b`) — but {@link SAFE_BASH} is `^`-anchored, so a wrapped *safe*
 * command stopped matching and fell through to `unknown`. The gate is
 * fail-closed, so nothing became less safe; it became **more annoying**, silently
 * turning previously auto-approved commands into prompts the moment a user
 * installed RTK. Only the safe-list check consults this, never the
 * destructive/outward checks, so unwrapping can never downgrade a classification.
 */
const OUTPUT_WRAPPERS = ["rtk"];

/**
 * Strip one known wrapper token from the front of `cmd`, or return it unchanged.
 *
 * Deliberately shallow and deliberately not applied to RTK's own
 * command-taking subcommands (`rtk proxy <cmd>`, `rtk err <cmd>`,
 * `rtk test <cmd>`, `rtk summary <cmd>`): those run an arbitrary inner command,
 * so unwrapping them to a bare subcommand name would be meaningless. They keep
 * falling through to `unknown` and stay gated.
 */
function stripOutputWrapper(cmd: string): string {
  for (const wrapper of OUTPUT_WRAPPERS) {
    const prefix = `${wrapper} `;
    if (cmd.toLowerCase().startsWith(prefix)) {
      return cmd.slice(prefix.length).trimStart();
    }
  }
  return cmd;
}

/**
 * Blank out characters inside single-quoted or double-quoted regions, leaving a
 * string of the same length where every quoted char is a space. The danger
 * patterns then match only UNQUOTED text, so a filename argument like
 * `ls 'git push.sh'` no longer false-positives on `\bgit\s+push\b` (R8.21).
 *
 * Deliberately conservative: a double-quoted region can still contain `$(...)`
 * command substitution, so after blanking we keep the composition check on the
 * ORIGINAL string — quoted or not, a `$(...)` or `;` stays a reason to gate the
 * command. Blanking is only used to suppress the specific false positive of a
 * danger token appearing as a quoted literal argument.
 */
function blankQuoted(cmd: string): string {
  const out = cmd.split("");
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (quote === null) {
      if (c === "'" || c === '"') {
        quote = c;
        out[i] = " ";
      }
    } else if (c === quote) {
      quote = null;
      out[i] = " ";
    } else if (c === "\\" && quote === '"') {
      // escaped char inside double quotes: blank both the backslash and the
      // escaped char so it cannot end the quote early or smuggle a token out
      out[i] = " ";
      if (i + 1 < out.length) out[i + 1] = " ";
      i += 1;
    } else {
      out[i] = " ";
    }
  }
  return out.join("");
}

/** Classify a Bash command string. Escalate-only: outward/destructive win over safe. */
export function classifyBash(command: string): ActionClass {
  const cmd = command.trim();
  // Danger first, against the quote-blanked form. A danger token inside a quoted
  // literal (e.g. `ls 'git push.sh'`) is DATA, not a command — and because the
  // quote chars are non-word, `\bgit\s+push\b` matches even inside quotes on the
  // raw string (R8.21). Blanking quotes makes the boundary check honest: an
  // unquoted `git push` or `rm -rf` survives blanking unchanged and still
  // escalates; the same tokens as a quoted argument do not.
  const unquoted = blankQuoted(cmd);
  if (OUTWARD_BASH.some((re) => re.test(unquoted))) return "outward";
  if (DESTRUCTIVE_BASH.some((re) => re.test(unquoted))) return "destructive";
  // Composition (redirection, chaining, pipes, substitution) can hide a write
  // or a second command behind a safe leading token — never classify it read.
  if (SHELL_COMPOSITION_RE.test(cmd)) return "unknown";
  if (SAFE_BASH.some((re) => re.test(cmd))) return writesToDisk(cmd) ? "write" : "read";
  // R8.12: retry the safe-list against the unwrapped command, so an installed
  // output compactor does not turn auto-approved reads into prompts. Safe-list
  // only — the danger checks already ran on the original.
  const unwrapped = stripOutputWrapper(cmd);
  if (unwrapped !== cmd && SAFE_BASH.some((re) => re.test(unwrapped))) {
    return writesToDisk(unwrapped) ? "write" : "read";
  }
  // A shell can do anything; an unrecognized command is gated, not assumed safe.
  return "unknown";
}

/*
 * R11.1 note: `classifyLevelTool` lived here, classifying the `level` MCP
 * tool — level 0 as `outward` (it disabled redaction) and 1-3 as `write`.
 * The tool went with the slider, and no dial can reach redaction now
 * (ADR-0004: the stage table has no redaction-free row), so the branch was
 * dead. An unrecognized tool already falls through to `unknown`, which is
 * GATED — strictly safer than the `write` a level call used to earn.
 */

/** Classify a pending tool call into a risk class. Never throws. */
export function classifyAction(toolName: string, toolInput: unknown): ActionClass {
  if (OUTWARD_TOOLS.has(toolName)) return "outward";
  if (toolName === "Bash") {
    const cmd = bashCommand(toolInput);
    return cmd === null ? "unknown" : classifyBash(cmd);
  }
  if (READ_TOOLS.has(toolName)) return "read";
  if (WRITE_TOOLS.has(toolName)) return "write";
  return "unknown";
}
