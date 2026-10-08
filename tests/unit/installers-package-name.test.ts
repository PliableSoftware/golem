import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("installer npm rung (DUSTSEC.16)", () => {
  it.each([
    "install/install.sh",
    "install/install.ps1",
  ])("%s installs @pliable/golem, never golem-run", async (file) => {
    const text = await readFile(file, "utf8");
    expect(text).toContain("@pliable/golem");
    expect(text).not.toContain("golem-run");
  });
});
