import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { serializationPythonEnvironment } from "../../tools/profile/run-rc-serialization-parity.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const releaseRoot = path.join(root, "profiles/molit-dcat-ap/releases/1.0.0-rc.1");
const input = path.join(releaseRoot, "examples/valid/core-catalog.ttl");
const worker = path.join(root, "tools/profile/rc_serialization_parity.py");

function selectPython() {
  const candidates = process.platform === "win32"
    ? [["py", ["-3.12"]]]
    : [
      ...(process.env.PYTHON ? [[process.env.PYTHON, []]] : []),
      ["python3", []],
      ["python", []],
    ];
  for (const [command, prefix] of candidates) {
    const result = spawnSync(command, [
      ...prefix,
      "-I",
      "-B",
      "-c",
      "import rdflib; raise SystemExit(0 if rdflib.__version__ == '7.6.0' else 1)",
    ], { encoding: "utf8", shell: false, windowsHide: true });
    if (!result.error && result.status === 0) return { command, prefix };
  }
  return null;
}

const python = selectPython();

test("RC-SERIALIZATION-DETERMINISM-001: the worker environment fixes Python hashing", () => {
  const environment = serializationPythonEnvironment({
    PYTHONHASHSEED: "random",
    TEMP: "C:/deterministic-temp",
  });
  assert.equal(environment.PYTHONHASHSEED, "0");
  assert.equal(environment.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(environment.PYTHONIOENCODING, "utf-8");
});

test("RC-SERIALIZATION-DETERMINISM-002: separate worker processes emit identical byte digests", {
  skip: python ? false : "pinned RDFLib 7.6.0 Python is unavailable",
}, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "molit-serialization-determinism-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const runWorker = async (name, environment) => {
    const outputRoot = path.join(directory, name);
    await mkdir(outputRoot);
    const request = JSON.stringify({
      schemaVersion: "molit.rc-serialization-request/1",
      releaseRoot,
      outputRoot,
      cases: [{ id: "DETERMINISM", input }],
    });
    return spawnSync(python.command, [
      ...python.prefix,
      "-s",
      "-P",
      "-B",
      worker,
    ], {
      cwd: root,
      encoding: "utf8",
      env: environment,
      input: request,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    });
  };
  const environment = serializationPythonEnvironment(process.env);
  const first = await runWorker("first", environment);
  const second = await runWorker("second", environment);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const firstConversions = JSON.parse(first.stdout).results[0].conversions;
  const secondConversions = JSON.parse(second.stdout).results[0].conversions;
  assert.deepEqual(
    secondConversions.map(({ bytes, format, sha256 }) => ({ bytes, format, sha256 })),
    firstConversions.map(({ bytes, format, sha256 }) => ({ bytes, format, sha256 })),
  );

  const unpinned = await runWorker("unpinned", {
    ...environment,
    PYTHONHASHSEED: "1",
  });
  assert.notEqual(unpinned.status, 0);
  assert.match(unpinned.stderr, /requires PYTHONHASHSEED=0/u);
});
