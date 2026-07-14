import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyTopology } from '../../tools/edc/verify-topology.mjs';

async function copyTopologyRoot(root) {
  await cp(new URL('../../deploy/edc', import.meta.url), path.join(root, 'deploy', 'edc'), {
    recursive: true,
    filter: (source) => !['build', '.gradle'].includes(path.basename(source)),
  });
  await cp(new URL('../../tools/edc', import.meta.url), path.join(root, 'tools', 'edc'), { recursive: true });
  await cp(new URL('../../tests/edc', import.meta.url), path.join(root, 'tests', 'edc'), { recursive: true });
  await cp(new URL('../../evidence/edc', import.meta.url), path.join(root, 'evidence', 'edc'), { recursive: true });
  await mkdir(path.join(root, 'contracts'), { recursive: true });
  await cp(new URL('../../contracts/edc-local-interoperability-run.v1.schema.json', import.meta.url), path.join(root, 'contracts', 'edc-local-interoperability-run.v1.schema.json'));
  await cp(new URL('../../package.json', import.meta.url), path.join(root, 'package.json'));
  await cp(new URL('../../package-lock.json', import.meta.url), path.join(root, 'package-lock.json'));
  await cp(new URL('../../.gitattributes', import.meta.url), path.join(root, '.gitattributes'));
}

test('EDC topology keeps production and smoke artifacts separate', async () => {
  const result = await verifyTopology();
  assert.equal(result.ok, true, result.failures.join('\n'));
});

test('EDC topology rejects a Gradle dependency version that differs from the upstream lock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molit-edc-topology-'));
  try {
    await copyTopologyRoot(root);
    const properties = path.join(root, 'deploy', 'edc', 'runtime', 'gradle.properties');
    const source = await readFile(properties, 'utf8');
    await writeFile(properties, source.replace('edcVersion=0.18.0', 'edcVersion=0.19.0'));

    const result = await verifyTopology(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes('Gradle edcVersion differs from the EDC upstream lock'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('EDC topology accepts a source tree without the optional production source directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molit-edc-topology-clean-'));
  try {
    await copyTopologyRoot(root);
    await rm(path.join(root, 'deploy', 'edc', 'runtime', 'data-plane', 'src'), {
      recursive: true,
      force: true,
    });

    const result = await verifyTopology(root);
    assert.equal(result.ok, true, result.failures.join('\n'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('EDC topology rejects evidence after an EDC test definition changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molit-edc-topology-evidence-'));
  try {
    await copyTopologyRoot(root);
    const testPath = path.join(root, 'tests', 'edc', 'smoke-helpers.test.mjs');
    await writeFile(testPath, `${await readFile(testPath, 'utf8')}\n// changed test definition\n`);

    const result = await verifyTopology(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes('EDC runtime evidence is not bound to the current EDC source, test, command and checkout-policy tree'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [name, relative] of [['npm command definition', 'package.json'], ['npm dependency lock', 'package-lock.json'], ['checkout EOL policy', '.gitattributes']]) {
  test(`EDC topology rejects evidence after the ${name} changes`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'molit-edc-topology-command-'));
    try {
      await copyTopologyRoot(root);
      const target = path.join(root, relative);
      await writeFile(target, `${await readFile(target, 'utf8')}\n`);
      const result = await verifyTopology(root);
      assert.equal(result.ok, false);
      assert.ok(result.failures.includes('EDC runtime evidence is not bound to the current EDC source, test, command and checkout-policy tree'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('EDC topology rejects a shell runner whose main path no longer performs clean-start', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molit-edc-topology-clean-start-'));
  try {
    await copyTopologyRoot(root);
    const target = path.join(root, 'tools', 'edc', 'run-smoke.sh');
    const source = await readFile(target, 'utf8');
    await writeFile(target, source.replace('\ndocker compose -f "$compose" -f "$overlay" down --volumes --remove-orphans\nclean_start_status=', '\nclean_start_status='));
    const result = await verifyTopology(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes('smoke runner does not remove project volumes before startup'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PowerShell smoke evidence records stdout as UTF-8 without a BOM', async () => {
  const source = await readFile(new URL('../../tools/edc/run-smoke.ps1', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Tee-Object\s+-FilePath\s+\$stdoutFile/u);
  assert.match(source, /WriteAllText\(\$stdoutFile, \$smokeText, \[Text\.UTF8Encoding\]::new\(\$false\)\)/u);
});

test('EDC topology rejects raw run evidence whose bytes no longer match the summary reference', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molit-edc-topology-run-digest-'));
  try {
    await copyTopologyRoot(root);
    const target = path.join(root, 'evidence', 'edc', 'runs', '20260714T002009+0900-retrospective-placeholder.json');
    await writeFile(target, `${await readFile(target, 'utf8')}\n`);
    const result = await verifyTopology(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes('EDC run evidence reference digest does not match the raw artifact'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('EDC topology rejects an extra field in strict raw run evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molit-edc-topology-run-schema-'));
  try {
    await copyTopologyRoot(root);
    const target = path.join(root, 'evidence', 'edc', 'runs', '20260714T002009+0900-retrospective-placeholder.json');
    const evidence = JSON.parse(await readFile(target, 'utf8'));
    evidence.unexpected = true;
    await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`);
    const result = await verifyTopology(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure) => failure.includes('EDC run evidence schema violation')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('EDC topology rejects a summary result that differs from the referenced raw run', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molit-edc-topology-run-result-'));
  try {
    await copyTopologyRoot(root);
    const target = path.join(root, 'evidence', 'edc', 'local-interoperability-status.v1.json');
    const evidence = JSON.parse(await readFile(target, 'utf8'));
    evidence.runEvidence.result.bytes += 1;
    await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`);
    const result = await verifyTopology(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes('EDC run evidence summary result differs from the raw artifact'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
