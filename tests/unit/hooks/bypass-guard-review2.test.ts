/**
 * DUSTSEC.18 — second review of the bypass guard: stdin-fed shells, shell flags
 * with values, `env -S`, escaped JSON keys, and heredoc bodies that are DATA.
 */

import { describe, expect, it } from "vitest";
import { bypassGuardReason } from "../../../src/hooks/bypass-guard.js";

const bash = (command: string) => bypassGuardReason("Bash", { command });

describe("bypass guard: text fed to a shell is a command", () => {
  it.each([
    "echo golem off | sh",
    "echo 'golem off' | bash",
    "printf '%s\\n' 'golem off' | sh",
    "printf 'golem off\\n' | sudo bash",
    "env -S 'golem off'",
    "env -S'golem off'",
    "env --split-string='golem off'",
    "env -i -S 'golem off'",
    "bash -o pipefail -c 'golem off'",
    "bash -O extglob -c 'golem off'",
    "sh +o nounset -c 'golem off'",
    "bash --norc -o errexit -c 'golem off'",
    "bash <<< 'golem off'",
    "sh <<< golem\\ off",
    "bash <<EOF\ngolem off\nEOF",
    "sh <<'EOF'\necho hi\ngolem off\nEOF",
    "sudo bash <<-EOF\n\tgolem off\nEOF",
  ])("denies %j", (command) => {
    expect(bash(command)).toBeDefined();
  });

  it.each([
    "echo golem off | cat",
    "echo hello | sh",
    "bash <<< 'echo hi'",
    "bash -o pipefail -c 'echo hi'",
    "env -S 'echo hi'",
  ])("still allows %j", (command) => {
    expect(bash(command)).toBeUndefined();
  });
});

describe("bypass guard: heredoc bodies are data unless they feed a shell", () => {
  it.each([
    "cat > notes.md <<'EOF'\nTo turn redaction off run:\ngolem off\nEOF",
    "cat > notes.md <<EOF\ngolem off\nEOF\ngolem status",
    'git commit -m "$(cat <<\'EOF\'\nfix(guard): deny golem off\n\ngolem off (bypass) is denied now; see "docs"\nEOF\n)"',
    "git commit -m \"$(cat <<'EOF'\nfeat: x\n\ngolem off\nGOLEM_PROXY_BYPASS_ALL=1 is documented (not set)\nEOF\n)\"",
    "cat <<-EOF > out.txt\n\tgolem off\n\tEOF\n",
    "tee n.md <<'EOF'\ngolem config set proxy.bypass_all true\nEOF",
  ])("allows %j", (command) => {
    expect(bash(command)).toBeUndefined();
  });

  it("still denies a real command after the heredoc ends", () => {
    expect(bash("cat > n.md <<'EOF'\nhello\nEOF\ngolem off")).toBeDefined();
  });

  it("still denies a command on the heredoc's own line", () => {
    expect(bash("golem off <<'EOF'\nx\nEOF")).toBeDefined();
    expect(bash("cat <<'EOF' && golem off\nx\nEOF")).toBeDefined();
  });
});

describe("bypass guard: settings JSON is judged parsed", () => {
  const write = (content: string) =>
    bypassGuardReason("Write", { file_path: "/p/.golem/config.json", content });

  it.each([
    '{"proxy":{"bypass_all":true}}',
    '{"proxy":{"bypass\\u005fall":true}}',
    '{"proxy":{"bypass\\u005fall":"yes"}}',
    '{"proxy":{"bypass_all":1}}',
  ])("denies %j", (content) => {
    expect(write(content)).toBeDefined();
  });

  it.each([
    '{"proxy":{"bypass_all":false}}',
    '{"proxy":{"bypass\\u005fall":false}}',
  ])("allows %j", (content) => {
    expect(write(content)).toBeUndefined();
  });

  it("still falls back to the raw check when the text is not JSON", () => {
    expect(write('{"proxy":{"bypass_all":true,}}')).toBeDefined();
  });
});
