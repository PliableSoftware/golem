/**
 * DUSTSEC.24 — named redaction rules on pathological input, and the credit-card
 * rule inside hex tokens.
 *
 * 1. A greedy `[class]{n,}` over a multi-megabyte run overflows V8's regex
 *    backtrack stack (RangeError), and the proxy turns the throw into a 502 that
 *    its fail-safe cannot redact. The patterns are now `[class]{n}[class]*`: the
 *    same language, tried in the same order, on the engine's loop that does not
 *    spend stack per character. The differential tests below pin "same language"
 *    against the previous patterns (written out here) on random and realistic text.
 * 2. Two rules were quadratic: BEGIN lines with no END after them (private-key)
 *    and a long run with no `@` (email). Both are bounded now.
 * 3. The credit-card rule rewrote Luhn-valid digit runs inside hex tokens. The
 *    boundary rule (see `isOutsideHexToken`) is tested on both sides.
 *
 * Every secret-shaped value is built at runtime; none is committed as a literal.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NativeLosslessCompression } from "../../../src/compression/index.js";
import { policyFor } from "../../../src/interfaces/policy.js";
import {
  createGolemPipeline,
  REDACTION_RULES,
  redactRequestBody,
  redactStandaloneText,
} from "../../../src/pipeline/index.js";
import { redactIdentifierText, redactReversibleTexts } from "../../../src/pipeline/redaction.js";
import {
  EMBEDDED_ANYWHERE,
  isCreditCardLike,
  isOutsideHexToken,
  luhnValid,
} from "../../../src/pipeline/redaction-rules.js";
import type { ProxyRequest } from "../../../src/proxy/types.js";
import { useTempDirs } from "../../helpers/tmp.js";

const MB = 1024 * 1024;
const MARK = `[${"REDACTED"}:`;
const ANT = `${"sk"}-${"ant"}-`;
const OAI = `${"sk"}-`;
const GHP = `${"ghp"}_`;
const newTempDir = useTempDirs("golem-dustsec24-");

const rule = (id: string) => {
  const found = REDACTION_RULES.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found;
};

async function pipeline() {
  const projectDir = await newTempDir();
  return createGolemPipeline({
    compression: NativeLosslessCompression.forProjectDir(projectDir),
    policy: () => policyFor(1),
    projectId: projectDir,
  });
}

const messagesRequest = (text: string): ProxyRequest => ({
  method: "POST",
  url: "/v1/messages",
  headers: { "content-type": "application/json" },
  body: Buffer.from(
    JSON.stringify({
      model: "m",
      max_tokens: 1,
      messages: [{ role: "user", content: [{ type: "text", text }] }],
    }),
    "utf8",
  ),
});

/** The text of the single user block of a forwarded Messages body. */
const forwardedText = (req: ProxyRequest): string => {
  const parsed = JSON.parse((req.body ?? Buffer.alloc(0)).toString("utf8")) as {
    messages: { content: { text: string }[] }[];
  };
  return parsed.messages[0]?.content[0]?.text ?? "";
};

/** Every way a text reaches the upstream, or a stored/logged copy, in one list. */
async function redactEveryWay(text: string): Promise<{ via: string; out: string }[]> {
  const p = await pipeline();
  const request = messagesRequest(text);
  const processed = await p.process(request);
  const safe = (p.redactOnly as (r: ProxyRequest) => ProxyRequest)(request);
  return [
    { via: "process", out: forwardedText(processed) },
    { via: "redactOnly", out: forwardedText(safe) },
    { via: "redactStandaloneText", out: redactStandaloneText(text) },
    { via: "redactRequestBody", out: (redactRequestBody({ s: text }).value as { s: string }).s },
    { via: "redactIdentifierText", out: redactIdentifierText(text) },
  ];
}

/** `n` base62 characters for `seed`, deterministic. */
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

/** Deterministic PRNG (mulberry32), so a failing sample can be replayed. */
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

/** Median wall time of `fn` over `runs` runs, in ms. */
function timed(fn: () => void, runs = 3): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return samples.sort((a, b) => a - b)[Math.floor(runs / 2)] as number;
}

describe("DUSTSEC.24 a multi-megabyte run no longer overflows the regex stack", () => {
  // `unit` repeated to ~10 MB is ONE unbroken run for each of these; before the fix
  // every one threw RangeError out of the rule table.
  const single: { name: string; kind: string; text: () => string; tail: string }[] = [
    {
      name: "repeated sk-ant-",
      kind: "anthropic-key",
      text: () => ANT.repeat((10 * MB) / 7),
      tail: "-",
    },
    {
      name: "sk-ant- then a long tail",
      kind: "anthropic-key",
      text: () => ANT + "a".repeat(10 * MB),
      tail: "",
    },
    {
      name: "sk- ending in +",
      kind: "openai-key",
      text: () => `${OAI}${"a".repeat(10 * MB)}+`,
      tail: "+",
    },
    {
      name: "sk- ending in -",
      kind: "openai-key",
      text: () => `${OAI}${"a".repeat(10 * MB)}-`,
      tail: "-",
    },
    { name: "xoxb- run", kind: "slack-token", text: () => `xoxb-${"a".repeat(10 * MB)}`, tail: "" },
    {
      name: "jwt with a 10 MB payload",
      kind: "jwt",
      text: () => `eyJ${"a".repeat(16)}.${"b".repeat(10 * MB)}.${"c".repeat(16)}`,
      tail: "",
    },
    {
      name: "nsec1 run",
      kind: "nostr-secret-key",
      text: () => `nsec1${"q".repeat(10 * MB)}`,
      tail: "",
    },
  ];

  for (const { name, kind, text, tail } of single) {
    it(`${name}: one placeholder of kind ${kind}, through every redaction path`, async () => {
      const input = text();
      for (const { via, out } of await redactEveryWay(input)) {
        // The identifier path runs the rule table only, which is the same rule.
        expect(out.startsWith(`${MARK}${kind}:1]`), `${via}: ${out.slice(0, 60)}`).toBe(true);
        expect(out.length, via).toBeLessThan(80);
        expect(out.endsWith(tail), via).toBe(true);
      }
    }, 120_000);
  }
});

describe("DUSTSEC.24 key streams: linear, and equal to a chunked equivalent", () => {
  const streams: { name: string; kind: string; key: (i: number) => string; sep: string }[] = [
    {
      name: "ghp_ keys",
      kind: "github-token",
      key: (i) => `${GHP}${base62(`g${i}`, 36)}`,
      sep: "\n",
    },
    {
      name: "sk-ant- keys",
      kind: "anthropic-key",
      key: (i) => `${ANT}${base62(`a${i}`, 40)}`,
      sep: "\n",
    },
    {
      name: "sk- keys ending in +",
      kind: "openai-key",
      key: (i) => `${OAI}${base62(`o${i}`, 40)}+`,
      sep: "\n",
    },
  ];

  for (const { name, kind, key, sep } of streams) {
    it(`${name}: 50,000 distinct keys, one placeholder each, same as 8 chunks`, () => {
      const keys = Array.from({ length: 50_000 }, (_, i) => key(i));
      const text = keys.join(sep);
      const whole = redactReversibleTexts([text]).texts[0] as string;
      expect(whole.split(sep).every((line, i) => line.startsWith(`${MARK}${kind}:${i + 1}]`))).toBe(
        true,
      );
      expect(whole).not.toContain(keys[0]?.slice(8) as string);
      // The chunked equivalent: split at line boundaries, share one placeholder table.
      const lines = text.split(sep);
      const chunks: string[] = [];
      const size = Math.ceil(lines.length / 8);
      for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size).join(sep));
      const chunked = redactReversibleTexts(chunks).texts.join(sep);
      expect(chunked).toBe(whole);
    }, 60_000);

    it(`${name}: 10 MB through process and redactOnly completes, no RangeError`, async () => {
      const unit = `${key(7)}${sep}`;
      const text = unit.repeat(Math.ceil((10 * MB) / unit.length));
      for (const { via, out } of await redactEveryWay(text)) {
        expect(out.startsWith(`${MARK}${kind}:`), via).toBe(true);
        expect(out, via).not.toContain(key(7).slice(8));
      }
    }, 120_000);

    it(`${name}: eight times the input costs well under 8^2 times as long`, () => {
      const make = (n: number) => Array.from({ length: n }, (_, i) => key(i % 97)).join(sep);
      const small = make(20_000);
      const big = make(160_000);
      const tSmall = timed(() => redactStandaloneText(small));
      const tBig = timed(() => redactStandaloneText(big));
      // Linear is about 8x, quadratic about 64x. 24x leaves room for a loaded runner.
      expect(tBig / Math.max(tSmall, 1)).toBeLessThan(24);
    }, 120_000);
  }

  it("glued keys (no separator) are also linear", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => `${GHP}${base62(`g${i % 97}`, 36)}`).join("");
    const tSmall = timed(() => redactStandaloneText(make(20_000)));
    const tBig = timed(() => redactStandaloneText(make(160_000)));
    expect(tBig / Math.max(tSmall, 1)).toBeLessThan(24);
  }, 120_000);
});

describe("DUSTSEC.24 quadratic rules", () => {
  it("BEGIN lines with no END after them are linear, and nothing is redacted", () => {
    const begin = `-----BEGIN ${"PRIVATE"} KEY-----\nAAAA\n`;
    const make = (n: number) => begin.repeat(n);
    const tSmall = timed(() => redactIdentifierText(make(8_000)));
    const tBig = timed(() => redactIdentifierText(make(64_000)));
    expect(redactIdentifierText(make(64_000))).toBe(make(64_000));
    expect(tBig / Math.max(tSmall, 1)).toBeLessThan(24);
  }, 120_000);

  it("a run of dotted words with no @ is linear", () => {
    const tSmall = timed(() => redactIdentifierText("a.".repeat(100_000)));
    const tBig = timed(() => redactIdentifierText("a.".repeat(800_000)));
    expect(tBig / Math.max(tSmall, 1)).toBeLessThan(24);
  }, 120_000);

  it("a 100-character local part is still one email address", () => {
    const addr = `${base62("local", 100)}@example.com`;
    expect(redactIdentifierText(`mail ${addr} now`)).toBe(`mail ${MARK}email:1] now`);
  });
});

// ---------------------------------------------------------------------------
// Differential tests: the rewritten patterns against the previous ones.
// ---------------------------------------------------------------------------

type Span = [index: number, text: string];

function spans(re: RegExp, text: string): Span[] {
  return [...text.matchAll(new RegExp(re.source, re.flags))].map((m) => [m.index ?? 0, m[0]]);
}

/** Random text built from `pieces` (rule prefixes, separators) and runs of `alphabet`. */
function randomText(rand: () => number, pieces: readonly string[], alphabet: string): string {
  const parts = 1 + Math.floor(rand() * 8);
  let out = "";
  for (let i = 0; i < parts; i++) {
    const r = rand();
    if (r < 0.45) out += pieces[Math.floor(rand() * pieces.length)] as string;
    else {
      const n = Math.floor(rand() < 0.5 ? rand() * 100 : rand() * rand() * 20);
      for (let k = 0; k < n; k++) out += alphabet[Math.floor(rand() * alphabet.length)];
    }
  }
  return out;
}

describe("DUSTSEC.24 rewritten patterns match exactly what the previous patterns did", () => {
  const nostrSource = rule("nostr-secret-key").pattern.source;
  const bech32 = /\[[^\]]+\]/.exec(nostrSource)?.[0] ?? "";
  const bech32Chars = bech32.slice(1, -1);

  const previous: { id: string; old: RegExp; pieces: string[]; alphabet: string }[] = [
    {
      id: "anthropic-key",
      old: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
      pieces: [ANT, " ", "-", "_", ".", "\n", `${OAI}ant-`, "+"],
      alphabet: `${"abcXYZ019"}_-`,
    },
    {
      id: "openai-key",
      old: /\bsk-(?!ant-)[A-Za-z0-9_-]{32,}\b/g,
      pieces: [OAI, `${OAI}proj-`, ANT, " ", "-", "_", "\n", "+"],
      alphabet: `${"abcXYZ019"}_-`,
    },
    {
      id: "slack-token",
      old: /\bxox[baprse]-[A-Za-z0-9-]{10,}\b/g,
      pieces: ["xoxb-", "xoxp-", "xoxz-", "xox", " ", "-", "_", "\n"],
      alphabet: "abcXYZ019-",
    },
    {
      id: "jwt",
      old: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      pieces: [
        "eyJ",
        ".",
        ".",
        " ",
        "-",
        "_",
        "\n",
        "eyJabcdefghi.",
        "abcdefghi",
        "eyJabcdefghi",
        "abcdefg",
      ],
      alphabet: `${"abcXYZ019"}_-`,
    },
    {
      id: "nostr-secret-key",
      old: new RegExp(nostrSource.replace(/\{58\}(\[[^\]]+\])\*$/, "{58,}"), "gi"),
      pieces: [
        "nsec1",
        "NSEC1",
        " ",
        "-",
        "\n",
        "1",
        "b",
        `nsec1${bech32Chars.repeat(2)}`,
        bech32Chars,
        bech32Chars.slice(0, 12),
      ],
      alphabet: `${bech32Chars}${bech32Chars.toUpperCase()}1bio`,
    },
  ];

  for (const { id, old, pieces, alphabet } of previous) {
    it(`${id}: 6000 random texts, identical matches`, () => {
      const rand = rng(id.length * 7919);
      const current = rule(id).pattern;
      let withMatch = 0;
      for (let i = 0; i < 6000; i++) {
        const text = randomText(rand, pieces, alphabet);
        const expected = spans(old, text);
        if (expected.length > 0) withMatch += 1;
        expect(spans(current, text), JSON.stringify(text)).toEqual(expected);
      }
      // The generator must actually reach the rule, or the test proves nothing.
      expect(withMatch).toBeGreaterThan(30);
    });
  }

  it("the in-run nostr pattern is still `nsec1` + the same class, 58 to 255", () => {
    const embedded = EMBEDDED_ANYWHERE.find((r) => r.id === "nostr-secret-key");
    expect(embedded?.pattern.source).toBe(`nsec1${bech32}{58,255}`);
    expect(embedded?.pattern.flags).toBe("gi");
  });

  it("private-key: scanEnd changes no match, on random BEGIN/END soups", () => {
    const pem = rule("private-key");
    const old = new RegExp(pem.pattern.source, pem.pattern.flags);
    const pieces = [
      `-----BEGIN ${"PRIVATE"} KEY-----`,
      `-----BEGIN RSA ${"PRIVATE"} KEY-----`,
      `-----BEGIN ${"ENCRYPTED"} ${"PRIVATE"} KEY-----`,
      `-----END ${"PRIVATE"} KEY-----`,
      `-----END RSA ${"PRIVATE"} KEY-----`,
      "-----BEGIN PUBLIC KEY-----",
      "-----END PUBLIC KEY-----",
      "-----END ",
      "-----BEGIN ",
      "-----",
      "\n",
      " ",
      "MIIB",
    ];
    const rand = rng(424242);
    let withMatch = 0;
    for (let i = 0; i < 6000; i++) {
      const text = randomText(rand, pieces, "ABCabc09+/=\n ");
      const bound = pem.scanEnd?.(text) ?? text.length;
      const expected = spans(old, text);
      if (expected.length > 0) withMatch += 1;
      expect(spans(pem.pattern, text.slice(0, bound)), JSON.stringify(text)).toEqual(expected);
    }
    expect(withMatch).toBeGreaterThan(300);
  });

  it("connection-password: identical for schemes up to the 128-character bound", () => {
    const old = new RegExp(
      String.raw`\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:@/]+:(?!\[${"REDACTED"}:connection-password:\d+\]@)([^\s@/]+)@`,
      "g",
    );
    const rand = rng(2024);
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
      "user",
      "pw",
      `${MARK}connection-password:1]`,
    ];
    let withMatch = 0;
    for (let i = 0; i < 6000; i++) {
      const text = randomText(rand, pieces, "abcXYZ019.-+");
      if (/[a-zA-Z0-9+.-]{129,}/.test(text)) continue;
      const expected = spans(old, text);
      if (expected.length > 0) withMatch += 1;
      expect(spans(rule("connection-password").pattern, text), JSON.stringify(text)).toEqual(
        expected,
      );
    }
    expect(withMatch).toBeGreaterThan(100);
  });

  it("email: identical for local parts up to the 128-character bound", () => {
    const old = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    const rand = rng(99);
    const pieces = ["@", ".com", ".", "-", "+", "_", " ", "\n", "a@b.co", "x.y@z.org", "%", ".."];
    let withMatch = 0;
    for (let i = 0; i < 6000; i++) {
      const text = randomText(rand, pieces, "abcXYZ019.-_");
      // Out of the bound's reach: skip the rare sample with a 129+ char class run.
      if (/[A-Za-z0-9._%+-]{129,}/.test(text)) continue;
      const expected = spans(old, text);
      if (expected.length > 0) withMatch += 1;
      expect(spans(rule("email").pattern, text), JSON.stringify(text)).toEqual(expected);
    }
    expect(withMatch).toBeGreaterThan(300);
  });
});

// ---------------------------------------------------------------------------
// Credit-card boundary rule.
// ---------------------------------------------------------------------------

/** `digits` plus the check digit that makes it Luhn-valid. */
function withCheckDigit(digits: string): string {
  for (let d = 0; d < 10; d++) {
    if (luhnValid(`${digits}${d}`)) return `${digits}${d}`;
  }
  throw new Error("unreachable");
}

const group = (card: string, size: number, sep: string): string =>
  (card.match(new RegExp(`.{1,${size}}`, "g")) ?? []).join(sep);

const CARD16 = withCheckDigit("411111111111111");
const CARD13 = withCheckDigit("400000000000");
const CARD19 = withCheckDigit("401288888888188888");

/** Hex text with no digit run of 13+ (so only the planted run can be a card). */
function hexDump(seed: string, n: number): string {
  let out = "";
  for (let i = 0; out.length < n; i++) {
    const hex = createHash("sha256").update(`${seed}:${i}`).digest("hex");
    out += hex.replace(/\d{9,}/g, "ab");
  }
  return out.slice(0, n);
}

describe("DUSTSEC.24 credit-card boundary: a digit run inside a hex token is not a card", () => {
  it("fixtures are Luhn-valid cards of the shapes tested", () => {
    for (const card of [CARD16, CARD13, CARD19]) expect(luhnValid(card)).toBe(true);
    expect([CARD13.length, CARD16.length, CARD19.length]).toEqual([13, 16, 19]);
  });

  it("a long hex dump holding Luhn-valid digit runs is unaltered", async () => {
    const dump = hexDump("dump", 600);
    for (const card of [CARD13, CARD16, CARD19]) {
      for (const text of [
        `${dump.slice(0, 300)}${card}${dump.slice(300)}`, // glued both sides
        `${card}${dump}`, // at the start of the token, hex on the right only
        `${dump}${card}`, // at its end, hex on the left only
        `e${card}f`,
      ]) {
        for (const { via, out } of await redactEveryWay(text)) {
          expect(out, `${via} ${card.length}`).toBe(text);
        }
      }
    }
  });

  it("many planted runs in a 10 MB hex dump: untouched and fast", () => {
    const unit = `${hexDump("big", 120)}${CARD16}${hexDump("big2", 120)}`;
    const text = unit.repeat(Math.ceil((10 * MB) / unit.length));
    const t0 = performance.now();
    expect(redactIdentifierText(text) === text).toBe(true);
    expect(performance.now() - t0).toBeLessThan(30_000);
  }, 60_000);

  it("a real card number is still redacted in every ordinary shape", async () => {
    const shapes: [string, string][] = [
      ["bare", CARD16],
      ["13 digits", CARD13],
      ["19 digits", CARD19],
      ["space groups 4-4-4-4", group(CARD16, 4, " ")],
      ["dash groups 4-4-4-4", group(CARD16, 4, "-")],
      ["in prose", `my card is ${CARD16} thanks`],
      ["after a colon", `card:${CARD16}`],
      ["after an equals sign in a query", `cc=${CARD16}&exp=1230`],
      ["in quotes", `"number":"${CARD16}"`],
      ["in parentheses", `(${CARD16})`],
      ["before a comma", `Charge ${CARD16}, then`],
      ["on its own line", `line one\n${CARD16}\nline three`],
      ["after a tab", `\t${CARD16}`],
      ["glued to a non-hex word before", `Visa${CARD16}`],
      ["glued to a non-hex word after", `${CARD16}USD`],
      ["after an underscore", `order_${CARD16}`],
      ["after a hex-looking word and a space", `deadbeef ${CARD16}`],
      ["grouped, between hex words", `cafe ${group(CARD16, 4, " ")} babe`],
    ];
    for (const [name, text] of shapes) {
      for (const { via, out } of await redactEveryWay(text)) {
        expect(out, `${name} via ${via}`).toContain(`${MARK}credit-card:`);
        expect(out, `${name} via ${via}`).not.toContain(CARD16.slice(2, 14));
      }
    }
  });

  it("isOutsideHexToken: both sides of the boundary", () => {
    const at = (text: string): boolean => {
      const start = text.indexOf(CARD16);
      return isOutsideHexToken(text, start, start + CARD16.length);
    };
    expect(at(CARD16)).toBe(true);
    expect(at(` ${CARD16} `)).toBe(true);
    expect(at(`-${CARD16}.`)).toBe(true);
    expect(at(`_${CARD16}_`)).toBe(true);
    expect(at(`Visa${CARD16}`)).toBe(true); // V, i, s are not hex
    expect(at(`${CARD16}USD`)).toBe(true);
    expect(at(`xyzab${CARD16}`)).toBe(true); // a non-hex letter anywhere in the token
    expect(at(`${CARD16}abcz`)).toBe(true);
    expect(at(`ab${CARD16}`)).toBe(false);
    expect(at(`${CARD16}cd`)).toBe(false);
    expect(at(`AB${CARD16}EF`)).toBe(false);
    expect(at(`1f${CARD16}`)).toBe(false);
    // A window full of hex on one side is a long hex token, however it continues.
    expect(at(`${"ab".repeat(40)}${CARD16}`)).toBe(false);
    expect(at(`${"ab".repeat(40)}${CARD16}${"cd".repeat(40)}`)).toBe(false);
  });

  it("only the hex-token context changes the rule: old and new agree everywhere else", () => {
    // The previous rule: the same pattern and validator, no context check.
    const card = rule("credit-card");
    const oldCard = (text: string): Span[] =>
      spans(card.pattern, text).filter(([, t]) => isCreditCardLike(t));
    const newCard = (text: string): Span[] =>
      spans(card.pattern, text).filter(
        ([i, t]) => isCreditCardLike(t) && (card.validateAt?.(text, i, i + t.length) ?? true),
      );
    const rand = rng(31337);
    const pieces = [
      CARD16,
      CARD13,
      CARD19,
      group(CARD16, 4, " "),
      group(CARD16, 4, "-"),
      " ",
      "-",
      ".",
      "\n",
      "ab",
      "f",
      "Z",
      "_",
      ":",
    ];
    let removed = 0;
    let kept = 0;
    for (let i = 0; i < 6000; i++) {
      const text = randomText(rand, pieces, "0123456789abcdefgxyz");
      const before = oldCard(text);
      const after = newCard(text);
      expect(after.every((s) => before.some(([i2, t]) => i2 === s[0] && t === s[1]))).toBe(true);
      kept += after.length;
      for (const [index, t] of before) {
        if (after.some(([i2]) => i2 === index)) continue;
        removed += 1;
        // Every dropped match touches a hex-only token: that is the whole change.
        const left = /[0-9A-Za-z]*$/.exec(text.slice(0, index))?.[0] ?? "";
        const right = /^[0-9A-Za-z]*/.exec(text.slice(index + t.length))?.[0] ?? "";
        expect(left + right, JSON.stringify(text)).toMatch(/^[0-9A-Fa-f]+$/);
      }
    }
    expect(kept).toBeGreaterThan(200);
    expect(removed).toBeGreaterThan(50);
  });
});
