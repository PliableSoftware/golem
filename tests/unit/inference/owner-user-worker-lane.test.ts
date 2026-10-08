/** DUSTSEC.11 (USER decision R9): `owner: user` binds the worker lane. */

import { describe, expect, it } from "vitest";
import { CoderRouteError, resolveCoderRoute } from "../../../src/inference/coder-route.js";
import {
  PersonaNotDispatchableError,
  workerTargetFromPersona,
} from "../../../src/inference/personas.js";
import { selectTarget, TargetDispatchError } from "../../../src/inference/target-dispatcher.js";
import type { TargetRegistrySettings } from "../../../src/providers/index.js";

const SETTINGS: TargetRegistrySettings = {
  upstream_provider: "anthropic",
  upstream_base_url: "https://api.anthropic.com",
  upstream_auth_scheme: "inherit",
  gateways: [
    {
      id: "openrouter",
      provider: "openrouter",
      base_url: "https://openrouter.ai/api/v1",
      models: [{ name: "qwen/qwen3.7-flash" }],
    },
  ],
  targets: [
    {
      id: "cheap",
      gateway: "openrouter",
      model: { name: "qwen/qwen3.7-flash" },
      trust: "third-party",
    },
  ],
};

const USER_OWNED = { coder: { model: "cheap", owner: "user" as const } };
const AGENT_OWNED = { coder: { model: "cheap", owner: "agent" as const } };

describe("workerTargetFromPersona", () => {
  it("refuses an owner: user persona", () => {
    expect(() => workerTargetFromPersona(USER_OWNED, "coder")).toThrow(PersonaNotDispatchableError);
  });
  it("leaves owner: agent and the default owner unchanged", () => {
    expect(workerTargetFromPersona(AGENT_OWNED, "coder")).toBe("cheap");
    expect(workerTargetFromPersona({ coder: { model: "cheap" } }, "coder")).toBe("cheap");
  });
});

describe("selectTarget", () => {
  const base = { settings: { ...SETTINGS, model: "cheap" } as never };
  it("refuses instead of falling back to the default target", () => {
    expect(() => selectTarget({ ...base, personas: USER_OWNED }, { worker: "coder" })).toThrow(
      TargetDispatchError,
    );
  });
  it("refuses even when worker_targets names the worker", () => {
    expect(() =>
      selectTarget(
        { ...base, personas: USER_OWNED, workerTargets: { coder: "cheap" } },
        { worker: "coder" },
      ),
    ).toThrow(/owner: user/);
  });
  it("refuses an owner: user worker even when the caller names an explicit target", () => {
    expect(() =>
      selectTarget({ ...base, personas: USER_OWNED }, { worker: "coder", targetId: "cheap" }),
    ).toThrow(/owner: user/);
  });
  it("explicit target with no worker, or an owner: agent worker, still routes explicit", () => {
    expect(selectTarget({ ...base, personas: USER_OWNED }, { targetId: "cheap" })).toEqual({
      id: "cheap",
      route: "explicit",
    });
    expect(
      selectTarget({ ...base, personas: AGENT_OWNED }, { worker: "coder", targetId: "cheap" }),
    ).toEqual({ id: "cheap", route: "explicit" });
  });
  it("still routes an owner: agent persona", () => {
    expect(selectTarget({ ...base, personas: AGENT_OWNED }, { worker: "coder" })).toEqual({
      id: "cheap",
      route: "worker",
    });
  });
});

describe("resolveCoderRoute", () => {
  it("refuses an owner: user coder, even with worker_targets or default_coder set", () => {
    expect(() => resolveCoderRoute({ settings: SETTINGS, personas: USER_OWNED })).toThrow(
      CoderRouteError,
    );
    expect(() =>
      resolveCoderRoute({
        settings: SETTINGS,
        personas: USER_OWNED,
        workerTargets: { coder: "cheap" },
        defaultCoder: "cheap",
      }),
    ).toThrow(/owner: user/);
  });
  it("owner: agent unchanged", () => {
    expect(resolveCoderRoute({ settings: SETTINGS, personas: AGENT_OWNED })).toEqual({
      kind: "target",
      targetId: "cheap",
      via: "persona_worker",
    });
  });
});
