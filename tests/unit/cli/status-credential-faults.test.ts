/** R8.29 — `golem status` shows a stored-but-malformed gateway key, with the fix. */

import { describe, expect, it } from "vitest";
import { collectStatus } from "../../../src/cli/status.js";
import { renderStatus } from "../../../src/cli/status-render.js";
import { createCredentialStore } from "../../../src/credentials/index.js";
import { VERSION } from "../../../src/version.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-status-cred");
const BODY = ["k", String(Date.now())].join("-");

describe("status credential faults", () => {
  it("reports the malformed default key by account, never the value", async () => {
    const userDir = await newTempDir();
    const projectDir = await newTempDir();
    const store = createCredentialStore({ userDir, keychain: null });
    await store.store("default", `${BODY}${String.fromCharCode(0x200b)}`, "file");
    const base = { projectDir, userDir, env: {}, version: VERSION, probeTimeoutMs: 1 };

    const report = await collectStatus({ ...base, credentialStore: store });
    expect(report.credential_faults?.[0]?.account).toBe("default");
    const text = renderStatus(report);
    expect(text).toMatch(/Credential: "default" NOT USABLE.*golem gateway login default/);
    expect(JSON.stringify(report)).not.toContain(BODY);
  });

  it("says nothing when the stored key is fine", async () => {
    const userDir = await newTempDir();
    const projectDir = await newTempDir();
    const store = createCredentialStore({ userDir, keychain: null });
    await store.store("default", BODY, "file");
    const report = await collectStatus({
      projectDir,
      userDir,
      env: {},
      version: VERSION,
      probeTimeoutMs: 1,
      credentialStore: store,
    });
    expect(report.credential_faults).toBeUndefined();
  });
});
