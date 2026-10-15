/** DUST3.10 C-c: a persona-sourced worker route is labelled `persona_worker`. */

import { describe, expect, it } from "vitest";
import { selectTarget } from "../../../src/inference/target-dispatcher.js";

const settings = { upstream_provider: "anthropic", model: "fallback" } as never;
const personas = { coder: { model: "from-persona" } };

describe("selectTarget route label", () => {
  it("labels a worker_targets entry `worker`", () => {
    expect(
      selectTarget(
        { settings, personas, workerTargets: { coder: "from-map" } },
        { worker: "coder" },
      ),
    ).toEqual({ id: "from-map", route: "worker" });
  });

  it("labels a value that came from inference.personas `persona_worker`", () => {
    expect(selectTarget({ settings, personas }, { worker: "coder" })).toEqual({
      id: "from-persona",
      route: "persona_worker",
    });
  });

  it("falls back to `model` when neither names the worker", () => {
    expect(selectTarget({ settings, personas: {} }, { worker: "coder" }).route).toBe("model");
  });
});
