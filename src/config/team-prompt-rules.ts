/**
 * DUST2.22 — what a team prompt may contain, in ONE place.
 *
 * Two halves share these rules: the team-policy GATE (`teamPromptProblem`, which
 * REFUSES a whole value) and the read-side STRIP (`src/inference/team-prompt.ts`,
 * which cleans a value that never passed the gate, e.g. from a local file or an
 * env var). Neither quotes the text it judged.
 *
 * The character rule is an ALLOW-list, because a deny-list of invisible
 * characters cannot be completed: letters, marks, numbers, punctuation, symbols
 * and space separators, plus newline and tab. Everything else is refused:
 * format characters (zero-width, BOM, bidi overrides and isolates), tag
 * characters U+E0000-E007F, private use, unassigned, unpaired surrogates, other
 * control characters, and the line/paragraph separators U+2028/2029.
 *
 * Structure and URL rules run on an NFKC-normalised copy, so fullwidth colons,
 * fullwidth `#` and compatibility forms cannot dodge them. KNOWN LIMITATION: a
 * bare domain written in prose ("see example dot com", "example.com") is not
 * detected. The fence label and the bounds are the defence, not this check.
 */

/** The longest team prompt, counted in CODE POINTS (not UTF-16 units). */
export const TEAM_PROMPT_MAX_CHARS = 2000;

/** Matches any code point outside the allow-list. */
export const DISALLOWED_CHAR = /[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}\n\t]/gu;

/** The fence strings, in any case or spacing. */
export const FENCE_MARKER = /(?:BEGIN|END)\s+TEAM\s+NOTE/giu;

/** A line that would read as a heading, markup, or a chat-role header. */
export const FRAMING_LINE = /^[ \t]*(?:[#<]|(?:system|human|assistant|user)[ \t]*:)/iu;

const CODE_FENCE = /```/u;
const MARKUP_TAG = /<[ \t]*\/?[ \t]*[a-z!?][^>\n]*>/iu;

const URL_SCHEME_SLASHES = /[a-z][a-z0-9+.-]*:\/\//iu;
const URL_NAMED_SCHEME =
  /(?<![a-z0-9])(?:data|mailto|file|javascript|vbscript|ftp|sftp|tel|sms|ssh|git|http|https|ws|wss):/iu;
const UNC = /\\\\/u;
const WWW = /(?<![a-z0-9])www\./iu;
const IPV4 = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d])/u;
/** A token made only of hex digits and colons: an IPv6 literal when it has `::` or 5+ colons. */
const IPV6_TOKEN = /(?<![\w:])[0-9a-f:]*:[0-9a-f:]*:[0-9a-f:]*(?![\w:])/giu;

/** The text as the structural rules see it. */
export const normalized = (text: string): string => text.normalize("NFKC");

/** Code-point length, so an astral character counts once. */
export const codePointLength = (text: string): number => Array.from(text).length;

function hasIpv6Literal(text: string): boolean {
  for (const m of text.matchAll(IPV6_TOKEN)) {
    const token = m[0];
    if (!/[0-9a-f]/iu.test(token)) continue;
    const colons = token.split(":").length - 1;
    if (token.includes("::") || colons >= 5) return true;
  }
  return false;
}

/** Why `text` is not an acceptable team prompt, or undefined. Never quotes it. */
export function teamPromptViolation(text: string): string | undefined {
  if (codePointLength(text) > TEAM_PROMPT_MAX_CHARS) {
    return `a team prompt may be at most ${TEAM_PROMPT_MAX_CHARS} characters`;
  }
  DISALLOWED_CHAR.lastIndex = 0;
  if (DISALLOWED_CHAR.test(text)) {
    return "a team prompt may contain only visible text (no control, invisible, bidi, tag or private-use characters)";
  }
  const n = normalized(text);
  FENCE_MARKER.lastIndex = 0;
  if (FENCE_MARKER.test(n)) return "a team prompt may not contain the team-note fence markers";
  if (n.split("\n").some((line) => FRAMING_LINE.test(line))) {
    return "a team prompt may not have a line starting with #, < or a role header (system:, user:, ...)";
  }
  if (CODE_FENCE.test(n)) return "a team prompt may not contain a code fence";
  if (MARKUP_TAG.test(n)) return "a team prompt may not contain markup tags";
  if (
    URL_SCHEME_SLASHES.test(n) ||
    URL_NAMED_SCHEME.test(n) ||
    UNC.test(n) ||
    WWW.test(n) ||
    IPV4.test(n) ||
    hasIpv6Literal(n)
  ) {
    return "a team prompt may not contain a URL, network path or IP address";
  }
  return undefined;
}

/**
 * The read-side clean-up: NFKC, drop disallowed code points, drop framing lines,
 * and remove fence markers, code fences and tags. Does not trim or cap.
 */
export function stripTeamPrompt(raw: string): string {
  const kept = normalized(raw).replace(DISALLOWED_CHAR, "");
  return kept
    .split("\n")
    .filter((line) => !FRAMING_LINE.test(line))
    .join("\n")
    .replace(FENCE_MARKER, "")
    .replaceAll("```", "")
    .replace(new RegExp(MARKUP_TAG.source, "giu"), "");
}
