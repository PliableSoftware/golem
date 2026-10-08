/**
 * DUST3.4 — `golem ps` must not advertise a process kind no collector emits.
 * The dashboard has no pidfile, so `ps` can never list it.
 */

import { Command } from "commander";
import { describe, expect, it } from "vitest";
import register from "../../src/cli/commands/ps.js";

describe("golem ps help", () => {
  it("does not claim to list dashboard processes", () => {
    const program = new Command();
    register(program);
    const description = program.commands.find((c) => c.name() === "ps")?.description() ?? "";
    expect(description).toContain("proxy");
    expect(description).not.toContain("dashboard");
  });
});
