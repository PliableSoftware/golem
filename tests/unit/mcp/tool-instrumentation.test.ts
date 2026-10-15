/** DUST3.10 h5: `snooze` and coder's backend-unavailable path record a tool event. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import {
  CapabilityUnavailableError,
  HardwareTier,
  type InferenceService,
} from "../../../src/interfaces/index.js";
import { registerCoderTool } from "../../../src/mcp/coder-tools.js";
import { registerSnoozeTool } from "../../../src/mcp/devices-snooze.js";
import type { ToolTelemetry } from "../../../src/mcp/shared.js";
import type { TelemetryEvent, TelemetryStore } from "../../../src/telemetry/index.js";

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;

function fakeServer(): { server: McpServer; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _cfg: unknown, h: Handler) => {
      handlers.set(name, h);
    },
  } as unknown as McpServer;
  return { server, handlers };
}

function fakeTel(): { tel: ToolTelemetry; events: TelemetryEvent[] } {
  const events: TelemetryEvent[] = [];
  const store = {
    record: (e: TelemetryEvent) => {
      events.push(e);
      return Promise.resolve();
    },
  } as unknown as TelemetryStore;
  return { tel: { store, projectId: "p" }, events };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("snooze telemetry", () => {
  const extra = { signal: new AbortController().signal, sendNotification: async () => {} };

  it("records a tool event for a completed snooze", async () => {
    const { server, handlers } = fakeServer();
    const { tel, events } = fakeTel();
    registerSnoozeTool(server, {} as never, tel);
    await handlers.get("snooze")?.({ duration_ms: 1 }, extra);
    await tick();
    expect(events.map((e) => e.tool)).toEqual(["snooze"]);
  });

  it("records a tool event for a rejected input too", async () => {
    const { server, handlers } = fakeServer();
    const { tel, events } = fakeTel();
    registerSnoozeTool(server, {} as never, tel);
    await handlers.get("snooze")?.({ until: "not-a-date" }, extra);
    await tick();
    expect(events.map((e) => e.tool)).toEqual(["snooze"]);
  });
});

describe("coder backend-unavailable telemetry", () => {
  it("records a tool event when the backend is unavailable", async () => {
    const inference = {
      chat: () => Promise.reject(new CapabilityUnavailableError("drafter", HardwareTier.PMid)),
      embed: () => Promise.reject(new Error("unused")),
      capabilities: () => HardwareTier.PMid,
    } as unknown as InferenceService;
    const { server, handlers } = fakeServer();
    const { tel, events } = fakeTel();
    registerCoderTool(server, inference, { defaultProjectId: "p" }, tel);
    const out = (await handlers.get("coder")?.({ task: "write a thing" }, {})) as {
      isError?: boolean;
    };
    await tick();
    expect(out.isError).toBe(true);
    expect(events.map((e) => e.tool)).toEqual(["coder"]);
  });
});
