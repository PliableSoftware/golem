/**
 * The published schema carries each setting's team rule, read through
 * `teamRule()` so the table is never written twice. The portal fetches this
 * artifact per release; the field name and shape are a published contract.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { schemaPayload } from "../../../src/cli/commands/config.js";
import { type Control, collectControlSurface } from "../../../src/config/control-surface.js";
import { TEAM_POLICY, TEAM_PROMPT_MAX_CHARS, teamRule } from "../../../src/config/team-policy.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-team-rule-schema-");
let controls: Control[];

beforeEach(async () => {
  const base = await newTempDir();
  const projectDir = path.join(base, "project");
  await mkdir(path.join(projectDir, ".golem"), { recursive: true });
  await writeFile(path.join(projectDir, ".golem", "settings.json"), "{}", "utf8");
  const surface = await collectControlSurface({
    projectDir,
    userDir: path.join(base, "user"),
    version: "9.9.9-test",
    env: {},
  });
  const published = schemaPayload(surface, false);
  controls = published.groups.flatMap((g) => [...g.controls]);
});

const settings = () => controls.filter((c) => c.family === "setting");

describe("team rule in the published schema", () => {
  it("every setting control carries a rule equal to teamRule(dotted)", () => {
    expect(settings().length).toBeGreaterThan(50);
    for (const c of settings()) {
      const dotted = c.id.slice("setting:".length);
      expect(c.teamRule, dotted).toBe(teamRule(dotted));
    }
  });

  it("every published setting is classified in TEAM_POLICY (no silent default-deny fallback)", () => {
    for (const c of settings()) {
      expect(Object.hasOwn(TEAM_POLICY, c.id.slice("setting:".length)), c.id).toBe(true);
    }
  });

  it("publishes exact rules for one key per class (not derived from teamRule)", () => {
    const rule = (id: string) => settings().find((c) => c.id === `setting:${id}`)?.teamRule;
    expect(rule("proxy.bypass_all")).toBe("denied");
    expect(rule("security.write_lan")).toBe("false-only");
    expect(rule("snooze.enforce")).toBe("true-only");
    expect(rule("security.unlock_window_minutes")).toBe("lower-only");
    expect(rule("knowledge.local_answer_min_confidence")).toBe("raise-only");
    expect(rule("security.origination_roots")).toBe("narrow-roots");
    expect(rule("inference.team_prompt")).toBe("bounded-text");
    expect(rule("models.catalog_max_age_days")).toBe("settable");
  });

  it("flags the one key a team may set but never enforce", () => {
    const flagged = settings().filter((c) => c.teamEnforceable === false);
    expect(flagged.map((c) => c.id)).toEqual(["setting:inference.team_prompt"]);
  });

  it("non-setting controls (guidance, runtime) carry no rule", () => {
    const others = controls.filter((c) => c.family !== "setting");
    expect(others.length).toBeGreaterThan(0);
    for (const c of others) {
      expect(c.teamRule, c.id).toBeUndefined();
      expect(c.teamBound, c.id).toBeUndefined();
    }
  });

  it("bounded-text carries its bound from the existing constant, and only it does", () => {
    const team = settings().find((c) => c.id === "setting:inference.team_prompt");
    expect(team?.teamRule).toBe("bounded-text");
    // Only the length: the client refuses much more, and allows tab and newline.
    expect(team?.teamBound).toEqual({ maxChars: TEAM_PROMPT_MAX_CHARS });
    for (const c of settings().filter((x) => x.teamRule !== "bounded-text")) {
      expect(c.teamBound, c.id).toBeUndefined();
    }
  });

  it("publishes the direction for member-relative rules, with no value", () => {
    const byRule = (r: string) => settings().filter((c) => c.teamRule === r);
    expect(byRule("lower-only").length).toBeGreaterThan(0);
    expect(byRule("raise-only").map((c) => c.id)).toContain(
      "setting:knowledge.local_answer_min_confidence",
    );
    expect(byRule("narrow-roots").map((c) => c.id)).toEqual(["setting:security.origination_roots"]);
    for (const c of [...byRule("lower-only"), ...byRule("raise-only"), ...byRule("narrow-roots")]) {
      expect(c.teamBound, c.id).toBeUndefined();
    }
  });

  it("is additive: the published JSON keeps its existing fields", () => {
    const c = settings()[0] as Control;
    for (const k of ["id", "family", "kind", "writableScopes", "layer", "advanced"]) {
      expect(c, k).toHaveProperty(k);
    }
  });
});
