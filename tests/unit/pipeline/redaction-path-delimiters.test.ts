/**
 * DUST2.23 probe 1 (DUST1.1 headline 9) — `=`/`+` in path-like tokens.
 *
 * DECISION: finding 9 is over-redaction, not a leak, and stays as it is under the
 * never-weaken rule. `isPathLikeToken` is unchanged. These tests pin the SAFE
 * direction: a secret in or next to a token carrying `=`/`+` is redacted, and the
 * known false positive is recorded as accepted. Stopping it would loosen redaction
 * and change output for existing inputs; that needs its own USER decision and a
 * differential test. Every secret-shaped value is generated at runtime.
 */

import { describe, expect, it } from "vitest";
import { redactStandaloneText } from "../../../src/pipeline/index.js";

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

describe("`=`/`+` in path-like tokens: current behaviour", () => {
  const j = (...p: string[]): string => p.join("/");
  it("accepted over-redaction: DUST1.1 headline 9 (long varied paths with `=`/`+` are redacted, safe direction)", () => {
    const env = `OUT_DIR=${j("", "Users", "Alice", "Projects", "WebApp", "node_modules", "typescript", "lib")}`;
    const sort = `sort=Name+Desc+${j("Users", "Alice", "Projects", "WebApp", "Components")}`;
    for (const text of [env, sort]) {
      const out = redactStandaloneText(text);
      expect(out).not.toBe(text);
      expect(out).toContain("[REDACTED:high-entropy:");
    }
  });

  it("short and low-entropy values with `=`/`+` still pass untouched", () => {
    const flag = `--out=${j("", "home", "Users", "Projects", "MyProject", "src", "Components", "Header")}`;
    const url = `https://${j("shop.example.com", "Products", "Category", "Shoes")}?Brand=Nike+AirMax&Size=Eleven`;
    for (const text of [
      flag,
      url,
      `ref=${j("refs", "heads", "Feature", "UserProfilePictureUpload-Final")}`,
    ]) {
      expect(redactStandaloneText(text)).toBe(text);
    }
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

describe("random base64 secrets carrying `=`/`+` are redacted", () => {
  it("4000 seeded tokens of 48-100 chars, with `+`, `/` and `=` padding", () => {
    const r = prng(2026);
    let n = 0;
    for (let i = 0; i < 4000; i++) {
      let t = randomFrom(r, B64, 48 + Math.floor(r() * 52));
      t = `${t.replace(/^[+/]+|[+/]+$/g, "")}${i % 2 === 0 ? "=" : "+x9"}`;
      if (!/[=+]/.test(t) || t.length > 128) continue;
      const out = redactStandaloneText(`value ${t} end`);
      expect(out, `seed ${i}`).not.toContain(t.slice(0, 32));
      n++;
    }
    expect(n).toBeGreaterThan(3500);
  });
});
