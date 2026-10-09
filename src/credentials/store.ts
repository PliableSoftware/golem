/**
 * The credential resolution chain (ADR-0003 amendment; spec Decisions 46, 47).
 *
 * Resolution order, first hit wins:
 *
 *   1. `keychain` — the platform's OS-backed store.
 *   2. `file`     — plaintext, only if such a file already exists.
 *
 * **No env backend (Decision 47).** `GOLEM_UPSTREAM_API_KEY[__<ID>]` used to sit
 * at the head of this chain; it was removed as a credential *source* because an
 * exported-in-one-terminal key is precisely the failure Decision 46 set out to
 * end, and having it outrank the store meant a stale export could silently
 * shadow a correctly-stored key. Setting a credential now means
 * `golem gateway login <id>`; the var name lives on only as the internal
 * CLI→daemon handoff (see {@link ../credentials/backends.js envVarForGateway}).
 *
 * **Read vs write asymmetry, on purpose.** Resolution *reads* the plaintext
 * `file` backend (otherwise a user who opted into it could not use it), but
 * {@link CredentialStore.store} never *writes* it unless the caller asks for it
 * explicitly. ADR-0003 rejected plaintext-on-disk as a default and that still
 * holds; this keeps the rejection while leaving a documented escape hatch for
 * headless machines with no Secret Service.
 *
 * **Who calls this.** The CLI — never the daemon. The proxy daemon is detached
 * and may have no desktop session, which is exactly where every OS keychain is
 * least reliable (macOS ACL prompts, Linux D-Bus absence). So the CLI resolves
 * the credential and injects it into the daemon's environment at spawn; the
 * daemon keeps reading `process.env` as it always has. That also removes the
 * shell-inheritance trap where restarting the proxy from a terminal that lacked
 * the key silently un-configured a working daemon.
 *
 * The MCP server does resolve credentials through this module
 * (`credentialEnvForProxy`), but ADR-0003 invariant 4 is unchanged: a key never
 * enters model context or tool output.
 */

import { defaultUserDir } from "../config/paths.js";
import {
  type CredentialBackend,
  type CredentialBackendId,
  type CredentialLocation,
  fileBackend,
  keychainBackend,
} from "./backends.js";
import { hasEdgeWhitespace, hasForbiddenChar, hasNonLatin1 } from "./validate.js";

/** A credential plus where it came from. `secret` must never be logged. */
export interface ResolvedCredential {
  readonly secret: string;
  readonly location: CredentialLocation;
}

/** A backend that failed while being consulted (a real fault, not "absent"). */
export interface CredentialFault {
  readonly backend: CredentialBackendId;
  readonly message: string;
  /**
   * True when a value WAS stored but is unusable (control character, BOM, and for
   * gateway keys non-Latin-1 or edge whitespace). Distinct from "absent": a caller
   * that creates on absence must refuse here, or it overwrites the stored value.
   */
  readonly malformed?: true;
}

/** What an account holds; decides how strict the read-side check is and the remedy text. */
export type CredentialKind = "gateway" | "portal" | "buzz";

/**
 * Account kinds are told apart by name (the store has no kind field): the portal
 * token is the literal `portal-oauth` and Buzz identities are `buzz:<project>:<persona>`
 * (a test pins both against their owners, `PORTAL_ACCOUNT` and `buzzAccount`).
 * Everything else is a gateway API key.
 */
export function credentialKind(account: string): CredentialKind {
  if (account === "portal-oauth") return "portal";
  if (account.startsWith("buzz:")) return "buzz";
  return "gateway";
}

/** Thrown by `resolve` when a value is stored but malformed. Never carries the value. */
export class MalformedCredentialError extends Error {
  constructor(
    readonly account: string,
    message: string,
  ) {
    super(message);
    this.name = "MalformedCredentialError";
  }
}

/**
 * Non-secret answer to "is this account's credential set, and where?" — the
 * shape `golem gateway list` and `golem status` render. Carries no secret value,
 * only its location and any backend faults.
 */
export interface CredentialStatus {
  readonly account: string;
  readonly present: boolean;
  /** Where the credential was found; absent when `present` is false. */
  readonly location?: CredentialLocation;
  /** Backends that errored while being consulted (surfaced, never swallowed). */
  readonly faults: readonly CredentialFault[];
}

/** Which backend a write should target. `auto` = the platform's keychain. */
export type StoreTarget = "auto" | "keychain" | "file";

export interface CredentialStore {
  /**
   * Resolve the account's secret, or null when no backend has one. Throws
   * {@link MalformedCredentialError} when one IS stored but unusable, so "absent"
   * never reads as "safe to create" over a value that is only malformed.
   */
  resolve(account: string): Promise<ResolvedCredential | null>;
  /**
   * R9.20 — resolve SEVERAL accounts, using a backend's batched read where it has
   * one. Same chain, same precedence, same silent-absence semantics as
   * {@link resolve}; the only difference is how many processes it costs.
   *
   * Exists because `credentialEnvForProxy` needs N credentials and, on Windows,
   * each one was a PowerShell process start — 6668ms of the proxy daemon's
   * pre-`listen()` time, 98% of the total. Every returned entry is `resolve`'s
   * answer for that account, so a caller cannot tell the two apart except by
   * timing.
   */
  resolveMany(accounts: readonly string[]): Promise<Map<string, ResolvedCredential | null>>;
  /** {@link resolveMany} with each account's faults (malformed ones included), never throwing for them. */
  resolveManyDetailed(
    accounts: readonly string[],
  ): Promise<Map<string, { hit: ResolvedCredential | null; faults: readonly CredentialFault[] }>>;
  /** Non-secret presence/location report for display surfaces. */
  status(account: string): Promise<CredentialStatus>;
  /** Persist a secret. Returns where it landed. Throws if the target is unusable. */
  store(account: string, secret: string, target?: StoreTarget): Promise<CredentialLocation>;
  /** Delete the account's credential from every writable backend. */
  forget(account: string): Promise<readonly CredentialLocation[]>;
  /** The backends consulted on this machine, in resolution order (for help text). */
  chain(): readonly CredentialLocation[];
}

export interface CredentialStoreOptions {
  readonly userDir?: string;
  readonly platform?: NodeJS.Platform;
  /**
   * Substitute the OS-backed backend. `null` means "this platform has none",
   * which is how the no-keychain chain is exercised.
   *
   * The module doc has always said "every dependency is injectable so the chain is
   * unit-testable without touching the real keychain"; until R9.20 that was true
   * of `userDir` and `platform` but not of the backend itself, so a test could
   * only select a real implementation by platform name. Batched reads are backend
   * behaviour, so testing them needed the seam the doc already promised.
   */
  readonly keychain?: CredentialBackend | null;
}

/**
 * Build the credential store for this machine. Every dependency is injectable
 * so the chain is unit-testable without touching the real keychain.
 */
export function createCredentialStore(options: CredentialStoreOptions = {}): CredentialStore {
  const userDir = options.userDir ?? defaultUserDir();
  const platform = options.platform ?? process.platform;

  const keychainB =
    options.keychain !== undefined ? options.keychain : keychainBackend(platform, userDir);
  const fileB = fileBackend(userDir, platform);

  /** Read order. `file` is last and read-only-by-default (see module doc). */
  const readChain: readonly CredentialBackend[] = [
    ...(keychainB === null ? [] : [keychainB]),
    fileB,
  ];

  /** Never name the value: only the account and the remedy. */
  /** What to do about a malformed value, per account kind. Never names the value. */
  function malformedMessage(account: string): string {
    const what = "stored key is malformed (control character, byte-order mark";
    switch (credentialKind(account)) {
      case "portal":
        return `${what}): the portal token cannot be used. Re-link with \`golem team link\`.`;
      case "buzz":
        return (
          `${what}): this Buzz identity secret cannot be used, and Golem will NOT overwrite it ` +
          `(that would rotate the identity). Remove the stored credential "${account}" yourself, ` +
          "then re-provision, only if you mean to rotate it."
        );
      default:
        return (
          `${what}, non-Latin-1 character or surrounding whitespace): re-enter it with ` +
          `\`golem gateway login ${account}\`.`
        );
    }
  }

  /** Control chars and BOM are never valid; gateway keys are stricter (see validate.ts). */
  function isMalformed(account: string, secret: string): boolean {
    if (hasForbiddenChar(secret)) return true;
    return (
      credentialKind(account) === "gateway" && (hasNonLatin1(secret) || hasEdgeWhitespace(secret))
    );
  }

  const malformedFault = (account: string, backend: CredentialBackendId): CredentialFault => ({
    backend,
    message: malformedMessage(account),
    malformed: true,
  });

  /**
   * Consult backends in order. A backend that FAILS is recorded and skipped
   * rather than aborting the chain — a broken keychain must not hide an opted-in
   * plaintext file. Faults are returned so callers can surface them (never
   * swallowed).
   */
  async function consult(
    account: string,
  ): Promise<{ hit: ResolvedCredential | null; faults: CredentialFault[] }> {
    const faults: CredentialFault[] = [];
    for (const backend of readChain) {
      try {
        const secret = await backend.get(account);
        if (secret !== null) {
          // A malformed hit STOPS the chain: falling through would hand out a stale
          // value from a lower-precedence backend instead of surfacing the problem.
          if (isMalformed(account, secret)) {
            faults.push(malformedFault(account, backend.id));
            return { hit: null, faults };
          }
          return { hit: { secret, location: backend.describe() }, faults };
        }
      } catch (err) {
        faults.push({
          backend: backend.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { hit: null, faults };
  }

  /** The backend a write targets, or a thrown explanation of why none works. */
  async function writeBackend(target: StoreTarget): Promise<CredentialBackend> {
    if (target === "file") return fileB;
    if (keychainB === null) {
      throw new Error(
        `no OS credential store is available on ${platform}. Opt into plaintext ` +
          "storage with --store file (understanding it is NOT encrypted).",
      );
    }
    if (!(await keychainB.available())) {
      const hint =
        platform === "linux"
          ? "install libsecret-tools (secret-tool) and ensure a Secret Service is running — " +
            "headless sessions often have neither"
          : "the platform credential tool could not be invoked";
      throw new Error(
        `the OS credential store is not usable here: ${hint}. Opt into plaintext ` +
          "storage with --store file (understanding it is NOT encrypted).",
      );
    }
    return keychainB;
  }

  /**
   * R9.20 — the batched half of {@link consult}, with identical precedence.
   *
   * The keychain backend is asked for everything at once when it can be (`getMany`
   * on Windows DPAPI); accounts it did not resolve then fall through the rest of
   * the chain one at a time, exactly as `consult` would have taken them. Falling
   * through per-account is cheap by construction: the remaining backend is a plain
   * file read.
   *
   * A batched FAULT is recorded and the account still falls through, mirroring
   * `consult`'s rule that a broken keychain must not hide an opted-in plaintext
   * file.
   */
  async function consultMany(
    accounts: readonly string[],
  ): Promise<Map<string, { hit: ResolvedCredential | null; faults: CredentialFault[] }>> {
    const out = new Map<string, { hit: ResolvedCredential | null; faults: CredentialFault[] }>();
    const unique = [...new Set(accounts)];
    const carriedFaults = new Map<string, CredentialFault[]>();
    let remaining = unique;

    if (keychainB !== null && keychainB.getMany !== undefined) {
      let batch: Map<string, import("./backends.js").BatchedRead>;
      try {
        batch = await keychainB.getMany(unique);
      } catch (err) {
        // A batch that fails wholesale is one fault against every account, and
        // then the chain continues — never an abort.
        batch = new Map();
        const fault = {
          backend: keychainB.id,
          message: err instanceof Error ? err.message : String(err),
        };
        for (const account of unique) carriedFaults.set(account, [fault]);
      }
      const stillUnresolved: string[] = [];
      for (const account of unique) {
        const entry = batch.get(account);
        if (entry?.secret !== undefined && isMalformed(account, entry.secret)) {
          // Same rule as `consult`: no fall-through to a lower backend.
          out.set(account, {
            hit: null,
            faults: [...(carriedFaults.get(account) ?? []), malformedFault(account, keychainB.id)],
          });
          continue;
        }
        if (entry?.secret !== undefined) {
          out.set(account, {
            hit: { secret: entry.secret, location: keychainB.describe() },
            faults: [],
          });
          continue;
        }
        if (entry?.fault !== undefined) {
          carriedFaults.set(account, [
            ...(carriedFaults.get(account) ?? []),
            { backend: keychainB.id, message: entry.fault.message },
          ]);
        }
        stillUnresolved.push(account);
      }
      remaining = stillUnresolved;
    }

    for (const account of remaining) {
      // The keychain has already answered (or faulted) for these, so consulting
      // the whole chain again would re-pay its cost. Ask only what is left.
      const skipKeychain = keychainB !== null && keychainB.getMany !== undefined;
      const chain = skipKeychain ? readChain.filter((b) => b !== keychainB) : readChain;
      const faults: CredentialFault[] = [...(carriedFaults.get(account) ?? [])];
      let hit: ResolvedCredential | null = null;
      for (const backend of chain) {
        try {
          const secret = await backend.get(account);
          if (secret !== null) {
            if (isMalformed(account, secret)) {
              faults.push(malformedFault(account, backend.id));
            } else {
              hit = { secret, location: backend.describe() };
            }
            break;
          }
        } catch (err) {
          faults.push({
            backend: backend.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      out.set(account, { hit, faults });
    }
    return out;
  }

  return {
    resolve: async (account) => {
      const { hit, faults } = await consult(account);
      const bad = faults.find((f) => f.malformed === true);
      if (hit === null && bad !== undefined)
        throw new MalformedCredentialError(account, bad.message);
      return hit;
    },

    resolveManyDetailed: (accounts) => consultMany(accounts),

    resolveMany: async (accounts) => {
      const consulted = await consultMany(accounts);
      const out = new Map<string, ResolvedCredential | null>();
      for (const [account, { hit }] of consulted) out.set(account, hit);
      return out;
    },

    status: async (account) => {
      const { hit, faults } = await consult(account);
      return {
        account,
        present: hit !== null,
        ...(hit !== null ? { location: hit.location } : {}),
        faults,
      };
    },

    store: async (account, secret, target = "auto") => {
      if (secret === "") throw new Error("refusing to store an empty credential");
      const backend = await writeBackend(target);
      await backend.set(account, secret);
      return backend.describe();
    },

    forget: async (account) => {
      const removed: CredentialLocation[] = [];
      const faults: string[] = [];
      // Every backend is writable now, so a forget really is complete.
      for (const backend of [...(keychainB === null ? [] : [keychainB]), fileB]) {
        let had: string | null;
        try {
          // Nothing can be stored in a backend that is not usable here (no
          // libsecret on a headless box), so it is empty, not faulted — the read
          // and store paths make the same call.
          if (!(await backend.available())) continue;
          had = await backend.get(account);
        } catch (err) {
          // A backend we could not read is NOT an empty one: reporting "no stored
          // credential" would leave a live key behind with the user told otherwise.
          // Keep going so the other backends are still cleaned, then say so.
          faults.push(`${backend.id}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        if (had === null) continue;
        await backend.remove(account);
        removed.push(backend.describe());
      }
      if (faults.length > 0) {
        const done =
          removed.length > 0 ? ` Removed from: ${removed.map((l) => l.label).join(", ")}.` : "";
        throw new Error(
          `could not check every credential backend for "${account}" (${faults.join("; ")}) — ` +
            `a stored credential may remain.${done}`,
        );
      }
      return removed;
    },

    chain: () => readChain.map((b) => b.describe()),
  };
}
