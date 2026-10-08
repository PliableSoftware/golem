/**
 * The spawn gate and the delegation ledger are load -> decide -> save files hit
 * by concurrent hook processes. Atomic writes alone lose updates; these pin that
 * concurrent recorders all land.
 */

import { describe, expect, it } from "vitest";
import { readDelegationLedger, recordDelegation } from "../../../src/hooks/delegation-ledger.js";
import {
  readSpawnGateState,
  recordSpawn,
  updateSpawnGateState,
} from "../../../src/hooks/spawn-gate.js";
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
