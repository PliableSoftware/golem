/**
 * DUST3.4 S11 — the redaction-off warning must survive an available update.
 *
 * `collectStatus` built `[update, ...warnings]` in the update branch and only
 * reached the bypass branch otherwise, so a machine with `proxy.bypass_all` on
 * AND a newer release cached lost REDACTION_OFF_WARNING entirely.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPipelineState } from "../../src/cli/pipeline-switch.js";
import { collectStatus, renderStatus } from "../../src/cli/status.js";
import { REDACTION_OFF_WARNING } from "../../src/cli/status-collect.js";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-status-bypass");

const DEAD_PORT = 45_998;

let projectDir: string;
let userDir: string;
let savedNoColor: string | undefined;

async function cacheUpdate(latest: string): Promise<void> {
  const dir = path.join(projectDir, ".golem", "state");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "update-check.json"),
    JSON.stringify({
      current: "0.1.0-test",
      latest,
      updateAvailable: true,
      method: "npm",
      command: "npm i -g golem-run",
      checkedAt: new Date().toISOString(),
    }),
    "utf8",
  );
}

beforeEach(async () => {
  const root = await newTempDir();
  projectDir = path.join(root, "project");
  userDir = path.join(root, "user");
  await mkdir(projectDir, { recursive: true });
  await mkdir(userDir, { recursive: true });
  savedNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});

afterEach(() => {
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
});

describe("collectStatus warnings under bypass_all (S11)", () => {
  it("keeps the redaction-off warning when no update is available", async () => {
    await setPipelineState(projectDir, DEAD_PORT, false);
    const report = await collectStatus({
      projectDir,
      version: "0.1.0-test",
      userDir,
      probeTimeoutMs: 200,
    });
    expect(report.warnings).toContain(REDACTION_OFF_WARNING);
  });

  it("keeps the redaction-off warning when an update is available, and renders it with NO_COLOR", async () => {
    await setPipelineState(projectDir, DEAD_PORT, false);
    await cacheUpdate("99.0.0");
    const report = await collectStatus({
      projectDir,
      version: "0.1.0-test",
      userDir,
      probeTimeoutMs: 200,
    });
    expect(report.warnings).toContain(REDACTION_OFF_WARNING);
    expect(report.warnings.some((w) => w.includes("newer Golem"))).toBe(true);
    expect(renderStatus(report)).toContain("redaction");
  });
});

describe("golem proxy status pipeline line (S12)", () => {
  it("says the pipeline is active only when bypass_all is off", async () => {
    const { renderPipelineLine } = await import("../../src/cli/commands/proxy.js");
    expect(renderPipelineLine(false)).toContain("Pipeline is active");
  });

  it("is loud about redaction being off under bypass_all, and never says active", async () => {
    const { renderPipelineLine } = await import("../../src/cli/commands/proxy.js");
    const out = renderPipelineLine(true);
    expect(out).not.toContain("Pipeline is active");
    expect(out).toContain("REDACTION IS OFF");
    expect(out).toContain("golem on");
  });
});
