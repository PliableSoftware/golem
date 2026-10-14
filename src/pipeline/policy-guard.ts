/**
 * DUST2.23 probe 2 — a caller-built policy cannot switch redaction off.
 *
 * `StageConfig.redaction` is the literal type `true`, so tsc rejects `false`. This
 * is the RUNTIME half, for what tsc cannot see: a cast, an `any`, a JS caller, a
 * plugin or a test double. Redaction-off is representable ONLY as `proxy.bypass_all`
 * (ADR-0004), which skips the pipeline before any policy is asked for.
 *
 * Design: THROW, do not coerce. Quietly forcing redaction on would hide a caller bug
 * and keep serving; a throw is loud (`onPipelineError`) and fails CLOSED, because the
 * proxy answers a pipeline throw by re-running redaction ALONE on the original
 * request (`redactOnly`, which never consults a policy) and forwards that, or answers
 * 5xx if even that fails. It never forwards the raw body. The cost of a bad policy is
 * a request with no compression, never one without redaction.
 */

import type { PipelinePolicy } from "../interfaces/policy.js";

export class RedactionPolicyError extends Error {
  constructor(found: unknown) {
    super(
      `pipeline policy has stages.redaction=${String(found)}; redaction cannot be turned off ` +
        "by a policy (only proxy.bypass_all does, ADR-0004). Refusing the policy: the proxy " +
        "falls back to redaction-only, never to a raw forward.",
    );
    this.name = "RedactionPolicyError";
  }
}

/** Return the policy when its redaction stage is exactly `true`; throw otherwise. */
export function assertRedactionOn(policy: PipelinePolicy): PipelinePolicy {
  // Runtime check on purpose: the static type says this cannot happen. `!== true`
  // also rejects a missing, falsy-coerced or truthy-but-not-true value.
  if ((policy as { stages?: { redaction?: unknown } })?.stages?.redaction !== true) {
    throw new RedactionPolicyError(
      (policy as { stages?: { redaction?: unknown } } | undefined)?.stages?.redaction,
    );
  }
  return policy;
}
