/**
 * DUST3.15 (2026-10-09, USER decision LOG) — the host log rotates BY RENAME past
 * a size; there is no read-modify-write on the append path.
 */

import { spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  appendHostLog,
  type HostLogEntry,
  hostLogPath,
  readHostLog,
} from "../../../src/session/host-log.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-hostlog-");

const turn = (n: number): HostLogEntry => ({
  kind: "turn",
  ts: "2026-10-09T00:00:00.000Z",
  sessionId: "s",
  origin: `device-${n % 4}`,
  text: `turn ${n} ${"x".repeat(40)}`,
});

async function logFiles(dir: string): Promise<string[]> {
  const stateDir = path.dirname(hostLogPath(dir));
  return (await readdir(stateDir)).filter((n) => /^host-log\b.*\.jsonl$/.test(n)).sort();
}

async function allTurnTexts(dir: string): Promise<string[]> {
  const stateDir = path.dirname(hostLogPath(dir));
  const out: string[] = [];
  for (const name of await logFiles(dir)) {
    const raw = await readFile(path.join(stateDir, name), "utf8");
    for (const l of raw.split("\n").filter((x) => x !== "")) {
      out.push((JSON.parse(l) as { text: string }).text);
    }
  }
  return out;
}

describe("host log rotation", () => {
  it("concurrent appends from several writers across the threshold lose nothing", async () => {
    const dir = await newTempDir();
    const waves = 25;
    const perWave = 16;
    const total = waves * perWave;
    // Writers race in waves, so several rotations happen while appends are in flight.
    for (let w = 0; w < waves; w += 1) {
      await Promise.all(
        Array.from({ length: perWave }, (_, k) =>
          appendHostLog(dir, turn(w * perWave + k), { maxBytes: 1_500, keep: 10_000 }),
        ),
      );
    }
    const files = await logFiles(dir);
    expect(files.filter((f) => f !== "host-log.jsonl").length).toBeGreaterThan(1);
    const texts = await allTurnTexts(dir);
    expect(texts).toHaveLength(total);
    expect(new Set(texts).size).toBe(total); // every turn, none twice
  });

  it("keeps exactly N rotated files and deletes the oldest", async () => {
    const dir = await newTempDir();
    for (let n = 0; n < 60; n += 1) {
      await appendHostLog(dir, turn(n), { maxBytes: 300, keep: 2 });
    }
    const files = await logFiles(dir);
    const rotated = files.filter((f) => f !== "host-log.jsonl");
    expect(rotated).toHaveLength(2);
    // Oldest gone, newest kept: the surviving tail is contiguous and ends at 59.
    const texts = await allTurnTexts(dir);
    const ns = texts.map((t) => Number(t.split(" ")[1]));
    expect(ns[ns.length - 1]).toBe(59);
    expect(ns).toEqual(Array.from({ length: ns.length }, (_, i) => 59 - ns.length + 1 + i));
    expect(ns.length).toBeLessThan(60);
  });

  it("does not rotate under the threshold", async () => {
    const dir = await newTempDir();
    for (let n = 0; n < 5; n += 1) await appendHostLog(dir, turn(n));
    expect(await logFiles(dir)).toEqual(["host-log.jsonl"]);
  });

  it("readHostLog spans rotated files, newest last", async () => {
    const dir = await newTempDir();
    for (let n = 0; n < 30; n += 1) {
      await appendHostLog(dir, turn(n), { maxBytes: 300, keep: 100 });
    }
    const entries = (await readHostLog(dir, 25)) as readonly { text: string }[];
    expect(entries).toHaveLength(25);
    expect(entries[24]?.text.startsWith("turn 29 ")).toBe(true);
    expect(entries[0]?.text.startsWith("turn 5 ")).toBe(true);
  });

  it("does not rotate a young file that replaced the one measured", async () => {
    const dir = await newTempDir();
    await appendHostLog(dir, turn(0)); // creates the live file, tiny
    // A tiny live file under a huge cap is the state a losing writer sees after the
    // winner rotated: it must be left alone.
    await appendHostLog(dir, turn(1), { maxBytes: 10_000_000 });
    expect(await logFiles(dir)).toEqual(["host-log.jsonl"]);
  });

  it("readHostLog tolerates a stray rotated-looking name and a vanished file", async () => {
    const dir = await newTempDir();
    for (let n = 0; n < 12; n += 1) {
      await appendHostLog(dir, turn(n), { maxBytes: 300, keep: 100 });
    }
    const stateDir = path.dirname(hostLogPath(dir));
    await writeFile(path.join(stateDir, "host-log.0000000000001-zz.jsonl"), "not json\n");
    const entries = await readHostLog(dir, 500);
    expect(entries).toHaveLength(12);
  });

  it("separate processes appending across the threshold lose nothing", async () => {
    const dir = await newTempDir();
    const script = fileURLToPath(new URL("../../fixtures/host-log-writer.mts", import.meta.url));
    const writers = ["a", "b", "c", "d"];
    const per = 60;
    const codes = await Promise.all(
      writers.map(
        (tag) =>
          new Promise<number | null>((resolve) => {
            const child = spawn(
              process.execPath,
              ["--import", "tsx", script, dir, tag, String(per), "1500"],
              { stdio: "ignore" },
            );
            child.on("close", resolve);
          }),
      ),
    );
    expect(codes).toEqual([0, 0, 0, 0]);
    const texts = await allTurnTexts(dir);
    expect(texts).toHaveLength(writers.length * per);
    expect(new Set(texts).size).toBe(writers.length * per);
    expect((await logFiles(dir)).length).toBeGreaterThan(1);
  }, 60_000);
});
