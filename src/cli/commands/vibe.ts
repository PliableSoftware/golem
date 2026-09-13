/**
 * `golem vibe` — the personal style guide's CLI half.
 *
 * Read and seed only. There is no `set` verb: a guideline is prose the human
 * confirmed, and the place that confirms it is the `/vibe` skill, which can ask
 * a question. A second write path would be a second place for "did the user
 * actually agree to this?" to be answered — or not.
 *
 * Every verb goes through `openVibeStore`, so every verb is gated: run outside a
 * Golem project and the guide is not read at all.
 */

import type { Command } from "commander";
import {
  loadVibeContext,
  openVibeStore,
  renderVibeContext,
  seedFromPath,
} from "../../vibe/index.js";

function fail(err: unknown): never {
  process.stderr.write(`golem: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

const NOT_A_PROJECT =
  "golem: the personal vibe guide is only readable from a Golem-initialised project.\n" +
  "       Run `golem init` here first.\n";

export default function register(program: Command): void {
  const vibe = program
    .command("vibe")
    .description("Your personal style guide — seed it from code you like, and see what it holds");

  vibe
    .command("show", { isDefault: true })
    .description("Print the brief that coding, writing and review turns actually see")
    .option("--dir <path>", "project directory", process.cwd())
    .option("--json", "machine-readable output", false)
    .action(async (opts: { dir: string; json: boolean }) => {
      try {
        const ctx = await loadVibeContext({ cwd: opts.dir });
        if (ctx === null) {
          if (openVibeStore({ cwd: opts.dir }) === null) {
            process.stderr.write(NOT_A_PROJECT);
            process.exit(1);
          }
          process.stdout.write(
            opts.json
              ? `${JSON.stringify({ brief: null }, null, 2)}\n`
              : "No personal vibe captured yet. Seed one: `golem vibe seed <path>`\n",
          );
          return;
        }
        process.stdout.write(
          opts.json ? `${JSON.stringify(ctx, null, 2)}\n` : renderVibeContext(ctx),
        );
      } catch (err) {
        fail(err);
      }
    });

  vibe
    .command("seed")
    .argument("<paths...>", "files or project directories that read the way you write")
    .description("Measure your style from code you point at, and refresh the guide")
    .option("--dir <path>", "project directory", process.cwd())
    .action(async (paths: string[], opts: { dir: string }) => {
      try {
        const store = openVibeStore({ cwd: opts.dir });
        if (store === null) {
          process.stderr.write(NOT_A_PROJECT);
          process.exit(1);
        }
        for (const p of paths) {
          const result = await seedFromPath(store, p);
          process.stdout.write(
            `golem vibe: ${result.source}\n` +
              `  read ${result.filesRead} file(s)` +
              `${result.filesSkipped > 0 ? `, skipped ${result.filesSkipped}` : ""}` +
              `, ${result.snippetsWritten} snippet(s)\n` +
              `  guideline: ${result.guidelinePath}\n` +
              `  brief: ${result.briefBytes} bytes (always loaded)\n`,
          );
        }
      } catch (err) {
        fail(err);
      }
    });

  vibe
    .command("sources")
    .description("List what the guide was seeded from")
    .option("--dir <path>", "project directory", process.cwd())
    .action(async (opts: { dir: string }) => {
      try {
        const store = openVibeStore({ cwd: opts.dir });
        if (store === null) {
          process.stderr.write(NOT_A_PROJECT);
          process.exit(1);
        }
        const { sources } = await store.sources();
        if (sources.length === 0) {
          process.stdout.write("No sources seeded yet.\n");
          return;
        }
        for (const s of sources) {
          process.stdout.write(
            `${s.path}  (${s.kind}, ${s.files ?? 0} files, seeded ${s.lastSeededAt ?? s.addedAt})\n`,
          );
        }
      } catch (err) {
        fail(err);
      }
    });

  vibe
    .command("path")
    .description("Print where the guide lives on this machine")
    .option("--dir <path>", "project directory", process.cwd())
    .action((opts: { dir: string }) => {
      const store = openVibeStore({ cwd: opts.dir });
      if (store === null) {
        process.stderr.write(NOT_A_PROJECT);
        process.exit(1);
      }
      process.stdout.write(`${store.paths.root}\n`);
    });
}
