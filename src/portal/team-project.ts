/**
 * Which portal project a team fetch resolved to, and the one warning it earns.
 *
 * A portal project is a named group of Golem settings and skills on the portal,
 * shared by one or more repos. It is unrelated to the `project` settings origin
 * (a repo's own `.golem/settings.json`); the two never share a word, which is
 * why every name here says "portal project".
 *
 * The portal answers a missing, deleted, archived or another team's slug with
 * the DEFAULT portal project's data plus a `project` field. Nothing is thrown
 * and nothing is withheld: the data is applied, and this module only turns the
 * marker into a value and a sentence.
 */

import { z } from "zod";
import { wireOptional } from "./client.js";

export type PortalProjectResolution =
  /** No portal project named: the team's default, exactly as before. */
  | { readonly kind: "default" }
  /** The named portal project was found and its data is what applies. */
  | { readonly kind: "found"; readonly slug: string }
  /** The named portal project did not apply; the default's data did. */
  | { readonly kind: "fallback"; readonly slug: string; readonly reason: string };

/** The `project` marker field on a settings or skills response. */
export const portalProjectMarkerSchema = wireOptional(z.string());

/**
 * Interpret a response's marker for the slug that was requested. An absent
 * marker means the portal project was found. An unrecognised marker still
 * means "not what you asked for", so it is a fallback carrying the raw word
 * rather than something silently treated as found.
 */
export function resolvePortalProject(
  slug: string,
  marker: string | null | undefined,
): PortalProjectResolution {
  if (slug === "") return { kind: "default" };
  const reason = (marker ?? "").trim();
  return reason === "" ? { kind: "found", slug } : { kind: "fallback", slug, reason };
}

/** Why the default portal project applied, as a clause. */
function reasonClause(reason: string): string {
  if (reason === "not_found") return "was not found in this team";
  if (reason === "archived") return "is archived";
  return `was not applied (the portal said "${reason}")`;
}

/** The sentence for a fallback. Names the slug, because the point is to be seen. */
export function describePortalProjectFallback(
  resolution: Extract<PortalProjectResolution, { kind: "fallback" }>,
): string {
  return (
    `Portal project "${resolution.slug}" ${reasonClause(resolution.reason)}, so this team's ` +
    `default portal project applies. Check \`team.project\` in .golem/settings.json.`
  );
}

/** Slugs already warned about, for the life of this process (one session). */
const warned = new Set<string>();

/**
 * The warning for a resolution, the first time this process sees that slug.
 * `undefined` for everything else, including every later sync of the same slug:
 * once per slug per session, never on every sync. Settings and skills share the
 * set, so one `golem team sync` run does not say it twice.
 */
export function warnPortalProjectOnce(resolution: PortalProjectResolution): string | undefined {
  if (resolution.kind !== "fallback") return undefined;
  if (warned.has(resolution.slug)) return undefined;
  warned.add(resolution.slug);
  return describePortalProjectFallback(resolution);
}

/** Test seam: forget what has been warned about. */
export function resetPortalProjectWarnings(): void {
  warned.clear();
}
