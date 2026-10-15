/**
 * `src/plugins/loader.ts` — resolve, import, and validate plugins (R8.11).
 *
 * The quarantine adapter for the plugin surface: this is the ONLY file that
 * imports third-party plugin code, so the blast radius of "what happens when a
 * plugin is broken" is one module with one rule — **every failure is a recorded
 * problem and a no-op, never an error path** (ADR-0005 §4).
 *
 * What this file deliberately does not do: discover anything. There is no
 * `node_modules` scan, no naming convention, no registry lookup, and no
 * download. A plugin loads because a human wrote its specifier in
 * `plugins.load`, and for no other reason.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RedactionRule } from "../pipeline/redaction-rules.js";
import { analyzeRegexRisk } from "./regex-risk.js";
import { describeThrown } from "./safe-text.js";
import type {
  GolemPlugin,
  GolemPluginApi,
  LoadedPlugin,
  LoadedPlugins,
  PluginMcpTool,
  PluginPipelineStage,
  PluginProblem,
  PluginRedactionRule,
  PluginSeam,
} from "./types.js";

/** Kebab-case, so a name can be a placeholder-kind segment and a CLI token. */
const NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Golem's own MCP tool names. A plugin may ADD a tool and may never shadow one
 * of these — a model that calls `search` must reach Golem's `search`.
 *
 * Kept here rather than derived from the server, because the check has to happen
 * at load time (before any server exists) and because a hardcoded list fails
 * loudly in the drift test when a tool is renamed, which is the behaviour we
 * want: a new built-in name must consciously become reserved.
 */
export const BUILTIN_MCP_TOOL_NAMES: readonly string[] = [
  "code",
  "coder",
  "devices",
  "expand",
  "fetch",
  "ingest",
  "search",
  "snooze",
  "stats",
  "wiki_read",
  "wiki_upsert",
];

/** How long one plugin's `setup()` may take (startup must not hang on third-party code). */
export const PLUGIN_SETUP_TIMEOUT_MS = 10_000;
const SETUP_TIMED_OUT = Symbol("plugin-setup-timed-out");

export interface LoadPluginsOptions {
  /** Per-plugin `setup()` limit. Default {@link PLUGIN_SETUP_TIMEOUT_MS}. */
  readonly setupTimeoutMs?: number;
  /** Specifiers from `plugins.load`, in order. Order is load order. */
  readonly specifiers: readonly string[];
  /** `plugins.enabled` — false means do not even try. */
  readonly enabled?: boolean;
  readonly projectDir: string;
  readonly golemVersion: string;
  /**
   * Built-in MCP tool names a plugin must not shadow. Defaults to
   * {@link BUILTIN_MCP_TOOL_NAMES}.
   */
  readonly reservedToolNames?: readonly string[];
  /** Injected for tests: resolve a specifier to something importable. */
  readonly resolve?: (specifier: string, projectDir: string) => string;
  /** Injected for tests: import a resolved specifier. */
  readonly importModule?: (resolved: string) => Promise<unknown>;
}

/**
 * Resolve a specifier the way the *user's* install would.
 *
 * A local path (`./x`, `../x`, absolute) resolves against `projectDir`. A bare
 * specifier resolves through a `require` rooted at the project, **not** at
 * Golem's own install — a plugin is the user's dependency, and resolving it from
 * Golem's `node_modules` would silently prefer a copy they did not install.
 */
function defaultResolve(specifier: string, projectDir: string): string {
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    return path.resolve(projectDir, specifier);
  }
  const req = createRequire(path.join(path.resolve(projectDir), "package.json"));
  return req.resolve(specifier);
}

function defaultImport(resolved: string): Promise<unknown> {
  // A resolved absolute path must become a file URL or Windows drive letters are
  // read as a URL scheme.
  const target = path.isAbsolute(resolved) ? pathToFileURL(resolved).href : resolved;
  return import(target);
}

/** Pull the plugin object out of a module's exports, or explain why not. */
function pluginFromModule(mod: unknown): GolemPlugin | string {
  if (typeof mod !== "object" || mod === null) return "module did not export an object";
  const record = mod as Record<string, unknown>;
  const candidate = record.default ?? record.plugin;
  if (typeof candidate !== "object" || candidate === null) {
    return "module exports neither a `default` nor a `plugin` object";
  }
  const plugin = candidate as Partial<GolemPlugin>;
  if (typeof plugin.name !== "string" || !NAME_RE.test(plugin.name)) {
    return "plugin.name must be a kebab-case string";
  }
  if (typeof plugin.setup !== "function") return "plugin.setup must be a function";
  return plugin as GolemPlugin;
}

const errorText = describeThrown;

/**
 * Wrap a plugin's `validate` so a throw is the same verdict as `false`.
 *
 * A built-in validator returning false means "matched the pattern, but is not
 * actually a secret". A third-party validator that throws has told us nothing, so
 * the safe reading is the same one — and crucially it must not abort the pass,
 * because the rest of the table (including every built-in) still has to run.
 */
function safeValidate(
  validate: (target: string) => boolean,
  onError: (message: string) => void,
): (target: string) => boolean {
  return (target: string): boolean => {
    try {
      return validate(target) === true;
    } catch (err) {
      onError(errorText(err));
      return false;
    }
  };
}

/** Distinct `validate` failure messages kept per rule; the rest only bump a count. */
const MAX_DISTINCT_VALIDATE_PROBLEMS = 10;

interface ValidateProblemLedger {
  /** message -> index into `problems` */
  readonly byMessage: Map<string, number>;
  /** index of this rule's "and N more" overflow entry, once one exists */
  overflow: number;
}

/**
 * `validate` runs on every candidate match for the life of the process, so a
 * throwing one would otherwise push a problem per call. Record each distinct
 * message once with a count, and cap the distinct messages per rule (a message
 * that embeds the candidate text is otherwise unbounded).
 */
function recordValidateProblem(
  problems: PluginProblem[],
  seen: Map<string, ValidateProblemLedger>,
  subject: string,
  ruleId: string,
  reason: string,
): void {
  let ledger = seen.get(ruleId);
  if (ledger === undefined) {
    ledger = { byMessage: new Map(), overflow: -1 };
    seen.set(ruleId, ledger);
  }
  let index = ledger.byMessage.get(reason);
  if (index === undefined) {
    if (ledger.byMessage.size < MAX_DISTINCT_VALIDATE_PROBLEMS) {
      index =
        problems.push({ subject, kind: "validate-threw", severity: "warning", reason, count: 0 }) -
        1;
      ledger.byMessage.set(reason, index);
    } else {
      // Further distinct messages share ONE overflow entry with its own count,
      // so no earlier entry's text or count is disturbed.
      if (ledger.overflow < 0) {
        ledger.overflow =
          problems.push({
            subject,
            kind: "validate-threw",
            severity: "warning",
            reason: `rule "${ruleId}" validate threw (and more distinct errors, not listed)`,
            count: 0,
          }) - 1;
      }
      index = ledger.overflow;
    }
  }
  const existing = problems[index];
  if (existing !== undefined) problems[index] = { ...existing, count: (existing.count ?? 0) + 1 };
}

/**
 * Advisory checks on a rule that PASSED validation (and stays active whatever
 * they find): a `group` the pattern does not have, and backtracking-prone shape.
 */
function adviseOnRule(problems: PluginProblem[], subject: string, rule: PluginRedactionRule): void {
  if (rule.group !== undefined) {
    // `|` appended forces a match of "", whose length is 1 + the capture count.
    const captures =
      (new RegExp(`${rule.pattern.source}|`, rule.pattern.flags.replace(/[gy]/g, "")).exec("")
        ?.length ?? 1) - 1;
    if (rule.group > captures) {
      problems.push({
        subject,
        kind: "dead-rule",
        severity: "warning",
        reason: `rule "${rule.id}": group ${rule.group} but the pattern has ${captures} capture group(s); the rule can never redact anything`,
      });
    }
  }
  for (const finding of analyzeRegexRisk(rule.pattern.source, rule.pattern.flags)) {
    problems.push({
      subject,
      kind: finding.kind === "unanalysed" ? "unanalysed-regex" : "regex-backtracking",
      severity: "warning",
      reason: `rule "${rule.id}": ${finding.kind}: ${finding.detail} (warning only; the rule stays active)`,
    });
  }
}

/**
 * Load every specifier. Never throws; the result carries what worked and what
 * did not.
 */
export async function loadPlugins(opts: LoadPluginsOptions): Promise<LoadedPlugins> {
  const empty: LoadedPlugins = {
    plugins: [],
    redactionRules: [],
    stages: [],
    mcpTools: [],
    problems: [],
    attempted: false,
  };
  if (opts.enabled === false) return empty;
  if (opts.specifiers.length === 0) return { ...empty, attempted: true };

  const resolveSpec = opts.resolve ?? defaultResolve;
  const importSpec = opts.importModule ?? defaultImport;
  const reserved = new Set(opts.reservedToolNames ?? BUILTIN_MCP_TOOL_NAMES);

  const plugins: LoadedPlugin[] = [];
  const redactionRules: RedactionRule[] = [];
  const stages: PluginPipelineStage[] = [];
  const mcpTools: PluginMcpTool[] = [];
  const problems: PluginProblem[] = [];
  const seenPluginNames = new Set<string>();
  const seenToolNames = new Set<string>(reserved);

  for (const specifier of opts.specifiers) {
    let resolved: string;
    try {
      resolved = resolveSpec(specifier, opts.projectDir);
    } catch (err) {
      problems.push({
        subject: specifier,
        kind: "unresolved",
        reason: `could not be resolved from ${opts.projectDir} — Golem never downloads a plugin, so install it yourself first (${errorText(err)})`,
      });
      continue;
    }

    let mod: unknown;
    try {
      mod = await importSpec(resolved);
    } catch (err) {
      problems.push({
        subject: specifier,
        kind: "import-failed",
        reason: `failed to import: ${errorText(err)}`,
      });
      continue;
    }

    const plugin = pluginFromModule(mod);
    if (typeof plugin === "string") {
      problems.push({ subject: specifier, kind: "invalid-module", reason: plugin });
      continue;
    }
    if (seenPluginNames.has(plugin.name)) {
      problems.push({
        subject: specifier,
        kind: "duplicate-plugin",
        reason: `a plugin named "${plugin.name}" is already loaded; names namespace redaction kinds, so they must be unique`,
      });
      continue;
    }

    // Per-plugin registration buffers: a plugin that throws half way through
    // `setup` contributes NOTHING rather than a half-registered set.
    const pendingRules: RedactionRule[] = [];
    const pendingStages: PluginPipelineStage[] = [];
    const pendingTools: PluginMcpTool[] = [];
    const ruleIds = new Set<string>();
    const validateSeen = new Map<string, ValidateProblemLedger>();
    const stageNames = new Set<string>();
    // Advisory warnings are held until setup() succeeds: a plugin whose setup
    // throws contributes nothing, so warning about its rules would be noise.
    const advisories: PluginProblem[] = [];

    // Set once setup() has settled. A registration after that point used to land
    // in a buffer nobody reads — silently dropped. Now it is a recorded problem.
    let setupSettled = false;
    const refuseLate = (what: string): boolean => {
      if (!setupSettled) return false;
      problems.push({
        subject: plugin.name,
        kind: "late-registration",
        reason: `${what} was registered after setup() finished and was ignored; register everything before setup() returns`,
      });
      return true;
    };

    const api: GolemPluginApi = {
      golemVersion: opts.golemVersion,
      projectDir: opts.projectDir,
      addRedactionRule(rule: PluginRedactionRule): void {
        if (refuseLate(`redaction rule "${String(rule?.id)}"`)) return;
        let emptyNote: string | null = null;
        const problem = ((): string | null => {
          if (typeof rule?.id !== "string" || !NAME_RE.test(rule.id)) {
            return "rule.id must be a kebab-case string";
          }
          if (ruleIds.has(rule.id)) return `duplicate rule id "${rule.id}"`;
          if (!(rule.pattern instanceof RegExp))
            return `rule "${rule.id}": pattern must be a RegExp`;
          // Same requirement the built-in table documents: without `g` only the
          // first occurrence would be replaced, which leaks the rest.
          if (!rule.pattern.flags.includes("g")) {
            return `rule "${rule.id}": pattern must carry the \`g\` flag`;
          }
          // A pattern that can match "" is NOT refused: dropping it would drop
          // redactions that worked (e.g. an optional prefix before an optional
          // group). `applyRule` ignores empty matches, so it cannot spam
          // placeholders; say so as a non-fatal problem. (A context-dependent
          // zero-width match, e.g. a lookahead, is not visible to this probe.)
          if (new RegExp(rule.pattern.source, rule.pattern.flags.replace(/[gy]/g, "")).test("")) {
            emptyNote = `rule "${rule.id}": pattern can match the empty string; the rule stays active and empty matches are ignored`;
          }
          if (rule.group !== undefined && (!Number.isInteger(rule.group) || rule.group < 1)) {
            return `rule "${rule.id}": group must be a positive integer`;
          }
          if (rule.validate !== undefined && typeof rule.validate !== "function") {
            return `rule "${rule.id}": validate must be a function`;
          }
          if (typeof rule.description !== "string" || rule.description.length === 0) {
            return `rule "${rule.id}": description is required — it is the audit surface`;
          }
          return null;
        })();
        if (problem !== null) {
          problems.push({ subject: plugin.name, kind: "invalid-registration", reason: problem });
          return;
        }
        ruleIds.add(rule.id);
        if (emptyNote !== null) {
          advisories.push({
            subject: plugin.name,
            kind: "empty-match",
            severity: "warning",
            reason: emptyNote,
          });
        }
        adviseOnRule(advisories, plugin.name, rule);
        pendingRules.push({
          // Namespaced kind: a plugin can neither impersonate a built-in kind nor
          // collide with another plugin's (ADR-0005 §2).
          id: `${plugin.name}/${rule.id}`,
          description: rule.description,
          pattern: rule.pattern,
          ...(rule.group !== undefined ? { group: rule.group } : {}),
          ...(rule.validate !== undefined
            ? {
                validate: safeValidate(rule.validate, (message) => {
                  recordValidateProblem(
                    problems,
                    validateSeen,
                    plugin.name,
                    rule.id,
                    `rule "${rule.id}" validate threw (treated as not-a-secret): ${message}`,
                  );
                }),
              }
            : {}),
        });
      },
      addPipelineStage(stage: PluginPipelineStage): void {
        if (refuseLate(`pipeline stage "${String(stage?.name)}"`)) return;
        if (typeof stage?.name !== "string" || !NAME_RE.test(stage.name)) {
          problems.push({
            subject: plugin.name,
            kind: "invalid-registration",
            reason: "stage.name must be a kebab-case string",
          });
          return;
        }
        if (stageNames.has(stage.name)) {
          problems.push({
            subject: plugin.name,
            kind: "invalid-registration",
            reason: `duplicate stage name "${stage.name}"`,
          });
          return;
        }
        if (typeof stage.transform !== "function") {
          problems.push({
            subject: plugin.name,
            kind: "invalid-registration",
            reason: `stage "${stage.name}": transform must be a function`,
          });
          return;
        }
        if (typeof stage.description !== "string" || stage.description.length === 0) {
          advisories.push({
            subject: plugin.name,
            kind: "missing-metadata",
            severity: "warning",
            reason: `stage "${stage.name}": description is missing; it is what \`golem plugin --verbose\` shows`,
          });
        }
        stageNames.add(stage.name);
        pendingStages.push({
          name: `${plugin.name}/${stage.name}`,
          description: typeof stage.description === "string" ? stage.description : "",
          transform: stage.transform,
        });
      },
      addMcpTool(tool: PluginMcpTool): void {
        if (refuseLate(`MCP tool "${String(tool?.name)}"`)) return;
        if (typeof tool?.name !== "string" || tool.name.length === 0) {
          problems.push({
            subject: plugin.name,
            kind: "invalid-registration",
            reason: "tool.name must be a non-empty string",
          });
          return;
        }
        if (reserved.has(tool.name)) {
          problems.push({
            subject: plugin.name,
            kind: "invalid-registration",
            reason: `tool "${tool.name}" collides with a built-in Golem tool and was rejected — a plugin may add tools, never shadow one`,
          });
          return;
        }
        if (seenToolNames.has(tool.name)) {
          problems.push({
            subject: plugin.name,
            kind: "invalid-registration",
            reason: `tool "${tool.name}" is already registered by another plugin`,
          });
          return;
        }
        if (typeof tool.handler !== "function") {
          problems.push({
            subject: plugin.name,
            kind: "invalid-registration",
            reason: `tool "${tool.name}": handler must be a function`,
          });
          return;
        }
        seenToolNames.add(tool.name);
        pendingTools.push(tool);
      },
    };

    let setupTimer: NodeJS.Timeout | undefined;
    try {
      const setupLimit = opts.setupTimeoutMs ?? PLUGIN_SETUP_TIMEOUT_MS;
      const timedOut = new Promise<typeof SETUP_TIMED_OUT>((resolve) => {
        setupTimer = setTimeout(() => resolve(SETUP_TIMED_OUT), setupLimit);
      });
      const result = await Promise.race([
        Promise.resolve().then(() => plugin.setup(api)),
        timedOut,
      ]);
      setupSettled = true;
      if (result === SETUP_TIMED_OUT) {
        problems.push({
          subject: specifier,
          kind: "setup-timeout",
          reason: `setup() did not finish within ${setupLimit}ms; the plugin contributes nothing (a setup that blocks synchronously cannot be interrupted)`,
        });
        for (const tool of pendingTools) seenToolNames.delete(tool.name);
        continue;
      }
    } catch (err) {
      setupSettled = true;
      problems.push({
        subject: specifier,
        kind: "setup-threw",
        reason: `setup() threw: ${errorText(err)}`,
      });
      // Drop every pending registration — see the buffer comment above.
      for (const tool of pendingTools) seenToolNames.delete(tool.name);
      continue;
    } finally {
      if (setupTimer !== undefined) clearTimeout(setupTimer);
    }

    problems.push(...advisories);
    for (const field of ["version", "description"] as const) {
      const value: unknown = plugin[field];
      if (value !== undefined && typeof value !== "string") {
        problems.push({
          subject: plugin.name,
          kind: "missing-metadata",
          severity: "warning",
          reason: `plugin.${field} must be a string; it is ignored`,
        });
      }
    }

    seenPluginNames.add(plugin.name);
    redactionRules.push(...pendingRules);
    stages.push(...pendingStages);
    mcpTools.push(...pendingTools);
    const seams: Record<PluginSeam, number> = {
      "redaction-rule": pendingRules.length,
      "pipeline-stage": pendingStages.length,
      "mcp-tool": pendingTools.length,
    };
    plugins.push({
      name: plugin.name,
      version: typeof plugin.version === "string" ? plugin.version : null,
      description: typeof plugin.description === "string" ? plugin.description : null,
      specifier,
      resolved,
      seams,
    });
  }

  return { plugins, redactionRules, stages, mcpTools, problems, attempted: true };
}
