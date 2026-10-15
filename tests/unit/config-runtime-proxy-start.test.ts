/**
 * DUST3.5: the control-surface "start proxy" toggle must hand the daemon the
 * stored gateway credentials, like every other start path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const startDetached = vi.fn(async (..._a: unknown[]) => 123);
vi.mock("../../src/cli/proxy-daemon.js", async (orig) => ({
  ...(await orig<typeof import("../../src/cli/proxy-daemon.js")>()),
  startDetached: (...a: unknown[]) => startDetached(...a),
}));
vi.mock("../../src/cli/gateways.js", async (orig) => ({
  ...(await orig<typeof import("../../src/cli/gateways.js")>()),
  credentialEnvForProxy: async () => ({ GOLEM_UPSTREAM_API_KEY__WORK: "runtime-built" }),
}));

describe("applyRuntime proxy start", () => {
  beforeEach(() => startDetached.mockClear());

  it("passes the resolved credential env to startDetached", async () => {
    const { applyRuntime } = await import("../../src/config/control-surface-runtime.js");
    await applyRuntime("proxy", true, "runtime", { cliPath: "/x/cli.js" } as never, {
      projectDir: process.cwd(),
    });
    expect(startDetached).toHaveBeenCalledTimes(1);
    expect(startDetached.mock.calls[0]?.[3]).toEqual({
      GOLEM_UPSTREAM_API_KEY__WORK: "runtime-built",
    });
  });
});
