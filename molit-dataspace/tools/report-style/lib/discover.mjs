import fs from "node:fs";
import path from "node:path";
import { matchesAny, normalizePath } from "./config.mjs";

function walk(entryPath, rootDirectory, rootRealPath, ignorePatterns, output, visitedDirectories) {
  const entryRealPath = fs.realpathSync.native(entryPath);
  const containment = path.relative(rootRealPath, entryRealPath);
  if (path.isAbsolute(containment) || containment === ".." || containment.startsWith(".." + path.sep)) {
    throw new Error("Resolved input leaves configuration root: " + entryPath);
  }

  const stat = fs.statSync(entryPath);
  const relative = normalizePath(path.relative(rootDirectory, entryPath));

  if (relative && matchesAny(relative, ignorePatterns)) {
    return;
  }

  if (stat.isDirectory()) {
    if (visitedDirectories.has(entryRealPath)) {
      return;
    }
    visitedDirectories.add(entryRealPath);
    const name = path.basename(entryPath);
    if (name === ".git" || name === "node_modules") {
      return;
    }

    for (const child of fs.readdirSync(entryPath).sort()) {
      walk(
        path.join(entryPath, child),
        rootDirectory,
        rootRealPath,
        ignorePatterns,
        output,
        visitedDirectories
      );
    }
    return;
  }

  if (stat.isFile() && entryPath.toLowerCase().endsWith(".md")) {
    output.push(path.resolve(entryPath));
  }
}

export function discoverMarkdownFiles(inputs, rootDirectory, ignorePatterns = []) {
  const requested = inputs.length > 0 ? inputs : [];
  const output = [];
  const rootRealPath = fs.realpathSync.native(rootDirectory);
  const visitedDirectories = new Set();

  for (const input of requested) {
    const resolved = path.resolve(rootDirectory, input);
    if (!fs.existsSync(resolved)) {
      throw new Error("Input path does not exist: " + input);
    }
    walk(resolved, rootDirectory, rootRealPath, ignorePatterns, output, visitedDirectories);
  }

  return [...new Set(output)].sort((left, right) => left.localeCompare(right));
}
