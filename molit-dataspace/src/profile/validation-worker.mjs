import { parentPort, workerData } from "node:worker_threads";
import { validateProfileDocument } from "./validator.mjs";

function cloneableDetails(value) {
  if (value === undefined) return null;
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}

function serializedError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "PROFILE_VALIDATION_FAILED",
    details: cloneableDetails(error?.details),
    message: typeof error?.message === "string"
      ? error.message
      : "profile validation failed",
    name: typeof error?.name === "string" ? error.name : "Error",
  };
}

if (!parentPort) {
  throw new Error("validation worker requires a worker_threads parent port");
}

try {
  const report = await validateProfileDocument({
    inputPath: workerData.inputPath,
    profileName: workerData.profileName,
    version: workerData.version,
  });
  parentPort.postMessage({ report, type: "validation-result" });
} catch (error) {
  parentPort.postMessage({
    error: serializedError(error),
    type: "validation-error",
  });
} finally {
  parentPort.close();
}
