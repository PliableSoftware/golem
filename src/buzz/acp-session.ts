/**
 * R14.3 — the ACP session registry.
 *
 * A `session/new` mints one; it outlives a turn (a channel/thread may carry
 * many `session/prompt` calls against the same `sessionId`), and `buzz-acp`
 * may `!rotate` it away underneath us at any point — so this is a plain
 * in-memory map, not a durable store. Nothing here survives a process
 * restart, and nothing needs to: `buzz-acp` respawns the agent and the client
 * calls `session/new` again.
 */

import crypto from "node:crypto";
import type { DispatchMessage } from "../inference/target-dispatcher.js";
import type { McpServerInput } from "./types.js";

export interface AcpSession {
  readonly id: string;
  readonly cwd: string;
  readonly mcpServers: readonly McpServerInput[];
  /** From `BUZZ_ACP_AGENT_ARGS=acp,--persona,<id>` — bound at process spawn, never changes. */
  readonly personaId: string;
  /** Prior turns, oldest first — threaded into `DispatchRequest.attempts` by `acp-turn.ts`. */
  history: DispatchMessage[];
}

export interface CreateSessionInput {
  readonly cwd: string;
  readonly mcpServers: readonly McpServerInput[];
  readonly personaId: string;
}

export interface SessionRegistry {
  create(input: CreateSessionInput): AcpSession;
  get(id: string): AcpSession | undefined;
  delete(id: string): void;
}

export interface SessionRegistryOptions {
  /** Injectable for deterministic recorded-shape tests. */
  readonly newId?: () => string;
}

export function createSessionRegistry(options: SessionRegistryOptions = {}): SessionRegistry {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const sessions = new Map<string, AcpSession>();

  return {
    create(input) {
      const session: AcpSession = {
        id: newId(),
        cwd: input.cwd,
        mcpServers: input.mcpServers,
        personaId: input.personaId,
        history: [],
      };
      sessions.set(session.id, session);
      return session;
    },
    get(id) {
      return sessions.get(id);
    },
    delete(id) {
      sessions.delete(id);
    },
  };
}
