/**
 * The ONE entry point for "what are the settings right now" (USER decision G3,
 * task `team-layer-everywhere`).
 *
 * Team policy has to apply on every surface that reads settings, or a member
 * escapes it by picking a different command. So every surface — status, config,
 * the TUI, hooks, the MCP server, the proxy and its hot-reload — calls
 * {@link loadEffectiveConfig}. The raw cascade in `./loader.js` stays exported
 * for the tests that exercise the cascade itself and for this module; a test
 * (`tests/unit/config/loader-entry-point.test.ts`) fails when any other
 * production file imports it.
 *
 * ## Cache only, never the network
 *
 * The team layer is read from `~/.golem/teams/<org_id>.json`, written by
 * `golem team sync` (see `src/portal/team-layer.ts`). Nothing here opens a
 * socket, so this is safe on the hook path (every tool call) and in the MCP
 * server. Refreshing the cache is the sync's job, not a load's.
 *
 * Staleness: the cache file is re-read on every call (one small file, and only
 * for a LINKED project), so a load is never staler than the last sync. There is
 * deliberately no memo here. Long-lived callers that load repeatedly already
 * bound their own cost (the proxy's dial reload keeps a 1s TTL; the persona
 * watcher polls the cache file's mtime).
 *
 * ## No binding, no change
 *
 * A project whose merged settings have no `team.org_id` performs exactly one
 * raw load and returns it: no cache read, no extra import, same object shape
 * plus an inert `team` field. The team module is imported lazily, only for a
 * linked project, so the hook's import graph stays what it was.
 *
 * ## Failure
 *
 * An invalid team value warns and the layer is skipped (ADR-0008, DUSTSEC.14),
 * which `loadConfig` already does. This wrapper adds the second half of that
 * promise: nothing on the team path may throw. A failure to resolve the layer
 * degrades to the local configuration with a warning.
 *
 * `team.*` binding keys are on REMOTE_DENIED_SETTINGS, so the first pass (which
 * discovers the binding) and the second (which applies the layer) can never
 * disagree about which team applies.
 */

import type { TeamLayerResolution } from "../portal/team-layer.js";
import { ConfigError } from "./errors.js";
import { type GolemConfig, type LoadConfigOptions, loadConfig } from "./loader.js";
import { defaultUserDir } from "./paths.js";

export interface LoadEffectiveConfigOptions extends LoadConfigOptions {
  /** Clock for the cache-age wording; tests only. */
  readonly now?: () => number;
}

export interface EffectiveConfig extends GolemConfig {
  /** How the team layer resolved. Always present; usually "nothing applies". */
  readonly team: TeamLayerResolution;
  /** Set when the team layer could not be applied for a reason other than an invalid value. */
  readonly teamFailure?: string;
}

/** Nothing applies, and nothing was touched to find out. */
const UNLINKED: TeamLayerResolution = Object.freeze({
  fromCache: false,
  applied: [],
  skipped: [],
});

export async function loadEffectiveConfig(
  options: LoadEffectiveConfigOptions = {},
): Promise<EffectiveConfig> {
  const { now, ...loadOptions } = options;
  const first = await loadConfig(loadOptions);

  // An explicitly supplied layer is the caller's business (a test, or a caller
  // that resolved one already) — do not second-guess it.
  if (loadOptions.teamLayer !== undefined) return { ...first, team: UNLINKED };

  // The Decision 64 gate, checked before anything is imported or read.
  if (first.settings.team.org_id.trim() === "") return { ...first, team: UNLINKED };

  let team: TeamLayerResolution;
  try {
    const { resolveTeamLayerForProject } = await import("../portal/team-layer.js");
    team = await resolveTeamLayerForProject({
      team: first.settings.team,
      userDir: loadOptions.userDir ?? defaultUserDir(),
      ...(now === undefined ? {} : { now }),
    });
  } catch (err) {
    return degraded(first, UNLINKED, err, "the team layer could not be read");
  }

  if (team.teamLayer === undefined) {
    // Linked, but nothing applies (sync off, no cache, or the portal denied the
    // team). A machine silently running WITHOUT the policy someone believes is
    // in force is the hazard the whole design is built around, so the reason
    // travels with the warnings every surface already shows.
    return {
      ...first,
      warnings: team.notice === undefined ? first.warnings : [...first.warnings, team.notice],
      team,
    };
  }

  try {
    const second = await loadConfig({ ...loadOptions, teamLayer: team.teamLayer });
    return { ...second, team: reconcile(team, second) };
  } catch (err) {
    return degraded(first, team, err, "applying the team layer failed");
  }
}

/**
 * What the team layer ACTUALLY did, from what the loader resolved, so `applied`
 * never claims a row that is not in force:
 * - the whole layer was skipped (an invalid value): nothing applied;
 * - a key the loader refused (member-relative rules need the member's value): refused;
 * - a key a member's own setting beat (a `user!` over a `team!`, or a project value
 *   over a normal team row): overridden, with the layer that won;
 * - a key this version does not know: skipped.
 */
function reconcile(team: TeamLayerResolution, loaded: GolemConfig): TeamLayerResolution {
  if (loaded.teamSkipped) return { ...team, applied: [], skipped: [] };
  const refused = new Set(loaded.refused);
  const applied: string[] = [];
  const skipped = [...team.skipped];
  const note = (key: string, reason: string): void => {
    if (!skipped.some((x) => x.key === key)) skipped.push({ key, reason });
  };
  for (const label of team.applied) {
    const key = label.split(" ", 1)[0] ?? label;
    const winner = loaded.provenance[key]?.layer;
    if (refused.has(key)) {
      note(key, "REFUSED: the team policy only allows tightening");
    } else if (winner === undefined) {
      note(key, "this version of Golem has no such setting");
    } else if (winner !== "team") {
      note(key, `OVERRIDDEN by your ${winner} setting, so it is not in force`);
    } else {
      applied.push(`${key}${label.includes(" (enforced)") ? " (enforced)" : ""}`);
    }
  }
  for (const key of loaded.refused) {
    note(key, "REFUSED: the team policy only allows tightening");
  }
  return { ...team, applied, skipped };
}

let announced = false;

/**
 * The team layer could not be applied for a reason that is NOT an invalid team
 * value. ConfigError is the loader's own, expected path (it skips the layer with
 * a warning inside `loadConfig`); anything else is a bug or a broken disk, and
 * it must not stop a proxy, a hook or the MCP server (ADR-0008, DUSTSEC.14), so
 * we still return the local result. But a machine that quietly runs without the
 * policy someone believes is in force is the hazard the whole design exists to
 * prevent, so this is loud: a warning on every surface, a `teamFailure` field,
 * and one stderr line per process.
 */
function degraded(
  first: GolemConfig,
  team: TeamLayerResolution,
  err: unknown,
  what: string,
): EffectiveConfig {
  const reason = err instanceof Error ? err.message : String(err);
  const expected = err instanceof ConfigError;
  const message = expected
    ? `team layer SKIPPED: ${what} (${reason}). Using local configuration.`
    : `TEAM POLICY NOT APPLIED: ${what} (${reason}). This machine is running WITHOUT its team's settings until this is fixed.`;
  if (!expected && !announced) {
    announced = true;
    try {
      process.stderr.write(`golem: ${message}\n`);
    } catch {
      // stderr closed: the warning below still travels with the result.
    }
  }
  return {
    ...first,
    warnings: [...first.warnings, message],
    team: {
      fromCache: team.fromCache,
      applied: [],
      skipped: [],
      ...(team.notice !== undefined && { notice: team.notice }),
    },
    teamFailure: message,
  };
}
