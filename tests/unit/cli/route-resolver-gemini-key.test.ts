/**
 * DUST3.5 / S21: the route-resolver header says no key is ever placed on a
 * route, yet the Gemini `?key=` rode in `translateUpstream.path`. The key now
 * travels as a header applied at send time.
 */

import { describe, expect, it } from "vitest";
import { createRouteResolver } from "../../../src/cli/route-resolver.js";

// Built at runtime so no secret-shaped literal is committed.
const KEY = ["gm", "k", String(Date.now()), "probe"].join("-");

function resolve() {
  const resolver = createRouteResolver({
    settings: {
      upstream_provider: "anthropic",
      upstream_base_url: "https://api.anthropic.com",
      upstream_auth_scheme: "inherit",
      map_reasoning_to_thinking: true,
      gateways: [
        {
          id: "g",
          provider: "gemini",
          base_url: "https://generativelanguage.googleapis.com/v1beta",
          models: [{ name: "gemini-2.0-flash" }],
        },
      ],
      targets: [{ id: "g", gateway: "g", model: { name: "gemini-2.0-flash" } }],
      model: "g",
    },
    env: { GOLEM_UPSTREAM_API_KEY__G: KEY },
  });
  const out = resolver({
    method: "POST",
    url: "/v1/messages",
    headers: {},
    body: Buffer.from(JSON.stringify({ model: "x", messages: [{ role: "user", content: "hi" }] })),
  });
  if (!out.ok) throw new Error("expected a route");
  return out.route;
}

describe("gemini route carries no key", () => {
  it("keeps the key out of every path on the route", () => {
    const route = resolve();
    const t = route.translateUpstream;
    expect(t?.path).not.toContain(KEY);
    expect(t?.path).not.toContain("key=");
    const body = Buffer.from(JSON.stringify({ model: "x", messages: [] }));
    expect(t?.translateRequest(body).path ?? "").not.toContain(KEY);
    expect(JSON.stringify(route)).not.toContain(KEY);
  });

  it("applies the key as a header at send time", () => {
    const route = resolve();
    const out = route.mapUpstreamHeaders?.({ "x-api-key": "client-anthropic", accept: "*/*" });
    expect(out?.["x-goog-api-key"]).toBe(KEY);
    expect(out?.["x-api-key"]).toBeUndefined();
  });
});

describe("model extraction (bodyModelOf)", () => {
  it("routes by body model across shapes", () => {
    const resolver = createRouteResolver({
      settings: {
        upstream_provider: "anthropic",
        upstream_base_url: "https://a.test",
        upstream_auth_scheme: "inherit",
        map_reasoning_to_thinking: true,
        gateways: [
          { id: "a", provider: "anthropic", base_url: "https://a.test", models: [{ name: "ma" }] },
          { id: "b", provider: "anthropic", base_url: "https://b.test", models: [{ name: "mb" }] },
        ],
        targets: [
          { id: "a", gateway: "a", model: { name: "ma" } },
          { id: "b", gateway: "b", model: { name: "mb" } },
        ],
        model: "a",
      },
      env: {},
    });
    const base = (body: string | null) =>
      resolver({
        method: "POST",
        url: "/v1/messages",
        headers: {},
        body: body === null ? null : Buffer.from(body),
      });
    const pick = (body: string | null) => {
      const r = base(body);
      return r.ok ? r.route.targetId : `err:${r.status}`;
    };
    expect(pick('{"model":"golem/b","messages":[]}')).toBe("b");
    // model key AFTER large content, nested decoys, and escapes
    expect(
      pick(`{"messages":[{"model":"golem/b","content":"${"x".repeat(5000)}"}],"model":"golem/b"}`),
    ).toBe("b");
    expect(pick('{"messages":[{"model":"golem/b"}]}')).toBe("a");
    expect(pick('{"model":"golem\\/b"}')).toBe("b");
    expect(pick('{"model":"claude","model":"golem/b"}')).toBe("b");
    expect(pick('{"model":"golem/b","model":"claude"}')).toBe("a");
    expect(pick('  {"a":[1,{"model":"golem/b"}],"b":"q\\"x","model":"golem/b" }')).toBe("b");
    expect(pick('{"model":42}')).toBe("a");
    expect(pick("not json")).toBe("a");
    expect(pick(null)).toBe("a");
    expect(pick('{"model":"golem/nope"}')).toBe("err:400");
  });
});

describe("gemini route with no stored key", () => {
  it("never forwards the client's Anthropic credentials", () => {
    const oauth = ["Bearer", "oauth", String(Date.now())].join(" ");
    const apiKey = ["sk", "client", String(Date.now())].join("-");
    const resolver = createRouteResolver({
      settings: {
        upstream_provider: "anthropic",
        upstream_base_url: "https://api.anthropic.com",
        upstream_auth_scheme: "inherit",
        map_reasoning_to_thinking: true,
        gateways: [
          {
            id: "g",
            provider: "gemini",
            base_url: "https://generativelanguage.googleapis.com/v1beta",
            models: [{ name: "gemini-2.0-flash" }],
          },
        ],
        targets: [{ id: "g", gateway: "g", model: { name: "gemini-2.0-flash" } }],
        model: "g",
      },
      env: {},
    });
    const out = resolver({ method: "POST", url: "/v1/messages", headers: {}, body: null });
    if (!out.ok) throw new Error("expected a route");
    const sent = out.route.mapUpstreamHeaders?.({
      "x-api-key": apiKey,
      authorization: oauth,
      "anthropic-version": "2023-06-01",
    });
    expect(sent).toBeDefined();
    expect(sent?.["x-api-key"]).toBeUndefined();
    expect(sent?.authorization).toBeUndefined();
    expect(sent?.["x-goog-api-key"]).toBeUndefined();
  });
});
