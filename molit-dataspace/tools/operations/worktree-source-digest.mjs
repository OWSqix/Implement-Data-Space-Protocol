#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const ZERO_DIGEST = "0".repeat(64);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function listedPaths() {
  const { stdout } = await execute("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.toString("utf8").split("\0").filter(Boolean)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

async function sourceRecord(relative) {
  if (relative.includes("\\") || relative.startsWith("/") || relative.split("/").includes("..")) {
    throw new Error(`unsafe Git source path: ${relative}`);
  }
  const absolute = path.resolve(root, ...relative.split("/"));
  const contained = path.relative(root, absolute);
  if (!contained || contained.startsWith("..") || path.isAbsolute(contained)) throw new Error(`Git source path leaves the project: ${relative}`);
  let information;
  try {
    information = await lstat(absolute);
  } catch (error) {
    if (error.code === "ENOENT") return { path: relative, type: "deleted", bytes: 0, sha256: ZERO_DIGEST };
    throw error;
  }
  if (information.isSymbolicLink()) {
    const target = Buffer.from(await readlink(absolute), "utf8");
    return { path: relative, type: "symlink", bytes: target.length, sha256: digest(target) };
  }
  if (!information.isFile()) throw new Error(`Git source entry is not a regular file or symbolic link: ${relative}`);
  const bytes = await readFile(absolute);
  return { path: relative, type: "file", bytes: bytes.length, sha256: digest(bytes) };
}

const records = await Promise.all((await listedPaths()).map(sourceRecord));
const aggregate = createHash("sha256");
for (const record of records) aggregate.update(`${JSON.stringify(record)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  algorithm: "git-ls-files-content-sha256-v1",
  digest: aggregate.digest("hex"),
  fileCount: records.length,
})}\n`);
