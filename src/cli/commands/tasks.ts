/**
 * golem task — extracted from program.ts (R8.27).
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { findProjectDir, loadEffectiveConfig } from "../../config/index.js";
import {
  markReviewed,
  readDelegationLedger,
  unreviewedDelegations,
  unreviewedRefusal,
  updateDelegationLedger,
  waiveReview,
} from "../../hooks/delegation-ledger.js";
import {
  createProbeRunner,
  detectCapability,
  OllamaClient,
  OllamaInferenceService,
} from "../../inference/index.js";
import {
  buildResumeArgv,
  captureWorktree,
  createTask,
  describeWorktree,
  escalateTask,
  FileTaskStore,
  formatResumeCommand,
  isResumable,
  PlanTaskStore,
  runQueueLocally,
  TERMINAL_TASK_STATES,
  worktreeDrift,
} from "../../tasks/index.js";
import { InitError } from "../init.js";
import {
  groupPlanTasks,
  renderPlanIndex,
  renderPlanSummary,
  splicePlanIndex,
} from "../plan-index.js";
import {
  findScopedTask,
  findTask,
  listScopedTasks,
  listScopedTasksWithProblems,
  renderPlanProblems,
  renderScopedTaskList,
  renderTask,
  spawnResume,
  storeForScope,
} from "../task.js";
import { buildTaskGrounding } from "../task-grounding.js";

const _DEFAULT_DIR = findProjectDir(process.cwd()) ?? process.cwd();

function _fail(err: unknown): never {
  process.stderr.write(`golem: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(err instanceof InitError ? 2 : 1);
}

async function _buildInferenceForDir(dir: string) {
  try {
    const { settings } = await loadEffectiveConfig({ projectDir: dir });
    const client = new OllamaClient({
      baseUrl: settings.inference.ollama_base_url,
      requestTimeoutMs: settings.inference.request_timeout_ms,
    });
    const facts = await detectCapability(createProbeRunner());
    return new OllamaInferenceService(client, facts);
  } catch {
    return null;
  }
}

export default function register(program: Command): void {
  const taskCmd = program
    .command("task")
    .description(
      "Durable task queue — persist a prompt/agent and resume it later (survives limits)",
    );

  taskCmd
    .command("add")
    .description("Queue a durable task (a prompt to run/resume later)")
    .argument("<prompt...>", "the prompt/instructions to persist")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--title <text>", "short label for `task list`")
    .option("--session-id <uuid>", "Claude Code session id to resume deterministically")
    .option("--continue", "resume the most-recent conversation instead of a session id", false)
    .option("--agent <type>", "agent type to relaunch as")
    .option("--idem-key <key>", "idempotency key for the side effect this task owns")
    .option("--not-before <iso>", "capacity gate: don't auto-resume before this ISO time")
    .option("--json", "machine-readable output", false)
    .action(
      async (
        prompt: string[],
        opts: {
          dir: string;
          title?: string;
          sessionId?: string;
          continue: boolean;
          agent?: string;
          idemKey?: string;
          notBefore?: string;
          json: boolean;
        },
      ) => {
        try {
          const task = createTask({
            prompt: prompt.join(" "),
            continueLatest: opts.continue,
            ...(opts.title !== undefined ? { title: opts.title } : {}),
            ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
            ...(opts.agent !== undefined ? { agentType: opts.agent } : {}),
            ...(opts.idemKey !== undefined ? { idempotencyKey: opts.idemKey } : {}),
            ...(opts.notBefore !== undefined ? { notBefore: opts.notBefore } : {}),
          });
          // Where this was parked (r029); fail-open, absent outside a git checkout.
          const worktree = await captureWorktree(opts.dir);
          const stored = await new FileTaskStore(opts.dir).put(
            worktree !== undefined ? { ...task, worktree } : task,
          );
          process.stdout.write(
            opts.json ? `${JSON.stringify(stored, null, 2)}\n` : `queued task ${stored.id}\n`,
          );
        } catch (err) {
          _fail(err);
        }
      },
    );

  taskCmd
    .command("list")
    .description("List tasks — committed roadmap tasks and this machine's parked ones")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--plan", "only committed roadmap tasks", false)
    .option("--local", "only this machine's parked tasks", false)
    .option("--json", "machine-readable output", false)
    .action(async (opts: { dir: string; plan: boolean; local: boolean; json: boolean }) => {
      try {
        if (opts.plan && opts.local)
          throw new InitError(
            "--plan and --local are mutually exclusive (omit both for all tasks)",
          );
        const only = opts.plan ? "plan" : opts.local ? "local" : undefined;
        const { entries, problems } = await listScopedTasksWithProblems(opts.dir, only);
        if (opts.json) {
          // The JSON shape stays a bare array; the loud part goes to stderr.
          process.stdout.write(
            `${JSON.stringify(
              entries.map((e) => ({ scope: e.scope, ...e.task })),
              null,
              2,
            )}\n`,
          );
          process.stderr.write(renderPlanProblems(problems));
        } else {
          process.stdout.write(renderScopedTaskList(entries, problems));
        }
      } catch (err) {
        _fail(err);
      }
    });

  taskCmd
    .command("show")
    .description("Show one task in detail")
    .argument("<id>", "task id or unique prefix")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--json", "machine-readable output", false)
    .action(async (id: string, opts: { dir: string; json: boolean }) => {
      try {
        const found = findScopedTask(await listScopedTasks(opts.dir), id);
        if (found === "none") throw new InitError(`no task matching "${id}"`);
        if (found === "ambiguous") throw new InitError(`"${id}" matches more than one task`);
        process.stdout.write(
          opts.json
            ? `${JSON.stringify({ scope: found.scope, ...found.task }, null, 2)}\n`
            : renderTask(found.task),
        );
      } catch (err) {
        _fail(err);
      }
    });

  taskCmd
    .command("index")
    .description("Render the roadmap open-work index from docs/plan/tasks/")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--summary", "one-screen terminal summary", false)
    .option("--write [file]", "splice the Markdown between the golem:task-index markers")
    .option("--json", "machine-readable output", false)
    .action(
      async (opts: { dir: string; summary: boolean; write?: string | boolean; json: boolean }) => {
        try {
          const { tasks, problems } = await new PlanTaskStore(opts.dir).listWithProblems();
          // An unreadable doc is missing from the index: that is a failure, whatever
          // the output mode, so the exit code says so (the output is still produced).
          if (problems.length > 0) process.exitCode = 1;
          if (opts.json) {
            const { ready, blocked, done } = groupPlanTasks(tasks);
            process.stdout.write(
              `${JSON.stringify({ ready, blocked, done, unparseable: problems }, null, 2)}\n`,
            );
            return;
          }
          if (opts.summary) {
            process.stdout.write(renderPlanSummary(tasks, problems));
            return;
          }
          if (problems.length > 0) process.stderr.write(renderPlanProblems(problems));
          const rendered = renderPlanIndex(tasks, problems);
          if (opts.write === undefined || opts.write === false) {
            process.stdout.write(`${rendered}\n`);
            return;
          }
          const target =
            typeof opts.write === "string"
              ? opts.write
              : path.join(opts.dir, "docs", "plan", "ROADMAP.md");
          const before = await readFile(target, "utf8");
          const { text, spliced } = splicePlanIndex(before, rendered);
          if (!spliced) throw new InitError(`${target} has no golem:task-index markers`);
          if (text === before) {
            process.stdout.write(`${target} already up to date\n`);
            return;
          }
          await writeFile(target, text, "utf8");
          process.stdout.write(`updated the task index in ${target}\n`);
        } catch (err) {
          _fail(err);
        }
      },
    );

  taskCmd
    .command("resume")
    .description("Build (and optionally spawn) the headless resume command for a task")
    .argument("<id>", "task id or unique prefix")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--spawn", "actually launch it (detached); default just prints the command", false)
    .option("--output-json", "resume with --output-format json", false)
    .option("--permission-mode <mode>", "begin the resumed session in this permission mode")
    .action(
      async (
        id: string,
        opts: { dir: string; spawn: boolean; outputJson: boolean; permissionMode?: string },
      ) => {
        try {
          const { entries, problems } = await listScopedTasksWithProblems(opts.dir);
          const found = findScopedTask(entries, id);
          if (found === "none") {
            // A doc that failed to parse must not read as "no such task".
            const hint = problems.find((p) => p.name.toLowerCase().startsWith(id.toLowerCase()));
            throw new InitError(
              hint !== undefined
                ? `plan task document ${hint.path} is unparseable: ${hint.reason}`
                : `no task matching "${id}"`,
            );
          }
          if (found === "ambiguous") throw new InitError(`"${id}" matches more than one task`);
          const { task, scope } = found;
          if (!isResumable(task)) {
            process.stdout.write(`task ${task.id} is not resumable (state is ${task.state})\n`);
            return;
          }
          const isPlan = scope === "plan";
          if (isPlan && task.plan?.owner === "user") {
            throw new InitError(
              `plan task ${task.id} is owner: user (outward-facing or credentialed) — an agent must not run it`,
            );
          }
          const blockedReason = isPlan ? task.plan?.blocked : undefined;
          const unmetDeps = isPlan
            ? (task.plan?.dependsOn ?? []).filter((dep) => {
                const d = entries.find((e) => e.scope === "plan" && e.task.id === dep);
                return d !== undefined && !TERMINAL_TASK_STATES.has(d.task.state);
              })
            : [];
          if (isPlan && opts.spawn && (blockedReason !== undefined || unmetDeps.length > 0)) {
            throw new InitError(
              `plan task ${task.id} is blocked — ${blockedReason ?? `waiting on ${unmetDeps.join(", ")}`}; not spawning`,
            );
          }
          // A plan task is a committed document, not a conversation: start fresh from
          // its brief rather than `--continue`-ing some unrelated session.
          const prompt = isPlan
            ? `Plan task ${task.id}${task.title !== undefined ? ` — ${task.title}` : ""}. Do the work in this brief; stop at its gate.\n\n${task.prompt}`
            : task.prompt;
          const argv = buildResumeArgv(
            { ...task, prompt },
            {
              fresh: isPlan,
              outputJson: opts.outputJson,
              ...(opts.permissionMode !== undefined ? { permissionMode: opts.permissionMode } : {}),
            },
          );
          if (task.worktree !== undefined) {
            process.stdout.write(`parked in worktree: ${describeWorktree(task.worktree)}\n`);
            for (const warning of await worktreeDrift(task.worktree)) {
              process.stdout.write(`  warning: ${warning}\n`);
            }
          }
          if (blockedReason !== undefined || unmetDeps.length > 0) {
            process.stdout.write(
              `  warning: plan task is blocked — ${blockedReason ?? `waiting on ${unmetDeps.join(", ")}`}\n`,
            );
          }
          if (!opts.spawn) {
            process.stdout.write(
              `resume command (pass --spawn to launch it):\n  ${formatResumeCommand(argv)}\n`,
            );
            return;
          }
          const cwd =
            task.worktree !== undefined && existsSync(task.worktree.path)
              ? task.worktree.path
              : undefined;
          const result = await spawnResume(argv, cwd);
          // A plan doc is committed and shared: launching must not dirty it with
          // machine-local `running`/attempt bookkeeping. Only local tasks record it.
          if (!isPlan) {
            // A launch that failed is not a running task: leave the state alone so
            // the record does not claim work that never started.
            await new FileTaskStore(opts.dir).put(
              result.spawned
                ? { ...task, state: "running", attempts: task.attempts + 1 }
                : { ...task, attempts: task.attempts + 1 },
            );
          }
          process.stdout.write(
            result.spawned
              ? `resumed task ${task.id} (pid ${result.pid ?? "?"})\n`
              : `could not spawn — ${result.note ?? "run it manually"}:\n  ${result.command}\n`,
          );
        } catch (err) {
          _fail(err);
        }
      },
    );

  taskCmd
    .command("cancel")
    .description("Mark a task cancelled (keeps the record)")
    .argument("<id>", "task id or unique prefix")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--delete", "remove the task record entirely", false)
    .action(async (id: string, opts: { dir: string; delete: boolean }) => {
      try {
        const found = findScopedTask(await listScopedTasks(opts.dir), id);
        if (found === "none") throw new InitError(`no task matching "${id}"`);
        if (found === "ambiguous") throw new InitError(`"${id}" matches more than one task`);
        const { task, scope } = found;
        const store = storeForScope(scope, opts.dir);
        if (opts.delete) {
          await store.delete(task.id);
          process.stdout.write(
            scope === "plan"
              ? `deleted plan task ${task.id} — its document is gone, commit the removal\n`
              : `deleted task ${task.id}\n`,
          );
          return;
        }
        await store.put({ ...task, state: "cancelled" });
        process.stdout.write(`cancelled ${scope} task ${task.id}\n`);
      } catch (err) {
        _fail(err);
      }
    });

  taskCmd
    .command("done")
    .description(
      "Mark a task done (refuses while delegated runs are unreviewed — see `golem task review`)",
    )
    .argument("<id>", "task id or unique prefix")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--note <text>", "short outcome note appended to the task body")
    .action(async (id: string, opts: { dir: string; note?: string }) => {
      try {
        const found = findScopedTask(await listScopedTasks(opts.dir), id);
        if (found === "none") throw new InitError(`no task matching "${id}"`);
        if (found === "ambiguous") throw new InitError(`"${id}" matches more than one task`);
        const { task, scope } = found;

        // R14.6 — the manager's gate. A delegated model is good at the shape of
        // the work and unreliable on its specifics (three runs, seven factual
        // errors), so close-out refuses while any dispatched run is unreviewed.
        // A task with nothing delegated closes exactly as it always did.
        const outstanding = unreviewedDelegations(await readDelegationLedger(opts.dir));
        if (outstanding.length > 0) {
          throw new InitError(unreviewedRefusal(outstanding));
        }
        const prompt =
          opts.note === undefined ? task.prompt : `${task.prompt}\n\n## Outcome\n\n${opts.note}`;
        await storeForScope(scope, opts.dir).put({ ...task, state: "done", prompt });
        process.stdout.write(
          scope === "plan"
            ? `marked plan task ${task.id} done — run "golem task index --write" to refresh the roadmap\n`
            : `marked task ${task.id} done\n`,
        );
      } catch (err) {
        _fail(err);
      }
    });

  taskCmd
    .command("review")
    .description(
      "Record that a delegated run's output has been reviewed (R14.6) — close-out refuses until it is",
    )
    .argument("[id]", "a delegation id from the refusal, or omit with --all")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--all", "mark every outstanding delegated run reviewed", false)
    .option(
      "--waive <reason>",
      "close WITHOUT reviewing, recording the reason — deliberate, never a default",
    )
    .action(async (id: string | undefined, opts: { dir: string; all: boolean; waive?: string }) => {
      try {
        // Read-modify-write under the same lock `recordDelegation` takes, so a spawn
        // recorded between our read and write is not erased (which would let
        // `task done` close past the R14.6 gate).
        const message = await updateDelegationLedger(opts.dir, (ledger) => {
          const outstanding = unreviewedDelegations(ledger);
          if (outstanding.length === 0) {
            return { ledger: null, result: "no delegated runs are awaiting review\n" };
          }
          if (id === undefined && !opts.all && opts.waive === undefined) {
            throw new InitError(
              `${outstanding.length} delegated run(s) awaiting review. ` +
                "Name one by id, or use --all. Ids:\n" +
                outstanding.map((d) => `  ${d.id}  ${d.agentType}`).join("\n"),
            );
          }
          if (opts.waive !== undefined && id === undefined && !opts.all) {
            // A waiver is the deliberate escape hatch: it must name its target, never
            // sweep every outstanding run by omission.
            throw new InitError(
              `--waive needs an id or an explicit --all. ${outstanding.length} outstanding. Ids:\n` +
                outstanding.map((d) => `  ${d.id}  ${d.agentType}`).join("\n"),
            );
          }
          const nowIso = new Date().toISOString();
          const result =
            opts.waive !== undefined
              ? waiveReview(ledger, nowIso, opts.waive, id)
              : markReviewed(ledger, nowIso, id);
          if (result.changed === 0) {
            // Reporting success for a no-op is the dishonest-signal class this
            // repo keeps closing.
            throw new InitError(
              id === undefined
                ? "nothing changed — no outstanding delegated runs"
                : `no outstanding delegated run with id "${id}"`,
            );
          }
          return {
            ledger: result.ledger,
            result:
              opts.waive !== undefined
                ? `waived review for ${result.changed} delegated run(s): ${opts.waive}\n`
                : `marked ${result.changed} delegated run(s) reviewed\n`,
          };
        });
        process.stdout.write(message);
      } catch (err) {
        _fail(err);
      }
    });

  taskCmd
    .command("run")
    .description("Service queued tasks LOCALLY (Ollama tier) — non-blocking multiplexing (R5.3)")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--concurrency <n>", "max tasks serviced at once (default 2)", "2")
    .option("--limit <n>", "cap how many queued tasks to service this run")
    .action(async (opts: { dir: string; concurrency: string; limit?: string }) => {
      try {
        const concurrency = Number(opts.concurrency);
        if (!Number.isInteger(concurrency) || concurrency < 1)
          throw new InitError(`invalid --concurrency "${opts.concurrency}"`);
        const limit = opts.limit === undefined ? undefined : Number(opts.limit);
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
          throw new InitError(`invalid --limit "${opts.limit}"`);
        const inference = await _buildInferenceForDir(opts.dir);
        if (inference === null) {
          process.stdout.write(
            "local model unavailable — queued tasks left as-is (start Ollama, then `golem task run`).\n",
          );
          return;
        }
        const ground = await buildTaskGrounding(opts.dir, inference);
        const result = await runQueueLocally(
          new FileTaskStore(opts.dir),
          { inference, ...(ground !== undefined ? { ground } : {}) },
          { concurrency, ...(limit !== undefined ? { limit } : {}) },
        );
        if (result.total === 0) {
          process.stdout.write("no queued tasks to service\n");
          return;
        }
        if (result.localModelUnavailable) {
          process.stdout.write(
            `local model unavailable — ${result.total} task(s) left queued (retry when Ollama is up).\n`,
          );
          return;
        }
        process.stdout.write(
          `serviced ${result.serviced}/${result.total} queued task(s) locally${result.failed > 0 ? ` (${result.failed} failed — see \`golem task show\`)` : ""}.\n`,
        );
      } catch (err) {
        _fail(err);
      }
    });

  taskCmd
    .command("escalate")
    .description(
      "Hand a task to the Claude tier: fold its local result into the prompt (R5.3 / 21a)",
    )
    .argument("<id>", "task id or unique prefix")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .action(async (id: string, opts: { dir: string }) => {
      try {
        const store = new FileTaskStore(opts.dir);
        const task = findTask(await store.list(), id);
        if (task === "none") throw new InitError(`no task matching "${id}"`);
        if (task === "ambiguous") throw new InitError(`"${id}" matches more than one task`);
        const stored = await store.put(escalateTask(task, null));
        process.stdout.write(
          `escalated task ${stored.id} to the Claude tier — resume it with \`golem task resume ${stored.id.slice(0, 8)} --spawn\`\n`,
        );
      } catch (err) {
        _fail(err);
      }
    });
}
