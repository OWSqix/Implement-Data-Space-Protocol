#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { constants, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const lockPath = path.join(root, "package-lock.json");
const packagePath = path.join(root, "package.json");
const evidenceDirectory = path.join(root, "evidence", "dependencies");
const manifestPath = path.join(evidenceDirectory, "node-installed-tree.v1.json");
const sbomPath = path.join(evidenceDirectory, "node-sbom.spdx.json");
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TREE_BYTES = 1024 * 1024 * 1024;
const MAX_TREE_ENTRIES = 1_000_000;
const MAX_TREE_FILES = 500_000;
const MAX_SHIM_BYTES = 64 * 1024 * 1024;
const MAX_SHIM_FILES = 10_000;
const BASELINE_DATE = "2026-07-12";

export function createInstalledTreeBudget({
  maximumBytes = MAX_TREE_BYTES,
  maximumEntries = MAX_TREE_ENTRIES,
  maximumFiles = MAX_TREE_FILES,
} = {}) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0
    || !Number.isSafeInteger(maximumEntries) || maximumEntries <= 0
    || !Number.isSafeInteger(maximumFiles) || maximumFiles <= 0) {
    throw new RangeError("installed-tree limits must be positive safe integers");
  }
  return {
    bytes: 0,
    entries: 0,
    files: 0,
    maximumBytes,
    maximumEntries,
    maximumFiles,
    observeEntry(label) {
      this.entries += 1;
      if (this.entries > this.maximumEntries) {
        throw new Error(`dependency tree entry limit exceeded: ${label}`);
      }
    },
    consume(bytes, label) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        throw new RangeError(`invalid installed-tree byte count: ${label}`);
      }
      this.files += 1;
      this.bytes += bytes;
      if (this.files > this.maximumFiles) {
        throw new Error(`dependency tree file limit exceeded: ${label}`);
      }
      if (this.bytes > this.maximumBytes) {
        throw new Error(`dependency tree byte limit exceeded: ${label}`);
      }
    },
  };
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => (
      [key, canonicalValue(value[key])]
    )));
  }
  return value;
}

function encodedJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readJson(file) {
  const bytes = await readRegularFile(file, MAX_FILE_BYTES);
  const text = decoder.decode(bytes);
  return { bytes, value: JSON.parse(text) };
}

export async function readRegularFile(file, maximumBytes, { beforeOpen } = {}) {
  const beforePath = await lstat(file);
  if (!beforePath.isFile() || beforePath.isSymbolicLink() || beforePath.size > maximumBytes) {
    throw new Error(`bounded regular file required: ${file}`);
  }
  if (beforeOpen !== undefined) {
    if (typeof beforeOpen !== "function") throw new TypeError("beforeOpen must be a function");
    await beforeOpen(beforePath);
  }
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximumBytes) {
      throw new Error(`file exceeds its byte limit: ${file}`);
    }
    if (before.dev !== beforePath.dev
      || before.ino !== beforePath.ino
      || before.size !== beforePath.size) {
      throw new Error(`file identity changed before it was opened: ${file}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== before.size
      || after.size !== before.size
      || after.dev !== before.dev
      || after.ino !== before.ino) {
      throw new Error(`file changed while it was being read: ${file}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function portablePackageSegments(relative) {
  if (typeof relative !== "string"
    || (relative !== "node_modules" && !relative.startsWith("node_modules/"))) {
    throw new Error(`invalid package-lock path: ${relative}`);
  }
  if (relative.includes("\\") || relative.includes(":")) {
    throw new Error(`non-portable package-lock path: ${relative}`);
  }
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`unsafe package-lock path: ${relative}`);
  }
  return segments;
}

function samePath(left, right) {
  const normalize = (value) => {
    const normalized = path.normalize(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
}

async function checkedDirectory(relative, installationRoot = root) {
  const segments = portablePackageSegments(relative);
  let current = installationRoot;
  const rootStat = await lstat(installationRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`installation root is not a real directory: ${installationRoot}`);
  }
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`dependency path is not a real directory: ${relative}`);
    }
  }
  const canonicalRoot = await realpath(installationRoot);
  const canonical = await realpath(current);
  const expected = path.resolve(canonicalRoot, ...segments);
  if (!samePath(canonical, expected)) {
    throw new Error(`dependency path resolves through a reparse point: ${relative}`);
  }
  return current;
}

export async function packageContentRecord(
  directory,
  treeBudget = createInstalledTreeBudget(),
) {
  const files = [];
  let totalBytes = 0;
  async function walk(current, relative = "") {
    const directory = await opendir(current);
    for await (const entry of directory) {
      const item = path.join(current, entry.name);
      const itemRelative = relative ? `${relative}/${entry.name}` : entry.name;
      treeBudget.observeEntry(itemRelative);
      if (entry.name === "node_modules" && relative === "") continue;
      const stat = await lstat(item);
      if (stat.isSymbolicLink()) throw new Error(`dependency symlink rejected: ${itemRelative}`);
      if (stat.isDirectory()) {
        await walk(item, itemRelative);
        continue;
      }
      if (!stat.isFile()) throw new Error(`non-regular dependency artifact: ${itemRelative}`);
      const payload = await readRegularFile(item, MAX_FILE_BYTES);
      treeBudget.consume(payload.length, itemRelative);
      totalBytes += payload.length;
      files.push({ path: itemRelative, sha256: sha256(payload), bytes: payload.length });
    }
  }
  await walk(directory);
  files.sort((left, right) => lexicalCompare(left.path, right.path));
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path, "utf8");
    digest.update("\0");
    digest.update(file.sha256, "ascii");
    digest.update("\0");
    digest.update(String(file.bytes), "ascii");
    digest.update("\0");
  }
  return {
    bytes: totalBytes,
    contentSha256: digest.digest("hex"),
    fileCount: files.length,
  };
}

export async function discoverInstalledPackages(
  installationRoot,
  prefix = "node_modules",
  treeBudget = createInstalledTreeBudget(),
) {
  const directory = await checkedDirectory(prefix, installationRoot);
  const found = [];
  const entries = await opendir(directory);
  for await (const entry of entries) {
    treeBudget.observeEntry(`${prefix}/${entry.name}`);
    if (entry.name === ".bin") continue;
    if (entry.name === ".package-lock.json") {
      if (prefix === "node_modules") continue;
      throw new Error(`nested node_modules install metadata is forbidden: ${prefix}/${entry.name}`);
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`unexpected node_modules entry: ${prefix}/${entry.name}`);
    }
    if (entry.name.startsWith("@")) {
      const scopeDirectory = await checkedDirectory(`${prefix}/${entry.name}`, installationRoot);
      const scoped = await opendir(scopeDirectory);
      for await (const child of scoped) {
        treeBudget.observeEntry(`${prefix}/${entry.name}/${child.name}`);
        if (!child.isDirectory() || child.isSymbolicLink()) {
          throw new Error(`unexpected scoped dependency entry: ${prefix}/${entry.name}/${child.name}`);
        }
        const packageRelative = `${prefix}/${entry.name}/${child.name}`;
        found.push(packageRelative);
        try {
          found.push(...await discoverInstalledPackages(
            installationRoot,
            `${packageRelative}/node_modules`,
            treeBudget,
          ));
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      continue;
    }
    const packageRelative = `${prefix}/${entry.name}`;
    found.push(packageRelative);
    try {
      found.push(...await discoverInstalledPackages(
        installationRoot,
        `${packageRelative}/node_modules`,
        treeBudget,
      ));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return found;
}

async function shimRecord(packagePaths, installationRoot, treeBudget) {
  const directoryPaths = [
    "node_modules/.bin",
    ...packagePaths.map((relative) => `${relative}/node_modules/.bin`),
  ];
  const files = [];
  let totalBytes = 0;
  for (const relativeDirectory of directoryPaths) {
    let directory;
    try {
      directory = await checkedDirectory(relativeDirectory, installationRoot);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const entries = await opendir(directory);
    for await (const entry of entries) {
      treeBudget.observeEntry(`${relativeDirectory}/${entry.name}`);
      if (files.length >= MAX_SHIM_FILES) throw new Error("execution shim file limit exceeded");
      const item = path.join(directory, entry.name);
      const payload = await readRegularFile(item, MAX_FILE_BYTES);
      treeBudget.consume(payload.length, `${relativeDirectory}/${entry.name}`);
      totalBytes += payload.length;
      if (totalBytes > MAX_SHIM_BYTES) throw new Error("execution shim byte limit exceeded");
      files.push({
        path: `${relativeDirectory.slice("node_modules/".length)}/${entry.name}`,
        bytes: payload.length,
        sha256: sha256(payload),
      });
    }
  }
  files.sort((left, right) => lexicalCompare(left.path, right.path));
  return {
    contentSha256: sha256(encodedJson(files)),
    fileCount: files.length,
  };
}

async function installMetadataRecord(installationRoot, treeBudget) {
  const file = path.join(installationRoot, "node_modules", ".package-lock.json");
  const bytes = await readRegularFile(file, MAX_FILE_BYTES);
  treeBudget.consume(bytes.length, "node_modules/.package-lock.json");
  return {
    path: "node_modules/.package-lock.json",
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

async function installedManifest(lock, lockSha256, installationRoot = root) {
  const treeBudget = createInstalledTreeBudget();
  const packageEntries = Object.entries(lock.packages)
    .filter(([relative]) => relative.startsWith("node_modules/"))
    .sort(([left], [right]) => lexicalCompare(left, right));
  const expectedPaths = packageEntries.map(([relative]) => relative);
  const actualPaths = (await discoverInstalledPackages(
    installationRoot,
    "node_modules",
    treeBudget,
  ))
    .sort(lexicalCompare);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    const expected = new Set(expectedPaths);
    const actual = new Set(actualPaths);
    const missing = expectedPaths.filter((item) => !actual.has(item));
    const unexpected = actualPaths.filter((item) => !expected.has(item));
    throw new Error(`installed dependency inventory mismatch: ${JSON.stringify({ missing, unexpected })}`);
  }
  const packages = [];
  for (const [relative, locked] of packageEntries) {
    if (typeof locked.integrity !== "string" || !locked.integrity.startsWith("sha512-")) {
      throw new Error(`dependency has no SHA-512 lock integrity: ${relative}`);
    }
    const directory = await checkedDirectory(relative, installationRoot);
    const packageJson = await readJson(path.join(directory, "package.json"));
    if (packageJson.value.name !== locked.name && locked.name !== undefined) {
      throw new Error(`dependency name mismatch: ${relative}`);
    }
    if (packageJson.value.version !== locked.version) {
      throw new Error(`dependency version mismatch: ${relative}`);
    }
    packages.push({
      path: relative,
      name: packageJson.value.name,
      version: packageJson.value.version,
      integrity: locked.integrity,
      packageJsonSha256: sha256(packageJson.bytes),
      ...await packageContentRecord(directory, treeBudget),
    });
  }
  return {
    schemaVersion: "molit.node-installed-tree/1",
    baselineDate: BASELINE_DATE,
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    packageLockSha256: lockSha256,
    packageCount: packages.length,
    packages,
    executionShims: await shimRecord(expectedPaths, installationRoot, treeBudget),
    installMetadata: await installMetadataRecord(installationRoot, treeBudget),
  };
}

function inheritedEnvironmentValue(name) {
  const entry = Object.entries(process.env)
    .find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

export function sanitizedNpmEnvironment(workspaceRoot, {
  cleanInstall = false,
  configRoot = workspaceRoot,
} = {}) {
  const environment = {};
  for (const name of ["COMSPEC", "PATHEXT", "SYSTEMROOT", "WINDIR"]) {
    const value = inheritedEnvironmentValue(name);
    if (value) environment[name] = value;
  }
  const executableDirectory = path.dirname(process.execPath);
  const systemDirectory = environment.SYSTEMROOT
    ? path.join(environment.SYSTEMROOT, "System32")
    : null;
  environment.PATH = [executableDirectory, systemDirectory]
    .filter(Boolean)
    .join(path.delimiter);
  environment.CI = "true";
  environment.FORCE_COLOR = "0";
  environment.NO_COLOR = "1";
  environment.TZ = "UTC";
  environment.npm_config_audit = "false";
  environment.npm_config_color = "false";
  environment.npm_config_fund = "false";
  environment.npm_config_globalconfig = path.join(configRoot, ".molit-empty-global.npmrc");
  environment.npm_config_ignore_scripts = "true";
  environment.npm_config_package_lock = "true";
  environment.npm_config_progress = "false";
  environment.npm_config_provenance = "false";
  environment.npm_config_registry = "https://registry.npmjs.org/";
  environment.npm_config_save = "false";
  environment.npm_config_update_notifier = "false";
  environment.npm_config_userconfig = path.join(configRoot, ".molit-empty-user.npmrc");
  const temporaryRoot = cleanInstall ? workspaceRoot : configRoot;
  environment.npm_config_cache = path.join(temporaryRoot, ".molit-npm-cache");
  environment.TEMP = path.join(temporaryRoot, ".tmp");
  environment.TMP = environment.TEMP;
  return environment;
}

async function normalizedNpmSbom(lockSha256, workspaceRoot = root) {
  const npmCli = npmCliEntrypoint();
  const configRoot = await mkdtemp(path.join(tmpdir(), "molit-npm-config-"));
  try {
    await Promise.all([
      writeFile(path.join(configRoot, ".molit-empty-global.npmrc"), "", { flag: "wx" }),
      writeFile(path.join(configRoot, ".molit-empty-user.npmrc"), "", { flag: "wx" }),
      mkdir(path.join(configRoot, ".tmp")),
    ]);
    const result = spawnSync(process.execPath, [
      npmCli,
      "sbom",
      "--package-lock-only",
      "--sbom-format",
      "spdx",
    ], {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: sanitizedNpmEnvironment(workspaceRoot, { configRoot }),
      shell: false,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    });
    if (result.error || result.status !== 0) {
      throw result.error ?? new Error(result.stderr || "npm sbom failed");
    }
    const sbom = JSON.parse(result.stdout);
    sbom.documentNamespace = `https://data.molit.go.kr/sbom/node/${lockSha256}`;
    sbom.creationInfo.created = `${BASELINE_DATE}T00:00:00Z`;
    return sbom;
  } finally {
    await rm(configRoot, { force: true, recursive: true });
  }
}

function npmCliEntrypoint() {
  const npmCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (!existsSync(npmCli)) throw new Error("reviewed npm CLI entrypoint was not found");
  const npmPackage = JSON.parse(readFileSync(path.join(npmCli, "..", "..", "package.json"), "utf8"));
  if (npmPackage.version !== "11.13.0") {
    throw new Error(`npm 11.13.0 is required, found ${npmPackage.version}`);
  }
  return npmCli;
}

export async function createIsolatedInstallProject() {
  const [packageBytes, lockBytes] = await Promise.all([
    readRegularFile(packagePath, MAX_FILE_BYTES),
    readRegularFile(lockPath, MAX_FILE_BYTES),
  ]);
  const directory = await mkdtemp(path.join(tmpdir(), "molit-node-install-"));
  const relative = path.relative(root, directory);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    await rm(directory, { force: true, recursive: true });
    throw new Error("isolated npm install directory must be outside the repository");
  }
  try {
    await Promise.all([
      writeFile(path.join(directory, "package.json"), packageBytes, { flag: "wx" }),
      writeFile(path.join(directory, "package-lock.json"), lockBytes, { flag: "wx" }),
      writeFile(path.join(directory, ".molit-empty-global.npmrc"), "", { flag: "wx" }),
      writeFile(path.join(directory, ".molit-empty-user.npmrc"), "", { flag: "wx" }),
      mkdir(path.join(directory, ".tmp")),
      mkdir(path.join(directory, ".molit-npm-cache")),
    ]);
    return directory;
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

async function cleanInstall() {
  const directory = await createIsolatedInstallProject();
  const result = spawnSync(process.execPath, [
    npmCliEntrypoint(),
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ], {
    cwd: directory,
    encoding: "utf8",
    env: sanitizedNpmEnvironment(directory, { cleanInstall: true }),
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 240_000,
  });
  if (result.error || result.status !== 0) {
    await rm(directory, { force: true, recursive: true });
    throw result.error ?? new Error(result.stderr || "clean npm ci failed");
  }
  return directory;
}

async function currentEvidence(reviewedLockDigest, installationRoot = root) {
  const lock = await readJson(lockPath);
  const lockDigest = sha256(lock.bytes);
  if (reviewedLockDigest !== lockDigest) {
    throw new Error(`capture requires --review-lock=${lockDigest}`);
  }
  const packageDocument = (await readJson(packagePath)).value;
  if (packageDocument.packageManager !== "npm@11.13.0") {
    throw new Error("package.json must pin packageManager npm@11.13.0");
  }
  const manifest = await installedManifest(lock.value, lockDigest, installationRoot);
  const sbom = await normalizedNpmSbom(lockDigest, installationRoot);
  const sbomBytes = encodedJson(sbom);
  manifest.sbom = {
    format: "SPDX-2.3-json",
    path: "evidence/dependencies/node-sbom.spdx.json",
    sha256: sha256(sbomBytes),
    packageCount: sbom.packages.length,
  };
  return { manifest, sbomBytes, evidenceSha256: sha256(encodedJson(manifest)) };
}

async function checkedRepositoryDirectory(directory) {
  const relative = path.relative(root, path.resolve(directory));
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error(`repository directory escapes root: ${directory}`);
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`repository directory uses a reparse path: ${directory}`);
    }
  }
  const canonicalRoot = await realpath(root);
  const canonical = await realpath(current);
  if (!samePath(canonical, path.resolve(canonicalRoot, ...relative.split(path.sep)))) {
    throw new Error(`repository directory resolves outside root: ${directory}`);
  }
  return current;
}

async function ensureEvidenceDirectory() {
  const evidenceRoot = path.join(root, "evidence");
  await checkedRepositoryDirectory(evidenceRoot);
  try {
    await mkdir(evidenceDirectory);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return checkedRepositoryDirectory(evidenceDirectory);
}

async function atomicEvidenceWrite(file, contents) {
  const directory = await ensureEvidenceDirectory();
  if (!samePath(path.dirname(file), directory)) throw new Error("evidence output directory mismatch");
  try {
    const existing = await lstat(file);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error(`evidence output is not a regular file: ${file}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
  await rename(temporary, file);
}

async function capture(reviewedLockDigest, approvedEvidenceDigest) {
  const evidence = await currentEvidence(reviewedLockDigest);
  if (approvedEvidenceDigest !== evidence.evidenceSha256) {
    throw new Error(`capture requires --approve-evidence=${evidence.evidenceSha256}`);
  }
  await atomicEvidenceWrite(sbomPath, evidence.sbomBytes);
  await atomicEvidenceWrite(manifestPath, encodedJson(evidence.manifest));
  return evidence;
}

async function verify() {
  const [lock, approvedManifest, approvedSbom, packageDocument] = await Promise.all([
    readJson(lockPath),
    readJson(manifestPath),
    readJson(sbomPath),
    readJson(packagePath),
  ]);
  if (packageDocument.value.packageManager !== "npm@11.13.0") {
    throw new Error("package.json must pin packageManager npm@11.13.0");
  }
  if (decoder.decode(approvedManifest.bytes) !== encodedJson(approvedManifest.value)
    || decoder.decode(approvedSbom.bytes) !== encodedJson(approvedSbom.value)) {
    throw new Error("stored dependency evidence is not canonical JSON");
  }
  const lockDigest = sha256(lock.bytes);
  const actualManifest = await installedManifest(lock.value, lockDigest);
  const regeneratedSbom = await normalizedNpmSbom(lockDigest);
  const regeneratedSbomBytes = encodedJson(regeneratedSbom);
  actualManifest.sbom = {
    format: "SPDX-2.3-json",
    path: "evidence/dependencies/node-sbom.spdx.json",
    sha256: sha256(regeneratedSbomBytes),
    packageCount: regeneratedSbom.packages.length,
  };
  if (encodedJson(approvedSbom.value) !== regeneratedSbomBytes) {
    throw new Error("stored SPDX SBOM does not match npm package-lock output");
  }
  if (encodedJson(approvedManifest.value) !== encodedJson(actualManifest)) {
    throw new Error("installed Node dependency bytes do not match the approved manifest");
  }
  return {
    valid: true,
    packageCount: actualManifest.packageCount,
    packageLockSha256: lockDigest,
    sbomSha256: actualManifest.sbom.sha256,
  };
}

export function parseCommandArguments(argv) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== "string")) {
    throw new TypeError("dependency evidence arguments must be a string array");
  }
  const [command = "verify", ...tokens] = argv;
  const contracts = {
    capture: {
      flags: new Set(),
      values: new Set(["approve-evidence", "review-lock"]),
    },
    candidate: {
      flags: new Set(["clean-install"]),
      values: new Set(["review-lock"]),
    },
    verify: {
      flags: new Set(),
      values: new Set(),
    },
  };
  const contract = contracts[command];
  if (!contract) throw new Error(`unknown command: ${command}`);
  const flags = new Set();
  const values = new Map();
  for (const token of tokens) {
    const flag = /^--([a-z][a-z0-9-]*)$/u.exec(token)?.[1];
    if (flag) {
      if (!contract.flags.has(flag)) throw new Error(`option is not allowed for ${command}: --${flag}`);
      if (flags.has(flag)) throw new Error(`duplicate option: --${flag}`);
      flags.add(flag);
      continue;
    }
    const assignment = /^--([a-z][a-z0-9-]*)=(.*)$/u.exec(token);
    if (!assignment) throw new Error(`malformed option: ${token}`);
    const [, name, value] = assignment;
    if (!contract.values.has(name)) {
      throw new Error(`option is not allowed for ${command}: --${name}`);
    }
    if (values.has(name)) throw new Error(`duplicate option: --${name}`);
    if (!/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error(`option requires a lowercase SHA-256 digest: --${name}`);
    }
    values.set(name, value);
  }
  if (command === "candidate" && !flags.has("clean-install")) {
    throw new Error("candidate requires --clean-install");
  }
  for (const required of contract.values) {
    if (!values.has(required)) throw new Error(`${command} requires --${required}=<sha256>`);
  }
  return {
    approvedEvidence: values.get("approve-evidence"),
    cleanInstall: flags.has("clean-install"),
    command,
    reviewedLock: values.get("review-lock"),
  };
}

export async function runCommand(argv = []) {
  const {
    approvedEvidence,
    command,
    reviewedLock,
  } = parseCommandArguments(argv);
  let isolatedInstall;
  if (command === "candidate") {
    const lockDigest = sha256(await readRegularFile(lockPath, MAX_FILE_BYTES));
    if (reviewedLock !== lockDigest) {
      throw new Error(`capture requires --review-lock=${lockDigest}`);
    }
    isolatedInstall = await cleanInstall();
  }
  try {
    const captured = command === "candidate"
      ? await currentEvidence(reviewedLock, isolatedInstall)
      : command === "capture"
        ? await capture(
          reviewedLock,
          approvedEvidence,
        )
        : command === "verify"
          ? await verify()
          : (() => { throw new Error(`unknown command: ${command}`); })();
    return command === "candidate" || command === "capture"
      ? {
        valid: true,
        command,
        packageCount: captured.manifest.packageCount,
        packageLockSha256: captured.manifest.packageLockSha256,
        sbomSha256: captured.manifest.sbom.sha256,
        evidenceSha256: captured.evidenceSha256,
      }
      : captured;
  } finally {
    if (isolatedInstall) await rm(isolatedInstall, { force: true, recursive: true });
  }
}

const isMain = process.argv[1]
  && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const result = await runCommand(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
