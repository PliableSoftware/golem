/**
 * `src/plugins/redaction-init.ts` — plugin redaction rules for every process
 * that redacts (DUSTSEC.8 / R6, ADR-0005).
 *
 * The proxy and `golem mcp serve` call {@link initPlugins} at startup. Hooks, the
 * vibe store, the join queue and session state run in OTHER, short-lived
 * processes and used the built-in table only, so an org-private token format a
 * plugin teaches Golem to redact was forwarded or stored raw on those paths.
 * They now go through this one function, which is the same `initPlugins` call:
 * there is one way to build the effective rule list.
 *
 * Contract: built-ins always run (this only ever appends); a load failure is
 * reported on stderr and leaves the built-in table in force — never "no
 * redaction". Call it BEFORE the redaction it is meant to cover; it is async
 * because plugins are ES modules, and the rule table itself stays synchronous.
 */

import { pluginRedactionRulesSealed } from "../pipeline/redaction-rules.js";

const inFlight = new Map<string, Promise<void>>();

function warn(message: string): void {
  process.stderr.write(`golem: ${message}\n`);
}

async function load(projectDir: string): Promise<void> {
  try {
    const { loadEffectiveConfig } = await import("../config/index.js");
    const { settings } = await loadEffectiveConfig({ projectDir });
    // Nothing configured: no loader import, no table change. The common case.
    if (settings.plugins.load.length === 0) return;
    const { initPlugins } = await import("./init.js");
    const { VERSION } = await import("../version.js");
    await initPlugins({
      specifiers: settings.plugins.load,
      enabled: settings.plugins.enabled,
      projectDir,
      golemVersion: VERSION,
      log: warn,
      announce: false,
    });
  } catch (err) {
    warn(
      `plugin redaction rules NOT loaded (${err instanceof Error ? err.message : String(err)}) — ` +
        "built-in redaction rules still apply",
    );
  }
}

/**
 * Make sure this process's redaction table includes the project's plugin rules.
 * Idempotent per process and per directory; never throws. A process that already
 * registered rules (the proxy, `mcp serve`) is left alone.
 */
export function ensurePluginRedactionRules(projectDir: string): Promise<void> {
  if (pluginRedactionRulesSealed()) return Promise.resolve();
  let pending = inFlight.get(projectDir);
  if (pending === undefined) {
    pending = load(projectDir);
    inFlight.set(projectDir, pending);
  }
  return pending;
}

/** Test-only: forget memoised loads. */
export function resetEnsurePluginRedactionRulesForTests(): void {
  inFlight.clear();
}
