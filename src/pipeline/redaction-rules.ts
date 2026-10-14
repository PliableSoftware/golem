/**
 * WS-A A3 — the redaction rule table (T-C3 security-review audit surface).
 *
 * Every secret/PII detector Golem applies before content is transformed,
 * stored, or forwarded lives in this ONE table, in the ONE order it is
 * applied. To extend redaction, append a rule here and add its positive +
 * negative cases to tests/unit/pipeline/redaction-corpus.ts (the T-C3 audit
 * corpus). Never remove or loosen a rule outside a T-C3-reviewed change
 * (CLAUDE.md hard rule: never weaken the redaction stage).
 *
 * Determinism contract (prompt-cache prefix stability, verification-notes
 * §14): matching is pure regex + pure validators over the input text — no
 * clock, no randomness, no config. Rule ORDER is part of the contract: rules
 * run in table order, left-to-right within a rule, and earlier replacements
 * are invisible to later rules (placeholders contain `[`/`]`/`:` which no
 * rule's charset matches, so redaction is idempotent; `connection-password`,
 * whose group does match them, excludes a whole placeholder explicitly — S10).
 * tests/unit/pipeline/redaction.test.ts proves the claim for every rule.
 *
 * The generic high-entropy detector runs AFTER the table (see redaction.ts)
 * so provider-specific rules win the placeholder kind for strings both would
 * match.
 */

/** One auditable redaction rule. */
export interface RedactionRule {
  /** Placeholder kind: `[REDACTED:<id>:<n>]`. Stable — telemetry keys off it. */
  readonly id: string;
  /** What the rule catches and why the pattern is shaped the way it is. */
  readonly description: string;
  /** MUST carry the `g` flag. Applied in table order, left-to-right. */
  readonly pattern: RegExp;
  /**
   * Capture group to redact instead of the whole match (e.g. only the
   * password inside a connection string). Default: whole match.
   */
  readonly group?: number;
  /** Extra pure check on the redaction target (e.g. Luhn). Default: accept. */
  readonly validate?: (target: string) => boolean;
  /**
   * Extra pure check that needs the text AROUND the target (`start`/`end` are the
   * target's span in `text`). Runs after {@link validate}; a `false` leaves the
   * match as-is. Default: accept.
   */
  readonly validateAt?: (text: string, start: number, end: number) => boolean;
  /**
   * Exclusive end of the part of `text` that can hold a match. The rule is applied
   * to `text.slice(0, scanEnd(text))`. For a pattern whose every match must END at
   * a marker (a PEM block's END line): a start with no marker after it fails only
   * after scanning to the end of the text, so thousands of such starts are
   * quadratic. Bounding the haystack at the last marker makes every remaining start
   * stop at the next one. Must never return less than the end of the last possible
   * match. Default: the whole text.
   */
  readonly scanEnd?: (text: string) => number;
  /**
   * For a whole-match rule whose pattern matches only the TAIL of the thing to
   * redact: where the redaction span really starts. `start` is the match's start,
   * `floor` the end of the previous redaction (the span may not reach back past it).
   * Returns an integer in `[floor, start]`, or -1 for "not a match". Anything else
   * is treated as `floor`: toward MORE redaction. Lets a rule anchor on a rare
   * character (`@`) instead of trying a start at every position.
   */
  readonly extendStart?: (text: string, start: number, floor: number) => number;
}

/** Luhn checksum over the digits of `target` (separators allowed). */
export function luhnValid(target: string): boolean {
  const digits = target.replace(/[ -]/g, "");
  if (!/^\d{13,19}$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Whether `target`'s separators (if any) are a single consistent character —
 * all spaces or all dashes, never mixed. Real cards are written with one
 * grouping style; a mix is a sign the digits were never meant to be read as
 * one number (verification-notes §50).
 */
function hasConsistentSeparatorChar(target: string): boolean {
  const seps = target.match(/[ -]/g);
  return seps === null || seps.every((s) => s === seps[0]);
}

/**
 * Whether every digit group between separators in `target` is the same
 * length. A contiguous run (no separators at all) trivially passes — there
 * is nothing to compare. Real card grouping is regular (e.g. 4-4-4-4); an
 * ASCII/byte dump of space-separated decimal values groups irregularly (1-3
 * digits per value, verification-notes §50's actual false-positive), so
 * requiring uniform group length rejects it without needing to hardcode
 * every real card-network grouping scheme.
 */
function hasUniformGrouping(target: string): boolean {
  const groups = target.split(/[ -]/);
  const firstLength = groups[0]?.length ?? 0;
  return groups.every((g) => g.length === firstLength);
}

/**
 * Combined credit-card validator: Luhn-valid AND, if separators are present,
 * formatted like a real card (one consistent separator, uniform grouping).
 * Tightens the bare Luhn gate, which let sparse/irregularly-separated digit
 * runs (e.g. space-separated ASCII byte dumps) through by chance
 * (verification-notes §50).
 */
export function isCreditCardLike(target: string): boolean {
  return luhnValid(target) && hasConsistentSeparatorChar(target) && hasUniformGrouping(target);
}

/**
 * Longest alphanumeric stretch {@link isOutsideHexToken} reads on each side of a
 * digit run. A bound, so a multi-megabyte hex dump costs a constant per candidate
 * rather than a rescan of the dump.
 */
const HEX_CONTEXT_MAX_CHARS = 64;

const isAsciiAlnum = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isHexChar = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

/**
 * DUSTSEC.24 boundary rule for the credit-card rule: a digit run is NOT a card
 * when it is glued, with no separator, onto a hex-only alphanumeric token, i.e.
 * the characters touching it (up to {@link HEX_CONTEXT_MAX_CHARS} each side,
 * counting `[A-Za-z0-9]` only) are all `[0-9A-Fa-f]` and at least one exists.
 * Hashes, hex-encoded blobs and memory dumps hold Luhn-valid digit runs by chance
 * (about 1 in 10 per run), and rewriting them corrupts the value.
 *
 * Only a separator-free run is exempt; one with spaces or dashes inside is always
 * redacted. Everything else is unchanged: a number standing alone, or touching punctuation,
 * whitespace, `_`, a non-hex letter ("Visa4111...", "4111...USD") or a mixed token,
 * is still redacted. A side that fills the whole window and is all hex counts as
 * a long hex token.
 */
export function isOutsideHexToken(text: string, start: number, end: number): boolean {
  // A run with a space or dash inside is not a hex token, whatever touches it.
  for (let i = start; i < end; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 45) return true;
  }
  let left = start;
  while (
    left > 0 &&
    start - left < HEX_CONTEXT_MAX_CHARS &&
    isAsciiAlnum(text.charCodeAt(left - 1))
  ) {
    left -= 1;
  }
  let right = end;
  while (
    right < text.length &&
    right - end < HEX_CONTEXT_MAX_CHARS &&
    isAsciiAlnum(text.charCodeAt(right))
  ) {
    right += 1;
  }
  if (left === start && right === end) return true;
  for (let i = left; i < start; i += 1) {
    if (!isHexChar(text.charCodeAt(i))) return true;
  }
  for (let i = end; i < right; i += 1) {
    if (!isHexChar(text.charCodeAt(i))) return true;
  }
  return false;
}

/**
 * `scanEnd` for the private-key rule: the end of the last COMPLETE END line, i.e.
 * the last place the rule's own END pattern (`-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----`)
 * matches. Every match of the rule ends at one, so nothing past it can match. The
 * original rule redacted nothing for a BEGIN with no END after it, and this keeps
 * that: no complete END at all means a bound of 0.
 *
 * Bounding at the last complete END (not at the last `-----END ` text) matters: a
 * trailing `-----END CERTIFICATE-----`, or an END line cut short, would leave every
 * BEGIN before it scanning to the end of the text. Each candidate is tried with a
 * sticky match at its own `-----END ` occurrence, so the cost is one bounded run of
 * `[A-Z0-9 ]` per occurrence.
 */
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/y;

function privateKeyScanEnd(text: string): number {
  let end = 0;
  for (let at = text.indexOf("-----END "); at >= 0; at = text.indexOf("-----END ", at + 1)) {
    PRIVATE_KEY_END.lastIndex = at;
    const m = PRIVATE_KEY_END.exec(text);
    if (m !== null) end = Math.max(end, at + m[0].length);
  }
  return end;
}

const isWordChar = (c: number): boolean => isAsciiAlnum(c) || c === 95;
const isEmailLocalChar = (c: number): boolean =>
  isWordChar(c) || c === 46 || c === 37 || c === 43 || c === 45;

/**
 * `extendStart` for the email rule: the local part before the `@` at `at`. The
 * run of `[A-Za-z0-9._%+-]` ending there, at most 128 characters and not reaching
 * back past `floor`, starting at its first word character (the original rule began
 * at the first `\b`, which is that character). -1 when there is none.
 */
function emailLocalStart(text: string, at: number, floor: number): number {
  const lo = Math.max(floor, at - 128);
  let i = at;
  while (i > lo && isEmailLocalChar(text.charCodeAt(i - 1))) i -= 1;
  // Resuming right after a previous match, the original's `\b` fell between that match's last
  // letter and a punctuation start, so the span begins on the punctuation.
  if (i === floor && i < at && i > 0 && isWordChar(text.charCodeAt(i - 1))) return i;
  while (i < at && !isWordChar(text.charCodeAt(i))) i += 1;
  return i < at ? i : -1;
}

/**
 * The rule table. Order is load-bearing and part of the audit surface:
 * multi-line PEM blocks first (their base64 body would otherwise be shredded
 * by narrower rules), provider-specific key shapes next (most specific
 * first: `sk-ant-` before the generic `sk-` OpenAI shape), structured
 * formats (JWT, connection strings), then PII (card numbers, emails).
 */
const BUILT_IN_RULES: readonly RedactionRule[] = [
  {
    id: "private-key",
    description:
      "PEM private key blocks (RSA/EC/DSA/OPENSSH/PKCS#8, encrypted or not). " +
      "Matched as a whole block, including the base64 body, so nothing " +
      "downstream sees any part of the key material.",
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/g,
    // DUSTSEC.24: BEGIN lines with no END after them re-scanned to the end of the text each.
    scanEnd: privateKeyScanEnd,
  },
  {
    id: "aws-key",
    description:
      "AWS access key IDs: fixed 4-char prefix (AKIA/ASIA/ABIA/ACCA/A3T*) + " +
      "16 uppercase-alphanumeric chars, 20 chars total.",
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA|A3T[A-Z0-9])[A-Z0-9]{16}\b/g,
  },
  {
    id: "aws-secret-key",
    description:
      "AWS secret access keys: 40-char base64-ish value adjacent to an " +
      "aws/secret-access-key context word. The bare 40-char shape alone is " +
      "too common to match without context; uncontexted secrets are still " +
      "caught by the high-entropy detector.",
    pattern:
      /\b(?:aws_?)?secret_?(?:access_?)?key\b["'\s:=]{1,5}([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi,
    group: 1,
  },
  {
    id: "github-token",
    description:
      "GitHub tokens: classic/fine-grained prefixes ghp_/gho_/ghu_/ghs_/ghr_ " +
      "(36+ alphanumeric) and github_pat_ (22+ chars).",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g,
  },
  {
    id: "anthropic-key",
    description: "Anthropic API keys: sk-ant- prefix. Listed before the generic sk- rule.",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{16}[A-Za-z0-9_-]*\b/g,
  },
  {
    id: "openai-key",
    description:
      "OpenAI API keys: sk- prefix (incl. sk-proj-/sk-svcacct-) followed by a " +
      "long token; negative lookahead excludes sk-ant- (Anthropic rule above).",
    pattern: /\bsk-(?!ant-)[A-Za-z0-9_-]{32}[A-Za-z0-9_-]*\b/g,
  },
  {
    id: "slack-token",
    description: "Slack tokens: xoxb-/xoxa-/xoxp-/xoxr-/xoxs-/xoxe- prefixes.",
    pattern: /\bxox[baprse]-[A-Za-z0-9-]{10}[A-Za-z0-9-]*\b/g,
  },
  {
    id: "google-api-key",
    description:
      "Google API keys: AIza prefix + 35 base64url-ish chars (39 chars total, " +
      "the fixed real-world shape). Comfortably above the entropy net's 32-char " +
      "floor, but a dedicated rule labels it correctly instead of falling " +
      "through as generic high-entropy (verification-notes §24).",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: "stripe-key",
    description:
      "Stripe live secret keys: sk_live_ prefix (underscore, not the sk- " +
      "hyphen shape the openai-key rule matches) + 24-99 alphanumeric chars " +
      "(verification-notes §24).",
    pattern: /\bsk_live_[A-Za-z0-9]{24,99}\b/g,
  },
  {
    id: "gcp-oauth-token",
    description:
      "GCP OAuth2 access tokens: ya29. prefix + 20-120 base64url chars. The " +
      "shortest real tokens sit near the entropy net's 32-char floor once the " +
      "5-char prefix is included, so a dedicated rule is needed to not miss " +
      "them (verification-notes §24).",
    pattern: /\bya29\.[A-Za-z0-9_-]{20,120}\b/g,
  },
  {
    id: "jwt",
    description:
      "JSON Web Tokens: three dot-separated base64url segments where the " +
      'header starts with eyJ (base64 of `{"`).',
    pattern:
      /\beyJ[A-Za-z0-9_-]{8}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{8}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{8}[A-Za-z0-9_-]*\b/g,
  },
  {
    id: "connection-password",
    description:
      "Credentials embedded in connection-string URLs " +
      "(scheme://user:password@host). Only the password is redacted so the " +
      "scheme, user, and host stay legible to the model.",
    // DUSTSEC.24: anchored on the `:` before `//`. The scheme is checked by an UNBOUNDED
    // look-behind (a letter, then any run of scheme characters, then the colon): the
    // original's `\b[a-zA-Z][a-zA-Z0-9+.-]*:` minus the `\b`, so a scheme of any length
    // qualifies, and so does one glued onto other word characters. The colon is outside
    // the scheme class, so each look-behind walks only its own run and the cost stays
    // linear. A start at every letter was quadratic on `a.a.a.`; a `\b` or a bounded
    // look-behind let a password leak that the original redacted. Only the password is
    // redacted, so where the match starts changes nothing. The rest is the original's:
    // every `scheme://user:password@` it matched is matched here with the same password
    // span (this pattern matches a SUPERSET of it, never fewer).
    // The lookahead skips a group that is EXACTLY one connection-password
    // placeholder, so a second pass over already-redacted text cannot re-match
    // (and renumber) it (S10). It names that ONE kind and anchors on `]@`: a
    // password shaped like any other placeholder (attacker-chosen kind text, or
    // another rule's placeholder) is still redacted, as before. DELIBERATELY no wider:
    // a wider exemption (any known kind, or "starts with a placeholder") hides a real
    // password that follows placeholder-looking text (`email:1]hunter2`), and a leak
    // loses to idempotence. The cost is that a glued scheme can be re-redacted on a
    // second pass (over-redaction only).
    pattern:
      /:(?<=[a-zA-Z][a-zA-Z0-9+.-]*:)\/\/[^\s:@/]+:(?!\[REDACTED:connection-password:\d+\]@)([^\s@/]+)@/g,
    group: 1,
  },
  {
    id: "azure-account-key",
    description:
      "Azure Storage account connection strings: only the AccountKey= value " +
      "is redacted (base64, 20-100 chars incl. optional = padding), leaving " +
      "AccountName/EndpointSuffix legible — same pattern as connection-password " +
      "(verification-notes §24).",
    pattern: /\bAccountKey=([A-Za-z0-9+/]{20,100}={0,2})(?=;|$)/g,
    group: 1,
  },
  {
    id: "credit-card",
    description:
      "Credit-card-like numbers: 13-19 digits with optional space/dash " +
      "separators, gated by a Luhn checksum (rejects IDs and phone numbers) " +
      "plus a separator-format check (single consistent character, uniform " +
      "grouping — rejects sparse/irregular digit runs like ASCII byte dumps " +
      "that pass Luhn by chance, verification-notes §50). A run glued onto a " +
      "hex token (see isOutsideHexToken) is part of that token, not a card " +
      "(DUSTSEC.24).",
    pattern: /(?<![\d.-])\d(?:[ -]?\d){12,18}(?![\d.-])/g,
    validate: isCreditCardLike,
    validateAt: isOutsideHexToken,
  },
  {
    id: "email",
    description: "Email addresses (PII).",
    // DUSTSEC.24: the pattern matches `@domain` only, and `extendStart` reaches back over
    // the local part (see emailLocalStart). A pattern that started at every position of
    // a long run was quadratic on `a.a.a.` (no `@`), and with a leading `\b` or a bound
    // it either skipped candidates or cost 128 steps per character of a 10 MB run.
    // The local part is at most 128 characters (RFC 5321 caps it at 64): a longer one
    // has its last 128 characters and the whole domain redacted, only the head beyond
    // that stays. For an address that fits, the span is the original rule's: from the
    // first word character of the run before the `@`.
    pattern: /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    extendStart: emailLocalStart,
  },
  {
    id: "nostr-secret-key",
    description:
      "R14.3 (Buzz integration) — Nostr secret keys in NIP-19 bech32 form " +
      "(`nsec1...`). `buzz-acp` injects one into `golem acp`'s subprocess " +
      "environment as `BUZZ_PRIVATE_KEY`; it must never reach a log, " +
      "telemetry, or the KB. The class is the bech32 alphabet (excludes 1/i/o). " +
      "No trailing \\b: a secret glued to a following word char (e.g. a log " +
      "line suffix) must still match, and dropping the boundary can only widen " +
      "redaction, never weaken it. The `i` flag covers bech32's valid " +
      "all-uppercase form.",
    pattern: /\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{58}[023456789acdefghjklmnpqrstuvwxyz]*/gi,
  },
];

// DUSTSEC.7 (R5): `readonly` is a type-level promise only. `BUILT_IN_RULES` is
// module-private and frozen (array and each rule object), and it is the only
// table redaction ever reads. The exported `REDACTION_RULES` is a frozen COPY
// with its own RegExp objects: freezing a RegExp does not stop
// `re.compile(...)` from rewriting its source, so a caller holding a rule's
// `pattern` must not be holding the one redaction runs.
for (const rule of BUILT_IN_RULES) Object.freeze(rule);
Object.freeze(BUILT_IN_RULES);

/** Frozen copy of the built-in table, safe to hand out: mutating it changes nothing. */
export const REDACTION_RULES: readonly RedactionRule[] = Object.freeze(
  BUILT_IN_RULES.map((rule) =>
    Object.freeze({ ...rule, pattern: new RegExp(rule.pattern.source, rule.pattern.flags) }),
  ),
);

// ---------------------------------------------------------------------------
// High-entropy heuristic (applied after the table; see redaction.ts).
// ---------------------------------------------------------------------------

/** Placeholder kind used by the entropy detector. */
export const ENTROPY_RULE_ID = "high-entropy";

/**
 * Candidate tokens for the entropy check: unbroken runs of the characters
 * secrets are made of (base64/base64url + separators used inside single
 * tokens), BOUNDED to a credential-plausible length.
 *
 * - Floor 32: real API secrets are almost always >= 32 chars; shorter floods
 *   dev traffic with false positives.
 * - Ceiling {@link ENTROPY_MAX_CANDIDATE_CHARS}: a run longer than this is not a
 *   credential — it is DATA (a base64 image, a minified/encoded blob, an inline
 *   attachment). Redacting those is lossy over-redaction that strips content
 *   Claude needs and silently inflates "savings" (verification-notes §31/§37).
 *   Every known provider secret (Anthropic, AWS, GitHub, Slack, JWT, private-key
 *   PEM bodies handled by their own rules) fits well under the ceiling.
 */
export const ENTROPY_MAX_CANDIDATE_CHARS = 128;
// Lookarounds require the WHOLE unbroken run to be 32–128 chars: a longer run
// (a big blob) has a candidate char just past 128, so the lookahead fails and it
// is NOT matched at all — we never redact a 128-char slice out of the middle of
// a 20 KB image. Delimiters are any non-candidate char (or string edge).
export const ENTROPY_CANDIDATE_RE =
  /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{32,128}(?![A-Za-z0-9+/=_-])/g;

/**
 * DUSTSEC.20 — the ONLY exemption from the entropy sweep: a candidate token that
 * is, in its entirety, an Anthropic API object id of a documented shape. The API
 * rejects a placeholder in an id field, so rewriting one fails the request.
 *
 * Strictly anchored, never a substring: `^prefix_01[A-Za-z0-9]{22}$` on the whole
 * candidate run (the sweep's lookarounds already make that the whole unbroken
 * token), so a longer run, a wrong prefix, a wrong length, or a secret appended
 * to or wrapped around an id is still redacted. No field names, no bare length.
 *
 * Only families whose shape the official docs show are listed (verification-notes,
 * DUSTSEC.20): `srvtoolu_` and `msgbatch_`, each 24 base62 characters after the
 * prefix, and every documented example leads with `01` (so the lead is required). `container_` ids have NO documented example or format, so they are NOT
 * exempt until one is established from an official source. Applies to every
 * caller of the sweep (tool output, storage), which is harmless.
 *
 * KNOWN RESIDUAL: an id-shaped value is exempt even after `Bearer ` or in a
 * credential header; no built-in rule covers those values.
 */
const API_ID_RE = /^(?:srvtoolu|msgbatch)_01[A-Za-z0-9]{22}$/;

/** Whether `token` is, as a whole, a documented-shape Anthropic API object id. */
export function isApiObjectId(token: string): boolean {
  return API_ID_RE.test(token);
}

/**
 * DUSTSEC.22 — secrets glued inside an OVER-LENGTH unbroken run.
 *
 * The sweep ignores a run longer than {@link ENTROPY_MAX_CANDIDATE_CHARS} (it is
 * data: base64 images, thinking signatures), and a named rule's leading `\b`
 * fails when its prefix is glued onto a preceding word character. So an API id
 * followed with no separator by a real key, 141+ characters in all, used to
 * reach the upstream whole.
 *
 * The fix scans INSIDE such a run for the named rules' prefix shapes and
 * redacts only the matched span. It never redacts a whole run, so a signature,
 * an image or a digest holding no named-prefix secret is byte-identical.
 *
 * Two classes, chosen by the chance a prefix shape occurs in DATA. Rates are per
 * position, derived and then measured on 5000 random blobs per corpus (table in
 * verification-notes, DUSTSEC.22):
 * - {@link EMBEDDED_ANYWHERE}: `sk-ant-` (7 fixed chars, needs `-`: about 2e-13 in
 *   base64url, impossible in hex/base32/base64), `github_pat_` (11), `sk_live_`
 *   (8), `nsec1` + 58 bech32 (`1` is outside hex/base32; the 58-char tail is
 *   about 1e-18 in base64) and `AccountKey=`. All are 0 hits in the corpora.
 * - {@link EMBEDDED_AT_EDGE}: shapes that DO occur in data by chance. The AWS
 *   family (`AKIA`/`ASIA`/`ABIA`/`ACCA`/`A3T?` + 16 of `[A-Z0-9]`) is valid
 *   uppercase hex and base32: about 16^-4 = 1.5e-5 per position in uppercase hex
 *   (a 4096-char hex dump changed 6.6% of the time when it scanned anywhere), 3e-11
 *   in base64. Also `ghp_`-family, `xox*-`, `AIza` and `sk-`. These match only
 *   when the shape runs from the run's START or to its END (where a glued secret
 *   sits), so a blob offers two positions, not thousands.
 *
 * Pieces: a match splits a run; each remaining piece that is still over the
 * ceiling gets its edges re-checked, repeatedly, so the result is a fixpoint
 * (a second pass changes nothing). Linear: every edge check runs on a window of
 * {@link EDGE_WINDOW_CHARS} chars and every peel removes at least 20.
 *
 * KNOWN RESIDUAL: an over-length run with NO named prefix (a plain random key)
 * is indistinguishable from base64 data and is left alone; so is an AWS, `AIza`,
 * `ghp_`, `xox` or `sk-` secret with junk glued on BOTH sides (it is not at an
 * edge, and scanning the middle corrupts hex/base32 dumps); and a JWT (its dots
 * end the run).
 */
/** Whether `c` (a UTF-16 code unit) is in the entropy candidate charset `[A-Za-z0-9+/=_-]`. */
function isRunChar(c: number): boolean {
  return (
    (c >= 97 && c <= 122) ||
    (c >= 65 && c <= 90) ||
    (c >= 48 && c <= 57) ||
    c === 43 ||
    c === 47 ||
    c === 61 ||
    c === 95 ||
    c === 45
  );
}

/**
 * `[start, end)` of every unbroken candidate-charset run longer than the sweep's
 * ceiling. A plain loop, not a regex: V8's backtracking matcher overflows its
 * stack on a greedy quantifier over a multi-megabyte run (measured at 10 MB).
 */
export function findOverlengthRuns(text: string): [start: number, end: number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= text.length; i += 1) {
    if (i < text.length && isRunChar(text.charCodeAt(i))) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start > ENTROPY_MAX_CANDIDATE_CHARS) runs.push([start, i]);
      start = -1;
    }
  }
  return runs;
}

/** One in-run pattern: the placeholder kind it reports, and its pattern. */
export interface EmbeddedRule {
  readonly id: string;
  readonly pattern: RegExp;
}

/** The nostr rule's own bech32 class, so the in-run pattern cannot drift from it. */
function nostrEmbeddedPattern(): RegExp {
  const nostr = BUILT_IN_RULES.find((r) => r.id === "nostr-secret-key");
  // The named rule's tail is `{58}` + `*` (DUSTSEC.24: written that way so V8 does not
  // overflow its regex stack on a multi-megabyte run); bound it to `{58,255}` here.
  const bech32 = /^\\bnsec1(\[[^\]]+\])\{58\}\1\*$/.exec(nostr?.pattern.source ?? "")?.[1];
  return new RegExp(bech32 === undefined ? "nsec1(?!)" : `nsec1${bech32}{58,255}`, "gi");
}

export const EMBEDDED_ANYWHERE: readonly EmbeddedRule[] = Object.freeze([
  { id: "anthropic-key", pattern: /sk-ant-[A-Za-z0-9_-]{16,512}/g },
  { id: "github-token", pattern: /github_pat_[A-Za-z0-9_]{22,255}/g },
  { id: "stripe-key", pattern: /sk_live_[A-Za-z0-9]{24,99}/g },
  { id: "nostr-secret-key", pattern: nostrEmbeddedPattern() },
  { id: "azure-account-key", pattern: /(?<=AccountKey=)[A-Za-z0-9+/]{20,100}={0,2}/g },
]);

const AWS_EDGE = "(?:AKIA|ASIA|ABIA|ACCA|A3T[A-Z0-9])[A-Z0-9]{16}";
const OTHER_EDGE = [
  "gh[pousr]_[A-Za-z0-9]{36}",
  "xox[baprse]-[A-Za-z0-9-]{10,255}",
  "AIza[0-9A-Za-z_-]{35}",
  // Only the documented openai shapes: `sk-` alone chance-matches in base64url.
  "sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{32,256}",
  "sk-[A-Za-z0-9]{48}",
].join("|");

/** Longest edge shape (`sk-` + 256) plus slack; the window the edge patterns run on. */
export const EDGE_WINDOW_CHARS = 300;

/** Edge patterns: `kind` is taken from the matched prefix, see {@link edgeKind}. */
export const EMBEDDED_AT_EDGE = Object.freeze({
  start: new RegExp(`^(?:${AWS_EDGE}|${OTHER_EDGE})`),
  end: new RegExp(`(?:${AWS_EDGE}|${OTHER_EDGE})$`),
  // Same shapes without the AWS family, for a run that is all uppercase
  // alphanumerics: that is a hex dump or base32 data, where the AWS shape is
  // chance (1.5e-5 per edge in hex), so it is not scanned.
  startNoAws: new RegExp(`^(?:${OTHER_EDGE})`),
  endNoAws: new RegExp(`(?:${OTHER_EDGE})$`),
});

/** An uppercase-only run is hex/base32 data, not a place an AWS key is glued. */
function isUpperOnly(run: string): boolean {
  for (let i = 0; i < run.length; i += 1) {
    const c = run.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 61)) return false;
  }
  return true;
}

/** Placeholder kind for an edge match, by its prefix. */
export function edgeKind(match: string): string {
  if (match.startsWith("gh")) return "github-token";
  if (match.startsWith("xox")) return "slack-token";
  if (match.startsWith("AIza")) return "google-api-key";
  if (match.startsWith("sk-")) return "openai-key";
  return "aws-key";
}

/** A span of an over-length run to redact. */
export interface EmbeddedSpan {
  readonly start: number;
  readonly end: number;
  readonly id: string;
}

/**
 * Every named-prefix secret span inside one over-length `run`, sorted. Spans may
 * touch but never overlap (an overlapping later span extends the earlier one);
 * touching spans stay separate so each keeps its own kind.
 */
export function findEmbeddedSecrets(run: string): EmbeddedSpan[] {
  const found: EmbeddedSpan[] = [];
  for (const rule of EMBEDDED_ANYWHERE) {
    for (const m of run.matchAll(rule.pattern)) {
      if (m[0] !== "") found.push({ start: m.index, end: m.index + m[0].length, id: rule.id });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const spans: EmbeddedSpan[] = [];
  for (const span of found) {
    const last = spans[spans.length - 1];
    if (last === undefined || span.start >= last.end) spans.push(span);
    else if (span.end > last.end) spans[spans.length - 1] = { ...last, end: span.end };
  }
  // The pieces between spans each have fresh edges once the spans are replaced.
  const edges: EmbeddedSpan[] = [];
  const upperOnly = isUpperOnly(run);
  let from = 0;
  for (const span of [...spans, { start: run.length, end: run.length, id: "" }]) {
    peelEdges(run, from, span.start, edges, upperOnly);
    from = span.end;
  }
  return [...spans, ...edges].sort((a, b) => a.start - b.start);
}

/** Peel edge-shaped secrets off the piece `[lo, hi)` while it is still over the ceiling. */
function peelEdges(
  run: string,
  lo: number,
  hi: number,
  out: EmbeddedSpan[],
  upperOnly: boolean,
): void {
  const startRe = upperOnly ? EMBEDDED_AT_EDGE.startNoAws : EMBEDDED_AT_EDGE.start;
  const endRe = upperOnly ? EMBEDDED_AT_EDGE.endNoAws : EMBEDDED_AT_EDGE.end;
  let progress = true;
  while (progress && hi - lo > ENTROPY_MAX_CANDIDATE_CHARS) {
    progress = false;
    const head = startRe.exec(run.slice(lo, lo + EDGE_WINDOW_CHARS));
    if (head !== null) {
      out.push({ start: lo, end: lo + head[0].length, id: edgeKind(head[0]) });
      lo += head[0].length;
      progress = true;
      if (hi - lo <= ENTROPY_MAX_CANDIDATE_CHARS) break;
    }
    const base = Math.max(lo, hi - EDGE_WINDOW_CHARS);
    const tail = endRe.exec(run.slice(base, hi));
    if (tail !== null) {
      out.push({ start: base + tail.index, end: hi, id: edgeKind(tail[0]) });
      hi = base + tail.index;
      progress = true;
    }
  }
}

/**
 * Shannon-entropy threshold in bits/char. Random 32+ char base62 material
 * measures ~4.5-5.0 on its own sample; camelCase identifiers and English
 * words sit near 3.5-4.0.
 */
export const ENTROPY_THRESHOLD_BITS = 4.2;

/** Shannon entropy of `text` in bits/char, measured on its own alphabet. */
export function shannonEntropy(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const ch of text) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * Subresource-integrity / content-hash prefixes (`sha512-<base64>` etc.). These
 * saturate lockfiles (npm `integrity`) and are content hashes, NOT secrets —
 * redacting them is incidental, mislabels non-secrets, and inflates "savings"
 * (verification-notes §31). A real API key never carries an SRI algo prefix.
 */
const INTEGRITY_HASH_RE = /^(sha1|sha224|sha256|sha384|sha512|md5)-/i;

/**
 * Whether a candidate is shaped like a repo path or a versioned/slugged
 * filename rather than random secret material (verification-notes §49): a
 * whole path (`docs/decisions/ADR-0012-file-watcher`) forms one
 * candidate token because `/` sits in the entropy charset, and a path with
 * mixed case + digits (ADR numbers, dates) can measure above the entropy
 * threshold on its own alphabet.
 *
 * Splitting on the path/identifier delimiters `/`, `-`, `_` distinguishes the
 * two: every chunk of a real path or slug is a clean word or a clean number
 * (`docs`, `wiki`, `ADR`, `0012`, `file`, `watcher`). A chunk of real random
 * secret material drawn from a 64-symbol alphabet is very unlikely to land
 * entirely in one class — a handful of characters from base64/base64url have
 * good odds of mixing a letter and a digit — so requiring EVERY chunk to be
 * purely alphabetic or purely numeric is a strong non-secret signal without
 * blanket-excluding `/` (standard-base64 secrets legitimately contain it).
 * Single-chunk tokens (no delimiter at all) are left to the entropy check.
 *
 * verification-notes §140 extends this for a path that embeds a UUID/SHA
 * segment (a scratchpad dir like `…/f70383e6-a18c-…/scratchpad`, or
 * `.claude/worktrees/agent-<uuid>`): such a segment (`f70383e6`, `9c3e`)
 * mixes digits and hex letters, so it is neither purely alphabetic nor purely
 * numeric and — before this fix — disqualified the WHOLE path from the
 * exclusion above, even though the same UUID standing alone is already
 * treated as non-secret (see the pure-hex exclusion in
 * {@link isHighEntropyToken}). The fix: also accept a chunk that is purely
 * hex (`^[0-9a-fA-F]+$`).
 *
 * Why this cannot let a hyphenated random secret slip through: a chunk that
 * mixes digits and hex letters (a-f) — the only NEW case this admits, since a
 * chunk that is purely alphabetic or purely numeric was already accepted —
 * only reaches this function at all if some OTHER chunk of the same token is
 * a genuine word containing a letter outside a-f. If every chunk were
 * confined to the hex alphabet, the token's characters (delimiters aside)
 * would be a subset of `0-9a-fA-F`, and {@link isHighEntropyToken} already
 * excludes that case earlier (pure hex, dehyphenated) before this function
 * runs — a bare UUID or SHA never reaches here. So a mixed-hex chunk here
 * always sits alongside a real word chunk (`scratchpad`, `worktrees`,
 * `agent`, `Users`), which is exactly the shape of a path, not a disguised
 * secret. `MIN_CHUNKS_FOR_HEX_ALLOWANCE` is a second, independent guard on
 * top of that argument (belt-and-braces, not load-bearing on its own): real
 * paths carrying an embedded UUID/hash run to many segments, while a short
 * two-chunk `word-hexvalue` pair is refused and left to the entropy check.
 */
const PATH_CHUNK_ALPHA_RE = /^[A-Za-z]+$/;
const PATH_CHUNK_NUMERIC_RE = /^[0-9]+$/;
const PATH_CHUNK_HEX_RE = /^[0-9a-fA-F]+$/;

/** See the `MIN_CHUNKS_FOR_HEX_ALLOWANCE` paragraph in {@link isPathLikeToken}'s doc comment. */
const MIN_CHUNKS_FOR_HEX_ALLOWANCE = 3;

/**
 * DUST2.23 / DUST1.1 headline 9 — `=` and `+` are path/URL delimiters too
 * (`--out=/a/b`, `OUT_DIR=/a/b`, `?q=Alice+Bob`). Before, a chunk carrying one failed
 * the alpha/numeric/hex test, so the whole token lost the exemption and a long,
 * varied, ordinary path was redacted (over-redaction, not a leak). They now split
 * chunks like `/_-`, but a token that contains one is judged by a STRICTER rule
 * ("strict mode"), because `=`/`+` are also base64 characters and `key=<secret>` is
 * the commonest way a secret is written down:
 *
 * - at least {@link MIN_CHUNKS_STRICT} chunks, so `key=<one secret run>` (two chunks)
 *   never qualifies, whatever the run looks like;
 * - every alphabetic chunk longer than {@link STRICT_FREE_ALPHA_CHARS} letters must
 *   be word-shaped ({@link STRICT_WORD_RE}: lower, UPPER, Capitalized, or CamelCase
 *   with every hump at least three letters). A random letters-only chunk of that
 *   length is essentially never word-shaped, so a secret cannot hide among words.
 *
 * Tokens with no `=`/`+` take exactly the old path, byte for byte.
 */
const PATH_DELIMITER_RE = /[/_=+-]/;
const MIN_CHUNKS_STRICT = 3;
const STRICT_FREE_ALPHA_CHARS = 3;
const STRICT_WORD_RE =
  /^(?:[A-Z][a-z]{2,}|[a-z]{3,}|[A-Z]{2,}(?![a-z]))(?:[A-Z][a-z]{2,}|[a-z]{3,}|[A-Z]{2,}(?![a-z]))*$/;

function isPathLikeToken(token: string): boolean {
  const chunks = token.split(PATH_DELIMITER_RE).filter((c) => c.length > 0);
  if (chunks.length < 2) {
    return false;
  }
  const strict = token.includes("=") || token.includes("+");
  if (strict && chunks.length < MIN_CHUNKS_STRICT) {
    return false;
  }
  let hasMixedHexChunk = false;
  for (const chunk of chunks) {
    if (PATH_CHUNK_ALPHA_RE.test(chunk)) {
      if (strict && chunk.length > STRICT_FREE_ALPHA_CHARS && !STRICT_WORD_RE.test(chunk)) {
        return false; // a letters-only run that is not word-shaped is not a path word
      }
      continue; // clean: a plain word
    }
    if (PATH_CHUNK_NUMERIC_RE.test(chunk)) {
      continue; // clean: a plain number
    }
    if (PATH_CHUNK_HEX_RE.test(chunk)) {
      // Reaches here only because it failed BOTH checks above, so it mixes at
      // least one digit with at least one hex letter (e.g. `f70383e6`).
      hasMixedHexChunk = true;
      continue; // tentatively clean: gated below
    }
    return false; // any chunk outside alpha/numeric/hex disqualifies the token
  }
  if (hasMixedHexChunk && chunks.length < MIN_CHUNKS_FOR_HEX_ALLOWANCE) {
    return false;
  }
  return true;
}

/**
 * Whether a candidate token is high-entropy secret material.
 *
 * Deliberate exclusions (audit rationale):
 * - integrity hashes (`sha512-…` SRI / npm lockfile `integrity`): content
 *   hashes, not secrets; they dominate lockfiles and their redaction is what
 *   made the savings metric look large (§31).
 * - pure hex (dashes/underscores ignored): git SHAs, sha256 content hashes,
 *   UUIDs, and Golem's own CCR `hash=<sha256>` markers saturate developer
 *   traffic and are not secrets. Hex-shaped provider secrets are covered by
 *   the pattern rules above.
 * - path-like candidates ({@link isPathLikeToken}): repo paths and versioned
 *   filenames/ADR names (§49), and — as of §140 — a path whose chunks embed a
 *   UUID/SHA segment (a scratchpad dir, `.claude/worktrees/agent-<uuid>`),
 *   because this function's pure-hex check above already excludes that exact
 *   material when it stands alone; the path case only makes the two agree.
 * - tokens with fewer than 2 of 3 character classes (lowercase, uppercase,
 *   digit): long identifiers, camelCase names, and shouted constants each
 *   lack at least one of the three while real random secrets at 32+ chars
 *   almost always have at least two. Base32 secrets (uppercase + digits,
 *   no lowercase) are now caught by the 2-of-3 rule.
 */
export function isHighEntropyToken(token: string): boolean {
  if (INTEGRITY_HASH_RE.test(token)) {
    return false;
  }
  const dehyphenated = token.replace(/[-_]/g, "");
  if (/^[0-9a-fA-F]*$/.test(dehyphenated)) {
    return false;
  }
  if (isPathLikeToken(token)) {
    return false;
  }
  // Require at least 2 of 3 character classes (catches base64 with all three,
  // and base32 secrets which use only uppercase + digits, no lowercase).
  const hasLower = /[a-z]/.test(token);
  const hasUpper = /[A-Z]/.test(token);
  const hasDigit = /[0-9]/.test(token);
  const classCount = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0);
  if (classCount < 2) {
    return false;
  }
  return shannonEntropy(token) >= ENTROPY_THRESHOLD_BITS;
}

/**
 * ---------------------------------------------------------------------------
 * R8.11 / ADR-0005 — the append-only plugin extension point.
 *
 * Every organisation has private secret formats, and until now extending
 * redaction meant *forking Golem*. A fork drifts out of date — including out of
 * date with fixes to this very stage — so the seam below exists to make the
 * safer choice also the easier one.
 *
 * It is append-only **by construction, not by convention**:
 *
 * - `REDACTION_RULES` above stays the single audited built-in table (T-C3) and
 *   is never handed to a plugin.
 * - Extra rules are appended AFTER every built-in, so they can only ever redact
 *   *more*. A plugin rule that matches something a built-in already replaced
 *   sees a placeholder, whose `[` / `]` / `:` characters no rule's charset
 *   matches.
 * - There is no remove, replace, or reorder function. They do not exist to be
 *   called.
 * - Registration is expected exactly once, at startup, before the process serves
 *   anything. That is a determinism requirement, not tidiness: redaction must be
 *   a pure function of its input for prompt-cache prefix stability
 *   (verification-notes §14), so a table that changed mid-process would break
 *   caching for every downstream request. A second registration is therefore
 *   REFUSED rather than merged.
 * ---------------------------------------------------------------------------
 */

/** Plugin-contributed rules, appended after the built-in table. */
let extraRules: readonly RedactionRule[] = [];
let extraRulesSealed = false;

/** Outcome of a registration attempt — never a throw on a live request path. */
export interface ExtraRuleRegistration {
  readonly accepted: number;
  /** Non-null when nothing was accepted and why. */
  readonly refused: string | null;
}

/**
 * Append plugin redaction rules. Idempotent-by-refusal: the first call wins for
 * the life of the process, and a later one is refused with a reason rather than
 * silently changing the table underneath a cached prefix.
 *
 * Rules whose id is not namespaced (`<plugin>/<rule>`) are rejected — the
 * namespace is what stops a plugin impersonating a built-in placeholder kind.
 */
export function registerExtraRedactionRules(
  rules: readonly RedactionRule[],
): ExtraRuleRegistration {
  if (extraRulesSealed) {
    return {
      accepted: 0,
      refused:
        "redaction rules were already registered for this process; the table is fixed once " +
        "serving begins so prompt-cache prefixes stay stable (verification-notes §14)",
    };
  }
  const builtInIds = new Set(BUILT_IN_RULES.map((r) => r.id));
  const accepted: RedactionRule[] = [];
  for (const rule of rules) {
    if (!rule.id.includes("/")) continue; // must be `<plugin>/<rule>`
    if (builtInIds.has(rule.id)) continue; // cannot shadow a built-in kind
    accepted.push(rule);
  }
  extraRules = accepted;
  extraRulesSealed = true;
  return { accepted: accepted.length, refused: null };
}

/** True once this process has fixed its plugin rule set (even to the empty set). */
export function pluginRedactionRulesSealed(): boolean {
  return extraRulesSealed;
}

/** The plugin-contributed rules currently in force (possibly empty). */
export function extraRedactionRules(): readonly RedactionRule[] {
  return extraRules;
}

/**
 * The full table in application order: **built-ins first, always**, then plugin
 * rules. The entropy sweep still runs after both (see `redaction.ts`), so
 * specific rules keep winning the placeholder kind over the generic detector.
 */
export function activeRedactionRules(): readonly RedactionRule[] {
  return extraRules.length === 0 ? BUILT_IN_RULES : [...BUILT_IN_RULES, ...extraRules];
}

/**
 * Test-only: drop plugin rules and unseal.
 *
 * This is the one function that removes a rule, and it is deliberately narrow —
 * it can only ever clear the plugin suffix, never touch `REDACTION_RULES`, and
 * a production code path calling it would still be unable to weaken a built-in.
 */
export function resetExtraRedactionRulesForTests(): void {
  extraRules = [];
  extraRulesSealed = false;
}
