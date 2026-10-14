/**
 * DUST2.15 — graph-first alias lookup and `fetch` completeness, through the MCP
 * tools. Real FileWikiStore + real GolemKnowledgeBase (hashing embedder, in-memory
 * driver); a fake KB only for the memory-scope hit, which has no point lookup.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { Chunk, Hit, IngestReport, KnowledgeBase } from "../../src/interfaces/index.js";
import { UnknownChunkError } from "../../src/interfaces/index.js";
import {
  GolemKnowledgeBase,
  hashingEmbedFn,
  InMemoryVectorDriver,
} from "../../src/knowledge/index.js";
import {
  createGolemMcpServer,
  createStandaloneDeps,
  type GolemMcpServerDeps,
} from "../../src/mcp/index.js";
import { FileWikiStore } from "../../src/wiki/index.js";
import { useTempDirs } from "../helpers/tmp.js";

const newTempDir = useTempDirs("golem-kb-lookup-");

async function connect(deps: GolemMcpServerDeps): Promise<Client> {
  const server = createGolemMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "kb-lookup-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const textOf = (r: unknown): string =>
  ((r as { content?: ReadonlyArray<{ type: string; text?: string }> }).content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");

type SearchOut = { hits: Array<{ chunk_id: string; source_path?: string }> };

function page(title: string, extra: string, body: string): string {
  return `---\ntitle: ${title}\ntype: concept\ntags: []\nsources: []\ncreated: 2026-10-01\nupdated: 2026-10-01\n${extra}---\n\n${body}\n`;
}

let root: string;
let wikiAbs: string;

beforeEach(async () => {
  root = await newTempDir();
  wikiAbs = path.join(root, "wiki");
  await mkdir(path.join(wikiAbs, "concepts"), { recursive: true });
  await writeFile(
    path.join(wikiAbs, "concepts", "Prompt Caching.md"),
    page(
      "Prompt Caching",
      "aliases: [PC, Cache Warmup]\n",
      "Prefix caching keeps the system prompt warm.",
    ),
  );
  await writeFile(
    path.join(wikiAbs, "concepts", "Other.md"),
    page("Other", "aliases: [pc]\n", "A second page that shares the alias PC."),
  );
  // A secret outside the wiki that a crafted id must never reach.
  await writeFile(path.join(root, "secret.md"), page("Secret", "", "TOP-SECRET-OUTSIDE-WIKI"));
});

function wikiDeps(knowledge: KnowledgeBase): GolemMcpServerDeps {
  return {
    ...createStandaloneDeps(),
    knowledge,
    wiki: new FileWikiStore({ wikiDir: wikiAbs }),
    wikiDir: "docs/wiki",
    defaultProjectId: "proj",
  };
}

class FakeMemoryKb implements KnowledgeBase {
  static readonly FULL = `${"memory fact ".repeat(60)}TAIL-MARKER`;
  async ingest(): Promise<IngestReport> {
    throw new Error("unused");
  }
  async search(_q: string, projectId: string): Promise<Hit[]> {
    return [
      {
        chunk: { chunkId: "memory:m-1", projectId, text: FakeMemoryKb.FULL, metadata: {} },
        score: 0.9,
        scope: "memory",
      },
    ];
  }
  async getChunk(chunkId: string): Promise<Chunk> {
    throw new UnknownChunkError(chunkId);
  }
}

describe("search: page alias via graph-first lookup", () => {
  it("surfaces every page carrying the alias, ahead of vector hits, in relPath order", async () => {
    const kb = new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed: hashingEmbedFn() });
    const client = await connect(wikiDeps(kb));
    const res = await client.callTool({ name: "search", arguments: { query: "PC" } });
    expect(res.isError).toBeFalsy();
    const ids = (res.structuredContent as SearchOut).hits.map((h) => h.chunk_id);
    expect(ids.slice(0, 2)).toEqual(["wiki:concepts/Other.md", "wiki:concepts/Prompt Caching.md"]);
  });

  it("matches an alias containing a space, and fetch returns that page's full text", async () => {
    const kb = new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed: hashingEmbedFn() });
    const client = await connect(wikiDeps(kb));
    const res = await client.callTool({ name: "search", arguments: { query: "cache warmup" } });
    const first = (res.structuredContent as SearchOut).hits[0];
    expect(first?.chunk_id).toBe("wiki:concepts/Prompt Caching.md");
    const fetched = await client.callTool({
      name: "fetch",
      arguments: { chunk_id: first?.chunk_id },
    });
    expect(fetched.isError).toBeFalsy();
    expect(textOf(fetched)).toContain("Prefix caching keeps the system prompt warm.");
  });
});

describe("fetch: every hit kind search can return", () => {
  it("returns the stored chunk for an ingested tree, with an `external:` key kept opaque", async () => {
    const outside = path.join(root, "outside-tree");
    const project = path.join(root, "project");
    await mkdir(outside, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(path.join(outside, "notes.md"), "# Notes\n\nzebra-quokka-marker lives here.\n");
    const kb = new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed: hashingEmbedFn() });
    await kb.ingest(outside, project);
    const client = await connect({
      ...createStandaloneDeps(),
      knowledge: kb,
      defaultProjectId: project,
    });

    const res = await client.callTool({
      name: "search",
      arguments: { query: "zebra-quokka-marker" },
    });
    const hit = (res.structuredContent as SearchOut).hits[0];
    expect(hit?.source_path?.startsWith("external:")).toBe(true);
    const fetched = await client.callTool({
      name: "fetch",
      arguments: { chunk_id: hit?.chunk_id },
    });
    expect(fetched.isError).toBeFalsy();
    expect(textOf(fetched)).toContain("zebra-quokka-marker");
    expect((fetched.structuredContent as { source_path?: string }).source_path).toBe(
      hit?.source_path,
    );
  });

  it("returns a graph-first wiki hit's full body", async () => {
    const client = await connect(
      wikiDeps(new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed: hashingEmbedFn() })),
    );
    const fetched = await client.callTool({
      name: "fetch",
      arguments: { chunk_id: "wiki:concepts/Other.md" },
    });
    expect(textOf(fetched)).toContain("shares the alias PC");
  });

  it("returns a memory-scope hit's FULL text after search surfaced it (preview is truncated)", async () => {
    const client = await connect(wikiDeps(new FakeMemoryKb()));
    const res = await client.callTool({ name: "search", arguments: { query: "anything" } });
    const hit = (
      res.structuredContent as { hits: Array<{ chunk_id: string; text_preview: string }> }
    ).hits.find((h) => h.chunk_id === "memory:m-1");
    expect(hit?.text_preview.includes("TAIL-MARKER")).toBe(false);
    const fetched = await client.callTool({ name: "fetch", arguments: { chunk_id: "memory:m-1" } });
    expect(fetched.isError).toBeFalsy();
    expect(textOf(fetched)).toContain("TAIL-MARKER");
  });

  it("reports a memory id never returned by search as a clear error", async () => {
    const client = await connect(wikiDeps(new FakeMemoryKb()));
    const fetched = await client.callTool({
      name: "fetch",
      arguments: { chunk_id: "memory:nope" },
    });
    expect(fetched.isError).toBe(true);
    expect(textOf(fetched)).toMatch(/memory/i);
  });

  it("reports a missing chunk as a clear error, not a crash", async () => {
    const client = await connect(
      wikiDeps(new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed: hashingEmbedFn() })),
    );
    for (const id of ["deadbeef", "wiki:concepts/Nope.md"]) {
      const fetched = await client.callTool({ name: "fetch", arguments: { chunk_id: id } });
      expect(fetched.isError).toBe(true);
      expect(textOf(fetched)).toContain(`Unknown chunk "${id}"`);
    }
  });
});

describe("fetch: crafted ids never read outside the store", () => {
  const crafted = [
    "wiki:../secret.md",
    "wiki:../../secret.md",
    "wiki:concepts/../../secret.md",
    "wiki:/etc/passwd",
    "wiki:C:\\Windows\\win.ini",
    "wiki:concepts/Other.md\0.png",
    "wiki:user:../../secret.md",
    "../secret.md",
    "external:/etc/passwd",
    "external:../secret.md",
    "/etc/passwd",
  ];

  it.each(crafted)("%j is a clear error and leaks nothing", async (id) => {
    const client = await connect(
      wikiDeps(new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed: hashingEmbedFn() })),
    );
    const fetched = await client.callTool({ name: "fetch", arguments: { chunk_id: id } });
    expect(fetched.isError).toBe(true);
    expect(textOf(fetched)).not.toContain("TOP-SECRET");
    expect(textOf(fetched)).not.toContain("root:");
    expect(textOf(fetched)).toContain("Unknown chunk");
  });

  it("an `external:<abs>` id naming a real file is never read from disk", async () => {
    const real = path.join(root, "secret.md");
    const client = await connect(
      wikiDeps(new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed: hashingEmbedFn() })),
    );
    const fetched = await client.callTool({
      name: "fetch",
      arguments: { chunk_id: `external:${real}` },
    });
    expect(fetched.isError).toBe(true);
    expect(textOf(fetched)).not.toContain("TOP-SECRET");
  });

  it("a non-markdown file inside the wiki dir is not served through a wiki: id", async () => {
    await writeFile(path.join(wikiAbs, "concepts", "raw.txt"), "RAW-NOT-A-PAGE");
    const client = await connect(
      wikiDeps(new GolemKnowledgeBase(new InMemoryVectorDriver(), { embed: hashingEmbedFn() })),
    );
    const fetched = await client.callTool({
      name: "fetch",
      arguments: { chunk_id: "wiki:concepts/raw.txt" },
    });
    expect(fetched.isError).toBe(true);
    expect(textOf(fetched)).not.toContain("RAW-NOT-A-PAGE");
  });
});
