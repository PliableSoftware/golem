/**
 * `golem plugin` — what third-party code is running inside Golem, and from where
 * (R8.11 / ADR-0005).
 *
 * Deliberately **read-only, and deliberately blunt**. There is no `install`
 * verb: installing third-party code is `npm`'s job, and offering the verb here
 * would imply a vetting Golem does not perform. What this surface owes the user
 * is the truth — which plugins loaded, which copy of each, what each registered,
 * what failed, and the fact that none of it is sandboxed.
 *
 * The sibling surface is `golem pkg`, which manages tools Golem *spawns*. That
 * one can consent-gate an install because a subprocess is a real boundary. This
 * one cannot, which is exactly why they were kept separate (Decision 53(g)).
 */

import { loadEffectiveConfig } from "../config/index.js";
import { loadPlugins } from "../plugins/index.js";
import { runPluginStage } from "../plugins/stage-runner.js";
import type { LoadedPlugins, PluginProblem } from "../plugins/types.js";

export interface PluginProblemCounts {
  readonly total: number;
  readonly errors: number;
  readonly warnings: number;
  /** Problems by `kind`; a problem with no kind counts as `other`. */
  readonly byKind: Readonly<Record<string, number>>;
}

export interface PluginReport {
  readonly projectDir: string;
  readonly enabled: boolean;
  /** Specifiers from `plugins.load`, verbatim. */
  readonly configured: readonly string[];
  readonly loaded: LoadedPlugins;
  /**
   * EVERY problem found: the loader's, plus anything the stage probe found.
   * Render and count from this, not from `loaded.problems`.
   */
  readonly problems: readonly PluginProblem[];
  readonly counts: PluginProblemCounts;
}

/** Warnings are `severity: "warning"`; everything else is an error. */
export function countProblems(problems: readonly PluginProblem[]): PluginProblemCounts {
  const byKind: Record<string, number> = {};
  let warnings = 0;
  for (const p of problems) {
    const kind = p.kind ?? "other";
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    if (p.severity === "warning") warnings++;
  }
  return { total: problems.length, errors: problems.length - warnings, warnings, byKind };
}

/** A small, secret-free body for probing a stage. */
const PROBE_BODY = {
  model: "golem-plugin-probe",
  messages: [{ role: "user", content: "golem plugin probe" }],
};
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Run every loaded stage once against a tiny synthetic body, through the same
 * runner the proxy uses, so a stage that throws or hangs is found here and not
 * on a user's first request. A throw on a synthetic body can be a stage that is
 * simply picky about input, so it is a warning, not an error.
 */
async function probeStages(loaded: LoadedPlugins): Promise<PluginProblem[]> {
  const found: PluginProblem[] = [];
  for (const stage of loaded.stages) {
    const outcome = await runPluginStage(
      stage,
      structuredClone(PROBE_BODY),
      "plugin-probe",
      PROBE_TIMEOUT_MS,
    );
    if (outcome.fault !== null) {
      found.push({
        subject: stage.name,
        kind: "stage-probe-failed",
        severity: "warning",
        reason: `stage ${outcome.fault.kind === "threw" ? "threw" : "timed out"} on a probe request (${outcome.fault.reason}); in the proxy a failing stage is skipped and the pre-stage body kept`,
      });
    }
  }
  return found;
}

/**
 * Actually load the configured plugins and report what happened.
 *
 * This runs the plugins' `setup()`, because there is no honest way to report
 * what a plugin registers without asking it — a manifest would be a claim, and
 * this surface exists to report facts. It is the same code path the proxy runs,
 * but it is a fresh load, so it can differ from what the running proxy holds.
 */
export async function collectPlugins(
  projectDir: string,
  golemVersion: string,
): Promise<PluginReport> {
  const { settings } = await loadEffectiveConfig({ projectDir });
  const loaded = await loadPlugins({
    specifiers: settings.plugins.load,
    enabled: settings.plugins.enabled,
    projectDir,
    golemVersion,
  });
  const problems = [...loaded.problems, ...(await probeStages(loaded))];
  return {
    projectDir,
    enabled: settings.plugins.enabled,
    configured: settings.plugins.load,
    loaded,
    problems,
    counts: countProblems(problems),
  };
}

const NO_SANDBOX_NOTICE =
  "A plugin runs INSIDE Golem's process, which means inside the redaction path. " +
  "There is no sandbox: loading one is exactly as dangerous as importing a " +
  "dependency you installed yourself. Golem constrains what a plugin is asked " +
  "to do, not what it can do — see ADR-0005.";

/** Greedy word wrap, returning unprefixed lines. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line !== "") out.push(line);
  return out;
}

export function renderPlugins(report: PluginReport, verbose = false): string {
  const out: string[] = ["Golem plugins — third-party code running inside this process", ""];

  if (!report.enabled) {
    out.push("plugins.enabled = false — nothing was loaded, whatever the list says.");
    if (report.configured.length > 0) {
      out.push(`${report.configured.length} specifier(s) configured and skipped:`);
      for (const spec of report.configured) out.push(`  · ${spec}`);
    }
    return `${out.join("\n")}\n`;
  }

  if (report.configured.length === 0) {
    out.push("None configured. `plugins.load` is empty, which is the default.");
    out.push("");
    out.push(
      "Nothing is discovered: Golem never scans node_modules, follows no naming convention,",
    );
    out.push("and downloads nothing. A plugin loads only because you named it.");
    return `${out.join("\n")}\n`;
  }

  for (const plugin of report.loaded.plugins) {
    const version = plugin.version === null ? "" : ` v${plugin.version}`;
    out.push(`  [loaded]  ${plugin.name}${version}`);
    out.push(`            from ${plugin.specifier}`);
    out.push(`            → ${plugin.resolved}`);
    const seams = [
      plugin.seams["redaction-rule"] > 0
        ? `${plugin.seams["redaction-rule"]} redaction rule(s)`
        : null,
      plugin.seams["pipeline-stage"] > 0
        ? `${plugin.seams["pipeline-stage"]} pipeline stage(s)`
        : null,
      plugin.seams["mcp-tool"] > 0 ? `${plugin.seams["mcp-tool"]} MCP tool(s)` : null,
    ].filter((s): s is string => s !== null);
    out.push(`            registered: ${seams.length === 0 ? "nothing" : seams.join(", ")}`);
    if (plugin.description !== null) {
      for (const line of wrap(plugin.description, 62)) out.push(`            ${line}`);
    }
  }

  const unloaded = report.configured.filter(
    (spec) => !report.loaded.plugins.some((p) => p.specifier === spec),
  );
  for (const spec of unloaded) out.push(`  [failed]  ${spec}`);

  if (report.problems.length > 0) {
    out.push("");
    out.push(
      `Problems: ${report.counts.total} (${report.counts.errors} error(s), ` +
        `${report.counts.warnings} warning(s)) — each is a no-op or advisory, never an error path:`,
    );
    for (const problem of report.problems) {
      const tag = problem.severity === "warning" ? "warn" : "error";
      const kind = problem.kind ?? "other";
      const times = problem.count !== undefined && problem.count > 1 ? ` (x${problem.count})` : "";
      const lines = wrap(`[${tag}/${kind}] ${problem.subject}: ${problem.reason}${times}`, 74);
      for (const [i, line] of lines.entries()) out.push(`  ${i === 0 ? "·" : " "} ${line}`);
    }
  }

  if (verbose) {
    out.push("");
    out.push("Redaction rules contributed (appended AFTER every built-in, never before):");
    if (report.loaded.redactionRules.length === 0) out.push("  (none)");
    for (const rule of report.loaded.redactionRules) {
      out.push(`  · [REDACTED:${rule.id}:n]`);
      for (const line of wrap(rule.description, 70)) out.push(`      ${line}`);
    }
    out.push("");
    out.push("Pipeline stages (run after redaction; redaction re-runs over their output):");
    if (report.loaded.stages.length === 0) out.push("  (none)");
    for (const stage of report.loaded.stages) out.push(`  · ${stage.name} — ${stage.description}`);
    out.push("");
    out.push("MCP tools (a name colliding with a built-in is rejected at load):");
    if (report.loaded.mcpTools.length === 0) out.push("  (none)");
    for (const tool of report.loaded.mcpTools) out.push(`  · ${tool.name} — ${tool.title}`);
  }

  out.push("");
  out.push(
    `${report.loaded.plugins.length} loaded · ${report.counts.total} problem(s) ` +
      `(${report.counts.errors} error, ${report.counts.warnings} warning) · ` +
      `${report.loaded.redactionRules.length} redaction rule(s) · ` +
      `${report.loaded.stages.length} stage(s) · ${report.loaded.mcpTools.length} tool(s)`,
  );
  out.push("");
  for (const line of wrap(NO_SANDBOX_NOTICE, 78)) out.push(line);
  return `${out.join("\n")}\n`;
}

/**
 * `golem plugin` exit code. Default 0, always: the command is informational and
 * existing scripts parse its output. `--check` turns it into a gate: 1 when any
 * ERROR-severity problem exists (something was dropped or did not run). `--strict`
 * implies `--check` and also fails on warnings (regex-backtracking shape, dead
 * rules, missing metadata, probe failures). A disabled or empty plugin list has
 * no problems, so it passes.
 */
export function pluginExitCode(
  report: PluginReport,
  opts: { readonly check?: boolean; readonly strict?: boolean },
): 0 | 1 {
  if (opts.strict === true) return report.counts.total > 0 ? 1 : 0;
  if (opts.check === true) return report.counts.errors > 0 ? 1 : 0;
  return 0;
}
