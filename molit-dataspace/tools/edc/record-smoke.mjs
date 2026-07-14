import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { link, open, readFile, rm, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  computeEdcSourceDigest,
  EDC_BINDING_DIRECTORIES,
  EDC_BINDING_FILES,
} from './source-binding.mjs';

const execFileAsync = promisify(execFile);
const ownPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(ownPath), '..', '..');
const MAX_CAPTURE_BYTES = 1024 * 1024;
const LIMITATIONS = [
  'same Eclipse EDC Connector implementation on both participants',
  'DSP official TCK and cross-implementation interoperability not executed',
  'production DPS worker, identity, trust anchors and public delivery service not verified',
  'Maven dependency verification, SBOM, image signature and license inventory not complete',
];

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameBinding(left, right) {
  return left?.algorithm === right?.algorithm
    && left?.digest === right?.digest
    && left?.fileCount === right?.fileCount
    && left?.scope === right?.scope;
}

function lines(value) {
  return value.split('\0').filter(Boolean);
}

async function execute(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: defaultRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 15_000,
    windowsHide: true,
    ...options,
  });
}

export async function captureGit(root = defaultRoot, run = execute) {
  const [{ stdout: headOutput }, { stdout: statusOutput }] = await Promise.all([
    run('git', ['-C', root, 'rev-parse', 'HEAD'], { cwd: root }),
    run('git', [
      '-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--',
      ...EDC_BINDING_DIRECTORIES, ...EDC_BINDING_FILES,
    ], { cwd: root }),
  ]);
  const head = headOutput.trim();
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error('EDC evidence requires a SHA-1 Git HEAD');
  const status = lines(statusOutput);
  return { head, status, clean: status.length === 0 };
}

export async function captureDocker(root = defaultRoot, run = execute) {
  const [{ stdout: serverOutput }, { stdout: composeOutput }] = await Promise.all([
    run('docker', ['version', '--format', '{{json .Server}}'], { cwd: root }),
    run('docker', ['compose', 'version', '--short'], { cwd: root }),
  ]);
  const server = JSON.parse(serverOutput);
  if (!server?.Version) throw new Error('Docker server metadata is unavailable');
  return {
    server: {
      version: String(server.Version),
      operatingSystem: server.Os ? String(server.Os) : null,
      architecture: server.Arch ? String(server.Arch) : null,
    },
    composeVersion: composeOutput.trim(),
  };
}

export async function writeJsonExclusive(pathname, value) {
  const temporary = `${pathname}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, pathname);
    await unlink(temporary);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function checkedEvidenceOutput(root, value) {
  const evidenceRoot = path.resolve(root, 'evidence', 'edc', 'runs');
  const output = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  const relative = path.relative(evidenceRoot, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(output) !== '.json') {
    throw new Error('recorded EDC evidence output must be a JSON file below evidence/edc/runs');
  }
  return output;
}

async function readBounded(pathname) {
  const bytes = await readFile(pathname);
  if (bytes.length > MAX_CAPTURE_BYTES) throw new Error(`EDC evidence input exceeds ${MAX_CAPTURE_BYTES} bytes: ${pathname}`);
  return bytes;
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

export function parseSmokeStdout(bytes, captureMode = 'runner-captured', allowInvalid = false) {
  const text = decodeUtf8(bytes, 'smoke stdout');
  let result = null;
  if (text.trim()) {
    try { result = JSON.parse(text.trim()); }
    catch {
      if (!allowInvalid) throw new Error('smoke stdout is not one JSON result');
    }
  }
  return {
    stdout: {
      captureMode,
      encoding: 'utf-8',
      sha256: sha256Bytes(bytes),
      byteLength: bytes.length,
      text,
    },
    result,
  };
}

export function parseImageList(text) {
  const images = [];
  const services = new Set();
  for (const line of text.split(/\r?\n/u).filter(Boolean)) {
    const [service, imageId, extra] = line.split('\t');
    if (extra !== undefined || !service || !/^sha256:[0-9a-f]{64}$/u.test(imageId ?? '')) {
      throw new Error(`invalid recorded Docker image line: ${line}`);
    }
    if (services.has(service)) throw new Error(`duplicate recorded Docker image service: ${service}`);
    services.add(service);
    images.push({ service, imageId });
  }
  return images.sort((left, right) => left.service.localeCompare(right.service, 'en'));
}

export async function validateRunEvidence(root, evidence) {
  const schema = JSON.parse(await readFile(path.join(root, 'contracts', 'edc-local-interoperability-run.v1.schema.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(evidence)) {
    const detail = validate.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`EDC run evidence schema violation: ${detail}`);
  }
  const bytes = Buffer.from(evidence.execution.stdout.text, 'utf8');
  if (bytes.length !== evidence.execution.stdout.byteLength
    || sha256Bytes(bytes) !== evidence.execution.stdout.sha256) {
    throw new Error('EDC run evidence stdout digest or length does not match its exact text');
  }
  if (evidence.execution.result !== null) {
    let parsed;
    try { parsed = JSON.parse(evidence.execution.stdout.text.trim()); }
    catch { throw new Error('EDC run evidence stdout cannot be parsed'); }
    if (JSON.stringify(parsed) !== JSON.stringify(evidence.execution.result)) {
      throw new Error('EDC run evidence result differs from the captured stdout');
    }
  }
  return evidence;
}

export async function prepareRunEvidence({ root = defaultRoot, command, now = () => new Date(), gitCapture = captureGit, dockerCapture = captureDocker } = {}) {
  if (!command || command.length > 1000) throw new Error('recorded command is required');
  const [sourceBinding, git, docker] = await Promise.all([
    computeEdcSourceDigest(root),
    gitCapture(root),
    dockerCapture(root),
  ]);
  return {
    prepareVersion: 1,
    runId: randomUUID(),
    startedAt: now().toISOString(),
    command,
    sourceBinding,
    git,
    docker,
  };
}

export async function completeRunEvidence({
  root = defaultRoot,
  prepared,
  stdoutBytes,
  images,
  exitCode,
  cleanStartStatus,
  cleanupStatus,
  error = null,
  now = () => new Date(),
  gitCapture = captureGit,
} = {}) {
  if (prepared?.prepareVersion !== 1) throw new Error('invalid EDC evidence prepare state');
  const [sourceBinding, git] = await Promise.all([computeEdcSourceDigest(root), gitCapture(root)]);
  if (!sameBinding(prepared.sourceBinding, sourceBinding)) {
    throw new Error('EDC source binding changed between evidence prepare and complete');
  }
  const parsed = parseSmokeStdout(stdoutBytes, 'runner-captured', exitCode !== 0);
  const pass = exitCode === 0
    && cleanStartStatus === 'pass'
    && ['pass', 'kept'].includes(cleanupStatus)
    && parsed.result?.ok === true;
  const evidence = {
    schemaVersion: 'molit.edc-local-interoperability-run/1',
    recordingMode: 'recorder',
    runId: prepared.runId,
    status: pass ? 'pass' : 'failed',
    startedAt: prepared.startedAt,
    completedAt: now().toISOString(),
    command: prepared.command,
    sourceBinding,
    sourceStable: true,
    git: {
      captured: true,
      headAtStart: prepared.git.head,
      headAtEnd: git.head,
      scopedPaths: [...EDC_BINDING_DIRECTORIES, ...EDC_BINDING_FILES],
      statusAtStart: prepared.git.status,
      statusAtEnd: git.status,
      cleanAtStart: prepared.git.clean,
      cleanAtEnd: git.clean,
    },
    docker: {
      captured: true,
      server: prepared.docker.server,
      composeVersion: prepared.docker.composeVersion,
      images,
    },
    cleanStart: { attempted: cleanStartStatus !== 'not-run', status: cleanStartStatus },
    cleanup: { attempted: !['not-run', 'kept'].includes(cleanupStatus), status: cleanupStatus },
    execution: {
      exitCode,
      stdout: parsed.stdout,
      result: parsed.result,
      error: error ?? (exitCode !== 0 && parsed.result === null && parsed.stdout.text.trim()
        ? 'smoke stdout was not a JSON result'
        : null),
    },
    limitations: LIMITATIONS,
  };
  await validateRunEvidence(root, evidence);
  return evidence;
}

function parseOptions(args, definitions) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!Object.hasOwn(definitions, name)) throw new Error(`unknown EDC evidence option: ${name}`);
    if (Object.hasOwn(options, name)) throw new Error(`duplicate EDC evidence option: ${name}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`EDC evidence option requires a value: ${name}`);
    options[name] = value;
    index += 1;
  }
  for (const [name, required] of Object.entries(definitions)) {
    if (required && options[name] === undefined) throw new Error(`missing EDC evidence option: ${name}`);
  }
  return options;
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === 'prepare') {
    const options = parseOptions(rest, { '--state': true, '--command': true });
    const prepared = await prepareRunEvidence({ command: options['--command'] });
    await writeJsonExclusive(path.resolve(options['--state']), prepared);
    process.stdout.write(`${JSON.stringify({ runId: prepared.runId, sourceBinding: prepared.sourceBinding })}\n`);
    return;
  }
  if (command === 'complete') {
    const options = parseOptions(rest, {
      '--state': true, '--stdout': true, '--images': true, '--output': true,
      '--exit-code': true, '--clean-start': true, '--cleanup': true, '--error-file': false,
    });
    const prepared = JSON.parse(decodeUtf8(await readBounded(path.resolve(options['--state'])), 'prepare state'));
    const stdoutBytes = await readBounded(path.resolve(options['--stdout']));
    const imageText = decodeUtf8(await readBounded(path.resolve(options['--images'])), 'image list');
    const error = options['--error-file']
      ? decodeUtf8(await readBounded(path.resolve(options['--error-file'])), 'error detail').trim() || null
      : null;
    const exitCode = Number(options['--exit-code']);
    if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new Error('invalid recorded exit code');
    const evidence = await completeRunEvidence({
      prepared,
      stdoutBytes,
      images: parseImageList(imageText),
      exitCode,
      cleanStartStatus: options['--clean-start'],
      cleanupStatus: options['--cleanup'],
      error,
    });
    const output = checkedEvidenceOutput(defaultRoot, options['--output']);
    await writeJsonExclusive(output, evidence);
    const bytes = await readFile(output);
    process.stdout.write(`${JSON.stringify({ path: path.relative(defaultRoot, output).replaceAll(path.sep, '/'), sha256: sha256Bytes(bytes), result: evidence.status })}\n`);
    return;
  }
  if (command === 'verify') {
    const options = parseOptions(rest, { '--input': true });
    const input = checkedEvidenceOutput(defaultRoot, options['--input']);
    await validateRunEvidence(defaultRoot, JSON.parse(decodeUtf8(await readBounded(input), 'run evidence')));
    process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
    return;
  }
  throw new Error('usage: record-smoke.mjs prepare|complete|verify [options]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`EDC evidence recorder failed: ${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
