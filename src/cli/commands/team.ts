/**
 * `golem team` — sign this machine in to the hosted portal.
 *
 * `team-portal-auth` started this file with three subcommands (a stored token and a
 * working `GET /api/v1/me`). It now registers `link`, `status`, `sync`, `unlink`,
 * `logout` and `skills`, and also does the project team binding and the team
 * settings layer fetch.
 *
 * **Nothing printed by this file is a credential.** Every rendering path goes
 * through `describeTokenSet`, which returns issuer, scopes, expiry and a
 * boolean — the access and refresh tokens are never read into a string that
 * reaches stdout, stderr or `--json`. That is not a convention, it is the point
 * of ADR-0003: a credential in terminal scrollback is a credential in the next
 * bug report.
 */

import { stat } from "node:fs/promises";
import readline from "node:readline/promises";
import type { Command } from "commander";
import { findProjectDir, loadEffectiveConfig } from "../../config/index.js";
import { defaultUserDir } from "../../config/paths.js";
import { createCredentialStore } from "../../credentials/index.js";
import {
  applyLinkOverrides,
  assertLinkConfigTrusted,
  bindTeam,
  chooseOrganization,
  createPortalClient,
  describeCacheAge,
  discoverAuthorizationServer,
  isValidPortalProjectSlug,
  linkPortal,
  listTeamLayerCaches,
  PortalAuthError,
  type PortalIdentity,
  type PortalOrganization,
  type PortalProjectEntry,
  portalStatus,
  portalTokenStore,
  printingBrowser,
  readProjectTeamKeys,
  readTeamBinding,
  readTeamLayerCache,
  resolvePortalConfig,
  syncTeamLayer,
  systemBrowser,
  type TeamSettings,
  type TeamSkillsTransport,
  teamApiBaseUrl,
  teamCachePath,
  unbindTeam,
  unlinkPortal,
} from "../../portal/index.js";
import { forgetManaged } from "../managed-files.js";
import { syncTeamSkills } from "../team-skills.js";

const _DEFAULT_DIR = findProjectDir(process.cwd()) ?? process.cwd();

/**
 * Exit 2 for "you have not configured this yet", 1 for everything else.
 *
 * The split matters for scripting: `not_configured` and `not_linked` are states
 * a caller can fix without a human, and are the two a wrapper wants to branch on
 * rather than treat as a crash.
 */
function _fail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`golem: ${message}\n`);
  const recoverable =
    err instanceof PortalAuthError && (err.kind === "not_configured" || err.kind === "not_linked");
  process.exit(recoverable ? 2 : 1);
}

async function portalContext(
  dir: string,
  flags: { readonly portalUrl?: string; readonly issuer?: string } = {},
) {
  const loaded = await loadEffectiveConfig({ projectDir: dir });
  const { settings } = loaded;
  const applied = applyLinkOverrides(settings.portal, loaded.provenance, flags);
  const provenance = applied.provenance;
  const config = resolvePortalConfig(applied.settings);
  const tokens = portalTokenStore(createCredentialStore());
  return { config, tokens, settings, provenance };
}

/** `golem team link`'s flags. Named so the action stays one line. */
interface LinkOptions {
  readonly dir: string;
  readonly browser: boolean;
  /** `--no-bind`: sign in without touching the project's settings. */
  readonly bind: boolean;
  readonly org?: string;
  /** `--project <slug>`: the portal project this repo names (`default` clears it). */
  readonly project?: string;
  readonly timeout?: string;
  readonly portalUrl?: string;
  readonly issuer?: string;
  readonly json: boolean;
}

/**
 * What `golem team link` did about the PROJECT, as distinct from what it did
 * about the machine.
 *
 * Two separate outcomes on purpose: signing in can succeed while binding does
 * not (several teams and no `--org`), and reporting one as the other is how a
 * user ends up believing a repo is linked when only their keychain is.
 */
export type PortalProjectOutcome =
  /** A portal project other than the default was picked and written. */
  | { readonly kind: "chosen"; readonly slug: string; readonly name: string }
  /** The default portal project was picked; `team.project` is absent. */
  | { readonly kind: "default" }
  /** Nothing was chosen; the same team's existing `team.project` stays. */
  | { readonly kind: "kept"; readonly slug: string }
  /** A prompt was offered and declined. `team.project` is as it was. */
  | { readonly kind: "skipped" }
  /** `--json` or no TTY: no prompt was offered and no `--project` given. */
  | { readonly kind: "skipped_non_interactive" }
  /** `--project` named a slug the team's list does not contain. */
  | {
      readonly kind: "unknown_project";
      readonly requested: string;
      readonly available: readonly string[];
      /** The same team's `team.project` that stayed in the file, when there is one. */
      readonly keptSlug?: string;
    }
  /** The list could not be had (old portal, 402/403, 5xx, offline). */
  | {
      readonly kind: "projects_unavailable";
      readonly reason: string;
      readonly requested?: string;
      readonly keptSlug?: string;
    };

export type BindOutcome =
  | {
      readonly kind: "bound";
      readonly orgId: string;
      readonly name: string;
      readonly settingsFile: string;
      readonly entitled: boolean;
      /** The team this repo named before, when this run changed it; else null. */
      readonly movedFrom: string | null;
      /** The old `team.project` removed because the team changed; else null. */
      readonly droppedPortalProject: string | null;
      readonly portalProject: PortalProjectOutcome;
    }
  | { readonly kind: "skipped" }
  | { readonly kind: "no_organizations" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly PortalOrganization[] }
  | { readonly kind: "unknown"; readonly requested: string };

/**
 * Flags that cannot be honoured, said before anything signs in. Exit 2: a
 * decision the caller still owes, the same code as an unbound team.
 */
export function linkFlagError(opts: {
  readonly project?: string | undefined;
  readonly bind: boolean;
}): string | null {
  if (opts.project === undefined) return null;
  if (opts.project.trim() === "") {
    return '--project needs a portal project slug (or "default"); it was blank';
  }
  if (!opts.bind) {
    return (
      "--project records a portal project in this repo's settings, so it cannot be " +
      "combined with --no-bind"
    );
  }
  return null;
}

/**
 * The exit code for a link's bind result. 2 means a decision is still owed: no
 * team was recorded, or a `--project` was asked for and not recorded.
 */
export function bindExitCode(bind: BindOutcome): number {
  if (bind.kind === "ambiguous" || bind.kind === "unknown") return 2;
  if (bind.kind !== "bound") return 0;
  const outcome = bind.portalProject;
  if (outcome.kind === "unknown_project") return 2;
  if (outcome.kind === "projects_unavailable" && outcome.requested !== undefined) return 2;
  return 0;
}

/** What `golem team link --json` prints. The credential is never in it. */
export function linkJsonPayload(input: {
  readonly stored: unknown;
  readonly token: unknown;
  readonly identity: PortalIdentity;
  readonly bind: BindOutcome;
}) {
  return {
    linked: true,
    storedIn: input.stored,
    token: input.token,
    user: input.identity.user,
    organizations: input.identity.organizations,
    team: input.bind,
  };
}

/** One honest line per portal project outcome; never silent about an unrecorded choice. */
export function describePortalProjectOutcome(outcome: PortalProjectOutcome): string {
  switch (outcome.kind) {
    case "chosen":
      return `Portal project: ${outcome.name} (${outcome.slug}), recorded as team.project.`;
    case "default":
      return "Portal project: the team's default (team.project is not set).";
    case "kept":
      return `Portal project: unchanged, team.project stays ${outcome.slug}.`;
    case "skipped":
      return (
        "Portal project not chosen: the team's default applies unless team.project is set. " +
        "Re-run with `--project <slug>` to choose one."
      );
    case "skipped_non_interactive":
      return (
        "Portal project not chosen (no terminal to ask in): the team's default applies. " +
        "Re-run with `--project <slug>` to choose one."
      );
    case "unknown_project":
      return (
        `Portal project not chosen: the team has no portal project ${JSON.stringify(outcome.requested)}. ` +
        `Valid: ${outcome.available.join(", ")}.` +
        (outcome.keptSlug === undefined
          ? ""
          : ` team.project stays ${outcome.keptSlug}, so that portal project still applies.`)
      );
    case "projects_unavailable":
      return (
        `Portal project not chosen: could not get the team's portal project list ` +
        `(${outcome.reason}). The team is linked; ` +
        (outcome.keptSlug === undefined
          ? "the team's default portal project applies. "
          : `team.project stays ${outcome.keptSlug}, so that portal project still applies. `) +
        (outcome.requested === undefined
          ? "Re-run `golem team link` later, or set team.project by hand."
          : `\`--project ${outcome.requested}\` was NOT recorded.`)
      );
  }
}

function describeOrg(org: PortalOrganization): string {
  const slug = org.slug === undefined ? "" : ` (${org.slug})`;
  const lapsed = org.entitled === false ? "  (no live subscription)" : "";
  return `${org.name}${slug} — ${org.id}${lapsed}`;
}

/** Where a prompt reads and writes; injectable so a closed stream is testable. */
export interface PromptIo {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
}

const STDIO: PromptIo = { input: process.stdin, output: process.stdout };

/**
 * One question, answered or abandoned. Resolves null when the input closes
 * (Ctrl-D, a closed pipe) — `rl.question` itself never settles then, and an
 * unsettled await ends the process with exit 13 and nothing linked.
 */
function askLine(rl: readline.Interface, query: string): Promise<string | null> {
  return new Promise((resolve) => {
    const onClose = () => resolve(null);
    rl.once("close", onClose);
    try {
      rl.question(query).then(
        (answer) => {
          rl.off("close", onClose);
          resolve(answer);
        },
        () => resolve(null),
      );
    } catch {
      resolve(null);
    }
  });
}

/** The interactive half of "one team links silently; several prompt". */
export async function promptForOrg(
  candidates: readonly PortalOrganization[],
  io: PromptIo = STDIO,
): Promise<PortalOrganization | null> {
  const rl = readline.createInterface({ input: io.input, output: io.output });
  try {
    io.output.write("\nYou are in more than one team. Which one is this project?\n");
    candidates.forEach((org, index) => {
      io.output.write(`  ${index + 1}) ${describeOrg(org)}\n`);
    });
    const answer = await askLine(rl, `Choose 1-${candidates.length} (or Enter to skip): `);
    if (answer === null) return null;
    const index = Number(answer.trim());
    if (!Number.isInteger(index) || index < 1 || index > candidates.length) return null;
    return candidates[index - 1] ?? null;
  } finally {
    rl.close();
  }
}

function describePortalProject(entry: PortalProjectEntry): string {
  const description = entry.description === "" ? "" : ` — ${entry.description}`;
  return `${entry.name} (${entry.slug})${entry.default ? " [default]" : ""}${description}`;
}

const MAX_PROJECT_PROMPT_TRIES = 3;

/**
 * The interactive half of choosing a portal project. Enter takes the default
 * pick, `skip` leaves it unchosen, an invalid answer is asked again (at most
 * {@link MAX_PROJECT_PROMPT_TRIES} times), and a closed input is a skip.
 */
export async function promptForPortalProject(
  entries: readonly PortalProjectEntry[],
  defaultSlug: string,
  io: PromptIo = STDIO,
): Promise<PortalProjectEntry | null> {
  const rl = readline.createInterface({ input: io.input, output: io.output });
  try {
    io.output.write("\nWhich portal project does this repo use?\n");
    entries.forEach((entry, index) => {
      io.output.write(`  ${index + 1}) ${describePortalProject(entry)}\n`);
    });
    const fallback = entries.find((entry) => entry.slug === defaultSlug) ?? null;
    for (let attempt = 1; attempt <= MAX_PROJECT_PROMPT_TRIES; attempt += 1) {
      const raw = await askLine(
        rl,
        `Choose 1-${entries.length} (Enter for ${defaultSlug}, or "skip"): `,
      );
      if (raw === null) return null;
      const answer = raw.trim();
      if (answer.toLowerCase() === "skip") return null;
      if (answer === "") return fallback;
      if (/^\d+$/.test(answer)) {
        const index = Number(answer);
        if (index >= 1 && index <= entries.length) return entries[index - 1] ?? null;
      }
      io.output.write(`Not a valid choice: enter a number from 1 to ${entries.length}.\n`);
    }
    return null;
  } finally {
    rl.close();
  }
}

/** Why a portal project list could not be had, in words a person can act on. */
function whyNoPortalProjects(err: unknown): string {
  const status = err instanceof PortalAuthError ? err.status : undefined;
  switch (status) {
    case 404:
      return "this portal does not offer a portal project list (it may be an older release)";
    case 402:
      return "the team has no live subscription";
    case 403:
      return "the portal refused the request for the list";
    case undefined:
      return err instanceof Error ? err.message : String(err);
    default:
      return `the portal answered ${status}`;
  }
}

/**
 * Record the team in the project's COMMITTED settings, then the portal project.
 *
 * This is the whole of `project-team-binding` on the link path. A sign-in that
 * stops at a stored token leaves the project no better off than before: the
 * keychain knows who you are, and nothing knows which team this repo belongs
 * to. `interactive` is false for `--json` and for a non-TTY, where a prompt
 * would hang a script instead of asking a person.
 *
 * The portal project list can never stop the team link: every way of failing to
 * get it ends in `projects_unavailable` with the team recorded.
 */
export async function bindProjectTeam(options: {
  readonly dir: string;
  readonly identity: PortalIdentity;
  readonly requested?: string;
  /** `--project`: a slug, or `default` to remove `team.project`. */
  readonly project?: string;
  readonly interactive: boolean;
  readonly portalUrl: string;
  readonly listProjects: (orgId: string) => Promise<readonly PortalProjectEntry[]>;
  readonly pickProject?: (
    entries: readonly PortalProjectEntry[],
    defaultSlug: string,
  ) => Promise<PortalProjectEntry | null>;
}): Promise<BindOutcome> {
  const choice = chooseOrganization(options.identity.organizations, options.requested);
  let org: PortalOrganization;
  switch (choice.kind) {
    case "chosen":
      org = choice.org;
      break;
    case "none":
      return { kind: "no_organizations" };
    case "unknown":
      return { kind: "unknown", requested: choice.requested };
    case "ambiguous": {
      if (!options.interactive) return { kind: "ambiguous", candidates: choice.candidates };
      const picked = await promptForOrg(choice.candidates);
      if (picked === null) return { kind: "ambiguous", candidates: choice.candidates };
      org = picked;
      break;
    }
  }

  const before = await readProjectTeamKeys(options.dir);
  const sameTeam = before.orgId === org.id;
  const existing = sameTeam ? before.project : null;
  const requested = options.project?.trim() ?? "";

  // What to hand bindTeam (undefined = nothing chosen) and what to report.
  let write: string | null | undefined;
  let outcome: PortalProjectOutcome | undefined;

  if (requested.toLowerCase() === "default") {
    write = null;
    outcome = { kind: "default" };
  } else if (requested !== "" || options.interactive) {
    let entries: readonly PortalProjectEntry[] | null = null;
    let reason = "";
    try {
      entries = await options.listProjects(org.id);
    } catch (err) {
      reason = whyNoPortalProjects(err);
    }
    if (entries === null) {
      outcome = {
        kind: "projects_unavailable",
        reason,
        ...(requested === "" ? {} : { requested }),
      };
    } else if (requested !== "") {
      const match = entries.find((entry) => entry.slug === requested);
      if (match === undefined || !isValidPortalProjectSlug(match.slug)) {
        outcome = {
          kind: "unknown_project",
          requested,
          available: entries.map((entry) => entry.slug),
        };
      } else if (match.default) {
        write = null;
        outcome = { kind: "default" };
      } else {
        write = match.slug;
        outcome = { kind: "chosen", slug: match.slug, name: match.name };
      }
    } else {
      const portalDefault = entries.find((entry) => entry.default)?.slug ?? "";
      const only = entries.length <= 1 ? entries[0] : undefined;
      if (entries.length === 0) {
        outcome = { kind: "projects_unavailable", reason: "the team has no portal projects" };
      } else if (only !== undefined && only.default) {
        // Nothing to choose between. Said as `default`, not silently dropped.
        write = null;
        outcome = { kind: "default" };
      } else {
        const defaultSlug =
          existing !== null && entries.some((entry) => entry.slug === existing)
            ? existing
            : portalDefault !== ""
              ? portalDefault
              : (entries[0]?.slug ?? "");
        const picked = await (options.pickProject ?? promptForPortalProject)(entries, defaultSlug);
        if (picked === null) {
          outcome = { kind: "skipped" };
        } else if (picked.default) {
          write = null;
          outcome = { kind: "default" };
        } else {
          write = picked.slug;
          outcome = { kind: "chosen", slug: picked.slug, name: picked.name };
        }
      }
    }
  } else {
    outcome = { kind: "skipped_non_interactive" };
  }

  const result = await bindTeam({
    projectDir: options.dir,
    orgId: org.id,
    portalUrl: options.portalUrl,
    ...(write === undefined ? {} : { portalProject: write }),
  });
  // The same team's slug survived a failed or refused choice: name it, because
  // "the default applies" would be false while team.project is still in the file.
  if (
    result.portalProject === "kept" &&
    result.previousPortalProject !== null &&
    (outcome.kind === "unknown_project" || outcome.kind === "projects_unavailable")
  ) {
    outcome = { ...outcome, keptSlug: result.previousPortalProject };
  }
  // Nothing chosen and the same team's slug survived: say it is kept, not skipped.
  if (
    result.portalProject === "kept" &&
    (outcome.kind === "skipped_non_interactive" || outcome.kind === "skipped")
  ) {
    outcome = { kind: "kept", slug: result.previousPortalProject ?? "" };
  }
  return {
    kind: "bound",
    orgId: result.orgId,
    name: org.name,
    settingsFile: result.settingsFile,
    entitled: org.entitled !== false,
    movedFrom:
      result.previousOrgId !== null && result.previousOrgId !== result.orgId
        ? result.previousOrgId
        : null,
    droppedPortalProject: result.portalProject === "dropped" ? result.previousPortalProject : null,
    portalProject: outcome,
  };
}

/** What `golem team status` says about the PROJECT, with no network at all. */
export interface ProjectBindingView {
  readonly linked: boolean;
  readonly orgId: string | null;
  readonly summary: string;
  /** Human line about `~/.golem/teams/<org>.json`; null when unlinked. */
  readonly cache: string | null;
  /** The portal project this repo names; null for the team's default. */
  readonly portalProject: string | null;
  /**
   * Which portal project's data is in force and why, from the last sync's
   * record. `null` when nothing is known (never synced) or the repo is unlinked.
   */
  readonly portalProjectState: "found" | "default" | "fallback" | "denied" | null;
}

/**
 * Whether a portal is configured at all — the question `golem team status` must
 * ask BEFORE `resolvePortalConfig`, which throws when the answer is no.
 *
 * Exported because the ordering it protects regressed once: no portal is the
 * DEFAULT for every solo user, so asking `resolvePortalConfig` first made a
 * read-only status command exit 2 on a plain unlinked project.
 */
export function portalIsConfigured(portal: { readonly url: string }): boolean {
  return portal.url.trim() !== "";
}

export async function describeProjectBinding(
  team: TeamSettings,
  userDir: string = defaultUserDir(),
): Promise<ProjectBindingView> {
  const state = readTeamBinding(team);
  if (state.kind === "unlinked") {
    // The free tier, stated as a fact rather than an absence — and NO cache is
    // consulted on this branch, which is the Decision 64 invariant in code.
    return {
      linked: false,
      orgId: null,
      summary: "none — this project is not linked to a team (Golem is complete without one)",
      cache: null,
      portalProject: null,
      portalProjectState: null,
    };
  }
  if (state.kind === "invalid") {
    return {
      linked: false,
      orgId: state.orgId,
      summary: `${state.orgId} — IGNORED, because ${state.reason}`,
      cache: null,
      portalProject: null,
      portalProjectState: null,
    };
  }
  const { binding } = state;
  const applied = binding.sync ? "" : " (team.sync is off, so its settings are not applied)";
  const project = binding.project ?? "";
  const cachePath = teamCachePath(userDir, binding.orgId, project);
  let cache: string;
  try {
    const info = await stat(cachePath);
    cache = `${cachePath} — ${describeCacheAge(info.mtimeMs, Date.now())}`;
  } catch {
    cache = `${cachePath} — not fetched yet`;
  }

  // Which portal project applies, and why. The reason comes from the record the
  // last sync left in this portal project's own cache, so this stays a pure
  // local read: no request is made.
  let resolved: ProjectBindingView["portalProjectState"] = project === "" ? "default" : null;
  let which = project === "" ? "the default portal project" : `portal project ${project}`;
  if (project !== "") {
    const recorded = await readTeamLayerCache(userDir, binding.orgId, { project }).catch(
      () => null,
    );
    if (recorded?.denied !== undefined) {
      resolved = "denied";
      which =
        `portal project ${project} (the portal denied this team on ${recorded.denied.at}: ` +
        `${recorded.denied.code}; its cached settings are NOT applied)`;
    } else if (recorded?.project_state !== undefined) {
      resolved = "fallback";
      which =
        `the default portal project (portal project ${project} did not apply: ` +
        `${recorded.project_state})`;
    } else if (recorded !== null) {
      resolved = "found";
    }
  }
  const rejected = binding.projectRejected === undefined ? "" : `; ${binding.projectRejected}`;
  return {
    linked: true,
    orgId: binding.orgId,
    summary: `${binding.orgId} — ${which}${applied}${rejected}`,
    cache,
    portalProject: project === "" ? null : project,
    portalProjectState: resolved,
  };
}

export default function register(program: Command): void {
  const teamCmd = program
    .command("team")
    .description(
      "Sign in to the hosted portal (team-portal-auth) — the token goes to the OS keychain",
    );

  teamCmd
    .command("link")
    .description(
      "Sign in to the portal in a browser (authorization code + PKCE over a loopback redirect)",
    )
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--no-browser", "print the sign-in URL instead of opening a browser")
    .option("--org <id-or-slug>", "which team to bind this project to (skips the prompt)")
    .option(
      "--project <slug>",
      "which portal project this repo uses (`default` removes team.project; skips the prompt; exit 2 if it cannot be recorded)",
    )
    .option("--no-bind", "sign in only — do not write team.org_id into this project")
    .option("--timeout <ms>", "override how long to wait for the browser round trip")
    .option("--portal-url <url>", "portal API base to bind the token to (https or loopback)")
    .option("--issuer <url>", "authorization server to bind the token to (https or loopback)")
    .option("--json", "machine-readable output", false)
    .action(async (opts: LinkOptions) => {
      try {
        const flagError = linkFlagError(opts);
        if (flagError !== null) {
          process.stderr.write(`golem: ${flagError}\n`);
          process.exitCode = 2;
          return;
        }
        const { config, tokens, provenance } = await portalContext(opts.dir, {
          ...(opts.portalUrl === undefined ? {} : { portalUrl: opts.portalUrl }),
          ...(opts.issuer === undefined ? {} : { issuer: opts.issuer }),
        });
        assertLinkConfigTrusted(provenance);
        const timeoutMs = opts.timeout === undefined ? config.linkTimeoutMs : Number(opts.timeout);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          throw new Error(`--timeout must be a positive number of milliseconds`);
        }

        // Progress goes to STDERR so `--json` stdout stays parseable, and so a
        // user watching a browser open still sees what is happening.
        const narrate = opts.json
          ? (text: string) => process.stderr.write(text)
          : (text: string) => process.stdout.write(text);

        const result = await linkPortal({
          issuerUrl: config.issuerUrl,
          apiBaseUrl: config.apiBaseUrl,
          clientId: config.clientId,
          tokens,
          browser: opts.browser
            ? systemBrowser()
            : printingBrowser((text) => process.stderr.write(text)),
          timeoutMs,
          write: narrate,
        });

        // The gate for this task: a stored token that `GET /api/v1/me`
        // actually answers 200 to. Doing it here rather than leaving it to the
        // user means a link that "succeeded" but produced an unusable token
        // fails now, while the browser is still open.
        const client = createPortalClient({
          apiBaseUrl: config.apiBaseUrl,
          clientId: config.clientId,
          metadata: () => discoverAuthorizationServer(config.issuerUrl),
          tokens,
        });
        const identity = await client.me();

        // `project-team-binding`: bind the PROJECT, not just the machine. A
        // prompt is only offered to a real terminal — under `--json` or in a
        // pipeline, asking a question nobody can answer is a hang.
        const bind: BindOutcome = opts.bind
          ? await bindProjectTeam({
              dir: opts.dir,
              identity,
              ...(opts.org === undefined ? {} : { requested: opts.org }),
              ...(opts.project === undefined ? {} : { project: opts.project }),
              interactive: !opts.json && process.stdin.isTTY === true,
              portalUrl: config.apiBaseUrl,
              listProjects: (orgId) => client.projects(orgId),
            })
          : { kind: "skipped" };

        // The token is stored either way, so the only outcome that can leave a
        // WRONG belief behind is an unbound project: exit 2 (the recoverable
        // code) says "one more decision needed" while the sign-in still
        // reports success. Exit 0 with no team recorded would read as linked.
        process.exitCode = bindExitCode(bind);

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify(
              linkJsonPayload({
                stored: result.location,
                token: result.summary,
                identity,
                bind,
              }),
              null,
              2,
            )}\n`,
          );
          return;
        }

        process.stdout.write(
          `\nLinked. The token is in ${result.location.label}` +
            ` (${result.location.protection}).\n`,
        );
        process.stdout.write(`Signed in as ${identity.user.email ?? identity.user.id}.\n`);
        if (identity.organizations.length === 0) {
          process.stdout.write(
            "No organizations. Ask a portal admin to invite you, then re-run `golem team status`.\n",
          );
        } else {
          process.stdout.write("\nOrganizations:\n");
          for (const org of identity.organizations) {
            process.stdout.write(`  ${describeOrg(org)}\n`);
          }
        }

        switch (bind.kind) {
          case "bound":
            process.stdout.write(
              `\nThis project is now bound to ${bind.name} (${bind.orgId}).\n` +
                `Recorded in ${bind.settingsFile} — commit it, and a colleague who clones ` +
                `this repo is pointed at the same team.\n`,
            );
            if (bind.movedFrom !== null) {
              process.stdout.write(
                `It was bound to ${bind.movedFrom}; that team no longer applies here.\n`,
              );
            }
            if (bind.droppedPortalProject !== null) {
              process.stdout.write(
                `Removed team.project (${bind.droppedPortalProject}): a portal project belongs ` +
                  "to one team and means nothing in another.\n",
              );
            }
            process.stdout.write(`${describePortalProjectOutcome(bind.portalProject)}\n`);
            if (!bind.entitled) {
              // Said now rather than at the next surprising moment. The link is
              // still correct; what is missing is the subscription behind it.
              process.stdout.write(
                "That team has no live subscription, so team settings will not be applied " +
                  "until it does — Golem carries on with local configuration.\n",
              );
            }
            break;
          case "ambiguous":
            process.stdout.write(
              "\nNothing was bound: you are in more than one team and none was chosen. " +
                "Re-run with `--org <id-or-slug>` to bind this project.\n",
            );
            break;
          case "unknown":
            process.stdout.write(
              `\nNothing was bound: no team of yours matches ${JSON.stringify(bind.requested)}. ` +
                "Pick one of the ids above with `--org`.\n",
            );
            break;
          case "no_organizations":
            process.stdout.write(
              "\nNothing was bound: you are not in any team yet. Golem is complete without " +
                "one — the team layer only adds org-wide settings and shared skills.\n",
            );
            break;
          case "skipped":
            process.stdout.write(
              "\nNothing was bound (`--no-bind`): this machine is signed in, but the project " +
                "still names no team. Run `golem team link --org <id>` to record one.\n",
            );
            break;
        }
      } catch (err) {
        _fail(err);
      }
    });

  teamCmd
    .command("status")
    .description("Show whether this machine is linked to the portal, and to which issuer")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--json", "machine-readable output", false)
    .action(async (opts: { dir: string; json: boolean }) => {
      try {
        // The PROJECT half first, and deliberately so: it is a pure read of
        // already-loaded settings — no request is made, and the per-org cache is
        // stat'd ONLY when this project names a team, because an unlinked
        // project must read no cache at all (Decision 64).
        //
        // Order matters, and having it the other way round was a free-solo
        // papercut: `resolvePortalConfig` THROWS when no portal is configured,
        // which is the DEFAULT for every solo user. Asking it first made this
        // command exit 2 on a plain unlinked project and report a missing portal
        // setup as though it were the answer to "is this repo on a team?". The
        // answer is knowable with no portal at all, so a read-only status
        // command states it and exits 0.
        const { settings } = await loadEffectiveConfig({ projectDir: opts.dir });
        const project = await describeProjectBinding(settings.team);
        if (!portalIsConfigured(settings.portal)) {
          if (opts.json) {
            const payload = { configured: false, linked: false, team: project };
            process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
            return;
          }
          process.stdout.write(`Team:    ${project.summary}\n`);
          process.stdout.write("Portal:  none configured — set `portal.url` to use a team\n");
          return;
        }
        const { config, tokens } = await portalContext(opts.dir);
        const status = await portalStatus({
          issuerUrl: config.issuerUrl,
          apiBaseUrl: config.apiBaseUrl,
          clientId: config.clientId,
          tokens,
        });
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ ...status, team: project }, null, 2)}\n`);
          return;
        }
        process.stdout.write(`Team:    ${project.summary}\n`);
        if (project.cache !== null) {
          process.stdout.write(`Cache:   ${project.cache}\n`);
        }
        process.stdout.write(`Portal:  ${status.apiBaseUrl}\n`);
        process.stdout.write(`Issuer:  ${status.issuer}\n`);
        process.stdout.write(`Client:  ${status.clientId}\n`);
        if (!status.linked) {
          process.stdout.write("Linked:  no — run `golem team link`\n");
          return;
        }
        const token = status.token;
        process.stdout.write(`Linked:  yes (stored token)\n`);
        process.stdout.write(`Scopes:  ${token?.scopes.join(" ") || "(none reported)"}\n`);
        process.stdout.write(
          `Expires: ${token?.expiresAt ?? "not stated"}${token?.expired === true ? " — EXPIRED, will refresh on next use" : ""}\n`,
        );
        if (token?.hasRefreshToken === false) {
          process.stdout.write(
            "Refresh: none stored — you will be asked to sign in again when this expires\n",
          );
        }
      } catch (err) {
        _fail(err);
      }
    });

  // `golem team sync` — `team-layer-fetch`. The ONE place a team layer is
  // fetched on demand; everything else reads the cache it writes.
  //
  // **This settles Decision 63(f)**, which asked whether a sync refreshes only
  // the current project's team or every linked team. The answer is *the current
  // project's team by default, with `--all` as an explicit machine-wide sweep*,
  // and the reason is that the two are answers to different questions:
  //
  //   - A sync is a PROJECT-scoped act. It is run in a repo, it reports against
  //     that repo's team, and an entitlement verdict it receives is about the
  //     org that repo names. Refreshing a second org silently would produce a
  //     402 with no project to report it against.
  //   - "Every linked team" is also not knowable: the cache directory lists
  //     teams previously SYNCED on this machine, not teams currently linked by
  //     some project on it, and 63(d) guarantees those sets differ. Sweeping it
  //     spends a request per org on policy no live project may still use.
  //
  // 63(f) worried that only-current leaves a rarely-touched repo's cache
  // quietly ancient. 63(c)'s per-team age in `golem status` makes that visible,
  // and `--all` is the fix once it is visible — which is the right order: see
  // the staleness, then choose to clear it.
  teamCmd
    .command("sync")
    .description("Fetch this project's team settings layer and cache it (team-layer-fetch)")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--all", "also refresh every other team already cached on this machine", false)
    .option("--json", "machine-readable output", false)
    .action(async (opts: { dir: string; all: boolean; json: boolean }) => {
      try {
        const userDir = defaultUserDir();
        // Read the binding BEFORE resolving the portal: `resolvePortalConfig`
        // throws when no portal is configured, which is every solo user, and
        // the unlinked answer needs no portal at all (same order as `status`).
        const { settings } = await loadEffectiveConfig({ projectDir: opts.dir });
        const state = readTeamBinding(settings.team);

        // Decision 64(c). No team named means no portal request, no cache read
        // and no token lookup — and this returns before any of the three, which
        // is why the branch is first rather than folded into the loop below.
        if (state.kind === "unlinked") {
          const line =
            "This project is not linked to a team, so there is nothing to sync — " +
            "Golem is complete without one. `golem team link` links it.";
          process.stdout.write(
            opts.json ? `${JSON.stringify({ linked: false, synced: [] }, null, 2)}\n` : `${line}\n`,
          );
          return;
        }
        if (state.kind === "invalid") {
          process.stdout.write(
            `Team ${state.orgId} is named in this project's settings but ${state.reason}. ` +
              "Nothing was synced.\n",
          );
          process.exitCode = 2;
          return;
        }

        const { config, tokens } = await portalContext(opts.dir);
        const { binding } = state;
        const targets: { orgId: string; portalUrl: string; project: string }[] = [
          {
            orgId: binding.orgId,
            portalUrl: teamApiBaseUrl(binding, config.apiBaseUrl),
            project: binding.project ?? "",
          },
        ];
        if (opts.all) {
          for (const cached of await listTeamLayerCaches(userDir)) {
            // A cache is per portal project: the same org's other portal
            // projects are refreshed under their own slug, never this repo's.
            if (
              cached.org_id === binding.orgId &&
              (cached.portal_project ?? "") === (binding.project ?? "")
            )
              continue;
            // Another team's own `team.portal_url` is not knowable from here —
            // only the project that names it has that — so a sweep uses this
            // machine's configured portal, which is right for the ordinary
            // single-portal case and honestly wrong for nothing else.
            targets.push({
              orgId: cached.org_id,
              portalUrl: config.apiBaseUrl,
              project: cached.portal_project ?? "",
            });
          }
        }

        const results: Record<string, unknown>[] = [];
        for (const target of targets) {
          const client = createPortalClient({
            apiBaseUrl: target.portalUrl,
            clientId: config.clientId,
            metadata: () => discoverAuthorizationServer(config.issuerUrl),
            tokens,
          });
          // Fail loudly (non-zero) rather than degrade to the cache when the
          // token may not go to this portal: no request is made (DUSTSEC.4).
          await client.assertBound?.();
          const result = await syncTeamLayer({
            binding: {
              ...binding,
              orgId: target.orgId,
              portalUrl: target.portalUrl,
              project: target.project,
            },
            userDir,
            client,
            report: true,
          });
          results.push({
            org_id: target.orgId,
            ...(target.project === "" ? {} : { portal_project: target.project }),
            disposition: result.disposition.kind,
            applied: result.applied,
            skipped: result.skipped,
            from_cache: result.fromCache,
            notice: result.notice,
            ...(result.project === undefined ? {} : { portal_project_resolution: result.project }),
            ...(result.cacheWritten === undefined ? {} : { cache_written: result.cacheWritten }),
            ...(result.cacheDenied === undefined ? {} : { cache_denied: result.cacheDenied }),
          });

          if (!opts.json) {
            // The notice is the honest line for every outcome — it names the
            // team, says what is actually applied, and never says "failed".
            process.stdout.write(`${result.notice}\n`);
            for (const key of result.applied) process.stdout.write(`  ${key}\n`);
            if (result.applied.some((k) => k.includes("[pending"))) {
              process.stdout.write(
                "  (applied = passed the static team policy; [pending] rules are judged against your own value at load)\n",
              );
            }
            for (const row of result.skipped) {
              process.stdout.write(`  skipped ${row.key} — ${row.reason}\n`);
            }
            if (result.cacheWritten !== undefined) {
              process.stdout.write(`  cached to ${result.cacheWritten}\n`);
            }
          }
        }

        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ linked: true, synced: results }, null, 2)}\n`);
        }
      } catch (err) {
        // A sync that cannot even be attempted (no portal configured, no token)
        // is a recoverable state, and `_fail` already codes those 2.
        _fail(err);
      }
    });

  // `golem team unlink` is the PROJECT-scope inverse of `link`, and it is
  // deliberately not the inverse of the token store. Before this task `unlink`
  // was an alias for `logout`; that alias is gone, because the two undo
  // different things at different scopes and one word cannot mean both. A
  // machine has one identity and may hold many projects, so forgetting the
  // token would unlink every repo on it — which is never what "unlink this
  // project" means.
  teamCmd
    .command("unlink")
    .description(
      "Remove THIS project's team binding and its managed team skills (the token is untouched)",
    )
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--json", "machine-readable output", false)
    .action(async (opts: { dir: string; json: boolean }) => {
      try {
        const result = await unbindTeam({
          projectDir: opts.dir,
          // Team skills are managed files: dropping the provenance record with
          // the file keeps `golem init` from later classifying a re-synced skill
          // as one the user hand-edited.
          forget: (relativePath) => forgetManaged(opts.dir, relativePath),
        });
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }
        if (result.orgId === null) {
          process.stdout.write("This project named no team — nothing to unlink.\n");
        } else {
          process.stdout.write(
            `Unlinked ${result.orgId}. Removed team.org_id from ${result.settingsFile}.\n`,
          );
        }
        for (const dir of result.removedSkillDirs) {
          process.stdout.write(`Removed managed team skills in ${dir}.\n`);
        }
        if (result.cacheKept !== null) {
          // Said out loud because a file left behind looks like a bug until you
          // know why it is there.
          process.stdout.write(
            `Kept ${result.cacheKept}: the cache is machine scope while the link is project ` +
              `scope, so another project on this machine may still be using that team's ` +
              `offline policy. It is stale at worst, and its timestamp says so.\n`,
          );
        }
        process.stdout.write(
          "Your portal sign-in is untouched — this only unlinks this project. " +
            "Run `golem team logout` to forget the token on this machine.\n",
        );
      } catch (err) {
        _fail(err);
      }
    });

  teamCmd
    .command("logout")
    .description("Forget the stored portal token on this machine")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--json", "machine-readable output", false)
    .action(async (opts: { dir: string; json: boolean }) => {
      try {
        const tokens = portalTokenStore(createCredentialStore());
        const { removed } = await unlinkPortal(tokens);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ removed }, null, 2)}\n`);
          return;
        }
        if (removed.length === 0) {
          process.stdout.write("Nothing to forget — this machine was not linked.\n");
          return;
        }
        for (const where of removed) {
          process.stdout.write(`Forgot the portal token in ${where.label}.\n`);
        }
        // Said plainly because "logged out" that leaves a live token at the
        // authorization server is exactly the claim a user will rely on.
        process.stdout.write(
          "This is local only: the token is gone from this machine but was not revoked at " +
            "the portal. Revoke it there if it may have been exposed.\n",
        );
      } catch (err) {
        _fail(err);
      }
    });

  // `golem team skills` — `team-skills-sync`. The user-facing way to run the
  // sync that `golem init` will also run through `init-team.ts`'s
  // `syncTeamLayer` seam. It has no failure path of its own for an entitlement
  // outcome: a lapsed subscription or an offline laptop is a REPORT and exit 0,
  // because nothing in the team layer may break a local-first tool.
  teamCmd
    .command("skills")
    .description("Sync this project's team skills into .claude/skills/golem-team-<name>/")
    .option("--dir <path>", "project directory", _DEFAULT_DIR)
    .option("--dry-run", "show what would change and write nothing", false)
    .option("--json", "machine-readable output", false)
    .action(async (opts: { dir: string; dryRun: boolean; json: boolean }) => {
      try {
        const { settings } = await loadEffectiveConfig({ projectDir: opts.dir });
        const state = readTeamBinding(settings.team);

        // Decision 64, at the earliest point it can be applied: an unlinked
        // project builds no portal client, so there is no keychain lookup and
        // no request to accidentally make. The transport stays undefined for
        // any state but `linked`, and `syncTeamSkills` refuses to invent one.
        let transport: TeamSkillsTransport | undefined;
        let unconfigured: string | null = null;
        if (state.kind === "linked") {
          try {
            const config = resolvePortalConfig(settings.portal);
            const client = createPortalClient({
              apiBaseUrl: teamApiBaseUrl(state.binding, config.apiBaseUrl),
              clientId: config.clientId,
              metadata: () => discoverAuthorizationServer(config.issuerUrl),
              tokens: portalTokenStore(createCredentialStore()),
            });
            transport = (reqPath) => client.request(reqPath);
          } catch (err) {
            // A project can commit `team.org_id` without a portal address —
            // a merge, or a team whose members were told to set `portal.url`
            // themselves. That is a configuration gap, not an entitlement
            // verdict, and it must not hard-fail a command every member runs:
            // no transport is built, the sync reports honestly, and the reason
            // is printed. Exit 0, nothing on disk touched.
            unconfigured = err instanceof Error ? err.message : String(err);
          }
        }

        const result = await syncTeamSkills({
          projectDir: opts.dir,
          team: settings.team,
          dryRun: opts.dryRun,
          userDir: defaultUserDir(),
          ...(transport === undefined ? {} : { transport }),
        });

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ ...result, dryRun: opts.dryRun, unconfigured }, null, 2)}\n`,
          );
          return;
        }
        if (unconfigured !== null) {
          process.stdout.write(`${unconfigured}\n`);
        }
        for (const action of result.actions) {
          process.stdout.write(`${action.kind.padEnd(8)} ${action.path} — ${action.detail}\n`);
        }
        for (const notice of result.notices) {
          process.stdout.write(`${notice}\n`);
        }
        if (result.outcome.kind === "unlinked") {
          process.stdout.write(
            "No team is linked to this project — Golem is complete without one. " +
              "`golem team link` adds org-wide settings and shared skills if you have a team.\n",
          );
        }
      } catch (err) {
        _fail(err);
      }
    });
}
