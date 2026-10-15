/**
 * DUST3.6: `model[262k]` used to go upstream as a literal model name because the
 * `[digits]` parse did not match. Only `[<digits>]` is a context suffix; any
 * other bracket suffix is a validation error.
 */

import { describe, expect, it } from "vitest";
import { leafSchema } from "../../src/config/schema.js";

const gw = (models: unknown[]) => [
  { id: "g", provider: "openai", base_url: "https://example.test/v1", models },
];

describe("proxy.gateways model descriptors", () => {
  const schema = leafSchema("proxy", "gateways");

  it("rejects a non-numeric bracket suffix", () => {
    for (const bad of ["model[262k]", "model[1m]", "model[]", "model[12 3]"]) {
      const res = schema?.safeParse(gw([bad]));
      expect(res?.success, bad).toBe(false);
    }
  });

  it("still parses digits-only suffixes and plain names", () => {
    const res = schema?.safeParse(gw(["plain", "big[262144]"]));
    expect(res?.success).toBe(true);
    expect((res as { data: { models: unknown[] }[] }).data[0]?.models).toEqual([
      { name: "plain", contextSize: undefined },
      { name: "big", contextSize: 262144 },
    ]);
  });
});
