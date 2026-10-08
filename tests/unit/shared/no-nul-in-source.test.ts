import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A literal NUL byte makes git and grep treat a file as binary, which hides
 * its code from every text search. Use the `\u0000` escape instead.
 */
function walk(dir: string, out: string[]): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs|json|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("source hygiene", () => {
  it("no src file contains a literal NUL byte", () => {
    const bad = walk("src", []).filter((f) => readFileSync(f).includes(0));
    expect(bad).toEqual([]);
  });
});
