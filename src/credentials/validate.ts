/**
 * R8.29 — ingestion validation for gateway API keys.
 *
 * Backends store and return a secret byte-exact, so the judgement about what a
 * gateway key may contain lives here, where a key ENTERS (piped stdin,
 * interactive prompt, `add --login`). Messages never echo the value.
 *
 * - Ingestion trims ALL leading/trailing whitespace (spaces, tabs, NBSP, Unicode
 *   spaces, BOM, any number of newlines): an API key never has any, which makes
 *   cmd's `echo KEY |` and `key\n\n` harmless. Interior spaces are kept.
 * - It then REFUSES a key with a control character (CR/LF/TAB/DEL/C1), U+FEFF, or a
 *   code point above U+00FF (zero-width space, curly quotes: undici rejects those
 *   one request at a time, even with --no-probe).
 * - Read-side compatibility trimming (older builds stored untrimmed) lives in store.ts.
 * - Known gap, no behaviour change: a stored secret that genuinely ends in `\r`
 *   comes back WITHOUT it from the file and macOS backends (`key\r\n` loses its whole
 *   terminator) but WITH it from single-key DPAPI. A CR is refused at ingestion, so
 *   only a hand-edited store is affected.
 */

/** C0 controls (incl. TAB, CR, LF), DEL, C1 controls, and U+FEFF. */
function isForbidden(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0xfeff;
}

/** Thrown for a malformed key. The message never contains the key. */
export class MalformedSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedSecretError";
  }
}

/** True when `secret` contains a control character or a BOM. */
export function hasForbiddenChar(secret: string): boolean {
  for (let i = 0; i < secret.length; i++) {
    if (isForbidden(secret.charCodeAt(i))) return true;
  }
  return false;
}

/** Throw {@link MalformedSecretError} (value not echoed) for a control character or BOM. */
export function assertUsableSecret(secret: string): void {
  if (hasForbiddenChar(secret) || hasNonLatin1(secret)) {
    throw new MalformedSecretError(
      "the key contains a control character, line break, byte-order mark or non-Latin-1 " +
        "character (zero-width space, curly quote, ...), which is never valid in an API key. " +
        "Re-copy it and try again.",
    );
  }
}

/** True when any UTF-16 unit is above U+00FF (undici rejects these in a header value, per request). */
export function hasNonLatin1(secret: string): boolean {
  for (let i = 0; i < secret.length; i++) {
    if (secret.charCodeAt(i) > 0xff) return true;
  }
  return false;
}

/**
 * Normalise a gateway API key entered by any route (piped, prompted, add --login).
 * An API key never legitimately has surrounding whitespace, so ALL of it is trimmed
 * (spaces, tabs, NBSP, Unicode spaces, BOM, any number of newlines — this makes
 * `echo KEY |` from cmd, `key\n\n` and a BOM-prefixed file harmless), then what is
 * left must pass {@link assertUsableSecret}. Interior spaces are kept.
 * Returns "" for empty or whitespace-only input.
 */
export function normalizeGatewayKey(raw: string): string {
  const s = raw.trim();
  assertUsableSecret(s);
  return s;
}

/** Alias kept for the piped-stdin call site: same normalisation. */
export const normalizePipedSecret = normalizeGatewayKey;
