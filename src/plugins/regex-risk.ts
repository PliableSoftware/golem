/**
 * `src/plugins/regex-risk.ts` — a static, advisory check for regexes whose SHAPE
 * can backtrack catastrophically (DUST2.11 / r042).
 *
 * Why it exists: a plugin redaction rule is third-party code that runs a regex
 * over every request body in the proxy. V8 has no regex timeout, so one
 * `(a+)+$` stalls the event loop for as long as the input lets it, and the user
 * sees "waiting for API". We cannot sandbox that (ADR-0005); we can say so.
 *
 * Contract:
 *  - WARN only. Nothing here rejects a rule: dropping a working redaction is the
 *    worse failure, and the redaction path is additive and must never shrink.
 *  - Pure TypeScript, linear in the pattern, no dependency, never throws. A
 *    pattern it cannot parse comes back as an `unanalysed` finding, not silence.
 *
 * Detection model. The pattern is parsed into a tiny tree (atoms with a
 * character-set predicate, groups, repeats). Four shapes are reported:
 *
 *  - `nested-quantifier`: a group repeated unboundedly (or >10 times) whose body
 *    holds a VARIABLE repeat (`+ * {n,m}`), unless that inner repeat is
 *    followed by a mandatory atom whose characters cannot overlap it (the
 *    delimiter case, `([a-z]+\.)+`, is linear and stays quiet).
 *  - `nullable-repeat`: an unbounded repeat of a group that can match empty
 *    (`(a?)*`, `(|a)+`).
 *  - `overlapping-alternation`: under an unbounded repeat, two branches that can
 *    match the same text (`(a|a)*`, `(\w|\d)+`, `(.|\n)*`, `(a|aa)+`).
 *  - `adjacent-overlap`: two unbounded repeats back to back whose characters
 *    overlap (`\d+\d+`, `.*.*`). Polynomial rather than exponential.
 *
 * Known false positives (it WARNS, so these are acceptable):
 *  - Polynomial-only shapes reported as nested, e.g. `(\s*,\s*)+`.
 *  - Any overlap of character sets is treated as ambiguity even if the rest of
 *    the pattern would make the match fail fast.
 *
 * Known false negatives (do not read a quiet result as "safe"):
 *  - Backreferences and lookaround contents are not analysed (zero-width).
 *  - Overlap between non-adjacent repeats (`.*x.*y`), which is quadratic.
 *  - Alternation ambiguity beyond identical / single-atom / repeated-literal
 *    branches, e.g. `(a|ab|b)*`.
 *  - Bounded repeats of 10 or fewer (`(a+){3}`), polynomial and small.
 *  - Case folding under the `i` flag uses `toUpperCase`/`toLowerCase` of each
 *    code point and only for code points below U+2000 or in the fullwidth Latin
 *    block; exotic folds (the Kelvin sign) are not modelled.
 *  - `\p{..}` is treated as matching anything, so it can only over-report.
 *  - Work is budgeted (a step counter and a cap of 64 branches per repeated
 *    alternation). Past either, the result is an `unanalysed` finding rather
 *    than a stall: a plugin's regex must not be able to slow startup.
 *
 * Character sets are sorted code-point INTERVALS, so overlap is exact for every
 * script (no sampling).
 */

export type RegexRiskKind =
  | "nested-quantifier"
  | "nullable-repeat"
  | "overlapping-alternation"
  | "adjacent-overlap"
  | "unanalysed";

export interface RegexRiskFinding {
  readonly kind: RegexRiskKind;
  /** One sentence naming the offending fragment and why it is a risk. */
  readonly detail: string;
}

/** Sorted, disjoint, inclusive code-point ranges. */
type CpSet = readonly (readonly [number, number])[];

type Node =
  | { readonly t: "atom"; readonly set: CpSet; readonly lit: string | null; readonly src: string }
  | { readonly t: "zero" }
  | { readonly t: "group"; readonly alts: readonly Node[][]; readonly src: string }
  | {
      readonly t: "rep";
      readonly node: Node;
      readonly min: number;
      readonly max: number;
      readonly src: string;
    };

/** Repeat counts above this are treated as "many" for the nested/alternation checks. */
const MANY = 10;
const MAX_DEPTH = 40;
/** Repeated alternations wider than this are not compared pairwise. */
const MAX_BRANCHES = 64;
/** Total set-operation budget per analysis. */
const MAX_STEPS = 200_000;
const MAX_CP = 0x10ffff;

class Unanalysable extends Error {}

let steps = 0;
function spend(n: number): void {
  steps += n;
  if (steps > MAX_STEPS) throw new Unanalysable("analysis budget exceeded");
}

function norm(ranges: readonly (readonly [number, number])[]): CpSet {
  spend(ranges.length + 1);
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

const union = (a: CpSet, b: CpSet): CpSet => norm([...a, ...b]);

function complement(a: CpSet): CpSet {
  spend(a.length + 1);
  const out: [number, number][] = [];
  let next = 0;
  for (const [lo, hi] of a) {
    if (lo > next) out.push([next, lo - 1]);
    next = hi + 1;
  }
  if (next <= MAX_CP) out.push([next, MAX_CP]);
  return out;
}

function intersects(a: CpSet, b: CpSet): boolean {
  spend(a.length + b.length + 1);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as readonly [number, number];
    const y = b[j] as readonly [number, number];
    if (x[1] < y[0]) i++;
    else if (y[1] < x[0]) j++;
    else return true;
  }
  return false;
}

const single = (cp: number): CpSet => [[cp, cp]];
const DIGIT: CpSet = [[48, 57]];
const WORD: CpSet = [
  [48, 57],
  [65, 90],
  [95, 95],
  [97, 122],
];
const SPACE: CpSet = norm([
  [9, 13],
  [32, 32],
  [160, 160],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
]);
const ANY: CpSet = [[0, MAX_CP]];
const NOT_NEWLINE: CpSet = complement([
  [10, 10],
  [13, 13],
  [0x2028, 0x2029],
]);

/** Code points whose case variants are modelled (see the module header). */
const FOLD_ZONES: CpSet = [
  [0, 0x1fff],
  [0xff21, 0xff5a],
];
const foldCache = new Map<number, readonly number[]>();

function caseVariants(cp: number): readonly number[] {
  const hit = foldCache.get(cp);
  if (hit !== undefined) return hit;
  const ch = String.fromCodePoint(cp);
  const out: number[] = [];
  for (const v of [ch.toUpperCase(), ch.toLowerCase()]) {
    const vc = v.codePointAt(0);
    if (v.length === ch.length && vc !== undefined && vc !== cp) out.push(vc);
  }
  foldCache.set(cp, out);
  return out;
}

function fold(set: CpSet): CpSet {
  const extra: [number, number][] = [];
  for (const [lo, hi] of set) {
    for (const [zl, zh] of FOLD_ZONES) {
      const from = Math.max(lo, zl);
      const to = Math.min(hi, zh);
      if (from > to) continue;
      spend(to - from + 1);
      for (let c = from; c <= to; c++) for (const v of caseVariants(c)) extra.push([v, v]);
    }
  }
  return extra.length === 0 ? set : norm([...set, ...extra]);
}

class Parser {
  private i = 0;
  constructor(
    private readonly s: string,
    private readonly ignoreCase: boolean,
    private readonly dotAll: boolean,
  ) {}

  parse(): Node[][] {
    const alts = this.alternation(0);
    if (this.i < this.s.length) throw new Unanalysable("unbalanced group");
    return alts;
  }

  private alternation(depth: number): Node[][] {
    if (depth > MAX_DEPTH) throw new Unanalysable("nesting too deep");
    const alts: Node[][] = [[]];
    while (this.i < this.s.length) {
      const ch = this.s[this.i] as string;
      if (ch === ")") break;
      if (ch === "|") {
        this.i++;
        alts.push([]);
        continue;
      }
      const start = this.i;
      const atom = this.atom(depth);
      const withQuant = this.quantifier(atom, start);
      (alts[alts.length - 1] as Node[]).push(withQuant);
    }
    return alts;
  }

  private mk(set: CpSet, lit: string | null, src: string, foldable = true): Node {
    return { t: "atom", set: this.ignoreCase && foldable ? fold(set) : set, lit, src };
  }

  private atom(depth: number): Node {
    const start = this.i;
    const ch = this.s[this.i++] as string;
    switch (ch) {
      case "^":
      case "$":
        return { t: "zero" };
      case ".":
        return this.mk(this.dotAll ? ANY : NOT_NEWLINE, null, ".", false);
      case "(":
        return this.group(depth, start);
      case "[":
        return this.charClass(start);
      case "\\":
        return this.escape(start, false);
      default: {
        const cp = this.s.codePointAt(this.i - 1) as number;
        if (cp > 0xffff) this.i++;
        const lit = String.fromCodePoint(cp);
        return this.mk(single(cp), lit, lit);
      }
    }
  }

  private group(depth: number, start: number): Node {
    let zeroWidth = false;
    if (this.s[this.i] === "?") {
      const next = this.s[this.i + 1];
      if (next === "=" || next === "!") {
        zeroWidth = true;
        this.i += 2;
      } else if (next === "<" && (this.s[this.i + 2] === "=" || this.s[this.i + 2] === "!")) {
        zeroWidth = true;
        this.i += 3;
      } else if (next === "<") {
        const close = this.s.indexOf(">", this.i);
        if (close < 0) throw new Unanalysable("unterminated group name");
        this.i = close + 1;
      } else {
        const colon = this.s.indexOf(":", this.i);
        if (colon < 0) throw new Unanalysable("unknown group syntax");
        this.i = colon + 1;
      }
    }
    const alts = this.alternation(depth + 1);
    if (this.s[this.i] !== ")") throw new Unanalysable("unterminated group");
    this.i++;
    if (zeroWidth) return { t: "zero" };
    return { t: "group", alts, src: this.s.slice(start, this.i) };
  }

  private hexAt(len: number): number | null {
    const h = this.s.slice(this.i, this.i + len);
    if (h.length === len && /^[0-9a-fA-F]+$/.test(h)) {
      this.i += len;
      return Number.parseInt(h, 16);
    }
    return null;
  }

  /** Parse after a backslash. In a class, `\b` is backspace and backrefs do not exist. */
  private escape(start: number, inClass: boolean): Node {
    if (this.i >= this.s.length) throw new Unanalysable("dangling backslash");
    const e = this.s[this.i++] as string;
    const src = this.s.slice(start, this.i);
    switch (e) {
      case "d":
        return this.mk(DIGIT, null, src, false);
      case "D":
        return this.mk(complement(DIGIT), null, src, false);
      case "w":
        return this.mk(WORD, null, src);
      case "W":
        return this.mk(complement(WORD), null, src, false);
      case "s":
        return this.mk(SPACE, null, src, false);
      case "S":
        return this.mk(complement(SPACE), null, src, false);
      case "p":
      case "P":
        // Unicode property: not modelled, so assume it can overlap anything.
        if (this.s[this.i] === "{") {
          const close = this.s.indexOf("}", this.i);
          if (close < 0) throw new Unanalysable("unterminated \\p{}");
          this.i = close + 1;
        }
        return this.mk(ANY, null, this.s.slice(start, this.i), false);
      case "b":
        if (inClass) return this.lit("\b", src);
        return { t: "zero" };
      case "B":
        return { t: "zero" };
      case "k":
        if (this.s[this.i] === "<") {
          const close = this.s.indexOf(">", this.i);
          if (close < 0) throw new Unanalysable("unterminated \\k<>");
          this.i = close + 1;
          return { t: "zero" };
        }
        return this.lit("k", src);
      case "n":
        return this.lit("\n", src);
      case "r":
        return this.lit("\r", src);
      case "t":
        return this.lit("\t", src);
      case "f":
        return this.lit("\f", src);
      case "v":
        return this.lit("\v", src);
      case "0":
        return this.lit("\0", src);
      case "x": {
        const v = this.hexAt(2);
        return v === null ? this.lit("x", src) : this.lit(String.fromCodePoint(v), src);
      }
      case "u": {
        if (this.s[this.i] === "{") {
          const close = this.s.indexOf("}", this.i);
          const v = close < 0 ? Number.NaN : Number.parseInt(this.s.slice(this.i + 1, close), 16);
          if (Number.isNaN(v) || v > MAX_CP) throw new Unanalysable("bad \\u{}");
          this.i = close + 1;
          return this.lit(String.fromCodePoint(v), src);
        }
        const v = this.hexAt(4);
        return v === null ? this.lit("u", src) : this.lit(String.fromCodePoint(v), src);
      }
      case "c": {
        const l = this.s[this.i];
        if (l !== undefined && /[A-Za-z]/.test(l)) {
          this.i++;
          return this.lit(String.fromCodePoint(l.charCodeAt(0) % 32), src);
        }
        return this.lit("\\", src);
      }
      default:
        if (!inClass && e >= "1" && e <= "9") {
          while (this.i < this.s.length && /[0-9]/.test(this.s[this.i] as string)) this.i++;
          return { t: "zero" }; // backreference: not analysed
        }
        return this.lit(e, src);
    }
  }

  private lit(ch: string, src: string): Node {
    const cp = ch.codePointAt(0) as number;
    return this.mk(single(cp), ch, src);
  }

  private charClass(start: number): Node {
    let negate = false;
    if (this.s[this.i] === "^") {
      negate = true;
      this.i++;
    }
    const parts: (readonly [number, number])[] = [];
    const item = (): { set: CpSet; cp: number | null } => {
      if (this.i >= this.s.length) throw new Unanalysable("unterminated class");
      const ch = this.s[this.i] as string;
      if (ch === "\\") {
        const at = this.i;
        this.i++;
        const n = this.escape(at, true);
        if (n.t === "atom") {
          const cp = n.lit === null ? null : (n.lit.codePointAt(0) as number);
          return { set: n.set, cp };
        }
        return { set: [], cp: null };
      }
      const cp = this.s.codePointAt(this.i) as number;
      this.i += cp > 0xffff ? 2 : 1;
      return { set: single(cp), cp };
    };
    while (true) {
      if (this.i >= this.s.length) throw new Unanalysable("unterminated class");
      if (this.s[this.i] === "]") {
        this.i++;
        break;
      }
      const lo = item();
      if (this.s[this.i] === "-" && this.s[this.i + 1] !== "]" && this.i + 1 < this.s.length) {
        const save = this.i;
        this.i++;
        const hi = item();
        if (lo.cp !== null && hi.cp !== null) {
          // An inverted range is a syntax error that RegExp already rejected.
          parts.push([lo.cp, hi.cp]);
          continue;
        }
        // `\w-x` style: the dash is literal.
        this.i = save;
      }
      parts.push(...lo.set);
    }
    let positive = norm(parts);
    if (this.ignoreCase) positive = fold(positive);
    return {
      t: "atom",
      set: negate ? complement(positive) : positive,
      lit: null,
      src: this.s.slice(start, this.i),
    };
  }

  private quantifier(atom: Node, start: number): Node {
    const q = this.s[this.i];
    let min: number;
    let max: number;
    if (q === "*") {
      min = 0;
      max = Number.POSITIVE_INFINITY;
      this.i++;
    } else if (q === "+") {
      min = 1;
      max = Number.POSITIVE_INFINITY;
      this.i++;
    } else if (q === "?") {
      min = 0;
      max = 1;
      this.i++;
    } else if (q === "{") {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(this.s.slice(this.i));
      if (m === null) return atom; // a literal brace
      min = Number.parseInt(m[1] as string, 10);
      max =
        m[2] === undefined
          ? min
          : m[3] === ""
            ? Number.POSITIVE_INFINITY
            : Number.parseInt(m[3] as string, 10);
      this.i += m[0].length;
    } else {
      return atom;
    }
    if (this.s[this.i] === "?") this.i++; // lazy: same shape for our purposes
    if (atom.t === "zero") return atom; // quantified anchor/lookaround: nothing to consume
    return { t: "rep", node: atom, min, max, src: this.s.slice(start, this.i) };
  }
}

function minLen(n: Node): number {
  switch (n.t) {
    case "zero":
      return 0;
    case "atom":
      return 1;
    case "rep":
      return n.min * minLen(n.node);
    case "group":
      return Math.min(...n.alts.map((a) => a.reduce((s, x) => s + minLen(x), 0)));
  }
}

/** Characters this node can START with (ignores nullability; callers handle that). */
function first(n: Node): CpSet {
  switch (n.t) {
    case "zero":
      return [];
    case "atom":
      return n.set;
    case "rep":
      return first(n.node);
    case "group":
      return n.alts.reduce<CpSet>((acc, alt) => union(acc, firstOfSeq(alt)), []);
  }
}

/** What a sequence can start with, honouring nullability: stop at the first mandatory element. */
function firstOfSeq(seq: readonly Node[]): CpSet {
  let acc: CpSet = [];
  for (const el of seq) {
    acc = union(acc, first(el));
    if (minLen(el) >= 1) break;
  }
  return acc;
}

function isVariable(n: Node): n is Extract<Node, { t: "rep" }> {
  return n.t === "rep" && n.max > n.min && n.max > 1;
}

function isMany(n: Node): n is Extract<Node, { t: "rep" }> {
  return n.t === "rep" && n.max > MANY;
}

/** Is `seq[i]` (a variable repeat) safely followed by a mandatory, disjoint character? */
function delimited(seq: readonly Node[], i: number, loopStart: CpSet): boolean {
  const itemSet = first((seq[i] as Extract<Node, { t: "rep" }>).node);
  for (let j = i + 1; j < seq.length; j++) {
    const el = seq[j] as Node;
    if (el.t === "zero") continue;
    if (intersects(first(el), itemSet)) return false;
    if (minLen(el) >= 1) return true;
  }
  // Reached the end of the repeated body: the next thing is the loop restart,
  // which begins with whatever any branch of the group can start with.
  return !intersects(loopStart, itemSet);
}

function describe(n: Node): string {
  return n.t === "zero" ? "(zero-width)" : n.src;
}

function literalOf(seq: readonly Node[]): string | null {
  let out = "";
  for (const n of seq) {
    if (n.t !== "atom" || n.lit === null) return null;
    out += n.lit;
  }
  return out;
}

function singleAtomBranch(seq: readonly Node[]): CpSet | null {
  if (seq.length !== 1) return null;
  const n = seq[0] as Node;
  if (n.t === "atom") return n.set;
  if (n.t === "rep" && n.node.t === "atom") return n.node.set;
  return null;
}

function isRepeatOf(long: string, short: string): boolean {
  return (
    short.length > 0 &&
    long.length > short.length &&
    long.length % short.length === 0 &&
    short.repeat(long.length / short.length) === long
  );
}

function walk(seq: readonly Node[], out: RegexRiskFinding[]): void {
  // Adjacent unbounded repeats with overlapping characters.
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = seq[i] as Node;
    const b = seq[i + 1] as Node;
    if (
      a.t === "rep" &&
      b.t === "rep" &&
      a.node.t === "atom" &&
      b.node.t === "atom" &&
      a.max === Number.POSITIVE_INFINITY &&
      b.max === Number.POSITIVE_INFINITY &&
      intersects(a.node.set, b.node.set)
    ) {
      out.push({
        kind: "adjacent-overlap",
        detail: `\`${a.src}${b.src}\`: two adjacent unbounded repeats match the same characters, so a failing match tries every split (polynomial time)`,
      });
    }
  }

  for (const n of seq) {
    if (n.t === "group") {
      for (const alt of n.alts) walk(alt, out);
      continue;
    }
    if (n.t !== "rep") continue;
    if (n.node.t === "group") {
      const group = n.node;
      for (const alt of group.alts) walk(alt, out);
      if (isMany(n)) checkRepeatedGroup(n, group, out);
    }
  }
}

function checkRepeatedGroup(
  rep: Extract<Node, { t: "rep" }>,
  group: Extract<Node, { t: "group" }>,
  out: RegexRiskFinding[],
): void {
  const loopStart = first(group);
  let flaggedNested = false;

  for (const alt of group.alts) {
    for (const [j, el] of alt.entries()) {
      if (!isVariable(el)) continue;
      if (delimited(alt, j, loopStart)) continue;
      flaggedNested = true;
      out.push({
        kind: "nested-quantifier",
        detail: `\`${rep.src}\`: \`${describe(el)}\` inside a repeated group has no distinct delimiter after it, so one input can be split exponentially many ways`,
      });
    }
  }

  if (!flaggedNested && minLen(group) === 0) {
    out.push({
      kind: "nullable-repeat",
      detail: `\`${rep.src}\`: the repeated group can match the empty string, so iterations can multiply without consuming input`,
    });
  }

  if (group.alts.length > MAX_BRANCHES) {
    out.push({
      kind: "unanalysed",
      detail: `\`${rep.src.slice(0, 40)}...\`: ${group.alts.length} alternation branches under a repeat is more than the ${MAX_BRANCHES} compared; branch overlap was not checked`,
    });
    return;
  }

  for (let a = 0; a < group.alts.length; a++) {
    for (let b = a + 1; b < group.alts.length; b++) {
      const A = group.alts[a] as Node[];
      const B = group.alts[b] as Node[];
      const sa = singleAtomBranch(A);
      const sb = singleAtomBranch(B);
      let why: string | null = null;
      if (sa !== null && sb !== null) {
        if (intersects(sa, sb)) why = "two branches can match the same character";
      } else {
        const la = literalOf(A);
        const lb = literalOf(B);
        if (la !== null && lb !== null) {
          if (la === lb) why = "two branches are identical";
          else if (isRepeatOf(la, lb) || isRepeatOf(lb, la)) {
            why = "one branch is a repetition of another";
          }
        }
      }
      if (why !== null) {
        out.push({
          kind: "overlapping-alternation",
          detail: `\`${rep.src.slice(0, 80)}\`: ${why} under an unbounded repeat, so the same text matches in many ways`,
        });
      }
    }
  }
}

/**
 * Report every catastrophic-backtracking SHAPE found in `source`. Empty result
 * means "none of the known shapes", not "safe" (see the module header).
 */
export function analyzeRegexRisk(source: string, flags = ""): readonly RegexRiskFinding[] {
  steps = 0;
  const out: RegexRiskFinding[] = [];
  try {
    const parser = new Parser(source, flags.includes("i"), flags.includes("s"));
    for (const alt of parser.parse()) walk(alt, out);
  } catch (err) {
    const reason = err instanceof Unanalysable ? err.message : "unexpected parser state";
    // Keep what was found before the budget ran out; add the honest gap.
    out.push({
      kind: "unanalysed",
      detail: `the pattern could not be fully analysed for backtracking risk (${reason})`,
    });
  }
  return out;
}
