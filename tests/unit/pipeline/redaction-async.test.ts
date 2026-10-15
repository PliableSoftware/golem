/**
 * DUSTSEC.23 — the sliced (async) redaction walk is the sync walk, byte for byte,
 * and it gives the event loop back.
 *
 * Secret-shaped values are assembled at runtime so no literal sits in the source.
 */

import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { type CompressionLevel, policyFor } from "../../../src/interfaces/policy.js";
import { redactAnyBody, redactAnyBodyAsync } from "../../../src/pipeline/body-redaction.js";
import { createGolemPipeline } from "../../../src/pipeline/index.js";
import {
  REDACTION_SLICE_MS,
  RedactionAborted,
  RedactionPacer,
  redactRequestBody,
  redactRequestBodyAsync,
} from "../../../src/pipeline/redaction.js";
import { RequestBodyRefusal } from "../../../src/proxy/request-body.js";
import type { ProxyRequest } from "../../../src/proxy/types.js";
import { recordedShapes } from "../../helpers/recorded-conversations.js";

// ---- generators --------------------------------------------------------------

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

// 0-9, a-z, A-Z built from char codes: a typed alphabet looks like a secret to scanners.
const ALNUM = [
  [48, 57],
  [97, 122],
  [65, 90],
]
  .flatMap(([from, to]) =>
    Array.from({ length: (to as number) - (from as number) + 1 }, (_, i) =>
      String.fromCharCode((from as number) + i),
    ),
  )
  .join("");
const UPPER_DIGITS = ALNUM.slice(36) + ALNUM.slice(0, 10);
const SECRETS: readonly ((r: () => number) => string)[] = [
  (r) => `AKIA${Array.from({ length: 16 }, () => UPPER_DIGITS[Math.floor(r() * 36)]).join("")}`,
  (r) => `ghp_${Array.from({ length: 36 }, () => ALNUM[Math.floor(r() * 62)]).join("")}`,
  (r) => `sk-ant-${Array.from({ length: 40 }, () => ALNUM[Math.floor(r() * 62)]).join("")}`,
  () => `${["postgres://app", `pw${"x9".repeat(8)}`].join(":")}@db.internal:5432/main`,
  (r) => Array.from({ length: 48 }, () => ALNUM[Math.floor(r() * 62)]).join(""),
];
const FRAGMENTS = [
  "hello",
  " ",
  "\n",
  "\t",
  "naïve café",
  "日本語のテキスト",
  "emoji 😀🚀",
  "é",
  "\ud800", // lone surrogate: JSON.parse accepts it
  "a.b.c",
  "-----BEGIN",
  "user@example.com",
  "/usr/local/bin",
  ["[", "RED", "ACTED:aws-key:1]"].join(""), // already a placeholder: redaction must leave it alone
  "",
];

function genString(r: () => number): string {
  const parts = 1 + Math.floor(r() * 6);
  let out = "";
  for (let i = 0; i < parts; i += 1) {
    const roll = r();
    if (roll < 0.25)
      out += (SECRETS[Math.floor(r() * SECRETS.length)] as (r: () => number) => string)(r);
    else if (roll < 0.3)
      out += "x".repeat(Math.floor(r() * 60_000)); // a large string
    else out += FRAGMENTS[Math.floor(r() * FRAGMENTS.length)] as string;
  }
  return out;
}

function genValue(r: () => number, depth: number): unknown {
  const roll = r();
  if (depth <= 0 || roll < 0.4) {
    const leaf = r();
    if (leaf < 0.55) return genString(r);
    if (leaf < 0.7) return Math.floor(r() * 1e9) - 5e8;
    if (leaf < 0.78) return r() * 1e-3;
    if (leaf < 0.86) return r() < 0.5;
    return null;
  }
  const size = Math.floor(r() * 5); // 0 gives the empty container
  if (roll < 0.7) return Array.from({ length: size }, () => genValue(r, depth - 1));
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < size; i += 1)
    obj[`k${Math.floor(r() * 8)}${genString(r).slice(0, 4)}`] = genValue(r, depth - 1);
  return obj;
}

const serial = (v: unknown): string => JSON.stringify(v) ?? "undefined";

async function expectSame(body: unknown, sliceMs?: number): Promise<void> {
  const sync = redactRequestBody(body);
  const async_ = await redactRequestBodyAsync(body, sliceMs === undefined ? {} : { sliceMs });
  expect(serial(async_.value)).toBe(serial(sync.value));
  expect(async_.count).toBe(sync.count);
  expect(async_.delta).toEqual(sync.delta);
  // Identity is part of the contract: unchanged in, same object out.
  expect(async_.value === body).toBe(sync.value === body);
}

// ---- differential ------------------------------------------------------------

describe("DUSTSEC.23 differential: async walk === sync walk", () => {
  it("property test over 400 random JSON bodies, slicing on every element and by the default budget", async () => {
    const r = rng(0xd0575ec);
    let withSecrets = 0;
    for (let i = 0; i < 400; i += 1) {
      const body = genValue(r, 5);
      if (redactRequestBody(body).count > 0) withSecrets += 1;
      await expectSame(body, 0); // sliceMs 0: yield after every element
      if (i % 4 === 0) await expectSame(body); // default budget
    }
    // The generator must actually exercise redaction, or this proves nothing.
    expect(withSecrets).toBeGreaterThan(100);
  }, 120_000);

  it("the generators really produce secrets the walk redacts", () => {
    const r = rng(9);
    for (const make of SECRETS.slice(0, 4)) {
      expect(redactRequestBody({ v: `x ${make(r)} y` }).count).toBeGreaterThan(0);
    }
  });

  it("scalars, empty containers and the top-level shapes", async () => {
    for (const v of [
      null,
      true,
      0,
      -1.5,
      "",
      "plain",
      [],
      {},
      [[]],
      [{}],
      { a: [] },
      { a: {} },
      [null, true, 1],
    ]) {
      await expectSame(v, 0);
    }
  });

  it("an object with a __proto__ key and sparse arrays behave as the sync walk does", async () => {
    const body = JSON.parse(`{"__proto__":"x ${SECRETS[0]?.(rng(1))}","a":[1,"y"]}`) as unknown;
    await expectSame(body, 0);
    const sparse: unknown[] = [];
    sparse[3] = `tok ${SECRETS[1]?.(rng(2))}`;
    await expectSame(sparse, 0);
  });

  it("every recorded shape at every turn length", async () => {
    let n = 0;
    for (const shape of recordedShapes()) {
      for (let turn = 1; turn <= shape.messages.length; turn += 1) {
        const body = { ...shape.envelope, messages: shape.messages.slice(0, turn) };
        await expectSame(body, 0);
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it("primitive-heavy bodies (numbers, booleans, null) are untouched and identical", async () => {
    const big = Array.from({ length: 200_000 }, (_, i) =>
      i % 3 === 0 ? i : i % 3 === 1 ? i % 2 === 0 : null,
    );
    big.push(`tail ${SECRETS[1]?.(rng(4))}` as never);
    await expectSame({ n: big });
    await expectSame(big, 0);
  });

  it("the async walk never mutates its input", async () => {
    const r = rng(31);
    for (let i = 0; i < 40; i += 1) {
      const body = genValue(r, 4);
      const before = serial(body);
      await redactRequestBodyAsync(body, { sliceMs: 0 });
      expect(serial(body)).toBe(before);
    }
  });

  it("is idempotent: redacting the async output again changes nothing", async () => {
    const r = rng(77);
    for (let i = 0; i < 60; i += 1) {
      const once = await redactRequestBodyAsync(genValue(r, 4), { sliceMs: 0 });
      const twice = await redactRequestBodyAsync(once.value, { sliceMs: 0 });
      expect(twice.count).toBe(0);
      expect(twice.value).toBe(once.value);
    }
  });

  it("redactAnyBody / redactAnyBodyAsync agree on JSON, text, form, opaque and refused bodies", async () => {
    const secret = SECRETS[1]?.(rng(5)) as string;
    const req = (body: string | Buffer, type: string): ProxyRequest => ({
      method: "POST",
      url: "/v1/other",
      headers: { "content-type": type },
      body: typeof body === "string" ? Buffer.from(body, "utf8") : body,
    });
    const cases: ProxyRequest[] = [
      req(JSON.stringify({ a: [`k ${secret}`, 1, { b: secret }] }), "application/json"),
      req(JSON.stringify({ a: "nothing here" }), "application/json"),
      req(JSON.stringify({ a: secret }), "text/plain"),
      req(`plain text ${secret}`, "text/plain"),
      req(`a=1&b=${encodeURIComponent(secret)}`, "application/x-www-form-urlencoded"),
      req(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), "image/png"),
      req("", "application/json"),
      { method: "POST", url: "/x", headers: {}, body: null },
    ];
    for (const c of cases) {
      const a = redactAnyBody(c);
      const b = await redactAnyBodyAsync(c, { sliceMs: 0 });
      expect(b.body === null ? null : b.body.toString("latin1")).toBe(
        a.body === null ? null : a.body.toString("latin1"),
      );
      expect(b === c).toBe(a === c);
    }
    // Refusals are the same refusal.
    const dup = req(`{"a":"1","a":"${secret}"}`, "application/json");
    expect(() => redactAnyBody(dup)).toThrow(RequestBodyRefusal);
    await expect(redactAnyBodyAsync(dup)).rejects.toBeInstanceOf(RequestBodyRefusal);
    const wide = req(Buffer.from("﻿hi", "utf16le"), "text/plain; charset=utf-16");
    expect(() => redactAnyBody(wide)).toThrow(RequestBodyRefusal);
    await expect(redactAnyBodyAsync(wide)).rejects.toBeInstanceOf(RequestBodyRefusal);
  });

  it("pipeline.process (async walk) matches the sync redactOnly and redactOnlyAsync on messages bodies", async () => {
    const pipeline = createGolemPipeline({
      compression: { compress: () => Promise.reject(new Error("not used")) } as never,
      policy: () => policyFor(0 as unknown as CompressionLevel),
      projectId: "dustsec23",
    });
    for (const shape of recordedShapes()) {
      const body = { ...shape.envelope, messages: shape.messages };
      const request: ProxyRequest = {
        method: "POST",
        url: "/v1/messages",
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify(body), "utf8"),
      };
      const sync = (pipeline.redactOnly as NonNullable<typeof pipeline.redactOnly>)(request);
      const async_ = await (
        pipeline.redactOnlyAsync as NonNullable<typeof pipeline.redactOnlyAsync>
      )(request);
      expect(async_.body?.toString("utf8")).toBe(sync.body?.toString("utf8"));
      expect(async_ === request).toBe(sync === request);
    }
  });
});

// ---- deep nesting ----------------------------------------------------------------

/** A value nested `depth` containers deep with a secret at the bottom, built without recursion. */
function nested(depth: number, shape: "object" | "array" | "mixed", leaf: string): unknown {
  let v: unknown = leaf;
  for (let i = 0; i < depth; i += 1) {
    const asArray = shape === "array" || (shape === "mixed" && i % 2 === 0);
    v = asArray ? [v] : { a: v };
  }
  return v;
}

type Outcome = { ok: true; json: string; count: number } | { ok: false };
async function outcome(run: () => unknown): Promise<Outcome> {
  try {
    const r = (await run()) as { value: unknown; count: number };
    return { ok: true, json: JSON.stringify(r.value), count: r.count };
  } catch {
    return { ok: false };
  }
}

describe("DUSTSEC.23 deep nesting: the async walk never loses depth the sync walk has", () => {
  const leaf = `deep ${SECRETS[1]?.(rng(8))}`;
  for (const shape of ["object", "array", "mixed"] as const) {
    for (const depth of [1000, 2000, 2500, 3500, 4400]) {
      it(`${shape}, depth ${depth}: both succeed identically, or only the async one does`, async () => {
        const body = nested(depth, shape, leaf);
        const sync = await outcome(() => redactRequestBody(body));
        const async_ = await outcome(() => redactRequestBodyAsync(body, { sliceMs: 0 }));
        if (sync.ok) {
          expect(async_).toEqual(sync);
          expect(sync.count).toBeGreaterThan(0);
        }
        if (depth <= 2000) expect(sync.ok).toBe(true);
        // The iterative walk has no call-stack limit of its own: only the whole-body
        // JSON.stringify (about 4471 levels) bounds it.
        if (depth <= 4400 && shape !== "array") expect(async_.ok).toBe(true);
      });
    }
  }

  it("the async walk redacts a nesting far past any stack limit, or refuses; it never forwards raw", async () => {
    const body = nested(20_000, "object", leaf);
    await expect(redactRequestBodyAsync(body)).rejects.toBeInstanceOf(RangeError);
  });
});

// ---- failure, abort, cleanup ---------------------------------------------------

describe("DUSTSEC.23 fail closed, cancellation, cleanup", () => {
  it("a throw inside a slice rejects (never returns raw) with the original error", async () => {
    const filler = Array.from({ length: 50 }, (_, i) => ({ t: `item ${i}` }));
    const boom = new Error("slice boom");
    const trap = {
      get t(): string {
        throw boom;
      },
    };
    await expect(
      redactRequestBodyAsync({ m: [...filler, trap, ...filler] }, { sliceMs: 0 }),
    ).rejects.toBe(boom);
  });

  it("an already-aborted signal refuses before any work", async () => {
    let touched = 0;
    const spy = {
      get t(): string {
        touched += 1;
        return "x";
      },
    };
    const ac = new AbortController();
    ac.abort();
    await expect(redactRequestBodyAsync([spy], { signal: ac.signal })).rejects.toBeInstanceOf(
      RedactionAborted,
    );
    expect(touched).toBe(0);
  });

  it("an abort mid-walk stops the walk cheaply and returns nothing", async () => {
    let visited = 0;
    const items = Array.from({ length: 20_000 }, () => ({
      get t(): string {
        visited += 1;
        return "word ".repeat(40);
      },
    }));
    const ac = new AbortController();
    const walk = redactRequestBodyAsync({ m: items }, { signal: ac.signal, sliceMs: 5 });
    setImmediate(() => ac.abort());
    await expect(walk).rejects.toBeInstanceOf(RedactionAborted);
    expect(visited).toBeGreaterThan(0);
    // The token estimate's one JSON.stringify touches every item once; the walk then
    // got through only a fraction of them before the abort.
    expect(visited - items.length).toBeLessThan(items.length / 2);
    const after = visited;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(visited).toBe(after); // nothing keeps walking
  });

  it("leaves no timer or immediate running on success, throw or abort", async () => {
    const active = (): string[] =>
      process.getActiveResourcesInfo().filter((x) => x === "Immediate" || x === "Timeout");
    const before = active().length;
    await redactRequestBodyAsync(
      { a: Array.from({ length: 100 }, (_, i) => `s${i}`) },
      { sliceMs: 0 },
    );
    const ac = new AbortController();
    const p = redactRequestBodyAsync(
      Array.from({ length: 100 }, (_, i) => `s${i}`),
      { signal: ac.signal, sliceMs: 0 },
    );
    ac.abort();
    await p.catch(() => undefined);
    await redactRequestBodyAsync([
      {
        get t(): string {
          throw new Error("x");
        },
      },
    ]).catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));
    expect(active().length).toBeLessThanOrEqual(before);
  });
});

describe("DUSTSEC.23 pacer", () => {
  const spin = (ms: number): void => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      /* busy: an unsliceable step */
    }
  };

  it("does not yield after cheap work, and does after a step of 5 ms or more", async () => {
    const pacer = new RedactionPacer();
    let turned = false;
    setImmediate(() => {
      turned = true;
    });
    await pacer.pause();
    expect(turned).toBe(false); // cheap: no turn given away
    spin(10);
    await pacer.pause();
    expect(turned).toBe(true); // the 10 ms step was followed by a turn for the loop
  });

  it("stops with RedactionAborted once the signal aborts, yield or not", async () => {
    const ac = new AbortController();
    const pacer = new RedactionPacer(ac.signal);
    ac.abort();
    await expect(pacer.pause()).rejects.toBeInstanceOf(RedactionAborted);
    await expect(pacer.yieldNow()).rejects.toBeInstanceOf(RedactionAborted);
  });
});

// ---- event loop ----------------------------------------------------------------

function manySmallStrings(targetBytes: number): {
  model: string;
  messages: { role: string; content: string }[];
} {
  const words = [
    "alpha",
    "beta",
    "gamma",
    "delta",
    "token",
    "user",
    "session",
    "value",
    "config",
    "path",
  ];
  const messages: { role: string; content: string }[] = [];
  let size = 0;
  for (let i = 0; size < targetBytes; i += 1) {
    const content = `${words[i % 10]} ${words[(i * 7) % 10]} item-${i} ${words[(i * 3) % 10]}`;
    messages.push({ role: "user", content });
    size += content.length + 32;
  }
  return { model: "m", messages };
}

/** The longest gap between two ticks of a 2 ms timer while `work` runs: what another session's stream would feel. */
async function longestStallMs(work: () => Promise<unknown> | unknown): Promise<number> {
  let last = performance.now();
  let max = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    max = Math.max(max, now - last);
    last = now;
  }, 2);
  try {
    last = performance.now();
    await work();
    max = Math.max(max, performance.now() - last);
  } finally {
    clearInterval(timer);
  }
  return max;
}

describe("DUSTSEC.23 event-loop stall", () => {
  // ~0.33 s of sync walking per MiB on the machine this was written on, so 8 MiB is
  // far above the bound below on any CI box, and the sync walk fails it.
  const BOUND_MS = 400;
  const body = manySmallStrings(8 * 1024 * 1024);

  it("the sync walk stalls the loop past the bound (the test measures something)", async () => {
    const stall = await longestStallMs(() => redactRequestBody(body));
    expect(stall).toBeGreaterThan(BOUND_MS);
  }, 120_000);

  it(`the async walk stays under ${BOUND_MS} ms on the same body and returns the same bytes`, async () => {
    let result: Awaited<ReturnType<typeof redactRequestBodyAsync>> | undefined;
    const stall = await longestStallMs(async () => {
      result = await redactRequestBodyAsync(body);
    });
    expect(stall).toBeLessThan(BOUND_MS);
    expect(result?.count).toBe(0);
    expect(result?.value).toBe(body);
    // The stated slice budget is what bounds a stall; keep the constant honest.
    expect(REDACTION_SLICE_MS).toBeLessThanOrEqual(25);
  }, 120_000);

  it("two large bodies interleave fairly: a small one started later finishes first", async () => {
    const big = manySmallStrings(3 * 1024 * 1024);
    const small = { m: ["a", "b", "c"] };
    const order: string[] = [];
    const a = redactRequestBodyAsync(big).then(() => order.push("big-1"));
    const b = redactRequestBodyAsync(big).then(() => order.push("big-2"));
    await new Promise((resolve) => setImmediate(resolve));
    const c = redactRequestBodyAsync(small).then(() => order.push("small"));
    await Promise.all([a, b, c]);
    expect(order[0]).toBe("small");
    expect(order).toHaveLength(3);
  }, 120_000);
});
