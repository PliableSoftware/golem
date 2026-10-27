---
task: team-link-default-portal
title: "golem team link works out of the box: default portal https://golem.run, and the issuer and OAuth client id come from the portal"
state: queued
owner: agent
size: M
discipline: code
blocked: "The portal must publish GET /.well-known/golem-client.json first (proposed in golem-portal docs/api-contract.md, section 1 'Client configuration (published)'). Until it is live, link can only fail with the manual-settings message."
design: "src/cli/commands/team.ts (portalContext, applyLinkOverrides, assertLinkConfigTrusted, the link action); src/portal/config.ts (resolvePortalConfig, the 'none configured' error); src/portal/discovery.ts; src/config/schema.ts portal.* comments (url, issuer, client_id are empty by default on purpose); docs/wiki/concepts/Project Team Binding.md and Free and Team Tiers.md. Portal side: PliableSoftware/golem-portal docs/api-contract.md sections 1 and 6."
gate: "On a machine with no portal.* settings, `golem team link` signs in to https://golem.run through the browser (or prints the URL with --no-browser) with no flags and no config: it fetches the portal's published client configuration, signs in, stores the token in the OS keychain and binds the project. Explicit portal.url, portal.issuer, portal.client_id, GOLEM_* and --portal-url / --issuer win over the default and over the published document. A project with no team.org_id still performs zero portal I/O, and `golem status` and every non-link command are unchanged. A portal that is unreachable, answers non-200, serves a version the harness does not know, or serves a non-https issuer or api_base (loopback excepted) fails link with one message that names the manual settings; nothing is guessed. Failing-first tests cover each of those. golem verify exit 0."
depends_on: []
touches: [src/cli, src/portal, tests, docs/wiki]
created: 2026-10-22
---

## What this is

`golem team link` already signs in through a browser (authorization code with PKCE over a loopback redirect, RFC 8252) and stores the token in the OS keychain. It cannot be used out of the box: `portal.url`, `portal.issuer` and `portal.client_id` all default to empty, so a person must find and set three values before the first link. The issuer is Clerk's Frontend API, a different origin from golem.run, and the OAuth client id exists only in the portal operator's Clerk setup.

The wanted behaviour: `golem team link` in a repo, with nothing configured, takes the person through sign-in and sets up the link.

## Decisions already made (USER, 2026-10-22)

1. **The portal publishes the issuer and client id.** They are not compiled into the harness. The proposed document is `GET {portal-origin}/.well-known/golem-client.json` with `version`, `api_base`, `issuer`, `client_id`, `scopes`. The portal owns the final shape in `docs/api-contract.md`; this task reads that contract, not this paragraph.
2. **The default is a link-time fallback, not a schema default.** `portal.url` stays empty in the schema. `golem team link` uses `https://golem.run` only when no portal is configured by any layer or flag. Changing the schema default would turn "no portal configured" into "always configured" and break the local-first guarantees below.

## What to build

1. **Fallback.** In the link path only, when `portal.url` resolves empty from every origin and no `--portal-url` is given, use `https://golem.run`. Say so on the first line of output ("No portal configured; using https://golem.run").
2. **Fetch the published client configuration** from the portal URL link is about to sign in to, over HTTPS (loopback allowed for development, as the existing `--portal-url` rule already does). Bounded timeout, no redirect off the origin, body size cap, strict schema (Zod at the boundary). Ignore unknown fields; refuse an unknown `version`.
3. **Precedence.** Explicit `portal.issuer` / `portal.client_id` (any origin the link path already trusts) and `--issuer` win over the published values, field by field. Nothing is fetched when both are already set.
4. **Trust.** `assertLinkConfigTrusted` stays the gate for repo-committed portal settings. A published document is trusted only as far as the TLS connection to the portal it came from: it must not be able to redirect a sign-in for a *different* portal URL, and its `issuer` and `api_base` must be https (loopback excepted).
5. **Never persist.** The fetched issuer and client id are used for this sign-in and held in memory. They are not written to the project's committed settings or to a settings file. (The token goes to the keychain as today. If caching the document is wanted, it goes under `~/.golem` keyed by portal URL, with a short TTL, and is not a setting.)
6. **Failure.** Unreachable, non-200, wrong content type, bad JSON, unknown version, non-https issuer: link fails with one message that says what was tried and names the manual settings (`golem config set portal.url`, `portal.issuer`, `portal.client_id`). No retry loop, no guessing a Clerk domain.
7. **Headless.** There is no device grant (portal contract section 6). `--no-browser` prints the sign-in URL as today; say plainly that the loopback redirect needs a browser on the same machine.
8. **Status.** `golem team status` with no portal configured should say that `golem team link` will use https://golem.run, instead of only "none configured".
9. **Docs.** Update `Project Team Binding.md` and `Free and Team Tiers.md`: setup is now `golem team link`, with the manual settings as the override path.

## Hard rules

- A project with no `team.org_id` performs zero portal I/O. The link fallback applies to `golem team link` only; no other command, hook, daemon or startup path may start talking to golem.run because of it.
- The compiled-in default is a URL, not a credential. No client id, issuer or token goes into the repo.
- A silent no-op is worse than an error: if the published configuration cannot be used, say so and stop.
- Never write that a team, a portal project or `enforced` is a lock.
- Redaction and the other hard rules in CLAUDE.md are untouched.

## Tests

- No settings anywhere: link uses https://golem.run and the published document (fake portal serving the contract shape).
- Each explicit source beats the published value: setting, env, flag; field by field.
- Both explicit: nothing is fetched.
- Unreachable, 404, 5xx, wrong content type, malformed JSON, unknown version, http issuer, http api_base, redirect to another origin, oversized body: each fails with the one message and leaves the project and keychain untouched.
- A repo whose committed `team.portal_url` names another portal does not get golem.run's client configuration.
- No `team.org_id`: zero portal I/O on every non-link command (assert no fetch).
- `golem team status` wording with no portal configured.

## Out of scope

- Building the portal endpoint (tracked in golem-portal).
- A device authorization grant for headless machines (Clerk does not offer one).
- Registering or rotating the OAuth application.
- Anything about which portal project a repo uses (shipped in v0.56.0 and v0.57.0).
