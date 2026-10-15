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

  it("fuzz (placeholders included): never misses a password the original rule caught, never changes a span", () => {
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
  /** What the ORIGINAL rule produces: each match replaced, one placeholder per distinct value. */
  const oldEmail = (text: string): string => {
    const seen = new Map<string, number>();
    return text.replace(OLD_EMAIL, (m) => {
      if (!seen.has(m)) seen.set(m, seen.size + 1);
      return `${MARK}email:${seen.get(m)}]`;
    });
  };
  // The new rule alone, with the same placeholder numbering.
  const newEmail = (text: string): string => redactIdentifierText(text);

  it("realistic addresses: 1800 generated texts, identical output to the original rule", () => {
    const rand = rng(8);
    const word = () =>
      base62(`w${Math.floor(rand() * 1e9)}`, 2 + Math.floor(rand() * 14))
        .toLowerCase()
        .replace(/[0-9]/g, "q");
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
        `${addr} ${addr}`,
      ]) {
        expect(newEmail(text), text).toBe(oldEmail(text));
        n += 1;
      }
    }
    expect(n).toBe(2100);
  });

  it("fuzz: 8000 texts with runs up to 128, same redactions as the original rule", () => {
    const rand = rng(404);
    const pieces = [
      "@",
      ".com",
      ".",
      "-",
      "+",
      "_",
      " ",
      "\n",
      "..",
      "%",
      "a@b.co",
      "x@",
      "@y.org",
      ".org-z@w.io",
    ];
    let hits = 0;
    let checked = 0;
    for (let i = 0; i < 8000; i++) {
      const text = randomText(rand, pieces, "abcXYZ.-_");
      if (/[A-Za-z0-9._%+-]{129,}/.test(text)) continue;
      checked += 1;
      if (OLD_EMAIL.test(text)) hits += 1;
      OLD_EMAIL.lastIndex = 0;
      expect(newEmail(text), JSON.stringify(text)).toBe(oldEmail(text));
    }
    expect(checked).toBeGreaterThan(5000);
    expect(hits).toBeGreaterThan(1000);
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

// ---------------------------------------------------------------------------
// Second review: a scheme of any length, and idempotence across rules.
// ---------------------------------------------------------------------------

describe("DUSTSEC.24 second review (1) a scheme of any length still has its password redacted", () => {
  const pw = base62("pw2", 12);
  const heads: [string, string][] = [
    ["a + 200 digits", `a${"1".repeat(200)}`],
    ["a + 130 dots", `a${".".repeat(130)}`],
    ["a + 300 plus", `a${"+".repeat(300)}`],
    ["a + 500 hyphens", `a${"-".repeat(500)}`],
    ["a + 600 mixed", `a${"1.+-".repeat(150)}`],
    ["a letter then 129 digits", `x${"9".repeat(129)}`],
  ];
  for (const [name, head] of heads) {
    it(`${name}: the original caught it and so does the rule`, () => {
      const text = `${head}://u:${pw}@h`;
      const before = groupSpans(OLD_CONN, text);
      expect(before).toHaveLength(1);
      expect(groupSpans(rule("connection-password").pattern, text)).toEqual(before);
      expect(redactIdentifierText(text)).toBe(`${head}://u:${MARK}connection-password:1]@h`);
    });
  }

  it("fuzz: 12,000 texts with scheme runs up to 600 characters: zero passwords the original caught are missed", () => {
    const rand = rng(6001);
    const schemeChars = "abcXYZ019.+-";
    let oldHits = 0;
    let extra = 0;
    let longHits = 0;
    for (let i = 0; i < 12_000; i++) {
      const len = Math.floor(rand() < 0.5 ? rand() * 600 : rand() * 40);
      let scheme = "";
      const chars = rand() < 0.5 ? "019.+-" : schemeChars;
      for (let k = 0; k < len; k++) scheme += chars[Math.floor(rand() * chars.length)];
      if (chars.length === 6) scheme = `a${scheme}`;
      const glue = ["", " ", "_", "(", "deadbeef", "x ", "\n"][Math.floor(rand() * 7)] as string;
      const user = ["u", "admin", "", "u.v", "a b"][Math.floor(rand() * 5)] as string;
      const tail = ["@h", "@h/db", "@@", "@", " @h"][Math.floor(rand() * 5)] as string;
      const text = `${glue}${scheme}://${user}:${base62(`p${i}`, 1 + Math.floor(rand() * 20))}${tail}${rand() < 0.3 ? ` ${scheme}://u:pw@h` : ""}`;
      const before = groupSpans(OLD_CONN, text);
      const after = groupSpans(rule("connection-password").pattern, text);
      oldHits += before.length;
      if (before.length > 0 && /[A-Za-z0-9+.-]{129,}:\/\//.test(text)) longHits += before.length;
      for (const [s, e] of before) {
        expect(
          after.some(([s2, e2]) => s2 === s && e2 === e),
          JSON.stringify(text),
        ).toBe(true);
      }
      extra += after.length - before.length;
    }
    expect(oldHits).toBeGreaterThan(1500);
    expect(longHits).toBeGreaterThan(300);
    expect(extra).toBeGreaterThanOrEqual(0);
  });

  it("stays linear on every shape that could make the lookbehind walk far", () => {
    const shapes: [string, (bytes: number) => string][] = [
      ["one colon after a digit run", (n) => `${"1".repeat(n)}:`],
      ["127 digits + colon", (n) => `${"1".repeat(127)}:`.repeat(n / 128)],
      ["999 digits + colon", (n) => `${"1".repeat(999)}:`.repeat(n / 1000)],
      ["a:", (n) => "a:".repeat(n / 2)],
      ["1:", (n) => "1:".repeat(n / 2)],
      ["a1:", (n) => "a1:".repeat(n / 3)],
      ["colons", (n) => ":".repeat(n)],
      ["://", (n) => "://".repeat(n / 3)],
      ["a://", (n) => "a://".repeat(n / 4)],
      ["a://u:", (n) => "a://u:".repeat(n / 6)],
    ];
    for (const [name, make] of shapes) {
      const tSmall = timed(() => redactIdentifierText(make(262_144)));
      const tBig = timed(() => redactIdentifierText(make(2_097_152)));
      expect(tBig / Math.max(tSmall, 1), name).toBeLessThan(24);
      expect(tBig, name).toBeLessThan(10_000);
    }
  }, 240_000);
});

describe("DUSTSEC.24 third review: no placeholder exemption beyond the original's", () => {
  const ph = (kind: string, n: number) => `${MARK}${kind}:${n}]`;
  const NEW_CONN = rule("connection-password").pattern;

  // Placeholder-looking text in the user or password position, with a real password after it.
  const hidden: [string, string][] = [
    ["placeholder glued onto the user", `x://u${MARK}email:1]hunter2@h`],
    ["same, postgres", `postgres://admin${MARK}credit-card:6]hunter2@db`],
    ["placeholder as the user", `x://${MARK}email:1]hunter2@h`],
    ["a password that starts with a kind and number", "x://u:email:1]]hunter2@h"],
    [
      "a password with a connection-password kind and a long number",
      "x://u:connection-password:12345]hunter2@h",
    ],
    ["a made-up kind", `x://u:${ph("MyRealPass-2024", 1)}hunter2@h`],
    ["a late kind then a real tail", `x://u:${ph("email", 1)}hunter2@h`],
    ["an early kind then a real tail", `x://u:${ph("github-token", 1)}hunter2@h`],
  ];
  for (const [name, text] of hidden) {
    it(`${name}: whatever the original redacted is redacted, and the tail does not leave`, () => {
      const before = groupSpans(OLD_CONN, text);
      const after = groupSpans(NEW_CONN, text);
      expect(before.length, "the shape must be one the original redacts").toBeGreaterThan(0);
      for (const [s, e] of before)
        expect(after.some(([s2, e2]) => s2 === s && e2 === e)).toBe(true);
      expect(redactStandaloneText(text)).not.toContain("hunter2");
      expect(redactIdentifierText(text)).not.toContain("hunter2");
    });
  }

  it("a password that is EXACTLY a connection-password placeholder is left alone (S10), as in the original", () => {
    const text = `postgres://u:${ph("connection-password", 7)}@h`;
    expect(redactIdentifierText(text)).toBe(text);
    // An earlier rule's placeholder, or a made-up kind, is still a password (renamed).
    for (const kind of ["github-token", "email", "credit-card", base62("kind", 10)]) {
      expect(redactIdentifierText(`postgres://u:${ph(kind, 3)}@h`)).toBe(
        text.replace(":7]", ":1]"),
      );
    }
  });

  it("differential, 4 seeds x 50,000 texts with placeholders and the adversarial shapes: zero leaks against the original", () => {
    const card = withCheckDigit("411111111111111");
    const pieces = [
      "://",
      ":",
      "@",
      "@@",
      "/",
      "]",
      "[",
      "x://u:",
      "pg+a.b://user:",
      "u:pw@h",
      "postgres",
      "deadbeef",
      "deadbeef_",
      " ",
      "\n",
      "-",
      ".",
      "+",
      "_",
      card,
      "ghp_",
      "hunter2",
      "email:1]",
      "email:1]]",
      "connection-password:12345]",
      ph("credit-card", 1),
      ph("email", 2),
      ph("high-entropy", 3),
      ph("connection-password", 4),
      ph("github-token", 5),
      `x://u${MARK}email:1]hunter2@h`,
      `postgres://admin${MARK}credit-card:6]hunter2@db`,
      `x://${MARK}email:1]hunter2@h`,
      "x://u:email:1]]hunter2@h",
      "x://u:connection-password:12345]hunter2@h",
    ];
    let oldTotal = 0;
    let newTotal = 0;
    for (const seed of [1, 2, 3, 4]) {
      const rand = rng(seed * 1009);
      let oldHits = 0;
      let newHits = 0;
      for (let i = 0; i < 50_000; i++) {
        const text = randomText(rand, pieces, "abc019:/@.-_ ");
        const before = groupSpans(OLD_CONN, text);
        const after = groupSpans(NEW_CONN, text);
        oldHits += before.length;
        newHits += after.length;
        for (const [s, e] of before) {
          if (!after.some(([s2, e2]) => s2 === s && e2 === e)) {
            throw new Error(`leak: ${JSON.stringify(text)}`);
          }
        }
      }
      oldTotal += oldHits;
      newTotal += newHits;
      expect(oldHits, `seed ${seed}`).toBeGreaterThan(5000);
      expect(newHits, `seed ${seed}`).toBeGreaterThanOrEqual(oldHits);
    }
    expect(newTotal).toBeGreaterThanOrEqual(oldTotal);
  });

  it("second pass is a no-op on a corpus without glued schemes or placeholders (the only place it holds)", () => {
    // NOT claimed for all text: a scheme glued onto other characters (`deadbeef_x://...`) now matches,
    // and a placeholder followed by trailing characters in the password position is a password, so a
    // second pass can redact more (over-redaction only; nothing is revealed). The original has the
    // same non-idempotence for plain schemes. Here every URL starts after a space.
    const rand = rng(31337);
    const card = withCheckDigit("411111111111111");
    const pieces = [
      "://",
      ":",
      "@",
      "x://u:",
      "pg+a.b://user:",
      "u:pw@h",
      "user",
      "pw",
      "-",
      ".",
      card,
      `${base62("e1", 40)}x`,
    ];
    let changed = 0;
    for (let i = 0; i < 20_000; i++) {
      const n = 1 + Math.floor(rand() * 6);
      const text = Array.from(
        { length: n },
        () => pieces[Math.floor(rand() * pieces.length)] as string,
      ).join(" ");
      const once = redactStandaloneText(text);
      if (once !== text) changed += 1;
      expect(redactStandaloneText(once), JSON.stringify(text)).toBe(once);
    }
    expect(changed).toBeGreaterThan(2000);
  });
});
