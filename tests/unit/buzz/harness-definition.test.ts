import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  golemHarnessDefinition,
  harnessDefinitionPath,
} from "../../../src/buzz/harness-definition.js";

describe("golem harness definition (R14.3 tier-3 BYOH JSON)", () => {
  it("names golem as a plain `acp` command with no baked-in persona", () => {
    expect(golemHarnessDefinition()).toEqual({
      id: "golem",
      label: "Golem",
      command: "golem",
      args: ["acp"],
    });
  });

  it("resolves the app-data-relative custom_harnesses path cross-platform", () => {
    expect(harnessDefinitionPath("/app-data")).toBe(
      path.join("/app-data", "custom_harnesses", "golem.json"),
    );
  });
});
