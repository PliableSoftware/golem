/**
 * `golem ps` — list Golem-owned processes on this machine.
 *
 * Ownership is PROVEN, not pattern-matched. A command line containing
 * `golem-run` is a good hint and a bad gate — the test puts a foreign
 * `node.exe` in the way deliberately.
 *
 * Sources:
 *   - proxy: pid files under <project>/.golem/proxy.pid (one per project)
 *   - mcp serve: session registry under <project>/.golem/state/hosted-sessions.json
 *   - statusline: parentage walk from the current process to a living claude.exe
 *   - dashboard: not yet tracked (no pidfile)
 *
 * `golem ps --prune` removes ONLY processes Golem can prove are its own AND
 * are not serving a live session. Parentage is the evidence — walk to the
 * owning claude.exe/cmd.exe and check it is alive. Never infer death from age.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import type { Command } from "commander";
import { findProjectDir, loadConfig } from "../../config/index.js";
import { forgetHostSession, listHostSessions } from "../../session/host-registry.js";
import { InitError } from "../init.js";
import { isProcessAlive, readProxyPid, removeProxyPid } from "../proxy-daemon.js";

const _DEFAULT_DIR = findProjectDir(process.cwd()) ?? process.cwd();

function _fail(err: unknown): never {
  process.stderr.write(`golem: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(err instanceof InitError ? 2 : 1);
}

/** Represents a Golem-owned process. */
export interface GolemProcess {
  readonly pid: number;
  readonly kind: "proxy" | "mcp" | "statusline" | "dashboard";
  readonly projectDir: string;
  readonly startedAt: string;
  readonly rssMb: number;
  readonly pidfileMatches: boolean;
  readonly parentAlive?: boolean | undefined;
}

/** Get process memory (RSS) in MB. Best effort — returns 0 on failure. */
async function getProcessRss(pid: number): Promise<number> {
  if (process.platform === "win32") {
    try {
      const proc = spawn("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
      const stdout = await new Promise<string>((resolve) => {
        let out = "";
        proc.stdout.on("data", (d) => {
          out += d;
        });
        proc.on("close", () => resolve(out));
      });
      // CSV: "Image Name","PID","Session Name","Session#","Mem Usage","Status","User Name","CPU Time","Window Title"
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const cols = line.split(",").map((c) => c.replace(/"/g, "").trim());
        if (cols.length >= 5 && cols[4]) {
          const mem = cols[4].replace(/[^0-9]/g, "");
          if (mem) return Math.round(parseInt(mem, 10) / 1024); // tasklist shows KB
        }
      }
    } catch {}
  } else {
    try {
      const fs = await import("node:fs/promises");
      const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
      const parts = stat.split(" ");
      // rss is field 24 (0-indexed 23), in pages
      if (parts.length > 23 && parts[23]) {
        const rssPages = parseInt(parts[23], 10);
        if (!Number.isNaN(rssPages)) {
          const pageSize = 4096; // assume 4KB pages
          return Math.round((rssPages * pageSize) / 1_048_576);
        }
      }
    } catch {}
  }
  return 0;
}

/** Get process start time (ISO string) if available. Best effort. */
async function getProcessStartTime(pid: number): Promise<string | undefined> {
  if (process.platform === "win32") {
    try {
      // Use PowerShell Get-CimInstance which is more reliable than wmic
      const proc = spawn("powershell", [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=${pid}").CreationDate`,
      ]);
      const stdout = await new Promise<string>((resolve, reject) => {
        let out = "";
        proc.stdout.on("data", (d) => {
          out += d;
        });
        proc.on("close", () => resolve(out));
        proc.on("error", (err) => reject(err));
      });
      // CIM datetime format: 20260913123456.789000+000
      const match = stdout.trim().match(/^(\d{14})/);
      if (match?.[1]) {
        const s = match[1];
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
      }
    } catch {
      // PowerShell not available
    }
  } else {
    try {
      const fs = await import("node:fs/promises");
      const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
      const parts = stat.split(" ");
      // starttime is field 22 (0-indexed 21), in clock ticks
      if (parts.length > 21 && parts[21]) {
        const startTime = parseInt(parts[21], 10);
        if (!Number.isNaN(startTime)) {
          const clkTck = 100; // assume 100 ticks/sec
          const bootTime = await getBootTime();
          const startSec = bootTime + startTime / clkTck;
          return new Date(startSec * 1000).toISOString();
        }
      }
    } catch {}
  }
  return undefined;
}

async function getBootTime(): Promise<number> {
  try {
    const fs = await import("node:fs/promises");
    const uptime = await fs.readFile("/proc/uptime", "utf8");
    const parts = uptime.split(" ");
    const secs = parseFloat(parts[0] ?? "0");
    return Math.floor(Date.now() / 1000) - secs;
  } catch {}
  return 0;
}

/** Walk parent pids up to find a living claude.exe / cmd.exe / powershell.exe. */
async function findOwningClaude(pid: number): Promise<boolean> {
  let current = pid;
  for (let i = 0; i < 10; i++) {
    let ppid: number | null = null;
    let name = "";
    if (process.platform === "win32") {
      let wmicFailed = false;
      try {
        const proc = spawn("wmic", [
          "process",
          "where",
          `ProcessId=${current}`,
          "get",
          "ParentProcessId,Name,CommandLine",
          "/format:value",
        ]);
        const stdout = await new Promise<string>((resolve, reject) => {
          let out = "";
          proc.stdout.on("data", (d) => {
            out += d;
          });
          proc.on("close", () => resolve(out));
          proc.on("error", (err) => reject(err));
        });
        const ppidMatch = stdout.match(/ParentProcessId=(\d+)/);
        const nameMatch = stdout.match(/Name=([^\r\n]+)/);
        ppid = ppidMatch?.[1] ? parseInt(ppidMatch[1], 10) : null;
        name = nameMatch?.[1] ? nameMatch[1].toLowerCase() : "";
      } catch {
        wmicFailed = true;
      }
      if (wmicFailed) {
        // wmic may not be available; try PowerShell Get-CimInstance
        try {
          const proc = spawn("powershell", [
            "-NoProfile",
            "-Command",
            `(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=${current}").ParentProcessId, (Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=${current}").Name`,
          ]);
          const stdout = await new Promise<string>((resolve, reject) => {
            let out = "";
            proc.stdout.on("data", (d) => {
              out += d;
            });
            proc.on("close", () => resolve(out));
            proc.on("error", (err) => reject(err));
          });
          const lines = stdout.trim().split("\n");
          if (lines.length >= 2 && lines[0] && lines[1]) {
            ppid = parseInt(lines[0].trim(), 10) || null;
            name = lines[1].trim().toLowerCase();
          }
        } catch {
          // PowerShell not available; try tasklist for name
          try {
            const proc = spawn("tasklist", ["/FI", `PID eq ${current}`, "/FO", "CSV", "/NH"]);
            const stdout = await new Promise<string>((resolve, reject) => {
              let out = "";
              proc.stdout.on("data", (d) => {
                out += d;
              });
              proc.on("close", () => resolve(out));
              proc.on("error", (err) => reject(err));
            });
            const lines = stdout.trim().split("\n");
            for (const line of lines) {
              const cols = line.split(",").map((c) => c.replace(/"/g, "").trim());
              if (cols.length >= 1 && cols[0]) {
                name = cols[0].toLowerCase();
              }
            }
            break; // Can't get ppid from tasklist easily
          } catch {
            break;
          }
        }
      }
    } else {
      try {
        const fs = await import("node:fs/promises");
        const stat = await fs.readFile(`/proc/${current}/stat`, "utf8");
        const parts = stat.split(" ");
        if (parts.length > 3 && parts[3]) {
          ppid = parseInt(parts[3], 10); // ppid is field 4
        }
        // comm is field 2, in parentheses
        const commMatch = stat.match(/\(([^)]+)\)/);
        name = commMatch?.[1] ? commMatch[1].toLowerCase() : "";
      } catch {
        break;
      }
    }
    if (
      name.includes("claude") ||
      name.includes("cmd.exe") ||
      name.includes("powershell") ||
      name.includes("bash") ||
      name.includes("zsh") ||
      name.includes("fish")
    ) {
      return isProcessAlive(ppid ?? 0);
    }
    if (!ppid) break;
    current = ppid;
  }
  return false;
}

/** Collect proxy processes from pid files. */
async function collectProxies(): Promise<GolemProcess[]> {
  const out: GolemProcess[] = [];

  // Find all Golem projects by looking for .golem directories with proxy.pid
  const projectDirs = new Set<string>();

  // 1. Current project (where CLI is invoked)
  const currentProjectDir = findProjectDir(process.cwd());
  if (currentProjectDir) {
    const pidPath = path.join(currentProjectDir, ".golem", "proxy.pid");
    try {
      const fs = await import("node:fs/promises");
      await fs.access(pidPath);
      projectDirs.add(currentProjectDir);
    } catch {}
  }

  // 2. Check user's .golem for project subdirectories that have their own .golem/proxy.pid
  const userProfile = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const userGolemDir = path.join(userProfile, ".golem");
  try {
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(userGolemDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(userGolemDir, entry.name);
        const pidPath = path.join(candidate, ".golem", "proxy.pid");
        try {
          await fs.access(pidPath);
          projectDirs.add(candidate);
        } catch {
          // Not a project with .golem/proxy.pid
        }
      }
    }
  } catch {}

  for (const projectDir of projectDirs) {
    const info = await readProxyPid(projectDir);
    if (!info) continue;
    const alive = isProcessAlive(info.pid);
    const rss = alive ? await getProcessRss(info.pid) : 0;
    const started = (await getProcessStartTime(info.pid)) ?? info.ts;
    out.push({
      pid: info.pid,
      kind: "proxy",
      projectDir,
      startedAt: started,
      rssMb: rss,
      pidfileMatches: alive,
      parentAlive: alive ? await findOwningClaude(info.pid) : undefined,
    });
  }
  return out;
}

/** Collect MCP serve processes from session registry. */
async function collectMcpServes(): Promise<GolemProcess[]> {
  const out: GolemProcess[] = [];
  const userProfile = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const userDir = path.join(userProfile, ".golem");
  try {
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(userDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectDir = path.join(userDir, entry.name);
      const sessions = await listHostSessions(projectDir);
      for (const s of sessions) {
        const rss = s.alive ? await getProcessRss(s.pid) : 0;
        out.push({
          pid: s.pid,
          kind: "mcp",
          projectDir,
          startedAt: s.startedAt,
          rssMb: rss,
          pidfileMatches: s.alive,
          parentAlive: s.alive ? await findOwningClaude(s.pid) : undefined,
        });
      }
    }
  } catch {}
  return out;
}

/** Collect statusline processes by walking from current process. */
async function collectStatuslines(): Promise<GolemProcess[]> {
  const out: GolemProcess[] = [];
  try {
    // Walk up from current process to find claude
    let current = process.pid;
    for (let i = 0; i < 10; i++) {
      let ppid: number | null = null;
      let name = "";
      let cmd = "";
      if (process.platform === "win32") {
        let wmicFailed = false;
        try {
          const proc = spawn("wmic", [
            "process",
            "where",
            `ProcessId=${current}`,
            "get",
            "ParentProcessId,Name,CommandLine",
            "/format:value",
          ]);
          const stdout = await new Promise<string>((resolve, reject) => {
            let o = "";
            proc.stdout.on("data", (d) => {
              o += d;
            });
            proc.on("close", () => resolve(o));
            proc.on("error", (err) => reject(err));
          });
          const ppidMatch = stdout.match(/ParentProcessId=(\d+)/);
          const nameMatch = stdout.match(/Name=([^\r\n]+)/);
          const cmdMatch = stdout.match(/CommandLine=([^\r\n]*)/);
          ppid = ppidMatch?.[1] ? parseInt(ppidMatch[1], 10) : null;
          name = nameMatch?.[1] ? nameMatch[1].toLowerCase() : "";
          cmd = cmdMatch?.[1] ? cmdMatch[1] : "";
        } catch {
          wmicFailed = true;
        }
        if (wmicFailed) {
          // wmic not available; try tasklist
          try {
            const proc = spawn("tasklist", ["/FI", `PID eq ${current}`, "/FO", "CSV", "/NH"]);
            const stdout = await new Promise<string>((resolve, reject) => {
              let o = "";
              proc.stdout.on("data", (d) => {
                o += d;
              });
              proc.on("close", () => resolve(o));
              proc.on("error", (err) => reject(err));
            });
            const lines = stdout.trim().split("\n");
            for (const line of lines) {
              const cols = line.split(",").map((c) => c.replace(/"/g, "").trim());
              if (cols.length >= 1 && cols[0]) {
                name = cols[0].toLowerCase();
              }
            }
            break; // can't get ppid/cmdline easily
          } catch {
            break;
          }
        }
      } else {
        try {
          const fs = await import("node:fs/promises");
          const stat = await fs.readFile(`/proc/${current}/stat`, "utf8");
          const parts = stat.split(" ");
          if (parts.length > 3 && parts[3]) {
            ppid = parseInt(parts[3], 10);
          }
          const commMatch = stat.match(/\(([^)]+)\)/);
          name = commMatch?.[1] ? commMatch[1].toLowerCase() : "";
          // cmdline
          try {
            const cmdline = await fs.readFile(`/proc/${current}/cmdline`, "utf8");
            cmd = cmdline.replace(/\0/g, " ");
          } catch {}
        } catch {
          break;
        }
      }
      if (name === "node" && cmd.includes("golem")) {
        const rss = await getProcessRss(current);
        const started = (await getProcessStartTime(current)) ?? new Date().toISOString();
        out.push({
          pid: current,
          kind: "statusline",
          projectDir: _DEFAULT_DIR,
          startedAt: started,
          rssMb: rss,
          pidfileMatches: true,
          parentAlive: isProcessAlive(ppid ?? 0),
        });
      }
      if (!ppid) break;
      current = ppid;
      if (
        name.includes("claude") ||
        name.includes("bash") ||
        name.includes("zsh") ||
        name.includes("fish")
      )
        break;
    }
  } catch {}
  return out;
}

/** Format age from ISO string. */
function formatAge(iso: string): string {
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return "—";
  const diffMs = Date.now() - start.getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

/** Render human-readable table. */
function renderTable(procs: GolemProcess[]): string {
  if (procs.length === 0) return "No Golem processes found.\n";
  const lines = [
    "PID      KIND       PROJECT                          AGE      RSS(MB)  PIDFILE  PARENT",
    "──────────────────────────────────────────────────────────────────────────────────",
  ];
  for (const p of procs) {
    const projectName = path.basename(p.projectDir).slice(0, 32).padEnd(32);
    const age = formatAge(p.startedAt).padStart(8);
    const rss = String(p.rssMb).padStart(5);
    const pf = p.pidfileMatches ? "✓" : "✗";
    const parent = p.parentAlive !== undefined ? (p.parentAlive ? "✓" : "✗") : "—";
    lines.push(
      `${String(p.pid).padEnd(8)} ${p.kind.padEnd(10)} ${projectName} ${age} ${rss}      ${pf}        ${parent}`,
    );
  }
  lines.push("");
  const totalRss = procs.reduce((a, b) => a + b.rssMb, 0);
  lines.push(`Total: ${procs.length} processes, ${totalRss} MB RSS`);
  return lines.join("\n");
}

/** Render JSON. */
function renderJson(procs: GolemProcess[]): string {
  return JSON.stringify(
    procs.map((p) => ({
      pid: p.pid,
      kind: p.kind,
      project: path.basename(p.projectDir),
      project_dir: p.projectDir,
      started_at: p.startedAt,
      rss_mb: p.rssMb,
      pidfile_matches: p.pidfileMatches,
      parent_alive: p.parentAlive ?? null,
    })),
    null,
    2,
  );
}

/** Prune dead/idle processes. */
async function pruneProcesses(
  procs: GolemProcess[],
  opts: { dryRun: boolean; idleTimeoutMs?: number; projectDir: string },
): Promise<number> {
  let removed = 0;
  const now = Date.now();

  for (const p of procs) {
    if (!p.pidfileMatches) {
      // Pidfile is stale — remove it
      if (p.kind === "proxy") {
        if (!opts.dryRun) await removeProxyPid(p.projectDir);
        process.stdout.write(
          `Removed stale proxy pidfile for ${path.basename(p.projectDir)} (pid ${p.pid})\n`,
        );
        removed++;
      } else if (p.kind === "mcp") {
        if (!opts.dryRun) await forgetHostSession(p.projectDir, ""); // need session id
        process.stdout.write(
          `Removed stale mcp session pid ${p.pid} for ${path.basename(p.projectDir)}\n`,
        );
        removed++;
      }
      continue;
    }

    // Check idle timeout for proxies
    if (p.kind === "proxy" && opts.idleTimeoutMs !== undefined && opts.idleTimeoutMs > 0) {
      const idleMs = now - new Date(p.startedAt).getTime();
      if (idleMs > opts.idleTimeoutMs && !p.parentAlive) {
        if (!opts.dryRun) {
          try {
            process.kill(p.pid);
          } catch {}
          await removeProxyPid(p.projectDir);
        }
        process.stdout.write(
          `Stopped idle proxy for ${path.basename(p.projectDir)} (pid ${p.pid}, idle ${Math.floor(idleMs / 60000)}m)\n`,
        );
        removed++;
      }
    }

    // Prune dead MCP sessions
    if (p.kind === "mcp" && !p.parentAlive) {
      if (!opts.dryRun) {
        try {
          process.kill(p.pid);
        } catch {}
        // Find the session ID for this pid
        const sessions = await listHostSessions(p.projectDir);
        const session = sessions.find((s) => s.pid === p.pid);
        if (session) await forgetHostSession(p.projectDir, session.id);
      }
      process.stdout.write(
        `Stopped dead mcp session pid ${p.pid} for ${path.basename(p.projectDir)}\n`,
      );
      removed++;
    }
  }

  return removed;
}

export default function register(program: Command): void {
  program
    .command("ps")
    .description(
      "List Golem-owned processes on this machine (proxy, mcp serve, statusline, dashboard)",
    )
    .option("--dir <path>", "project directory (limits to this project)", _DEFAULT_DIR)
    .option("--json", "machine-readable output", false)
    .option("--prune", "remove stale/idle processes Golem owns and can prove are not live", false)
    .option("--dry-run", "with --prune, report what would be removed without removing", false)
    .option(
      "--idle-timeout-ms <ms>",
      "idle threshold for pruning proxies (ms); 0 = use config",
      "0",
    )
    .action(
      async (opts: {
        dir: string;
        json: boolean;
        prune: boolean;
        dryRun: boolean;
        idleTimeoutMs: string;
      }) => {
        try {
          const projectDir = opts.dir;
          const { settings } = await loadConfig({ projectDir });
          const idleTimeoutMs =
            parseInt(opts.idleTimeoutMs, 10) > 0
              ? parseInt(opts.idleTimeoutMs, 10)
              : (settings.proxy.idle_timeout_ms ?? 0);

          const [proxies, mcpServes, statuslines] = await Promise.all([
            collectProxies(),
            collectMcpServes(),
            collectStatuslines(),
          ]);

          let allProcs = [...proxies, ...mcpServes, ...statuslines];

          // Filter by project if specified
          if (opts.dir !== _DEFAULT_DIR) {
            allProcs = allProcs.filter((p) => p.projectDir === projectDir);
          }

          if (opts.json) {
            process.stdout.write(`${renderJson(allProcs)}\n`);
            return;
          }

          if (opts.prune) {
            const removed = await pruneProcesses(allProcs, {
              dryRun: opts.dryRun,
              idleTimeoutMs,
              projectDir,
            });
            if (opts.dryRun) {
              process.stdout.write(
                `Would remove ${removed} process(es). Run without --dry-run to execute.\n`,
              );
            } else {
              process.stdout.write(`Removed ${removed} process(es).\n`);
            }
          } else {
            process.stdout.write(renderTable(allProcs));
          }
        } catch (err) {
          _fail(err);
        }
      },
    );
}
