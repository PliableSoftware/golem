/**
 * DUSTSEC.10 (USER decision 2026-10-09) — the PermissionRequest hook returns NO
 * decision for any class at any autonomy level, so a destructive or outward call
 * reaches Claude Code's NATIVE permission dialog and a human decides. The R12.12
 * unconditional `deny` is gone; `allow` is never emitted (ADR-0002 invariant 5).
 *
 * Recorded-shape only. Whether a connected channel's permission relay is notified
 * when that dialog opens is R12.13, still unconfirmed (owner: user).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { AUTONOMY_LEVELS, writeAutonomyLevel } from "../../../src/autonomy/index.js";
import { runPermissionRequestHook } from "../../../src/hooks/permission-request.js";
import { runPreToolUseHook } from "../../../src/hooks/pre-tool-use.js";
import { useTempDirs } from "../../helpers/tmp.js";

/** Minimal HookIo capturing stdout/stderr, feeding a fixed stdin string. */
function io(input: string) {
  const out = {
    text: "",
    write(s: string) {
      this.text += s;
    },
  };
  const err = {
    text: "",
    write(s: string) {
      this.text += s;
    },
  };
  return {
    stdin: (async function* () {
      yield input;
    })(),
    stdout: out,
    stderr: err,
  };
}

/**
 * The documented `PermissionRequest` payload shape (hooks reference): like
 * `PreToolUse` but with NO `tool_use_id`, plus an optional `permission_suggestions`
 * array carrying the dialog's "always allow" options.
 */
function payload(toolName: string, toolInput: unknown, cwd: string): string {
  return JSON.stringify({
    session_id: "abc123",
    transcript_path: "/tmp/t.jsonl",
    cwd,
    permission_mode: "default",
    hook_event_name: "PermissionRequest",
    tool_name: toolName,
    tool_input: toolInput,
  });
}

const newTempDir = useTempDirs("golem-permreq-");

describe("runPermissionRequestHook", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await newTempDir();
  });

  // The pre-DUSTSEC.10 contract was a `deny` here. Native flow = no stdout.
  it.each(AUTONOMY_LEVELS)("emits NO decision for an outward Bash at level %s", async (level) => {
    await writeAutonomyLevel(dir, level);
    const h = io(payload("Bash", { command: "git push origin main" }, dir));
    expect(await runPermissionRequestHook(h, { projectDir: dir })).toBe(0);
    expect(h.stdout.text).toBe("");
  });

  it.each(
    AUTONOMY_LEVELS,
  )("emits NO decision for a destructive Bash at level %s", async (level) => {
    await writeAutonomyLevel(dir, level);
    const h = io(payload("Bash", { command: "rm -rf node_modules" }, dir));
    expect(await runPermissionRequestHook(h, { projectDir: dir })).toBe(0);
    expect(h.stdout.text).toBe("");
  });

  it("never emits `allow` or `deny` — no class, no level, no input", async () => {
    for (const level of AUTONOMY_LEVELS) {
      await writeAutonomyLevel(dir, level);
      for (const [tool, input] of [
        ["Read", { file_path: "x" }],
        ["Write", { file_path: "x" }],
        ["Bash", { command: "ls -la" }],
        ["Bash", { command: "rm -rf x" }],
        ["Bash", { command: "git push" }],
        ["SomeUnknownTool", {}],
      ] as const) {
        const h = io(payload(tool, input, dir));
        await runPermissionRequestHook(h, { projectDir: dir });
        expect(h.stdout.text, `${level} ${tool} ${JSON.stringify(input)}`).toBe("");
      }
    }
  });

  it("DEFERS (no stdout) for a read", async () => {
    const h = io(payload("Read", { file_path: "x" }, dir));
    expect(await runPermissionRequestHook(h, { projectDir: dir })).toBe(0);
    expect(h.stdout.text).toBe("");
  });

  it("DEFERS (no stdout) for a write", async () => {
    const h = io(payload("Write", { file_path: "x" }, dir));
    await runPermissionRequestHook(h, { projectDir: dir });
    expect(h.stdout.text).toBe("");
  });

  // Fail-closed at PreToolUse means `ask` — make the human decide. It does NOT
  // mean deciding for them one event earlier, so `unknown` defers here.
  it("DEFERS for an unknown action — never allowed here, the human decides", async () => {
    const h = io(payload("SomeUnknownTool", { whatever: 1 }, dir));
    await runPermissionRequestHook(h, { projectDir: dir });
    expect(h.stdout.text).toBe("");
  });

  // `permission_suggestions` are the dialog's "always allow" options. Echoing one
  // back is how a hook grants a standing allow, so a payload carrying them must
  // still produce nothing.
  it("emits NOTHING when the payload carries permission_suggestions", async () => {
    const raw = JSON.parse(payload("Bash", { command: "git push origin main" }, dir));
    raw.permission_suggestions = [
      {
        type: "addRules",
        rules: [{ toolName: "Bash", ruleContent: "git push:*" }],
        behavior: "allow",
        destination: "localSettings",
      },
    ];
    const h = io(JSON.stringify(raw));
    expect(await runPermissionRequestHook(h, { projectDir: dir })).toBe(0);
    expect(h.stdout.text).toBe("");
  });

  it("emits NOTHING for a non-Bash outward tool (wiki_upsert)", async () => {
    const h = io(payload("mcp__golem__wiki_upsert", { title: "x" }, dir));
    await runPermissionRequestHook(h, { projectDir: dir });
    expect(h.stdout.text).toBe("");
  });

  it("NEVER emits a decision on unparseable stdin", async () => {
    const h = io("{ not json");
    expect(await runPermissionRequestHook(h, { projectDir: dir })).toBe(0);
    expect(h.stdout.text).toBe("");
  });

  it("NEVER emits a decision on a payload with no tool_name", async () => {
    const h = io(JSON.stringify({ cwd: dir, tool_input: { command: "rm -rf /" } }));
    expect(await runPermissionRequestHook(h, { projectDir: dir })).toBe(0);
    expect(h.stdout.text).toBe("");
  });

  it("NEVER emits a decision on a JSON array payload", async () => {
    const h = io("[1,2,3]");
    await runPermissionRequestHook(h, { projectDir: dir });
    expect(h.stdout.text).toBe("");
  });

  it("fails SAFE (exit 0, no stdout) when stdin errors mid-read", async () => {
    const h = {
      ...io(""),
      stdin: (async function* () {
        yield "{";
        throw new Error("pipe gone");
      })(),
    };
    expect(await runPermissionRequestHook(h, { projectDir: dir })).toBe(0);
    expect(h.stdout.text).toBe("");
  });
});

describe("the PreToolUse layer is unchanged by DUSTSEC.10", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await newTempDir();
  });

  // The PermissionRequest hook is now inert, so this `ask` is the ONLY Golem
  // layer in front of a destructive step.
  it("still emits `ask` for a destructive Bash, byte-for-byte", async () => {
    const h = io(
      JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "rm -rf node_modules" },
        cwd: dir,
        session_id: "s1",
      }),
    );
    await runPreToolUseHook(h, { projectDir: dir, readLevel: () => Promise.resolve("outcome") });
    const out = JSON.parse(h.stdout.text);
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it("still emits `ask` for an outward Bash, byte-for-byte", async () => {
    const h = io(
      JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "git push origin main" },
        cwd: dir,
        session_id: "s1",
      }),
    );
    await runPreToolUseHook(h, { projectDir: dir, readLevel: () => Promise.resolve("outcome") });
    const out = JSON.parse(h.stdout.text);
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it.each(
    AUTONOMY_LEVELS,
  )("never emits `allow` for destructive/outward at level %s", async (level) => {
    for (const command of ["rm -rf node_modules", "git push origin main"]) {
      const h = io(
        JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: dir, session_id: "s1" }),
      );
      await runPreToolUseHook(h, { projectDir: dir, readLevel: () => Promise.resolve(level) });
      expect(
        JSON.parse(h.stdout.text).hookSpecificOutput.permissionDecision,
        `${level} ${command}`,
      ).toBe("ask");
    }
  });

  // Non-Bash outward tool: the `ask` is the only Golem layer, so pin it per level.
  it.each(
    AUTONOMY_LEVELS,
  )("emits `ask` for the outward wiki_upsert tool at level %s", async (level) => {
    const h = io(
      JSON.stringify({
        tool_name: "mcp__golem__wiki_upsert",
        tool_input: { title: "x" },
        cwd: dir,
        session_id: "s1",
      }),
    );
    await runPreToolUseHook(h, { projectDir: dir, readLevel: () => Promise.resolve(level) });
    expect(JSON.parse(h.stdout.text).hookSpecificOutput.permissionDecision).toBe("ask");
  });
});
