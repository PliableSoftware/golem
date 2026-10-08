/**
 * `golem on` / `golem off` — the master switch, and the one place that decides
 * what "off" means.
 *
 * R11.3. This used to be one POST to the running proxy's admin endpoint and
 * nothing else, which made the switch **in-process only** — two faults, not one:
 *
 *  - it did not survive. `golem proxy restart`, a SessionStart re-launch or a
 *    reboot brought the pipeline back up with redaction, compression and brevity
 *    all running, and the user was never told the thing they turned off was on
 *    again;
 *  - while it *was* off, no surface said so. Every status surface reads
 *    `proxy.bypass_all` from settings (`status-collect.ts`, `statusline.ts`,
 *    `watch.ts`), so a machine forwarding raw — redaction included in what was
 *    skipped — still rendered as a healthy pipeline with dials beside it, and
 *    `REDACTION_OFF_WARNING` never fired.
 *
 * Both halves are the same defect: the state lived somewhere nothing could see
 * and nothing could keep. R11.1 had already built the right home for it —
 * `proxy.bypass_all` (ADR-0004): persisted, CLI-only, loudly surfaced, and the
 * only route to redaction-off now that the stage table has no redaction-free
 * row. So the switch writes THAT, and every surface tells the truth for free.
 *
 * DUSTSEC.2 removed the live admin endpoint this used to POST to: it was
 * unauthenticated and let any local caller (a browser tab, a stray process) turn
 * redaction off with no trace in any status surface. So the switch now only
 * persists, and a RUNNING proxy picks it up on its next start (`golem proxy
 * restart`). `proxy.bypass_all` is read where the proxy is constructed
 * (`restart: "proxy"` in the control surface), and that is the only way in.
 */

import { setConfig } from "./config.js";
import { portInUse } from "./proxy-daemon.js";

/** What `setPipelineState` did, so the caller can report it honestly. */
export interface PipelineSwitchResult {
  /** The state now persisted: `true` = pipeline on, `false` = full bypass. */
  readonly enabled: boolean;
  /** Settings file the `proxy.bypass_all` write landed in. */
  readonly file: string;
  /** True when a proxy is already listening: it must be restarted to take the change. */
  readonly proxyRunning: boolean;
  /** Present when a scope above `local` overrides the value just written. */
  readonly overriddenBy?: string;
}

/**
 * Persist the master switch. A running proxy takes it on its next start.
 *
 * `enabled: false` is a FULL bypass — redaction included — because that is what
 * `golem off` has always done at the listener (a proxy built with the pipeline
 * disabled is an identity pipeline). The difference is that it is visible and durable.
 *
 * The write goes to the `local` scope: it is one person's choice on one machine,
 * and `.golem/settings.local.json` is gitignored, so turning redaction off can
 * never arrive in someone else's checkout as a committed default.
 */
export async function setPipelineState(
  projectDir: string,
  port: number,
  enabled: boolean,
): Promise<PipelineSwitchResult> {
  const write = await setConfig("local", "proxy.bypass_all", enabled ? "false" : "true", {
    projectDir,
  });
  return {
    enabled,
    file: write.file,
    proxyRunning: await portInUse(port),
    ...(write.overriddenBy !== undefined ? { overriddenBy: write.overriddenBy.layer } : {}),
  };
}

/**
 * The lines `golem on` / `golem off` print.
 *
 * Separated from the action so the wording is testable: "redaction is off" is
 * the sentence this whole task exists to make sure somebody sees, and a string
 * built inline in a commander callback is a string no test will ever read.
 */
export function renderPipelineSwitch(result: PipelineSwitchResult, port: number): string {
  const url = `http://localhost:${port}`;
  const where = result.proxyRunning
    ? `recorded in ${result.file} — the proxy on ${url} is still running the previous state; ` +
      "run `golem proxy restart` to apply it"
    : `recorded in ${result.file} — the proxy is not running, so it applies when it starts`;
  const lines: string[] = [];
  if (result.enabled) {
    lines.push(`golem on — pipeline enabled ${where}`);
    lines.push("Redaction, compression and brevity are running. This survives a restart.");
  } else {
    lines.push(`golem off — pipeline disabled ${where}; requests are forwarded raw`);
    lines.push(
      "⚠ REDACTION IS OFF: secrets and PII reach the upstream unredacted. " +
        "This persists across restarts (proxy.bypass_all in " +
        `${result.file}) until you run \`golem on\`.`,
    );
    lines.push(
      "If you wanted no COMPRESSION but still want redaction, run `golem on` and " +
        "`golem compression off` instead.",
    );
  }
  if (result.overriddenBy !== undefined) {
    lines.push(
      `⚠ the ${result.overriddenBy} scope also sets proxy.bypass_all and wins — ` +
        "this write has no effect until that value is removed.",
    );
  }
  return `${lines.join("\n")}\n`;
}
