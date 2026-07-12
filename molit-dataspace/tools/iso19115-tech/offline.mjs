import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, runOfficialSmoke, verifyCache } from "./lib.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const command = process.argv[2];
const manifestPath = path.resolve(root, argument(
  "--manifest",
  "standards/iso19115-1-tech-gate/manifest.json",
));
const cacheRoot = path.resolve(root, argument(
  "--cache",
  ".local/iso19115-1-tech-gate",
));

if (!new Set(["verify", "smoke"]).has(command)) {
  process.stderr.write("Usage: node tools/iso19115-tech/offline.mjs <verify|smoke> [--manifest path] [--cache path]\n");
  process.exitCode = 2;
} else {
  globalThis.fetch = () => {
    throw new Error("network access is disabled in the offline ISO 19115 Gate");
  };
  await access(manifestPath);
  const manifest = await loadManifest(manifestPath);
  try {
    await access(path.join(cacheRoot, "artifacts"));
  } catch {
    throw new Error(`approved private cache is missing; release Gate remains blocked: ${cacheRoot}`);
  }
  if (command === "verify") {
    const contents = await verifyCache(manifest, cacheRoot);
    process.stdout.write(`${JSON.stringify({ valid: true, artifactCount: contents.size }, null, 2)}\n`);
  } else {
    const result = await runOfficialSmoke(manifest, cacheRoot);
    process.stdout.write(`${JSON.stringify({ valid: true, ...result }, null, 2)}\n`);
  }
}
