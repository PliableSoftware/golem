/**
 * DUST2.19 — a hosted session parks at the usage limit like any other: the host
 * gate redirects to `snooze` (which files its `note` as a durable task) and writes
 * a `parked` lifecycle line, and leaves the park tool itself reachable.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { runHostGateHook } from "../../../src/hooks/host-gate.js";
import type { LimitPrediction } from "../../../src/proxy/limit-prediction.js";
import { readHostLog } from "../../../src/session/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-hostgate-park-");

const NOW = Date.parse("2026-10-20T12:00:00Z");
const RESET = "2026-10-20T15:00:00Z";

function prediction(utilization: number): LimitPrediction {
  return {
    observedAtIso: new Date(NOW - 1000).toISOString(),
    fiveHour: { utilization, resetAtIso: RESET },
  };
}

function io(input: string) {
  const mk = () => ({
    text: "",
    write(s: string) {
      this.text += s;
    },
  });
  return {
    stdin: (async function* () {
      yield input;
    })(),
    stdout: mk(),
    stderr: mk(),
  };
}

const payload = (tool: string, cwd: string) =>
  JSON.stringify({ tool_name: tool, tool_input: { file_path: "x" }, cwd, session_id: "s1" });

describe("host gate: usage-limit park", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await newTempDir();
  });

  const run = (tool: string, util: number, enforce = false) => {
    const h = io(payload(tool, dir));
    const done = runHostGateHook(h, {
      projectDir: dir,
      sessionId: "s1",
      readPrediction: async () => prediction(util),
      isSnoozeEnforced: async () => enforce,
      readLevel: async () => "assisted",
      now: () => NOW,
    });
    return { h, done };
  };

  it("denies an otherwise-allowed call near the limit, pointing at snooze with the reset", async () => {
    const { h, done } = run("Read", 0.95);
    expect(await done).toBe(0);
    const out = JSON.parse(h.stdout.text).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain("mcp__golem__snooze");
    expect(out.permissionDecisionReason).toContain(RESET);
  });

  it("records a parked lifecycle line", async () => {
    await run("Read", 0.95).done;
    const entries = await readHostLog(dir);
    expect(entries.some((e) => e.kind === "lifecycle" && e.event === "parked")).toBe(true);
  });

  it("advisory mode redirects once per window, then lets calls through", async () => {
    await run("Read", 0.95).done;
    const second = run("Read", 0.95);
    await second.done;
    expect(second.h.stdout.text).toBe("");
  });

  it("enforcing mode keeps denying every call", async () => {
    await run("Read", 0.95, true).done;
    const second = run("Read", 0.95, true);
    await second.done;
    expect(JSON.parse(second.h.stdout.text).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("never blocks the park tool itself", async () => {
    const { h, done } = run("mcp__golem__snooze", 0.95, true);
    await done;
    expect(h.stdout.text).toBe("");
  });

  it("does nothing below the threshold", async () => {
    const { h, done } = run("Read", 0.2);
    await done;
    expect(h.stdout.text).toBe("");
  });
});
