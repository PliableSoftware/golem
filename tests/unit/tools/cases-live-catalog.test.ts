/** DUST3.10 h3: every bench case must target a tool the live server registers. */

import { describe, expect, it } from "vitest";
import { ARGUMENT_CASES, golemToolCensus, SELECTION_CASES } from "../../../src/tools/index.js";

describe("bench cases vs the live tool catalog", () => {
  it("every selection case expects a registered tool (or null)", async () => {
    const live = new Set((await golemToolCensus()).tools.map((t) => t.name));
    for (const c of SELECTION_CASES) {
      if (c.expected !== null) expect(live.has(c.expected), `${c.id} -> ${c.expected}`).toBe(true);
    }
  });

  it("every argument case targets a registered tool", async () => {
    const live = new Set((await golemToolCensus()).tools.map((t) => t.name));
    for (const c of ARGUMENT_CASES) expect(live.has(c.tool), `${c.id} -> ${c.tool}`).toBe(true);
  });

  it("covers the `code` tool", () => {
    expect(SELECTION_CASES.some((c) => c.expected === "code")).toBe(true);
  });
});
