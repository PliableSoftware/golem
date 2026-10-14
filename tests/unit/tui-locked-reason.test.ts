/**
 * DUST2.16 (r010): the TUI shows a pinned control's origin AND recourse. The
 * recourse is the END of the reason, so clipping it to one line (what the panel
 * did) removes the only part that tells the reader what to do.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type ControlSurface, collectControlSurface } from "../../src/config/control-surface.js";
import { renderPanel } from "../../src/tui/render.js";
import { initialState, reducePanel } from "../../src/tui/state.js";
import { themeFor } from "../../src/tui/theme.js";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-tui-locked-");

async function pinnedSurface(): Promise<ControlSurface> {
  const projectDir = await newTempDir();
  const userDir = await newTempDir();
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
  await writeFile(
    path.join(projectDir, ".golem", "settings.json"),
    JSON.stringify({ compression: { level: "1" }, "!important": ["compression.level"] }),
    "utf8",
  );
  const full = await collectControlSurface({
    projectDir,
    userDir,
    version: "t",
    env: {},
    probeTimeoutMs: 20,
    localProbe: async () => ({ reachable: false }),
  });
  const control = full.groups
    .flatMap((g) => g.controls)
    .find((c) => c.id === "setting:compression.level");
  if (control === undefined) throw new Error("no compression control");
  return {
    header: null,
    warnings: [],
    groups: [
      { id: "settings:compression", title: "Compression", tab: "settings", controls: [control] },
    ],
  };
}

const flat = (lines: readonly string[]) => lines.join(" ").replace(/\s+/g, " ");

describe("TUI locked control", () => {
  for (const width of [60, 80, 120]) {
    it(`shows origin and recourse in full at width ${width}`, async () => {
      const state = initialState(await pinnedSurface(), { version: "t", projectDir: "/tmp/x" });
      const lines = renderPanel(state, {
        theme: themeFor(
          { pet: true, pet_color: "#a78bfa", color: "never", advanced: false },
          {},
          false,
        ),
        showPet: false,
        width,
        height: 30,
      });
      const text = flat(lines);
      expect(text).toContain("the repo's `.golem/settings.json`");
      expect(text).toContain("your `~/.golem/settings.json`");
      expect(text).toContain("can override it, and only with `!important` of its own.");
      expect(lines.length).toBeLessThanOrEqual(30);
    });
  }

  it("keeps the whole reason when the user presses space on it", async () => {
    const state = initialState(await pinnedSurface(), { version: "t", projectDir: "/tmp/x" });
    const step = reducePanel(state, { kind: "key", key: { input: " " } } as never);
    expect(step.effects).toEqual([]);
    const lines = renderPanel(step.state, {
      theme: themeFor(
        { pet: true, pet_color: "#a78bfa", color: "never", advanced: false },
        {},
        false,
      ),
      showPet: false,
      width: 70,
      height: 30,
    });
    expect(flat(lines)).toContain("of its own.");
  });
});
