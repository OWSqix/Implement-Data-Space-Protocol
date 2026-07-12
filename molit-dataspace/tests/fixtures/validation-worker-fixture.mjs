import {
  parentPort,
  resourceLimits,
  workerData,
} from "node:worker_threads";

if (workerData.action === "hang") {
  await new Promise(() => setInterval(() => {}, 1_000));
} else if (workerData.action === "crash") {
  throw Object.assign(new Error("intentional worker crash"), {
    code: "TEST_WORKER_CRASH",
  });
} else if (workerData.action === "limits") {
  parentPort.postMessage({
    report: {
      maxOldGenerationSizeMb: resourceLimits.maxOldGenerationSizeMb,
      stackSizeMb: resourceLimits.stackSizeMb,
    },
    type: "validation-result",
  });
} else {
  parentPort.postMessage({ report: { alive: true }, type: "validation-result" });
}
