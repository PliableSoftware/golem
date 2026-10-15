/**
 * DUSTSEC.7 (R5) — the exported rule table is not a handle on the live one.
 * Each probe tries to change what the NEXT redaction call does; before the fix
 * the exported array and its rule objects were mutable at runtime.
 */

import { describe, expect, it } from "vitest";
import { redactStandaloneText } from "../../../src/pipeline/redaction.js";
import {
  activeRedactionRules,
  REDACTION_RULES,
  type RedactionRule,
} from "../../../src/pipeline/redaction-rules.js";

// Assembled so no scanner flags this file; matches the aws-key shape (AKIA + 16).
const AWS = `AKIA${"IOSFODNN7EXAMPLE"}`;
// Taken before any probe runs: the export is a copy, so probes may scribble on it.
const PRISTINE = REDACTION_RULES.map((r) => [r.id, r.pattern.source, r.pattern.flags]);

function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    // a frozen target throwing is fine; the assertion is on redaction below
  }
}

describe("REDACTION_RULES cannot be used to change redaction", () => {
  const mutable = REDACTION_RULES as unknown as RedactionRule[];

  it("is frozen, array and rule objects", () => {
    expect(Object.isFrozen(REDACTION_RULES)).toBe(true);
    for (const rule of REDACTION_RULES) expect(Object.isFrozen(rule)).toBe(true);
  });

  it("splice/shift/push/length on the export leave redaction intact", () => {
    attempt(() => mutable.splice(0, mutable.length));
    attempt(() => mutable.shift());
    attempt(() => mutable.push({ id: "x/y", description: "d", pattern: /z/g }));
    attempt(() => {
      (mutable as { length: number }).length = 0;
    });
    expect(redactStandaloneText(`key ${AWS}`)).not.toContain(AWS);
    expect(activeRedactionRules().length).toBeGreaterThan(10);
  });

  it("replacing a rule's pattern or id on the export changes nothing", () => {
    const aws = REDACTION_RULES.find((r) => r.id === "aws-key") as { pattern: RegExp; id: string };
    attempt(() => {
      aws.pattern = /never-matches/g;
    });
    attempt(() => {
      aws.id = "renamed";
    });
    expect(redactStandaloneText(AWS)).toContain("[REDACTED:aws-key:");
  });

  it("re.compile() on an exported pattern does not rewrite the live rule", () => {
    const aws = REDACTION_RULES.find((r) => r.id === "aws-key");
    attempt(() => aws?.pattern.compile("never-matches", "g"));
    expect(redactStandaloneText(AWS)).toContain("[REDACTED:aws-key:");
  });

  it("the live active table order and content are the pristine built-ins", () => {
    const live = activeRedactionRules();
    expect(live.map((r) => [r.id, r.pattern.source, r.pattern.flags])).toEqual(PRISTINE);
  });
});
