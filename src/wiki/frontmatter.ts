/**
 * Frontmatter parse/serialize for wiki pages (WS-W W2). Hand-rolled rather
 * than pulling in a YAML dependency: the schema is small and fixed
 * (`docs/wiki/WIKI.md`), and the repo avoids heavyweight deps in the default
 * install.
 */

import type { WikiFrontmatter, WikiPageType } from "../interfaces/index.js";

const FRONTMATTER_DELIMITER = "---";
const REQUIRED_KEYS = ["title", "type", "tags", "sources", "created", "updated"] as const;

export interface ParsedFrontmatter {
  readonly frontmatter: WikiFrontmatter;
  readonly body: string;
}

function parseListValue(value: string): readonly string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error(`expected a bracketed list, got: ${value}`);
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner === "") return [];
  return splitListItems(inner);
}

/**
 * Split a bracketed list's inner text on commas, keeping a comma that sits
 * inside a single- or double-quoted item (DUST3.8 D12). Inside double quotes a
 * backslash escapes the next character (`\\n` and `\\r` are a newline and a
 * carriage return); inside single quotes `''` is one quote. When text follows a
 * closing quote the item is not a quoted scalar, so the whole raw item is kept
 * rather than dropping the tail. An unquoted item is taken verbatim up to the
 * next comma, so every page written before quoting existed parses as before.
 */
function splitListItems(inner: string): string[] {
  const items: string[] = [];
  let i = 0;
  while (i <= inner.length) {
    while (inner[i] === " " || inner[i] === "\t") i += 1;
    const start = i;
    const quote = inner[i] === '"' || inner[i] === "'" ? inner[i] : undefined;
    let item = "";
    if (quote !== undefined) {
      i += 1;
      while (i < inner.length) {
        const ch = inner[i];
        if (quote === '"' && ch === "\\" && i + 1 < inner.length) {
          i += 1;
          const escaped = inner[i];
          item += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped;
        } else if (quote === "'" && ch === "'" && inner[i + 1] === "'") {
          item += "'";
          i += 1;
        } else if (ch === quote) {
          break;
        } else {
          item += ch;
        }
        i += 1;
      }
      i += 1; // closing quote
      const next = inner.indexOf(",", i);
      const end = next === -1 ? inner.length : next;
      if (inner.slice(i, end).trim() !== "") item = inner.slice(start, end).trim();
      i = end;
    } else {
      const next = inner.indexOf(",", i);
      const end = next === -1 ? inner.length : next;
      item = inner.slice(i, end).trim();
      i = end;
    }
    items.push(item);
    i += 1; // the comma
  }
  return items;
}

/** Quote an item only when a bare one would not parse back to itself. */
function serializeListItem(item: string): string {
  const needsQuotes = /[,\n\r]/.test(item) || /^[\s"']|\s$/.test(item);
  if (!needsQuotes) return item;
  const escaped = item
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

/**
 * The optional `aliases` value: a bracketed list, or one bare scalar. Lenient by
 * design — a malformed value yields no aliases rather than making the page
 * unreadable. Items are trimmed and blanks dropped; undefined when none remain.
 */
function parseAliases(value: string): readonly string[] | undefined {
  let items: readonly string[];
  if (value.trim().startsWith("[")) {
    try {
      items = parseListValue(value);
    } catch {
      return undefined;
    }
  } else {
    items = [value];
  }
  const cleaned = items.map((item) => item.trim()).filter((item) => item !== "");
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Parse `---`-delimited frontmatter + body from a raw wiki page file.
 * Delimiter/blank-line checks trim each line so CRLF pages (a checkout
 * without this repo's `eol=lf` attribute) parse the same as LF pages.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new Error("wiki page is missing the leading --- frontmatter delimiter");
  }

  const closingIndex = lines.findIndex(
    (line, index) => index >= 1 && line.trim() === FRONTMATTER_DELIMITER,
  );
  if (closingIndex === -1) {
    throw new Error("wiki page is missing the closing --- frontmatter delimiter");
  }

  const values: Record<string, string | readonly string[]> = {};
  for (const line of lines.slice(1, closingIndex)) {
    if (line.trim() === "") continue;
    const colonAt = line.indexOf(":");
    if (colonAt === -1) throw new Error(`malformed frontmatter line (no ':'): ${line}`);
    const key = line.slice(0, colonAt).trim();
    const value = line.slice(colonAt + 1).trim();
    values[key] = key === "tags" || key === "sources" ? parseListValue(value) : value;
  }

  for (const key of REQUIRED_KEYS) {
    if (values[key] === undefined) throw new Error(`wiki page frontmatter is missing "${key}"`);
  }

  const aliases = typeof values.aliases === "string" ? parseAliases(values.aliases) : undefined;
  const frontmatter: WikiFrontmatter = {
    title: values.title as string,
    type: values.type as WikiPageType,
    tags: values.tags as readonly string[],
    sources: values.sources as readonly string[],
    created: values.created as string,
    updated: values.updated as string,
    ...(aliases !== undefined ? { aliases } : {}),
  };

  let bodyStart = closingIndex + 1;
  if (bodyStart < lines.length && lines[bodyStart]?.trim() === "") bodyStart += 1;
  const body = lines.slice(bodyStart).join("\n");

  return { frontmatter, body };
}

function canonicalLines(fm: WikiFrontmatter): Record<(typeof REQUIRED_KEYS)[number], string> {
  return {
    title: `title: ${fm.title}`,
    type: `type: ${fm.type}`,
    tags: `tags: [${fm.tags.map(serializeListItem).join(", ")}]`,
    sources: `sources: [${fm.sources.map(serializeListItem).join(", ")}]`,
    created: `created: ${fm.created}`,
    updated: `updated: ${fm.updated}`,
  };
}

/**
 * Does this original line still say what `fm` says for its key? Compared by
 * parsing the line, so `["a", b]` and `[a, b]` are the same value and the
 * author's quoting survives.
 */
function lineHolds(key: string, line: string, fm: WikiFrontmatter): boolean {
  const value = line.slice(line.indexOf(":") + 1).trim();
  try {
    if (key === "tags" || key === "sources") {
      const want = fm[key];
      const got = parseListValue(value);
      return got.length === want.length && got.every((item, i) => item === want[i]);
    }
    return value === fm[key as "title" | "type" | "created" | "updated"];
  } catch {
    return false;
  }
}

/**
 * Serialize frontmatter back to the `---`-delimited block (no trailing newline).
 *
 * With `original` (the block as it was read), a line whose value is unchanged is
 * kept exactly as written, and keys keep the original's order, so rewriting a
 * page does not churn quoting or ordering the author chose. Only lines whose
 * value changed are regenerated; keys the original lacks follow, canonically. Lines for keys the schema does not
 * know are kept verbatim rather than dropped.
 */
export function serializeFrontmatter(fm: WikiFrontmatter, original?: string): string {
  const canonical = canonicalLines(fm);
  const out: string[] = [];
  const seen = new Set<string>();
  if (original !== undefined) {
    const lines = original.split("\n").map((l) => l.replace(/\r$/, ""));
    for (const line of lines) {
      if (line.trim() === FRONTMATTER_DELIMITER || line.trim() === "") continue;
      const key = line.slice(0, Math.max(line.indexOf(":"), 0)).trim();
      if (!(REQUIRED_KEYS as readonly string[]).includes(key)) {
        out.push(line); // a key the schema does not know: the author's, so kept verbatim
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(lineHolds(key, line, fm) ? line : canonical[key as keyof typeof canonical]);
    }
  }
  for (const key of REQUIRED_KEYS) if (!seen.has(key)) out.push(canonical[key]);
  return [FRONTMATTER_DELIMITER, ...out, FRONTMATTER_DELIMITER].join("\n");
}

/** The leading `---` block of a raw page, as written (for {@link serializeFrontmatter}). */
export function frontmatterBlock(raw: string): string {
  const lines = raw.split("\n");
  const end = lines.findIndex((l, i) => i >= 1 && l.trim() === FRONTMATTER_DELIMITER);
  return lines.slice(0, end + 1).join("\n");
}

const WIKILINK_PATTERN = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

/** Titles referenced by `[[Title]]` / `[[Title|Alias]]` / `[[Title#Section]]`, in order, duplicates kept. */
export function extractWikilinks(body: string): string[] {
  return [...body.matchAll(WIKILINK_PATTERN)].map((match) => match[1]?.trim() ?? "");
}
