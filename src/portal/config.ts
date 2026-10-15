/**
 * Turning the `portal.*` settings into the three URLs/ids the flow needs.
 *
 * **Why there are two URLs and not one.** The portal's contract says a single
 * `GOLEM_PORTAL_URL` plus discovery points the harness at any environment. That
 * is true of the *authorization server* half — the endpoints really do come from
 * `<issuer>/.well-known/oauth-authorization-server`. It is not true of the API
 * half: `/api/v1/me` lives on the portal's own domain (`golem.run`), while the
 * issuer is Clerk's Frontend API (`https://clerk.<domain>`, or
 * `https://<slug>.clerk.accounts.dev` in development). They are different
 * origins, and no endpoint in the v1 contract maps one to the other.
 *
 * So `portal.url` is the API base, and `portal.issuer` is the authorization
 * server — with `portal.url` used for BOTH when `portal.issuer` is empty, which
 * is what makes the contract's single-variable claim true for any deployment
 * that publishes the metadata document at its own origin. The day the portal
 * grows an endpoint that advertises its issuer, this is the one function that
 * has to change.
 *
 * **`portal.client_id` has no default on purpose.** Registering the OAuth
 * application is a one-off act by the portal operator (`owner: user`), so a
 * baked-in id would either be wrong or would be a real client id compiled into a
 * public repository. Empty means "not configured", and the error says which
 * setting to set.
 */

import { PortalAuthError } from "./errors.js";
import { portalOrigin } from "./tokens.js";

/** The `portal` settings section, structurally. */
export interface PortalSettings {
  readonly url: string;
  readonly issuer: string;
  readonly client_id: string;
  readonly link_timeout_ms: number;
}

export interface PortalConfig {
  /** Portal API base — `/api/v1/...` hangs off this. */
  readonly apiBaseUrl: string;
  /** Authorization server base — discovery hangs off this. */
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly linkTimeoutMs: number;
}

export function resolvePortalConfig(settings: PortalSettings): PortalConfig {
  const apiBaseUrl = settings.url.trim().replace(/\/+$/, "");
  if (apiBaseUrl === "") {
    throw new PortalAuthError(
      "not_configured",
      "no portal is configured. Set `portal.url` (or GOLEM_PORTAL_URL) to the portal's " +
        "address, e.g. `golem config set portal.url https://golem.run`.",
    );
  }
  const clientId = settings.client_id.trim();
  if (clientId === "") {
    throw new PortalAuthError(
      "not_configured",
      "no portal OAuth client id is configured. The portal operator registers one public " +
        "OAuth application per distributed client and publishes its id; set it with " +
        "`golem config set portal.client_id <id>` (or GOLEM_PORTAL_CLIENT_ID).",
    );
  }
  const issuer = settings.issuer.trim().replace(/\/+$/, "");
  // https only (loopback excepted), for both URLs (DUSTSEC.4).
  portalOrigin(apiBaseUrl);
  if (issuer !== "") portalOrigin(issuer);
  return {
    apiBaseUrl,
    issuerUrl: issuer === "" ? apiBaseUrl : issuer,
    clientId,
    linkTimeoutMs: settings.link_timeout_ms,
  };
}

/**
 * Layers a repository can ship. `local` is included: a file tracked by git ships
 * with the repo even when `.gitignore` names it, so `.golem/settings.local.json`
 * is no safer than the project file (DUSTSEC.18).
 */
const CHECKOUT_LAYERS: ReadonlySet<string> = new Set(["project", "team", "local"]);

/**
 * Refuse to bind a new token to a portal a checkout chose (DUSTSEC.17).
 *
 * `golem team link` records the origins it is given as the token's binding, so a
 * committed `portal.url` / `portal.issuer` would bind the user's token to the
 * attacker's host from the start. Only user-scoped config, the environment, an
 * explicit override (the `--portal-url` / `--issuer` flags) or the defaults may
 * supply them at link time. Throws `untrusted_config`; names the key and file, never a token.
 */
export function assertLinkConfigTrusted(
  provenance: Readonly<Record<string, { readonly layer: string; readonly source?: string }>>,
): void {
  for (const key of ["portal.url", "portal.issuer"]) {
    const entry = provenance[key];
    if (entry === undefined || !CHECKOUT_LAYERS.has(entry.layer)) continue;
    throw new PortalAuthError(
      "untrusted_config",
      `refusing to link: \`${key}\` comes from the ${entry.layer} settings` +
        `${entry.source === undefined ? "" : ` (${entry.source})`}, which a repository can ship. ` +
        "Linking would bind your token to that host. Pass it explicitly instead " +
        `(\`golem team link ${key === "portal.url" ? "--portal-url" : "--issuer"} <url>\`), set it in your user settings ` +
        `(\`golem config set ${key} <url> --scope user\`) or via GOLEM_PORTAL_*, and remove it from the repository file.`,
    );
  }
}

/**
 * Apply `golem team link --portal-url / --issuer`. The flags are explicit user
 * input, so they replace the configured value AND its provenance; each is
 * validated https-or-loopback before anything is bound to it.
 */
export function applyLinkOverrides(
  settings: PortalSettings,
  provenance: Readonly<Record<string, { readonly layer: string; readonly source?: string }>>,
  flags: { readonly portalUrl?: string; readonly issuer?: string },
): {
  readonly settings: PortalSettings;
  readonly provenance: Record<string, { readonly layer: string; readonly source?: string }>;
} {
  const nextProvenance = { ...provenance };
  let nextSettings = settings;
  if (flags.portalUrl !== undefined) {
    const url = flags.portalUrl.trim().replace(/\/+$/, "");
    portalOrigin(url);
    nextSettings = { ...nextSettings, url };
    nextProvenance["portal.url"] = { layer: "override", source: "--portal-url" };
  }
  if (flags.issuer !== undefined) {
    const issuer = flags.issuer.trim().replace(/\/+$/, "");
    portalOrigin(issuer);
    nextSettings = { ...nextSettings, issuer };
    nextProvenance["portal.issuer"] = { layer: "override", source: "--issuer" };
  }
  return { settings: nextSettings, provenance: nextProvenance };
}
