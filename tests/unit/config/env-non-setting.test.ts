import { describe, expect, it } from "vitest";
import { readEnvLayer } from "../../../src/config/env.js";

describe("non-setting GOLEM_* switches", () => {
  it("GOLEM_KB_WATCH is a known switch, not an unknown setting", () => {
    expect(readEnvLayer({ GOLEM_KB_WATCH: "off" }).warnings).toEqual([]);
  });
});
