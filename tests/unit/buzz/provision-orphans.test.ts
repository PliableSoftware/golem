/**
 * DUST3.16 D9 — provisioning must not orphan identities it minted before
 * discovering a blocked one, and its recovery hint must name a real step.
 * No CLI reaches `provisionBuzz` yet (R14.2), so this drives the function.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buzzAccount, ORCHESTRATOR_ID, projectKey } from "../../../src/buzz/identity.js";
import { buzzManifestPath, provisionBuzz, readManifest } from "../../../src/buzz/provision.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-provision");

const LOCATION = {
  backend: "file" as const,
  label: "memory",
  protection: "file-permissions" as const,
};

/** In-memory MintStore; account -> secret. */
function memoryStore(initial: Record<string, string> = {}) {
  const secrets = new Map(Object.entries(initial));
  return {
    secrets,
    async resolve(account: string) {
      const secret = secrets.get(account);
      return secret === undefined ? null : { secret, location: LOCATION };
    },
    async store(account: string, secret: string) {
      secrets.set(account, secret);
      return LOCATION;
    },
    async forget(account: string) {
      secrets.delete(account);
      return [];
    },
  };
}

describe("provisionBuzz with a blocked (orphaned) persona", () => {
  it("writes manifest records for the personas it minted before throwing, and names a real recovery step", async () => {
    const base = await newTempDir();
    const projectDir = path.join(base, "project");
    const userDir = path.join(base, "user");
    await mkdir(path.join(projectDir, ".golem"), { recursive: true });
    await mkdir(userDir, { recursive: true });
    await writeFile(
      path.join(projectDir, ".golem", "settings.json"),
      JSON.stringify({ inference: { personas: { coder: { model: "claude-sonnet-5" } } } }),
    );

    // The orchestrator has a stored secret but no manifest record: blocked.
    // `coder` has nothing stored: it gets minted, and its secret lands in the store.
    const orphanAccount = buzzAccount(projectKey(projectDir), ORCHESTRATOR_ID);
    const store = memoryStore({ [orphanAccount]: randomBytes(32).toString("hex") });
    const pubkeyHex = randomBytes(32).toString("hex");
    const secretHex = randomBytes(32).toString("hex");

    let thrown: Error | undefined;
    try {
      await provisionBuzz({
        projectDir,
        userDir,
        store,
        generateKeypair: async () => ({ pubkeyHex, secretHex }),
      });
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown?.message).toContain(ORCHESTRATOR_ID);
    expect(thrown?.message).not.toContain("provision --rotate");
    expect(thrown?.message).toContain("rotateIdentity");

    // The minted persona's secret is in the store, so its pubkey must be on disk.
    expect(store.secrets.get(buzzAccount(projectKey(projectDir), "coder"))).toBe(secretHex);
    const manifest = await readManifest(projectDir);
    expect(manifest?.agents.map((a) => a.persona)).toEqual(["coder"]);
    expect(manifest?.agents[0]?.pubkey).toBe(pubkeyHex);
    expect(await readFile(buzzManifestPath(projectDir), "utf8")).not.toContain(secretHex);
  });
});
