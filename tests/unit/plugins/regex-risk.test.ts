/**
 * DUST2.11 / r042 — the static backtracking-shape check.
 *
 * Known-bad shapes must be flagged; known-good shapes (including the delimiter
 * cases that look nested but are linear) must stay quiet. The false-negative
 * cases are pinned too, so the documented profile cannot drift unnoticed.
 */

import { describe, expect, it } from "vitest";
import { ENTROPY_CANDIDATE_RE, REDACTION_RULES } from "../../../src/pipeline/redaction-rules.js";
import { analyzeRegexRisk } from "../../../src/plugins/regex-risk.js";

const kinds = (src: string, flags = "g"): string[] =>
  analyzeRegexRisk(src, flags).map((f) => f.kind);

describe("analyzeRegexRisk — known-bad shapes are flagged", () => {
  it.each([
    ["(a+)+$", "nested-quantifier"],
    ["(a*)*", "nested-quantifier"],
    ["([a-z]+)*x", "nested-quantifier"],
    ["(\\d+)+", "nested-quantifier"],
    ["(.*a){12}", "nested-quantifier"],
    ["(?:\\w+\\s?)+$", "nested-quantifier"],
    ["((a+))+$", "nested-quantifier"],
    ["(?:(?:a+))+$", "nested-quantifier"],
    ["((a+)b?)+$", "nested-quantifier"],
    ["((\\w+)\\s*)+", "nested-quantifier"],
    ["(?:(?:a|a))+", "overlapping-alternation"],
    ["(a?)*", "nullable-repeat"],
    ["(|a)+", "nullable-repeat"],
    ["(a|a)*", "overlapping-alternation"],
    ["(a|aa)+", "overlapping-alternation"],
    ["(\\w|\\d)+", "overlapping-alternation"],
    ["(.|a)*", "overlapping-alternation"],
    ["(a|b|a)+", "overlapping-alternation"],
    ["\\d+\\d+", "adjacent-overlap"],
    [".*.*", "adjacent-overlap"],
  ])("%s -> %s", (src, kind) => {
    expect(kinds(src)).toContain(kind);
  });

  it("explains the finding with the offending fragment", () => {
    const [finding] = analyzeRegexRisk("^(a+)+$", "g");
    expect(finding?.detail).toContain("(a+)+");
  });

  it("finds the shape inside a larger pattern and inside a non-repeated group", () => {
    expect(kinds("prefix-(?:token=(a+)+)end")).toContain("nested-quantifier");
  });

  it("respects the i flag when deciding two branches overlap", () => {
    expect(kinds("(a|A)+", "gi")).toContain("overlapping-alternation");
    expect(kinds("(a|A)+", "g")).not.toContain("overlapping-alternation");
  });
});

describe("analyzeRegexRisk — non-Latin scripts are compared exactly (intervals, not samples)", () => {
  it("flags overlapping CJK branches", () => {
    expect(kinds("(\u4e01|[\u4e00-\u4e10])+$")).toContain("overlapping-alternation");
  });
  it("flags the Cyrillic nested shape like the Latin one", () => {
    expect(kinds("(\u0430+\u0430)+$")).toContain("nested-quantifier");
    expect(kinds("(a+a)+$")).toContain("nested-quantifier");
  });
  it("keeps disjoint non-Latin branches quiet", () => {
    expect(kinds("(\u4e01|\u4e02)+")).toEqual([]);
  });
  it("folds case outside ASCII under the i flag", () => {
    expect(kinds("(\u0430|\u0410)+", "gi")).toContain("overlapping-alternation");
  });
});

describe("analyzeRegexRisk — work is budgeted", () => {
  const wide = (n: number): string =>
    `(?:${Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i % 26)) + (i >= 26 ? String(i) : "")).join("|")})+`;
  it.each([500, 2000])("%i single-character branches with /i finish quickly", (n) => {
    const src = `(?:${Array.from({ length: n }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("|")})+`;
    const t0 = performance.now();
    const found = analyzeRegexRisk(src, "gi");
    expect(performance.now() - t0).toBeLessThan(200);
    expect(found.map((f) => f.kind)).toEqual(["unanalysed"]);
  });
  it("still compares a normal-width alternation", () => {
    expect(kinds(wide(20))).toEqual([]);
  });
});

describe("analyzeRegexRisk — known-good shapes stay quiet", () => {
  it.each([
    "\\b(?:\\d[ -]*?){13,16}\\b", // card number: delimited by the digit
    "(?:\\s*,\\s*\\w+)+",
    "AKIA[0-9A-Z]{16}",
    "\\bsk-[A-Za-z0-9]{20,}\\b",
    "[A-Za-z0-9+/]{40,}={0,2}",
    "([a-z]+\\.)+[a-z]{2,}", // delimited: linear
    "(?:\\d{1,3}\\.){3}\\d{1,3}",
    "(a|b|c)+",
    "(.|\\n)*", // disjoint: `.` excludes newline
    "(?:foo|bar)+",
    "\\w+@\\w+\\.com",
    "(?<=key=)(a|b)*",
    "(\\d{3}-)+",
    "[\\w.-]+:[\\w.-]+@",
    "(?:^|[^a-z])token=[a-z]{8}",
  ])("%s", (src) => {
    expect(kinds(src)).toEqual([]);
  });

  it("does not treat a bounded small repeat as a risk", () => {
    expect(kinds("(a+){3}")).toEqual([]);
  });
});

describe("analyzeRegexRisk — documented false negatives", () => {
  it("does not see overlap between non-adjacent repeats", () => {
    expect(kinds(".*x.*y")).toEqual([]);
  });
  it("does not see branch ambiguity beyond single atoms and repeated literals", () => {
    expect(kinds("(a|ab|b)*")).toEqual([]);
  });
});

describe("analyzeRegexRisk — never throws, never silent", () => {
  it.each([
    "(a",
    "[a",
    "a\\",
    "(?<n",
    `${"(".repeat(60)}a${")".repeat(60)}`,
  ])("reports %s as unanalysed", (src) => {
    expect(kinds(src)).toEqual(["unanalysed"]);
  });

  it("handles escapes, classes, unicode and named groups without error", () => {
    const src = "(?<k>\\p{L}+)\\u{1F600}[\\d\\-_]\\x41\\cJ\\1\\k<k>";
    expect(kinds(src, "u")).not.toContain("unanalysed");
  });
});

describe("analyzeRegexRisk — Golem's own rules are clean", () => {
  it.each(REDACTION_RULES.map((r) => [r.id, r.pattern] as const))("built-in rule %s", (_id, re) => {
    expect(analyzeRegexRisk(re.source, re.flags)).toEqual([]);
  });
  it("the entropy candidate pattern", () => {
    expect(analyzeRegexRisk(ENTROPY_CANDIDATE_RE.source, ENTROPY_CANDIDATE_RE.flags)).toEqual([]);
  });
});

describe("analyzeRegexRisk — literal comparison is budgeted", () => {
  it("64 branches of 100k characters finish fast and report the gap", () => {
    const branch = "a".repeat(100_000);
    const src = `(?:${Array.from({ length: 64 }, () => branch).join("|")})+`;
    const t0 = performance.now();
    const found = analyzeRegexRisk(src, "g");
    expect(performance.now() - t0).toBeLessThan(200);
    expect(found.map((f) => f.kind)).toContain("unanalysed");
  });
});
