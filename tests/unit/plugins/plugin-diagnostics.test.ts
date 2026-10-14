/**
 * DUST2.11 — `golem plugin` reports every problem it can detect, counted.
 *
 * Includes a REAL plugin file fixture in a temp dir (resolved and imported by
 * the default loader, configured through a real `.golem/settings.json`) with
 * several distinct problems, so the count is checked end to end.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectPlugins,
  countProblems,
  pluginExitCode,
  renderPlugins,
} from "../../../src/cli/plugin.js";
import { loadPlugins } from "../../../src/plugins/index.js";
import type { GolemPlugin, GolemPluginApi } from "../../../src/plugins/types.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "golem-plugin-diag-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function configure(specifiers: string[]): Promise<void> {
  await mkdir(path.join(dir, ".golem"), { recursive: true });
  await writeFile(
    path.join(dir, ".golem", "settings.json"),
    JSON.stringify({ plugins: { enabled: true, load: specifiers } }),
    "utf8",
  );
}

const MULTI = `
export default {
  name: "multi",
  version: 7,
  setup(api) {
    api.addRedactionRule({ id: "risky", description: "d", pattern: /(a+)+$/g });
    api.addRedactionRule({ id: "Bad_Id", description: "d", pattern: /x/g });
    api.addRedactionRule({ id: "no-g", description: "d", pattern: /x/ });
    api.addRedactionRule({ id: "dead", description: "d", pattern: /(k)=v/g, group: 3 });
    api.addRedactionRule({ id: "empty", description: "d", pattern: /x*/g });
    api.addPipelineStage({ name: "boom", transform() { throw new Error("stage exploded"); } });
    api.addPipelineStage({ name: "boom", description: "dup", transform() {} });
    api.addMcpTool({ name: "search", title: "t", description: "d", handler() {} });
  },
};
`;

describe("golem plugin — a fixture with several distinct problems", () => {
  it("lists every one of them, counted by kind and severity", async () => {
    await writeFile(path.join(dir, "multi.mjs"), MULTI, "utf8");
    await writeFile(path.join(dir, "broken.mjs"), "export default {", "utf8");
    await writeFile(path.join(dir, "nameless.mjs"), "export default { setup() {} };", "utf8");
    await writeFile(
      path.join(dir, "thrower.mjs"),
      'export default { name: "thrower", setup() { throw new Error("nope"); } };',
      "utf8",
    );
    await writeFile(
      path.join(dir, "again.mjs"),
      'export default { name: "multi", setup() {} };',
      "utf8",
    );
    await configure([
      "./multi.mjs",
      "./broken.mjs",
      "./nameless.mjs",
      "./thrower.mjs",
      "./again.mjs",
      "./missing.mjs",
    ]);

    const report = await collectPlugins(dir, "0.0.0-test");

    expect(report.counts.byKind).toEqual({
      "regex-backtracking": 1,
      "invalid-registration": 4, // Bad_Id, no-g, duplicate stage, shadowed tool
      "dead-rule": 1,
      "empty-match": 1,
      "missing-metadata": 2, // version: 7, stage "boom" has no description
      "stage-probe-failed": 1,
      "import-failed": 2, // broken.mjs (syntax error) and missing.mjs (a path is not pre-checked)
      "invalid-module": 1,
      "setup-threw": 1,
      "duplicate-plugin": 1,
    });
    expect(report.counts.total).toBe(report.problems.length);
    expect(report.counts.errors + report.counts.warnings).toBe(report.counts.total);
    expect(report.counts.warnings).toBe(6);

    // Warnings did not cost the rule its place: the risky rule is still loaded.
    const ids = report.loaded.redactionRules.map((r) => r.id);
    expect(ids).toContain("multi/risky");
    expect(ids).toContain("multi/dead");
    expect(ids).not.toContain("multi/no-g");

    const text = renderPlugins(report);
    expect(text).toContain(`Problems: ${report.counts.total}`);
    expect(text).toContain("[warn/regex-backtracking] multi:");
    expect(text).toContain("[error/import-failed] ./missing.mjs");
    expect(text).toContain("stage exploded");
  });

  it("exit code: 0 by default, --check fails on errors, --strict also on warnings", async () => {
    await writeFile(path.join(dir, "multi.mjs"), MULTI, "utf8");
    await configure(["./multi.mjs"]);
    const bad = await collectPlugins(dir, "0.0.0-test");
    expect(pluginExitCode(bad, {})).toBe(0);
    expect(pluginExitCode(bad, { check: true })).toBe(1);
    expect(pluginExitCode(bad, { strict: true })).toBe(1);

    await writeFile(
      path.join(dir, "risky-only.mjs"),
      `export default { name: "r", setup(api) { api.addRedactionRule({ id: "x", description: "d", pattern: /(a+)+$/g }); } };`,
      "utf8",
    );
    await configure(["./risky-only.mjs"]);
    const warned = await collectPlugins(dir, "0.0.0-test");
    expect(warned.counts).toMatchObject({ errors: 0, warnings: 1 });
    expect(pluginExitCode(warned, { check: true })).toBe(0);
    expect(pluginExitCode(warned, { strict: true })).toBe(1);

    await configure([]);
    const clean = await collectPlugins(dir, "0.0.0-test");
    expect(pluginExitCode(clean, { strict: true })).toBe(0);
  });
});

function load(setup: (api: GolemPluginApi) => void | Promise<void>, extra: object = {}) {
  const mod = { default: { name: "p", setup, ...extra } satisfies GolemPlugin };
  return loadPlugins({
    specifiers: ["p"],
    projectDir: "/project",
    golemVersion: "1",
    resolve: (s) => s,
    importModule: async () => mod,
  });
}

describe("loader diagnostics", () => {
  it("records a registration made after setup() settled instead of dropping it silently", async () => {
    let api: GolemPluginApi | undefined;
    const loaded = await load((a) => {
      api = a;
    });
    api?.addRedactionRule({ id: "late", description: "d", pattern: /x/g });
    expect(loaded.redactionRules).toEqual([]);
    expect(loaded.problems).toHaveLength(1);
    expect(loaded.problems[0]).toMatchObject({ kind: "late-registration" });
  });

  it("flags a rule whose group does not exist as dead, and keeps it", async () => {
    const loaded = await load((a) =>
      a.addRedactionRule({ id: "g", description: "d", pattern: /(k)=v/g, group: 2 }),
    );
    expect(loaded.redactionRules).toHaveLength(1);
    expect(loaded.problems[0]).toMatchObject({ kind: "dead-rule", severity: "warning" });
  });

  it("accepts a group that exists without a dead-rule problem", async () => {
    const loaded = await load((a) =>
      a.addRedactionRule({ id: "g", description: "d", pattern: /(k)=(v)/g, group: 2 }),
    );
    expect(loaded.problems).toEqual([]);
  });

  it("warns about regex shape but never rejects the rule", async () => {
    const loaded = await load((a) =>
      a.addRedactionRule({ id: "r", description: "d", pattern: /(x+x+)+y/g }),
    );
    expect(loaded.redactionRules.map((r) => r.id)).toEqual(["p/r"]);
    expect(loaded.problems[0]).toMatchObject({
      kind: "regex-backtracking",
      severity: "warning",
    });
  });

  it("countProblems treats a problem with no severity as an error", () => {
    expect(countProblems([{ subject: "a", reason: "r" }]).errors).toBe(1);
  });
});

describe("initPlugins logging", () => {
  it("says 'warning (rule stays active)' for advisories and 'skipped' only for errors; each DISTINCT finding once per process", async () => {
    const { initPlugins, resetPluginWarningDedupeForTests } = await import(
      "../../../src/plugins/init.js"
    );
    resetPluginWarningDedupeForTests();
    await writeFile(
      path.join(dir, "warn.mjs"),
      `export default { name: "warny", setup(api) {
        api.addPipelineStage({ name: "a", transform() {} });
        api.addPipelineStage({ name: "b", transform() {} });
      } };`,
      "utf8",
    );
    const run = async (): Promise<string[]> => {
      const lines: string[] = [];
      await initPlugins({
        specifiers: ["./warn.mjs", "./nope.mjs"],
        enabled: true,
        projectDir: dir,
        golemVersion: "0",
        log: (m) => lines.push(m),
        announce: false,
      });
      return lines;
    };
    const first = await run();
    const warnings = first.filter((l) => l.startsWith("plugin warning (rule stays active)"));
    // Stages "a" and "b" are two distinct findings of one plugin and kind: both logged.
    expect(warnings).toHaveLength(2);
    expect(warnings.some((l) => l.includes('"a"'))).toBe(true);
    expect(warnings.some((l) => l.includes('"b"'))).toBe(true);
    expect(first.filter((l) => l.includes("(skipped, no-op)"))).toHaveLength(1);
    expect(first.some((l) => l.includes("warny") && l.includes("skipped"))).toBe(false);

    const second = await run();
    expect(second.some((l) => l.startsWith("plugin warning"))).toBe(false);
    expect(second.filter((l) => l.includes("(skipped, no-op)"))).toHaveLength(1);
  });
});
