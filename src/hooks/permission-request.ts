/**
 * PermissionRequest hook — INERT by decision: it never answers a permission request.
 *
 * History. `src/hooks/pre-tool-use.ts` emits `ask` for `destructive`/`outward` at
 * every autonomy level (ADR-0002). R12.12 added a second, earlier layer here: an
 * unconditional `deny` for those two classes, so no permission dialog opened and a
 * connected permission-relay channel had nothing to be notified of
 * (verification-notes §141). The cost: a human at the terminal was never offered
 * the dialog either, so ADR-0002's "a human decides" was not true.
 *
 * Decision (USER, 2026-10-09, DUSTSEC.10, against the recommendation to keep the
 * deny): ask the human again. This hook now returns NO decision for any class at
 * any level, so the native permission dialog governs — destructive and outward
 * calls reach it, and the person decides. A conditional deny (only while a relay is
 * connected) was not possible: no "relay connected" signal exists at this hook
 * (verification-notes, 2026-10-08).
 *
 * Consequence, recorded in ADR-0002: with a permission-relay channel connected, the
 * relay may now be notified when that dialog opens, which is what R12.12 prevented.
 * Whether it is is R12.13, still unconfirmed.
 *
 * INVARIANT (ADR-0002 invariant 5): this hook NEVER emits `allow`, and never emits
 * anything else either. `permission_suggestions` ("always allow" options) is
 * deliberately ignored: echoing one back is how a hook grants a standing allow.
 *
 * Why it is still wired: `golem init` / `golem autonomy wire` register it, and
 * existing installs point at `golem hook permission-request`, so the command must
 * keep resolving and exit 0. Whether to stop wiring it is a separate change.
 *
 * SAFETY: every path exits 0 with NO stdout → the native permission flow governs.
 */

import { type HookIo, readAll } from "./hook-io.js";

/** The hooks-reference event name for this event. */
export const PERMISSION_REQUEST_EVENT = "PermissionRequest";

export interface PermissionRequestOptions {
  readonly projectDir?: string;
}

/**
 * Run the PermissionRequest hook. Always returns 0 and writes nothing to stdout:
 * the stdin payload is drained and ignored, so the native dialog decides.
 */
export async function runPermissionRequestHook(
  io: HookIo,
  _options: PermissionRequestOptions = {},
): Promise<number> {
  try {
    await readAll(io.stdin);
  } catch (err) {
    io.stderr.write(
      `golem hook permission-request: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
  return 0;
}
