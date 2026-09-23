/**
 * R14.3 gate, Stage 1: a scripted fake ACP client drives `golem acp` through
 * `initialize` -> `session/new` -> `session/prompt`, in-process (no real
 * stdio — `clientApp.connect(agentApp)` gives a direct connection, exercising
 * the exact same handler code `serveAcp` wires to real stdin/stdout), and gets
 * back streamed `session/update` notifications plus a `stopReason`, with the
 * turn having run Golem's real pipeline (real `runAcpTurn`, real
 * `resolvePersonaLane`, real `resolvePersonaPrompt` — only the network
 * `fetch` and the project/user config dirs are faked, via the seams
 * `acp-agent.ts`/`acp-turn.ts` expose for exactly this).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { client } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { createGolemAcpAgent } from "../../../src/buzz/acp-agent.js";
import type { RunAcpTurnDeps } from "../../../src/buzz/acp-turn.js";
import { useTempDirs } from "../../helpers/tmp.js";

interface Fixture {
  readonly projectDir: string;
  readonly userDir: string;
}

const newTempDir = useTempDirs("golem-acp");

async function makeFixture(settingsJson: Record<string, unknown>): Promise<Fixture> {
  const base = await newTempDir();
  const projectDir = path.join(base, "project");
  const userDir = path.join(base, "user");
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
  await mkdir(userDir, { recursive: true });
  await writeFile(
    path.join(projectDir, ".golem", "settings.json"),
    JSON.stringify(settingsJson, null, 2),
  );
  return { projectDir, userDir };
}

/**
 * A worker-lane persona: `model` resolves against a configured registry
 * target. The target's gateway is Anthropic-shaped (not a translating
 * OpenAI-shaped provider) so it can share one fake `fetch` response shape
 * (`{content: [...]}`) with the agent-lane harness-default path below —
 * distinguishing worker vs. agent lane here is the persona's `model`, not the
 * transport, and both dispatch through the same `dispatchAnthropic`.
 */
function workerLaneSettings(): Record<string, unknown> {
  return {
    proxy: {
      upstream_provider: "anthropic",
      upstream_base_url: "https://api.anthropic.com",
      gateways: [
        { id: "vendorgw", provider: "anthropic", base_url: "https://api.example.invalid" },
      ],
      targets: [
        { id: "cheap", gateway: "vendorgw", model: { name: "cheap-sonnet" }, trust: "vendor" },
      ],
    },
    inference: { personas: { echo: { model: "cheap" } } },
  };
}

/** An agent-lane persona: `model` is a bare id naming no target. */
function agentLaneSettings(): Record<string, unknown> {
  return {
    proxy: { upstream_provider: "anthropic", upstream_base_url: "https://api.anthropic.com" },
    inference: { personas: { echo: { model: "claude-sonnet-5" } } },
  };
}

function fakeFetch(replyText: string): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    return new Response(
      JSON.stringify({
        model: parsed.model ?? "unknown",
        content: [{ type: "text", text: replyText }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

describe("golem acp — scripted ACP client (Stage 1 gate)", () => {
  it("completes initialize -> session/new -> session/prompt, streaming updates and a stopReason", async () => {
    const fixture = await makeFixture(workerLaneSettings());
    const turnDeps: RunAcpTurnDeps = {
      userDir: fixture.userDir,
      dispatcherOverrides: {
        fetchImpl: fakeFetch("hello back"),
        env: {},
        resolveKey: () => "fake-key",
      },
    };
    const agentApp = createGolemAcpAgent({
      projectDir: fixture.projectDir,
      personaId: "echo",
      turnDeps,
    });

    const updates: unknown[] = [];
    const clientApp = client({ name: "test-client" }).onNotification(
      "session/update",
      ({ params }) => {
        updates.push(params);
      },
    );

    const connection = clientApp.connect(agentApp);
    try {
      const initResult = await connection.agent.request("initialize", { protocolVersion: 1 });
      expect(initResult.protocolVersion).toBe(1);

      const newSession = await connection.agent.request("session/new", {
        cwd: fixture.projectDir,
        mcpServers: [],
      });
      expect(typeof newSession.sessionId).toBe("string");

      const promptResult = await connection.agent.request("session/prompt", {
        sessionId: newSession.sessionId,
        prompt: [{ type: "text", text: "hi there" }],
      });

      expect(promptResult.stopReason).toBe("end_turn");
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({
        sessionId: newSession.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello back" },
        },
      });
    } finally {
      connection.close();
    }
  });

  it("MUST HANDLE: a rate-limited dispatch inside the retry budget retries and completes", async () => {
    const fixture = await makeFixture(workerLaneSettings());
    let calls = 0;
    const flakyFetch: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
      }
      const parsed = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      return new Response(
        JSON.stringify({ model: parsed.model, content: [{ type: "text", text: "recovered" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const turnDeps: RunAcpTurnDeps = {
      userDir: fixture.userDir,
      dispatcherOverrides: { fetchImpl: flakyFetch, env: {}, resolveKey: () => "fake-key" },
    };
    const agentApp = createGolemAcpAgent({
      projectDir: fixture.projectDir,
      personaId: "echo",
      turnDeps,
    });
    const updates: unknown[] = [];
    const clientApp = client({ name: "test-client" }).onNotification(
      "session/update",
      ({ params }) => {
        updates.push(params);
      },
    );
    const connection = clientApp.connect(agentApp);
    try {
      await connection.agent.request("initialize", { protocolVersion: 1 });
      const newSession = await connection.agent.request("session/new", {
        cwd: fixture.projectDir,
        mcpServers: [],
      });
      const promptResult = await connection.agent.request("session/prompt", {
        sessionId: newSession.sessionId,
        prompt: [{ type: "text", text: "hi" }],
      });
      expect(promptResult.stopReason).toBe("end_turn");
      expect(calls).toBe(2); // one 429, one success — never blocked, never crashed
      const finalChunk = updates.at(-1) as { update: { content: { text: string } } };
      expect(finalChunk.update.content.text).toBe("recovered");
    } finally {
      connection.close();
    }
  });

  it("MUST HANDLE: a rate limit OUTSIDE the retry budget defers, posts one message, and ends the turn", async () => {
    const fixture = await makeFixture(workerLaneSettings());
    let calls = 0;
    const alwaysLimited: typeof fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 429, headers: { "retry-after": "3600" } });
    }) as unknown as typeof fetch;

    const posted: string[] = [];
    const deferred: unknown[] = [];
    const turnDeps: RunAcpTurnDeps = {
      userDir: fixture.userDir,
      dispatcherOverrides: { fetchImpl: alwaysLimited, env: {}, resolveKey: () => "fake-key" },
      postChannelMessage: async (text) => {
        posted.push(text);
      },
      recordDeferred: async (info) => {
        deferred.push(info);
      },
    };
    const agentApp = createGolemAcpAgent({
      projectDir: fixture.projectDir,
      personaId: "echo",
      turnDeps,
    });
    const clientApp = client({ name: "test-client" }).onNotification("session/update", () => {});
    const connection = clientApp.connect(agentApp);
    try {
      await connection.agent.request("initialize", { protocolVersion: 1 });
      const newSession = await connection.agent.request("session/new", {
        cwd: fixture.projectDir,
        mcpServers: [],
      });
      const promptResult = await connection.agent.request("session/prompt", {
        sessionId: newSession.sessionId,
        prompt: [{ type: "text", text: "hi" }],
      });

      expect(promptResult.stopReason).toBe("end_turn"); // never refusal/max_tokens/max_turn_requests
      expect(calls).toBeGreaterThan(0);
      expect(posted).toHaveLength(1); // exactly one channel message
      expect(deferred).toHaveLength(1);
    } finally {
      connection.close();
    }
  });

  it("honours session/cancel: a cancelled turn posts no stale reply and returns stopReason cancelled", async () => {
    // Under buzz-acp's default `steer` handling a new @mention cancels the
    // turn in flight, so `session/cancel` fires mid-turn routinely — the
    // cancelled turn must NOT surface its (now stale) reply.
    const fixture = await makeFixture(workerLaneSettings());
    let fetchStarted: () => void = () => {};
    const started = new Promise<void>((res) => {
      fetchStarted = res;
    });
    let resolveFetch: (v: Response) => void = () => {};
    const willResolve = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    const hangingFetch: typeof fetch = (async () => {
      fetchStarted();
      return willResolve;
    }) as unknown as typeof fetch;

    const turnDeps: RunAcpTurnDeps = {
      userDir: fixture.userDir,
      dispatcherOverrides: { fetchImpl: hangingFetch, env: {}, resolveKey: () => "fake-key" },
    };
    const agentApp = createGolemAcpAgent({
      projectDir: fixture.projectDir,
      personaId: "echo",
      turnDeps,
    });
    const updates: unknown[] = [];
    const clientApp = client({ name: "test-client" }).onNotification(
      "session/update",
      ({ params }) => {
        updates.push(params);
      },
    );
    const connection = clientApp.connect(agentApp);
    try {
      await connection.agent.request("initialize", { protocolVersion: 1 });
      const newSession = await connection.agent.request("session/new", {
        cwd: fixture.projectDir,
        mcpServers: [],
      });

      // Start a turn; do NOT await — its dispatch is hanging on fetch.
      const promptPromise = connection.agent.request("session/prompt", {
        sessionId: newSession.sessionId,
        prompt: [{ type: "text", text: "hi" }],
      });
      await started; // the turn has reached the hanging dispatch
      await connection.agent.notify("session/cancel", { sessionId: newSession.sessionId });
      // One macrotask turn so the agent's reader processes the cancel before
      // the reply is allowed to arrive — the emit-drop must be visible to it.
      await new Promise((r) => setTimeout(r, 0));

      resolveFetch(
        new Response(JSON.stringify({ content: [{ type: "text", text: "stale reply" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const promptResult = await promptPromise;

      expect(promptResult.stopReason).toBe("cancelled");
      expect(updates).toHaveLength(0); // the post-cancel reply never surfaced
    } finally {
      connection.close();
    }
  });
});

describe("R14.3 lane transparency — worker vs agent lane, same turn shape", () => {
  async function runOneTurn(settingsJson: Record<string, unknown>): Promise<{
    stopReason: string;
    sentModel: string | undefined;
    replyText: string;
  }> {
    const fixture = await makeFixture(settingsJson);
    let sentModel: string | undefined;
    const fetchImpl: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      sentModel = parsed.model;
      return new Response(
        JSON.stringify({ model: parsed.model, content: [{ type: "text", text: "same shape" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const turnDeps: RunAcpTurnDeps = {
      userDir: fixture.userDir,
      dispatcherOverrides: { fetchImpl, env: {}, resolveKey: () => "fake-key" },
    };
    const agentApp = createGolemAcpAgent({
      projectDir: fixture.projectDir,
      personaId: "echo",
      turnDeps,
    });
    const updates: unknown[] = [];
    const clientApp = client({ name: "test-client" }).onNotification(
      "session/update",
      ({ params }) => {
        updates.push(params);
      },
    );
    const connection = clientApp.connect(agentApp);
    try {
      await connection.agent.request("initialize", { protocolVersion: 1 });
      const newSession = await connection.agent.request("session/new", {
        cwd: fixture.projectDir,
        mcpServers: [],
      });
      const promptResult = await connection.agent.request("session/prompt", {
        sessionId: newSession.sessionId,
        prompt: [{ type: "text", text: "hi" }],
      });
      const chunk = updates[0] as { update: { content: { text: string } } };
      return {
        stopReason: promptResult.stopReason,
        sentModel,
        replyText: chunk.update.content.text,
      };
    } finally {
      connection.close();
    }
  }

  it("a worker-lane persona and an agent-lane persona produce the identical turn shape", async () => {
    const workerResult = await runOneTurn(workerLaneSettings());
    const agentResult = await runOneTurn(agentLaneSettings());

    expect(workerResult.stopReason).toBe("end_turn");
    expect(agentResult.stopReason).toBe("end_turn");
    expect(workerResult.replyText).toBe("same shape");
    expect(agentResult.replyText).toBe("same shape");
    // The dispatch TARGET differs (a registry target's own model vs. an
    // explicit override), but the turn's identity and framing do not.
    expect(workerResult.sentModel).toBe("cheap-sonnet");
    expect(agentResult.sentModel).toBe("claude-sonnet-5");
  });

  it("flipping a persona's model between lanes changes only the dispatch target", async () => {
    const asWorker = await runOneTurn(workerLaneSettings());
    const asAgent = await runOneTurn(agentLaneSettings());
    expect(asWorker.stopReason).toBe(asAgent.stopReason);
    expect(asWorker.replyText).toBe(asAgent.replyText);
    expect(asWorker.sentModel).not.toBe(asAgent.sentModel);
  });
});
