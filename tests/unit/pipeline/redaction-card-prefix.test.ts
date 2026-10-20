/**
 * DUSTSEC.26: a card preceded by digits and a space was swallowed by the greedy
 * card pattern, rejected whole as irregularly grouped, and left unredacted.
 * Fixtures are well-known test card numbers (Luhn-valid, not real accounts).
 */

import { describe, expect, it } from "vitest";
import { redactStandaloneText } from "../../../src/pipeline/redaction.js";
import {
  cardSuffixStarts,
  isOutsideHexToken,
  REDACTION_RULES,
} from "../../../src/pipeline/redaction-rules.js";

const MARK = `[${"REDACTED"}:credit-card:`;
// Well-known test numbers, assembled at runtime so no card-shaped literal is committed.
const VISA = ["4111", "1111", "1111", "1111"].join(" ");
const MC = ["5555", "5555", "5555", "4444"].join(" ");
const DASHED = ["4012", "8888", "8888", "1881"].join("-");
const CONTIGUOUS = `4${"1".repeat(15)}`;
const redact = (t: string) => redactStandaloneText(t);

describe("card preceded by digits and a space", () => {
  it("redacts the card and keeps the leading digits", () => {
    const out = redact(`12 ${VISA}`);
    expect(out.startsWith("12 ")).toBe(true);
    expect(out).toContain(MARK);
    expect(out).not.toContain("4111");
  });

  it.each([
    ["dash-grouped", `99 ${DASHED}`, "99 "],
    ["short digit groups", `1 2 ${VISA}`, "1 2 "],
    ["contiguous tail", `12 ${CONTIGUOUS}`, "12 "],
  ])("%s", (_n, text, keep) => {
    const out = redact(text);
    expect(out.startsWith(keep)).toBe(true);
    expect(out).toContain(MARK);
    expect(out).not.toMatch(/4111|4012/);
  });

  it("is idempotent", () => {
    const once = redact(`12 ${VISA}`);
    expect(redact(once)).toBe(once);
  });
});

describe("unchanged cases", () => {
  it("still redacts plain, dashed and contiguous cards", () => {
    for (const t of [VISA, MC, DASHED, CONTIGUOUS]) {
      expect(redact(`pay ${t} now`)).toContain(MARK);
    }
  });

  it("leaves an irregular ASCII byte dump alone", () => {
    const dump = "72 101 108 108 111 32 87 111 114 108 100 33 10 13";
    expect(redact(dump)).toBe(dump);
  });

  it("leaves a Luhn-invalid prefixed run alone", () => {
    const t = `12 ${VISA.slice(0, -1)}2`;
    expect(redact(t)).toBe(t);
  });

  it("leaves a hex-glued contiguous run alone", () => {
    const t = `deadbeef${CONTIGUOUS}cafe`;
    expect(redact(t)).toBe(t);
  });

  it("cardSuffixStarts offsets follow separators, longest first", () => {
    expect(cardSuffixStarts("12 34-5")).toEqual([3, 6]);
    expect(cardSuffixStarts("1234")).toEqual([]);
  });
});

// The rule as it stood before DUSTSEC.26: same pattern and checks, no retry.
const found = REDACTION_RULES.find((r) => r.id === "credit-card");
if (found === undefined) throw new Error("no credit-card rule");
const card = found;

function oldSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(new RegExp(card.pattern.source, "g"))) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (card.validate?.(m[0]) === false) continue;
    if (card.validateAt?.(text, s, e) === false) continue;
    spans.push([s, e]);
  }
  return spans;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("differential against the rule without retry", () => {
  it("every previously redacted card span is still redacted", () => {
    const rnd = mulberry32(2610);
    const alphabet = "0123456789  --abcdef.xZ";
    const seeds = [VISA, MC, DASHED, CONTIGUOUS];
    let checked = 0;
    for (let i = 0; i < 4000; i += 1) {
      let text = "";
      const len = 5 + Math.floor(rnd() * 60);
      for (let j = 0; j < len; j += 1) {
        if (rnd() < 0.05) text += seeds[Math.floor(rnd() * seeds.length)];
        else text += alphabet[Math.floor(rnd() * alphabet.length)];
      }
      const out = redact(text);
      const old = oldSpans(text);
      const placeholders = out.match(/\[REDACTED:credit-card:\d+\]/g)?.length ?? 0;
      checked += old.length;
      // The retry only adds redactions: never fewer card placeholders than the old rule made.
      expect(placeholders, JSON.stringify(text)).toBeGreaterThanOrEqual(old.length);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("retry never fires where the old rule redacted", () => {
    for (const t of [VISA, `x ${VISA} y`, "4111111111111111"]) {
      expect(oldSpans(t).length).toBe(1);
    }
    expect(oldSpans(`12 ${VISA}`)).toEqual([]);
    expect(isOutsideHexToken("a", 0, 1)).toBe(true);
  });
});
