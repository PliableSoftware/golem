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
 *  - Case folding is approximated by comparing a character with its upper- and
 *    lower-case forms under the `i` flag; character sets are compared over code
 *    points up to U+017F plus a few sentinels.
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

type Test = (cp: number) => boolean;

type Node =
  | { readonly t: "atom"; readonly test: Test; readonly lit: string | null; readonly src: string }
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
const SAMPLE_LIMIT = 0x17f;
const SENTINELS = [0x2028, 0x4e00, 0x1f600];

class Unanalysable extends Error {}

const isDigit: Test = (c) => c >= 48 && c <= 57;
const isWord: Test = (c) => isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isSpace: Test = (c) =>
  c === 32 ||
  (c >= 9 && c <= 13) ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000 ||
  c === 0xfeff;
const not =
  (t: Test): Test =>
  (c) =>
    !t(c);
const anyChar: Test = () => true;

function overlaps(a: Test, b: Test): boolean {
  for (let c = 0; c <= SAMPLE_LIMIT; c++) if (a(c) && b(c)) return true;
  for (const c of SENTINELS) if (a(c) && b(c)) return true;
  return false;
}

function caseFold(t: Test): Test {
  return (c) => {
    if (t(c)) return true;
    const ch = String.fromCodePoint(c);
    const up = ch.toUpperCase();
    const lo = ch.toLowerCase();
    return (
      (up.length === ch.length && t(up.codePointAt(0) ?? c)) ||
      (lo.length === ch.length && t(lo.codePointAt(0) ?? c))
    );
  };
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

  private mk(test: Test, lit: string | null, src: string): Node {
    return { t: "atom", test: this.ignoreCase ? caseFold(test) : test, lit, src };
  }

  private atom(depth: number): Node {
    const start = this.i;
    const ch = this.s[this.i++] as string;
    switch (ch) {
      case "^":
      case "$":
        return { t: "zero" };
      case ".":
        return this.mk(
          this.dotAll ? anyChar : (c) => c !== 10 && c !== 13 && c !== 0x2028 && c !== 0x2029,
          null,
          ".",
        );
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
        return this.mk((c) => c === cp, lit, lit);
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
        return this.mk(isDigit, null, src);
      case "D":
        return this.mk(not(isDigit), null, src);
      case "w":
        return this.mk(isWord, null, src);
      case "W":
        return this.mk(not(isWord), null, src);
      case "s":
        return this.mk(isSpace, null, src);
      case "S":
        return this.mk(not(isSpace), null, src);
      case "p":
      case "P":
        // Unicode property: not modelled, so assume it can overlap anything.
        if (this.s[this.i] === "{") {
          const close = this.s.indexOf("}", this.i);
          if (close < 0) throw new Unanalysable("unterminated \\p{}");
          this.i = close + 1;
        }
        return this.mk(anyChar, null, this.s.slice(start, this.i));
      case "b":
        if (inClass) return this.mk((c) => c === 8, "\b", src);
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
          if (Number.isNaN(v) || v > 0x10ffff) throw new Unanalysable("bad \\u{}");
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
          while (this.i < this.s.length && isDigit(this.s.charCodeAt(this.i))) this.i++;
          return { t: "zero" }; // backreference: not analysed
        }
        return this.lit(e, src);
    }
  }

  private lit(ch: string, src: string): Node {
    const cp = ch.codePointAt(0) as number;
    return this.mk((c) => c === cp, ch, src);
  }

  private charClass(start: number): Node {
    let negate = false;
    if (this.s[this.i] === "^") {
      negate = true;
      this.i++;
    }
    const parts: Test[] = [];
    const single = (): { test: Test; cp: number | null } => {
      if (this.i >= this.s.length) throw new Unanalysable("unterminated class");
      const ch = this.s[this.i] as string;
      if (ch === "\\") {
        const at = this.i;
        this.i++;
        const n = this.escape(at, true);
        if (n.t === "atom") {
          const cp = n.lit === null ? null : (n.lit.codePointAt(0) as number);
          return { test: n.test, cp };
        }
        return { test: () => false, cp: null };
      }
      const cp = this.s.codePointAt(this.i) as number;
      this.i += cp > 0xffff ? 2 : 1;
      return { test: (c) => c === cp, cp };
    };
    while (true) {
      if (this.i >= this.s.length) throw new Unanalysable("unterminated class");
      if (this.s[this.i] === "]") {
        this.i++;
        break;
      }
      const lo = single();
      if (this.s[this.i] === "-" && this.s[this.i + 1] !== "]" && this.i + 1 < this.s.length) {
        const save = this.i;
        this.i++;
        const hi = single();
        if (lo.cp !== null && hi.cp !== null) {
          const a = lo.cp;
          const b = hi.cp;
          parts.push((c) => c >= a && c <= b);
          continue;
        }
        // `\w-x` style: the dash is literal.
        this.i = save;
      }
      parts.push(lo.test);
    }
    const union: Test = (c) => parts.some((p) => p(c));
    const base = negate ? not(union) : union;
    return {
      t: "atom",
      test: this.ignoreCase && !negate ? caseFold(base) : base,
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
function first(n: Node): Test {
  switch (n.t) {
    case "zero":
      return () => false;
    case "atom":
      return n.test;
    case "rep":
      return first(n.node);
    case "group": {
      const tests = n.alts.flatMap((a) => a.map(first));
      return (c) => tests.some((t) => t(c));
    }
  }
}

function firstOfAlts(alts: readonly Node[][]): Test {
  const tests = alts.flatMap((a) => a.map(first));
  return (c) => tests.some((t) => t(c));
}

function isVariable(n: Node): n is Extract<Node, { t: "rep" }> {
  return n.t === "rep" && n.max > n.min && n.max > 1;
}

function isMany(n: Node): n is Extract<Node, { t: "rep" }> {
  return n.t === "rep" && n.max > MANY;
}

/** Is `item` (index i of `seq`) safely followed by a mandatory, disjoint character? */
function delimited(seq: readonly Node[], i: number, loopStart: Test): boolean {
  const itemSet = first((seq[i] as Node & { t: "rep" }).node);
  for (let j = i + 1; j < seq.length; j++) {
    const el = seq[j] as Node;
    if (el.t === "zero") continue;
    if (overlaps(first(el), itemSet)) return false;
    if (minLen(el) >= 1) return true;
  }
  // Reached the end of the repeated body: the next thing is the loop restart.
  return !overlaps(loopStart, itemSet);
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

function singleAtomBranch(seq: readonly Node[]): Test | null {
  if (seq.length !== 1) return null;
  const n = seq[0] as Node;
  if (n.t === "atom") return n.test;
  if (n.t === "rep" && n.node.t === "atom") return n.node.test;
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
      overlaps(first(a.node), first(b.node))
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
  const loopStart = firstOfAlts(group.alts);
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

  if (group.alts.length >= 2) {
    for (let a = 0; a < group.alts.length; a++) {
      for (let b = a + 1; b < group.alts.length; b++) {
        const A = group.alts[a] as Node[];
        const B = group.alts[b] as Node[];
        const sa = singleAtomBranch(A);
        const sb = singleAtomBranch(B);
        let why: string | null = null;
        if (sa !== null && sb !== null) {
          if (overlaps(sa, sb)) why = "two branches can match the same character";
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
            detail: `\`${rep.src}\`: ${why} under an unbounded repeat, so the same text matches in many ways`,
          });
        }
      }
    }
  }
}

/**
 * Report every catastrophic-backtracking SHAPE found in `source`. Empty result
 * means "none of the known shapes", not "safe" (see the module header).
 */
export function analyzeRegexRisk(source: string, flags = ""): readonly RegexRiskFinding[] {
  try {
    const parser = new Parser(source, flags.includes("i"), flags.includes("s"));
    const alts = parser.parse();
    const out: RegexRiskFinding[] = [];
    for (const alt of alts) walk(alt, out);
    return out;
  } catch (err) {
    const reason = err instanceof Unanalysable ? err.message : "unexpected parser state";
    return [
      {
        kind: "unanalysed",
        detail: `the pattern could not be analysed for backtracking risk (${reason})`,
      },
    ];
  }
}
