/**
 * `default!` — the compiled-in floor (ADR-0008 §The floor (3), DUST2.16 / r004).
 *
 * A key named here resolves to its COMPILED-IN default no matter what any origin
 * says: `default!` is the strongest rung of the important band, so no file, no
 * `GOLEM_*` variable, no header and no team can move it. The resolver
 * (`loadConfig`) applies it after both bands, records the key's provenance as
 * `default` + `important`, and warns once per origin that tried to set it (the
 * warning never prints the origin's value).
 *
 * THE SEMANTICS, stated once: `default!` pins a key to its default. It is only
 * ever a floor when that default IS the strict value, so an entry is admitted
 * only when both hold —
 *
 * 1. the key is a boolean the team policy classifies with a declared stricter
 *    direction (`true-only` or `false-only`), and
 * 2. its compiled default is already that strict value.
 *
 * Anything else (a number, a list, a `settable` or `denied` key, a record that
 * merges per key) has no direction this module can verify, so it is rejected
 * rather than guessed. `proxy.bypass_all` is rejected by name as well: it is
 * `denied`, and a `default!` pin would also lock out its one documented CLI
 * path (`golem off`).
 *
 * The registry is deliberately EMPTY today: nothing Golem ships is a
 * non-negotiable that a person may not change. Adding a key is a USER decision
 * (see docs/plan/tasks/DUST2.16.md); the machinery and its invariants are what
 * this task delivers.
 */

import { DEFAULT_SETTINGS, leafSchema } from "./schema.js";
import { TEAM_POLICY } from "./team-policy.js";

export const DEFAULT_IMPORTANT_KEYS: ReadonlySet<string> = new Set<string>([]);

/** Why `dotted` may not be a `default!` entry, or undefined when it may. */
export function floorEntryProblem(dotted: string): string | undefined {
  const [section, key] = dotted.split(".", 2) as [string, string];
  if (dotted === "proxy.bypass_all") {
    return "proxy.bypass_all is CLI-only and may never be pinned (it would lock out `golem off`)";
  }
  if (leafSchema(section, key) === undefined) return `"${dotted}" is not a settings key`;
  const rule = (TEAM_POLICY as Readonly<Record<string, string>>)[dotted];
  if (rule !== "true-only" && rule !== "false-only") {
    return `"${dotted}" has no declared stricter direction (team class ${rule ?? "unclassified"})`;
  }
  const fallback = (DEFAULT_SETTINGS as unknown as Record<string, Record<string, unknown>>)[
    section
  ]?.[key];
  if (fallback !== (rule === "true-only")) {
    return `the compiled default of "${dotted}" is not its stricter value, so pinning it would not be a floor`;
  }
  return undefined;
}

/** Throws on the first entry that is not a valid floor — a programmer error, not a ConfigError. */
export function assertFloor(keys: ReadonlySet<string>): void {
  for (const dotted of keys) {
    const problem = floorEntryProblem(dotted);
    if (problem !== undefined) throw new Error(`invalid default! floor entry: ${problem}`);
  }
}
