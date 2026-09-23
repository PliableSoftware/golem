/**
 * `golem acp` — R14.3. Golem's own ACP runtime for Buzz.
 *
 * `BUZZ_ACP_AGENT_ARGS` on the Buzz side splits ITS OWN value on commas to
 * build this process's argv (`acp,--persona,coder` → `["acp", "--persona",
 * "coder"]`); by the time this file sees `process.argv` it is an ordinary
 * argument list and Commander parses it exactly as it parses any other
 * subcommand's flags.
 */

import type { Command } from "commander";
import { serveAcp } from "../../buzz/acp-agent.js";
import { findProjectDir } from "../../config/index.js";

export default function register(program: Command): void {
  program
    .command("acp")
    .description(
      "Speak ACP (Agent Client Protocol) over stdio, as one persona — the transport " +
        "`BUZZ_ACP_AGENT_COMMAND=golem BUZZ_ACP_AGENT_ARGS=acp,--persona,<id>` points at",
    )
    .option("--persona <id>", "the persona this process serves — bound for the process lifetime")
    // Commander's third `.option()` argument is a PARSE FUNCTION, not a
    // default value — passing one here silently discarded an explicit
    // `--dir` and never applied the fallback (both `opts.dir` outcomes
    // resolved to whatever the function itself returned). Resolve the
    // fallback in the action instead, where `opts.dir` is `undefined` when
    // the flag was never given.
    .option("--dir <path>", "project directory")
    .action(async (opts: { persona?: string; dir?: string }) => {
      if (opts.persona === undefined || opts.persona.trim() === "") {
        process.stderr.write("golem acp: --persona <id> is required.\n");
        process.exitCode = 1;
        return;
      }
      const projectDir = opts.dir ?? findProjectDir(process.cwd()) ?? process.cwd();
      const code = await serveAcp({ projectDir, personaId: opts.persona });
      process.exitCode = code;
    });
}
