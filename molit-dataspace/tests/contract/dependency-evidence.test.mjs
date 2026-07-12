import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createInstalledTreeBudget,
  createIsolatedInstallProject,
  discoverInstalledPackages,
  packageContentRecord,
  parseCommandArguments,
  readRegularFile,
  sanitizedNpmEnvironment,
} from "../../tools/dependencies/node-install-evidence.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const [lockBytes, manifestBytes, sbomBytes] = await Promise.all([
  readFile(path.join(root, "package-lock.json")),
  readFile(path.join(root, "evidence/dependencies/node-installed-tree.v1.json")),
  readFile(path.join(root, "evidence/dependencies/node-sbom.spdx.json")),
]);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const sbom = JSON.parse(sbomBytes.toString("utf8"));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("DEP-EVIDENCE-001: installed module bytes are bound to the reviewed lockfile", () => {
  assert.equal(manifest.schemaVersion, "molit.node-installed-tree/1");
  assert.equal(manifest.platform, "win32");
  assert.equal(manifest.architecture, "x64");
  assert.equal(manifest.nodeVersion, "v24.16.0");
  assert.equal(manifest.baselineDate, "2026-07-12");
  assert.equal(Object.hasOwn(manifest, "asOf"), false);
  assert.equal(manifest.packageLockSha256, sha256(lockBytes));
  assert.equal(manifest.packageCount, manifest.packages.length);
  assert.equal(new Set(manifest.packages.map(({ path: item }) => item)).size, manifest.packageCount);
  for (const item of manifest.packages) {
    assert.match(item.path, /^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/u);
    assert.match(item.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
    assert.match(item.packageJsonSha256, /^[a-f0-9]{64}$/u);
    assert.match(item.contentSha256, /^[a-f0-9]{64}$/u);
    assert.ok(item.fileCount > 0);
    assert.ok(item.bytes > 0);
  }
});

test("DEP-EVIDENCE-002: the stored SPDX document is byte-bound to the install manifest", () => {
  assert.equal(sbom.spdxVersion, "SPDX-2.3");
  assert.equal(sbom.packages.length, manifest.sbom.packageCount);
  assert.equal(sha256(sbomBytes), manifest.sbom.sha256);
  assert.equal(
    sbom.documentNamespace,
    `https://data.molit.go.kr/sbom/node/${manifest.packageLockSha256}`,
  );
  assert.equal(sbom.creationInfo.created, `${manifest.baselineDate}T00:00:00Z`);
});

test("DEP-EVIDENCE-003: clean-install staging is outside the repository and leaves it untouched", async (t) => {
  const installedLock = path.join(root, "node_modules/.package-lock.json");
  const before = sha256(await readFile(installedLock));
  const directory = await createIsolatedInstallProject();
  t.after(() => rm(directory, { force: true, recursive: true }));
  const relative = path.relative(root, directory);
  assert.ok(relative.startsWith("..") || path.isAbsolute(relative));
  assert.deepEqual(await readFile(path.join(directory, "package.json")), await readFile(path.join(root, "package.json")));
  assert.deepEqual(await readFile(path.join(directory, "package-lock.json")), lockBytes);
  assert.equal((await readFile(path.join(directory, ".molit-empty-user.npmrc"))).length, 0);
  assert.equal((await readFile(path.join(directory, ".molit-empty-global.npmrc"))).length, 0);
  assert.equal(sha256(await readFile(installedLock)), before);
});

test("DEP-EVIDENCE-004: npm evidence subprocesses receive an allowlisted configuration", () => {
  const workspace = path.join(tmpdir(), "molit-npm-workspace");
  const configRoot = path.join(tmpdir(), "molit-npm-config");
  const environment = sanitizedNpmEnvironment(workspace, { cleanInstall: true, configRoot });
  const keys = Object.keys(environment).map((key) => key.toLowerCase());
  assert.equal(keys.includes("node_options"), false);
  assert.equal(keys.includes("npm_config_proxy"), false);
  assert.equal(keys.includes("npm_config_https_proxy"), false);
  assert.equal(environment.npm_config_ignore_scripts, "true");
  assert.equal(environment.npm_config_registry, "https://registry.npmjs.org/");
  assert.equal(environment.npm_config_userconfig, path.join(configRoot, ".molit-empty-user.npmrc"));
  assert.equal(environment.npm_config_globalconfig, path.join(configRoot, ".molit-empty-global.npmrc"));
  assert.notEqual(environment.npm_config_userconfig, environment.npm_config_globalconfig);
  assert.equal(environment.npm_config_cache, path.join(workspace, ".molit-npm-cache"));
  assert.equal(environment.TEMP, path.join(workspace, ".tmp"));
});

test("DEP-EVIDENCE-005: one budget covers files and bytes across all installed packages", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-node-budget-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const first = path.join(directory, "first");
  const second = path.join(directory, "second");
  await Promise.all([mkdir(first), mkdir(second)]);
  await Promise.all([
    writeFile(path.join(first, "a.txt"), "abc", "utf8"),
    writeFile(path.join(second, "b.txt"), "def", "utf8"),
  ]);

  const byteBudget = createInstalledTreeBudget({ maximumBytes: 5, maximumFiles: 10 });
  await packageContentRecord(first, byteBudget);
  await assert.rejects(
    () => packageContentRecord(second, byteBudget),
    /dependency tree byte limit exceeded/u,
  );

  const fileBudget = createInstalledTreeBudget({ maximumBytes: 100, maximumFiles: 1 });
  await packageContentRecord(first, fileBudget);
  await assert.rejects(
    () => packageContentRecord(second, fileBudget),
    /dependency tree file limit exceeded/u,
  );

  const entryBudget = createInstalledTreeBudget({
    maximumBytes: 100,
    maximumEntries: 1,
    maximumFiles: 10,
  });
  await assert.rejects(
    () => packageContentRecord(directory, entryBudget),
    /dependency tree entry limit exceeded/u,
  );
});

test("DEP-EVIDENCE-006: lstat identity must match the opened file handle", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-node-identity-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const file = path.join(directory, "target.txt");
  const displaced = path.join(directory, "displaced.txt");
  await writeFile(file, "aaaa", "utf8");
  await assert.rejects(
    () => readRegularFile(file, 32, {
      beforeOpen: async () => {
        await rename(file, displaced);
        await writeFile(file, "bbbb", "utf8");
      },
    }),
    /file identity changed before it was opened/u,
  );
});

test("DEP-EVIDENCE-007: nested node_modules install metadata is rejected", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-node-nested-lock-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  await mkdir(path.join(directory, "node_modules/pkg/node_modules/dep"), { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "node_modules/.package-lock.json"), "{}", "utf8"),
    writeFile(path.join(directory, "node_modules/pkg/package.json"), "{}", "utf8"),
    writeFile(path.join(directory, "node_modules/pkg/node_modules/.package-lock.json"), "{}", "utf8"),
    writeFile(path.join(directory, "node_modules/pkg/node_modules/dep/package.json"), "{}", "utf8"),
  ]);
  await assert.rejects(
    () => discoverInstalledPackages(directory),
    /nested node_modules install metadata is forbidden/u,
  );
});

test("DEP-EVIDENCE-008: command options are exact, unique and command-scoped", () => {
  const digest = "a".repeat(64);
  assert.deepEqual(parseCommandArguments([]), {
    approvedEvidence: undefined,
    cleanInstall: false,
    command: "verify",
    reviewedLock: undefined,
  });
  assert.deepEqual(parseCommandArguments([
    "candidate",
    "--clean-install",
    `--review-lock=${digest}`,
  ]), {
    approvedEvidence: undefined,
    cleanInstall: true,
    command: "candidate",
    reviewedLock: digest,
  });
  assert.deepEqual(parseCommandArguments([
    "capture",
    `--approve-evidence=${digest}`,
    `--review-lock=${digest}`,
  ]), {
    approvedEvidence: digest,
    cleanInstall: false,
    command: "capture",
    reviewedLock: digest,
  });
  for (const invalid of [
    ["unknown"],
    ["verify", "--clean-install"],
    ["verify", "extra"],
    ["candidate", `--review-lock=${digest}`],
    ["candidate", "--clean-install", `--review-lock=${digest}`, `--review-lock=${digest}`],
    ["candidate", "--clean-install", "--review-lock=ABC"],
    ["candidate", "--clean-install=true", `--review-lock=${digest}`],
    ["capture", `--review-lock=${digest}`],
    ["capture", `--review-lock=${digest}`, `--approve-evidence=${digest}`, "--clean-install"],
  ]) assert.throws(() => parseCommandArguments(invalid));
});
