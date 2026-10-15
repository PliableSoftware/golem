/**
 * DUSTSEC.3 — PreToolUse denies agent tool calls that set `proxy.bypass_all`.
 * Pure-guard table first, then the hook itself: the deny must hold at every
 * autonomy level, with the gate disabled, and never become an allow.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AutonomyLevel } from "../../../src/autonomy/index.js";
import { BYPASS_DENY_REASON, bypassGuardReason } from "../../../src/hooks/bypass-guard.js";
import { runPreToolUseHook } from "../../../src/hooks/pre-tool-use.js";
import { useTempDirs } from "../../helpers/tmp.js";

const bash = (command: string) => bypassGuardReason("Bash", { command });

describe("bypassGuardReason: Bash", () => {
  it.each([
    "golem off",
    "golem off --dir /tmp/x",
    "golem --dir /tmp/x off",
    "FOO=1 golem off",
    "GOLEM_X=1 NODE_ENV=test golem off",
    "npx golem off",
    "npx -y golem-run off",
    "npx @pliable/golem off",
    "pnpm dlx golem-run@latest off",
    "/usr/local/bin/golem off",
    "C:\\tools\\golem.cmd off",
    "echo hi; golem off",
    "echo hi && golem off",
    "false || golem off",
    "echo hi\ngolem off",
    "ls | golem off",
    "echo $(golem off)",
    "bash -c 'golem off'",
    'sh -c "cd /tmp; golem off"',
    "sudo golem off",
    "golem config set proxy.bypass_all true",
    "golem config set proxy.bypass_all=true",
    "golem config set --scope project proxy.bypass_all true",
    "golem config set --json proxy.bypass_all true",
    "golem --dir /x config set proxy.bypass_all 1",
    "npx golem-run config set proxy.bypass_all true",
    "golem config set proxy '{\"bypass_all\":true}'",
    "GOLEM_PROXY_BYPASS_ALL=true golem proxy restart",
    "export GOLEM_PROXY_BYPASS_ALL=1",
  ])("denies %j", (command) => {
    expect(bash(command)).toBe(BYPASS_DENY_REASON);
  });

  it("names bypass_all in the reason", () => {
    expect(BYPASS_DENY_REASON).toContain("bypass_all");
  });

  it.each([
    "golem status",
    "golem on",
    "golem compression off",
    "golem compression 1",
    "golem --dir /x compression off",
    "golem config set compression.level off",
    "golem config get proxy.bypass_all",
    "golem config list",
    "golem proxy restart",
    "golem proxy stop",
    "GOLEM_PROXY_BYPASS_ALL=false golem proxy restart",
    'grep -rn "golem off" docs',
    "grep -rn bypass_all src",
    "echo golem off",
    "cat .golem/settings.local.json",
    "git commit -m 'document golem off'",
    "npm test",
  ])("does not deny %j", (command) => {
    expect(bash(command)).toBeUndefined();
  });
});

describe("bypassGuardReason: settings-file writes", () => {
  it("denies a Write of a .golem settings file that sets bypass_all", () => {
    expect(
      bypassGuardReason("Write", {
        file_path: "/p/.golem/settings.local.json",
        content: '{"proxy":{"bypass_all":true}}',
      }),
    ).toBeDefined();
  });

  it("denies an Edit and a MultiEdit, with a Windows path", () => {
    expect(
      bypassGuardReason("Edit", {
        file_path: "C:\\p\\.golem\\settings.json",
        old_string: "false",
        new_string: '"bypass_all": true',
      }),
    ).toBeDefined();
    expect(
      bypassGuardReason("MultiEdit", {
        file_path: "/p/.golem/settings.local.json",
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "bypass_all: yes" },
        ],
      }),
    ).toBeDefined();
  });

  it("denies a bypass_all mention it cannot read a value from", () => {
    expect(
      bypassGuardReason("Write", { file_path: "/p/.golem/settings.json", content: "bypass_all" }),
    ).toBeDefined();
  });

  it("allows bypass_all: false, other files, and unrelated settings edits", () => {
    expect(
      bypassGuardReason("Write", {
        file_path: "/p/.golem/settings.local.json",
        content: '{"proxy":{"bypass_all":false}}',
      }),
    ).toBeUndefined();
    expect(
      bypassGuardReason("Write", { file_path: "/p/src/notes.md", content: "bypass_all: true" }),
    ).toBeUndefined();
    expect(
      bypassGuardReason("Write", {
        file_path: "/p/.golem/settings.local.json",
        content: '{"compression":{"level":"1"}}',
      }),
    ).toBeUndefined();
  });

  it("ignores tools it does not own and malformed input", () => {
    expect(bypassGuardReason("Read", { file_path: "/p/.golem/settings.json" })).toBeUndefined();
    expect(bypassGuardReason("Bash", "golem off")).toBeUndefined();
    expect(bypassGuardReason("Bash", { command: 5 })).toBeUndefined();
  });
});

describe("bypassGuardReason: wrappers with flag values (review finding 2)", () => {
  it.each([
    "timeout 30 golem off",
    "timeout -s KILL 30 golem off",
    "nice -n 5 golem off",
    "sudo -u me golem off",
    "sudo -u me -g wheel golem off",
    "env -u FOO golem off",
    "echo off | xargs golem",
    "echo off | xargs -n1 golem",
    "bash -c 'echo hi; golem off'",
    'echo "$(golem off)"',
    "nohup nice -n 5 timeout 9 golem off",
  ])("denies %j", (command) => {
    expect(bash(command)).toBe(BYPASS_DENY_REASON);
  });

  it.each([
    "timeout 30 golem status",
    "nice -n 5 golem status",
    "sudo -u me golem status",
    "ls | xargs golem status",
  ])("does not deny %j", (command) => {
    expect(bash(command)).toBeUndefined();
  });
});

describe("bypassGuardReason: quoted separators are text (review finding 3)", () => {
  it.each([
    'grep -E "x|golem off" docs',
    "grep -E 'x|golem off' docs",
    'git commit -m "docs (golem off)"',
    'git commit -m "fix; golem off handling"',
    'rg "a && golem off" src',
    "bash -c 'grep \"x|golem off\" docs'",
  ])("does not deny %j", (command) => {
    expect(bash(command)).toBeUndefined();
  });

  it("still splits on a separator outside the quotes", () => {
    expect(bash('echo "a|b" | golem off')).toBe(BYPASS_DENY_REASON);
    expect(bash('echo "a;b"; golem off')).toBe(BYPASS_DENY_REASON);
  });
});

describe("bypassGuardReason: Edit is judged on the resulting file (review finding 1)", () => {
  const dirOf = useTempDirs("golem-bypass-edit-");

  async function settings(body: string): Promise<string> {
    const dir = await dirOf();
    await mkdir(join(dir, ".golem"), { recursive: true });
    const file = join(dir, ".golem", "settings.local.json");
    await writeFile(file, body);
    return file;
  }

  it("denies flipping the value alone", async () => {
    const file = await settings('{"proxy":{"bypass_all":false}}');
    expect(
      bypassGuardReason("Edit", { file_path: file, old_string: "false", new_string: "true" }),
    ).toBe(BYPASS_DENY_REASON);
  });

  it("denies a MultiEdit and a replace_all that leave it true", async () => {
    const file = await settings('{"a":1,"proxy":{"bypass_all":false}}');
    expect(
      bypassGuardReason("MultiEdit", {
        file_path: file,
        edits: [
          { old_string: '"a":1', new_string: '"a":2' },
          { old_string: "false", new_string: "true" },
        ],
      }),
    ).toBe(BYPASS_DENY_REASON);
    expect(
      bypassGuardReason("Edit", {
        file_path: file,
        old_string: "false",
        new_string: "true",
        replace_all: true,
      }),
    ).toBe(BYPASS_DENY_REASON);
  });

  it("allows an edit that leaves bypass_all false", async () => {
    const file = await settings('{"a":1,"proxy":{"bypass_all":false}}');
    expect(
      bypassGuardReason("Edit", { file_path: file, old_string: '"a":1', new_string: '"a":2' }),
    ).toBeUndefined();
  });

  it("fails closed when the file cannot be read or old_string is absent", async () => {
    const file = await settings('{"proxy":{"bypass_all":false}}');
    expect(
      bypassGuardReason("Edit", { file_path: file, old_string: "nope", new_string: "x" }),
    ).toBe(BYPASS_DENY_REASON);
    expect(
      bypassGuardReason("Edit", {
        file_path: file.replace("settings.local", "missing"),
        old_string: "false",
        new_string: "true",
      }),
    ).toBe(BYPASS_DENY_REASON);
  });
});

function io(input: string) {
  const sink = () => ({
    text: "",
    write(s: string) {
      this.text += s;
    },
  });
  return {
    stdin: (async function* () {
      yield input;
    })(),
    stdout: sink(),
    stderr: sink(),
  };
}

const newTempDir = useTempDirs("golem-bypass-guard-");

describe("PreToolUse hook: bypass guard", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await newTempDir();
  });
  const call = (command: string) =>
    JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: dir, session_id: "s" });

  it.each<AutonomyLevel>([
    "manual",
    "assisted",
    "outcome",
  ])("denies `golem off` at autonomy level %s", async (level) => {
    const h = io(call("golem off"));
    await runPreToolUseHook(h, { projectDir: dir, readLevel: () => Promise.resolve(level) });
    const out = JSON.parse(h.stdout.text);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("bypass_all");
  });

  it("denies with the autonomy gate DISABLED (it is a redaction guard, not an autonomy rule)", async () => {
    const h = io(call("golem config set proxy.bypass_all true"));
    await runPreToolUseHook(h, { projectDir: dir, readGateEnabled: () => Promise.resolve(false) });
    expect(JSON.parse(h.stdout.text).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("denies a settings-file Write through the hook", async () => {
    const h = io(
      JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: `${dir}/.golem/settings.local.json`, content: "bypass_all: true" },
        cwd: dir,
      }),
    );
    await runPreToolUseHook(h, { projectDir: dir, readLevel: () => Promise.resolve("outcome") });
    expect(JSON.parse(h.stdout.text).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("a plain `golem status` is not denied", async () => {
    const h = io(call("golem status"));
    await runPreToolUseHook(h, { projectDir: dir, readLevel: () => Promise.resolve("outcome") });
    const decision = h.stdout.text === "" ? null : JSON.parse(h.stdout.text);
    expect(decision?.hookSpecificOutput?.permissionDecision).not.toBe("deny");
  });

  it("never emits allow for a bypass call, even at outcome level where Bash may auto-allow", async () => {
    const h = io(call("golem off"));
    await runPreToolUseHook(h, { projectDir: dir, readLevel: () => Promise.resolve("outcome") });
    expect(h.stdout.text).not.toContain('"allow"');
  });
});
