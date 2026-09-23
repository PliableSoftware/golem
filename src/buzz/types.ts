/**
 * R14.3 — Zod schemas for the inbound ACP message shapes `golem acp` handles.
 *
 * `buzz-acp` (and any other ACP client) is an external boundary, so `CLAUDE.md`
 * requires validation here rather than trusting the SDK's own TypeScript types
 * at runtime. Local to `src/buzz/` — `src/interfaces/` is frozen and these
 * shapes are ACP's, not Golem's.
 *
 * Deliberately permissive on anything this task does not need to reject:
 * `mcpServers` is accepted and stored (never validated against a specific MCP
 * shape — R14.3 does not call those servers), and unknown `_meta` keys are
 * ignored rather than stripped-and-rejected.
 */

import { z } from "zod";

/**
 * ACP's `StopReason` — exactly five values, no error member. Confirmed off the
 * SDK's own generated schema (`@agentclientprotocol/sdk` 1.4.0). Golem's own
 * rate-limit/decline paths must map onto `end_turn`; see `acp-turn.ts`.
 */
export const stopReasonSchema = z.enum([
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
]);
export type StopReason = z.infer<typeof stopReasonSchema>;

export const mcpServerSchema = z
  .object({
    type: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();
export type McpServerInput = z.infer<typeof mcpServerSchema>;

export const initializeParamsSchema = z
  .object({
    protocolVersion: z.number(),
    clientCapabilities: z.unknown().optional(),
    clientInfo: z.unknown().optional(),
  })
  .passthrough();
export type InitializeParamsInput = z.infer<typeof initializeParamsSchema>;

export const newSessionParamsSchema = z
  .object({
    cwd: z.string().min(1),
    additionalDirectories: z.array(z.string()).optional(),
    mcpServers: z.array(mcpServerSchema).default([]),
  })
  .passthrough();
export type NewSessionParamsInput = z.infer<typeof newSessionParamsSchema>;

const textContentBlockSchema = z
  .object({ type: z.literal("text"), text: z.string() })
  .passthrough();

/**
 * `ContentBlock` is a five-member union in the full ACP spec
 * (text/image/audio/resource_link/resource); this task only ever produces
 * text ourselves and only ever needs to READ text out of an inbound prompt
 * (see "Must not — do not implement `fs/*`/`terminal/*`"), so non-text blocks
 * parse permissively and are simply skipped when the turn extracts its text.
 */
const contentBlockSchema = z.object({ type: z.string() }).passthrough();

export const promptParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    prompt: z.array(contentBlockSchema).min(1),
  })
  .passthrough();
export type PromptParamsInput = z.infer<typeof promptParamsSchema>;

/** Concatenate every text block in a prompt, in order — the only shape this task reads. */
export function extractPromptText(prompt: readonly z.infer<typeof contentBlockSchema>[]): string {
  return prompt
    .map((block) => {
      const parsed = textContentBlockSchema.safeParse(block);
      return parsed.success ? parsed.data.text : "";
    })
    .filter((text) => text !== "")
    .join("\n");
}
