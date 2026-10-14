/**
 * DUST2.11 — a failing plugin stage is skipped, the PRE-STAGE body is kept, and
 * the fault is recorded. The pre-stage body has already been through built-in
 * redaction (stage 1 runs before stage 1.7), so keeping it keeps redaction.
 */

import { afterEach, describe, expect, it } from "vitest";
import { NativeLosslessCompression } from "../../../src/compression/index.js";
import { LocalDirBlobStore } from "../../../src/compression/local-blob-store.js";
import { policyFor } from "../../../src/interfaces/policy.js";
import { createGolemPipeline } from "../../../src/pipeline/index.js";
import {
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

async function run(stages: PluginPipelineStage[], content: string) {
  const logs: string[] = [];
  const restore = setProxyLogForTesting({ sink: (l) => logs.push(l) });
  try {
    const pipeline = createGolemPipeline({
      compression: new NativeLosslessCompression(new LocalDirBlobStore("/nonexistent-ccr")),
      policy: () => policyFor(1),
      projectId: "proj",
      pluginStages: stages,
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
      20,
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
