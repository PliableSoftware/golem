/**
 * DUST3.5 / S16: gateway ids that normalise to the same per-gateway env var
 * would hand one gateway's key to another's host. Config load must refuse them.
 */

import { describe, expect, it } from "vitest";
import { leafSchema } from "../../src/config/schema.js";

const gw = (id: string) => ({ id, provider: "openai", base_url: "https://example.test/v1" });

describe("proxy.gateways env-name collision", () => {
  const schema = leafSchema("proxy", "gateways");

  it("rejects ids that map to the same credential env var", () => {
    const res = schema?.safeParse([gw("work-1"), gw("work.1")]);
    expect(res?.success).toBe(false);
    expect(JSON.stringify(res?.error?.issues)).toMatch(/work-1.*work\.1|collid/i);
  });

  it("rejects case-only collisions", () => {
    expect(schema?.safeParse([gw("Work_1"), gw("work-1")]).success).toBe(false);
  });

  it("rejects an exact duplicate id", () => {
    expect(schema?.safeParse([gw("a"), gw("a")]).success).toBe(false);
  });

  it("accepts distinct ids", () => {
    expect(schema?.safeParse([gw("work"), gw("home")]).success).toBe(true);
  });
});
