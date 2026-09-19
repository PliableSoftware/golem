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
    .option(
      "--dir <path>",
      "project directory",
      () => findProjectDir(process.cwd()) ?? process.cwd(),
    )
    .action(async (opts: { persona?: string; dir: string }) => {
      if (opts.persona === undefined || opts.persona.trim() === "") {
        process.stderr.write("golem acp: --persona <id> is required.\n");
        process.exitCode = 1;
        return;
      }
      const code = await serveAcp({ projectDir: opts.dir, personaId: opts.persona });
      process.exitCode = code;
    });
}
