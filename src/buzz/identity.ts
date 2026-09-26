/**
 * R14.2 — mint and store one Nostr identity per Buzz-addressable agent.
 *
 * A "Buzz agent" is a `buzz-acp` process holding a Nostr keypair
 * (verification-notes §19): there is no agent record to POST anywhere, so
 * provisioning means (1) minting a keypair, (2) keeping its secret, (3) getting
 * its pubkey registered as a relay member — and (3) needs the relay's own
 * signing key, which makes it a credentialed operator act. Golem mints and
 * records; the human registers.
 *
 * ## Why the secret lives in the credential store and nowhere else
 *
 * `buzz-admin generate-key` prints the secret **once** — it cannot be
 * recovered. So {@link mintIdentity} captures it at the moment of creation
 * straight into Golem's credential store, keyed per project+persona. The
 * alternatives were rejected for the reasons the task doc gives: a plaintext
 * `.env` inside the repo is one `.gitignore` mistake from publication, and the
 * committed manifest holds pubkeys only.
 *
 * The store account embeds a hash of the resolved project path, because the
 * credential store is per-user (`~/.golem/credentials/`) while the task scopes
 * identities to a project. Two projects that share a directory basename still
 * get distinct accounts.
 *
 * ## The pubkey cannot be recovered from the secret
 *
 * A Nostr pubkey is a secp256-k1 point of the secret — deriving it needs
 * crypto Golem does not ship for this. The committed manifest is therefore the
 * ONLY durable record of pubkeys, which has one consequence provisioning must
 * handle honestly: a stored secret whose manifest entry has been lost cannot
 * have its pubkey restored. {@link mintIdentity} reports that as
 * `pubkeyHex: null` and provisioning surfaces it as a conflict;
 * {@link rotateIdentity} is the operator's escape — it re-mints (a NEW
 * identity) and overwrites the orphaned secret.
 *
 * ## The one binary rule
 *
 * Golem must not ship or build `buzz-admin`/`buzz-acp`/`buzz` (Rust crates of
 * `block/buzz`; §20 item 6: no prebuilt CLI binaries exist). {@link
 * findGenerateKeyRunner} detects the two documented paths to a keypair — the
 * binary on PATH, or `/usr/local/bin/buzz-admin` inside the relay's container
 * image via Docker — and says which is missing when neither is there.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { type CredentialStore, createCredentialStore } from "../credentials/index.js";

const execFileAsync = promisify(execFile);

/** The synthetic roster id for Golem's own orchestrator (R14.4), not an `inference.personas` key. */
export const ORCHESTRATOR_ID = "golem";

/** Buzz's Nostr keys are x-only 32-byte points rendered as 64 lowercase hex. */
const HEX64_RE = /\b[0-9a-f]{64}\b/gu;

/**
 * A stable, path-free key for one project's Buzz identities.
 *
 * Lower-cased through `node:path` normalisation on case-insensitive platforms
 * so the same checkout reached via two spellings on Windows still finds the
 * same credentials. This is a locator, not a secret — but it is deliberately
 * an opaque hash rather than the path itself, because the credential store's
 * file-backend keys land under `~/.golem/credentials/` and a project path can
 * contain a username.
 */
export function projectKey(
  projectDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = path.resolve(projectDir);
  const normalized =
    platform === "win32" || platform === "darwin" ? resolved.toLowerCase() : resolved;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/** The credential-store account holding one identity's `BUZZ_PRIVATE_KEY`. */
export function buzzAccount(project: string, personaId: string): string {
  return `buzz:${project}:${personaId}`;
}

export interface Keypair {
  /** 64-hex x-only public key — goes in the committed manifest. */
  readonly pubkeyHex: string;
  /** 64-hex secret — goes ONLY in the credential store, never the manifest. */
  readonly secretHex: string;
}

/**
 * Parse `buzz-admin generate-key`'s stdout.
 *
 * The output format is documented only as "prints a public/secret keypair as
 * hex" (§19) — no verbatim sample exists in the notes — so the parser is
 * tolerant in a bounded way: labelled `pub`/`sec` lines win when present;
 * otherwise the two 64-hex tokens in order are public-then-secret, which
 * matches the documented phrasing. Anything else raises rather than guessing:
 * storing the wrong hex as a secret would burn an identity silently.
 * Extending §19 with the verbatim sample when Stage 2 runs is the follow-up.
 */
export function parseGenerateKeyOutput(stdout: string): Keypair {
  const hexes: string[] = stdout.match(HEX64_RE) ?? [];
  if (hexes.length < 2) {
    throw new Error(
      `buzz-admin generate-key did not print two 64-hex keys (found ${hexes.length}) — ` +
        "refused to store a half-parsed identity.",
    );
  }
  const pubLine = /^.*pub.*$/im.exec(stdout);
  const secretLine = /^.*sec.*$/im.exec(stdout);
  if (pubLine !== null && secretLine !== null) {
    const pub = HEX64_RE.exec(pubLine[0]);
    const sec = HEX64_RE.exec(secretLine[0]);
    if (pub !== null && sec !== null) {
      return { pubkeyHex: pub[0], secretHex: sec[0] };
    }
  }
  return { pubkeyHex: hexes[0] as string, secretHex: hexes[1] as string };
}

/** A runner for `buzz-admin generate-key`: the PATH binary, or the same binary inside Docker. */
export interface GenerateKeyRunner {
  readonly kind: "binary" | "docker";
  readonly describe: string;
  readonly run: () => Promise<string>;
}

/**
 * Whether PATH (or PATHEXT on Windows) provides `name` as an executable.
 *
 * `access(X_OK)` is existence-plus-executability without spawning a
 * `where`/`which` and parsing its output (CLAUDE.md: no shell string
 * interpolation); on Windows every existing file answers X_OK, so there the
 * PATHEXT extension list carries the executability signal instead.
 */
async function pathHas(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  const pathValue = env.PATH ?? env.Path ?? "";
  const exts =
    platform === "win32" && env.PATHEXT !== undefined ? env.PATHEXT.split(path.delimiter) : [""];
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir === "") continue;
    for (const ext of exts) {
      try {
        await access(
          path.join(dir, name + ext),
          platform === "win32" ? constants.R_OK : constants.X_OK,
        );
        return true;
      } catch {
        // not here — try the next PATH entry
      }
    }
  }
  return false;
}

/**
 * Find a way to mint a keypair on this machine, or null when there is none.
 * Docker-with-the-relay-image is checked as an "equally valid path" per the
 * task doc — `buzz-admin` ships in `ghcr.io/block/buzz:main` even though no
 * standalone CLI binaries exist.
 */
export async function findGenerateKeyRunner(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<GenerateKeyRunner | null> {
  if (await pathHas(env, "buzz-admin", platform)) {
    return {
      kind: "binary",
      describe: "buzz-admin (on PATH)",
      run: async () => (await execFileAsync("buzz-admin", ["generate-key"])).stdout,
    };
  }
  if (await pathHas(env, "docker", platform)) {
    return {
      kind: "docker",
      describe: "buzz-admin via Docker (ghcr.io/block/buzz:main)",
      run: async () =>
        (
          await execFileAsync("docker", [
            "run",
            "--rm",
            "--entrypoint",
            "/usr/local/bin/buzz-admin",
            "ghcr.io/block/buzz:main",
            "generate-key",
          ])
        ).stdout,
    };
  }
  return null;
}

/** Mint a keypair through the detected runner and parse it. */
export async function runGenerateKey(): Promise<Keypair> {
  const runner = await findGenerateKeyRunner();
  if (runner === null) {
    throw new Error(
      "no way to mint a Nostr keypair on this machine: neither `buzz-admin` on PATH nor " +
        "`docker` was found. buzz-admin ships inside the relay image — " +
        "`docker run --rm --entrypoint /usr/local/bin/buzz-admin ghcr.io/block/buzz:main " +
        "generate-key` — or build it with a Rust toolchain (`cargo build --release -p " +
        "buzz-admin`). Golem does not ship or build these binaries.",
    );
  }
  return parseGenerateKeyOutput(await runner.run());
}

/** The subset of the store this module touches — injectable so tests never touch a keychain. */
export type MintStore = Pick<CredentialStore, "resolve" | "store" | "forget">;

export interface IdentityDeps {
  readonly projectDir: string;
  readonly store?: MintStore;
  readonly userDir?: string;
  /** Injected in tests; defaults to detecting and running `buzz-admin generate-key`. */
  readonly generateKeypair?: () => Promise<Keypair>;
}

export interface MintResult {
  /**
   * The identity's pubkey, or null when a secret is already stored but its
   * pubkey is unknown — an orphaned identity whose manifest entry was lost
   * (see the module doc). Provision reports that; it never silently re-mints.
   */
  readonly pubkeyHex: string | null;
  readonly account: string;
  /** False when the identity already existed — the existing secret is untouched. */
  readonly minted: boolean;
}

function storeFrom(deps: IdentityDeps): MintStore {
  return (
    deps.store ??
    createCredentialStore({ ...(deps.userDir !== undefined ? { userDir: deps.userDir } : {}) })
  );
}

/**
 * Ensure one persona has an identity, returning its pubkey where knowable.
 *
 * Idempotent by design: an existing credential is resolved-through, never
 * re-minted — re-minting on a re-run would rotate a live @mention handle out
 * from under the relay's membership record. Only {@link rotateIdentity}
 * re-mints, deliberately.
 */
export async function mintIdentity(
  personaId: string,
  deps: IdentityDeps,
  /** The manifest's record for this persona, when one exists — see MintResult. */
  manifestPubkey?: string | null,
): Promise<MintResult> {
  const project = projectKey(deps.projectDir);
  const account = buzzAccount(project, personaId);
  const store = storeFrom(deps);

  const existing = await store.resolve(account);
  if (existing !== null && existing.secret !== "") {
    // A stored secret with a manifest pubkey is a healthy identity: keep both.
    // A stored secret with NO manifest pubkey is the orphan case (null).
    return { pubkeyHex: manifestPubkey ?? null, account, minted: false };
  }

  const generate = deps.generateKeypair ?? runGenerateKey;
  const pair = await generate();
  await store.store(account, pair.secretHex);
  return { pubkeyHex: pair.pubkeyHex, account, minted: true };
}

/**
 * Force a NEW keypair for a persona, overwriting any stored secret. For the
 * orphan case and for a lost/compromised device; the operator must then
 * register the new pubkey with the relay and the roster's handle effectively
 * changes identity (the old membership event remains until it expires).
 */
export async function rotateIdentity(
  personaId: string,
  deps: IdentityDeps,
): Promise<MintResult & { readonly pubkeyHex: string }> {
  const project = projectKey(deps.projectDir);
  const account = buzzAccount(project, personaId);
  const store = storeFrom(deps);
  await store.forget(account); // best-effort clean slate; store() overwrites anyway
  const generate = deps.generateKeypair ?? runGenerateKey;
  const pair = await generate();
  await store.store(account, pair.secretHex);
  return { pubkeyHex: pair.pubkeyHex, account, minted: true };
}

/** The exact operator command to register a minted pubkey with the relay — printed, never run. */
export function addMemberCommand(pubkeyHex: string): string {
  return `BUZZ_RELAY_PRIVATE_KEY=<relay signing key> buzz-admin add-member --pubkey ${pubkeyHex}`;
}
