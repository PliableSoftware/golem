/**
 * DUST2.13 — web cache freshness + KB ingest, against a LOCAL http server and an
 * injected clock (no sleeps, no real network). Uses the real `fetchRawPage`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type HookIo, runWebFetchPre } from "../../../src/hooks/index.js";
import {
  fetchRawPage,
  MAX_WEB_INGEST_CHARS,
  openKnowledgeBase,
  WebCache,
  webCacheDir,
  webCacheKey,
} from "../../../src/knowledge/index.js";
import { useTempDirs } from "../../helpers/tmp.js";

const newTempDir = useTempDirs("golem-webfresh-");
let projectDir: string;
let server: Server;
let base: string;
let hits: Record<string, number>;
let headersFor: Record<string, Record<string, string>>;
let bodyFor: Record<string, string>;

beforeEach(async () => {
  projectDir = await newTempDir();
  hits = {};
  headersFor = {};
  bodyFor = {};
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const p = req.url ?? "/";
    hits[p] = (hits[p] ?? 0) + 1;
    res.writeHead(200, { "content-type": "text/plain", ...(headersFor[p] ?? {}) });
    res.end(bodyFor[p] ?? `page ${p} about zebra migration patterns`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function fakeIo(input: string): HookIo & { out: string[] } {
  const out: string[] = [];
  return {
    stdin: (async function* () {
      yield input;
    })(),
    stdout: { write: (t: string) => out.push(t) },
    stderr: { write: () => undefined },
    out,
  };
}

const T0 = Date.parse("2026-10-14T12:00:00Z");
async function pre(url: string, nowMs: number, over: Record<string, unknown> = {}) {
  const io = fakeIo(JSON.stringify({ cwd: projectDir, tool_input: { url, prompt: "?" } }));
  await runWebFetchPre(io, {
    projectDir,
    nowMs,
    nowIso: new Date(nowMs).toISOString(),
    ttlHours: 168,
    fetchRaw: (u: string) => fetchRawPage(u),
    fetchRawEnabled: async () => true,
    buildKnowledge: async (d: string) => openKnowledgeBase({ projectDir: d }),
    ...over,
  });
  return io.out.join("");
}
const cache = () => new WebCache(webCacheDir(projectDir));
const search = async (q: string) =>
  (await openKnowledgeBase({ projectDir }).search(q, projectDir, 3)).map((h) => h.chunk.sourcePath);

describe("fetchRawPage captures cache headers", () => {
  it("returns Date and flags Set-Cookie", async () => {
    headersFor["/c"] = { "set-cookie": "sid=1", date: "Wed, 14 Oct 2026 11:00:00 GMT" };
    const page = await fetchRawPage(`${base}/c`);
    expect(page.headers.setCookie).toBe(true);
    expect(page.headers.date).toBe("Wed, 14 Oct 2026 11:00:00 GMT");
  });
});

describe("max-age / Expires freshness (revalidation OFF)", () => {
  it("serves within the window without touching the network, refetches after it", async () => {
    headersFor["/m"] = { "cache-control": "max-age=3600" };
    const url = `${base}/m`;
    await pre(url, T0);
    expect(hits["/m"]).toBe(1);
    expect(await pre(url, T0 + 3_599_000)).toContain("zebra");
    expect(hits["/m"]).toBe(1); // served offline
    await pre(url, T0 + 3_601_000);
    expect(hits["/m"]).toBe(2); // window over → refetched although inside the 7d default TTL
  });

  it("honours Expires when there is no max-age", async () => {
    // Pin the server Date to the injected clock (node would stamp real time).
    headersFor["/e"] = {
      date: new Date(T0).toUTCString(),
      expires: new Date(T0 + 60_000).toUTCString(),
    };
    const url = `${base}/e`;
    await pre(url, T0);
    await pre(url, T0 + 30_000);
    expect(hits["/e"]).toBe(1);
    await pre(url, T0 + 90_000);
    expect(hits["/e"]).toBe(2);
  });

  it("with no freshness headers falls back to the default TTL", async () => {
    const url = `${base}/d`;
    await pre(url, T0);
    await pre(url, T0 + 167 * 3_600_000);
    expect(hits["/d"]).toBe(1);
    await pre(url, T0 + 169 * 3_600_000);
    expect(hits["/d"]).toBe(2);
  });

  it("never serves beyond the configured TTL even if max-age is longer", async () => {
    headersFor["/long"] = { "cache-control": "max-age=31536000" };
    const url = `${base}/long`;
    await pre(url, T0, { ttlHours: 1 });
    await pre(url, T0 + 2 * 3_600_000, { ttlHours: 1 });
    expect(hits["/long"]).toBe(2);
  });

  it("treats a stored entry with an unparseable expiresAt as stale, without throwing", async () => {
    const url = `${base}/bad`;
    await cache().put(url, "OLD", new Date(T0).toISOString(), {
      expiresAt: "not-a-date",
      raw: true,
    });
    const out = await pre(url, T0 + 1000);
    expect(hits["/bad"]).toBe(1);
    expect(out).toContain("zebra");
  });
});

describe("uncacheable responses are served but never stored or ingested", () => {
  it.each([
    ["no-store", { "cache-control": "no-store" }],
    ["private", { "cache-control": "private, max-age=60" }],
    ["no-cache", { "cache-control": "no-cache" }],
    ["set-cookie", { "set-cookie": "sid=abc" }],
  ])("%s", async (name, h) => {
    const p = `/u-${name}`;
    headersFor[p] = h;
    bodyFor[p] = "quokka habitat survey results";
    const url = `${base}${p}`;
    expect(await pre(url, T0)).toContain("quokka");
    expect(await cache().get(url)).toBeNull();
    expect(await search("quokka habitat")).not.toContain(`web:${url}`);
    await pre(url, T0 + 1000);
    expect(hits[p]).toBe(2); // nothing to serve offline
  });

  it("an earlier cached copy is dropped (cache + KB) when the page turns no-store", async () => {
    const url = `${base}/flip`;
    bodyFor["/flip"] = "okapi forest census";
    await pre(url, T0, { ttlHours: 168 });
    expect(await cache().get(url)).not.toBeNull();
    expect(await search("okapi forest census")).toContain(`web:${url}`);
    headersFor["/flip"] = { "cache-control": "no-store" };
    await pre(url, T0 + 1000, { ttlHours: 0 }); // force a refetch
    expect(await cache().get(url)).toBeNull();
    expect(await search("okapi forest census")).not.toContain(`web:${url}`);
  });

  it("never caches or ingests a URL that carries credentials", async () => {
    const userinfo = ["user", "pw"].join(":");
    const url = `${base.replace("http://", `http://${userinfo}@`)}/cred`;
    const io = fakeIo(JSON.stringify({ cwd: projectDir, tool_input: { url } }));
    await runWebFetchPre(io, {
      projectDir,
      nowMs: T0,
      fetchRaw: async () => ({ content: "secretive page body", headers: {} }),
      fetchRawEnabled: async () => true,
    });
    expect(await cache().get(url)).toBeNull();
  });
});

describe("KB ingest", () => {
  it("makes a fetched page searchable under an opaque web: key and serves a re-fetch offline", async () => {
    const url = `${base}/kb`;
    bodyFor["/kb"] = "# Pangolin\n\nPangolin scale composition is keratin.";
    await pre(url, T0);
    expect(await search("pangolin keratin")).toContain(`web:${url}`);
    await pre(url, T0 + 1000);
    expect(hits["/kb"]).toBe(1);
  });

  it("skips ingest (but still caches and serves) for a page over the size cap", async () => {
    const url = `${base}/big`;
    bodyFor["/big"] = `wombat ${"x ".repeat(MAX_WEB_INGEST_CHARS)}`;
    const out = await pre(url, T0);
    expect(out).toContain("wombat");
    expect(await cache().get(url)).not.toBeNull();
    expect(await search("wombat")).not.toContain(`web:${url}`);
  });

  it("skips ingest when buildKnowledge yields no KB (knowledge disabled)", async () => {
    const url = `${base}/off`;
    await pre(url, T0, { buildKnowledge: async () => null });
    expect(await cache().get(url)).not.toBeNull();
    expect(await search("zebra migration")).not.toContain(`web:${url}`);
  });
});

describe("cache file naming is traversal- and collision-safe", () => {
  const nasty = [
    "https://e.com/../../etc/passwd",
    "https://e.com/a/../../../x",
    "https://e.com/CON",
    "https://e.com/NUL.txt",
    `https://e.com/${"a".repeat(5000)}`,
    "https://e.com/a\\..\\b",
    "https://e.com/%2e%2e%2fx",
  ];
  it("maps every URL to a fixed-length hex name", () => {
    for (const u of nasty) expect(webCacheKey(u)).toMatch(/^[0-9a-f]{32}$/);
  });
  it("writes only inside the cache dir and keeps distinct URLs distinct", async () => {
    const c = cache();
    for (const [i, u] of nasty.entries()) await c.put(u, `body ${i}`, "2026-10-14T00:00:00Z");
    for (const [i, u] of nasty.entries()) expect((await c.get(u))?.content).toBe(`body ${i}`);
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(webCacheDir(projectDir));
    expect(names).toHaveLength(nasty.length);
    for (const n of names) expect(path.basename(n)).toBe(n);
  });
});
