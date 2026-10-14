/**
 * DUST2.11 / r042 — the static backtracking-shape check.
 *
 * Known-bad shapes must be flagged; known-good shapes (including the delimiter
 * cases that look nested but are linear) must stay quiet. The false-negative
 * cases are pinned too, so the documented profile cannot drift unnoticed.
 */

import { describe, expect, it } from "vitest";
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

describe("analyzeRegexRisk — known-good shapes stay quiet", () => {
  it.each([
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
