/**
 * The spawn gate and the delegation ledger are load -> decide -> save files hit
 * by concurrent hook processes. Atomic writes alone lose updates; these pin that
 * concurrent recorders all land.
 */

import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  delegationLedgerPath,
  readDelegationLedger,
  recordDelegation,
  updateDelegationLedger,
} from "../../../src/hooks/delegation-ledger.js";
import {
  readSpawnGateState,
  recordSpawn,
  updateSpawnGateState,
} from "../../../src/hooks/spawn-gate.js";
import { withFileLock } from "../../../src/hooks/state-lock.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-state-lock-");
const NOW_MS = Date.parse("2026-08-22T12:00:00.000Z");
const N = 12;

describe("updateSpawnGateState", () => {
  it("serialises concurrent read-modify-write so every recorder lands", async () => {
    const dir = await newTempDir();
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        updateSpawnGateState(dir, (state) =>
          recordSpawn(state, NOW_MS, new Date(NOW_MS + i).toISOString()),
        ),
      ),
    );
    expect((await readSpawnGateState(dir)).spawnsAtIso).toHaveLength(N);
  });
});

describe("recordDelegation", () => {
  it("serialises concurrent recorders so none is lost and ids stay unique", async () => {
    const dir = await newTempDir();
    const at = "2026-08-30T12:00:00.000Z";
    await Promise.all(
      Array.from({ length: N }, () => recordDelegation(dir, { at, agentType: "golem-coder" })),
    );
    const { delegations } = await readDelegationLedger(dir);
    expect(delegations).toHaveLength(N);
    expect(new Set(delegations.map((d) => d.id)).size).toBe(N);
  });
});

describe("updateDelegationLedger", () => {
  it("holds the lock across an async read-modify-write, so a concurrent record is not erased", async () => {
    const dir = await newTempDir();
    const at = "2026-08-30T12:00:00.000Z";
    await recordDelegation(dir, { at, agentType: "first" });
    const slow = updateDelegationLedger(dir, async (ledger) => {
      await new Promise((r) => setTimeout(r, 80));
      return { ledger: { delegations: [...ledger.delegations] }, result: undefined };
    });
    await new Promise((r) => setTimeout(r, 20));
    await recordDelegation(dir, { at, agentType: "second" });
    await slow;
    expect((await readDelegationLedger(dir)).delegations.map((d) => d.agentType)).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("withFileLock hardening", () => {
  it("does not delete a successor's lock on release (owner token)", async () => {
    const dir = await newTempDir();
    const file = delegationLedgerPath(dir);
    await withFileLock(file, async () => {
      await writeFile(`${file}.lock`, "someone-else", "utf8"); // lock taken over
    });
    expect(await readFile(`${file}.lock`, "utf8")).toBe("someone-else");
  });

  it("breaks a stale lock", async () => {
    const dir = await newTempDir();
    const file = delegationLedgerPath(dir);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.lock`, "dead-holder", "utf8");
    const old = new Date(Date.now() - 60_000);
    await utimes(`${file}.lock`, old, old);
    expect(await withFileLock(file, () => Promise.resolve("ran"), { timeoutMs: 1000 })).toBe("ran");
  });

  it("is bounded when a live lock never frees, and says so on stderr", async () => {
    const dir = await newTempDir();
    const file = delegationLedgerPath(dir);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.lock`, "live-holder", "utf8"); // fresh, never released
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const started = Date.now();
    const out = await withFileLock(file, () => Promise.resolve("ran"), {
      timeoutMs: 150,
    });
    const written = err.mock.calls.map((c) => String(c[0])).join("");
    err.mockRestore();
    expect(out).toBe("ran");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(written).toContain("not acquired");
  });
});
