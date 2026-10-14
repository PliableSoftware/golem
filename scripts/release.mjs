/**
 * Bump the Golem version in lockstep across every surface (Decision 41a).
 *
 * package.json is canonical, but the VS Code extension carries its own
 * `version`, the compiled-in `VERSION` (src/version.ts) is generated from
 * package.json, and package-lock.json repeats the root version. All of them
 * move together or none do (DUST2.21): every edit is computed and validated in
 * memory first, written to a temp file beside its target, and only then renamed
 * into place. If any step fails part-way, the files already renamed are restored
 * from the originals and the temp files are removed, so the tree is never left
 * half-bumped.
 *
 * It does NOT tag, commit, publish, or push itself. The Prepare release workflow
 * runs it, commits the bump and opens the development -> main PR; merging that PR
 * runs the release workflow, which tags, publishes the GitHub Release and
 * binaries, and publishes to npm (Decision 41 / RELEASING.md).
 *
 *   node scripts/release.mjs <patch|minor|major|X.Y.Z>
 *
 * Cross-platform: pure node fs, no child processes.
 */
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { versionTsContent } from "./sync-version.mjs";

const EXPLICIT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parse "X.Y.Z" (ignoring any prerelease/build suffix) into [major, minor, patch]. */
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) throw new Error(`not a semver version: "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Resolve the target version from the bump keyword or an explicit semver. */
export function nextVersion(current, bump) {
  if (/^\d/.test(bump)) {
    if (!EXPLICIT.test(bump)) throw new Error(`not a semver version: "${bump}"`);
    return bump;
  }
  const [major, minor, patch] = parseSemver(current);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump "${bump}" — use patch | minor | major | X.Y.Z`);
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

/** Parse a package.json-shaped file, require a string `version`, return the bumped text. */
function bumpedJson(rel, raw, target, { requireVersion }) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${rel} is not valid JSON: ${err.message}`);
  }
  if (requireVersion && typeof obj.version !== "string") {
    throw new Error(`${rel} has no string \`version\``);
  }
  obj.version = target;
  if (obj.packages?.[""] !== undefined) obj.packages[""].version = target;
  // 2-space indent + trailing newline matches the repo's existing files.
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * Compute every edit without touching disk. Throws if any input is unusable.
 * Returns { current, target, edits: [{ rel, path, before, after }] }.
 */
export async function planBump(root, bump) {
  const rootRaw = await readFile(join(root, "package.json"), "utf8");
  const current = JSON.parse(rootRaw).version;
  if (typeof current !== "string") throw new Error("package.json has no string `version`");
  const target = nextVersion(current, bump);

  const edits = [];
  const add = (rel, before, after) => edits.push({ rel, path: join(root, rel), before, after });

  add("package.json", rootRaw, bumpedJson("package.json", rootRaw, target, { requireVersion: true }));
  const extRel = join("vscode-extension", "package.json");
  const extRaw = await readFile(join(root, extRel), "utf8");
  add(extRel, extRaw, bumpedJson(extRel, extRaw, target, { requireVersion: true }));

  // package-lock.json carries the root version twice (top level and packages[""]).
  const lockRaw = await readOptional(join(root, "package-lock.json"));
  if (lockRaw !== null) {
    add("package-lock.json", lockRaw, bumpedJson("package-lock.json", lockRaw, target, { requireVersion: false }));
  }

  const verRel = join("src", "version.ts");
  add(verRel, await readOptional(join(root, verRel)), versionTsContent(target));
  return { current, target, edits };
}

/**
 * Write every edit or none. Temp files are written first (a failure there
 * changes no target), then renamed in turn; a failed rename restores the targets
 * already replaced. `io` lets tests inject failures into the forward path only —
 * rollback always uses the real fs.
 */
export async function applyEdits(edits, io = { writeFile, rename, rm }) {
  const tmpOf = (e) => `${e.path}.release-${process.pid}.tmp`;
  const replaced = [];
  try {
    for (const e of edits) await io.writeFile(tmpOf(e), e.after, "utf8");
    for (const e of edits) {
      // Tracked BEFORE the rename: if it throws after taking effect, the target
      // still gets restored, and restoring an untouched file is harmless.
      replaced.push(e);
      await io.rename(tmpOf(e), e.path);
    }
  } catch (err) {
    const problems = [];
    for (const e of replaced.reverse()) {
      try {
        if (e.before === null) {
          await rm(e.path, { force: true });
        } else {
          const back = `${e.path}.release-${process.pid}.restore`;
          await writeFile(back, e.before, "utf8");
          await rename(back, e.path);
        }
      } catch (restoreErr) {
        problems.push(`${e.rel}: ${restoreErr.message}`);
      }
    }
    for (const e of edits) await rm(tmpOf(e), { force: true }).catch(() => {});
    const failed = new Error(
      `release aborted, ${problems.length === 0 ? "no file changed" : `RESTORE FAILED for ${problems.join("; ")}`}: ${err.message}`,
      { cause: err },
    );
    throw failed;
  }
}

/** Plan, validate and apply a bump under `root`. Returns { current, target, edits }. */
export async function bumpVersions(root, bump, io) {
  const plan = await planBump(root, bump);
  await applyEdits(plan.edits, io);
  return plan;
}

async function main() {
  const arg = process.argv[2];
  if (arg === undefined) {
    process.stderr.write("usage: node scripts/release.mjs <patch|minor|major|X.Y.Z>\n");
    process.exit(1);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  let result;
  try {
    result = await bumpVersions(root, arg);
  } catch (err) {
    process.stderr.write(`release: ${err.message}\n`);
    process.exit(1);
  }
  for (const e of result.edits) {
    process.stdout.write(`release: ${e.rel} ${result.current} -> ${result.target}\n`);
  }
  process.stdout.write(
    [
      "",
      `Version bumped to ${result.target}. This script does not commit, tag or publish.`,
      "Next: the Prepare release workflow commits the bump on development and opens the",
      "development -> main release PR. Merging that PR runs the release workflow, which",
      "tags, publishes the GitHub Release and binaries, and publishes @pliable/golem to npm.",
      "(The VS Code extension is published as well when the VSCE_PAT secret is set.)",
      "",
    ].join("\n"),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
