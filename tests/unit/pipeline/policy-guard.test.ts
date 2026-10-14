/**
 * DUST2.23 probe 2 — a caller-built policy cannot turn redaction off.
 *
 * tsc rejects `redaction: false`; these tests cover what tsc cannot see (a cast).
 * The pipeline must THROW for such a policy, never obey it, and a throw must not
 * be able to cause a raw forward (the proxy half is in
 * tests/integration/proxy-no-redaction-off-doors.test.ts).
 */

import { describe, expect, it } from "vitest";
import { NativeLosslessCompression } from "../../../src/compression/index.js";
import { type PipelinePolicy, policyFor } from "../../../src/interfaces/policy.js";
import { createGolemPipeline } from "../../../src/pipeline/index.js";
import { assertRedactionOn, RedactionPolicyError } from "../../../src/pipeline/policy-guard.js";
import type { ProxyRequest } from "../../../src/proxy/types.js";
import { useTempDirs } from "../../helpers/tmp.js";

const SECRET = `AKIA${"IOSFODNN7"}${"EXAMPLE"}`;
const newTempDir = useTempDirs("golem-policy-guard-");

/** What a caller who ignores the type system can build. */
const redactionOffPolicy = (): PipelinePolicy =>
  ({
    ...policyFor(1),
    stages: { ...policyFor(1).stages, redaction: false },
  }) as unknown as PipelinePolicy;

function req(path: string, body: string): ProxyRequest {
  return {
    method: "POST",
    path,
    headers: { "content-type": "application/json" },
    body: Buffer.from(body, "utf8"),
  } as unknown as ProxyRequest;
}
const messages = (): string =>
  JSON.stringify({ model: "m", messages: [{ role: "user", content: `key ${SECRET}` }] });

describe("assertRedactionOn", () => {
  it("returns a real policy untouched", () => {
    const p = policyFor(2);
    expect(assertRedactionOn(p)).toBe(p);
  });

  it.each([false, undefined, null, 0, "true", 1])("rejects redaction=%s", (v) => {
    const bad = { ...policyFor(1), stages: { ...policyFor(1).stages, redaction: v } };
    expect(() => assertRedactionOn(bad as unknown as PipelinePolicy)).toThrow(RedactionPolicyError);
  });

  it("rejects a policy with no stages at all", () => {
    expect(() => assertRedactionOn({} as unknown as PipelinePolicy)).toThrow(RedactionPolicyError);
  });
});

describe("pipeline with a redaction-off policy", () => {
  async function pipeline(policy: () => PipelinePolicy) {
    const dir = await newTempDir();
    return createGolemPipeline({
      compression: NativeLosslessCompression.forProjectDir(dir),
      policy,
      projectId: dir,
    });
  }

  it("process() throws on a Messages request instead of forwarding it raw", async () => {
    const p = await pipeline(redactionOffPolicy);
    await expect(p.process(req("/v1/messages", messages()))).rejects.toBeInstanceOf(
      RedactionPolicyError,
    );
  });

  it("process() throws on a non-Messages request too (the old `: input` branch)", async () => {
    const p = await pipeline(redactionOffPolicy);
    await expect(
      p.process(req("/v1/messages/count_tokens", JSON.stringify({ note: SECRET }))),
    ).rejects.toBeInstanceOf(RedactionPolicyError);
  });

  it("redactOnly() ignores the policy and always redacts: the fail-closed fallback", async () => {
    const p = await pipeline(redactionOffPolicy);
    const out = p.redactOnly?.(req("/v1/messages", messages()));
    expect(out?.body?.toString("utf8")).not.toContain(SECRET);
    expect(out?.body?.toString("utf8")).toContain("[REDACTED:aws-key:1]");
  });

  it("a valid policy is unaffected", async () => {
    const p = await pipeline(() => policyFor(1));
    const out = await p.process(req("/v1/messages", messages()));
    expect(out.body?.toString("utf8")).not.toContain(SECRET);
  });
});
