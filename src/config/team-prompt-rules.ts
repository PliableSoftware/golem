/**
 * DUST2.22 - what a team prompt may contain, in ONE place.
 *
 * Two halves share these rules: the team-policy GATE (`teamPromptProblem`, which
 * REFUSES a whole value) and the read-side STRIP (`src/inference/team-prompt.ts`,
 * which cleans a value that never passed the gate, e.g. from a local file or an
 * env var, and returns nothing when it cannot make it pass). Neither quotes the
 * text it judged.
 *
 * ## Characters: an allow-list
 *
 * Letters, marks, numbers, punctuation and symbols, plus ordinary space, tab and
 * newline. Everything else is refused: every other separator (U+00A0, U+1680,
 * U+2000-200A, U+202F, U+205F, U+3000, U+2028/2029), format characters, every
 * Default_Ignorable_Code_Point (zero-width, BOM, bidi controls, variation
 * selectors, U+034F, U+17B4/17B5, Hangul fillers), the braille blank U+2800,
 * tag characters, private use, unassigned, lone surrogates, other controls.
 * More than three consecutive combining marks are refused (zalgo).
 *
 * ## Structure and URLs: on a SKELETON
 *
 * Marker, framing-line, fence, tag and URL rules do not run on the text as
 * written but on its skeleton: NFKD, combining marks and default-ignorables
 * removed, a small explicit table of Cyrillic, Greek and small-capital
 * lookalikes folded to Latin, angle and colon lookalikes folded to `<`, `>`, `:`,
 * lowercased. A word that mixes Latin with Cyrillic or Greek letters is refused
 * outright. The fence markers are matched with ANY separators (or none) between
 * the words, so `END-TEAM-NOTE`, `END_TEAM_NOTE` and `ENDTEAMNOTE` all hit.
 *
 * KNOWN LIMITATIONS: a bare domain in prose ("example.com") is not detected; the
 * confusable table is explicit, not the full Unicode confusables set; a decimal
 * IP literal is detected only for 9-10 digit numbers up to 2^32-1 (shorter ones
 * collide with dates and ids). The fence label and the bounds are the defence,
 * not these heuristics.
 */

/** The longest team prompt, counted in CODE POINTS (not UTF-16 units). */
export const TEAM_PROMPT_MAX_CHARS = 2000;

/** Most consecutive combining marks accepted. */
const MAX_MARK_RUN = 3;

/** Matches any code point outside the allow-list (global: for stripping). */
export const DISALLOWED_CHAR =
  /[^\p{L}\p{M}\p{N}\p{P}\p{S} \n\t]|\p{Default_Ignorable_Code_Point}|\p{Variation_Selector}|⠀/gu;
const INVISIBLE = /\p{Default_Ignorable_Code_Point}|\p{Variation_Selector}|⠀/gu;
const MARK_RUN = new RegExp(`\\p{M}{${MAX_MARK_RUN + 1},}`, "u");
const MARK_RUN_TAIL = new RegExp(`(\\p{M}{${MAX_MARK_RUN}})\\p{M}+`, "gu");

/** Pairs of [lookalike code point, Latin or punctuation target]. */
const CONFUSABLE_PAIRS: ReadonlyArray<readonly [number, string]> = [
  // Cyrillic capitals
  [0x410, "a"],
  [0x412, "b"],
  [0x415, "e"],
  [0x41a, "k"],
  [0x41c, "m"],
  [0x41d, "h"],
  [0x41e, "o"],
  [0x420, "p"],
  [0x421, "c"],
  [0x422, "t"],
  [0x423, "y"],
  [0x425, "x"],
  [0x406, "i"],
  [0x408, "j"],
  [0x405, "s"],
  // Cyrillic lowercase
  [0x430, "a"],
  [0x432, "b"],
  [0x435, "e"],
  [0x43a, "k"],
  [0x43c, "m"],
  [0x43d, "h"],
  [0x43e, "o"],
  [0x440, "p"],
  [0x441, "c"],
  [0x442, "t"],
  [0x443, "y"],
  [0x445, "x"],
  [0x456, "i"],
  [0x458, "j"],
  [0x455, "s"],
  [0x4bb, "h"],
  [0x501, "d"],
  [0x4cf, "l"],
  [0x51b, "q"],
  [0x51d, "w"],
  // Greek capitals
  [0x391, "a"],
  [0x392, "b"],
  [0x395, "e"],
  [0x396, "z"],
  [0x397, "h"],
  [0x399, "i"],
  [0x39a, "k"],
  [0x39c, "m"],
  [0x39d, "n"],
  [0x39f, "o"],
  [0x3a1, "p"],
  [0x3a4, "t"],
  [0x3a5, "y"],
  [0x3a7, "x"],
  // Greek lowercase
  [0x3b1, "a"],
  [0x3b9, "i"],
  [0x3ba, "k"],
  [0x3bd, "v"],
  [0x3bf, "o"],
  [0x3c1, "p"],
  [0x3c5, "u"],
  [0x3c7, "x"],
  // Latin small capitals and dotless i
  [0x1d00, "a"],
  [0x299, "b"],
  [0x1d04, "c"],
  [0x1d05, "d"],
  [0x1d07, "e"],
  [0xa730, "f"],
  [0x262, "g"],
  [0x29c, "h"],
  [0x26a, "i"],
  [0x1d0a, "j"],
  [0x1d0b, "k"],
  [0x29f, "l"],
  [0x1d0d, "m"],
  [0x274, "n"],
  [0x1d0f, "o"],
  [0x1d18, "p"],
  [0x280, "r"],
  [0xa731, "s"],
  [0x1d1b, "t"],
  [0x1d1c, "u"],
  [0x1d20, "v"],
  [0x1d21, "w"],
  [0x28f, "y"],
  [0x1d22, "z"],
  [0x131, "i"],
  // colon lookalikes
  [0x2236, ":"],
  [0xa789, ":"],
  [0x2d0, ":"],
  [0x589, ":"],
  // angle-bracket lookalikes (U+2329/232A decompose to U+3008/3009 under NFKD)
  [0x3008, "<"],
  [0x27e8, "<"],
  [0x2039, "<"],
  [0x276c, "<"],
  [0x2770, "<"],
  [0x3009, ">"],
  [0x27e9, ">"],
  [0x203a, ">"],
  [0x276d, ">"],
  [0x2771, ">"],
];
const CONFUSABLE = new Map<string, string>(
  CONFUSABLE_PAIRS.map(([cp, to]) => [String.fromCodePoint(cp), to]),
);

/** The text as the structural rules see it (see the module comment). */
export function skeleton(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFKD").replace(/\p{M}/gu, "").replace(INVISIBLE, "")) {
    out += CONFUSABLE.get(ch) ?? ch;
  }
  return out.toLowerCase();
}

/** Code-point length, so an astral character counts once. */
export const codePointLength = (text: string): number => Array.from(text).length;

/** The fence markers, with ANY non-letters (or none) between the words, on a skeleton. */
const SKELETON_MARKER = /(?<![a-z])(?:begin|end)[^a-z]*(?:of[^a-z]*)?team[^a-z]*note/u;
/** The same, for stripping from text that still has its original letters. */
const STRIP_MARKER = /(?<![\p{L}])(?:begin|end)[^\p{L}]*(?:of[^\p{L}]*)?team[^\p{L}]*note/giu;

/** A line, once its quote/list prefix is gone, that reads as a heading, markup or chat role. */
const LINE_PREFIX = /^[\s>|*•·\-+~\d.)(\][]*/u;
const FRAMING_START = /^(?:[#<]|(?:system|human|assistant|user)\s*:)/u;

/** True when a line would read as a heading, markup, or a chat-role header. */
export function isFramingLine(line: string): boolean {
  return FRAMING_START.test(skeleton(line).replace(LINE_PREFIX, ""));
}

const MARKUP_TAG = /<\s*\/?\s*[a-z!?][^>\n]*>/u;

const URL_SCHEME_SLASHES = /[a-z][a-z0-9+.-]*:\/\//u;
const URL_NAMED_SCHEME =
  /(?<![a-z0-9])(?:data|mailto|file|javascript|vbscript|ftp|sftp|tel|sms|ssh|git|http|https|ws|wss):/u;
const SCHEME_RELATIVE = /(?:^|[\s(["'])\/\/[a-z0-9]/u;
const UNC = /\\\\/u;
const WWW = /(?<![a-z0-9])www\./u;
const IPV4 = /(?<![\d.])\d{1,4}(?:\.\d{1,4}){3}(?!\d)/u; // 4 digits: octal 0177.0.0.1
const HEX_IP = /(?<![a-z0-9])0x[0-9a-f]{8}(?![a-z0-9])/u;
const IPV6_TOKEN = /(?<![\w:])[0-9a-f:]*:[0-9a-f:]*:[0-9a-f:]*(?![\w:])/gu;
const LONG_NUMBER = /(?<![\w.])\d{9,10}(?![\w.])/gu;

function hasIpv6Literal(text: string): boolean {
  for (const m of text.matchAll(IPV6_TOKEN)) {
    const token = m[0];
    if (!/[0-9a-f]/u.test(token)) continue;
    if (token.includes("::") || token.split(":").length - 1 >= 5) return true;
  }
  return false;
}

function hasDecimalIp(text: string): boolean {
  for (const m of text.matchAll(LONG_NUMBER)) {
    if (Number(m[0]) <= 4294967295) return true;
  }
  return false;
}

function hasMixedScriptWord(text: string): boolean {
  for (const word of text.match(/[\p{L}\p{M}]+/gu) ?? []) {
    if (/\p{Script=Latin}/u.test(word) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(word)) {
      return true;
    }
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
    return "a team prompt may contain only visible text (no control, invisible, bidi, variation, tag, private-use or non-ASCII space characters)";
  }
  if (MARK_RUN.test(text)) {
    return `a team prompt may not stack more than ${MAX_MARK_RUN} combining marks`;
  }
  if (hasMixedScriptWord(text)) {
    return "a team prompt may not mix Latin with Cyrillic or Greek letters in one word";
  }
  const s = skeleton(text);
  if (SKELETON_MARKER.test(s)) return "a team prompt may not contain the team-note fence markers";
  if (s.split("\n").some((line) => FRAMING_START.test(line.replace(LINE_PREFIX, "")))) {
    return "a team prompt may not have a line starting with #, < or a role header (system:, user:, ...), even after a quote or list prefix";
  }
  if (s.includes("```") || s.includes("~~~")) return "a team prompt may not contain a code fence";
  if (MARKUP_TAG.test(s)) return "a team prompt may not contain markup tags";
  if (
    URL_SCHEME_SLASHES.test(s) ||
    URL_NAMED_SCHEME.test(s) ||
    SCHEME_RELATIVE.test(s) ||
    UNC.test(s) ||
    WWW.test(s) ||
    IPV4.test(s) ||
    HEX_IP.test(s) ||
    hasDecimalIp(s) ||
    hasIpv6Literal(s)
  ) {
    return "a team prompt may not contain a URL, network path or IP address";
  }
  return undefined;
}

/** One pass of the read-side clean-up (see {@link stripTeamPrompt}). */
function stripOnce(raw: string): string {
  const kept = raw
    .normalize("NFKC")
    .replace(DISALLOWED_CHAR, "")
    .replace(MARK_RUN_TAIL, "$1")
    // Markers, fences and tags go FIRST, so a line they were hiding behind is
    // exposed to the framing filter below within the same pass.
    .replace(STRIP_MARKER, "")
    .replaceAll("```", "")
    .replaceAll("~~~", "")
    .replace(new RegExp(MARKUP_TAG.source, "giu"), "");
  return kept
    .split("\n")
    .filter((line) => !isFramingLine(line))
    .join("\n")
    .replace(/\n(?:[ \t]*\n){3,}/gu, "\n\n\n");
}

/**
 * The read-side clean-up: repeat {@link stripOnce} until the text stops changing
 * (removing one construct can expose another). Does not trim or cap, and does
 * not check the gate; `sanitizeTeamPrompt` does both.
 */
export function stripTeamPrompt(raw: string): string {
  let current = raw;
  for (let i = 0; i < 16; i++) {
    const next = stripOnce(current);
    if (next === current) return next;
    current = next;
  }
  return current;
}
