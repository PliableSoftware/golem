/**
 * All 7 Golem MCP prompt registrations. Extracted from server.ts (R8.28).
 * The `slider` prompt was removed 2026-10-09 (USER decision M2, ADR-0004); a call to
 * it is now an unknown-prompt error. Breaking for anything that listed or called it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { promptMessages } from "./shared.js";

const P1_TOOL_FALLBACK =
  "If that tool is not available in this session, tell the user this Golem capability is not enabled in this session (every Golem tool ships; some register only when configured), and suggest checking `golem status`.";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "stats",
    {
      title: "Golem savings stats",
      description: "Show Golem token-savings statistics",
      argsSchema: {
        project_id: z
          .string()
          .optional()
          .describe("Limit stats to this project id; omit for global stats"),
      },
    },
    ({ project_id }) =>
      promptMessages(
        `Call the stats tool${
          project_id === undefined || project_id === "" ? "" : ` with project_id "${project_id}"`
        } and present the results concisely: current compression level, total tokens ` +
          "saved (before → after), request count, per-stage attribution if any, " +
          "and CCR store activity.",
      ),
  );

  server.registerPrompt(
    "expand",
    {
      title: "Expand a Golem CCR reference",
      description: "Retrieve the original content behind a Golem CCR ref marker",
      argsSchema: {
        ref_id: z
          .string()
          .describe(
            "The CCR ref id — the hex id from a `Retrieve original: hash=<id>` " +
              "(or `[golem:ccr ref=<id>]`) marker",
          ),
      },
    },
    ({ ref_id }) =>
      promptMessages(
        `Call the expand tool with ref_id "${ref_id}" and show the retrieved ` +
          "original content to the user. If the ref is unknown or expired, say so " +
          "and suggest re-running the tool that produced the content.",
      ),
  );

  server.registerPrompt(
    "bypass",
    {
      title: "Bypass Golem compression",
      description: "Temporarily bypass Golem's compression pipeline",
    },
    () =>
      promptMessages(
        "The user wants to bypass Golem's compression. There is no per-request " +
          "bypass (the `x-golem-bypass` header was removed). Explain the two " +
          "options and pick per intent: (1) `golem compression off` keeps " +
          "redaction on while compression is off. (2) `golem off` turns Golem " +
          "fully OFF but ALSO disables redaction (secrets reach the upstream " +
          "raw); it persists `proxy.bypass_all`, so it cannot be set from a tool " +
          "call at all: for a deliberate full bypass, tell the user to run it in " +
          "their own terminal. Prefer option 1 unless a true full bypass is " +
          "intended; confirm the choice and remind the user to restore their " +
          "previous setting afterwards (`golem on`).",
      ),
  );

  server.registerPrompt(
    "index",
    {
      title: "Index into the Golem knowledge base",
      description: "Ingest a path into Golem's local vector knowledge base",
      argsSchema: {
        path: z.string().optional().describe("File or directory to ingest (default: project root)"),
      },
    },
    ({ path }) =>
      promptMessages(
        `Ingest ${
          path === undefined || path === "" ? "the current project root" : `"${path}"`
        } into the Golem knowledge base using the ingest tool, then ` +
          `report what was indexed. ${P1_TOOL_FALLBACK}`,
      ),
  );

  server.registerPrompt(
    "search",
    {
      title: "Search the Golem knowledge base",
      description: "Federated semantic search over Golem's local knowledge base",
      argsSchema: {
        query: z.string().describe("What to search for"),
      },
    },
    ({ query }) =>
      promptMessages(
        `Search the Golem knowledge base for "${query}" using the search tool ` +
          "and summarize the most relevant hits (use fetch for full " +
          `chunk contents when needed). ${P1_TOOL_FALLBACK}`,
      ),
  );

  server.registerPrompt(
    "devices",
    {
      title: "Golem hardware capabilities",
      description: "Show detected local hardware tier and available local models",
    },
    () =>
      promptMessages(
        "Report the local hardware capabilities Golem detected (tier, GPU/VRAM, " +
          `available local models) using the devices tool. ${P1_TOOL_FALLBACK}`,
      ),
  );

  server.registerPrompt(
    "coder",
    {
      title: "Draft code or tests with a local model",
      description:
        "Delegate a code/test drafting task to a local model via Golem's tiered inference",
      argsSchema: {
        task: z.string().optional().describe("The task to delegate to a local model"),
      },
    },
    ({ task }) =>
      promptMessages(
        `Delegate ${
          task === undefined || task === "" ? "the user's current task" : `this task: "${task}"`
        } to a local model using the coder tool and relay the result, ` +
          `noting it was produced locally. ${P1_TOOL_FALLBACK}`,
      ),
  );
}
