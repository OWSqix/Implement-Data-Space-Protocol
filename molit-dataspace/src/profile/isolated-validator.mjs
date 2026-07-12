import { Worker } from "node:worker_threads";
import { assertLocalFilesystemPath } from "./local-path.mjs";
import { loadProfileRelease } from "./registry.mjs";

export const legacyValidationIsolationLimits = Object.freeze({
  maxValidationMillis: 30_000,
  maxWorkerHeapMb: 256,
});

function failure(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function assertWorkerLimits(maxValidationMillis, maxWorkerHeapMb) {
  if (!Number.isSafeInteger(maxValidationMillis)
    || maxValidationMillis < 10
    || maxValidationMillis > 120_000
    || !Number.isSafeInteger(maxWorkerHeapMb)
    || maxWorkerHeapMb < 32
    || maxWorkerHeapMb > 1_024) {
    throw failure(
      "INVALID_VALIDATION_ISOLATION_LIMITS",
      "validation worker limits are outside the supported range",
      { maxValidationMillis, maxWorkerHeapMb },
    );
  }
}

export function validationIsolationLimits(manifest) {
  return {
    maxValidationMillis: manifest.limits.maxValidationMillis
      ?? legacyValidationIsolationLimits.maxValidationMillis,
    maxWorkerHeapMb: manifest.limits.maxWorkerHeapMb
      ?? legacyValidationIsolationLimits.maxWorkerHeapMb,
  };
}

function workerFailure(error) {
  if (error?.code === "ERR_WORKER_OUT_OF_MEMORY") {
    return failure(
      "PROFILE_VALIDATION_HEAP_LIMIT",
      "profile validation exceeded the worker V8 heap limit",
    );
  }
  return failure(
    "PROFILE_VALIDATION_WORKER_CRASH",
    "profile validation worker crashed",
    { workerCode: error?.code ?? null },
  );
}

function restoredValidationError(serialized) {
  const error = new Error(serialized?.message ?? "profile validation failed");
  error.name = serialized?.name ?? "Error";
  error.code = serialized?.code ?? "PROFILE_VALIDATION_FAILED";
  error.details = serialized?.details ?? null;
  return error;
}

export function runValidationWorker({
  maxValidationMillis,
  maxWorkerHeapMb,
  workerData,
  workerUrl,
}) {
  assertWorkerLimits(maxValidationMillis, maxWorkerHeapMb);
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(workerUrl, {
        execArgv: [],
        name: "molit-profile-validation",
        resourceLimits: {
          maxOldGenerationSizeMb: maxWorkerHeapMb,
          stackSizeMb: 4,
        },
        workerData,
      });
    } catch (cause) {
      reject(workerFailure(cause));
      return;
    }

    let settled = false;
    const finish = (callback, value, terminate = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      if (terminate) void worker.terminate().catch(() => {});
      callback(value);
    };
    const timer = setTimeout(() => {
      finish(
        reject,
        failure(
          "PROFILE_VALIDATION_TIMEOUT",
          "profile validation exceeded the wall-clock limit",
          { maxValidationMillis },
        ),
        true,
      );
    }, maxValidationMillis);

    worker.once("message", (message) => {
      if (message?.type === "validation-result" && message.report !== undefined) {
        finish(resolve, message.report);
        return;
      }
      if (message?.type === "validation-error") {
        finish(reject, restoredValidationError(message.error));
        return;
      }
      finish(
        reject,
        failure(
          "PROFILE_VALIDATION_WORKER_PROTOCOL",
          "profile validation worker returned an invalid message",
        ),
        true,
      );
    });
    worker.once("error", (error) => finish(reject, workerFailure(error)));
    worker.once("exit", (code) => {
      if (!settled) {
        finish(
          reject,
          failure(
            "PROFILE_VALIDATION_WORKER_CRASH",
            "profile validation worker exited without a result",
            { exitCode: code },
          ),
        );
      }
    });
  });
}

export async function validateProfileDocumentIsolated({
  inputPath,
  profileName = "core",
  version,
}) {
  assertLocalFilesystemPath(inputPath, "input path");
  const release = await loadProfileRelease(version);
  const limits = validationIsolationLimits(release.manifest);
  return runValidationWorker({
    ...limits,
    workerData: {
      inputPath,
      profileName,
      version: release.version,
    },
    workerUrl: new URL("./validation-worker.mjs", import.meta.url),
  });
}
