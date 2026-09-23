/**
 * R14.3 — wire Golem's turn logic to the ACP protocol over stdio.
 *
 * **STDOUT IS PROTOCOL-ONLY.** `ndJsonStream` frames every JSON-RPC message on
 * `process.stdout`; a single stray `console.log` corrupts the stream and
 * `buzz-acp` reads garbage. This is the single most likely way to break this
 * feature, so `serveAcp` rebinds every `console.*` method to `process.stderr`
 * before anything else runs, and every handler below is written to write
 * nothing itself.
 *
 * **This process serves exactly ONE persona.** The persona id arrives once,
 * at spawn, via `--persona <id>` (`BUZZ_ACP_AGENT_ARGS=acp,--persona,coder`
 * splits on commas — see `src/cli/commands/buzz.ts`), and `buzz-acp` respawns
 * the same command+args on crash. So the session registry created here always
 * mints sessions for that one persona; there is no per-session persona
 * negotiation because ACP's `session/new` carries none.
 *
 * Handlers are kept deliberately minimal — `initialize` and `session/new`
 * report no optional capability, because R14.3 ships a bounded
 * single-shot conversational turn only (see [[Buzz Integration]] "Must not").
 */

import { Readable, Writable } from "node:stream";
import { format } from "node:util";
import { type AgentApp, agent, ndJsonStream, type Stream } from "@agentclientprotocol/sdk";
import { type AcpSession, createSessionRegistry, type SessionRegistry } from "./acp-session.js";
import { type RunAcpTurnDeps, runAcpTurn } from "./acp-turn.js";
import {
  extractPromptText,
  initializeParamsSchema,
  newSessionParamsSchema,
  promptParamsSchema,
} from "./types.js";

export interface GolemAcpAgentOptions {
  readonly projectDir: string;
  /** Bound at spawn via `--persona <id>` — never changes per-process. */
  readonly personaId: string;
  /**
   * Test-only seam: `runAcpTurn`'s own injectable deps (a fake `fetch`, a
   * fixed clock). `golem acp`'s real CLI entry point never sets this — real
   * turns always read real settings and dispatch for real.
   */
  readonly turnDeps?: RunAcpTurnDeps;
}

/**
 * Build the `AgentApp` with every handler wired, but do not connect it to a
 * transport. Tests use this directly with `app.connect(clientApp)` (an
 * in-process scripted-client connection, no real stdio) — see the task doc's
 * gate: "a scripted fake ACP client drives `golem acp` over stdio".
 */
export function createGolemAcpAgent(options: GolemAcpAgentOptions): AgentApp {
  const sessions: SessionRegistry = createSessionRegistry();
  // Sessions with a turn in flight that the client has asked to cancel. Under
  // `buzz-acp`'s default `steer` event handling a new @mention CANCELs the
  // turn already running, so this fires on a routine interaction, not just an
  // explicit `!cancel`. Cleared when the cancelled turn's handler resolves.
  const cancelled = new Set<string>();

  return agent({ name: "golem" })
    .onRequest("initialize", ({ params }) => {
      const parsed = initializeParamsSchema.parse(params);
      return { protocolVersion: parsed.protocolVersion, agentCapabilities: {} };
    })
    .onNotification("session/cancel", ({ params }) => {
      // The ACP spec requires the in-flight `session/prompt` to resolve with
      // stopReason "cancelled" and to stop surfacing updates. We cannot abort
      // the single dispatch already in flight without threading an abort
      // signal through the (shared) target dispatcher's own timeout controller
      // — a change disproportionate to this slice. So the model call runs to
      // its completion/timeout, but nothing it emits after this point reaches
      // the channel, and the turn reports `cancelled`. The bound is resources,
      // not correctness: a cancelled turn posts no stale reply.
      cancelled.add(params.sessionId);
    })
    .onRequest("session/new", ({ params }) => {
      const parsed = newSessionParamsSchema.parse(params);
      const session = sessions.create({
        cwd: parsed.cwd,
        mcpServers: parsed.mcpServers,
        personaId: options.personaId,
      });
      return { sessionId: session.id };
    })
    .onRequest("session/prompt", async ({ params, client }) => {
      const parsed = promptParamsSchema.parse(params);
      const session = sessions.get(parsed.sessionId);
      if (session === undefined) {
        throw new Error(
          `unknown ACP session "${parsed.sessionId}" — was it created via session/new?`,
        );
      }
      const promptText = extractPromptText(parsed.prompt);

      // `runAcpTurn`'s `emit`/`keepalive` are synchronous by contract (a turn
      // must not block on the transport to keep dispatching), but each chunk
      // becomes an async `client.notify(...)` call. Chain them so updates
      // reach the client in emission order, and await the chain before the
      // handler resolves — a `session/prompt` response arriving before its
      // own last chunk would be a client-visible ordering bug.
      const wasCancelled = (): boolean => cancelled.has(session.id);
      let chain: Promise<void> = Promise.resolve();
      const emit = (text: string): void => {
        if (text === "" || wasCancelled()) return; // drop chunks for a cancelled turn
        chain = chain.then(() =>
          client.notify("session/update", {
            sessionId: session.id,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
          }),
        );
      };
      // A distinct update kind (`agent_thought_chunk`, not `agent_message_chunk`)
      // so a keepalive during a rate-limit retry wait produces real stdout
      // activity — resetting `BUZZ_ACP_IDLE_TIMEOUT` — without ever becoming
      // part of the reply's visible text.
      const keepalive = (): void => {
        if (wasCancelled()) return;
        chain = chain.then(() =>
          client.notify("session/update", {
            sessionId: session.id,
            update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "…" } },
          }),
        );
      };

      try {
        const result = await runAcpTurn({
          projectDir: options.projectDir,
          personaId: session.personaId,
          promptText,
          emit,
          keepalive,
          ...(options.turnDeps !== undefined ? { deps: options.turnDeps } : {}),
        });
        await chain;
        return { stopReason: wasCancelled() ? "cancelled" : result.stopReason };
      } finally {
        cancelled.delete(session.id);
      }
    });
}

/** Adapt Node's `process.stdin`/`process.stdout` to the web streams `ndJsonStream` wants. */
function stdioStream(): Stream {
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  return ndJsonStream(output, input);
}

/**
 * Redirect every `console.*` call to stderr. Called once, before the agent
 * connects to stdio — anything logged after this point (including by a
 * dependency this module did not write) lands on stderr, never stdout.
 *
 * `util.format` (what Node's own console uses) rather than `JSON.stringify`:
 * this is the logger that runs *while things are going wrong*, and the SDK
 * calls `console.error("...", error)` — `JSON.stringify` renders an `Error` as
 * `{}` (losing the message the line exists to carry) and throws outright on a
 * circular object or a `BigInt`, which would make the logger itself the crash.
 * Still wrapped in a `try` so a pathological arg can never take the process
 * down from inside its own error handler.
 */
function redirectConsoleToStderr(): void {
  const write = (...args: readonly unknown[]): void => {
    let line: string;
    try {
      line = format(...args);
    } catch {
      line = "[golem acp: log line was unformattable]";
    }
    try {
      process.stderr.write(`${line}\n`);
    } catch {
      // stderr itself is not writable — there is nowhere left to report to,
      // and throwing from a logger is the one thing it must never do.
    }
  };
  console.log = write;
  console.info = write;
  console.warn = write;
  console.error = write;
  console.debug = write;
}

/**
 * Serve `golem acp` over real stdio until the connection closes (the client
 * disconnects, or the process is killed). Returns an exit code — 0 on a clean
 * close. This is what `golem acp`'s CLI action calls; nothing else should.
 */
export async function serveAcp(options: GolemAcpAgentOptions): Promise<number> {
  redirectConsoleToStderr();
  const app = createGolemAcpAgent(options);
  const connection = app.connect(stdioStream());
  await connection.closed;
  return 0;
}

/** For a scripted-client test that already has an `AcpSession` object in hand. */
export type { AcpSession };
