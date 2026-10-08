/**
 * DUSTSEC.9 (R7) — the vibe ledgers are redacted too, not just the brief.
 *
 * `candidates.jsonl` carries the human's free-text note and `sources.json` a
 * path. Before this, both were written raw; the guide's promise is that every
 * byte it stores went through the redactor.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmCandidate,
  openVibeStore,
  recordSignal,
  type VibeStore,
} from "../../src/vibe/index.js";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-vsr");

// Assembled at runtime so no scanner flags this file; matches the aws-key shape.
const FAKE_AWS = `AKIA${"IOSFODNN7EXAMPLE"}`;
const NOW = "2026-10-08T00:00:00.000Z";

describe("vibe ledgers are redacted before write", () => {
  let store: VibeStore;

  beforeEach(async () => {
    const base = await newTempDir();
    const projectDir = path.join(base, "project");
    await mkdir(path.join(projectDir, ".golem"), { recursive: true });
    await writeFile(path.join(projectDir, ".golem", "settings.json"), "{}\n", "utf8");
    const opened = openVibeStore({
      cwd: projectDir,
      userDir: path.join(base, "home", ".golem"),
      rootDir: base,
    });
    if (opened === null) throw new Error("fixture is not a Golem project");
    store = opened;
  });

  it("candidates.jsonl: a confirmed note holding a key is stored as a placeholder", async () => {
    const signal = { kind: "quotes", from: "single", to: "double" } as const;
    await recordSignal(store, signal, "a.ts", NOW);
    const key = `${signal.kind}:${signal.from}->${signal.to}`;
    const row = await confirmCandidate(store, key, NOW, `because we pasted ${FAKE_AWS} once`);

    const raw = await readFile(store.paths.candidates, "utf8");
    expect(raw).not.toContain(FAKE_AWS);
    expect(raw).toContain("[REDACTED:aws-key:");
    expect(row?.note).not.toContain(FAKE_AWS);
  });

  it("candidates.jsonl: a note without secrets, and the metric fields, are unchanged", async () => {
    const signal = { kind: "quotes", from: "single", to: "double" } as const;
    await recordSignal(store, signal, "a.ts", NOW);
    const key = `${signal.kind}:${signal.from}->${signal.to}`;
    const row = await confirmCandidate(store, key, NOW, "house style, ask Dana");
    expect(row).toMatchObject({ key, from: "single", to: "double", note: "house style, ask Dana" });
  });

  it("sources.json: a source path holding a key is stored as a placeholder", async () => {
    await store.recordSource({
      path: `/work/${FAKE_AWS}/repo`,
      kind: "directory",
      addedAt: NOW,
    });
    const raw = await readFile(store.paths.sources, "utf8");
    expect(raw).not.toContain(FAKE_AWS);
    expect(raw).toContain("[REDACTED:aws-key:");
  });

  it("sources.json: a re-seed of the same sensitive path still updates in place", async () => {
    const entry = { path: `/work/${FAKE_AWS}/repo`, kind: "directory", addedAt: NOW } as const;
    await store.recordSource(entry);
    await store.recordSource({ ...entry, lastSeededAt: NOW });
    expect((await store.sources()).sources).toHaveLength(1);
  });

  it("sources.json: an ordinary path is stored exactly as given", async () => {
    await store.recordSource({ path: "/work/repo", kind: "directory", addedAt: NOW });
    expect((await store.sources()).sources[0]?.path).toBe("/work/repo");
  });
});
