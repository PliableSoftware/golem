/**
 * DUST3.8 D13/D14 — `golem mcp serve`'s knowledge-base lifecycle.
 *
 * D13: ingest watchers were never closed; `closeWatchers` was test-only.
 * D14: `wikiDir` was set only inside the `knowledge !== undefined` spread, so a
 * failed KB build also switched off the coder's graph-first wiki search.
 */

import { describe, expect, it, vi } from "vitest";
import {
  closeKnowledgeWatchers,
  knowledgeServerDeps,
} from "../../../src/cli/commands/mcp-serve.js";
import { DEFAULT_SETTINGS, type GolemSettings } from "../../../src/config/schema.js";
import type { KnowledgeBase } from "../../../src/interfaces/index.js";

const enabled: GolemSettings = {
  ...DEFAULT_SETTINGS,
  knowledge: { ...DEFAULT_SETTINGS.knowledge, enabled: true },
};

describe("knowledgeServerDeps (D14)", () => {
  it("still sets wikiDir when the knowledge base failed to build", () => {
    const deps = knowledgeServerDeps("/proj", enabled, undefined);
    expect(deps.wikiDir).toBeDefined();
    expect(deps).not.toHaveProperty("knowledge");
  });

  it("sets knowledge, defaultProjectId and wikiDir when the build succeeded", () => {
    const kb = {} as KnowledgeBase;
    const deps = knowledgeServerDeps("/proj", enabled, kb);
    expect(deps.knowledge).toBe(kb);
    expect(deps.defaultProjectId).toBe("/proj");
    expect(deps.wikiDir).toBeDefined();
  });

  it("sets nothing when knowledge is disabled", () => {
    const off = { ...enabled, knowledge: { ...enabled.knowledge, enabled: false } };
    expect(knowledgeServerDeps("/proj", off, undefined)).toEqual({});
  });
});

describe("closeKnowledgeWatchers (D13)", () => {
  it("closes watchers on a knowledge base that has them", () => {
    const closeWatchers = vi.fn();
    closeKnowledgeWatchers({ closeWatchers } as unknown as KnowledgeBase);
    expect(closeWatchers).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for undefined and for a base without watchers", () => {
    expect(() => closeKnowledgeWatchers(undefined)).not.toThrow();
    expect(() => closeKnowledgeWatchers({} as KnowledgeBase)).not.toThrow();
  });
});
