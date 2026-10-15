/**
 * DUST2.22 — the team prompt is redacted before it leaves the machine, and it is
 * delivered nowhere else.
 *
 * The secret-shaped value is assembled at runtime so no literal credential sits
 * in the repo (and tooling does not redact it out from under the test).
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAcpTurn } from "../../../src/buzz/acp-turn.js";
import { resolveCoderPrompt } from "../../../src/inference/coder-prompt.js";
import { createTargetDispatcher } from "../../../src/inference/target-dispatcher.js";
import { TEAM_PROMPT_LABEL, withTeamPrompt } from "../../../src/inference/team-prompt.js";
import { writeTeamLayerCache } from "../../../src/portal/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-team-prompt-redact-");
const FAKE_KEY = ["sk", "ant", "api03", "B".repeat(95)].join("-");
const FAKE_EMAIL = ["oncall", "example.com"].join("@");
const TEAM_TEXT = `Escalate to ${FAKE_EMAIL}; staging key is ${FAKE_KEY}.`;

const captured = () => {
  const sent: string[] = [];
  const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
    sent.push(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({
        model: "m",
        choices: [{ message: { content: "ok" } }],
        content: [{ type: "text", text: "ok" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
};

describe("coder dispatch to a non-local target", () => {
  it("never sends a secret-shaped value from the team prompt", async () => {
    const { sent, fetchImpl } = captured();
    const dispatcher = createTargetDispatcher({
      inference: {
        chat: () => {
          throw new Error("not local");
        },
        embed: () => {
          throw new Error("no");
        },
        capabilities: () => 0,
      },
      settings: {
        upstream_provider: "anthropic",
        upstream_base_url: "https://api.anthropic.com",
        upstream_auth_scheme: "inherit",
        gateways: [
          { id: "openrouter", provider: "openrouter", base_url: "https://openrouter.ai/api/v1" },
        ],
        targets: [
          { id: "cheap", gateway: "openrouter", model: { name: "m" }, trust: "third-party" },
        ],
      },
      fetchImpl,
      env: { GOLEM_UPSTREAM_API_KEY__OPENROUTER: "fake" },
    });
    const system = withTeamPrompt(resolveCoderPrompt(undefined), TEAM_TEXT);
    expect(system).toContain(FAKE_KEY); // the probe is real: it is in the system text
    const result = await dispatcher.dispatch({
      role: "drafter",
      prompt: "write a function",
      system,
      worker: "coder",
      targetId: "cheap",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(TEAM_PROMPT_LABEL.slice(0, 20)); // delivered...
    expect(sent[0]).not.toContain(FAKE_KEY); // ...but redacted
    expect(sent[0]).not.toContain(FAKE_EMAIL);
    expect(sent[0]).toContain("[REDACTED:");
    expect(result.redactedCount).toBeGreaterThan(0);
  });
});

describe("golem acp turn", () => {
  it("does not deliver the team prompt: its only slot is system authority", async () => {
    const base = await newTempDir();
    const projectDir = path.join(base, "p");
    const userDir = path.join(base, "user");
    await mkdir(path.join(projectDir, ".golem"), { recursive: true });
    await mkdir(userDir, { recursive: true });
    await writeFile(
      path.join(projectDir, ".golem", "settings.json"),
      JSON.stringify({
        team: { org_id: "acme-co" },
        proxy: {
          upstream_provider: "anthropic",
          upstream_base_url: "https://api.anthropic.com",
          gateways: [
            { id: "vendorgw", provider: "anthropic", base_url: "https://api.example.invalid" },
          ],
          targets: [
            { id: "cheap", gateway: "vendorgw", model: { name: "cheap-sonnet" }, trust: "vendor" },
          ],
        },
        inference: { personas: { echo: { model: "cheap" } } },
      }),
    );
    await writeTeamLayerCache(userDir, {
      org_id: "acme-co",
      fetched_at: new Date().toISOString(),
      settings: [{ key: "inference.team_prompt", value: "team-text-canary", enforced: false }],
    });
    const { sent, fetchImpl } = captured();
    await runAcpTurn({
      projectDir,
      personaId: "echo",
      promptText: "ping",
      emit: () => {},
      deps: { userDir, dispatcherOverrides: { fetchImpl, env: {}, resolveKey: () => "fake-key" } },
    });
    const body = sent.join("\n");
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain("team-text-canary");
    expect(body).not.toContain("advisory only");
  });
});

describe("the delivery list is closed", () => {
  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await walk(p)));
      else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  }

  it("only the coder tool path reads the team prompt; the proxy, hooks and agent generator never do", async () => {
    const src = path.resolve(__dirname, "../../../src");
    const readers: string[] = [];
    for (const file of await walk(src)) {
      const rel = path.relative(src, file).split(path.sep).join("/");
      if (rel.startsWith("config/") || rel === "inference/team-prompt.ts") continue;
      if (/team_prompt|teamPrompt|withTeamPrompt/.test(await readFile(file, "utf8")))
        readers.push(rel);
    }
    expect(readers.sort()).toEqual(
      [
        "cli/commands/mcp-serve.ts", // reads the setting, hands it to the coder tool
        "buzz/acp-turn.ts", // a comment saying it is deliberately NOT used
        "cli/persona-sync.ts", // a comment saying it is deliberately NOT used
        "mcp/coder-tools.ts",
        "mcp/deps.ts",
        "mcp/server.ts",
      ].sort(),
    );
    for (const f of ["cli/persona-sync.ts", "buzz/acp-turn.ts"]) {
      expect(await readFile(path.join(src, f), "utf8")).not.toMatch(/withTeamPrompt/);
    }
  });
});
