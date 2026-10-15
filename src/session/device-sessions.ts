/**
 * R13.8 — start and continue a conversation FROM THE DEVICE.
 *
 * Mounted alongside `sessionTransportHandler` (R13.5) behind R13.4's write
 * server: that transport already knows how to carry an EXISTING session's
 * chat/stream/message/history once one exists. This module is what makes one
 * exist in the first place, from a device that has never seen a terminal —
 * project list, start, resume, and paged scrollback.
 *
 * ## Identity (task item 5 — "one conversation, one identity")
 *
 * `host-registry.ts`'s own `id` is free-form — historically a random UUID
 * chosen before any message existed. For a device-originated conversation
 * this module instead sets that same `id` to
 * `conversationIdFor({ messages: [{ role: "user", content: firstMessage }] })`
 * — the exact function `conversation-store.ts` and `session-tree.ts` already
 * share (R8.13's `cachePrefixFingerprint`). That makes the host-registry
 * record and the conversation-store record for a device-started conversation
 * the SAME id by construction, so `GET /api/projects`'s list, the store's
 * scrollback and this module's own resume path all agree.
 *
 * Known limitation, stated rather than assumed: this id is computed from the
 * TEXT this module relayed to the runner's stdin, not from the actual bytes
 * the `claude` CLI subsequently sends upstream as the Anthropic request the
 * proxy observes — `session-tree.ts`'s own hash of THAT request may not be
 * bit-for-bit identical (the runner may reshape a bare string into a
 * content-block array before sending it). Unifying with session-tree's
 * independently-observed key would need that verified; until then, the two
 * are related but not asserted equal. See `docs/wiki/concepts/Device
 * Conversations.md`.
 *
 * ## Origination scope (gate-map item 2)
 *
 * `security.origination_roots` (empty = every reachable known root; a
 * non-empty list = only those, checked AFTER resolving the requested root so
 * a symlink or worktree cannot widen it) decides which project roots a
 * device may start a NEW conversation in. Read from policy, never
 * hard-coded — see `src/config/schema.ts`.
 *
 * Known limitation, stated rather than assumed: `resumeConversation` looks
 * a conversation up only in THIS server's own `options.projectDir` registry
 * (`host-registry.ts` is itself per-root). A conversation legitimately
 * started in a different, allowlisted root can be resumed only while this
 * process still holds it `live` (its actual root is used correctly then);
 * across a restart of `session host serve` it is not found, and is refused
 * with a plain 404 rather than misread from the wrong root's store.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { GolemSettings } from "../config/schema.js";
import { resolveWorktreeRoot } from "../shared/git-worktree.js";
import { conversationIdFor, LocalConversationStore } from "./conversation-store.js";
import { HostedSession } from "./host.js";
import { appendHostLog } from "./host-log.js";
import {
  findHostSession,
  type HostSessionRecord,
  isAlive,
  registerHostSession,
  updateHostSession,
} from "./host-registry.js";
import { hostSettingsArg } from "./host-settings.js";
import {
  checkReachability,
  type KnownProjectStatus,
  listKnownProjects,
  recordKnownProject,
} from "./known-projects.js";
import { SessionBus } from "./session-bus.js";
import { MAX_MESSAGE_CHARS, type TransportSession } from "./transport.js";

/** `POST /api/conversations` — origination is a high-risk act (gate-map item 5). */
export const START_CONVERSATION_PATH = "/api/conversations";
/** `GET /api/projects` — the project list a device can trust (item 1). */
export const PROJECTS_PATH = "/api/projects";

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

/**
 * Wire `HostedSession`'s R13.3 events onto an R13.5 `SessionBus`, AND fold
 * assistant replies into the conversation store so scrollback covers both
 * sides of the exchange, not just what the device sent.
 *
 * Factored out of `session host serve`'s CLI action (which now calls this
 * too) so the mapping lives in exactly one place.
 */
export function wireHostedSession(
  hosted: HostedSession,
  bus: SessionBus,
  store: LocalConversationStore,
  conversationId: string,
): void {
  let assistantText = "";
  hosted.on("event", (event: { type: string; [k: string]: unknown }) => {
    switch (event.type) {
      case "text":
        assistantText += `${String(event.text)}\n`;
        bus.publish({ type: "text", text: String(event.text) });
        break;
      case "tool_use":
        bus.publish({
          type: "tool_call",
          id: String(event.id),
          name: String(event.name),
          input: event.input,
        });
        break;
      case "tool_result":
        bus.publish({
          type: "tool_result",
          toolCallId: String(event.toolUseId),
          isError: event.isError === true,
          content: String(event.content),
        });
        break;
      case "permission_denied":
        bus.publish({
          type: "refused",
          tool: String(event.tool),
          message: String(event.message),
          by: "runner",
        });
        break;
      case "rate_limit":
        bus.publish({ type: "parked", detail: "rate-limit pressure reported by the runner" });
        break;
      case "result": {
        bus.publish({
          type: "turn_end",
          ...(typeof event.costUsd === "number" ? { costUsd: event.costUsd } : {}),
        });
        const text = assistantText.trim();
        assistantText = "";
        if (text !== "") {
          void store.appendTurn(conversationId, {
            role: "assistant",
            content: text,
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }
    }
  });
  hosted.on("exit", (info: { code: number | null; error?: string }) => {
    bus.publish({
      type: "ended",
      reason: info.error ?? `the runner exited (code ${String(info.code)})`,
    });
  });
}

export interface DeviceSessionsOptions {
  /** This write server's own project — every route here is scoped to it. */
  readonly projectDir: string;
  readonly proxyBaseUrl: string;
  readonly settings: Pick<GolemSettings, "security">;
  /**
   * The write server's own base URL (`https://host:port/`), known only once
   * `startWriteServer` resolves. A box rather than a plain string because this
   * handler is constructed BEFORE that URL exists — requests only arrive
   * after, so reading it lazily at call time is correct, not a race.
   */
  readonly serverUrl: { value: string };
  readonly permissionMode?: string;
  /**
   * Test seam, mirroring `HostedSessionOptions`' own: overrides the spawned
   * binary/args for every `HostedSession` this handler starts or resumes, so
   * tests can point at a fake runner instead of the real `claude` CLI.
   * Production never sets these.
   */
  readonly runnerBin?: string;
  readonly runnerArgsOverride?: readonly string[];
}

interface LiveEntry {
  readonly hosted: HostedSession;
  readonly bus: SessionBus;
  readonly projectDir: string;
}

/** What this handler needs to say about every project it knows, for `GET /api/projects`. */
interface ProjectListEntry extends KnownProjectStatus {
  /** Whether a device may START a new conversation here right now (item 2). */
  readonly canOriginate: boolean;
}

/**
 * Resolve and validate a requested origination root against
 * `security.origination_roots` and live reachability. Returns the resolved
 * root, or a refusal naming exactly what failed (item 6).
 */
function resolveOriginationRoot(
  requested: string | undefined,
  self: { readonly projectDir: string; readonly originationRoots: readonly string[] },
): { readonly ok: true; readonly root: string } | { readonly ok: false; readonly reason: string } {
  const resolved = resolveWorktreeRoot(path.resolve(requested ?? self.projectDir));
  const allowlist = self.originationRoots.map((r) => resolveWorktreeRoot(path.resolve(r)));
  if (allowlist.length > 0 && !allowlist.includes(resolved) && resolved !== self.projectDir) {
    return {
      ok: false,
      reason:
        `${resolved} is not in security.origination_roots — a device may start a ` +
        `conversation only in: ${[self.projectDir, ...allowlist].join(", ")}`,
    };
  }
  if (resolved === self.projectDir) return { ok: true, root: resolved };
  const reachability = checkReachability(resolved);
  if (reachability.status !== "ok") {
    return { ok: false, reason: reachability.reason };
  }
  return { ok: true, root: resolved };
}

/**
 * Builds the `/api/projects` + `/api/conversations[...]` handler, plus the
 * `lookup`/`listSessions` pair `sessionTransportHandler` needs to carry
 * whatever this handler starts or resumes. One instance per write server.
 */
export function createDeviceSessionsHandler(options: DeviceSessionsOptions): {
  readonly handleApi: (
    request: { req: IncomingMessage; res: ServerResponse; body: string },
    url: URL,
  ) => Promise<boolean>;
  readonly lookup: (sessionId: string) => TransportSession | null;
  readonly listSessions: () => Promise<{
    readonly hosted: readonly { readonly sessionId: string; readonly projectDir: string }[];
    readonly joined: readonly [];
    readonly injectionEnabled: boolean;
  }>;
  /** Stop every live session this handler started — called on process shutdown. */
  readonly shutdown: (reason: string) => void;
} {
  const store = LocalConversationStore.forProjectDir(options.projectDir);
  const live = new Map<string, LiveEntry>();
  const originationRoots = options.settings.security.origination_roots;

  function urls(id: string): { chat: string; stream: string; message: string } {
    const base = options.serverUrl.value;
    return {
      chat: `${base}session/${id}/chat`,
      stream: `${base}session/${id}/stream`,
      message: `${base}session/${id}/message`,
    };
  }

  async function startConversation(
    root: string,
    text: string,
    deviceId: string,
  ): Promise<
    | { readonly ok: true; readonly id: string }
    | { readonly ok: false; readonly status: number; readonly error: string }
  > {
    const id = conversationIdFor({ messages: [{ role: "user", content: text }] });
    const already = await findHostSession(root, id);
    if (already?.alive === true) {
      return {
        ok: false,
        status: 409,
        error:
          `a conversation with this exact first message already exists (${id}) and is ` +
          `still running — resume it instead of starting a new one`,
      };
    }

    await recordKnownProject(root);
    const hosted = new HostedSession({
      projectDir: root,
      proxyBaseUrl: options.proxyBaseUrl,
      settingsJson: hostSettingsArg({ sessionId: id }),
      ...(options.permissionMode !== undefined ? { permissionMode: options.permissionMode } : {}),
      ...(options.runnerBin !== undefined ? { runnerBin: options.runnerBin } : {}),
      ...(options.runnerArgsOverride !== undefined
        ? { runnerArgsOverride: options.runnerArgsOverride }
        : {}),
    });
    const bus = new SessionBus(id);
    wireHostedSession(hosted, bus, LocalConversationStore.forProjectDir(root), id);
    hosted.on("exit", (info: { code: number | null; error?: string }) => {
      live.delete(id);
      void updateHostSession(root, id, {
        stoppedAt: new Date().toISOString(),
        ...(hosted.runnerSessionId !== undefined
          ? { runnerSessionId: hosted.runnerSessionId }
          : {}),
        ...(info.error !== undefined ? { lastError: info.error } : {}),
      });
    });

    await registerHostSession(root, {
      id,
      projectDir: root,
      startedAt: new Date().toISOString(),
      pid: process.pid,
    });
    await appendHostLog(root, {
      kind: "lifecycle",
      ts: new Date().toISOString(),
      sessionId: id,
      event: "started",
      detail: `device-originated (${deviceId}) via ${options.proxyBaseUrl}`,
    });

    hosted.start();
    live.set(id, { hosted, bus, projectDir: root });

    // Invariant 4: attribution before delivery, awaited, in BOTH records this
    // module keeps — the audit log and the conversation store.
    const ts = new Date().toISOString();
    await appendHostLog(root, { kind: "turn", ts, sessionId: id, origin: deviceId, text });
    await LocalConversationStore.forProjectDir(root).appendTurn(id, {
      role: "user",
      content: text,
      timestamp: ts,
    });
    hosted.send(text);

    return { ok: true, id };
  }

  async function resumeConversation(
    id: string,
  ): Promise<
    | { readonly ok: true; readonly id: string; readonly status: "live" | "restarted" }
    | { readonly ok: false; readonly status: number; readonly error: string }
  > {
    if (live.has(id)) return { ok: true, id, status: "live" };

    const record: HostSessionRecord | null = await findHostSession(options.projectDir, id);
    if (record !== null && isAlive(record.pid) && record.stoppedAt === undefined) {
      // Registered and alive, but not one THIS process started (a crash-restart
      // of `session host serve` itself). Nothing to attach to across processes,
      // so this is honestly a refusal rather than a fake resume.
      return {
        ok: false,
        status: 409,
        error:
          `${id} is recorded as running under pid ${record.pid}, but not by this server ` +
          "process — restart `golem session host serve` to pick it back up, or stop it first",
      };
    }

    const storeRecord = await store.readConversation(id);
    if (record === null) {
      return {
        ok: false,
        status: 404,
        error:
          storeRecord === null
            ? `no conversation ${id} — checked the hosted-session registry and the conversation store, neither has it`
            : `no hosted-session record for ${id} — its message history is still in the store, ` +
              "but the process that ran it is gone and was never registered here, so it cannot be resumed",
      };
    }
    if (record.runnerSessionId === undefined) {
      return {
        ok: false,
        status: 409,
        error: `${id} has no recorded runner session id — it never completed a turn, so there is nothing to resume`,
      };
    }

    const bus = new SessionBus(id);
    const hosted = new HostedSession({
      projectDir: record.projectDir,
      proxyBaseUrl: options.proxyBaseUrl,
      settingsJson: hostSettingsArg({ sessionId: id }),
      resumeSessionId: record.runnerSessionId,
      ...(options.permissionMode !== undefined ? { permissionMode: options.permissionMode } : {}),
      ...(options.runnerBin !== undefined ? { runnerBin: options.runnerBin } : {}),
      ...(options.runnerArgsOverride !== undefined
        ? { runnerArgsOverride: options.runnerArgsOverride }
        : {}),
    });
    wireHostedSession(hosted, bus, store, id);
    hosted.on("exit", (info: { code: number | null; error?: string }) => {
      live.delete(id);
      void updateHostSession(record.projectDir, id, {
        stoppedAt: new Date().toISOString(),
        ...(info.error !== undefined ? { lastError: info.error } : {}),
      });
    });

    // A full replace, not a patch: this clears `stoppedAt`/`lastError` from the
    // prior run, which `Partial<HostSessionRecord>` cannot express under
    // `exactOptionalPropertyTypes` (an explicit `undefined` is not the same as
    // an absent key).
    await registerHostSession(record.projectDir, {
      id,
      runnerSessionId: record.runnerSessionId,
      projectDir: record.projectDir,
      startedAt: record.startedAt,
      pid: process.pid,
    });
    await appendHostLog(record.projectDir, {
      kind: "lifecycle",
      ts: new Date().toISOString(),
      sessionId: id,
      event: "started",
      detail: `resumed from device, runner session ${record.runnerSessionId}`,
    });

    hosted.start();
    live.set(id, { hosted, bus, projectDir: record.projectDir });
    return { ok: true, id, status: "restarted" };
  }

  async function handleApi(
    request: { req: IncomingMessage; res: ServerResponse; body: string },
    url: URL,
  ): Promise<boolean> {
    const { req, res, body } = request;

    if (url.pathname === PROJECTS_PATH) {
      if (req.method !== "GET") {
        json(res, 405, { error: "method not allowed" });
        return true;
      }
      await recordKnownProject(options.projectDir);
      const known = await listKnownProjects();
      const entries: ProjectListEntry[] = known.map((p) => ({
        ...p,
        canOriginate: resolveOriginationRoot(p.root, {
          projectDir: options.projectDir,
          originationRoots,
        }).ok,
      }));
      json(res, 200, { projects: entries });
      return true;
    }

    if (url.pathname === START_CONVERSATION_PATH) {
      if (req.method !== "POST") {
        json(res, 405, { error: "method not allowed" });
        return true;
      }
      let parsed: { root?: unknown; message?: unknown };
      try {
        parsed = JSON.parse(body) as typeof parsed;
      } catch {
        json(res, 400, { error: "expected a JSON body with `message` and optional `root`" });
        return true;
      }
      const text = typeof parsed.message === "string" ? parsed.message : "";
      if (text === "") {
        json(res, 400, { error: "`message` is required — the first turn to relay" });
        return true;
      }
      if (text.length > MAX_MESSAGE_CHARS) {
        json(res, 413, {
          error: "message too long",
          limit: MAX_MESSAGE_CHARS,
          received: text.length,
        });
        return true;
      }
      const rootReq = typeof parsed.root === "string" ? parsed.root : undefined;
      const resolved = resolveOriginationRoot(rootReq, {
        projectDir: options.projectDir,
        originationRoots,
      });
      if (!resolved.ok) {
        json(res, 403, { error: resolved.reason });
        return true;
      }
      const started = await startConversation(resolved.root, text, "device");
      if (!started.ok) {
        json(res, started.status, { error: started.error });
        return true;
      }
      json(res, 201, { id: started.id, root: resolved.root, ...urls(started.id) });
      return true;
    }

    const resumeMatch = /^\/api\/conversations\/([^/]+)$/.exec(url.pathname);
    if (resumeMatch !== null) {
      if (req.method !== "GET") {
        json(res, 405, { error: "method not allowed" });
        return true;
      }
      const id = decodeURIComponent(resumeMatch[1] ?? "");
      const result = await resumeConversation(id);
      if (!result.ok) {
        json(res, result.status, { error: result.error });
        return true;
      }
      json(res, 200, { id: result.id, status: result.status, ...urls(result.id) });
      return true;
    }

    const messagesMatch = /^\/api\/conversations\/([^/]+)\/messages$/.exec(url.pathname);
    if (messagesMatch !== null) {
      if (req.method !== "GET") {
        json(res, 405, { error: "method not allowed" });
        return true;
      }
      const id = decodeURIComponent(messagesMatch[1] ?? "");
      // Read from the conversation's OWN root when it is (or was, this
      // process) live — it may differ from `options.projectDir` (item 2).
      // Falling back to this handler's own project is the best a NEW process
      // can do for a conversation it never saw live; a cross-root id that was
      // only ever live in a prior process is a stated limitation, refused
      // honestly by the 404 below rather than silently misread.
      const conversationRoot = live.get(id)?.projectDir ?? options.projectDir;
      const record =
        await LocalConversationStore.forProjectDir(conversationRoot).readConversation(id);
      if (record === null) {
        json(res, 404, {
          error:
            `no conversation ${id} in the local store — never recorded, or evicted ` +
            "(30 days, or the 32-conversation cap, whichever comes first)",
        });
        return true;
      }
      const before = url.searchParams.get("before");
      const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
      let endIdx = record.turns.length;
      if (before !== null) {
        const idx = record.turns.findIndex((t) => t.timestamp >= before);
        if (idx !== -1) endIdx = idx;
      }
      const startIdx = Math.max(0, endIdx - limit);
      const page = record.turns.slice(startIdx, endIdx);
      json(res, 200, {
        turns: page,
        hasMore: startIdx > 0,
        ...(page.length > 0 ? { oldestTimestamp: page[0]?.timestamp } : {}),
      });
      return true;
    }

    return false;
  }

  function lookup(sessionId: string): TransportSession | null {
    const entry = live.get(sessionId);
    if (entry === undefined) return null;
    // Scoped to the CONVERSATION's own root, which may differ from this
    // handler's `options.projectDir` when it was started via `root` (item 2) —
    // using the wrong store here would silently write, or read, nothing.
    const conversationStore = LocalConversationStore.forProjectDir(entry.projectDir);
    return {
      bus: entry.bus,
      projectDir: entry.projectDir,
      deliver: async (text: string) => {
        // Every device message after the first turn arrives here (the first
        // is appended by `startConversation` before the process even starts).
        // Invariant 4: attribution before delivery — `handleMessage` in
        // `transport.ts` already wrote the audit-log line before calling this;
        // this is the conversation-store half, without which scrollback would
        // show only the opening turn and every assistant reply, never what the
        // device sent after it (task item 4).
        await conversationStore.appendTurn(sessionId, {
          role: "user",
          content: text,
          timestamp: new Date().toISOString(),
        });
        entry.hosted.send(text);
      },
      kind: "hosted",
      history: async () => {
        const record = await conversationStore.readConversation(sessionId);
        return (record?.turns ?? []).map((t) => ({
          role: t.role,
          content: typeof t.content === "string" ? t.content : JSON.stringify(t.content),
        }));
      },
    };
  }

  async function listSessions(): Promise<{
    readonly hosted: readonly { readonly sessionId: string; readonly projectDir: string }[];
    readonly joined: readonly [];
    readonly injectionEnabled: boolean;
  }> {
    return {
      hosted: [...live.entries()].map(([sessionId, e]) => ({
        sessionId,
        projectDir: e.projectDir,
      })),
      joined: [],
      injectionEnabled: false,
    };
  }

  function shutdown(reason: string): void {
    for (const [, entry] of live) {
      entry.bus.closeAll(reason);
      entry.hosted.kill();
    }
    live.clear();
  }

  return { handleApi, lookup, listSessions, shutdown };
}
