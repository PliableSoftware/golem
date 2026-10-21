/** `PortalClient.projects`: `GET /api/v1/orgs/{orgId}/projects`, per the v1 contract. */

import { describe, expect, it } from "vitest";
import {
  type AuthorizationServerMetadata,
  createPortalClient,
  type FetchLike,
  PortalAuthError,
  type PortalTokenSet,
  type PortalTokenStore,
} from "../../../src/portal/index.js";

const ISSUER = "https://clerk.example.test";
const API = "https://portal.example.test";
const META: AuthorizationServerMetadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`,
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
};
const TOKENS: PortalTokenSet = {
  issuer: ISSUER,
  client_id: "client_abc",
  api_origin: API,
  issuer_origin: ISSUER,
  access_token: "at-1",
  refresh_token: "rt-1",
  token_type: "Bearer",
  obtained_at: 1,
};
const store: PortalTokenStore = {
  read: async () => TOKENS,
  write: async () => ({ backend: "keychain", label: "t", protection: "os-keychain" }),
  clear: async () => [],
};

function client(fetchImpl: FetchLike) {
  return createPortalClient({
    apiBaseUrl: API,
    clientId: "client_abc",
    metadata: async () => META,
    tokens: store,
    fetchImpl,
    now: () => 1_000,
  });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("client.projects", () => {
  it("requests the org's projects path and returns the contract shape", async () => {
    const urls: string[] = [];
    const c = client(async (url) => {
      urls.push(url);
      return json(200, {
        projects: [
          { slug: "default", name: "Default", description: "", default: true, extra: 1 },
          { slug: "web-app", name: "Web app", description: "The site", default: false },
        ],
        future_field: true,
      });
    });
    const list = await c.projects("org_abc");
    expect(urls).toEqual([`${API}/api/v1/orgs/org_abc/projects`]);
    expect(list).toEqual([
      { slug: "default", name: "Default", description: "", default: true },
      { slug: "web-app", name: "Web app", description: "The site", default: false },
    ]);
  });

  it("tolerates a missing description and a null one", async () => {
    const c = client(async () =>
      json(200, { projects: [{ slug: "a", name: "A", default: true, description: null }] }),
    );
    expect(await c.projects("org_abc")).toEqual([
      { slug: "a", name: "A", description: "", default: true },
    ]);
  });

  it("leaves out an entry whose slug this harness would not write", async () => {
    const c = client(async () =>
      json(200, {
        projects: [
          { slug: "ok", name: "Ok", description: "", default: true },
          { slug: "Not Ok", name: "Bad", description: "", default: false },
        ],
      }),
    );
    expect((await c.projects("org_abc")).map((p) => p.slug)).toEqual(["ok"]);
  });

  it.each([
    402, 403, 404, 500, 503,
  ])("a %i throws PortalAuthError carrying the status", async (status) => {
    const c = client(async () => json(status, { error: "x", code: "whatever" }));
    await expect(c.projects("org_abc")).rejects.toMatchObject({
      name: "PortalAuthError",
      status,
    });
  });

  it("an unexpected body shape is an error, not an empty list", async () => {
    const c = client(async () => json(200, { nope: [] }));
    await expect(c.projects("org_abc")).rejects.toBeInstanceOf(PortalAuthError);
  });

  it("a portal that never answers is a timed-out PortalAuthError, not a hang", async () => {
    const c = client(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(c.projects("org_abc", 30)).rejects.toThrow(/timed out/);
  });

  it("sends an abort signal by default", async () => {
    let signal: AbortSignal | null | undefined;
    const c = client(async (_url, init) => {
      signal = init?.signal;
      return json(200, { projects: [] });
    });
    await c.projects("org_abc");
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
