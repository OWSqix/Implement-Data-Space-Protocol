import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  completeRunEvidence,
  parseImageList,
  prepareRunEvidence,
  sha256Bytes,
  validateRunEvidence,
  writeJsonExclusive,
} from '../../tools/edc/record-smoke.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const head = '044dfda000000000000000000000000000000000';
const gitCapture = async () => ({ head, status: [], clean: true });
const dockerCapture = async () => ({
  server: { version: '25.0.3', operatingSystem: 'test', architecture: 'amd64' },
  composeVersion: 'v2.24.6',
});
const result = {
  ok: true,
  managementApi: 'v4',
  dsp: 'dataspace-protocol-http:2025-1',
  assetId: 'molit-edc-smoke-asset-541a39c5-880c-4645-8e4a-2f49c4135cb1',
  agreementId: 'cd1399bb-1793-490a-8458-fa4f640800f1',
  transferId: '993c66c7-0360-4eec-8cad-3e9b33d5fba8',
  startState: 'STARTED',
  finalState: 'TERMINATED',
  revokedStatus: 403,
  bytes: 96,
  contentType: 'application/json',
  sha256: '2f013648aa3071d46c9e29b2e938c5fb36336cc53f27d1f5e507da3683da41a7',
};
const stdoutBytes = Buffer.from(`${JSON.stringify(result)}\n`);
const images = [
  'provider-control-plane',
  'provider-data-plane',
  'consumer-control-plane',
  'consumer-data-plane',
].map((service, index) => ({ service, imageId: `sha256:${String(index + 1).repeat(64)}` }));

test('EDC raw evidence placeholder satisfies the strict run schema', async () => {
  const evidence = JSON.parse(await readFile(new URL('../../evidence/edc/runs/20260714T002009+0900-retrospective-placeholder.json', import.meta.url), 'utf8'));
  await validateRunEvidence(root, evidence);
});

test('EDC recorder binds a passing result to exact stdout and stable source bytes', async () => {
  const prepared = await prepareRunEvidence({
    root,
    command: 'test smoke command',
    now: () => new Date('2026-07-14T00:00:00Z'),
    gitCapture,
    dockerCapture,
  });
  const evidence = await completeRunEvidence({
    root,
    prepared,
    stdoutBytes,
    images,
    exitCode: 0,
    cleanStartStatus: 'pass',
    cleanupStatus: 'pass',
    now: () => new Date('2026-07-14T00:01:00Z'),
    gitCapture,
  });
  assert.equal(evidence.status, 'pass');
  assert.equal(evidence.execution.stdout.sha256, sha256Bytes(stdoutBytes));
  assert.deepEqual(evidence.execution.result, result);
  assert.equal(evidence.sourceStable, true);
});

test('EDC recorder refuses completion after the prepared source binding changes', async () => {
  const prepared = await prepareRunEvidence({
    root,
    command: 'test smoke command',
    gitCapture,
    dockerCapture,
  });
  prepared.sourceBinding.digest = '0'.repeat(64);
  await assert.rejects(
    completeRunEvidence({
      root,
      prepared,
      stdoutBytes,
      images,
      exitCode: 0,
      cleanStartStatus: 'pass',
      cleanupStatus: 'pass',
      gitCapture,
    }),
    /source binding changed/
  );
});

test('EDC recorder preserves non-JSON stdout for a failed smoke run', async () => {
  const prepared = await prepareRunEvidence({
    root,
    command: 'test failing smoke command',
    gitCapture,
    dockerCapture,
  });
  const evidence = await completeRunEvidence({
    root,
    prepared,
    stdoutBytes: Buffer.from('partial failure output\n'),
    images: [],
    exitCode: 1,
    cleanStartStatus: 'pass',
    cleanupStatus: 'pass',
    gitCapture,
  });
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.execution.result, null);
  assert.equal(evidence.execution.stdout.text, 'partial failure output\n');
  assert.match(evidence.execution.error, /not a JSON result/);
});

test('EDC recorder rejects malformed and duplicate Docker image captures', () => {
  assert.throws(() => parseImageList('provider-control-plane\tnot-a-digest\n'), /invalid recorded Docker image/);
  const line = `provider-control-plane\tsha256:${'a'.repeat(64)}`;
  assert.throws(() => parseImageList(`${line}\n${line}\n`), /duplicate recorded Docker image/);
});

test('EDC recorder never replaces an existing raw evidence path', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'molit-edc-evidence-write-'));
  const target = path.join(directory, 'run.json');
  try {
    await writeJsonExclusive(target, { first: true });
    await assert.rejects(writeJsonExclusive(target, { second: true }), { code: 'EEXIST' });
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { first: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
