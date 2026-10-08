import { describe, expect, it } from "vitest";
import { namesGolemPackage } from "../../../src/cli/commands/ps.js";

describe("namesGolemPackage (DUSTSEC.16)", () => {
  it("matches a process started from the @pliable/golem package on every OS", () => {
    expect(
      namesGolemPackage("node /usr/lib/node_modules/@pliable/golem/dist/cli/main.js statusline"),
    ).toBe(true);
    expect(
      namesGolemPackage(
        '"C:\\Program Files\\nodejs\\node.exe" C:\\npm\\node_modules\\@pliable\\golem\\dist\\cli\\main.js mcp serve',
      ),
    ).toBe(true);
  });
  it("still matches a legacy golem-run install", () => {
    expect(namesGolemPackage("node /x/node_modules/golem-run/dist/cli/main.js statusline")).toBe(
      true,
    );
  });
  it("does not match lookalikes", () => {
    expect(namesGolemPackage("node /x/node_modules/@pliable/golem-other/main.js")).toBe(false);
    expect(namesGolemPackage("node /x/node_modules/golem-runner/main.js")).toBe(false);
    expect(namesGolemPackage("node /x/other/main.js statusline")).toBe(false);
  });
});
