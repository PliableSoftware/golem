/**
 * R14.2 — persona roster → Buzz identity manifest + launch specs.
 *
 * The manifest (`.golem/buzz/agents.json`) is the committed, reviewable roster
 * of pubkeys: one record per staffed persona plus Golem's own orchestrator.
 * It is **lane-free by construction** — a persona's model and lane live in
 * `inference.personas` and change live (coder moved lanes on 2026-09-19);
 * recording either here would turn every routing tweak into a PR review of
 * something the Buzz human must not notice. Only what is stable across such a
 * change lands here: id, pubkey, relay, respond-to mode, channel, launch spec.
 *
 * ## Mirroring `resolveDesiredAgents()` — its staffing logic, NOT its filter
 *
 * `src/cli/persona-sync.ts` derives the `.claude/agents/` roster from
 * `effectivePersonas()` and then skips `lane.kind !== "agent"` (line 92). That
 * filter is correct THERE (a worker-lane persona has no harness subagent) and
 * would be a bug HERE: copying it would silently drop every worker-lane
 * persona from Buzz and break the lane-transparency requirement. The
 * inclusion test here is `dispatchable` (staffed AND `owner: agent`) — the
 * permission axis only, never the lane axis. The two functions look similar;
 * that is exactly how the filter gets copied across by accident.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadConfig } from "../config/index.js";
import { createCredentialStore } from "../credentials/index.js";
import { effectivePersonas, type PersonaConfig } from "../inference/personas.js";
import {
  addMemberCommand,
  buzzAccount,
  type MintStore,
  mintIdentity,
  ORCHESTRATOR_ID,
  projectKey,
} from "./identity.js";

/** `.golem/buzz/agents.json` for a project. */
export function buzzManifestPath(projectDir: string): string {
  return path.join(projectDir, ".golem", "buzz", "agents.json");
}

/** The most restrictive respond-to mode, which is also `buzz-acp`'s own default. */
export const DEFAULT_RESPOND_TO = "owner-only";

export const KEYPAIR_RE = /^[0-9a-f]{64}$/u;

/**
 * The env a persona's `buzz-acp` process needs. Deliberately identical for a
 * worker-lane and an agent-lane persona: `golem acp` resolves the lane itself,
 * at turn time (R14.3). Nothing lane-shaped reaches Buzz.
 *
 * `BUZZ_PRIVATE_KEY` is a placeholder — the real secret is injected from the
 * credential store at spawn time (R14.4's `golem buzz up`), never written to
 * this committed file.
 */
export const launchSpecSchema = z
  .object({
    BUZZ_RELAY_URL: z.string(),
    BUZZ_PRIVATE_KEY: z.string(),
    BUZZ_ACP_AGENT_COMMAND: z.string(),
    // Comma-joined: `buzz-acp` splits BUZZ_ACP_AGENT_ARGS on commas
    // (verification-notes §19), so this string is `acp,--persona,<id>`.
    BUZZ_ACP_AGENT_ARGS: z.string(),
    BUZZ_ACP_RESPOND_TO: z.string(),
  })
  .strict();
export type LaunchSpec = z.infer<typeof launchSpecSchema>;

/** The launch spec for one persona id. */
export function launchSpec(personaId: string): LaunchSpec {
  return {
    BUZZ_RELAY_URL: "",
    BUZZ_PRIVATE_KEY: "",
    BUZZ_ACP_AGENT_COMMAND: "golem",
    BUZZ_ACP_AGENT_ARGS: `acp,--persona,${personaId}`,
    BUZZ_ACP_RESPOND_TO: DEFAULT_RESPOND_TO,
  };
}

export const manifestRecordSchema = z
  .object({
    persona: z.string().min(1),
    pubkey: z.string().regex(KEYPAIR_RE),
    relayUrl: z.string().nullable(),
    respondTo: z.string().min(1),
    channel: z.string().nullable(),
    launch: launchSpecSchema,
  })
  .strict();
export type BuzzManifestRecord = z.infer<typeof manifestRecordSchema>;

export const manifestSchema = z
  .object({ version: z.literal(1), agents: z.array(manifestRecordSchema) })
  .strict();
export type BuzzManifest = z.infer<typeof manifestSchema>;

export interface ProvisionOptions {
  readonly projectDir: string;
  /** Operator-provided per-project values; carried forward from the existing manifest when omitted. */
  readonly relayUrl?: string | null;
  readonly channel?: string | null;
  readonly respondTo?: string;
  readonly store?: MintStore;
  /** Test seam for keypair minting (identity.ts's `runGenerateKey` default needs the real binaries). */
  readonly generateKeypair?: () => Promise<{ pubkeyHex: string; secretHex: string }>;
  readonly userDir?: string;
  /** Write the manifest to disk. True by default; false in tests and dry runs. */
  readonly write?: boolean;
}

export interface ProvisionResult {
  readonly manifest: BuzzManifest;
  readonly content: string;
  /** Records newly minted this run. */
  readonly minted: readonly string[];
  /** Records carried forward unchanged. */
  readonly existing: readonly string[];
  /** The `buzz-admin add-member` lines the user must run for newly minted pubkeys. */
  readonly registerCommands: readonly { persona: string; command: string }[];
  /** Manifest ids whose persona left the roster — records dropped, secrets forgotten. */
  readonly removed: readonly string[];
}

/**
 * The Buzz-addressable roster: every DISPATCHABLE persona (staffed,
 * `owner: agent` — never filtered by lane) plus the synthetic orchestrator id.
 */
export function buzzRosterIds(personas: Readonly<Record<string, PersonaConfig>>): string[] {
  const ids = effectivePersonas(personas)
    .filter((p) => p.dispatchable)
    .map((p) => p.id);
  return [...new Set([...ids, ORCHESTRATOR_ID])].sort((a, b) => a.localeCompare(b));
}

/** Parse a manifest from disk; null when absent or malformed. */
export async function readManifest(projectDir: string): Promise<BuzzManifest | null> {
  let raw: string;
  try {
    raw = await readFile(buzzManifestPath(projectDir), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Deterministic rendering — sorted by persona, keys in schema order, so identical inputs are identical bytes. */
export function renderManifest(manifest: BuzzManifest): string {
  const agents = [...manifest.agents]
    .sort((a, b) => a.persona.localeCompare(b.persona))
    .map((agent) => manifestRecordSchema.parse(agent));
  return `${JSON.stringify({ version: 1 as const, agents }, null, 2)}\n`;
}

function accountFor(projectDir: string, personaId: string): string {
  return buzzAccount(projectKey(projectDir), personaId);
}

/**
 * Provision the roster: mint what's missing, carry forward what's there, drop
 * who's gone. Deterministic given (roster, relay, channel, respond-to,
 * existing manifest) — which is what makes the lane-flip gate testable:
 * flipping a persona between lanes changes none of those inputs, so the
 * manifest's bytes cannot move.
 */
export async function provisionBuzz(opts: ProvisionOptions): Promise<ProvisionResult> {
  const { settings } = await loadConfig({
    projectDir: opts.projectDir,
    ...(opts.userDir !== undefined ? { userDir: opts.userDir } : {}),
  });
  const roster = buzzRosterIds(settings.inference.personas ?? {});

  const previous = await readManifest(opts.projectDir);
  const previousByPersona = new Map((previous?.agents ?? []).map((a) => [a.persona, a]));

  // Per-project relay/channel/respond-to: explicit flag wins, else the
  // existing manifest's value (operator choices, not roster choices), else the
  // default. `""` and absent are the same "not supplied" for a flag.
  const relayUrl =
    opts.relayUrl ?? previous?.agents.find((a) => a.relayUrl !== null)?.relayUrl ?? null;
  const channel = opts.channel ?? previous?.agents.find((a) => a.channel !== null)?.channel ?? null;
  const respondTo = opts.respondTo ?? previous?.agents[0]?.respondTo ?? DEFAULT_RESPOND_TO;

  const minted: string[] = [];
  const existing: string[] = [];
  const records: BuzzManifestRecord[] = [];
  const blocked: string[] = [];

  const store = opts.store ?? createCredentialStore({});

  for (const personaId of roster) {
    const prior = previousByPersona.get(personaId);
    const result = await mintIdentity(
      personaId,
      {
        projectDir: opts.projectDir,
        store,
        ...(opts.userDir !== undefined ? { userDir: opts.userDir } : {}),
        ...(opts.generateKeypair !== undefined ? { generateKeypair: opts.generateKeypair } : {}),
      },
      prior?.pubkey ?? null,
    );

    if (result.pubkeyHex === null) {
      // An orphaned secret whose manifest record was lost. identity.ts cannot
      // recover a pubkey from a secret, so this persona is BLOCKED until an
      // operator rotates deliberately — never silently re-minted, which would
      // move a live @mention handle mid-flight. Collected, not thrown
      // mid-loop: a throw here would abort after half the roster had been
      // minted, and the caller must see every blocked id at once.
      blocked.push(personaId);
      continue;
    }

    if (result.minted) minted.push(personaId);
    else existing.push(personaId);

    records.push({
      persona: personaId,
      pubkey: result.pubkeyHex,
      relayUrl,
      respondTo,
      channel,
      launch: {
        ...launchSpec(personaId),
        BUZZ_RELAY_URL: relayUrl ?? "",
        BUZZ_ACP_RESPOND_TO: respondTo,
      },
    });
  }

  if (blocked.length > 0) {
    throw new Error(
      `Buzz identities are orphaned for: ${blocked.join(", ")} — a secret is stored but no manifest ` +
        "record holds its pubkey, and a Nostr pubkey cannot be recovered from its secret. " +
        "Re-provision those personas with `golem buzz provision --rotate <id>` to mint a fresh " +
        "identity, then register the new pubkey with the relay.",
    );
  }

  const rosterSet = new Set(roster);
  const removed = [...previousByPersona.keys()].filter((id) => !rosterSet.has(id));
  for (const id of removed) {
    await store.forget(accountFor(opts.projectDir, id));
  }

  const content = renderManifest({ version: 1, agents: records });
  if (opts.write !== false) {
    await mkdir(path.dirname(buzzManifestPath(opts.projectDir)), { recursive: true });
    await writeFile(buzzManifestPath(opts.projectDir), content, "utf8");
  }

  const registerCommands = minted.map((persona) => ({
    persona,
    command: addMemberCommand(records.find((r) => r.persona === persona)?.pubkey ?? ""),
  }));

  return {
    manifest: { version: 1, agents: records },
    content,
    minted,
    existing,
    registerCommands,
    removed,
  };
}
