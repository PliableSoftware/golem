/**
 * DUST3.13 — `golem dashboard` / `golem watch` command wiring (D2, D5).
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  statsSourceForCli: vi.fn(),
  startDashboard: vi.fn(),
  runWatch: vi.fn(),
}));

vi.mock("../../../../src/cli/mcp-compression.js", () => ({
  statsSourceForCli: hoisted.statsSourceForCli,
}));
vi.mock("../../../../src/dashboard/index.js", () => ({
  LAN_HOST: "0.0.0.0",
  startDashboard: hoisted.startDashboard,
  lanUrls: () => [],
}));
vi.mock("../../../../src/cli/watch.js", () => ({ runWatch: hoisted.runWatch }));

import register from "../../../../src/cli/commands/note-dashboard-watch.js";

function program(): Command {
  const p = new Command().exitOverride();
  register(p);
  return p;
}

describe("note-dashboard-watch commands", () => {
  let exitSpy: MockInstance;
  beforeEach(() => {
    hoisted.statsSourceForCli.mockReset();
    hoisted.startDashboard.mockReset();
    hoisted.runWatch.mockReset();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("D2: the dashboard resolves its stats source on every poll, not once at startup", async () => {
    const source = {
      kind: "live",
      stats: async () => ({
        projectId: null,
        requests: 0,
        tokensBefore: 0,
        tokensAfter: 0,
        perStage: {},
        ccrRefsStored: 0,
        ccrRefsRetrieved: 0,
      }),
    };
    hoisted.statsSourceForCli.mockResolvedValue(source);
    let snapshot: (() => Promise<unknown>) | undefined;
    hoisted.startDashboard.mockImplementation(async (o: { snapshot: () => Promise<unknown> }) => {
      snapshot = o.snapshot;
      return { url: "http://127.0.0.1:1/", port: 1, close: async () => {} };
    });
    await program().parseAsync([
      "node",
      "golem",
      "dashboard",
      "--dir",
      process.cwd(),
      "--port",
      "0",
    ]);
    expect(snapshot).toBeDefined();
    await snapshot?.();
    await snapshot?.();
    // Once per poll; none at startup.
    expect(hoisted.statsSourceForCli).toHaveBeenCalledTimes(2);
  });

  it("D5: `golem watch` with no flag leaves colour to the TTY/NO_COLOR check", async () => {
    await program().parseAsync(["node", "golem", "watch", "--dir", process.cwd()]);
    expect(hoisted.runWatch).toHaveBeenCalledTimes(1);
    expect(hoisted.runWatch.mock.calls[0]?.[0]).not.toHaveProperty("color", true);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("D5: `--no-color` forces colour off", async () => {
    await program().parseAsync(["node", "golem", "watch", "--dir", process.cwd(), "--no-color"]);
    expect(hoisted.runWatch.mock.calls[0]?.[0]).toHaveProperty("color", false);
  });
});
