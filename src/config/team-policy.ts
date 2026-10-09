/**
 * What a TEAM (a remote origin) may set, per leaf key. USER decision P4: a team
 * may only TIGHTEN a member's machine, never loosen it.
 *
 * A deny-list cannot be completed key by key, so this is DEFAULT-DENY: every
 * leaf in the settings schema carries a class here, `TEAM_POLICY` is typed as a
 * total map over the schema's leaf paths (a new key is a compile error until it
 * is classified), and a test enumerates the schema at runtime as well. A key
 * with no class is denied.
 *
 * Classes:
 * - `settable`   harmless preference or tuning; any valid value. Nothing here can
 *                change redaction, execute a command, or point traffic anywhere.
 * - `false-only` a boolean whose `true` widens what the machine does, loads or
 *                exposes. A team may force it OFF, never ON.
 * - `true-only`  a protective boolean. A team may force it ON, never OFF.
 * - `lower-only` a number where lower is stricter (a window, a lifetime, a cap).
 *                The team value must be a number no greater than the value the
 *                member would otherwise have, so it is judged at load time
 *                against the member's own effective value.
 * - `narrow-roots` `security.origination_roots`: a non-empty allowlist of paths.
 *                Empty means "all roots" (the loosest), so a team may neither
 *                send `[]` nor widen: every team root must sit inside one of the
 *                member's roots, and when the member has none any non-empty list
 *                is a narrowing.
 * - `denied`     anything that executes a command, sets a URL, endpoint,
 *                credential or path, selects a gateway, persona or prompt, loads
 *                a plugin, an LSP server, a vector DB or a Headroom config, or
 *                has no declared "stricter" direction (a port, say). Fail closed.
 *
 * The REFUSED warning names the key and the rule. A refusal is per KEY (the rest
 * of the team layer still applies); only an INVALID value skips the whole layer
 * (ADR-0008).
 */

import path from "node:path";
import type { SETTINGS_LEAVES, SectionName } from "./schema.js";

export type TeamRule =
  | "settable"
  | "false-only"
  | "true-only"
  | "lower-only"
  | "narrow-roots"
  | "denied";

type LeafKeys<S extends SectionName> = keyof (typeof SETTINGS_LEAVES)[S] & string;

/** Every `section.key` in the schema, as a type. */
export type LeafPath = {
  [S in SectionName]: `${S}.${LeafKeys<S>}`;
}[SectionName];

const S: TeamRule = "settable";
const F: TeamRule = "false-only";
const T: TeamRule = "true-only";
const L: TeamRule = "lower-only";
const D: TeamRule = "denied";

export const TEAM_POLICY: Readonly<Record<LeafPath, TeamRule>> = {
  // proxy — where traffic goes and as whom is all denied; only timeouts are tuning.
  "proxy.bypass_all": D, // ADR-0008 floor: no remote may touch it, in either direction
  "proxy.port": D,
  "proxy.upstream_base_url": D,
  "proxy.upstream_provider": D,
  "proxy.upstream_auth_scheme": D,
  "proxy.upstream_model": D,
  "proxy.upstream_reasoning_effort": D,
  "proxy.map_reasoning_to_thinking": D,
  "proxy.gateways": D, // credentials and URLs
  "proxy.targets": D,
  "proxy.request_timeout_ms": S,
  "proxy.connect_timeout_ms": S,
  "proxy.max_request_body_bytes": L,
  "proxy.idle_timeout_ms": S,
  "proxy.model": D,

  // inference — endpoints, prompts and personas are all code-or-credential adjacent.
  "inference.ollama_base_url": D,
  "inference.request_timeout_ms": S,
  "inference.worker_targets": D,
  "inference.personas": D, // prompts, tools, prompt_file reads a local file
  "inference.model": D,
  "inference.coder_prompt": D,
  "inference.local_editor_enabled": F,
  "inference.providers": D,

  // compression — tuning that cannot change redaction (CLAUDE.md: no dial can).
  "compression.headroom_sidecar": F, // spawns a sidecar process
  "compression.force_semantic_on_caching": S,
  "compression.level": S,
  "compression.headroom_config": D,
  "brevity.level": S,

  // knowledge
  "knowledge.enabled": S,
  "knowledge.vector_db_url": D,
  "knowledge.watch_paths": D,
  "knowledge.auto_index_max_files": L,
  "knowledge.wiki_dir": D,
  "knowledge.local_answer_enabled": S,
  "knowledge.local_answer_min_confidence": D, // higher is stricter; no raise-only class yet
  "knowledge.syntax_aware_chunking": S,
  "knowledge.repo_map_enabled": S,
  "knowledge.read_skeleton_enabled": S,
  "knowledge.lsp_enabled": F, // true launches language-server commands
  "knowledge.lsp_servers": D, // arbitrary command execution
  "knowledge.lsp_timeout_ms": S,
  "knowledge.user_wiki_enabled": F,
  "knowledge.rerank_enabled": S,
  "knowledge.memory_federation_enabled": F,
  "knowledge.webcache_revalidate": F,
  "knowledge.webcache_fetch_raw": F,

  // security — the gate itself. Only stricter directions.
  "security.write_port": D,
  "security.write_lan": F,
  "security.unlock_window_minutes": L,
  "security.idle_relock_minutes": L,
  "security.step_up_max_age_minutes": L,
  "security.device_cert_days": L,
  "security.join_injection": F,
  "security.origination_roots": "narrow-roots",

  // telemetry
  "telemetry.enabled": F,
  "telemetry.dashboard_port": D,
  "telemetry.dashboard_lan": F,

  // ui
  "ui.pet": S,
  "ui.pet_color": S,
  "ui.color": S,
  "ui.advanced": S,

  // models
  "models.catalog_url": D,
  "models.catalog_max_age_days": S,
  "models.context_warn_fraction": S,

  // snooze — protective switches may be forced ON.
  "snooze.enforce": T,
  "snooze.spawn_gate": T,
  "snooze.spawn_cost_fraction": D,

  "claude.settings_scope": D, // chooses which Claude settings file Golem writes

  // plugins — code that runs inside the redacting process.
  "plugins.enabled": F,
  "plugins.load": D,

  // portal / team — identity and binding: circular if a layer could set them.
  "portal.url": D,
  "portal.issuer": D,
  "portal.client_id": D,
  "portal.link_timeout_ms": S,
  "team.org_id": D,
  "team.portal_url": D,
  "team.sync": D,
  "team.skills": D,
};

/** A key with no entry is denied: the table is the whole allow-list. */
export function teamRule(dotted: string): TeamRule {
  return Object.hasOwn(TEAM_POLICY, dotted) ? TEAM_POLICY[dotted as LeafPath] : "denied";
}

const keysWith = (...rules: TeamRule[]): ReadonlySet<string> =>
  new Set((Object.keys(TEAM_POLICY) as LeafPath[]).filter((k) => rules.includes(TEAM_POLICY[k])));

/** Keys a remote origin may never set. Derived: the `denied` class. */
export const REMOTE_DENIED_SETTINGS: ReadonlySet<string> = keysWith("denied");

/** Booleans a remote origin may only set to `false`. Derived: the `false-only` class. */
export const REMOTE_FALSE_ONLY_SETTINGS: ReadonlySet<string> = keysWith("false-only");

/**
 * The part of the rule that needs only the key and the team's value, so the
 * team-sync report can use it too. `undefined` means "not refused here"; the
 * relative classes (`lower-only`, `narrow-roots`) are finished at load time by
 * {@link relativeRefusal}, against the member's own value.
 */
export function staticRefusal(dotted: string, value: unknown): string | undefined {
  switch (teamRule(dotted)) {
    case "settable":
      return undefined;
    case "denied":
      return "a remote origin may never set it, at any importance";
    case "false-only":
      return value === false
        ? undefined
        : "a team may only force it to false (tighten), never enable it";
    case "true-only":
      return value === true
        ? undefined
        : "a team may only force it to true (tighten), never disable it";
    case "lower-only":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : "it must be a number, and a team may only lower it";
    case "narrow-roots":
      return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")
        ? undefined
        : "a team may only narrow the roots: an empty or malformed list is the loosest setting";
  }
}

function within(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * The relative half: judged against `current`, the member's value at the moment
 * the team layer applies (defaults, user, project, local and env for the
 * important band; the weaker origins for the normal band).
 */
export function relativeRefusal(
  dotted: string,
  value: unknown,
  current: unknown,
): string | undefined {
  switch (teamRule(dotted)) {
    case "lower-only":
      return typeof value === "number" && typeof current === "number" && value > current
        ? `a team may only lower it (yours is ${current}, the team sent ${value})`
        : undefined;
    case "narrow-roots": {
      if (!Array.isArray(value) || !Array.isArray(current) || current.length === 0)
        return undefined;
      const outside = (value as string[]).find(
        (root) => !current.some((own) => within(root, String(own))),
      );
      return outside === undefined
        ? undefined
        : `a team may only narrow the roots; "${outside}" is outside yours`;
    }
    default:
      return undefined;
  }
}

/** One refusal, whichever half raised it. */
export function teamRefusal(dotted: string, value: unknown, current: unknown): string | undefined {
  return staticRefusal(dotted, value) ?? relativeRefusal(dotted, value, current);
}
