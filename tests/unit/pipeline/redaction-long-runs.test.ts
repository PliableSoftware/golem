/**
 * DUSTSEC.22 — a named-prefix secret inside an unbroken run longer than the
 * entropy sweep's 128-character ceiling used to leak whole: the named rule's
 * leading word boundary fails when the secret is glued onto another token, and
 * the sweep never sees a run that long.
 *
 * The fix scans INSIDE over-length runs for named-prefix secrets. It never
 * redacts a whole run, so legitimately long base64 (image data, thinking
 * signatures), hex digests and base64url blobs that hold no secret are not
 * touched. Every value is built at runtime; no key-shaped literal is committed.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NativeLosslessCompression } from "../../../src/compression/index.js";
import { policyFor } from "../../../src/interfaces/policy.js";
import {
  createGolemPipeline,
  redactRequestBody,
  redactStandaloneText,
} from "../../../src/pipeline/index.js";
import type { ProxyRequest } from "../../../src/proxy/types.js";
import { useTempDirs } from "../../helpers/tmp.js";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

const range = (lo: string, hi: string): string =>
  Array.from({ length: hi.charCodeAt(0) - lo.charCodeAt(0) + 1 }, (_, i) =>
    String.fromCharCode(lo.charCodeAt(0) + i),
  ).join("");
const UPPER_ALNUM = range("0", "9") + range("A", "Z");

/** `n` deterministic characters of `alphabet` for `seed`. */
function chars(alphabet: string, seed: string, n: number): string {
  let out = "";
  const limit = 256 - (256 % alphabet.length);
  for (let i = 0; out.length < n; i++) {
    for (const b of createHash("sha256").update(`${seed}:${i}`).digest()) {
      if (b < limit && out.length < n) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

const base62 = (seed: string, n: number) => chars(BASE62, seed, n);

/** Standard base64 text of `n` characters (has `+`, `/`, trailing `=` padding). */
function base64(seed: string, n: number): string {
  let out = "";
  for (let i = 0; out.length < n; i++) {
    out += createHash("sha512").update(`${seed}:${i}`).digest().toString("base64");
  }
  return out.slice(0, n - 2).replace(/[=]/g, "A") + "==";
}

function hex(seed: string, n: number): string {
  return chars("0123456789abcdef", seed, n);
}

const MARK = `[${"REDACTED"}:`;
const API_ID = `${"srvtoolu"}_01${base62("api-id", 22)}`;
const ANT = `${"sk"}-${"ant"}-`;
const newTempDir = useTempDirs("golem-dustsec22-");

async function pipeline() {
  const projectDir = await newTempDir();
  return createGolemPipeline({
    compression: NativeLosslessCompression.forProjectDir(projectDir),
    policy: () => policyFor(1),
    projectId: projectDir,
  });
}

function req(url: string, body: unknown): ProxyRequest {
  return {
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify(body), "utf8"),
  };
}

function bodies(value: string): { name: string; url: string; body: unknown }[] {
  const messages = [{ role: "user", content: [{ type: "text", text: `see ${value} ok` }] }];
  return [
    { name: "messages", url: "/v1/messages", body: { model: "m", max_tokens: 1, messages } },
    { name: "tool_result", url: "/v1/messages", body: tool(value) },
    { name: "count_tokens", url: "/v1/messages/count_tokens", body: { model: "m", messages } },
    { name: "arbitrary", url: "/v1/other", body: { nested: [{ id: value }] } },
  ];
}

function tool(value: string): unknown {
  return {
    model: "m",
    max_tokens: 1,
    messages: [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t", content: [{ type: "text", text: value }] },
        ],
      },
    ],
  };
}

/** Every body the pipeline would forward, via process and via the redactOnly fail-safe. */
async function forwarded(value: string): Promise<{ via: string; text: string }[]> {
  const p = await pipeline();
  const out: { via: string; text: string }[] = [];
  for (const b of bodies(value)) {
    const request = req(b.url, b.body);
    const processed = await p.process(request);
    out.push({ via: `process ${b.name}`, text: (processed.body ?? Buffer.alloc(0)).toString() });
    const safe = (p.redactOnly as (r: ProxyRequest) => ProxyRequest)(request);
    out.push({ via: `redactOnly ${b.name}`, text: (safe.body ?? Buffer.alloc(0)).toString() });
  }
  return out;
}

async function expectLeakRedacted(run: string, secret: string): Promise<void> {
  for (const { via, text } of await forwarded(run)) {
    expect(text, via).not.toContain(secret);
    expect(text, via).toContain(MARK);
  }
  expect(redactStandaloneText(run)).not.toContain(secret);
}

async function expectUntouched(run: string): Promise<void> {
  for (const { via, text } of await forwarded(run)) {
    expect(text, via).toContain(JSON.stringify(run).slice(1, -1));
    expect(text, via).not.toContain(MARK);
  }
  expect(redactStandaloneText(run)).toBe(run);
}

describe("DUSTSEC.22 named-prefix secrets glued inside an over-length run are redacted", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["anthropic key glued after an api id (105)", `${ANT}${base62("ant", 105)}`],
    ["anthropic key, base64url body", `${ANT}${chars(`${BASE62}_-`, "ant2", 110)}`],
    ["github token glued after an api id", `${"ghp"}_${base62("gh", 36)}`],
    ["openai legacy key, sk- plus 48 alphanumerics", `${"sk"}-${base62("legacy", 48)}`],
    ["github fine-grained token", `${"github"}_pat_${chars(`${BASE62}_`, "pat", 82)}`],
    ["openai-style key", `${"sk"}-${"proj"}-${chars(`${BASE62}_-`, "oa", 100)}`],
    ["stripe live key", `${"sk"}_live_${base62("st", 40)}`],
    ["slack token", `${"xoxb"}-${chars(`${BASE62}-`, "sl", 50)}`],
    ["aws access key id", `${"AKIA"}${chars("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", "aws", 16)}`],
    ["google api key", `${"AIza"}${chars(`${BASE62}_-`, "g", 35)}`],
    ["nostr secret key", `${"nsec"}1${chars(BECH32, "ns", 58)}`],
  ];

  for (const [name, secret] of cases) {
    it(`${name}: glued after an id`, async () => {
      const run = `${API_ID}${base62("pad", 80)}${secret}`;
      expect(run.length).toBeGreaterThan(128);
      await expectLeakRedacted(run, secret);
    });
  }

  it("the issue's repro: 33-char id plus a 105-char key, 141 chars in all", async () => {
    const secret = `${ANT}${base62("repro", 101)}`;
    const run = `${API_ID}${secret}`;
    expect(run.length).toBeGreaterThanOrEqual(141);
    await expectLeakRedacted(run, secret);
  });

  it("an AWS key at the START or END of an over-length mixed-case run is redacted", async () => {
    const key = `${"AKIA"}${chars(UPPER_ALNUM, "edge", 16)}`;
    await expectLeakRedacted(`${key}${base62("after", 120)}`, key);
    await expectLeakRedacted(`${base62("before", 120)}${key}`, key);
  });

  // DOCUMENTED RESIDUAL, pinned: scanning the middle for the AWS shape corrupts
  // uppercase hex and base32 data (ACCA and A3T are valid hex/base32), so an AWS
  // key with junk glued on BOTH sides is not found. It was not found before either.
  it("an AWS key with junk glued on both sides is a known residual", () => {
    const key = `${"AKIA"}${chars(UPPER_ALNUM, "mid-aws", 16)}`;
    const run = `${base62("l", 80)}${key}${base62("r", 80)}`;
    expect(redactStandaloneText(run)).toContain(key);
  });

  it("touching keys keep their own placeholder kinds", () => {
    // The stripe tail is capped at 99, so the anthropic prefix starts exactly where it ends.
    const stripe = `${"sk"}_live_${base62("t-b", 99)}`;
    const ant = `${ANT}${base62("t-a", 40)}`;
    const out = redactStandaloneText(`${base62("lead", 90)}${stripe}${ant}`);
    expect(out).toContain(`${MARK}stripe-key:`);
    expect(out).toContain(`${MARK}anthropic-key:`);
    expect(out).not.toContain(base62("t-a", 40));
  });

  it("an anthropic key with junk glued before and after", async () => {
    const key = `${ANT}${base62("mid-ant", 60)}`;
    const run = `${base62("l2", 90)}${key}`;
    await expectLeakRedacted(run, key);
  });

  it("a start-anchored key followed by glued junk in a run over 128", async () => {
    const key = `${"AIza"}${chars(`${BASE62}_-`, "start", 35)}`;
    await expectLeakRedacted(`${key}${base62("junk", 120)}`, key);
    const gh = `${"ghp"}_${base62("start-gh", 36)}`;
    await expectLeakRedacted(`${gh}${base62("junk2", 120)}`, gh);
  });

  it("two secrets in one run, each with its own placeholder, are both gone", () => {
    const a = `${ANT}${base62("two-a", 40)}`;
    const b = `${"sk"}_live_${base62("two-b", 40)}`;
    const text = `${base62("p", 70)}${a}${base62("q", 10)}${b}`;
    const out = redactStandaloneText(text);
    expect(out).not.toContain(a);
    expect(out).not.toContain(b);
    expect(out).not.toContain(base62("two-b", 40));
  });

  it("the same secret reuses its placeholder (stable numbering)", () => {
    const secret = `${ANT}${base62("stable", 60)}`;
    const t = `${base62("x", 80)}${secret} and ${base62("y", 80)}${secret}`;
    const out = redactStandaloneText(t);
    const found = out.match(new RegExp(`\\[${"REDACTED"}:anthropic-key:\\d+\\]`, "g")) ?? [];
    expect(found.length).toBe(2);
    expect(found[0]).toBe(found[1]);
  });

  it("is idempotent", () => {
    const run = `${API_ID}${ANT}${base62("idem", 105)}`;
    const once = redactStandaloneText(run);
    expect(redactStandaloneText(once)).toBe(once);
  });

  it("the generic JSON walker redacts it inside a nested value", () => {
    const secret = `${ANT}${base62("walker", 105)}`;
    const r = redactRequestBody({ a: [{ b: `${API_ID}${secret}` }] });
    expect(JSON.stringify(r.value)).not.toContain(secret);
    expect(r.count).toBeGreaterThan(0);
  });
});

describe("DUSTSEC.22 legitimately long values are NOT altered", () => {
  it("a thinking signature (long standard base64)", async () => {
    for (const n of [300, 1_500, 12_000]) await expectUntouched(base64(`sig${n}`, n));
  });

  it("a base64 image payload", async () => {
    const png = `iVBORw0KGgo${base64("img", 60_000)}`;
    await expectUntouched(png);
    const body = {
      model: "m",
      max_tokens: 1,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
          ],
        },
      ],
    };
    const r = redactRequestBody(body);
    expect(r.value).toBe(body);
    expect(r.count).toBe(0);
  });

  it("a long hex digest", async () => {
    for (const n of [129, 256, 4096]) await expectUntouched(hex(`hex${n}`, n));
  });

  it("uppercase hex and base32 data, many random blobs, is byte-identical", () => {
    const hexU = "0123456789ABCDEF";
    const b32 = range("A", "Z") + range("2", "7");
    // A 13+ digit run is read by the pre-existing credit-card rule (Luhn passes 1
    // time in 10), which is not this change; keep the corpus clear of it.
    const blob = (alphabet: string, seed: string, n: number): string => {
      for (let k = 0; ; k++) {
        const run = chars(alphabet, `${seed}-${k}`, n);
        if (!/\d{13}/.test(run)) return run;
      }
    };
    for (let i = 0; i < 400; i++) {
      for (const run of [blob(hexU, `uh4096-${i}`, 4096), blob(hexU, `uh256-${i}`, 256)]) {
        expect(redactStandaloneText(run) === run, `upper hex ${i}`).toBe(true);
      }
      const run = blob(b32, `b32-${i}`, 512);
      expect(redactStandaloneText(run) === run, `base32 ${i}`).toBe(true);
    }
  });

  it("lowercase and uppercase hex digests of 128, 129 and 256 chars are untouched", async () => {
    for (const n of [128, 129, 256]) {
      await expectUntouched(hex(`lo${n}`, n));
      await expectUntouched(hex(`up${n}`, n).toUpperCase());
    }
  });

  it("a signature-like 2 KB base64 run is untouched", async () => {
    await expectUntouched(base64("sig2k", 2048));
  });

  it("a long base64url blob with no named prefix", async () => {
    await expectUntouched(chars(`${BASE62}_-`, "b64url", 600));
  });

  it("a long slash-joined path with no named prefix", async () => {
    await expectUntouched(
      Array.from({ length: 30 }, (_, i) => `seg${i}`).join("/") + "/" + "a".repeat(20),
    );
  });

  it("an api id glued to junk with no named prefix is left alone (no blanket rule)", async () => {
    await expectUntouched(`${API_ID}${base62("junk-only", 100)}`);
  });

  it("a prefix-shaped fragment too short to be a key is left alone", async () => {
    await expectUntouched(`${base62("short", 140)}${ANT}abc`);
  });

  // DOCUMENTED RESIDUAL, pinned deliberately: an over-length run with NO named
  // prefix is indistinguishable from base64 data, and rewriting data corrupts the
  // request (a thinking signature, an image). Closing this needs field-aware
  // redaction, which is a separate task.
  it("a plain random over-length run with no named prefix is not redacted (residual)", async () => {
    await expectUntouched(base62("plain200", 200));
  });
});

describe("DUSTSEC.22 stays linear on a huge unbroken run", () => {
  const MB = 1_000_000;
  const shapes: readonly (readonly [string, string])[] = [
    ["random base64", base64("mb", MB)],
    ["a single repeated character", "A".repeat(MB)],
    ["the anthropic prefix repeated", ANT.repeat(Math.ceil(MB / ANT.length))],
    ["the openai prefix repeated", "sk-".repeat(Math.ceil(MB / 3))],
    ["the github prefix repeated", `${"ghp"}_`.repeat(Math.ceil(MB / 4))],
    ["the fine-grained prefix repeated", `${"github"}_pat_`.repeat(Math.ceil(MB / 11))],
    ["the aws prefix repeated", "AKIA".repeat(Math.ceil(MB / 4))],
    ["the google prefix repeated", "AIza".repeat(Math.ceil(MB / 4))],
    ["the slack prefix repeated", `${"xoxb"}-`.repeat(Math.ceil(MB / 5))],
    ["the nostr prefix repeated", `${"nsec"}1`.repeat(Math.ceil(MB / 5))],
    ["the azure key prefix repeated", "AccountKey=".repeat(Math.ceil(MB / 11))],
  ];

  for (const [name, run] of shapes) {
    it(`1 MB of ${name} completes quickly`, () => {
      const started = performance.now();
      const out = redactStandaloneText(run);
      const ms = performance.now() - started;
      expect(typeof out).toBe("string");
      expect(ms).toBeLessThan(3_000);
    });
  }

  it("1 MB of random base64 is returned byte-identical", () => {
    const run = base64("mb-identical", MB);
    expect(redactStandaloneText(run)).toBe(run);
  });

  it("10 MB runs (random base64, one character, a glued key) neither throw nor crawl", () => {
    const TEN = 10 * MB;
    const b64 = base64("ten", TEN);
    const glued = `${b64.replace(/[+/=]/g, "x")}${ANT}${base62("ten-key", 105)}`;
    for (const [run, expectSame] of [
      [b64, true],
      ["A".repeat(TEN), true],
      [glued, false],
    ] as const) {
      const started = performance.now();
      const out = redactStandaloneText(run);
      expect(performance.now() - started).toBeLessThan(5_000);
      expect(out === run).toBe(expectSame);
    }
    expect(redactStandaloneText(glued)).not.toContain(base62("ten-key", 105));
  });

  it("many 300-char runs of a repeated prefix (edge regex worst case) stay fast", () => {
    for (const unit of ["sk-", `${"sk"}-proj-`, "AKIA", `${"ghp"}_`]) {
      const runs = Array.from({ length: 3_000 }, () => unit.repeat(Math.ceil(300 / unit.length)));
      const started = performance.now();
      redactStandaloneText(runs.join(" "));
      expect(performance.now() - started).toBeLessThan(3_000);
    }
  });

  it("1 MB run with a real key glued on the end is redacted", () => {
    const key = `${ANT}${base62("mb-key", 105)}`;
    const out = redactStandaloneText(`${base62("mb-pre", MB)}${key}`);
    expect(out).not.toContain(key);
  });
});

describe("DUSTSEC.22 redaction is idempotent over long runs", () => {
  const pieces = (seed: number) => {
    const kinds: readonly ((n: string) => string)[] = [
      (n) => base62(n, 20 + (seed % 230)),
      (n) => base64(n, 40 + (seed % 300)),
      (n) => `${ANT}${base62(n, 40)}`,
      (n) => `${"ghp"}_${base62(n, 36)}`,
      (n) => `${"sk"}-${base62(n, 48)}`,
      (n) => `${"AKIA"}${chars(UPPER_ALNUM, n, 16)}`,
      (n) => `${"AIza"}${chars(`${BASE62}_-`, n, 35)}`,
      (n) => `${"xoxb"}-${chars(`${BASE62}-`, n, 30)}`,
      (n) => `${"sk"}_live_${base62(n, 30)}`,
      () => API_ID,
      () => " ",
    ];
    return kinds;
  };

  function mixture(i: number): string {
    const kinds = pieces(i);
    const count = 2 + (i % 6);
    let out = "";
    for (let j = 0; j < count; j++) {
      const pick = createHash("sha256").update(`pick:${i}:${j}`).digest()[0] as number;
      out += (kinds[pick % kinds.length] as (n: string) => string)(`m:${i}:${j}`);
    }
    return out;
  }

  it("the sk- before an AKIA shape: a second pass changes nothing", () => {
    const run = `${base62("a", 200)}${"sk"}-${base62("b", 40)}${"AKIA"}${chars(UPPER_ALNUM, "c", 16)}${base62("d", 200)}`;
    const once = redactStandaloneText(run);
    expect(redactStandaloneText(once)).toBe(once);
  });

  it("an sk-proj key and a github token peeled off both ends leave nothing behind", () => {
    const k1 = `${"sk"}-proj-${chars(`${BASE62}_-`, "e1", 60)}`;
    const k2 = `${"ghp"}_${base62("e2", 36)}`;
    const run = `${k1}${base62("mid", 300)}${k2}`;
    const once = redactStandaloneText(run);
    expect(once).not.toContain(k1);
    expect(once).not.toContain(k2);
    expect(redactStandaloneText(once)).toBe(once);
  });

  it("1200 random mixtures: redact(redact(x)) equals redact(x), standalone and walker", () => {
    for (let i = 0; i < 1200; i++) {
      const x = mixture(i);
      const once = redactStandaloneText(x);
      expect(redactStandaloneText(once) === once, `standalone ${i}`).toBe(true);
      const body = { a: [{ t: x }] };
      const w1 = redactRequestBody(body).value;
      expect(
        JSON.stringify(redactRequestBody(w1).value) === JSON.stringify(w1),
        `walker ${i}`,
      ).toBe(true);
    }
  });

  it("1200 random mixtures through the redactOnly fail-safe are idempotent", async () => {
    const p = await pipeline();
    const safe = p.redactOnly as (r: ProxyRequest) => ProxyRequest;
    for (let i = 0; i < 1200; i++) {
      const first = safe(req("/v1/messages", bodies(mixture(i))[0]?.body));
      const second = safe(first);
      expect(second.body?.toString() === first.body?.toString(), `redactOnly ${i}`).toBe(true);
    }
  });
});
