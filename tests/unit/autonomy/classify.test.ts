/**
 * R5.4 — action classifier (ADR-0002 conservative allow-list).
 */

import { describe, expect, it } from "vitest";
import { classifyAction, classifyBash, decideGate } from "../../../src/autonomy/index.js";

describe("classifyAction (tools)", () => {
  it("classifies read-only tools as read", () => {
    for (const t of [
      "Read",
      "Grep",
      "Glob",
      "WebFetch",
      "mcp__golem__search",
      "mcp__golem__snooze",
    ]) {
      expect(classifyAction(t, {})).toBe("read");
    }
  });
  it("classifies file/local-write tools as write", () => {
    for (const t of ["Edit", "Write", "NotebookEdit", "mcp__golem__coder"]) {
      expect(classifyAction(t, {})).toBe("write");
    }
  });
  it("classifies wiki_upsert (external-ish) as outward", () => {
    expect(classifyAction("mcp__golem__wiki_upsert", {})).toBe("outward");
  });
  it("gates the retired `level` tool like any unrecognized tool (R11.1)", () => {
    // The tool went with the slider. Nothing can reach redaction through a dial
    // now (ADR-0004), so there is no level to classify — and the fall-through is
    // `unknown` (gated), stricter than the `write` a level call used to earn.
    expect(classifyAction("mcp__golem__level", { level: 1 })).toBe("unknown");
    expect(classifyAction("mcp__golem__level", { level: 0 })).toBe("unknown");
  });
  it("treats an unrecognized tool as unknown (fail-closed)", () => {
    expect(classifyAction("SomeNewTool", {})).toBe("unknown");
  });
  it("treats Bash with no command as unknown", () => {
    expect(classifyAction("Bash", {})).toBe("unknown");
    expect(classifyAction("Bash", { command: "npm test" })).toBe("read");
  });
});

describe("classifyBash", () => {
  it("recognizes safe read commands", () => {
    for (const c of [
      "ls -la",
      "git status",
      "git diff HEAD",
      "npm test",
      "npx vitest run",
      "cat x",
    ]) {
      expect(classifyBash(c)).toBe("read");
    }
  });
  it("flags destructive commands", () => {
    for (const c of ["rm -rf build", "git reset --hard HEAD~1", "dd if=/dev/zero of=x"]) {
      expect(classifyBash(c)).toBe("destructive");
    }
  });
  it("flags the change ledger's write half as destructive (R8.9)", () => {
    // ADR-0002's never-auto set: no autonomy level may approve these for the
    // agent, even though `Bash(golem:*)` is allow-listed in this repo.
    for (const c of [
      "golem checkpoint restore latest",
      "golem checkpoint undo 20260731T120000Z",
      "golem cp restore --yes",
      "golem checkpoint drop 20260731T120000Z --yes",
      "golem checkpoint prune --keep 0",
    ]) {
      expect(classifyBash(c)).toBe("destructive");
    }
  });
  it("leaves the ledger's read/snapshot half unescalated (R8.9)", () => {
    // Taking a checkpoint writes only a shadow ref — it must stay cheap, or the
    // model will not do it. Unknown (native flow governs), never destructive.
    for (const c of ["golem checkpoint create --note x", "golem checkpoint list"]) {
      expect(classifyBash(c)).toBe("unknown");
    }
  });
  it("flags outward commands", () => {
    for (const c of [
      "git push origin main",
      "gh pr create",
      "npm publish",
      "curl -X POST https://x",
    ]) {
      expect(classifyBash(c)).toBe("outward");
    }
  });
  it("escalates: outward/destructive win over a safe-looking prefix", () => {
    // Leads with a safe token but also pushes — must NOT be read.
    expect(classifyBash("git status && git push")).toBe("outward");
  });
  it("treats an unrecognized command as unknown, not safe", () => {
    expect(classifyBash("./some-script.sh --yolo")).toBe("unknown");
  });
  it("never classifies a composed command as read (redirection/chaining/substitution)", () => {
    for (const c of [
      "echo x > ~/.bashrc", // redirection truncates a file behind a safe token
      "cat a > b",
      "ls -la; ./arbitrary.sh", // a second command rides a safe prefix
      "git log | head", // pipes gated too — conservative by design
      "echo `whoami`",
      "echo $(rm -rf x)",
      "cat x && ./arbitrary.sh",
    ]) {
      expect(classifyBash(c)).not.toBe("read");
    }
  });
  it("still lets destructive/outward win over composition (escalate-only)", () => {
    expect(classifyBash("ls; rm -rf build")).toBe("destructive");
    expect(classifyBash("git status && git push")).toBe("outward");
  });
  it("does not flag danger tokens that appear only inside quoted literals (R8.21)", () => {
    // A quoted filename argument is data, not a command — the danger patterns
    // must not fire on it.
    expect(classifyBash("ls 'git push.sh'")).not.toBe("outward");
    expect(classifyBash("cat 'rm -rf notes.txt'")).not.toBe("destructive");
    expect(classifyBash('grep "git reset --hard" log.txt')).not.toBe("destructive");
    // An unquoted danger token still escalates even with quotes elsewhere.
    expect(classifyBash('echo "safe" && git push origin main')).toBe("outward");
    expect(classifyBash("rm -rf 'quoted arg'")).toBe("destructive");
  });
});

describe("DUSTSEC.5: newline-chained commands and over-approved reads", () => {
  const PAYLOAD = "node -e \"require('fs').rmSync('x',{recursive:true})\"";

  it("never classifies a newline/CR-chained command as read, and assisted does not allow it", () => {
    for (const sep of ["\n", "\r", "\r\n", "\n\n", " \n "]) {
      for (const lead of ["ls", "ls -la", "cat x", "echo hi", "git status", "pwd", "npm test"]) {
        const cmd = `${lead}${sep}${PAYLOAD}`;
        expect(classifyBash(cmd), JSON.stringify(cmd)).not.toBe("read");
        expect(classifyAction("Bash", { command: cmd })).not.toBe("read");
        expect(decideGate("assisted", classifyAction("Bash", { command: cmd })).emit).not.toBe(
          "allow",
        );
      }
    }
  });
  it("a newline-chained danger token still escalates", () => {
    expect(classifyBash("ls\nrm -rf build")).toBe("destructive");
    expect(classifyBash("ls\r\ngit push origin main")).toBe("outward");
    expect(classifyBash("rtk ls\nnode -e x")).not.toBe("read");
  });
  it("a trailing newline alone does not change a plain read", () => {
    expect(classifyBash("ls -la\n")).toBe("read");
  });

  it("git branch deletion is destructive; creation/rename is not read", () => {
    for (const c of [
      "git branch -D main",
      "git branch -d feature",
      "git branch --delete feature",
      "git branch -a -D main",
      "git branch -vD main",
    ]) {
      expect(classifyBash(c), c).toBe("destructive");
    }
    for (const c of [
      "git branch newbranch",
      "git branch -m old new",
      "git branch -f main HEAD~3",
    ]) {
      expect(classifyBash(c), c).not.toBe("read");
    }
    for (const c of [
      "git branch",
      "git branch -a",
      "git branch -vv",
      "git branch --show-current",
    ]) {
      expect(classifyBash(c), c).toBe("read");
    }
  });
  it("linter autofix flags are never read", () => {
    for (const c of [
      "npx biome check --write .",
      "biome check --fix src",
      "biome lint --apply-unsafe",
      "npm run lint -- --fix",
      "npx vitest run -u",
      "npx vitest run --update",
      "tsc --outDir x",
    ]) {
      expect(classifyBash(c), c).not.toBe("read");
    }
    for (const c of ["npx biome check .", "npx tsc --noEmit", "npm run lint", "npx vitest run"]) {
      expect(classifyBash(c), c).toBe("read");
    }
  });
  it("git diff/log/show --output writes a file, so it is not read", () => {
    for (const c of [
      "git diff --output=/tmp/x",
      "git diff --output /tmp/x",
      "git log --output=x",
      "git show --output=x HEAD",
    ]) {
      expect(classifyBash(c), c).not.toBe("read");
    }
  });
  it("quoted literals of write flags are data, not flags", () => {
    expect(classifyBash("cat '--write'")).toBe("read");
  });
  it("a quoted write flag on a build tool still writes (review finding 4)", () => {
    for (const c of [
      'npx biome check "--write" .',
      "biome check '--fix' src",
      'npx biome check --wri"te" .',
      "npm test -- -u",
      "npm run test -- -u",
      'npm test -- "-u"',
      "npx vitest run '-u'",
    ]) {
      expect(classifyBash(c), c).toBe("write");
    }
  });
  it("git branch listing forms are read (review finding 5)", () => {
    for (const c of [
      "git branch --contains abc1234",
      "git branch -a --contains HEAD~3",
      "git branch --no-contains v1.2.0",
      "git branch --merged main",
      "git branch --merged",
      "git branch --sort=-committerdate",
      "git branch --sort committerdate",
      "git branch --points-at HEAD",
      "git branch -r --sort=refname",
    ]) {
      expect(classifyBash(c), c).toBe("read");
    }
    for (const c of [
      "git branch --contains abc1234 -D main",
      "git branch --merged main -d old",
      "git branch --sort=x --delete old",
      "git branch --contains abc1234 newbranch",
    ]) {
      expect(classifyBash(c), c).not.toBe("read");
    }
    expect(classifyBash("git branch --contains abc1234 -D main")).toBe("destructive");
  });
});
