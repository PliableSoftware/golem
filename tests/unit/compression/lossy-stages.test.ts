/**
 * DUST2.20 — every lossy stage declares its gate, and the declarations match
 * the stage table, the effective-level prediction and the Headroom worker.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveEffectiveCompression } from "../../../src/compression/effective-level.js";
import {
  HEADROOM_LEVEL_MAPPING,
  LOSSY_STAGES,
  NON_LOSSY_STAGE_FIELDS,
} from "../../../src/compression/lossy-stages.js";
import { type CompressionLevel, stagesForCompression } from "../../../src/interfaces/policy.js";

const on = (v: unknown): boolean => v !== false && v !== "off";

describe("LOSSY_STAGES", () => {
  it("each stage is off one level below minLevel and on at it", () => {
    for (const stage of LOSSY_STAGES) {
      const below = (stage.minLevel - 1) as CompressionLevel;
      expect(on(stagesForCompression(below)[stage.stageField]), stage.id).toBe(false);
      expect(on(stagesForCompression(stage.minLevel)[stage.stageField]), stage.id).toBe(true);
    }
  });

  it("no lossy stage runs at off or level 1", () => {
    for (const level of ["off", 1] as const) {
      const row = stagesForCompression(level);
      for (const stage of LOSSY_STAGES) expect(on(row[stage.stageField]), stage.id).toBe(false);
    }
  });

  it("accounts for every StageConfig field: lossy rows or the explicit non-lossy list", () => {
    const declared = new Set<string>([
      ...LOSSY_STAGES.map((s) => s.stageField),
      ...NON_LOSSY_STAGE_FIELDS,
    ]);
    for (const field of Object.keys(stagesForCompression(3))) {
      expect(declared.has(field), `StageConfig.${field} has no gate declaration`).toBe(true);
    }
  });

  it("has unique ids and names where each gate is enforced", () => {
    expect(new Set(LOSSY_STAGES.map((s) => s.id)).size).toBe(LOSSY_STAGES.length);
    for (const s of LOSSY_STAGES) expect(s.enforcedAt.length).toBeGreaterThan(0);
  });

  // `resolveEffectiveCompression` predicts ONE level, so it can only speak for the
  // Headroom stage. Each stage is checked against its own declaration instead, and
  // the two places the single-level prediction is knowingly coarser are pinned.
  const effective = (o: { caching: boolean; force: boolean; sidecar: boolean; level?: 2 | 3 }) =>
    resolveEffectiveCompression({
      level: o.level ?? 3,
      assumeCachingUpstream: o.caching,
      headroomSidecar: o.sidecar,
      forceSemanticOnCaching: o.force,
    });

  /** Whether `stage` runs, from its declaration alone. */
  const runs = (
    stage: (typeof LOSSY_STAGES)[number],
    o: { caching: boolean; force: boolean; sidecar: boolean },
  ): boolean => {
    if (stage.needsHeadroomSidecar && !o.sidecar) return false;
    if (!stage.gatedOffOnCachingUpstream || !o.caching) return true;
    return stage.forceFlagLiftsCachingGate && o.force;
  };

  it("each stage's declared gate matches the prediction wherever the prediction speaks for it", () => {
    const semantic = LOSSY_STAGES.find((s) => s.id === "semantic");
    if (semantic === undefined) throw new Error("no semantic stage");
    for (const caching of [true, false]) {
      for (const force of [true, false]) {
        for (const sidecar of [true, false]) {
          const o = { caching, force, sidecar };
          expect(!effective(o).degraded, JSON.stringify(o)).toBe(runs(semantic, o));
        }
      }
    }
  });

  it("known disagreement 1: the force flag lifts the semantic gate but not contextSubstitution", () => {
    const sub = LOSSY_STAGES.find((s) => s.id === "contextSubstitution");
    if (sub === undefined) throw new Error("no contextSubstitution stage");
    const o = { caching: true, force: true, sidecar: true };
    expect(effective(o).degraded).toBe(false); // prediction: level 3 delivers
    expect(runs(sub, o)).toBe(false); // but this stage is still gated off
  });

  it("known disagreement 2: without the sidecar the prediction says level 1, yet contextSubstitution still runs", () => {
    const sub = LOSSY_STAGES.find((s) => s.id === "contextSubstitution");
    if (sub === undefined) throw new Error("no contextSubstitution stage");
    const o = { caching: false, force: false, sidecar: false };
    expect(effective(o).degraded).toBe(true);
    expect(runs(sub, o)).toBe(true);
  });

  it("only the semantic stage needs the sidecar and honours the force flag", () => {
    expect(LOSSY_STAGES.filter((s) => s.needsHeadroomSidecar).map((s) => s.id)).toEqual([
      "semantic",
    ]);
    expect(LOSSY_STAGES.filter((s) => s.forceFlagLiftsCachingGate).map((s) => s.id)).toEqual([
      "semantic",
    ]);
  });
});

describe("HEADROOM_LEVEL_MAPPING", () => {
  const worker = readFileSync(
    new URL("../../../src/compression/headroom-worker.py", import.meta.url),
    "utf8",
  );
  const preset = (mode: string): string => {
    const m = new RegExp(`"${mode}":\\s*\\{([^}]*)\\}`).exec(worker);
    if (m?.[1] === undefined) throw new Error(`no preset for ${mode}`);
    return m[1];
  };

  it("covers each lossy level and matches the semantic mode the stage table sets", () => {
    for (const row of HEADROOM_LEVEL_MAPPING) {
      expect(stagesForCompression(row.level).semanticCompression).toBe(row.mode);
    }
    expect(HEADROOM_LEVEL_MAPPING.map((r) => r.level)).toEqual([2, 3]);
  });

  it("matches the worker's _MODE_PRESETS", () => {
    for (const row of HEADROOM_LEVEL_MAPPING) {
      const body = preset(row.mode);
      expect(body).toContain(`"protect_recent": ${row.protectRecent}`);
      const user = /"compress_user_messages":\s*(True|False)/.exec(body)?.[1];
      expect(user === "True").toBe(row.compressUserMessages);
    }
  });

  it("marker-free tool output is the worker's default, not a lock", () => {
    expect(worker).toContain('_ROUTER_PRESET = {"lossless": True}');
    expect(HEADROOM_LEVEL_MAPPING.every((r) => r.toolOutputMarkerFreeByDefault)).toBe(true);
    // Caller overrides are layered on top of the preset in the worker.
    expect(worker).toContain("router_overrides.update(caller_router)");
  });
});
