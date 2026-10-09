/**
 * R8.29 — ingestion and read-time validation for API keys.
 *
 * The backends store and return a secret byte-exact, so they cannot tell a key
 * with a legitimate leading space from one with stray terminal junk. That
 * judgement lives here, at the two edges: when a key ENTERS (piped stdin,
 * interactive prompt) and when a stored key is READ for use. A key carrying a
 * control character or a BOM is refused with a message that never echoes the
 * value — such a key is never valid in an HTTP header, and sending it fails
 * every upstream request in a way that looks like a network fault.
 *
 * Decisions, in one place:
 * - Piped input loses ONE leading UTF-8 BOM and ONE trailing LF or CRLF, nothing
 *   else. `key\n\n`, `key\r\r\n` and an embedded CR/LF/control char are refused.
 * - Leading/trailing/interior SPACES are kept: harmless in a header value and
 *   possibly part of the secret. So cmd-style `KEY \r\n` yields `KEY ` (kept).
 * - Known gap, no behaviour change: a stored secret that genuinely ends in `\r`
 *   comes back WITHOUT it from the file and macOS backends (the stored form
 *   `key\r\n` loses its whole `\r\n` terminator) but WITH it from single-key
 *   DPAPI (PowerShell adds its own `\r\n`, so one `\r\n` strip leaves `key\r`).
 *   A CR is a control character, refused at ingestion and on read, so this only
 *   concerns a hand-edited store, which is already reported as malformed.
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
  if (hasForbiddenChar(secret)) {
    throw new MalformedSecretError(
      "the key contains a control character, line break or byte-order mark, which is never " +
        "valid in an API key. Re-copy it (no trailing blank lines) and try again.",
    );
  }
}

/**
 * Normalise a key read from piped stdin or a file: drop one leading BOM and one
 * trailing LF/CRLF, then {@link assertUsableSecret}. Returns "" for empty input.
 */
export function normalizePipedSecret(raw: string): string {
  const s = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).replace(/\r?\n$/, "");
  assertUsableSecret(s);
  return s;
}
