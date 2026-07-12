#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRelative = "profiles/molit-dcat-ap/releases/1.0.0-rc.1";
const releaseRoot = path.join(root, releaseRelative);
const lockPath = path.join(releaseRoot, "artifact-lock.json");
const binaryPattern = /\.(?:gz|gif|ico|jar|jpe?g|pdf|png|tgz|woff2?|zip)$/iu;

function fail(message) {
  const error = new Error(message);
  error.code = "RELEASE_EOL_POLICY_INVALID";
  throw error;
}

export function assertPortableArtifactPath(artifact, seen, boundary) {
  if (typeof artifact !== "string" || artifact.includes("\\")
    || artifact.startsWith("/") || artifact.includes("\0")
    || artifact.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(`artifact lock contains an invalid path: ${artifact}`);
  }
  const resolved = path.resolve(boundary, artifact);
  if (!resolved.startsWith(`${boundary}${path.sep}`) || seen.has(artifact)) {
    fail(`artifact lock contains a duplicate or escaping path: ${artifact}`);
  }
  seen.add(artifact);
}

export function assertPortableAttributes(attributes, file, { binary = false } = {}) {
  if (!attributes) fail(`git check-attr omitted a locked artifact: ${file}`);
  for (const name of ["working-tree-encoding", "ident", "filter"]) {
    if (!["unspecified", "unset"].includes(attributes[name])) {
      fail(`release artifact has an environment-dependent ${name} attribute: ${file}`);
    }
  }
  if (binary) {
    if (attributes.text !== "unset") fail(`binary artifact is not marked -text: ${file}`);
  } else if (attributes.text !== "set" || attributes.eol !== "lf") {
    fail(`text artifact is not normalized as LF: ${file}`);
  }
}

export function assertPortableTextBytes(bytes, file) {
  if (bytes.includes(0x0d)) fail(`text artifact contains a carriage return byte: ${file}`);
}

function parseCheckAttr(bytes) {
  const values = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split("\0");
  if (values.at(-1) === "") values.pop();
  if (values.length % 3 !== 0) fail("git check-attr returned an incomplete NUL record");
  const records = new Map();
  for (let index = 0; index < values.length; index += 3) {
    const [file, attribute, value] = values.slice(index, index + 3);
    if (!records.has(file)) records.set(file, {});
    records.get(file)[attribute] = value;
  }
  return records;
}

export async function verifyReleaseEolPolicy() {
  const lockBytes = await readFile(lockPath);
  const lock = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(lockBytes));
  if (!Array.isArray(lock?.artifacts) || lock.artifacts.length === 0) {
    fail("artifact lock does not contain release artifacts");
  }
  const seen = new Set();
  const paths = lock.artifacts.map(({ path: artifact }) => {
    assertPortableArtifactPath(artifact, seen, releaseRoot);
    return `${releaseRelative}/${artifact}`;
  });
  const lockFile = `${releaseRelative}/artifact-lock.json`;
  const checkedPaths = [...paths, lockFile];
  const child = spawnSync(
    "git",
    [
      "check-attr",
      "-z",
      "--stdin",
      "text",
      "eol",
      "working-tree-encoding",
      "ident",
      "filter",
    ],
    {
      cwd: root,
      encoding: "buffer",
      input: Buffer.from(`${checkedPaths.join("\0")}\0`, "utf8"),
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (child.error || child.status !== 0) {
    fail(`git check-attr failed: ${child.error?.message ?? child.stderr?.toString("utf8")}`);
  }
  const records = parseCheckAttr(child.stdout);
  let binaryArtifacts = 0;
  let textArtifacts = 0;
  for (const file of paths) {
    const attributes = records.get(file);
    if (binaryPattern.test(file)) {
      binaryArtifacts += 1;
      assertPortableAttributes(attributes, file, { binary: true });
    } else {
      textArtifacts += 1;
      assertPortableAttributes(attributes, file);
      const artifact = file.slice(releaseRelative.length + 1);
      const bytes = await readFile(path.join(releaseRoot, artifact));
      assertPortableTextBytes(bytes, file);
    }
  }
  const lockAttributes = records.get(lockFile);
  assertPortableAttributes(lockAttributes, lockFile);
  assertPortableTextBytes(lockBytes, lockFile);
  return {
    artifactCount: paths.length,
    artifactLockSha256: createHash("sha256").update(lockBytes).digest("hex"),
    binaryArtifacts,
    lockFileChecked: true,
    schemaVersion: "molit.release-eol-policy-verification/1",
    textArtifacts,
    valid: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyReleaseEolPolicy().then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
