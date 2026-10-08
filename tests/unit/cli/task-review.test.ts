/**
 * `golem task review --waive` must name what it waives. With no id and no
 * `--all` it used to waive every outstanding delegated run in one call.
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "../../../src/cli/commands/tasks.js";
import {
  appendDelegation,
  readDelegationLedger,
  recordDelegation,
  unreviewedDelegations,
  writeDelegationLedger,
} from "../../../src/hooks/delegation-ledger.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-task-review-");
const NOW = "2026-10-08T12:00:00.000Z";

let dir: string;
let exitCode: number | undefined;

async function run(args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  register(program);
  try {
    await program.parseAsync(["node", "golem", "task", "review", ...args, "--dir", dir]);
  } catch {
    // process.exit is stubbed to throw
  }
}

beforeEach(async () => {
  dir = await newTempDir();
  exitCode = undefined;
  let ledger = appendDelegation({ delegations: [] }, { at: NOW, agentType: "golem-coder" });
  ledger = appendDelegation(ledger, { at: NOW, agentType: "golem-scribe" });
  await writeDelegationLedger(dir, ledger);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode = code;
    throw new Error("exit");
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("golem task review --waive", () => {
  it("refuses with no id and no --all, waiving nothing", async () => {
    await run(["--waive", "because"]);
    expect(exitCode).toBe(2);
    expect(unreviewedDelegations(await readDelegationLedger(dir))).toHaveLength(2);
  });

  it("waives exactly one run when given an id", async () => {
    const [first] = (await readDelegationLedger(dir)).delegations;
    await run([first?.id as string, "--waive", "because"]);
    expect(exitCode).toBeUndefined();
    expect(unreviewedDelegations(await readDelegationLedger(dir))).toHaveLength(1);
  });

  it("waives every run only with an explicit --all", async () => {
    await run(["--all", "--waive", "because"]);
    expect(exitCode).toBeUndefined();
    expect(unreviewedDelegations(await readDelegationLedger(dir))).toHaveLength(0);
  });
});

describe("golem task review vs a concurrent spawn", () => {
  it("never erases a delegation recorded while the review runs", async () => {
    await Promise.all([
      run(["--all"]),
      recordDelegation(dir, { at: NOW, agentType: "golem-reviewer" }),
    ]);
    const { delegations } = await readDelegationLedger(dir);
    expect(delegations).toHaveLength(3);
  });
});
