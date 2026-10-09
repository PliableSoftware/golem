/**
 * DUSTSEC.24 review fixes. Every comparison is against the ORIGINAL patterns
 * (written out below exactly as they stood on development before DUSTSEC.24),
 * not against the previous revision of this branch.
 *
 * 1. connection-password: no leading `\b`, so a scheme glued onto other word
 *    characters (or longer than the bound) still has its password redacted.
 * 2. private-key: the scan bound is the end of the last COMPLETE END line, so a
 *    trailing `-----END CERTIFICATE-----` or an unterminated END line does not
 *    bring the quadratic scan back.
 * 3. credit-card: the hex-token exemption applies to separator-free runs only.
 * 4. email: a long local part is redacted from within 128 characters of the `@`.
 * 6. scanEnd's return is clamped toward MORE redaction.
 *
 * Secret-shaped values are built at runtime; no literal is committed.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  clampScanEnd,
  redactIdentifierText,
  redactStandaloneText,
} from "../../../src/pipeline/redaction.js";
import {
  isCreditCardLike,
  luhnValid,
  REDACTION_RULES,
} from "../../../src/pipeline/redaction-rules.js";

const MARK = `[${"REDACTED"}:`;
const rule = (id: string) => {
  const found = REDACTION_RULES.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found;
};

// The patterns as they stood on development before DUSTSEC.24.
const OLD_CONN = new RegExp(
  String.raw`\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:@/]+:(?!\[${"REDACTED"}:connection-password:\d+\]@)([^\s@/]+)@`,
  "gd",
);
const OLD_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const OLD_PEM =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/g;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomText(rand: () => number, pieces: readonly string[], alphabet: string): string {
  const parts = 1 + Math.floor(rand() * 8);
  let out = "";
  for (let i = 0; i < parts; i++) {
    if (rand() < 0.5) out += pieces[Math.floor(rand() * pieces.length)] as string;
    else {
      const n = Math.floor(rand() < 0.5 ? rand() * 100 : rand() * rand() * 20);
      for (let k = 0; k < n; k++) out += alphabet[Math.floor(rand() * alphabet.length)];
    }
  }
  return out;
}

function base62(seed: string, n: number): string {
  const alphabet = `${"ABCDEFGHIJKLMNOPQRSTUVWXYZ"}${"abcdefghijklmnopqrstuvwxyz"}0123456789`;
  let out = "";
  for (let i = 0; out.length < n; i++) {
    for (const b of createHash("sha256").update(`${seed}:${i}`).digest()) {
      if (b < 248 && out.length < n) out += alphabet[b % 62];
    }
  }
  return out;
}

function timed(fn: () => void, runs = 3): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return samples.sort((a, b) => a - b)[Math.floor(runs / 2)] as number;
}

const matches = (re: RegExp, text: string): RegExpMatchArray[] => [
  ...text.matchAll(new RegExp(re.source, re.flags.includes("d") ? re.flags : `${re.flags}d`)),
];
const groupSpans = (re: RegExp, text: string): [number, number][] =>
  matches(re, text).map(
    (m) => (m as RegExpMatchArray & { indices: [number, number][] }).indices[1] as [number, number],
  );

describe("DUSTSEC.24 review (1) connection-password has no leading boundary", () => {
  const pw = base62("pw", 14);
  const inputs: [string, string][] = [
    ["129 letters", "a".repeat(129)],
    ["a long mixed word", "Ab9".repeat(70)],
    ["hex glued onto the scheme", "deadbeef".repeat(20)],
    ["a long scheme with a boundary far away", `${"b".repeat(200)}.`],
  ];
  for (const [name, head] of inputs) {
    for (const scheme of ["", "postgres"]) {
      it(`${name}${scheme === "" ? "" : ` + ${scheme}`}: only the password is replaced`, () => {
        const url = `${head}${scheme}://admin:${pw}@db`;
        const out = redactIdentifierText(url);
        expect(out).not.toContain(pw);
        // The span replaced is the password and nothing else.
        expect(out).toBe(`${head}${scheme}://admin:${MARK}connection-password:1]@db`);
        // A second pass changes nothing.
        expect(redactIdentifierText(out)).toBe(out);
        expect(redactStandaloneText(out)).toBe(redactStandaloneText(redactStandaloneText(out)));
      });
    }
  }

  it("fuzz: never misses a password the original rule caught, never changes a span, idempotent", () => {
    const rand = rng(77);
    const pieces = [
      "://",
      ":",
      "@",
      "/",
      "x://u:",
      "pg+a.b://user:",
      "u:pw@h",
      "pw@",
      "postgres",
      "a.b",
      "+",
      "-",
      ".",
      " ",
      "\n",
      "ab9",
      "deadbeef",
      `${MARK}connection-password:1]`,
      `${MARK}connection-password:2]@`,
    ];
    let oldHits = 0;
    let extra = 0;
    for (let i = 0; i < 8000; i++) {
      const text = randomText(rand, pieces, "abcXYZ019.-+_");
      const before = groupSpans(OLD_CONN, text);
      const after = groupSpans(rule("connection-password").pattern, text);
      oldHits += before.length;
      for (const [s, e] of before) {
        expect(
          after.some(([s2, e2]) => s2 === s && e2 === e),
          JSON.stringify(text),
        ).toBe(true);
      }
      extra += after.length - before.length;
      const once = redactIdentifierText(text);
      expect(redactIdentifierText(once), JSON.stringify(text)).toBe(once);
    }
    expect(oldHits).toBeGreaterThan(100);
    expect(extra).toBeGreaterThanOrEqual(0);
  });

  it("stays linear on a long legal-scheme-alphabet run", () => {
    const tSmall = timed(() => redactIdentifierText("a.".repeat(100_000)));
    const tBig = timed(() => redactIdentifierText("a.".repeat(800_000)));
    expect(tBig / Math.max(tSmall, 1)).toBeLessThan(24);
  }, 120_000);
});

describe("DUSTSEC.24 review (2) private-key scan bound is the last COMPLETE END line", () => {
  const begin = `-----BEGIN ${"PRIVATE"} KEY-----\n`;
  const badEnds = [
    ["a CERTIFICATE end", "-----END CERTIFICATE-----"],
    ["an END with no closing dashes", `-----END ${"PRIVATE"} KEY`],
    ["an END with four closing dashes", `-----END ${"PRIVATE"} KEY----`],
    ["a PUBLIC KEY end", "-----END PUBLIC KEY-----"],
  ] as const;
  for (const [name, end] of badEnds) {
    it(`${name} after many BEGIN lines is linear and nothing is redacted`, () => {
      const make = (n: number) => `${begin.repeat(n)}${end}`;
      const tSmall = timed(() => redactIdentifierText(make(8_000)));
      const tBig = timed(() => redactIdentifierText(make(64_000)));
      expect(redactIdentifierText(make(64_000))).toBe(make(64_000));
      expect(tBig / Math.max(tSmall, 1)).toBeLessThan(24);
    }, 120_000);
  }

  it("a BEGIN with no END is not redacted, exactly as the original rule did", () => {
    const text = `${begin}MIIBabc\nmore\n`;
    expect(matches(OLD_PEM, text)).toHaveLength(0);
    expect(redactIdentifierText(text)).toBe(text);
  });

  it("a complete block after the bad shapes is still redacted whole", () => {
    const block = `${begin.repeat(3)}KEYBODY\n-----END ${"PRIVATE"} KEY-----`;
    const text = `${begin.repeat(500)}-----END CERTIFICATE-----\n${block}\nafter`;
    const out = redactIdentifierText(text);
    expect(out).not.toContain("KEYBODY");
    expect(out.endsWith("\nafter")).toBe(true);
  });

  it("differential: 8000 random BEGIN/END mixes match the original rule exactly", () => {
    const pem = rule("private-key");
    const pieces = [
      `-----BEGIN ${"PRIVATE"} KEY-----`,
      `-----BEGIN RSA ${"PRIVATE"} KEY-----`,
      `-----BEGIN ${"ENCRYPTED"} ${"PRIVATE"} KEY-----`,
      `-----BEGIN ${"PRIVATE"} KEY`,
      "-----BEGIN CERTIFICATE-----",
      "-----END CERTIFICATE-----",
      `-----END ${"PRIVATE"} KEY-----`,
      `-----END RSA ${"PRIVATE"} KEY-----`,
      `-----END ${"PRIVATE"} KEY`,
      `-----END ${"PRIVATE"} KEY----`,
      `-----END ${"PRIVATE"} KEY-----END ${"PRIVATE"} KEY-----`,
      `-----END ${"PRIVATE"} KEY BLOCK-----`,
      "-----BEGIN PUBLIC KEY-----",
      "-----END PUBLIC KEY-----",
      "-----END ",
      "-----BEGIN ",
      "-----",
      "\n",
      " ",
      "MIIB",
    ];
    const rand = rng(5150);
    let withMatch = 0;
    for (let i = 0; i < 8000; i++) {
      const text = randomText(rand, pieces, "ABCabc09+/=\n ");
      const bound = pem.scanEnd?.(text) ?? text.length;
      const expected = matches(OLD_PEM, text).map((m) => [m.index, m[0]]);
      if (expected.length > 0) withMatch += 1;
      const got = matches(pem.pattern, text.slice(0, bound)).map((m) => [m.index, m[0]]);
      expect(got, JSON.stringify(text)).toEqual(expected);
    }
    expect(withMatch).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// (3) credit card
// ---------------------------------------------------------------------------

function withCheckDigit(digits: string): string {
  for (let d = 0; d < 10; d++) if (luhnValid(`${digits}${d}`)) return `${digits}${d}`;
  throw new Error("unreachable");
}
const CARD = withCheckDigit("411111111111111");
const groups = (sep: string): string => (CARD.match(/.{4}/g) ?? []).join(sep);

describe("DUSTSEC.24 review (3) the hex-token exemption is for separator-free runs only", () => {
  it("fixtures are cards", () => {
    expect(isCreditCardLike(CARD)).toBe(true);
    expect(isCreditCardLike(groups(" "))).toBe(true);
  });

  it("a separated card is redacted whatever hex-looking text touches it", () => {
    for (const sep of [" ", "-"]) {
      for (const [l, r] of [
        ["a", "b"],
        ["", "f"],
        ["cafe", ""],
        ["B", "D"],
        ["cc", "ab"],
        ["ab", " x"],
      ]) {
        const text = `${l}${groups(sep)}${r}`;
        const out = redactIdentifierText(text);
        expect(out, JSON.stringify(text)).toBe(`${l}${MARK}credit-card:1]${r}`);
      }
    }
  });

  it("ACCEPTED WEAKENING: separator-free runs glued to hex-only tokens are not redacted", () => {
    for (const text of [
      `a${CARD}`,
      `${CARD}f`,
      `cc${CARD}`,
      `cafe${CARD}`,
      `B${CARD}`,
      `${CARD}D`,
      `ID=abc${CARD}`,
      `pan=${CARD}ab`,
    ]) {
      expect(redactIdentifierText(text), text).toBe(text);
    }
  });

  it("separator-free runs that stay redacted", () => {
    for (const text of [
      CARD,
      `Visa${CARD}`,
      `${CARD}USD`,
      `id_${CARD}`,
      `ID=xyz${CARD}`,
      `pan=${CARD}gh`,
      `x${CARD}`,
      `card ${CARD}`,
      `cafe ${CARD}`,
    ]) {
      expect(redactIdentifierText(text), text).toContain(`${MARK}credit-card:`);
    }
  });
});

// ---------------------------------------------------------------------------
// (4) email
// ---------------------------------------------------------------------------

describe("DUSTSEC.24 review (4) email: the match always begins within 128 characters of the @", () => {
  const spansOf = (re: RegExp, text: string) =>
    matches(re, text).map((m) => [m.index, m[0]] as const);

  it("realistic addresses: 300 generated, identical to the original rule", () => {
    const rand = rng(8);
    const word = () =>
      base62(`w${Math.floor(rand() * 1e9)}`, 2 + Math.floor(rand() * 14)).toLowerCase();
    const tlds = ["com", "org", "io", "co.uk", "dev"];
    let n = 0;
    for (let i = 0; i < 300; i++) {
      const sepa = [".", "_", "-", "+", "%", ""][Math.floor(rand() * 6)] as string;
      const local = `${word()}${sepa}${word()}`;
      const host = `${word()}${rand() < 0.4 ? `.${word()}` : ""}.${tlds[Math.floor(rand() * tlds.length)]}`;
      const addr = `${local}@${host}`;
      for (const text of [
        addr,
        `mail ${addr} now`,
        `<${addr}>`,
        `"${addr}",`,
        `(${addr}).`,
        `to:${addr}\n`,
      ]) {
        expect(spansOf(rule("email").pattern, text), text).toEqual(spansOf(OLD_EMAIL, text));
        n += 1;
      }
    }
    expect(n).toBe(1800);
  });

  it("fuzz: same end and same text once leading punctuation is dropped, for runs up to 128", () => {
    const rand = rng(404);
    const pieces = ["@", ".com", ".", "-", "+", "_", " ", "\n", "..", "a@b.org", "x.y@z.io", "%"];
    let hits = 0;
    for (let i = 0; i < 8000; i++) {
      const text = randomText(rand, pieces, "abcXYZ019.-_");
      if (/[A-Za-z0-9._%+-]{129,}/.test(text)) continue;
      const before = spansOf(OLD_EMAIL, text);
      const after = spansOf(rule("email").pattern, text);
      hits += before.length;
      // Every original match is found, ending in the same place; the new match may
      // begin later only by leading punctuation the original also never started on.
      expect(after.length, JSON.stringify(text)).toBe(before.length);
      before.forEach(([idx, t], k) => {
        const [idx2, t2] = after[k] as readonly [number, string];
        expect(idx2 + t2.length, JSON.stringify(text)).toBe((idx as number) + t.length);
        expect(t.replace(/^[._%+-]+/, ""), JSON.stringify(text)).toBe(t2.replace(/^[._%+-]+/, ""));
      });
    }
    expect(hits).toBeGreaterThan(500);
  });

  const ph = `${MARK}email:1]`;
  it("a 129+ character alphanumeric local part: the tail and the domain are redacted", () => {
    for (const len of [129, 200, 5000]) {
      const local = base62("long", len);
      const out = redactIdentifierText(`${local}@example.com`);
      expect(out.endsWith(ph)).toBe(true);
      // Only the head beyond the last 128 characters stays.
      expect(out).toBe(`${local.slice(0, len - 128)}${ph}`);
    }
  });

  it("a long dotted local part is redacted from within 128 characters of the @", () => {
    for (const len of [129, 400]) {
      const local = "ab.".repeat(len / 3 + 1).slice(0, len);
      const out = redactIdentifierText(`${local}@example.com`);
      expect(out.endsWith(ph)).toBe(true);
      expect(out.length - ph.length).toBeLessThanOrEqual(len - 126);
      expect(out).not.toContain("@");
    }
  });

  it("dotted runs stay linear", () => {
    const tSmall = timed(() => redactIdentifierText("a.".repeat(100_000)));
    const tBig = timed(() => redactIdentifierText("a.".repeat(800_000)));
    expect(tBig / Math.max(tSmall, 1)).toBeLessThan(24);
  }, 120_000);
});

describe("DUSTSEC.24 review (6) scanEnd is clamped toward more redaction", () => {
  it("passes a sane bound through, and falls back to the whole text otherwise", () => {
    expect(clampScanEnd(0, 10)).toBe(0);
    expect(clampScanEnd(4, 10)).toBe(4);
    expect(clampScanEnd(10, 10)).toBe(10);
    for (const bad of [
      Number.NaN,
      -1,
      11,
      1e9,
      3.5,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(clampScanEnd(bad, 10), String(bad)).toBe(10);
    }
    expect(clampScanEnd(undefined as unknown as number, 10)).toBe(10);
    expect(clampScanEnd("3" as unknown as number, 10)).toBe(10);
  });
});
