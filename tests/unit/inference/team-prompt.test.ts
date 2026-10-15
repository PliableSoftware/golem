/**
 * DUST2.22 — the read side of `inference.team_prompt` (src/inference/team-prompt.ts).
 */

import { describe, expect, it } from "vitest";
import { TEAM_PROMPT_MAX_CHARS } from "../../../src/config/team-policy.js";
import {
  sanitizeTeamPrompt,
  TEAM_PROMPT_LABEL,
  withTeamPrompt,
} from "../../../src/inference/team-prompt.js";

describe("withTeamPrompt", () => {
  it("leaves the base byte-identical when there is no team prompt", () => {
    expect(withTeamPrompt("BASE", undefined)).toBe("BASE");
    expect(withTeamPrompt("BASE", "  \n ")).toBe("BASE");
  });

  it("APPENDS the team text after the base, under the label, never before or instead", () => {
    const out = withTeamPrompt("BASE", "Use tabs.");
    expect(out.startsWith("BASE\n\n")).toBe(true);
    expect(out.indexOf(TEAM_PROMPT_LABEL)).toBeGreaterThan(out.indexOf("BASE"));
    expect(out.endsWith("\nUse tabs.")).toBe(true);
  });

  it("states that the text is advisory and cannot change tools, permissions or redaction", () => {
    expect(TEAM_PROMPT_LABEL).toMatch(/advisory/);
    expect(TEAM_PROMPT_LABEL).toMatch(/tools, permissions or redaction/);
  });
});

describe("sanitizeTeamPrompt", () => {
  it("strips control characters but keeps newlines and tabs", () => {
    expect(sanitizeTeamPrompt("a\u0000b\u001b[31mc\u0085d e\nf\tg")).toBe("ab[31mcde\nf\tg");
  });

  it("caps the length even for a value that never passed the team policy (a local file)", () => {
    expect(sanitizeTeamPrompt("x".repeat(TEAM_PROMPT_MAX_CHARS + 500))).toHaveLength(
      TEAM_PROMPT_MAX_CHARS,
    );
  });
});
