#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, open, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { BridgeError } from "./discovery/errors.mjs";
import { stableStringify } from "./discovery/stable-json.mjs";
import {
  inspectState,
  reviewPendingOutboxEvents,
  synchronizeBatch,
} from "./discovery/synchronizer.mjs";
import { loadState, saveState, withStateLock } from "./discovery/state-repository.mjs";

function usage() {
  return `Usage:
  node src/cli.mjs sync --batch <file> --state <file> --config <file> --approvals <file> [--report <file>]
  node src/cli.mjs review --state <file> --config <file> --approvals <file> --report <file>
  node src/cli.mjs inspect --state <file>

The sync command writes connector-registration review candidates to a local PoC outbox.
The review command prints a summary and writes internal review material to a report.
Neither command calls a DSP Connector or an operating platform.`;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new BridgeError("INVALID_ARGUMENT", `invalid argument near ${flag ?? "<end>"}`);
    }
    options[flag.slice(2)] = value;
  }
  return { command, options };
}

function requireOption(options, name) {
  const value = options[name];
  if (!value) {
    throw new BridgeError("MISSING_ARGUMENT", `--${name} is required`);
  }
  return resolve(value);
}

async function readJson(path, label) {
  let handle;
  try {
    handle = await open(path, "r");
    const metadata = await handle.stat();
    if (metadata.size > 32 * 1024 * 1024) {
      throw new BridgeError("INPUT_FILE_TOO_LARGE", `${label} exceeds the 32 MiB limit`);
    }
    const raw = await handle.readFile();
    if (raw.byteLength > 32 * 1024 * 1024) {
      throw new BridgeError("INPUT_FILE_TOO_LARGE", `${label} grew beyond the 32 MiB limit`);
    }
    return JSON.parse(raw.toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new BridgeError("INVALID_JSON", `${label} is not valid JSON`, { path });
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let committed = false;
  try {
    await writeFile(temporaryPath, `${stableStringify(value, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    committed = true;
  } finally {
    if (!committed) {
      await unlink(temporaryPath).catch(() => {});
    }
  }
}

function reviewSummary(assessment) {
  return {
    schemaVersion: "molit.review-queue-summary/1",
    automaticDispatchAllowed: false,
    executionAuthority: "none",
    assessmentDigest: assessment.assessmentDigest,
    stateDigest: assessment.stateDigest,
    evaluatedAt: assessment.evaluatedAt,
    reconciliationRequired: assessment.reconciliationRequired,
    reviewableCount: assessment.reviewable.length,
    blockedCount: assessment.blocked.length,
    commands: assessment.reviewable.map((event) => ({
      id: event.id,
      type: event.type,
      resourceVersion: event.resourceVersion,
    })),
    blocked: assessment.blocked,
  };
}

function platformPathKey(path) {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function targetIdentity(path) {
  const absolute = resolve(path);
  try {
    const [physical, metadata] = await Promise.all([realpath(absolute), stat(absolute)]);
    return {
      fileId: `${metadata.dev}:${metadata.ino}`,
      isDirectory: metadata.isDirectory(),
      key: platformPathKey(physical),
    };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    const suffix = [];
    let existingAncestor = absolute;
    let physicalAncestor;
    while (!physicalAncestor) {
      try {
        physicalAncestor = await realpath(existingAncestor);
      } catch (ancestorError) {
        if (ancestorError?.code !== "ENOENT") {
          throw ancestorError;
        }
        const parent = dirname(existingAncestor);
        if (parent === existingAncestor) {
          throw ancestorError;
        }
        suffix.unshift(basename(existingAncestor));
        existingAncestor = parent;
      }
    }
    return {
      fileId: undefined,
      isDirectory: false,
      key: platformPathKey(join(physicalAncestor, ...suffix)),
    };
  }
}

async function assertDistinctFileTargets(paths, statePath, reportPath) {
  const identities = await Promise.all(paths.map(targetIdentity));
  for (let left = 0; left < identities.length; left += 1) {
    for (let right = left + 1; right < identities.length; right += 1) {
      const samePath = identities[left].key === identities[right].key;
      const sameFile = identities[left].fileId
        && identities[left].fileId === identities[right].fileId;
      if (samePath || sameFile) {
        throw new BridgeError("PATH_ALIAS", "input and output paths must identify distinct files");
      }
    }
  }

  if (reportPath) {
    if (identities.at(-1).isDirectory) {
      throw new BridgeError("INVALID_REPORT_TARGET", "report path must identify a file");
    }
    const stateKey = (await targetIdentity(statePath)).key;
    const reportKey = (await targetIdentity(reportPath)).key;
    if (reportKey === `${stateKey}.lock`
      || (dirname(reportKey) === dirname(stateKey)
        && basename(reportKey).startsWith(`${basename(stateKey)}.tmp-`))) {
      throw new BridgeError("RESERVED_STATE_PATH", "report path uses a reserved state path");
    }
  }
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "sync") {
    const batchPath = requireOption(options, "batch");
    const statePath = requireOption(options, "state");
    const configPath = requireOption(options, "config");
    const approvalsPath = requireOption(options, "approvals");
    const reportPath = options.report ? resolve(options.report) : undefined;
    const protectedPaths = [batchPath, configPath, approvalsPath, statePath, reportPath].filter(Boolean);
    await mkdir(dirname(statePath), { recursive: true });
    if (reportPath) {
      await mkdir(dirname(reportPath), { recursive: true });
    }
    await assertDistinctFileTargets(protectedPaths, statePath, reportPath);
    const [batch, config, approvals] = await Promise.all([
      readJson(batchPath, "batch"),
      readJson(configPath, "config"),
      readJson(approvalsPath, "approvals"),
    ]);
    const result = await withStateLock(statePath, async () => {
      await assertDistinctFileTargets(protectedPaths, statePath, reportPath);
      const state = await loadState(statePath);
      const synchronized = synchronizeBatch(state, batch, config, approvals);
      await saveState(statePath, synchronized.state);
      return synchronized;
    });
    process.stdout.write(`${stableStringify(result.report, 2)}\n`);
    if (reportPath) {
      try {
        await assertDistinctFileTargets(protectedPaths, statePath, reportPath);
        await writeJson(reportPath, result.report);
      } catch (error) {
        throw new BridgeError(
          "REPORT_WRITE_FAILED_AFTER_STATE_COMMIT",
          "state was committed but the sync report could not be written",
          { path: reportPath, stateCommitted: true },
        );
      }
    }
    return;
  }

  if (command === "review") {
    const statePath = requireOption(options, "state");
    const configPath = requireOption(options, "config");
    const approvalsPath = requireOption(options, "approvals");
    const reportPath = requireOption(options, "report");
    const protectedPaths = [configPath, approvalsPath, statePath, reportPath];
    await mkdir(dirname(statePath), { recursive: true });
    await mkdir(dirname(reportPath), { recursive: true });
    await assertDistinctFileTargets(protectedPaths, statePath, reportPath);
    const [config, approvals] = await Promise.all([
      readJson(configPath, "config"),
      readJson(approvalsPath, "approvals"),
    ]);
    const reviewed = await withStateLock(statePath, async () => {
      await assertDistinctFileTargets(protectedPaths, statePath, reportPath);
      const state = await loadState(statePath);
      const result = reviewPendingOutboxEvents(state, config, approvals);
      await saveState(statePath, result.state);
      return result;
    });
    const { assessment } = reviewed;
    process.stdout.write(`${stableStringify(reviewSummary(assessment), 2)}\n`);
    try {
      await assertDistinctFileTargets(protectedPaths, statePath, reportPath);
      await writeJson(reportPath, assessment);
    } catch (error) {
      throw new BridgeError(
        "REVIEW_REPORT_WRITE_FAILED_AFTER_STATE_COMMIT",
        "review watermark was committed but the assessment could not be written",
        { path: reportPath, stateCommitted: true },
      );
    }
    return;
  }

  if (command === "inspect") {
    const state = await loadState(requireOption(options, "state"));
    process.stdout.write(`${stableStringify(inspectState(state), 2)}\n`);
    return;
  }

  throw new BridgeError("INVALID_COMMAND", usage());
}

function safeErrorDetails(details) {
  if (!details || typeof details !== "object") {
    return {};
  }
  const allowed = new Set(["field", "index", "lockPath", "parameter", "path", "stateCommitted"]);
  return Object.fromEntries(Object.entries(details)
    .filter(([key]) => allowed.has(key))
    .map(([key, value]) => [
      key,
      typeof value === "string"
        ? value.replace(/[\r\n\t]/gu, " ").slice(0, 300)
        : value,
    ]));
}

main().catch((error) => {
  if (error instanceof BridgeError) {
    process.stderr.write(`${stableStringify({
      error: error.code,
      message: error.message,
      details: safeErrorDetails(error.details),
    }, 2)}\n`);
    process.exitCode = error.code.endsWith("_AFTER_STATE_COMMIT") ? 3 : 2;
    return;
  }
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
