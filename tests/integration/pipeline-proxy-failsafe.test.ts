/**
 * DUSTSEC.1 — a throw anywhere inside `pipeline.process()` must never forward the
 * raw body. The proxy re-runs redaction alone on the original request and
 * forwards THAT; if redaction itself throws it answers 5xx and forwards nothing.
 *
 * Each case below throws from one named site and asserts on the bytes the
 * upstream actually received: the placeholder, never the secret.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const boom = vi.hoisted(() => ({
  substitute: false,
  brevity: false,
  ledger: false,
}));

vi.mock("../../src/compression/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/compression/index.js")>();
  return {
    ...actual,
    substituteKnownContent: (...args: Parameters<typeof actual.substituteKnownContent>) => {
      if (boom.substitute) return Promise.reject(new Error("substitute boom"));
      return actual.substituteKnownContent(...args);
    },
  };
});
vi.mock("../../src/pipeline/brevity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/pipeline/brevity.js")>();
  return {
    ...actual,
    applyBrevity: (...args: Parameters<typeof actual.applyBrevity>) => {
      if (boom.brevity) throw new Error("brevity boom");
      return actual.applyBrevity(...args);
    },
  };
});
vi.mock("../../src/proxy/context-ledger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/proxy/context-ledger.js")>();
  return {
    ...actual,
    buildContextLedger: (...args: Parameters<typeof actual.buildContextLedger>) => {
      if (boom.ledger) throw new Error("ledger boom");
      return actual.buildContextLedger(...args);
    },
  };
});

import type { ServerResponse } from "node:http";
import { createPipelineEventRecorder } from "../../src/cli/proxy-build/telemetry-hooks.js";
import { NativeLosslessCompression } from "../../src/compression/index.js";
import { type CompressionLevel, policyFor } from "../../src/interfaces/policy.js";
import { createGolemPipeline } from "../../src/pipeline/index.js";
import type { RequestPipeline } from "../../src/proxy/types.js";
import { SessionTreeRecorder } from "../../src/session/session-tree.js";
import type { TelemetryStore } from "../../src/telemetry/types.js";
import { useTempDirs } from "../helpers/tmp.js";
import { rawRequest, startProxy, startUpstream } from "./helpers/test-servers.js";

// Assembled at runtime so no literal key sits in the source.
const SECRET = `AKIA${"IOSFODNN7"}${"EXAMPLE"}`;
const PLACEHOLDER = "[REDACTED:aws-key:1]";

const newTempDir = useTempDirs("golem-failsafe-");
let projectDir: string;

beforeEach(async () => {
  projectDir = await newTempDir();
  boom.substitute = false;
  boom.brevity = false;
  boom.ledger = false;
});

function recordingUpstream() {
  const received = { body: "", hits: 0 };
  return {
    received,
    handler: (_req: unknown, res: ServerResponse, body: Buffer): void => {
      received.hits += 1;
      received.body = body.toString("utf8");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    },
  };
}

const requestBody = (): string =>
  JSON.stringify({
    model: { name: "claude-x" },
    messages: [{ role: "user", content: `my key is ${SECRET}` }],
  });

async function send(
  pipeline: RequestPipeline,
  onPipelineError?: (err: unknown) => void,
): Promise<{ status: number; upstream: { body: string; hits: number } }> {
  const up = recordingUpstream();
  const upstream = await startUpstream(up.handler);
  const proxy = await startProxy({
    upstreamBaseUrl: upstream.origin,
    pipeline,
    ...(onPipelineError !== undefined ? { onPipelineError } : {}),
  });
  try {
    const res = await rawRequest(proxy.origin, "/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody(),
    });
    return { status: res.status, upstream: up.received };
  } finally {
    await proxy.close();
    await upstream.close();
  }
}

function build(
  level: CompressionLevel,
  overrides: Partial<Parameters<typeof createGolemPipeline>[0]> = {},
  brevity?: "lite",
): RequestPipeline {
  return createGolemPipeline({
    compression: NativeLosslessCompression.forProjectDir(projectDir),
    policy: () => policyFor(level, brevity !== undefined ? { brevity } : {}),
    projectId: projectDir,
    ...overrides,
  });
}

function expectRedactedForward(r: { status: number; upstream: { body: string; hits: number } }) {
  expect(r.status).toBe(200);
  expect(r.upstream.hits).toBe(1);
  expect(r.upstream.body).not.toContain(SECRET);
  expect(r.upstream.body).toContain(PLACEHOLDER);
}

describe("pipeline error: redact then forward", () => {
  it("compression.compress rejecting (e.g. a failed CCR blob write)", async () => {
    const real = NativeLosslessCompression.forProjectDir(projectDir);
    const errors: unknown[] = [];
    const r = await send(
      build(1, {
        compression: {
          ...real,
          compress: () => Promise.reject(new Error("ENOSPC: no space left on device")),
        } as never,
      }),
      (e) => errors.push(e),
    );
    expectRedactedForward(r);
    expect(errors).toHaveLength(1);
  });

  it("policy() throwing", async () => {
    const r = await send(
      build(1, {
        policy: () => Promise.reject(new Error("policy boom")),
      }),
    );
    expectRedactedForward(r);
  });

  it("onEvent throwing", async () => {
    const r = await send(
      build(1, {
        onEvent: () => {
          throw new Error("onEvent boom");
        },
      }),
    );
    expectRedactedForward(r);
  });

  it("sessionRecorder.snapshot() throwing inside the real onEvent recorder", async () => {
    const sessionRecorder = new SessionTreeRecorder();
    sessionRecorder.snapshot = (): never => {
      throw new Error("snapshot boom");
    };
    const onEvent = createPipelineEventRecorder({
      dir: projectDir,
      telemetry: {} as TelemetryStore,
      sessionRecorder,
    });
    const r = await send(build(1, { onEvent }));
    expectRedactedForward(r);
  });

  it("substituteKnownContent throwing", async () => {
    boom.substitute = true;
    const r = await send(
      build(2, {
        assumeCachingUpstream: false,
        contextSubstitution: {
          ccrStore: {} as never,
          lookup: () => () => undefined,
        },
      }),
    );
    expectRedactedForward(r);
  });

  it("applyBrevity throwing", async () => {
    boom.brevity = true;
    const r = await send(build(1, {}, "lite"));
    expectRedactedForward(r);
  });

  it("buildContextLedger throwing", async () => {
    boom.ledger = true;
    const r = await send(build(1));
    expectRedactedForward(r);
  });
});

describe("redaction itself failing: fail closed", () => {
  it("a throwing redactOnly answers 5xx and forwards nothing", async () => {
    const errors: unknown[] = [];
    const r = await send(
      {
        name: "exploding",
        process: () => Promise.reject(new Error("boom")),
        redactOnly: () => {
          throw new Error("redaction boom");
        },
      },
      (e) => errors.push(e),
    );
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.upstream.hits).toBe(0);
    expect(r.upstream.body).toBe("");
    expect(errors).toHaveLength(1);
  });

  it("a pipeline with no redaction-only entry point also fails closed", async () => {
    const r = await send({ name: "exploding", process: () => Promise.reject(new Error("boom")) });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.upstream.hits).toBe(0);
  });
});
