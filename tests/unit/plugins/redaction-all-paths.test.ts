/**
 * DUSTSEC.8 (R6) — a plugin's redaction rule applies on EVERY redaction path.
 *
 * Before: only the proxy and `mcp serve` loaded plugins, so the hook, vibe,
 * join-queue and note paths (other processes) used the built-in table and
 * stored an org-private token format raw. Each probe below stores or forwards
 * the token through one of those paths and asserts it is gone.
 *
 * "A different process" is simulated by resetting the module's plugin state
 * between tests: it starts with built-ins only, exactly like a fresh hook.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendNote } from "../../../src/cli/notes.js";
import { type HookIo, runPostToolUseHook, runWebFetchPost } from "../../../src/hooks/index.js";
import { WebCache, webCacheDir } from "../../../src/knowledge/web-cache.js";
import {
  activeRedactionRules,
  resetExtraRedactionRulesForTests,
} from "../../../src/pipeline/redaction-rules.js";
import { ensurePluginRedactionRules } from "../../../src/plugins/index.js";
import { resetEnsurePluginRedactionRulesForTests } from "../../../src/plugins/redaction-init.js";
import { FileJoinQueue } from "../../../src/session/join-queue.js";
import { openVibeStore } from "../../../src/vibe/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-dsec8-");

/** An org-private format no built-in knows: ACME-EMP- plus six digits. */
const TOKEN = "ACME-EMP-123456";

const PLUGIN_SRC = `export default {
  name: "acme",
  version: "0.1.0",
  setup(api) {
    api.addRedactionRule({
      id: "employee-id",
      description: "ACME employee ids",
      pattern: /ACME-EMP-\\d{6}/g,
    });
  },
};
`;

let base: string;
let projectDir: string;

async function writeProject(settings: unknown, plugin: string | null = PLUGIN_SRC): Promise<void> {
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
  await writeFile(
    path.join(projectDir, ".golem", "settings.json"),
    `${JSON.stringify(settings)}\n`,
    "utf8",
  );
  if (plugin !== null) await writeFile(path.join(projectDir, "acme-plugin.mjs"), plugin, "utf8");
}

const WITH_PLUGIN = { plugins: { load: ["./acme-plugin.mjs"] } };

beforeEach(async () => {
  base = await newTempDir();
  projectDir = path.join(base, "project");
  resetExtraRedactionRulesForTests();
  resetEnsurePluginRedactionRulesForTests();
});

afterEach(() => {
  resetExtraRedactionRulesForTests();
  resetEnsurePluginRedactionRulesForTests();
});

function fakeIo(input: string): HookIo & { err: string[] } {
  const err: string[] = [];
  return {
    stdin: (async function* () {
      yield input;
    })(),
    stdout: { write: () => true },
    stderr: { write: (t: string) => err.push(t) },
    err,
  };
}

describe("ensurePluginRedactionRules", () => {
  it("appends the plugin rule after every built-in", async () => {
    await writeProject(WITH_PLUGIN);
    const builtIns = activeRedactionRules().map((r) => r.id);
    await ensurePluginRedactionRules(projectDir);
    const ids = activeRedactionRules().map((r) => r.id);
    expect(ids.slice(0, builtIns.length)).toEqual(builtIns);
    expect(ids.at(-1)).toBe("acme/employee-id");
  });

  it("is a no-op, with no stderr, when no plugin is configured", async () => {
    await writeProject({});
    const before = activeRedactionRules().length;
    await ensurePluginRedactionRules(projectDir);
    expect(activeRedactionRules().length).toBe(before);
  });

  it("a broken plugin leaves the built-ins in force and says so on stderr", async () => {
    await writeProject(WITH_PLUGIN, "throw new Error('boom');\n");
    const written: string[] = [];
    const real = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      await ensurePluginRedactionRules(projectDir);
    } finally {
      process.stderr.write = real;
    }
    expect(activeRedactionRules().length).toBeGreaterThan(10);
    expect(written.join("")).toMatch(/plugin problem/);
  });
});

describe("a plugin rule redacts on the hook, vibe, join-queue and note paths", () => {
  it("(a) PostToolUse: the CCR-stored original has the token redacted", async () => {
    await writeProject(WITH_PLUGIN);
    const big = `${"filler line\n".repeat(4000)}owner ${TOKEN}\n`;
    const io = fakeIo(
      JSON.stringify({
        session_id: "s1",
        cwd: projectDir,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
        tool_response: big,
      }),
    );
    expect(await runPostToolUseHook(io, { projectDir })).toBe(0);
    // Whatever the CCR store wrote for this call, read straight off disk.
    const dir = path.join(projectDir, ".golem", "ccr");
    const files = await readdir(dir, { recursive: true });
    const all = (
      await Promise.all(files.map((f) => readFile(path.join(dir, f), "utf8").catch(() => "")))
    ).join("\n");
    expect(all).toContain("[REDACTED:acme/employee-id:");
    expect(all).not.toContain(TOKEN);
  });

  it("(a) WebFetch post hook: the cached page has the token redacted", async () => {
    await writeProject(WITH_PLUGIN);
    const io = fakeIo(
      JSON.stringify({
        session_id: "s1",
        cwd: projectDir,
        hook_event_name: "PostToolUse",
        tool_name: "WebFetch",
        tool_input: { url: "https://example.test/page", prompt: "x" },
        tool_response: `contact ${TOKEN} for access`,
      }),
    );
    await runWebFetchPost(io, { projectDir });
    const entry = await new WebCache(webCacheDir(projectDir)).get("https://example.test/page");
    expect(entry?.content).toContain("[REDACTED:acme/employee-id:");
    expect(entry?.content).not.toContain(TOKEN);
  });

  it("(b) vibe store write: the stored brief has the token redacted", async () => {
    await writeProject(WITH_PLUGIN);
    const userDir = path.join(base, "home", ".golem");
    const store = openVibeStore({ cwd: projectDir, userDir, rootDir: base });
    if (store === null) throw new Error("fixture is not a Golem project");
    await store.writeBrief(`# Vibe\n\nUse ${TOKEN} as the example id.\n`);
    const raw = await readFile(store.paths.brief, "utf8");
    expect(raw).toContain("[REDACTED:acme/employee-id:");
    expect(raw).not.toContain(TOKEN);
  });

  it("(c) join-queue enqueue: the stored message has the token redacted", async () => {
    await writeProject(WITH_PLUGIN);
    const queue = new FileJoinQueue({ projectDir, resolve: async () => ({ ok: true }) });
    const result = await queue.enqueue({
      conversationId: "a1b2c3d4e5f60718",
      deviceId: "phone-1",
      messageId: "m1",
      text: `ping ${TOKEN}`,
    });
    expect(result.status).toBe("queued");
    if (result.status !== "queued") return;
    expect(result.message.text).toContain("[REDACTED:acme/employee-id:");
    expect(result.message.text).not.toContain(TOKEN);
  });

  it("(d) golem note: the stored note has the token redacted", async () => {
    await writeProject(WITH_PLUGIN);
    const entry = await appendNote(projectDir, `remember ${TOKEN}`, "2026-10-08T00:00:00.000Z");
    expect(entry.text).toContain("[REDACTED:acme/employee-id:");
    expect(entry.text).not.toContain(TOKEN);
  });

  it("control: with no plugin configured the token is stored as-is (the probe is real)", async () => {
    await writeProject({});
    const entry = await appendNote(projectDir, `remember ${TOKEN}`, "2026-10-08T00:00:00.000Z");
    expect(entry.text).toContain(TOKEN);
  });
});
