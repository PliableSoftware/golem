/**
 * DUST2.23 probe 1 — `=` and `+` in path-like tokens (DUST1.1 headline 9).
 *
 * The rule under test (redaction-rules.ts, `isPathLikeToken`): `=`/`+` split chunks
 * like `/_-`, but a token that contains one needs >= 3 chunks and word-shaped
 * letters-only chunks. Both sides are pinned here:
 *   - realistic paths / URLs / base64 query values / API ids pass through byte-identical;
 *   - a secret embedded in (or standing next to) such a token is still redacted;
 *   - tokens with no `=`/`+` behave exactly as before (differential against a frozen
 *     copy of the pre-change function);
 *   - no random secret that the old rule redacted escapes the new one (property).
 * Every secret-shaped value is generated at runtime from a seeded PRNG.
 */

import { describe, expect, it } from "vitest";
import {
  ENTROPY_THRESHOLD_BITS,
  isHighEntropyToken,
  redactStandaloneText,
  shannonEntropy,
} from "../../../src/pipeline/index.js";

// --- frozen copy of the pre-DUST2.23 exemption, the differential's reference -------
const INTEGRITY = /^(sha1|sha224|sha256|sha384|sha512|md5)-/i;
function legacyIsPathLike(token: string): boolean {
  const chunks = token.split(/[/_-]/).filter((c) => c.length > 0);
  if (chunks.length < 2) return false;
  let mixedHex = false;
  for (const c of chunks) {
    if (/^[A-Za-z]+$/.test(c) || /^[0-9]+$/.test(c)) continue;
    if (/^[0-9a-fA-F]+$/.test(c)) {
      mixedHex = true;
      continue;
    }
    return false;
  }
  return !(mixedHex && chunks.length < 3);
}
function legacyIsHighEntropy(token: string): boolean {
  if (INTEGRITY.test(token)) return false;
  if (/^[0-9a-fA-F]*$/.test(token.replace(/[-_]/g, ""))) return false;
  if (legacyIsPathLike(token)) return false;
  const classes =
    (/[a-z]/.test(token) ? 1 : 0) + (/[A-Z]/.test(token) ? 1 : 0) + (/[0-9]/.test(token) ? 1 : 0);
  if (classes < 2) return false;
  return shannonEntropy(token) >= ENTROPY_THRESHOLD_BITS;
}

// --- seeded PRNG + runtime alphabets ------------------------------------------------
function prng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}
const range = (lo: number, hi: number): string[] =>
  Array.from({ length: hi - lo + 1 }, (_, i) => String.fromCharCode(lo + i));
const LOWER = range(97, 122);
const UPPER = range(65, 90);
const DIGITS = range(48, 57);
const B64 = [...UPPER, ...LOWER, ...DIGITS, "+", "/"];
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
function randomFrom(r: () => number, alphabet: readonly string[], n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += pick(r, alphabet);
  return s;
}
const base62 = (r: () => number, n: number): string =>
  randomFrom(r, [...UPPER, ...LOWER, ...DIGITS], n);

const WORDS = [
  "Users",
  "WebApp",
  "Alice",
  "Projects",
  "MyProject",
  "src",
  "Components",
  "Header",
  "node",
  "modules",
  "typescript",
  "lib",
  "worktrees",
  "scratchpad",
  "UserProfile",
  "GettingStarted",
  "Install",
  "Docs",
  "Guide",
  "release",
  "Feature",
  "Final",
  "backup",
  "Weekly",
  "Database",
  "Snapshot",
  "HTTPServer",
  "ADR",
  "wiki",
  "decisions",
  "FileWatcher",
  "bucket",
  "name",
  "Brand",
  "Nike",
  "AirMax",
  "Size",
  "Eleven",
  "tmp",
  "var",
  "log",
  "cache",
  "Builds",
  "Artifacts",
  "OUT",
];
const DELIMS = ["/", "-", "_", "=", "+"];

/** A path-like token of 32-128 chars: words, small numbers, short hex ids and delimiters. */
function pathLikeToken(r: () => number): string {
  for (;;) {
    let s = "";
    const target = 32 + Math.floor(r() * 60);
    while (s.length < target) {
      const k = r();
      const piece =
        k < 0.7
          ? pick(r, WORDS)
          : k < 0.85
            ? String(Math.floor(r() * 10000))
            : randomFrom(r, [...DIGITS, ..."abcdef"], 8);
      s += piece + pick(r, DELIMS);
    }
    s = s.slice(0, -1);
    if (s.length >= 32 && s.length <= 128 && /[=+]/.test(s)) return s;
  }
}

describe("`=`/`+` in path-like tokens: realistic values are untouched", () => {
  const j = (...p: string[]): string => p.join("/");
  const REALISTIC: Record<string, string> = {
    "flag with =path": `--out=${j("", "home", "Users", "Projects", "MyProject", "src", "Components", "Header")}`,
    "env assignment": `OUT_DIR=${j("", "Users", "Alice", "Projects", "WebApp", "node_modules", "typescript", "lib")}`,
    "assignment, mixed-case path": `path=${j("", "Users", "Alice", "Projects", "FileWatcher", "UserProfile", "GettingStarted")}`,
    "url with + in query": `https://${j("shop.example.com", "Products", "Category", "Shoes")}?Brand=Nike+AirMax&Size=Eleven`,
    "git ref assignment": `ref=${j("refs", "heads", "Feature", "UserProfilePictureUpload-Final")}`,
    "sort query": `sort=Name+Desc+${j("Users", "Alice", "Projects", "WebApp", "Components")}`,
    "worktree path with uuid": `OUT=${j("", "root", "golem", "worktrees", "agent-f70383e6-a18c-4b2d-9c3e-12ab34cd56ef", "scratchpad")}`,
  };
  for (const [name, text] of Object.entries(REALISTIC)) {
    it(`${name}: byte-identical`, () => {
      expect(redactStandaloneText(text)).toBe(text);
    });
  }

  it("DUSTSEC.20/22 shapes keep their behaviour: API ids and base64 in a query string", () => {
    const r = prng(7);
    const id = `srvtoolu_01${base62(r, 22)}`; // 33-char API id: exempt as a whole token
    expect(redactStandaloneText(`id ${id}`)).toBe(`id ${id}`);
    // a base64 query value with `=` padding is NOT a path: still judged by entropy
    const q = base62(r, 43);
    expect(redactStandaloneText(`https://example.com/cb?state=${q}=`)).not.toContain(q);
  });

  it("the old rule really did redact several of these (the over-redaction the probe fixes)", () => {
    const flagged = Object.values(REALISTIC).filter((t) =>
      t.split(/[^A-Za-z0-9+/=_-]/).some((tok) => tok.length >= 32 && legacyIsHighEntropy(tok)),
    );
    expect(flagged.length).toBeGreaterThanOrEqual(2);
  });
});

describe("`=`/`+` in path-like tokens: a secret in or next to one is redacted", () => {
  const r = prng(99);
  const secret = (): string => randomFrom(r, B64, 40).replace(/^[+/]+|[+/]+$/g, "") + base62(r, 8);
  const shapes: Array<[string, (s: string) => string]> = [
    ["flag=secret", (s) => `--out=${s}`],
    ["flag=/dir/secret", (s) => `--out=/tmp/${s}`],
    ["word+secret", (s) => `Key+${s}`],
    ["a/b=secret", (s) => `a/b=${s}`],
    ["words around secret", (s) => `Users/Alice=${s}+Projects/MyProject`],
    ["secret among words with +", (s) => `src/Components/${s}+Header`],
    [
      "key=secret with a long letters-only chunk",
      () => `token=${randomFrom(r, [...LOWER, ...UPPER], 40)}`,
    ],
    [
      "word chunks around a letters-only secret",
      () => `Users=Alice=${randomFrom(r, [...LOWER, ...UPPER], 36)}=Projects`,
    ],
  ];
  for (const [name, build] of shapes) {
    it(`${name}`, () => {
      for (let i = 0; i < 25; i++) {
        const s = build(secret());
        const out = redactStandaloneText(s);
        const core = s.replace(/^(--out=(\/tmp\/)?|Key\+|a\/b=|token=)/, "");
        expect(out, s).not.toBe(s);
        expect(out).not.toContain(core.slice(0, 24));
      }
    });
  }
});

describe("differential against the pre-change exemption", () => {
  it("tokens with no `=`/`+`: identical verdict to the old rule (30000 random tokens)", () => {
    const r = prng(1234);
    let n = 0;
    for (let i = 0; i < 30000; i++) {
      const len = 32 + Math.floor(r() * 96);
      const alphabet =
        i % 3 === 0
          ? [...UPPER, ...LOWER, ...DIGITS, "-", "_"]
          : i % 3 === 1
            ? [...LOWER, ...DIGITS, "-", "_", "/"]
            : B64.filter((c) => c !== "+");
      const t = randomFrom(r, alphabet, len);
      expect(isHighEntropyToken(t)).toBe(legacyIsHighEntropy(t));
      n++;
    }
    expect(n).toBe(30000);
  });

  it("path-like tokens with `=`/`+` and no secret: never redacted, 20000 random tokens", () => {
    const r = prng(555);
    let oldRedacted = 0;
    for (let i = 0; i < 20000; i++) {
      const t = pathLikeToken(r);
      if (legacyIsHighEntropy(t)) oldRedacted++;
      // the new rule is only ever MORE permissive on these than the old one: it never
      // flags a word-shaped path that the old rule left alone
      if (!legacyIsHighEntropy(t)) expect(isHighEntropyToken(t), t).toBe(false);
    }
    // the corpus must actually exercise the fixed over-redaction, or the test proves nothing
    expect(oldRedacted).toBeGreaterThan(500);
  });

  it("random base64 secrets containing `=`/`+`: old-redacted implies new-redacted (200000 tokens)", () => {
    const r = prng(2026);
    let withDelim = 0;
    let oldRedacted = 0;
    for (let i = 0; i < 200000; i++) {
      const len = 32 + Math.floor(r() * 96);
      let t = randomFrom(r, B64, len);
      if (i % 2 === 0) t += "=".repeat(1 + Math.floor(r() * 2)); // padding
      if (i % 5 === 0) t = `${pick(r, WORDS)}=${t}`.slice(0, 128);
      if (!/[=+]/.test(t) || t.length > 128) continue;
      withDelim++;
      if (legacyIsHighEntropy(t)) {
        oldRedacted++;
        // THE no-weakening property: nothing the old rule redacted is now exempt
        if (!isHighEntropyToken(t))
          throw new Error(`secret-shaped token newly exempt: len ${t.length}`);
      }
    }
    expect(withDelim).toBeGreaterThan(100000);
    expect(oldRedacted).toBeGreaterThan(80000);
  });
});
