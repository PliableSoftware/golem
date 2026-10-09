/**
 * DUST3.6: `golem gateway` papercuts — a mistyped `--store` must not silently
 * mean keychain, and `add --login` must read a piped secret like `login` does.
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loginGateway = vi.fn(async (..._a: unknown[]) => ({
  account: "g",
  stored_in: "stub",
  probe: "skipped",
}));
const addGateway = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../../../src/cli/gateways.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/cli/gateways.js")>()),
  loginGateway: (...a: unknown[]) => loginGateway(...a),
  addGateway: (...a: unknown[]) => addGateway(...a),
}));

// Built at runtime: no secret-shaped literal in the repo.
const PIPED = ["piped", String(Date.now())].join("-");

async function build(): Promise<Command> {
  const program = new Command().exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  const mod = await import("../../../src/cli/commands/gateway.js");
  mod.default(program);
  return program;
}

const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
function pipeStdin(text: string): void {
  const fake = {
    isTTY: false,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text);
    },
  };
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
}

describe("golem gateway", () => {
  beforeEach(() => {
    loginGateway.mockClear();
    addGateway.mockClear();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    if (realStdin !== undefined) Object.defineProperty(process, "stdin", realStdin);
    vi.restoreAllMocks();
  });

  it("rejects an unknown --store value instead of falling back to keychain", async () => {
    pipeStdin("");
    const program = await build();
    await expect(
      program.parseAsync(["node", "golem", "gateway", "login", "g", "--store", "fiel"]),
    ).rejects.toMatchObject({ code: "commander.invalidArgument" });
    expect(loginGateway).not.toHaveBeenCalled();
  });

  it("accepts --store file", async () => {
    pipeStdin("");
    const program = await build();
    await program.parseAsync(["node", "golem", "gateway", "login", "g", "--store", "file"]);
    expect(loginGateway.mock.calls[0]?.[3]).toMatchObject({ store: "file" });
  });

  it("add --login passes a piped secret through to loginGateway", async () => {
    pipeStdin(`${PIPED}\n`);
    const program = await build();
    await program.parseAsync([
      "node",
      "golem",
      "gateway",
      "add",
      "g",
      "--provider",
      "openai",
      "--base-url",
      "https://example.test/v1",
      "--login",
    ]);
    expect(loginGateway).toHaveBeenCalledTimes(1);
    expect(loginGateway.mock.calls[0]?.[3]).toMatchObject({ secret: PIPED });
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("login keeps a piped secret's own whitespace, dropping only one %s", async (_n, eol) => {
    const secret = `  ${PIPED} mid ${PIPED}  `;
    pipeStdin(`${secret}${eol}`);
    const program = await build();
    await program.parseAsync(["node", "golem", "gateway", "login", "g"]);
    expect(loginGateway.mock.calls[0]?.[3]).toMatchObject({ secret });
  });

  it("login strips a leading BOM along with the newline", async () => {
    pipeStdin(`\ufeff${PIPED}\r\n`);
    const program = await build();
    await program.parseAsync(["node", "golem", "gateway", "login", "g"]);
    expect(loginGateway.mock.calls[0]?.[3]).toMatchObject({ secret: PIPED });
  });

  it.each([
    ["a trailing blank line", `${PIPED}\n\n`],
    ["a doubled CR", `${PIPED}\r\r\n`],
    ["an embedded control character", `${PIPED}\u0007x\n`],
  ])("login refuses piped input with %s, without echoing it", async (_n, text) => {
    pipeStdin(text);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const program = await build();
    await expect(program.parseAsync(["node", "golem", "gateway", "login", "g"])).rejects.toThrow();
    expect(exit).toHaveBeenCalled();
    expect(loginGateway).not.toHaveBeenCalled();
    const written = err.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toMatch(/control character/);
    expect(written).not.toContain(PIPED);
  });
});
