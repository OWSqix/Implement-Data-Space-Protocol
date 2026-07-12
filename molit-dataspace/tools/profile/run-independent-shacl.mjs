#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./independent_shacl.py", import.meta.url));

const candidates = process.platform === "win32"
  ? [{ command: "py", prefix: ["-3.12"] }]
  : [
      ...(process.env.PYTHON
        ? [{ command: process.env.PYTHON, prefix: [] }]
        : []),
      { command: "python3", prefix: [] },
      { command: "python", prefix: [] },
    ];

let selected = null;
for (const candidate of candidates) {
  const probe = spawnSync(
    candidate.command,
    [...candidate.prefix, "-I", "-B", "-c", "import sys; raise SystemExit(0)"],
    {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      shell: false,
      windowsHide: true,
    },
  );
  if (!probe.error && probe.status === 0) {
    selected = candidate;
    break;
  }
}

if (!selected) {
  process.stderr.write("No supported Python launcher was found for the independent SHACL lane.\n");
  process.exitCode = 1;
} else {
  const result = spawnSync(
    selected.command,
    [...selected.prefix, "-I", "-B", scriptPath],
    {
      cwd: path.dirname(scriptPath),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exitCode = 1;
  } else if (result.signal) {
    process.stderr.write(`Independent SHACL lane terminated by ${result.signal}.\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
