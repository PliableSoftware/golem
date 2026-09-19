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
import { type AgentApp, agent, ndJsonStream, type Stream } from "@agentclientprotocol/sdk";
import { type AcpSession, createSessionRegistry, type SessionRegistry } from "./acp-session.js";
import { runAcpTurn } from "./acp-turn.js";
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
}

/**
 * Build the `AgentApp` with every handler wired, but do not connect it to a
 * transport. Tests use this directly with `app.connect(clientApp)` (an
 * in-process scripted-client connection, no real stdio) — see the task doc's
 * gate: "a scripted fake ACP client drives `golem acp` over stdio".
 */
export function createGolemAcpAgent(options: GolemAcpAgentOptions): AgentApp {
  const sessions: SessionRegistry = createSessionRegistry();

  return agent({ name: "golem" })
    .onRequest("initialize", ({ params }) => {
      const parsed = initializeParamsSchema.parse(params);
      return { protocolVersion: parsed.protocolVersion, agentCapabilities: {} };
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

      // `runAcpTurn`'s `emit` is synchronous by contract (a turn must not
      // block on the transport to keep dispatching), but each chunk becomes
      // an async `client.sessionUpdate(...)` call. Chain them so updates are
      // sent to the client in emission order, and await the chain before the
      // handler resolves — a `session/prompt` response arriving before its
      // own last chunk would be a client-visible ordering bug.
      let chain: Promise<void> = Promise.resolve();
      const emit = (text: string): void => {
        if (text === "") return; // an empty keepalive chunk carries nothing to show
        chain = chain.then(() =>
          client.notify("session/update", {
            sessionId: session.id,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
          }),
        );
      };

      const result = await runAcpTurn({
        projectDir: options.projectDir,
        personaId: session.personaId,
        promptText,
        emit,
      });
      await chain;
      return { stopReason: result.stopReason };
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
 */
function redirectConsoleToStderr(): void {
  const write = (...args: readonly unknown[]): void => {
    process.stderr.write(
      `${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`,
    );
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
