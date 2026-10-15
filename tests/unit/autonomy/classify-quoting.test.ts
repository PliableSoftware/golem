/**
 * DUSTSEC.18 — quote and escape handling for write flags on `git` commands.
 * A quoted search term is data; a backslash-escaped flag is still the flag.
 */

import { describe, expect, it } from "vitest";
import { classifyBash } from "../../../src/autonomy/index.js";

describe("classifyBash: git quoting", () => {
  it.each([
    'git log --grep "--fix"',
    "git log --grep '--fix' --oneline",
    "git log --grep --fix",
    'git log -S "--write"',
    'git log --author "--apply" -n 5',
    'git log --grep="--fix"',
    'git log -- "--fix"',
  ])("search term is data: %s is read", (c) => {
    expect(classifyBash(c), c).toBe("read");
  });

  it.each([
    "git diff --outpu\\t=/tmp/x",
    "git diff --out\\put=/tmp/x",
    'git diff "--output=/tmp/x"',
    "git diff '--output' /tmp/x",
    'git diff --out"put=/tmp/x"',
    'git log --grep "x" --output=/tmp/x',
  ])("a real write flag is still a write: %s", (c) => {
    expect(classifyBash(c), c).toBe("write");
  });

  it.each([
    'npx biome check "--write" .',
    "biome check '--fix' src",
    "biome check --wri\\te .",
    'npm test -- "-u"',
    "npx vitest run '-u'",
    "npx tsc '--outDir' x",
  ])("quoted or escaped write flag on a build tool still writes: %s", (c) => {
    expect(classifyBash(c), c).toBe("write");
  });
});
