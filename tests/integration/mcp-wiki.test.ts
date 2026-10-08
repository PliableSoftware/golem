/**
 * WS-W W2 — wiki_read / wiki_upsert on the unified MCP server.
 *
 * Exercises the real FileWikiStore (not a fake) over a temp directory,
 * through the actual MCP wire protocol, mirroring mcp-knowledge.test.ts's
 * pattern: tool registration is gated on `deps.wiki`, and errors (unknown
 * page, write conflict) must come back as actionable `isError` results.
 */

import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createGolemMcpServer,
  createStandaloneDeps,
  type GolemMcpServerDeps,
} from "../../src/mcp/index.js";
import { JsonlTelemetryStore } from "../../src/telemetry/index.js";
import { FileWikiStore } from "../../src/wiki/index.js";
import { useTempDirs } from "../helpers/tmp.js";

const WIKI_TOOLS = ["wiki_read", "wiki_upsert"] as const;

async function connect(deps: GolemMcpServerDeps): Promise<Client> {
  const server = createGolemMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wiki-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content?: ReadonlyArray<{ type: string; text?: string }> }).content;
  return (content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

let dir: string;

const newTempDir = useTempDirs("golem-wiki-mcp-");

beforeEach(async () => {
  dir = await newTempDir();
});

function depsWithWiki(): GolemMcpServerDeps {
  return {
    ...createStandaloneDeps(),
    wiki: new FileWikiStore({ wikiDir: dir, now: () => "2026-07-10" }),
  };
}

describe("MCP wiki tools (WS-W W2)", () => {
  it("does NOT register wiki tools when no WikiStore is injected", async () => {
    const client = await connect(createStandaloneDeps());
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of WIKI_TOOLS) expect(names).not.toContain(tool);
  });

  it("registers both wiki tools when a WikiStore is present", async () => {
    const client = await connect(depsWithWiki());
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of WIKI_TOOLS) expect(names).toContain(tool);
  });

  it("creates a page via wiki_upsert, then reads it back by title and by path", async () => {
    const client = await connect(depsWithWiki());

    const created = await client.callTool({
      name: "wiki_upsert",
      arguments: {
        rel_path: "concepts/Prompt Caching.md",
        title: "Prompt Caching",
        type: "concept",
        tags: ["cache"],
        sources: ["docs/wiki/WIKI.md"],
        body: "Caching keeps a byte-identical prefix.",
      },
    });
    expect(created.isError).toBeFalsy();
    expect(created.structuredContent).toMatchObject({
      rel_path: "concepts/Prompt Caching.md",
      title: "Prompt Caching",
      type: "concept",
      created: "2026-07-10",
      updated: "2026-07-10",
      appended: false,
    });

    const byTitle = await client.callTool({
      name: "wiki_read",
      arguments: { title_or_path: "Prompt Caching" },
    });
    expect(byTitle.isError).toBeFalsy();
    expect(textOf(byTitle)).toContain("byte-identical prefix");
    expect(byTitle.structuredContent).toMatchObject({ rel_path: "concepts/Prompt Caching.md" });

    const byPath = await client.callTool({
      name: "wiki_read",
      arguments: { title_or_path: "concepts/Prompt Caching.md" },
    });
    expect(byPath.isError).toBeFalsy();
    expect(byPath.structuredContent).toMatchObject({ title: "Prompt Caching" });
  });

  it("appends and merges tags/sources on a second upsert to the same page", async () => {
    const client = await connect(depsWithWiki());
    await client.callTool({
      name: "wiki_upsert",
      arguments: {
        rel_path: "concepts/Prompt Caching.md",
        title: "Prompt Caching",
        type: "concept",
        tags: ["cache"],
        sources: ["a"],
        body: "First note.",
      },
    });
    const second = await client.callTool({
      name: "wiki_upsert",
      arguments: {
        rel_path: "concepts/Prompt Caching.md",
        title: "Prompt Caching",
        type: "concept",
        tags: ["cache", "prompts"],
        sources: ["b"],
        body: "Second note.",
      },
    });
    expect(second.isError).toBeFalsy();
    expect(second.structuredContent).toMatchObject({
      tags: ["cache", "prompts"],
      sources: ["a", "b"],
      appended: true,
    });
    const body = (second.structuredContent as { body: string }).body;
    expect(body).toContain("First note.");
    expect(body).toContain("Second note.");
  });

  it("returns isError with a helpful hint for an unknown page", async () => {
    const client = await connect(depsWithWiki());
    const result = await client.callTool({
      name: "wiki_read",
      arguments: { title_or_path: "Nonexistent Page" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Nonexistent Page");
    expect(textOf(result)).toContain("WIKI.md");
  });

  it("returns isError on a title/type conflict at an existing path", async () => {
    const client = await connect(depsWithWiki());
    await client.callTool({
      name: "wiki_upsert",
      arguments: {
        rel_path: "concepts/Prompt Caching.md",
        title: "Prompt Caching",
        type: "concept",
        body: "body",
      },
    });
    const conflict = await client.callTool({
      name: "wiki_upsert",
      arguments: {
        rel_path: "concepts/Prompt Caching.md",
        title: "Something Else",
        type: "concept",
        body: "body",
      },
    });
    expect(conflict.isError).toBe(true);
    expect(textOf(conflict)).toContain("conflict");
  });

  it("rejects invalid input (empty body) as an InvalidParams error result", async () => {
    const client = await connect(depsWithWiki());
    const result = await client.callTool({
      name: "wiki_upsert",
      arguments: {
        rel_path: "concepts/Prompt Caching.md",
        title: "Prompt Caching",
        type: "concept",
        body: "",
      },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain("Input validation error");
  });

  // DUST3.8 S13: the wiki is a committed tree; nothing secret-shaped may reach it.
  it("redacts a secret in the body and in frontmatter values, on disk and in the result", async () => {
    const client = await connect(depsWithWiki());
    const bodySecret = `ghp_${"a1B2c3D4".repeat(5)}`;
    const tagSecret = `ghp_${"z9Y8x7W6".repeat(5)}`;
    const sourceSecret = `ghp_${"q1w2e3r4".repeat(5)}`;
    const titleSecret = `ghp_${"m5n6b7v8".repeat(5)}`;
    const result = await client.callTool({
      name: "wiki_upsert",
      arguments: {
        rel_path: "concepts/Leaky.md",
        title: `Leaky ${titleSecret}`,
        type: "concept",
        tags: [tagSecret],
        sources: [`https://example.com/?token=${sourceSecret}`],
        body: `Token is ${bodySecret} here.`,
      },
    });
    expect(result.isError).toBeFalsy();
    const onDisk = await readFile(path.join(dir, "concepts", "Leaky.md"), "utf8");
    const returned = `${textOf(result)}\n${JSON.stringify(result.structuredContent)}`;
    for (const secret of [bodySecret, tagSecret, sourceSecret, titleSecret]) {
      expect(onDisk).not.toContain(secret);
      expect(returned).not.toContain(secret);
    }
    expect(onDisk).toContain("Token is");
  });

  it("redacts an appended body on an existing page too", async () => {
    const client = await connect(depsWithWiki());
    const args = { rel_path: "concepts/Twice.md", title: "Twice", type: "concept" as const };
    await client.callTool({ name: "wiki_upsert", arguments: { ...args, body: "first" } });
    const secret = `ghp_${"k3j4h5g6".repeat(5)}`;
    const second = await client.callTool({
      name: "wiki_upsert",
      arguments: { ...args, body: `second ${secret}` },
    });
    const onDisk = await readFile(path.join(dir, "concepts", "Twice.md"), "utf8");
    expect(onDisk).not.toContain(secret);
    expect(JSON.stringify(second.structuredContent)).not.toContain(secret);
  });

  // DUST3.8 h5: every other tool records a per-call event; wiki_upsert did not.
  it("records a telemetry event for wiki_upsert", async () => {
    const telDir = path.join(dir, "tel");
    const store = new JsonlTelemetryStore(telDir);
    const client = await connect({
      ...depsWithWiki(),
      defaultProjectId: "projW",
      telemetry: store,
    });
    await client.callTool({
      name: "wiki_upsert",
      arguments: { rel_path: "concepts/T.md", title: "T", type: "concept", body: "x" },
    });
    await store.close();
    const usage = await new JsonlTelemetryStore(telDir).aggregateToolUsage("projW");
    expect(usage.byTool.wiki_upsert?.calls).toBe(1);
  });

  // DUST3.8 D2: readPage appends ".md"; upsertPage must too.
  it("writes 'foo' and reads 'foo' through the same file", async () => {
    const client = await connect(depsWithWiki());
    const first = await client.callTool({
      name: "wiki_upsert",
      arguments: { rel_path: "concepts/Foo", title: "Foo", type: "concept", body: "one" },
    });
    expect(first.isError).toBeFalsy();
    expect(first.structuredContent).toMatchObject({ rel_path: "concepts/Foo.md", appended: false });
    const second = await client.callTool({
      name: "wiki_upsert",
      arguments: { rel_path: "concepts/Foo", title: "Foo", type: "concept", body: "two" },
    });
    expect(second.structuredContent).toMatchObject({ appended: true });
    const read = await client.callTool({
      name: "wiki_read",
      arguments: { title_or_path: "concepts/Foo" },
    });
    expect(textOf(read)).toContain("two");
  });

  // DUST3.8 review: rel_path is stored raw as a file name in a committed tree.
  it("refuses a rel_path carrying a token, writes nothing and never echoes it", async () => {
    const client = await connect(depsWithWiki());
    const hex = randomBytes(20).toString("hex");
    const tok = `ghp_${"a1B2c3D4".repeat(5)}`;
    for (const rel of [`concepts/${hex}.md`, `concepts/${tok}.md`]) {
      const result = await client.callTool({
        name: "wiki_upsert",
        arguments: { rel_path: rel, title: "T", type: "concept", body: "x" },
      });
      expect(result.isError).toBe(true);
      const echoed = `${textOf(result)}${JSON.stringify(result.structuredContent ?? {})}`;
      expect(echoed).not.toContain(hex);
      expect(echoed).not.toContain(tok);
    }
    const written = await readdir(dir, { recursive: true });
    expect(written).toEqual([]);
  });
});
