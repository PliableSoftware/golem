/**
 * R14.3 — run one ACP `session/prompt` turn for a persona.
 *
 * This is where the lane branch lives, and it is the ONLY branch: resolve
 * `resolvePersonaLane()` once per turn, then dispatch through the single
 * `TurnExecutor` interface both lanes share. Everything after the branch is
 * common — same prompt source (`resolvePersonaPrompt()`), same rate-limit
 * policy, same streaming and stop-reason handling. See [[Buzz Integration]]
 * "Lane-transparent dispatch": a worker-lane persona is not a lesser citizen,
 * and nothing here may special-case it.
 *
 * Settings (and therefore the lane) are read ONCE at the top of a turn and
 * never re-read mid-turn — a settings edit must never make one turn change
 * execution style halfway through (see the task doc's "Resolve the lane per
 * TURN, cached for that turn").
 *
 * `runAcpTurn` NEVER throws for an ordinary failure. A `PersonaLaneError`, an
 * unstaffed persona, a `NoDrafterConfiguredError`, or any other dispatch
 * failure all become one emitted text chunk plus `stopReason: "end_turn"` —
 * never an unhandled rejection, which would take the process down and trigger
 * a `buzz-acp` respawn loop.
 */

import { credentialEnvForProxy } from "../cli/gateways.js";
import { loadConfig } from "../config/index.js";
import { DEFAULT_KEY_ENV } from "../credentials/backends.js";
import { readSnoozeNudgeState } from "../hooks/snooze-nudge.js";
import { resolveCoderPrompt } from "../inference/coder-prompt.js";
import { PersonaLaneError, resolvePersonaLane } from "../inference/persona-lane.js";
import type { PersonaConfig } from "../inference/personas.js";
import { resolvePersonaPrompt } from "../inference/personas.js";
import {
  createTargetDispatcher,
  type DispatchRequest,
  NoDrafterConfiguredError,
  RateLimitedError,
  TargetDispatchError,
  type TargetDispatcher,
  type TargetDispatcherOptions,
} from "../inference/target-dispatcher.js";
import { persistSnoozeNote } from "../mcp/snooze-note.js";
import { perGatewayEnvVar, withDefaultTarget } from "../providers/index.js";
import { readLimitState } from "../proxy/limit-prediction.js";
import { decideInFlight, decidePreflight, deferralChannelMessage } from "./limit-guard.js";
import type { StopReason } from "./types.js";

/** Which lane actually ran, recorded so a later resume (R14.4) never switches silently. */
export type TurnLane = "worker" | "agent";

export interface TurnResult {
  readonly stopReason: StopReason;
  /** The full reply text, when the turn produced one (absent on a decline/defer). */
  readonly text?: string;
  readonly lane?: TurnLane;
  readonly model?: string;
}

/** Enough to keep a deferred thread resumable — R14.4's `thread-state.ts` reads this shape. */
export interface DeferredTurnInfo {
  readonly untilIso: string;
  readonly reason: string;
  readonly personaId: string;
  readonly lane: TurnLane | null;
}

export interface RunAcpTurnDeps {
  readonly now?: () => number;
  /** Overrides for the dispatcher this turn builds — tests substitute a fake `fetch`. */
  readonly dispatcherOverrides?: Partial<
    Pick<TargetDispatcherOptions, "fetchImpl" | "resolveKey" | "sessionModel" | "audit" | "env">
  >;
  /**
   * R14.4's seam: post the deferral message to the channel. Absent in R14.3 —
   * a defer is still logged to stderr and recorded via `persistSnoozeNote`, so
   * nothing is silently dropped, but nothing is posted anywhere without a
   * transport wired up.
   */
  readonly postChannelMessage?: (text: string) => Promise<void>;
  /** R14.4's seam: record the thread as deferred in `thread-state.ts`. */
  readonly recordDeferred?: (info: DeferredTurnInfo) => Promise<void>;
}

export interface RunAcpTurnInput {
  readonly projectDir: string;
  readonly personaId: string;
  readonly promptText: string;
  /** Called once per chunk of output as it arrives — the `session/update` keepalive. */
  readonly emit: (text: string) => void;
  readonly deps?: RunAcpTurnDeps;
}

/** Mirrors `persona-sync.ts`'s coder special-case exactly — see the task doc's "Two defects". */
async function resolvePromptText(
  personaId: string,
  config: PersonaConfig,
  projectDir: string,
  coderPromptSetting: string | undefined,
): Promise<string> {
  if (
    personaId === "coder" &&
    config.prompt === undefined &&
    config.prompt_file === undefined &&
    coderPromptSetting !== undefined
  ) {
    return resolveCoderPrompt(coderPromptSetting);
  }
  return (await resolvePersonaPrompt(personaId, config, projectDir)).text;
}

/**
 * Mirrors `resolveTargetCredential` in `src/cli/commands/mcp-serve.ts`: a
 * lazy, per-turn resolver so secrets stay in this closure rather than
 * `process.env` — nothing this process spawns should inherit them. `golem acp`
 * is spawned directly by `buzz-acp`, not via `.mcp.json`, so its `process.env`
 * is whatever the operator's shell gave `buzz-acp`; reading credentials from
 * Golem's own store here (rather than relying on env inheritance) is what
 * makes a stored `golem gateway login` key actually reach this dispatch.
 */
function resolveTargetCredential(
  projectDir: string,
): (accountId: string | null) => Promise<string | undefined> {
  let pending: Promise<Record<string, string>> | undefined;
  return async (accountId) => {
    pending ??= credentialEnvForProxy(projectDir);
    const creds = await pending;
    return creds[accountId === null ? DEFAULT_KEY_ENV : perGatewayEnvVar(accountId)];
  };
}

function buildDispatcher(
  settings: Awaited<ReturnType<typeof loadConfig>>["settings"],
  projectDir: string,
  deps: RunAcpTurnDeps | undefined,
): TargetDispatcher {
  return createTargetDispatcher({
    // Buzz has no local tiered `InferenceService` of its own — R14.3 ships a
    // bounded single-shot through the registry/harness chain only, never the
    // local tiered service. A minimal stub satisfies the interface without
    // ever being reachable: `createTargetDispatcher` only calls `inference`
    // when a target resolves to the tiered service's OWN loopback endpoint,
    // which no Buzz persona's target does.
    inference: {
      chat: () => {
        throw new TargetDispatchError(
          "golem acp does not dispatch to the local tiered service; route the persona to a registry target or a model id.",
        );
      },
      embed: () => {
        throw new TargetDispatchError("golem acp does not embed.");
      },
      capabilities: () => 0,
    },
    settings: withDefaultTarget(settings),
    workerTargets: settings.inference.worker_targets,
    personas: settings.inference.personas,
    resolveKey: resolveTargetCredential(projectDir),
    ...deps?.dispatcherOverrides,
  });
}

async function deferTurn(
  input: RunAcpTurnInput,
  untilIso: string,
  reason: string,
  lane: TurnLane | null,
  nowIso: string,
): Promise<TurnResult> {
  const message = deferralChannelMessage(untilIso, reason);
  input.emit(message);
  await persistSnoozeNote(
    input.projectDir,
    `Buzz turn for persona "${input.personaId}" deferred: ${reason}. Resumes after ${untilIso}.`,
    { nowIso },
  );
  if (input.deps?.postChannelMessage !== undefined) {
    await input.deps.postChannelMessage(message);
  } else {
    process.stderr.write(`golem acp: deferred (no channel transport wired) — ${message}\n`);
  }
  if (input.deps?.recordDeferred !== undefined) {
    await input.deps.recordDeferred({ untilIso, reason, personaId: input.personaId, lane });
  }
  return { stopReason: "end_turn" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run one turn. Never throws for an ordinary decline/defer/dispatch failure. */
export async function runAcpTurn(input: RunAcpTurnInput): Promise<TurnResult> {
  const now = input.deps?.now ?? (() => Date.now());
  const { settings } = await loadConfig({ projectDir: input.projectDir });
  const personas = settings.inference.personas ?? {};
  const config = personas[input.personaId];

  if (config === undefined) {
    input.emit(
      `Persona "${input.personaId}" is not declared in this project's config — nothing to run.`,
    );
    return { stopReason: "end_turn" };
  }

  let lane: ReturnType<typeof resolvePersonaLane>;
  try {
    lane = resolvePersonaLane({
      settings: withDefaultTarget(settings),
      personas,
      personaId: input.personaId,
      workerTargets: settings.inference.worker_targets,
    });
  } catch (err) {
    if (err instanceof PersonaLaneError) {
      input.emit(err.message);
      return { stopReason: "end_turn" };
    }
    throw err;
  }

  if (lane.kind === "unstaffed") {
    input.emit(
      `Persona "${input.personaId}" is unstaffed (${lane.reason}) — nothing routes this turn.`,
    );
    return { stopReason: "end_turn" };
  }

  const promptText = await resolvePromptText(
    input.personaId,
    config,
    input.projectDir,
    settings.inference.coder_prompt,
  );
  const turnLane: TurnLane = lane.kind;

  // Layer 1 — pre-flight, cheap, advisory.
  const [prediction, nudgeState] = await Promise.all([
    readLimitState(input.projectDir),
    readSnoozeNudgeState(input.projectDir),
  ]);
  const preflight = decidePreflight(prediction, nudgeState, now());
  if (preflight.kind === "defer") {
    return deferTurn(
      input,
      preflight.untilIso,
      preflight.reason,
      turnLane,
      new Date(now()).toISOString(),
    );
  }

  const dispatcher = buildDispatcher(settings, input.projectDir, input.deps);
  const request: DispatchRequest =
    lane.kind === "worker"
      ? { role: "drafter", prompt: input.promptText, system: promptText, targetId: lane.targetId }
      : { role: "drafter", prompt: input.promptText, system: promptText, model: lane.model };

  let attempt = 0;
  for (;;) {
    try {
      const result = await dispatcher.dispatch(request);
      input.emit(result.text);
      return { stopReason: "end_turn", text: result.text, lane: turnLane, model: result.model };
    } catch (err) {
      if (err instanceof RateLimitedError) {
        attempt += 1;
        const verdict = decideInFlight(err, attempt, now());
        if (verdict.kind === "retry") {
          input.emit(""); // keepalive — resets buzz-acp's idle timer without changing the reply
          await sleep(verdict.afterMs);
          continue;
        }
        return deferTurn(
          input,
          verdict.untilIso,
          verdict.reason,
          turnLane,
          new Date(now()).toISOString(),
        );
      }
      if (err instanceof NoDrafterConfiguredError) {
        input.emit(
          `Persona "${input.personaId}" has nothing configured to dispatch to for this turn ` +
            `(${err.message}). Nothing routes this request.`,
        );
        return { stopReason: "end_turn" };
      }
      if (err instanceof TargetDispatchError) {
        input.emit(`Persona "${input.personaId}" could not complete this turn: ${err.message}`);
        return { stopReason: "end_turn" };
      }
      throw err;
    }
  }
}
