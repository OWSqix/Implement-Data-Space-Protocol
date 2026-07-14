import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const EDC_BINDING_DIRECTORIES = [
  'deploy/edc',
  'tools/edc',
  'tests/edc',
];

export const EDC_BINDING_FILES = [
  '.gitattributes',
  'package.json',
  'package-lock.json',
  'contracts/edc-local-interoperability-run.v1.schema.json',
];

export const EDC_BINDING_SCOPE = [
  ...EDC_BINDING_DIRECTORIES,
  ...EDC_BINDING_FILES,
].join(', ') + '; excluding build and .gradle directories';

async function filesUnder(root, relative) {
  const base = path.join(root, relative);
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ['build', '.gradle'].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`EDC source binding rejects symbolic links: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  }
  await visit(base);
  return result;
}

export async function edcBindingFiles(root) {
  const directoryFiles = (await Promise.all(
    EDC_BINDING_DIRECTORIES.map((relative) => filesUnder(root, relative))
  )).flat();
  const files = [
    ...directoryFiles,
    ...EDC_BINDING_FILES.map((relative) => path.join(root, relative)),
  ].sort((left, right) => left.localeCompare(right, 'en'));
  for (const file of files) {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`EDC source binding requires a regular file: ${file}`);
  }
  return files;
}

export async function computeEdcSourceDigest(root) {
  const files = await edcBindingFiles(root);
  const hash = createHash('sha256');
  for (const absolute of files) {
    const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
    const bytes = await readFile(absolute);
    hash.update(relative, 'utf8');
    hash.update('\0');
    hash.update(String(bytes.length), 'ascii');
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return {
    algorithm: 'sha-256',
    digest: hash.digest('hex'),
    fileCount: files.length,
    scope: EDC_BINDING_SCOPE,
  };
}
