/**
 * R13.3 — `golem hook host-gate`: the gate that runs INSIDE a hosted session.
 *
 * Spawned by the runner as a `PreToolUse` hook, from settings the host injected
 * (`src/session/host-settings.ts` explains why the host supplies its own rather
 * than trusting the project's, and why `PreToolUse` rather than
 * `PermissionRequest`).
 *
 * ## How this differs from `pre-tool-use.ts`, which it deliberately does not reuse
 *
 * That handler is the GUEST gate. It carries the snooze park, the coder-first
 * nudge and the spawn gate, it writes the pending-call record that the blocked
 * read model renders, and its strongest move is `ask`. All of that is about
 * being a bystander in the developer's own session.
 *
 * This one runs in a session Golem spawned, where there is no human at the
 * terminal, no dialog to raise, and no reason to nudge anybody about anything.
 * Its whole job is: classify, decide, refuse if refusal is the answer, and write
 * an attributable line. Sharing an implementation would mean one function with a
 * mode flag deciding whether `ask` means "prompt the human" or "refuse because
 * nobody is there", which is two behaviours wearing one name.
 *
 * SAFETY, and note the direction is the OPPOSITE of the guest hook's:
 * `pre-tool-use.ts` fails to silence, because a crash there must leave the
 * human's own permission flow in charge. Here a crash must **deny**, because
 * there is no human flow to fall back to and the alternative is an unsupervised
 * tool call in a session Golem is answerable for.
 */

import { classifyAction, readAutonomyLevel } from "../autonomy/index.js";
import { projectDirFor } from "../config/paths.js";
import { type LimitPrediction, readLimitState } from "../proxy/limit-prediction.js";
import { decideHostGate, type HostGateDecision, resolveHostGate } from "../session/host-gate.js";
import { appendHostLog } from "../session/host-log.js";
import { type HookIo, readAll } from "./hook-io.js";
import { PARK_EXEMPT_TOOLS, readSnoozeEnforced } from "./pre-tool-use.js";
import {
  decideSnoozeNudge,
  HOST_SNOOZE_STATE_FILE,
  readSnoozeNudgeState,
  snoozeEnforceReason,
  snoozeNudgeReason,
  writeSnoozeNudgeState,
} from "./snooze-nudge.js";

interface HostGatePayload {
  readonly cwd?: string;
  readonly tool_name?: string;
  readonly tool_input?: unknown;
  readonly session_id?: string;
}

export interface HostGateHookOptions {
  readonly projectDir?: string;
  /** The hosted session id, from `--session` on the command line. */
  readonly sessionId?: string;
  readonly nowIso?: string;
  readonly readLevel?: (projectDir: string) => Promise<string>;
  /** Test seams for the usage-limit park (DUST2.19); production reads the live state. */
  readonly readPrediction?: (projectDir: string) => Promise<LimitPrediction | null>;
  readonly isSnoozeEnforced?: (projectDir: string) => Promise<boolean>;
  readonly now?: () => number;
}

function parsePayload(raw: string): HostGatePayload | null {
  try {
    const j: unknown = JSON.parse(raw);
    if (typeof j !== "object" || j === null || Array.isArray(j)) return null;
    return j as HostGatePayload;
  } catch {
    return null;
  }
}

/** The `PreToolUse` deny envelope — FLAT `permissionDecision`, not the nested one. */
function denyEnvelope(reason: string): string {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  })}\n`;
}

/**
 * A refusal used when the gate itself could not run — a malformed payload, an
 * unreadable project, a crash. Deliberately fail-CLOSED (see the module header).
 */
const GATE_FAILED_REASON =
  "Refused by the Golem session host: the host gate could not evaluate this call, so it was denied rather than run unsupervised. This is a fail-closed refusal, not a policy decision about the action itself.";

/**
 * Run the host gate. Always returns 0 — a non-zero exit is not how a refusal is
 * expressed here, and exit 2 would hard-block the session rather than refuse one
 * call.
 */
export async function runHostGateHook(
  io: HookIo,
  options: HostGateHookOptions = {},
): Promise<number> {
  try {
    const payload = parsePayload(await readAll(io.stdin));
    if (payload === null) {
      io.stdout.write(denyEnvelope(GATE_FAILED_REASON));
      return 0;
    }
    const toolName = payload.tool_name;
    if (typeof toolName !== "string" || toolName.length === 0) {
      io.stdout.write(denyEnvelope(GATE_FAILED_REASON));
      return 0;
    }

    const projectDir = options.projectDir ?? projectDirFor(payload.cwd);
    const sessionId = options.sessionId ?? payload.session_id ?? "unknown";
    const action = classifyAction(toolName, payload.tool_input);

    // DUST2.19 — the park tools (`snooze`, `ToolSearch` to load its schema,
    // `expand`) bypass the autonomy matrix entirely. `ToolSearch` classifies as
    // unknown -> ask -> (nobody attached) deny, which would make `snooze`
    // unreachable in enforcing mode: a park nobody can perform.
    if (PARK_EXEMPT_TOOLS.includes(toolName)) {
      await appendHostLog(projectDir, {
        kind: "decision",
        ts: options.nowIso ?? new Date().toISOString(),
        sessionId,
        tool: toolName,
        action,
        decision: "allow",
        reason: "park-exempt tool: stays reachable so the session can park",
      }).catch(() => undefined);
      return 0;
    }

    // A hosted session parks at the usage limit like any other. The guest gate
    // (`pre-tool-use.ts`) carries this nudge, but this gate is a deliberate
    // separate implementation, so the same pure decision is applied here. It keeps
    // its OWN one-shot state file (HOST_SNOOZE_STATE_FILE): sharing the guest's
    // would let either side consume the other's once-per-window redirect.
    {
      const nowMs = options.now?.() ?? Date.now();
      const nowIso = options.nowIso ?? new Date(nowMs).toISOString();
      const prediction = await (options.readPrediction ?? readLimitState)(projectDir);
      const state = await readSnoozeNudgeState(projectDir, HOST_SNOOZE_STATE_FILE);
      const enforce = await (options.isSnoozeEnforced ?? readSnoozeEnforced)(projectDir);
      const nudge = decideSnoozeNudge(prediction, state, nowMs, undefined, undefined, enforce);
      if (nudge.kind === "park") {
        const reason = enforce
          ? snoozeEnforceReason(nudge.resetAtIso, nudge.utilization)
          : snoozeNudgeReason(nudge.resetAtIso, nudge.utilization);
        // One decision line per parked tool call: the audit answers "what did
        // this session try to do" even when the park refused it.
        await appendHostLog(projectDir, {
          kind: "decision",
          ts: nowIso,
          sessionId,
          tool: toolName,
          action,
          decision: "deny",
          reason: "usage-limit park: redirected to snooze",
        }).catch(() => undefined);
        // The lifecycle line is once per reset window, not once per call (enforcing
        // mode denies every call, which would otherwise write a line each).
        const logged = state.parkLoggedForResetIso === nudge.resetAtIso;
        if (!logged) {
          await appendHostLog(projectDir, {
            kind: "lifecycle",
            ts: nowIso,
            sessionId,
            event: "parked",
            detail: `usage limit ~${Math.round(nudge.utilization * 100)}%; reset ${nudge.resetAtIso}`,
          }).catch(() => undefined);
        }
        await writeSnoozeNudgeState(
          projectDir,
          {
            ...state,
            parkLoggedForResetIso: nudge.resetAtIso,
            ...(enforce ? {} : { nudgedForResetIso: nudge.resetAtIso }),
          },
          HOST_SNOOZE_STATE_FILE,
        );
        io.stdout.write(denyEnvelope(reason));
        return 0;
      }
      if (nudge.kind === "stale") {
        // No deny: there is no human to read a one-shot warning, and refusing a
        // tool call over a cold feed is the blindness trading places with a block.
        // But the blindness must be on the record, once per stale reading.
        await appendHostLog(projectDir, {
          kind: "lifecycle",
          ts: nowIso,
          sessionId,
          event: "limit-feed-stale",
          detail: `rate-limit feed ${nudge.ageMinutes} min old (~${Math.round(nudge.utilization * 100)}% at ${nudge.observedAtIso}); the usage-limit park is blind`,
        }).catch(() => undefined);
        await writeSnoozeNudgeState(
          projectDir,
          { ...state, staleWarnedForObservedIso: nudge.observedAtIso },
          HOST_SNOOZE_STATE_FILE,
        );
      }
    }

    const level = await (options.readLevel ?? readAutonomyLevel)(projectDir);
    const decided: HostGateDecision = decideHostGate(
      level as Parameters<typeof decideHostGate>[0],
      action,
    );
    // No answerer is wired in here, deliberately. The device transport (R13.5)
    // and chat surface (R13.6) have no upstream route that carries a permission
    // answer (only `message` and `interrupt`); that is R13.9 and Decision 61,
    // and whether it reaches hosted sessions is open (P3). Until then an `ask`
    // has nobody to reach and resolves to a refusal rather than a wait
    // (ADR-0007 invariant 3). The seam is `HostAttachment`.
    const resolved = resolveHostGate(decided);

    // Attribution is written for EVERY decision, allow included — an audit log
    // that only records refusals cannot answer "what did this session do".
    await appendHostLog(projectDir, {
      kind: "decision",
      ts: options.nowIso ?? new Date().toISOString(),
      sessionId,
      tool: toolName,
      action,
      decision: resolved.decision,
      reason: resolved.reason,
    }).catch(() => {
      // Best-effort: losing a log line must not turn an allowed call into a
      // denied one. The refusal path below still writes its envelope.
    });

    if (resolved.decision === "deny") {
      io.stdout.write(denyEnvelope(resolved.reason));
      return 0;
    }

    // `allow` emits NOTHING rather than `permissionDecision: "allow"`. Emitting
    // allow would remove prompts the runner would otherwise raise — widening
    // authority beyond what the matrix granted. Silence lets the runner's own
    // flow govern, which is the same thing the guest gate's `null` means.
    return 0;
  } catch (err) {
    io.stderr.write(`golem hook host-gate: ${err instanceof Error ? err.message : String(err)}\n`);
    io.stdout.write(denyEnvelope(GATE_FAILED_REASON));
    return 0;
  }
}
