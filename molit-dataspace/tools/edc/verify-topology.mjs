import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { computeEdcSourceDigest } from './source-binding.mjs';
import { sha256Bytes, validateRunEvidence } from './record-smoke.mjs';

export { computeEdcSourceDigest } from './source-binding.mjs';

const ownPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(ownPath), '..', '..');

async function text(root, relative) {
  return readFile(path.join(root, relative), 'utf8');
}

async function sha256(root, relative) {
  const bytes = await readFile(path.join(root, relative));
  return createHash('sha256').update(bytes).digest('hex');
}

async function filesUnder(root, relative) {
  const base = path.join(root, relative);
  const result = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === base && error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  }
  await visit(base);
  return result;
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

async function verifyRunReference(root, evidence, sourceBinding, failures) {
  const reference = evidence.runEvidence;
  const relative = reference?.path;
  if (typeof relative !== 'string'
    || !/^evidence\/edc\/runs\/[A-Za-z0-9][A-Za-z0-9+._-]*[.]json$/u.test(relative)) {
    failures.push('EDC run evidence reference is absent or escapes evidence/edc/runs');
    return;
  }
  let bytes;
  let run;
  try {
    bytes = await readFile(path.join(root, ...relative.split('/')));
    if (bytes.length > 1024 * 1024) throw new Error('run evidence exceeds 1 MiB');
    run = JSON.parse(bytes.toString('utf8'));
    await validateRunEvidence(root, run);
  } catch (error) {
    failures.push(`EDC run evidence is invalid: ${error.message}`);
    return;
  }
  assert(reference.sha256 === sha256Bytes(bytes), 'EDC run evidence reference digest does not match the raw artifact', failures);
  assert(reference.status === run.status, 'EDC run evidence summary status differs from the raw artifact', failures);
  assert(isDeepStrictEqual(reference.result, run.execution.result), 'EDC run evidence summary result differs from the raw artifact', failures);
  assert(isDeepStrictEqual(evidence.runtimeExecution?.result, run.execution.result), 'EDC runtime summary result differs from the raw artifact', failures);
  if (run.recordingMode === 'recorder' && run.status === 'pass') {
    assert(run.sourceStable === true
      && run.sourceBinding.algorithm === sourceBinding.algorithm
      && run.sourceBinding.digest === sourceBinding.digest
      && run.sourceBinding.fileCount === sourceBinding.fileCount
      && run.sourceBinding.scope === sourceBinding.scope,
    'passing EDC run evidence is not bound to the current source tree', failures);
    assert(evidence.runtimeExecution?.status === 'pass', 'passing raw EDC evidence is not reflected as pass in the summary', failures);
  } else {
    assert(run.recordingMode === 'retrospective-placeholder' && run.status === 'pending-rerun', 'non-passing EDC evidence must be an explicit pending-rerun placeholder', failures);
    assert(evidence.runtimeExecution?.status === 'pending-recorder-rerun', 'retrospective EDC evidence must keep the runtime summary pending', failures);
  }
}

export async function verifyTopology(root = defaultRoot) {
  const failures = [];
  const required = [
    'deploy/edc/Dockerfile',
    'deploy/edc/compose.yaml',
    'deploy/edc/compose.smoke.yaml',
    'deploy/edc/upstream-lock.json',
    'deploy/edc/runtime-artifacts.v1.json',
    'deploy/edc/database-schema/migration-manifest.v1.json',
    'deploy/edc/database-schema/run-schema-migration.sh',
    'deploy/edc/database-schema/run-postgres-verification.ps1',
    'deploy/edc/THIRD_PARTY_NOTICES.md',
    'deploy/edc/licenses/Apache-2.0.txt',
    'deploy/edc/runtime/build.gradle.kts',
    'deploy/edc/runtime/gradle.properties',
    'deploy/edc/runtime/control-plane/build.gradle.kts',
    'deploy/edc/runtime/smoke-control-plane/build.gradle.kts',
    'deploy/edc/runtime/gradlew',
    'deploy/edc/config/provider-control-plane.properties',
    'deploy/edc/config/provider-data-plane.properties',
    'deploy/edc/config/provider-data-plane-smoke.properties',
    'deploy/edc/config/consumer-control-plane.properties',
    'deploy/edc/config/consumer-data-plane.properties',
    'deploy/edc/postgres/init/00-create-databases.sql',
    'tools/edc/smoke.mjs',
    'evidence/edc/local-interoperability-status.v1.json',
    'evidence/edc/schema-migration-postgres.v1.json',
    'contracts/edc-schema-postgres-verification.v1.schema.json'
  ];
  const loaded = new Map();
  for (const relative of required) {
    try { loaded.set(relative, await text(root, relative)); }
    catch (error) { failures.push(`missing ${relative}: ${error.code ?? error.message}`); }
  }
  if (failures.length) return { ok: false, failures };

  const dockerfile = loaded.get('deploy/edc/Dockerfile');
  const compose = loaded.get('deploy/edc/compose.yaml');
  const overlay = loaded.get('deploy/edc/compose.smoke.yaml');
  const smoke = loaded.get('tools/edc/smoke.mjs');
  const smokeRunnerPowerShell = await text(root, 'tools/edc/run-smoke.ps1');
  const smokeRunnerShell = await text(root, 'tools/edc/run-smoke.sh');
  const lock = JSON.parse(loaded.get('deploy/edc/upstream-lock.json'));
  const runtimeArtifacts = JSON.parse(loaded.get('deploy/edc/runtime-artifacts.v1.json'));
  const migrationManifest = JSON.parse(loaded.get('deploy/edc/database-schema/migration-manifest.v1.json'));
  const migrationRunner = loaded.get('deploy/edc/database-schema/run-schema-migration.sh');
  const thirdPartyNotices = loaded.get('deploy/edc/THIRD_PARTY_NOTICES.md');
  const runtimeBuild = loaded.get('deploy/edc/runtime/build.gradle.kts');
  const gradleProperties = loaded.get('deploy/edc/runtime/gradle.properties');
  const controlPlaneBuild = loaded.get('deploy/edc/runtime/control-plane/build.gradle.kts');
  const smokeControlPlaneBuild = loaded.get('deploy/edc/runtime/smoke-control-plane/build.gradle.kts');
  const gradleLauncher = loaded.get('deploy/edc/runtime/gradlew');
  const dataPlaneBuild = await text(root, 'deploy/edc/runtime/data-plane/build.gradle.kts');
  const smokeController = await text(root, 'deploy/edc/runtime/smoke-data-plane/src/main/java/org/eclipse/edc/molit/smoke/SmokeProxyController.java');
  const productionDataPlaneFiles = await filesUnder(root, 'deploy/edc/runtime/data-plane/src');
  const productionDataPlaneSource = `${dataPlaneBuild}\n${(await Promise.all(productionDataPlaneFiles.map((file) => readFile(file, 'utf8')))).join('\n')}`;
  const evidence = JSON.parse(loaded.get('evidence/edc/local-interoperability-status.v1.json'));
  const schemaMigrationEvidence = JSON.parse(loaded.get('evidence/edc/schema-migration-postgres.v1.json'));
  const schemaMigrationEvidenceSchema = JSON.parse(loaded.get('contracts/edc-schema-postgres-verification.v1.schema.json'));
  const sourceBinding = await computeEdcSourceDigest(root);
  const schemaAjv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(schemaAjv);
  const validateSchemaMigrationEvidence = schemaAjv.compile(schemaMigrationEvidenceSchema);

  assert(lock.eclipseEdc.version === '0.18.0', 'EDC lock must pin 0.18.0', failures);
  assert(runtimeArtifacts.schemaVersion === 'molit.edc-runtime-artifacts/1'
    && runtimeArtifacts.releaseStatus === 'production-blocked',
  'EDC runtime artifact release register is absent or does not fail closed', failures);
  for (const artifact of ['control-plane', 'data-plane', 'smoke-control-plane', 'smoke-data-plane']) {
    assert(runtimeArtifacts.artifacts?.[artifact]?.dockerTarget === artifact
      && runtimeArtifacts.artifacts[artifact].productionEligible === false,
    `EDC artifact is not explicitly blocked from production promotion: ${artifact}`, failures);
  }
  const schemaArtifact = runtimeArtifacts.artifacts?.['schema-migration'];
  assert(schemaArtifact?.dockerTarget === 'schema-migration'
    && schemaArtifact.productionEligible === true
    && schemaArtifact.eligibilityMode === 'signed-admission-only'
    && schemaArtifact.requiredAdmissionPolicy === 'molit-verify-release-images'
    && schemaArtifact.requiredAttestationPredicateType === 'https://data.molit.go.kr/attestations/release-bundle/v1'
    && schemaArtifact.blockers?.length === 0,
  'EDC schema migration artifact lacks its conditional production eligibility gate', failures);
  assert(schemaArtifact?.verificationEvidence?.path === 'evidence/edc/schema-migration-postgres.v1.json'
    && schemaArtifact.verificationEvidence.sha256 === await sha256(root, 'evidence/edc/schema-migration-postgres.v1.json')
    && validateSchemaMigrationEvidence(schemaMigrationEvidence)
    && schemaMigrationEvidence.schemaVersion === 'molit.edc-schema-postgres-verification/1'
    && schemaMigrationEvidence.status === 'pass'
    && schemaMigrationEvidence.execution?.cycles === 2
    && schemaMigrationEvidence.execution?.totalSuccessfulRuns === 4
    && schemaMigrationEvidence.execution?.idempotentRepeat === true
    && /^sha256:[a-f0-9]{64}$/u.test(schemaMigrationEvidence.artifact?.localImageId ?? '')
    && schemaMigrationEvidence.artifact?.dockerfileSha256 === await sha256(root, 'deploy/edc/Dockerfile')
    && schemaMigrationEvidence.artifact?.migrationRunnerSha256 === await sha256(root, 'deploy/edc/database-schema/run-schema-migration.sh')
    && schemaMigrationEvidence.artifact?.migrationManifestSha256 === await sha256(root, 'deploy/edc/database-schema/migration-manifest.v1.json')
    && schemaMigrationEvidence.artifact?.verificationScriptSha256 === await sha256(root, 'deploy/edc/database-schema/run-postgres-verification.ps1')
    && schemaMigrationEvidence.database?.image === `postgres:17.10-alpine3.24@${lock.containerImages?.['postgres:17.10-alpine3.24']}`
    && schemaMigrationEvidence.database?.tlsMode === 'verify-full'
    && schemaMigrationEvidence.productionGate?.policyName === schemaArtifact.requiredAdmissionPolicy
    && schemaMigrationEvidence.productionGate?.attestationPredicateType === schemaArtifact.requiredAttestationPredicateType
    && schemaMigrationEvidence.productionGate?.localImageIsNotReleaseAuthorization === true,
  'EDC schema migration PostgreSQL evidence is absent, stale, or treated as release authorization', failures);
  assert(runtimeArtifacts.artifacts['smoke-control-plane'].smokeOnly === true
    && runtimeArtifacts.artifacts['smoke-data-plane'].smokeOnly === true,
  'smoke EDC artifacts are not classified as smoke-only', failures);
  assert(runtimeArtifacts.artifacts['schema-migration'].smokeOnly === false
    && migrationManifest.edcVersion === lock.eclipseEdc.version
    && migrationManifest.sourceCommit === lock.eclipseEdc.commit
    && migrationManifest.requiredVersion === 'edc-0.18.0-sql-v1',
  'EDC database migration artifact is not bound to the locked EDC source', failures);
  assert(migrationRunner.startsWith('#!/bin/sh\n')
    && migrationRunner.includes('sslmode_count')
    && migrationRunner.includes('[ "$value" = "verify-full" ]')
    && migrationRunner.includes('[ "$sslmode_count" -eq 1 ]')
    && migrationRunner.includes('[ "$sslrootcert_count" -eq 1 ]')
    && migrationRunner.includes('molit_edc_schema_version')
    && migrationRunner.includes('required EDC tables are absent after migration'),
  'EDC schema migration runner lacks TLS, version marker, or table readiness gates', failures);
  const apacheLicense = lock.thirdPartyLicenses?.find(({ spdx }) => spdx === 'Apache-2.0');
  const apacheLicenseDigest = await sha256(root, 'deploy/edc/licenses/Apache-2.0.txt');
  assert(apacheLicense?.path === 'deploy/edc/licenses/Apache-2.0.txt'
    && apacheLicense?.sha256 === apacheLicenseDigest,
  'adapted EDC/Gradle sources lack the locked Apache-2.0 license text', failures);
  assert(thirdPartyNotices.includes('Eclipse EDC Samples') && thirdPartyNotices.includes('Gradle wrapper'), 'third-party notices omit adapted EDC or Gradle provenance', failures);
  assert(evidence.sourceBinding?.algorithm === sourceBinding.algorithm
    && evidence.sourceBinding?.digest === sourceBinding.digest
    && evidence.sourceBinding?.fileCount === sourceBinding.fileCount
    && evidence.sourceBinding?.scope === sourceBinding.scope,
  'EDC runtime evidence is not bound to the current EDC source, test, command and checkout-policy tree', failures);
  assert(evidence.verdict === 'production-readiness-blocked', 'EDC summary verdict must remain production-readiness-blocked', failures);
  const blockerIds = new Set((evidence.productionBlockers ?? []).map((entry) => entry.id));
  for (const id of [
    'PROD-DPS-WORKER',
    'PROD-IDENTITY-TRUST',
    'PROD-PUBLIC-DELIVERY',
    'PROD-DATABASE-ISOLATION',
    'PROD-TLS-NETWORK',
    'PROD-SUPPLY-CHAIN',
    'DSP-TCK-CROSS-IMPLEMENTATION',
    'EDC-PUBLICATION-LIVE',
  ]) assert(blockerIds.has(id), `EDC production blocker is absent: ${id}`, failures);
  await verifyRunReference(root, evidence, sourceBinding, failures);
  const runtimeEdcVersion = gradleProperties.match(/^edcVersion\s*=\s*([^\s#]+)\s*$/mu)?.[1];
  assert(runtimeEdcVersion === lock.eclipseEdc.version, 'Gradle edcVersion differs from the EDC upstream lock', failures);
  assert(lock.eclipseEdc.artifactClasses?.smokeOnly?.includes(`org.eclipse.edc:iam-mock:${lock.eclipseEdc.version}`)
    && lock.eclipseEdc.artifactClasses?.smokeOnly?.includes(`org.eclipse.edc:transfer-data-plane-signaling:${lock.eclipseEdc.version}`),
  'mock identity and legacy signaling are not classified as smoke-only in the upstream lock', failures);
  assert(!controlPlaneBuild.includes('org.eclipse.edc:iam-mock')
    && !controlPlaneBuild.includes('org.eclipse.edc:transfer-data-plane-signaling:$edcVersion')
    && !controlPlaneBuild.includes('exclude(group = "org.eclipse.edc", module = "data-plane-signaling")'),
  'production control plane declares a smoke-only identity or legacy signaling dependency', failures);
  assert(controlPlaneBuild.includes('verifyProductionRuntimeClasspath')
    && controlPlaneBuild.includes('setOf("iam-mock", "transfer-data-plane-signaling")')
    && controlPlaneBuild.includes('dependsOn(verifyProductionRuntimeClasspath)'),
  'production control plane lacks a resolved runtime-classpath exclusion gate', failures);
  assert(smokeControlPlaneBuild.includes('org.eclipse.edc:iam-mock:$edcVersion')
    && smokeControlPlaneBuild.includes('org.eclipse.edc:transfer-data-plane-signaling:$edcVersion')
    && smokeControlPlaneBuild.includes('exclude(group = "org.eclipse.edc", module = "data-plane-signaling")')
    && smokeControlPlaneBuild.includes('exclude(group = "org.eclipse.edc", module = "data-plane-signaling-oauth2")'),
  'smoke control plane does not contain the isolated mock/legacy compatibility graph', failures);
  assert(lock.eclipseEdc.commit === '911a22ba6b90688ffeb35bb92bf5cc040ffdf37f', 'EDC tag commit mismatch', failures);
  assert(lock.eclipseEdc.managementApi === 'v4', 'lock must identify v4 as stable management API', failures);
  assert(lock.eclipseEdc.javaRuntime === 17 && lock.eclipseEdc.javaClassMajor === 61, 'Java 17/class major 61 evidence missing', failures);
  assert(runtimeBuild.includes('withType<JavaCompile>') && runtimeBuild.includes('options.release.set(17)'), 'Gradle does not force Java --release 17 for every JavaCompile task', failures);
  assert(runtimeBuild.includes('verifyJava17Bytecode') && runtimeBuild.includes('check(major == 61)'), 'Gradle build lacks a class-file major 61 gate', failures);
  assert(gradleLauncher.startsWith('#!/bin/sh\n') && !gradleLauncher.includes('\r'), 'Gradle launcher must use LF so the Linux Docker builder can execute it', failures);
  assert(dockerfile.includes('eclipse-temurin:17-jdk-jammy@sha256:'), 'builder is not a digest-pinned JDK 17 image', failures);
  assert(dockerfile.includes('eclipse-temurin:17-jre-jammy@sha256:'), 'runtime is not a digest-pinned JRE 17 image', failures);
  assert(dockerfile.includes('RUN chmod 0755 gradlew && ./gradlew'), 'Docker build depends on a checkout-preserved Gradle wrapper executable bit', failures);
  assert(dockerfile.includes('FROM runtime-base AS data-plane'), 'production data-plane target missing', failures);
  assert(dockerfile.includes('FROM runtime-base AS control-plane'), 'dependency-clean control-plane target missing', failures);
  assert(dockerfile.includes('FROM runtime-base AS smoke-control-plane'), 'isolated smoke control-plane target missing', failures);
  assert(dockerfile.includes('FROM runtime-base AS smoke-data-plane'), 'isolated smoke data-plane target missing', failures);
  assert(dockerfile.includes('AS schema-migration')
    && dockerfile.includes('COPY --from=schema-build --chown=70:70 /schema /opt/molit-edc-schema')
    && dockerfile.includes('kr.go.molit.dataspace.production-eligible="true"')
    && dockerfile.includes('kr.go.molit.dataspace.production-gate="signed-release-attestation"')
    && dockerfile.includes('USER 70:70\nHEALTHCHECK NONE'),
  'EDC schema migration image target is missing or can run as root', failures);
  assert(!dataPlaneBuild.includes('smoke-data-plane') && !dataPlaneBuild.includes('molit.smoke'), 'production data-plane depends on smoke code', failures);
  assert(!/org\.eclipse\.edc\.molit\.smoke|SmokeProxy|SmokePullProxy/.test(productionDataPlaneSource), 'production data-plane source tree contains smoke proxy code', failures);
  assert(dataPlaneBuild.includes('verifyNoSmokeClasses') && dataPlaneBuild.includes('org/eclipse/edc/molit/smoke/') && dataPlaneBuild.includes('finalizedBy(verifyNoSmokeClasses)'), 'production JAR lacks a build-time smoke-class exclusion gate', failures);
  const productionBuildStage = dockerfile.match(/AS build\s+([\s\S]*?)\nFROM build AS smoke-build/)?.[1] ?? '';
  const productionControlPlaneStage = dockerfile.match(/FROM runtime-base AS control-plane\s+([\s\S]*?)\nFROM runtime-base AS smoke-control-plane/)?.[1] ?? '';
  const productionDataPlaneStage = dockerfile.match(/FROM runtime-base AS data-plane\s+([\s\S]*?)\nFROM runtime-base AS smoke-data-plane/)?.[1] ?? '';
  const productionDataPlaneInstructions = productionDataPlaneStage.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('#')).join('\n');
  assert(productionBuildStage && !productionBuildStage.includes(':smoke-control-plane:') && !productionBuildStage.includes(':smoke-data-plane:'), 'production Docker build stage builds a smoke artifact', failures);
  assert(productionControlPlaneStage.includes('/control-plane/build/libs/molit-edc-control-plane.jar')
    && !/iam-mock|legacy|smoke/i.test(productionControlPlaneStage.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('#')).join('\n')),
  'control-plane image target is not bound exclusively to the dependency-clean production JAR', failures);
  assert(productionDataPlaneStage.includes('/data-plane/build/libs/molit-edc-data-plane.jar'), 'production image does not copy the production data-plane JAR', failures);
  assert(!/smoke/i.test(productionDataPlaneInstructions), 'production data-plane image stage references a smoke artifact', failures);

  for (const service of ['provider-control-plane', 'provider-data-plane', 'consumer-control-plane', 'consumer-data-plane']) {
    assert(compose.includes(`  ${service}:`), `compose service missing: ${service}`, failures);
  }
  const imageLines = `${compose}\n${overlay}\n${dockerfile}`.split(/\r?\n/).filter((line) => /^\s*(?:image:|FROM)\s+/.test(line));
  for (const line of imageLines) {
    if (line.includes(' AS build') || line.includes(' AS runtime-base') || line.includes(' AS keygen')) {
      // These are still external images and are checked by the same digest rule.
    }
    const external = !/FROM\s+(?:build|smoke-build|runtime-base)\s+AS/.test(line);
    if (external) assert(line.includes('@sha256:'), `container image is not digest pinned: ${line.trim()}`, failures);
  }
  const imageDefinitions = `${compose}\n${overlay}\n${dockerfile}`;
  for (const [imageName, digest] of Object.entries(lock.containerImages)) {
    assert(imageDefinitions.includes(`${imageName}@${digest}`), `locked container image is not used exactly: ${imageName}`, failures);
  }
  assert(/provider-data-plane:[\s\S]*?target: data-plane/.test(compose), 'base compose must use production data-plane target', failures);
  assert(/provider-control-plane:[\s\S]*?target: control-plane/.test(compose)
    && /consumer-control-plane:[\s\S]*?target: control-plane/.test(compose),
  'base compose must use the dependency-clean control-plane target', failures);
  assert(/provider-data-plane:[\s\S]*?target: smoke-data-plane/.test(overlay), 'smoke overlay must explicitly opt into smoke target', failures);
  assert(/provider-control-plane:[\s\S]*?target: smoke-control-plane/.test(overlay)
    && /consumer-control-plane:[\s\S]*?target: smoke-control-plane/.test(overlay),
  'smoke overlay must explicitly opt both control planes into the mock/legacy target', failures);
  assert(overlay.includes('service_completed_successfully'), 'smoke key generation is not an explicit one-shot dependency', failures);
  assert(/consumer-control-plane\s+consumer-data-plane/.test(smokeRunnerPowerShell) && /consumer-control-plane\s+consumer-data-plane/.test(smokeRunnerShell), 'PULL smoke startup omits the consumer data plane required for legacy preparation', failures);
  const powerShellReset = smokeRunnerPowerShell.indexOf('docker compose -f $compose -f $overlay down --volumes --remove-orphans');
  const powerShellStart = smokeRunnerPowerShell.indexOf('docker compose -f $compose -f $overlay up --detach --build');
  const shellMain = smokeRunnerShell.slice(smokeRunnerShell.indexOf('trap cleanup EXIT'));
  const shellReset = shellMain.indexOf('docker compose -f "$compose" -f "$overlay" down --volumes --remove-orphans');
  const shellStart = shellMain.indexOf('docker compose -f "$compose" -f "$overlay" up --detach --build');
  assert(powerShellReset >= 0 && powerShellReset < powerShellStart && shellReset >= 0 && shellReset < shellStart, 'smoke runner does not remove project volumes before startup', failures);
  assert(smokeRunnerPowerShell.includes('$RecordEvidence')
    && smokeRunnerPowerShell.includes('prepare --state')
    && smokeRunnerPowerShell.includes('complete --state')
    && smokeRunnerShell.includes('--record-evidence')
    && smokeRunnerShell.includes('prepare --state')
    && smokeRunnerShell.includes('complete --state'),
  'smoke runners do not expose the prepare/complete raw evidence recorder', failures);
  for (const service of ['provider-control-plane', 'provider-data-plane', 'consumer-control-plane', 'consumer-data-plane', 'provider-backend']) {
    assert(smokeRunnerPowerShell.includes(`Wait-ForHealthyService '${service}'`), `PowerShell smoke runner does not wait for healthy ${service}`, failures);
    assert(smokeRunnerShell.includes(`wait_for_healthy '${service}'`), `shell smoke runner does not wait for healthy ${service}`, failures);
  }
  assert(smokeRunnerPowerShell.includes('run --rm --no-deps --use-aliases smoke') && smokeRunnerShell.includes('run --rm --no-deps --use-aliases smoke'), 'smoke runner does not preserve keygen output and the callback DNS alias', failures);
  assert(!loaded.get('deploy/edc/config/provider-data-plane.properties').includes('edc.molit.smoke'), 'production provider data-plane config enables smoke code', failures);
  assert(!loaded.get('deploy/edc/config/consumer-data-plane.properties').includes('edc.molit.smoke'), 'production consumer data-plane config enables smoke code', failures);

  assert(smokeController.includes('@Path("data.json")'), 'smoke probe is not restricted to the fixed data.json path', failures);
  assert(smokeController.includes('URI.create("http://provider-backend:8080/data.json")'), 'smoke probe does not use the fixed Compose backend resource', failures);
  assert(smokeController.includes('.uri(FIXTURE_RESOURCE)'), 'smoke probe outbound request does not use the fixed resource URI', failures);
  assert(smokeController.includes('isAllowedBackendOrigin(authorizedBaseUrl)'), 'smoke probe does not verify the authorized source origin', failures);
  assert(!smokeController.includes('{any:.*}') && !smokeController.includes('getUriInfo()'), 'smoke probe forwards an arbitrary incoming path', failures);
  assert(!/@(?:POST|PUT|PATCH|DELETE)\b/.test(smokeController), 'smoke probe exposes a mutating HTTP method', failures);

  assert(smoke.includes('/v4/assets') && smoke.includes('/v4/contractnegotiations') && smoke.includes('/v4/transferprocesses'), 'smoke must use management API v4', failures);
  assert(!smoke.includes('/v5beta/') && !smoke.includes('/v3/edrs'), 'smoke assumes a beta or deprecated EDR management API', failures);
  assert(smoke.includes('/.well-known/dspace-version'), 'DSP version discovery is missing', failures);
  assert(smoke.includes('bindCatalogOffer(catalog.body, dataset') && smoke.includes('policy: negotiationPolicy'), 'catalog offer terms and Management API bindings are not carried into negotiation', failures);
  assert(smoke.includes('contractId: agreementId'), 'transfer contractId is not the agreement ID', failures);
  assert(smoke.includes('createStartedEventMatcher') && smoke.includes('transferProcessId: transferId, contractId: agreementId, assetId'), 'callback EDR is not correlated to the requested transfer, agreement, and asset', failures);
  assert(smoke.includes("['STARTED']") && smoke.includes('createHash(\'sha256\')') && smoke.includes('/terminate'), 'PULL state, byte hash, or termination check missing', failures);
  assert(smoke.includes('waitForRevocation') && smoke.includes('lastStatus === 401 || lastStatus === 403'), 'post-termination token revocation check missing', failures);

  const deployFiles = await Promise.all([
    'deploy/edc/Dockerfile', 'deploy/edc/compose.yaml', 'deploy/edc/compose.smoke.yaml',
    'deploy/edc/runtime/smoke-data-plane/src/main/java/org/eclipse/edc/molit/smoke/EphemeralKeyStoreExtension.java',
    'deploy/edc/runtime/smoke-data-plane/src/main/java/org/eclipse/edc/molit/smoke/SmokePullProxyExtension.java',
    'deploy/edc/runtime/smoke-data-plane/src/main/java/org/eclipse/edc/molit/smoke/SmokeProxyController.java'
  ].map((relative) => text(root, relative)));
  const deploySource = deployFiles.join('\n');
  assert(!/-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/]{64}/.test(deploySource), 'private key material is present in EDC source/config', failures);
  assert(!/PRIVATE_KEY\s*=\s*"""/.test(deploySource), 'hard-coded sample private key constant is present', failures);
  assert(deploySource.includes('edc.molit.smoke.enabled'), 'smoke artifact lacks an explicit runtime opt-in guard', failures);

  const databases = loaded.get('deploy/edc/postgres/init/00-create-databases.sql').match(/CREATE DATABASE\s+([a-z_]+)/g) ?? [];
  assert(databases.length === 4, `expected four isolated EDC databases, found ${databases.length}`, failures);
  for (const name of ['provider_cp', 'provider_dp', 'consumer_cp', 'consumer_dp']) {
    const configs = [...loaded.values()].join('\n');
    assert(configs.includes(`5432/${name}`), `database is not referenced by its runtime: ${name}`, failures);
  }

  const wrapperJar = await sha256(root, 'deploy/edc/runtime/gradle/wrapper/gradle-wrapper.jar');
  const wrapperProperties = await sha256(root, 'deploy/edc/runtime/gradle/wrapper/gradle-wrapper.properties');
  assert(wrapperJar === lock.gradleWrapper.jarSha256, 'Gradle wrapper jar hash differs from lock', failures);
  assert(wrapperProperties === lock.gradleWrapper.propertiesSha256, 'Gradle wrapper properties hash differs from lock', failures);

  return { ok: failures.length === 0, failures, checkedFiles: required.length + 8, edcVersion: lock.eclipseEdc.version, sourceDigest: sourceBinding.digest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await verifyTopology();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
