/**
 * R14.3 — the Buzz Desktop "Bring Your Own Harness" (tier-3) definition for Golem.
 *
 * Buzz Desktop reads custom harness definitions from
 * `<app-data>/custom_harnesses/*.json`. `golem` is confirmed available as an
 * id — the reserved namespace is tier-1 (`goose`, `claude`, `codex`,
 * `buzz-agent`) plus the tier-2 presets, and `golem` is none of those.
 *
 * This module only EMITS the definition. Installing it into Buzz Desktop's
 * app-data directory is R14.2's job (`golem buzz install-harness`), offered
 * behind an explicit command — never a side effect of `golem init` or of
 * anything in this task.
 */

import path from "node:path";

export interface HarnessDefinition {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * The tier-3 BYOH JSON for Golem. `args: ["acp"]` alone — a per-persona
 * `--persona <id>` is appended by R14.2's launch spec via
 * `BUZZ_ACP_AGENT_ARGS`, not baked into the harness definition itself, so one
 * harness definition serves every persona.
 */
export function golemHarnessDefinition(): HarnessDefinition {
  return {
    id: "golem",
    label: "Golem",
    command: "golem",
    args: ["acp"],
  };
}

/** Where Buzz Desktop expects a custom harness definition for `golem`, given its app-data dir. */
export function harnessDefinitionPath(appDataDir: string): string {
  return path.join(appDataDir, "custom_harnesses", "golem.json");
}
