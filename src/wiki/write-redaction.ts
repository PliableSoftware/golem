/**
 * Redaction for everything that ends up in a wiki file NAME or body (DUST3.8).
 *
 * A distill slug becomes `.golem/distill/<slug>.md` and then a committed wiki
 * path, and `wiki_upsert`'s `rel_path` is stored as given, so names need the
 * same redactor as bodies. Kebab-casing and path syntax both defeat most token
 * shapes (`ghp_` loses its underscore, a hex run has no marker at all), so a
 * name is also refused when it carries a long opaque run: no title-derived
 * slug or hand-written page name has a 32-character word in it.
 */

import { createHash } from "node:crypto";
import { pipelineRedact, stripKnownSecrets } from "../hooks/redact.js";
import { redactIdentifierText } from "../pipeline/redaction.js";

/** The pipeline stage first, the built-in secret-strip floor on top (hooks/redact.ts). */
export function redactWikiText(text: string): string {
  return stripKnownSecrets(pipelineRedact(text));
}

const OPAQUE_RUN = /[A-Za-z0-9]{32,}/;

/**
 * True when `name` must not be used as a file name or slug as it stands.
 *
 * Uses the rule table WITHOUT the high-entropy sweep (`redactIdentifierText`):
 * the sweep treats any long hyphenated run as a candidate secret and flags
 * ordinary page names. Provider-shaped secrets are still caught by the rules,
 * and anything long and opaque by the run check below.
 */
export function nameLooksSecret(name: string): boolean {
  return stripKnownSecrets(redactIdentifierText(name)) !== name || OPAQUE_RUN.test(name);
}

/** First 8 hex of a sha256: enough to tell sources apart, not enough to expose one. */
export function sha8(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

/** A draft slug that is safe to use as a file name: unchanged, or `draft-<sha8 of the original>`. */
export function safeDraftSlug(slug: string): string {
  return nameLooksSecret(slug) ? `draft-${sha8(slug)}` : slug;
}

/** An explicit wiki path carried secret-shaped text. The message never echoes the path. */
export class UnsafeWikiPathError extends Error {
  constructor() {
    super(
      "rel_path contains secret-shaped text (a token or a long opaque run) and was refused; " +
        "nothing was written. Use a descriptive path without credentials or identifiers.",
    );
    this.name = "UnsafeWikiPathError";
  }
}

/**
 * Judge a wiki path SEGMENT by SEGMENT, never as a whole: the high-entropy sweep
 * over `dir/sub/page.md` flags real, committed page paths whose every segment is
 * fine alone. The final segment is judged without its `.md` suffix.
 */
export function assertSafeWikiPath(relPath: string): void {
  const segments = relPath.split(/[\\/]/).filter((segment) => segment !== "");
  const last = segments.length - 1;
  segments.forEach((segment, index) => {
    const name = index === last ? segment.replace(/\.md$/, "") : segment;
    if (nameLooksSecret(name)) throw new UnsafeWikiPathError();
  });
}
