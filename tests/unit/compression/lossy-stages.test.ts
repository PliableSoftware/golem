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

  it("caching-gated stages agree with resolveEffectiveCompression", () => {
    const gated = LOSSY_STAGES.some((s) => s.gatedOffOnCachingUpstream);
    const eff = resolveEffectiveCompression({
      level: 3,
      assumeCachingUpstream: true,
      headroomSidecar: true,
      forceSemanticOnCaching: false,
    });
    expect(eff.degraded).toBe(gated);
    const forced = resolveEffectiveCompression({
      level: 3,
      assumeCachingUpstream: true,
      headroomSidecar: true,
      forceSemanticOnCaching: true,
    });
    expect(forced.degraded).toBe(false);
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

  it("tool output is marker-free in the worker's router preset", () => {
    expect(worker).toContain('_ROUTER_PRESET = {"lossless": True}');
  });
});
