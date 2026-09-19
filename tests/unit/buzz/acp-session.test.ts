import { describe, expect, it } from "vitest";
import { createSessionRegistry } from "../../../src/buzz/acp-session.js";

describe("acp-session registry", () => {
  it("creates a session retaining cwd, mcpServers, and personaId", () => {
    const registry = createSessionRegistry({ newId: () => "fixed-id" });
    const session = registry.create({
      cwd: "/project",
      mcpServers: [{ type: "stdio", name: "buzz" }],
      personaId: "coder",
    });
    expect(session).toEqual({
      id: "fixed-id",
      cwd: "/project",
      mcpServers: [{ type: "stdio", name: "buzz" }],
      personaId: "coder",
      history: [],
    });
  });

  it("looks sessions up by id and reports absence as undefined", () => {
    const registry = createSessionRegistry();
    const session = registry.create({ cwd: "/x", mcpServers: [], personaId: "reviewer" });
    expect(registry.get(session.id)).toBe(session);
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("deletes a session so it is no longer retrievable", () => {
    const registry = createSessionRegistry();
    const session = registry.create({ cwd: "/x", mcpServers: [], personaId: "reviewer" });
    registry.delete(session.id);
    expect(registry.get(session.id)).toBeUndefined();
  });

  it("mints distinct ids for distinct sessions by default", () => {
    const registry = createSessionRegistry();
    const a = registry.create({ cwd: "/x", mcpServers: [], personaId: "coder" });
    const b = registry.create({ cwd: "/x", mcpServers: [], personaId: "coder" });
    expect(a.id).not.toBe(b.id);
  });
});
