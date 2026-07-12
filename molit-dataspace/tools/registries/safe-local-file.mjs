import { constants } from "node:fs";
import {
  lstat,
  open,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function samePath(left, right) {
  const normalize = (value) => {
    const normalized = path.normalize(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
}

export async function checkedPathBelow(root, candidate, expectedType) {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error(`local evidence path escapes root: ${candidate}`);
  }
  let current = absoluteRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`local evidence reparse path rejected: ${candidate}`);
  }
  const stat = await lstat(current);
  if ((expectedType === "directory" && !stat.isDirectory())
    || (expectedType === "file" && !stat.isFile())) {
    throw new Error(`local evidence path is not a ${expectedType}: ${candidate}`);
  }
  const canonicalRoot = await realpath(absoluteRoot);
  const canonical = await realpath(current);
  if (!samePath(canonical, path.resolve(canonicalRoot, ...relative.split(path.sep)))) {
    throw new Error(`local evidence path resolves through a reparse point: ${candidate}`);
  }
  return current;
}

export async function readCheckedFile(root, candidate, maximumBytes = 64 * 1024 * 1024) {
  const file = await checkedPathBelow(root, candidate, "file");
  const pathStat = await lstat(file);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximumBytes
      || pathStat.dev !== before.dev || pathStat.ino !== before.ino) {
      throw new Error(`local evidence file exceeds limits or changed: ${candidate}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== before.size || after.size !== before.size
      || after.dev !== before.dev || after.ino !== before.ino) {
      throw new Error(`local evidence file changed while reading: ${candidate}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function atomicWriteChecked(root, candidate, contents) {
  const directory = path.dirname(candidate);
  await checkedPathBelow(root, directory, "directory");
  try {
    await checkedPathBelow(root, candidate, "file");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = path.join(directory, `.${path.basename(candidate)}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await checkedPathBelow(root, temporary, "file");
    await rename(temporary, candidate);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") error.cause = cleanupError;
    }
    throw error;
  }
}

export function isStrictRfc3339(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[.]\d+)?Z$/u.exec(value ?? "");
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) return false;
  return Number.isFinite(Date.parse(value));
}
