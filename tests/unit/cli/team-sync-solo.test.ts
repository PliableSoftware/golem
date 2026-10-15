/**
 * `golem team sync` on the DEFAULT solo install (DUST3.14).
 *
 * `portalContext()` resolves the portal config, which THROWS when no portal is
 * configured, and it ran before the unlinked early return. A solo user got
 * exit 2 and a portal-setup complaint instead of "nothing to sync". Same shape
 * as the `team status` fix in `team-status-solo.test.ts`.
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import registerTeam from "../../../src/cli/commands/team.js";

describe("golem team sync, unlinked project, no portal configured", () => {
  let dir: string;
  let home: string;
  const savedHome = process.env.HOME;
  const savedUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "golem-team-sync-proj-"));
    home = await mkdtemp(path.join(os.tmpdir(), "golem-team-sync-home-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    if (savedHome === undefined) process.env.HOME = undefined;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) process.env.USERPROFILE = undefined;
    else process.env.USERPROFILE = savedUserProfile;
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it("says there is nothing to sync and does not exit non-zero", async () => {
    let out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    const program = new Command();
    program.exitOverride();
    registerTeam(program);
    await program.parseAsync(["node", "golem", "team", "sync", "--dir", dir]);

    expect(exit).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(out).toContain("nothing to sync");
  });
});
