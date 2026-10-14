/**
 * DUST2.11 — a failing plugin stage is skipped, the PRE-STAGE body is kept, and
 * the fault is recorded. The pre-stage body has already been through built-in
 * redaction (stage 1 runs before stage 1.7), so keeping it keeps redaction.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeLosslessCompression } from "../../../src/compression/index.js";
import { LocalDirBlobStore } from "../../../src/compression/local-blob-store.js";
import { policyFor } from "../../../src/interfaces/policy.js";
import { createGolemPipeline } from "../../../src/pipeline/index.js";
import {
  BREAKER_THRESHOLD,
  MAX_REASON_CHARS,
  type PluginStageRunOptions,
  pluginStageFaultCounts,
  resetPluginStageFaultsForTests,
  runPluginStage,
} from "../../../src/plugins/stage-runner.js";
import type { PluginPipelineStage } from "../../../src/plugins/types.js";
import type { ProxyRequest } from "../../../src/proxy/types.js";
import { setProxyLogForTesting } from "../../../src/shared/proxy-log.js";

afterEach(resetPluginStageFaultsForTests);

const stage = (name: string, transform: PluginPipelineStage["transform"]): PluginPipelineStage => ({
  name,
  description: "",
  transform,
});

function secretKey(): string {
  return `AKIA${"Q7ZK3XMPLE4DEMOZ".slice(0, 16)}`;
}

async function run(
  stages: PluginPipelineStage[],
  content: string,
  pluginStageRun?: PluginStageRunOptions,
) {
  const logs: string[] = [];
  const restore = setProxyLogForTesting({ sink: (l) => logs.push(l) });
  try {
    const pipeline = createGolemPipeline({
      compression: new NativeLosslessCompression(new LocalDirBlobStore("/nonexistent-ccr")),
      policy: () => policyFor(1),
      projectId: "proj",
      pluginStages: stages,
      ...(pluginStageRun !== undefined ? { pluginStageRun } : {}),
    });
    const req: ProxyRequest = {
      method: "POST",
      url: "/v1/messages",
      headers: { "content-type": "application/json" },
      body: Buffer.from(
        JSON.stringify({ model: "m", messages: [{ role: "user", content }] }),
        "utf8",
      ),
    };
    const out = await pipeline.process(req);
    const body = JSON.parse((out.body as Buffer).toString("utf8")) as {
      messages: { content: string }[];
    };
    return { text: body.messages[0]?.content ?? "", logs };
  } finally {
    restore();
  }
}

describe("runPluginStage", () => {
  it("restores the pre-stage body when a stage mutates in place and THEN throws", async () => {
    const body = { messages: [{ role: "user", content: "kept" }] };
    const out = await runPluginStage(
      stage("p/s", ({ body: b }) => {
        (b.messages as { content: string }[]).splice(0, 1, { content: "half-edited" });
        throw new Error("late failure");
      }),
      body,
      "proj",
    );
    expect(out.fault).toMatchObject({ kind: "threw", reason: "late failure", total: 1 });
    expect(out.body).toEqual({ messages: [{ role: "user", content: "kept" }] });
  });

  it("times out a stage that never settles and ignores its late writes", async () => {
    const body = { messages: [{ role: "user", content: "kept" }] };
    let captured: Record<string, unknown> | undefined;
    const out = await runPluginStage(
      stage("p/hang", ({ body: b }) => {
        captured = b;
        return new Promise<never>(() => {});
      }),
      body,
      "proj",
      { timeoutMs: 20 },
    );
    expect(out.fault).toMatchObject({ kind: "timed-out" });
    if (captured !== undefined) captured.injected = "late";
    expect(out.body).toEqual({ messages: [{ role: "user", content: "kept" }] });
  });

  it("counts faults per stage in this process", async () => {
    const bad = stage("p/bad", () => {
      throw new Error("x");
    });
    await runPluginStage(bad, {}, "proj");
    const second = await runPluginStage(bad, {}, "proj");
    expect(second.fault?.total).toBe(2);
    expect(pluginStageFaultCounts().get("p/bad")).toBe(2);
  });

  it("a clean stage records no fault", async () => {
    const out = await runPluginStage(
      stage("p/ok", () => undefined),
      {},
      "proj",
    );
    expect(out.fault).toBeNull();
    expect(pluginStageFaultCounts().size).toBe(0);
  });
});

describe("pipeline — a failing stage cannot undo built-in redaction", () => {
  it("keeps the redacted pre-stage body, and reports the skip", async () => {
    const key = secretKey();
    const { text, logs } = await run(
      [
        stage("p/boom", () => {
          throw new Error("kaboom");
        }),
      ],
      `key ${key} here`,
    );
    expect(text).not.toContain(key);
    expect(text).toMatch(/^key \S+ here$/);
    expect(text).toContain("REDACTED");
    expect(logs.join("")).toContain("plugin stage p/boom threw and was skipped (kaboom)");
    expect(logs.join("")).toContain("pre-stage body kept");
  });

  it("a stage that mutates in place to inject a secret and then throws leaves it out", async () => {
    const key = secretKey();
    const { text } = await run(
      [
        stage("p/inject", ({ body }) => {
          (body.messages as { content: string }[]).splice(0, 1, { content: `injected ${key}` });
          throw new Error("after mutating");
        }),
      ],
      "hello",
    );
    expect(text).toBe("hello");
  });

  it("later stages still run after one fails", async () => {
    const { text } = await run(
      [
        stage("p/boom", () => {
          throw new Error("x");
        }),
        stage("p/tag", ({ body }) => ({
          ...body,
          messages: [{ role: "user", content: "tagged" }],
        })),
      ],
      "hello",
    );
    expect(text).toBe("tagged");
  });
});

describe("runPluginStage — hostile thrown values", () => {
  const nullProto = (): never => {
    throw Object.create(null);
  };
  const badMessage = (): never => {
    const e = new Error("x");
    Object.defineProperty(e, "message", {
      get() {
        throw new TypeError("getter exploded");
      },
    });
    throw e;
  };

  it.each([
    ["Object.create(null)", nullProto],
    ["an Error whose message getter throws", badMessage],
  ])("a stage throwing %s is a fault, not an escape", async (_n, thrower) => {
    const out = await runPluginStage(stage("p/h", thrower), { a: 1 }, "proj");
    expect(out.fault?.kind).toBe("threw");
    expect(out.fault?.reason).toBe("(unprintable error)");
    expect(out.body).toEqual({ a: 1 });
  });

  it.each([
    ["Object.create(null)", nullProto],
    ["an Error whose message getter throws", badMessage],
  ])("the pipeline survives a stage throwing %s and keeps compression", async (_n, thrower) => {
    const { text } = await run([stage("p/h", thrower)], "hello");
    expect(text).toBe("hello");
  });

  it("truncates a long message and redacts a secret in it before it is stored", async () => {
    const key = secretKey();
    const out = await runPluginStage(
      stage("p/long", () => {
        throw new Error(`${key} ${"x".repeat(5000)}`);
      }),
      {},
      "proj",
    );
    expect(out.fault?.reason).not.toContain(key);
    expect((out.fault?.reason ?? "").length).toBeLessThanOrEqual(MAX_REASON_CHARS + 3);
  });

  it("the proxy log line carries the redacted, truncated reason", async () => {
    const key = secretKey();
    const { logs } = await run(
      [
        stage("p/leaky", () => {
          throw new Error(`${key} ${"y".repeat(5000)}`);
        }),
      ],
      "hello",
    );
    const line = logs.join("");
    expect(line).not.toContain(key);
    expect(line.length).toBeLessThan(MAX_REASON_CHARS + 300);
  });
});

describe("runPluginStage — a stage returning the string 'timeout' is not a timeout", () => {
  it("is just an ignored non-record result", async () => {
    const out = await runPluginStage(
      stage("p/str", () => "timeout" as unknown as Record<string, unknown>),
      {},
      "proj",
    );
    expect(out.fault).toBeNull();
  });
});

describe("circuit breaker for hung stages", () => {
  const hang = stage("p/hang", () => new Promise<never>(() => {}));

  it("disables a stage after N consecutive timeouts, then retries after the cool-off", async () => {
    let clock = 1_000;
    const opts: PluginStageRunOptions = {
      timeoutMs: 5,
      now: () => clock,
      breakerCoolOffMs: 60_000,
    };
    const results = [];
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      results.push(await runPluginStage(hang, {}, "proj", opts));
    }
    expect(results.map((r) => r.fault?.kind)).toEqual(["timed-out", "timed-out", "timed-out"]);
    expect(results[BREAKER_THRESHOLD - 1]?.fault?.tripped).toBe(true);
    expect(results[BREAKER_THRESHOLD - 1]?.fault?.reason).toContain(
      "disabled after repeated timeouts",
    );

    // During the cool-off the stage is not run at all (instant, no timeout wait).
    let ran = false;
    const probe = stage("p/hang", () => {
      ran = true;
      return undefined;
    });
    const skipped = await runPluginStage(probe, {}, "proj", opts);
    expect(skipped.fault?.kind).toBe("disabled");
    expect(ran).toBe(false);

    clock += 60_001;
    const after = await runPluginStage(probe, {}, "proj", opts);
    expect(after.fault).toBeNull();
    expect(ran).toBe(true);
  });

  it("a success in between resets the count", async () => {
    let hangNext = true;
    const flaky = stage("p/flaky", () => (hangNext ? new Promise<never>(() => {}) : undefined));
    const opts = { timeoutMs: 5 };
    await runPluginStage(flaky, {}, "proj", opts);
    await runPluginStage(flaky, {}, "proj", opts);
    hangNext = false;
    await runPluginStage(flaky, {}, "proj", opts);
    hangNext = true;
    await runPluginStage(flaky, {}, "proj", opts);
    const third = await runPluginStage(flaky, {}, "proj", opts);
    expect(third.fault?.tripped).toBeUndefined();
  });

  it("the pipeline applies an injected timeout and reports the breaker", async () => {
    const { text, logs } = await run([hang], "hello", { timeoutMs: 5 });
    expect(text).toBe("hello");
    expect(logs.join("")).toContain("timed out and was skipped");
    expect(logs.join("")).toContain("did not finish within 5ms");
  });
});

describe("redactForLog — redact the whole text, then truncate", () => {
  it("does not leak a key that straddles the old 3000-char cut", async () => {
    const { redactForLog } = await import("../../../src/plugins/safe-text.js");
    // A ~2.9k PEM block, built at runtime so no literal key sits in this file,
    // then a key that crosses offset 3000 of the original text.
    const dashes = "-".repeat(5);
    const body = Array.from({ length: 45 }, (_, i) =>
      Buffer.from(`line-${i}-`.repeat(6)).toString("base64"),
    ).join("\n");
    const pem = `${dashes}BEGIN RSA PRIVATE KEY${dashes}\n${body}\n${dashes}END RSA PRIVATE KEY${dashes}`;
    const pad = " ".repeat(Math.max(0, 2985 - pem.length));
    const key = `sk-ant-api03-${"Ab1".repeat(14)}`;
    const text = `${pem}${pad}${key} tail`;
    expect(text.indexOf(key)).toBeLessThan(3000);
    expect(text.indexOf(key) + key.length).toBeGreaterThan(3000);
    const out = redactForLog(text);
    expect(out).not.toContain("sk-ant");
    expect(out).not.toContain("Ab1Ab1");
    expect(out.length).toBeLessThanOrEqual(MAX_REASON_CHARS + 3);
  });

  it("drops a partial trailing token and omits oversized text", async () => {
    const { redactForLog } = await import("../../../src/plugins/safe-text.js");
    const out = redactForLog(`${"word ".repeat(59)}abcdefghijkl more`);
    expect(out.endsWith("...")).toBe(true);
    expect(out).not.toContain("abcdefghijkl");
    expect(redactForLog("z".repeat(70_000))).toBe("(70000 chars of error text omitted)");
  });
});

describe("circuit breaker — concurrency, generations and the clock", () => {
  const scripted = (name: string, plan: ("hang" | "ok")[]): PluginPipelineStage => {
    let i = 0;
    return stage(name, () => (plan[i++] === "hang" ? new Promise<never>(() => {}) : undefined));
  };

  it("three concurrent hung requests with no success in between trip it", async () => {
    const s = scripted("p/burst", ["hang", "hang", "hang"]);
    const r = await Promise.all(
      [0, 1, 2].map(() => runPluginStage(s, {}, "proj", { timeoutMs: 5 })),
    );
    expect(r.some((x) => x.fault?.tripped === true)).toBe(true);
  });

  it("does not trip when a request succeeded after the first timed-out one started", async () => {
    // Starts: hang, hang, ok (completes at once), hang. The success completes
    // after the first start, so the window is not unbroken.
    const s = scripted("p/mixed", ["hang", "hang", "ok", "hang"]);
    const r = await Promise.all(
      [0, 1, 2, 3].map(() => runPluginStage(s, {}, "proj", { timeoutMs: 10 })),
    );
    expect(r.some((x) => x.fault?.tripped === true)).toBe(false);
  });

  it("in-flight requests from before the trip cannot re-trip it after the cool-off", async () => {
    let clock = 0;
    const opts: PluginStageRunOptions = { timeoutMs: 5, now: () => clock, breakerCoolOffMs: 1_000 };
    const s = scripted("p/carry", Array(10).fill("hang"));
    // Five concurrent: the first three trip it, the other two were already in flight.
    const burst = await Promise.all([0, 1, 2, 3, 4].map(() => runPluginStage(s, {}, "proj", opts)));
    expect(burst.filter((x) => x.fault?.tripped === true)).toHaveLength(1);
    clock += 1_001;
    // One new timeout after the cool-off must NOT trip it (the two stragglers do not count).
    const next = await runPluginStage(s, {}, "proj", opts);
    expect(next.fault?.kind).toBe("timed-out");
    expect(next.fault?.tripped).toBeUndefined();
    // It takes a full fresh run of three to trip it again.
    await runPluginStage(s, {}, "proj", opts);
    const third = await runPluginStage(s, {}, "proj", opts);
    expect(third.fault?.tripped).toBe(true);
  });

  it("the default clock is monotonic: a wall-clock step forward does not end the cool-off early", async () => {
    const s = scripted("p/mono", Array(10).fill("hang"));
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await runPluginStage(s, {}, "proj", { timeoutMs: 5 });
    }
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_000);
    try {
      const skipped = await runPluginStage(s, {}, "proj", { timeoutMs: 5 });
      expect(skipped.fault?.kind).toBe("disabled");
    } finally {
      spy.mockRestore();
    }
  });
});
