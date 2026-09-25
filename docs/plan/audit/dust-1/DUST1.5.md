# DUST1.5 — MCP server and local tools: audit findings

Draft, in progress. Read-only audit; nothing outside this file changed.

## Headline findings (so far)

1. **`coder` fails its own `outputSchema` on the production path.** When a target
   dispatcher is wired (unconditional since R10.8), `structuredContent` carries
   `target`, `trust`, `route` and `redacted_count` (`src/mcp/coder-tools.ts:509-518`).
   None of those are in `outputSchema` (`src/mcp/coder-tools.ts:237-274`). Zod objects
   serialise with `additionalProperties: false`. The refine path adds
   `refinement.status` and `refinement.critiqued_by` (`:524-533`), which are also
   missing from the schema (`:267-273`). Reproduced against SDK 1.29.0: after
   `listTools()`, `client.callTool("coder")` throws `MCP error -32602: Structured
   content does not match the tool's output schema: data must NOT have additional
   properties`. The check runs on the client side (`sdk/dist/esm/client/index.js:509`).
   Tests miss it because `connectInMemory` never calls `listTools()`
   (`tests/integration/mcp-server.test.ts:58-63`), so the SDK has no validator cached.
2. **The `slider` and `bypass` prompts point at things that no longer exist.** They
   tell the model to call a `level` tool and the user to run `golem slider 0`
   (`src/mcp/prompts.ts:13-39`, `:85-105`). ADR-0004 retired both. No `level` tool is
   registered (`src/mcp/server.ts`, `src/plugins/loader.ts:43-55`), and the only dial
   verbs are `brevity` and `compression` (`src/cli/commands/dials-stats.ts:33-35`). The
   same test file asserts the tool is gone (`mcp-server.test.ts:196`) and that the
   prompt points at it (`:366-373`).
