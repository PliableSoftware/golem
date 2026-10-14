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
      // A password that is itself an already-produced placeholder is exempt by design (idempotence).
      if (!text.includes(MARK)) {
        for (const [s, e] of before) {
          expect(
            after.some(([s2, e2]) => s2 === s && e2 === e),
            JSON.stringify(text),
          ).toBe(true);
        }
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

const KINDS = [
  "private-key",
  "aws-key",
  "aws-secret-key",
  "github-token",
  "anthropic-key",
  "openai-key",
  "slack-token",
  "google-api-key",
  "stripe-key",
  "gcp-oauth-token",
  "jwt",
  "connection-password",
  "azure-account-key",
  "credit-card",
  "email",
  "nostr-secret-key",
  "high-entropy",
];

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

describe("DUSTSEC.24 second review (2) a second pass never re-redacts another rule's placeholder", () => {
  it("a password-position placeholder of any built-in kind is left alone, an unknown kind is not", () => {
    const ph = (kind: string, n: number) => `${MARK}${kind}:${n}]`;
    for (const kind of KINDS) {
      const text = `postgres://u:${ph(kind, 5)}@h`;
      expect(redactIdentifierText(text), kind).toBe(text);
    }
    // The kind is the only free text in a placeholder, so only the fixed vocabulary is
    // exempt: a made-up kind (which could carry a secret) is a password like any other.
    const hidden = `postgres://u:${ph(base62("kind", 10), 3)}@h`;
    expect(redactIdentifierText(hidden)).toBe(`postgres://u:${ph("connection-password", 1)}@h`);
  });

  it("a placeholder in the user position: a real password after it is redacted, a lone placeholder is left", () => {
    const ph = (kind: string, n: number) => `${MARK}${kind}:${n}]`;
    const pw = base62("pw3", 12);
    // earlier rules' placeholders really do land in the user position of a URL
    expect(redactIdentifierText(`pg://${ph("aws-key", 1)}:${pw}@h`)).toBe(
      `pg://${ph("aws-key", 1)}:${ph("connection-password", 1)}@h`,
    );
    for (const text of [
      `pg://${ph("credit-card", 1)}:${ph("connection-password", 2)}@h`,
      `pg://${ph("credit-card", 1)}@h`,
      `pg://u:${ph("email", 3)}@h`,
    ]) {
      expect(redactIdentifierText(text), text).toBe(text);
    }
    // No password follows the placeholder, so nothing is hidden by the exemption; text that
    // merely LOOKS like the start of a placeholder is still a password.
    expect(redactIdentifierText(`pg://u:${pw}@h`)).toBe(`pg://u:${ph("connection-password", 1)}@h`);
    expect(redactIdentifierText(`pg://u:${MARK}${pw}@h`)).toBe(
      `pg://u:${ph("connection-password", 1)}@h`,
    );
  });

  it("the kinds listed here are exactly the built-in rule ids plus the entropy sweep", () => {
    expect([...KINDS].sort()).toEqual([...REDACTION_RULES.map((r) => r.id), "high-entropy"].sort());
  });

  it("the review's glued shapes are idempotent", () => {
    const card = withCheckDigit("411111111111111");
    const spaced = (card.match(/.{1,4}/g) ?? []).join(" ");
    for (const text of [
      `deadbeef_postgres://]${card}@@`,
      `x postgres://${spaced}@h`,
      `x postgres://u:${card}@h`,
      `a${"1".repeat(200)}://${card}:${card}@h`,
    ]) {
      const once = redactIdentifierText(text);
      expect(redactIdentifierText(once), text).toBe(once);
      const whole = redactStandaloneText(text);
      expect(redactStandaloneText(whole), text).toBe(whole);
    }
  });

  it("whole-stage fuzz (rules AND the entropy sweep): 20,000 texts, second pass changes nothing", () => {
    const rand = rng(777);
    const card = withCheckDigit("411111111111111");
    // Generator note: no space-grouped card here. The connection-password rule runs BEFORE the
    // card rule, so a password that only loses its spaces once the card is replaced is matched on
    // the second pass, before and after this change (rule order is part of the contract).
    // Also:  a token ends in a letter and a space so it cannot run into a card's digits.
    // (A card preceded by digits and a space, `12 4111 1111 1111 1111`, is swallowed whole by the
    // card rule's pattern and rejected as irregular grouping, before AND after this change.)
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
      `${card}:${card}@`,
      "ghp_",
      `${base62("e1", 40)}x `,
      `${base62("e2", 90)}x `,
      `${MARK}credit-card:1]`,
      `${MARK}email:2]`,
      `${MARK}high-entropy:3]`,
      `${MARK}connection-password:4]`,
      "a@b.com",
    ];
    let changed = 0;
    for (let i = 0; i < 20_000; i++) {
      const text = randomText(rand, pieces, "abc019:/@.-_ ");
      const once = redactStandaloneText(text);
      if (once !== text) changed += 1;
      expect(redactStandaloneText(once), JSON.stringify(text)).toBe(once);
    }
    expect(changed).toBeGreaterThan(4000);
  });
});
