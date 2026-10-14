/**
 * `golem plugin` — the in-process plugin surface (R8.11 / ADR-0005).
 *
 * Read-only on purpose, and separate from `golem pkg` on purpose: a pkg runs
 * beside Golem in its own process (a real boundary, so its installs can be
 * consent-gated), while a plugin runs inside it (no boundary at all). Merging
 * the two surfaces would blur exactly the distinction the user needs.
 */

import { type Command, InvalidArgumentError } from "commander";
import { findProjectDir } from "../../config/index.js";
import { VERSION } from "../../version.js";
import { InitError } from "../init.js";
import { collectPlugins, pluginExitCode, renderPlugins } from "../plugin.js";

const _DEFAULT_DIR = findProjectDir(process.cwd()) ?? process.cwd();

function _fail(err: unknown): never {
  process.stderr.write(`golem: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(err instanceof InitError ? 2 : 1);
}

export default function register(program: Command): void {
  const pluginCmd = program
    .command("plugin")
    .description(
      "Third-party code running INSIDE Golem — redaction rules, pipeline stages, MCP tools (ADR-0005)",
    );

  pluginCmd
    .command("list", { isDefault: true })
    .alias("status")
    .description("Show which plugins load, from where, and what each one registers")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--json", "machine-readable output", false)
    .option("--verbose", "also list every rule, stage and tool contributed", false)
    .option("--check", "exit 1 when any error-level problem was found (default: always 0)", false)
    .option("--strict", "exit 1 on ANY problem, warnings included (implies --check)", false)
    .option("--deadline <ms>", "overall time limit for this command (default 30000)", parseMs)
    .option("--setup-timeout <ms>", "time limit for each plugin's setup() (default 10000)", parseMs)
    .action(
      async (opts: {
        dir: string;
        json: boolean;
        verbose: boolean;
        check: boolean;
        strict: boolean;
        deadline?: number;
        setupTimeout?: number;
      }) => {
        try {
          const report = await collectPlugins(opts.dir, VERSION, {
            ...(opts.deadline !== undefined ? { deadlineMs: opts.deadline } : {}),
            ...(opts.setupTimeout !== undefined ? { setupTimeoutMs: opts.setupTimeout } : {}),
          });
          // Functions do not serialize, so the JSON view carries the facts a
          // machine can act on rather than a lossy half-render of the handlers.
          const text = opts.json
            ? `${JSON.stringify(
                {
                  projectDir: report.projectDir,
                  enabled: report.enabled,
                  configured: report.configured,
                  plugins: report.loaded.plugins,
                  problems: report.problems,
                  problemCounts: report.counts,
                  redactionRuleIds: report.loaded.redactionRules.map((r) => r.id),
                  stageNames: report.loaded.stages.map((s) => s.name),
                  mcpToolNames: report.loaded.mcpTools.map((t) => t.name),
                },
                null,
                2,
              )}\n`
            : renderPlugins(report, opts.verbose);
          // Exit explicitly once the output is flushed: a plugin that left a
          // timer or socket open must not be able to keep this command alive.
          const code = pluginExitCode(report, opts);
          process.stdout.write(text, () => process.exit(code));
        } catch (err) {
          _fail(err);
        }
      },
    );
}

function parseMs(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0)
    throw new InvalidArgumentError("expected a positive number of ms");
  return n;
}
