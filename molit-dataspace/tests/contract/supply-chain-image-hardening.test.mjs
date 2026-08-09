import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const PKCS7_CONTENT_TYPE_OID_PREFIX = Buffer.from("2a864886f70d0107", "hex");

function readAsn1Element(bytes, offset) {
  if (offset >= bytes.length) return null;
  const tag = bytes[offset];
  const firstLength = bytes[offset + 1];
  if (firstLength === undefined) return null;
  if (firstLength === 0x80) return { end: null, indefinite: true, tag, valueStart: offset + 2 };

  let length = firstLength;
  let valueStart = offset + 2;
  if ((firstLength & 0x80) !== 0) {
    const lengthBytes = firstLength & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 4 || valueStart + lengthBytes > bytes.length) return null;
    length = 0;
    for (let index = 0; index < lengthBytes; index += 1) {
      length = (length * 256) + bytes[valueStart + index];
    }
    valueStart += lengthBytes;
  }

  const end = valueStart + length;
  if (end > bytes.length) return null;
  return { end, indefinite: false, tag, valueStart };
}

function isPkcs12Container(bytes) {
  const pfx = readAsn1Element(bytes, 0);
  if (!pfx || pfx.tag !== 0x30 || (!pfx.indefinite && pfx.end !== bytes.length)) return false;

  const version = readAsn1Element(bytes, pfx.valueStart);
  if (!version || version.indefinite || version.tag !== 0x02) return false;
  const encodedVersion = bytes.subarray(version.valueStart, version.end);
  if (encodedVersion.length === 0 || encodedVersion.at(-1) !== 3 || encodedVersion.subarray(0, -1).some((byte) => byte !== 0)) return false;

  const authSafe = readAsn1Element(bytes, version.end);
  if (!authSafe || authSafe.tag !== 0x30 || (!pfx.indefinite && !authSafe.indefinite && authSafe.end > pfx.end)) return false;
  const contentType = readAsn1Element(bytes, authSafe.valueStart);
  if (!contentType || contentType.indefinite || contentType.tag !== 0x06 || (!authSafe.indefinite && contentType.end > authSafe.end)) return false;

  const oid = bytes.subarray(contentType.valueStart, contentType.end);
  return oid.length === PKCS7_CONTENT_TYPE_OID_PREFIX.length + 1
    && oid.subarray(0, -1).equals(PKCS7_CONTENT_TYPE_OID_PREFIX)
    && (oid.at(-1) === 1 || oid.at(-1) === 2);
}

test("PKCS#12 detector recognizes DER and indefinite-length BER PFX structures", () => {
  const derPfx = Buffer.from("3010020103300b06092a864886f70d010701", "hex");
  const berPfxWithPaddedVersion = Buffer.from("301102020003300b06092a864886f70d010701", "hex");
  const berPfx = Buffer.from("3080020103308006092a864886f70d01070100000000", "hex");
  assert.equal(isPkcs12Container(derPfx), true);
  assert.equal(isPkcs12Container(berPfxWithPaddedVersion), true);
  assert.equal(isPkcs12Container(berPfx), true);
  assert.equal(isPkcs12Container(Buffer.from("3003020103", "hex")), false);
});

for (const service of ["caas", "dsaas"]) {
  test(`${service} final image contract is pinned, non-root, and health-checked`, async () => {
    const dockerfile = await readFile(new URL(`../../deploy/images/Dockerfile.${service}`, import.meta.url), "utf8");
    assert.match(dockerfile, /FROM node:24\.18\.0-bookworm-slim@sha256:[0-9a-f]{64}/u);
    assert.match(dockerfile, /USER node/u);
    assert.match(dockerfile, /HEALTHCHECK/u);
    assert.match(dockerfile, /require\('node:https'\)/u);
    assert.doesNotMatch(dockerfile, /fetch\(`http:\/\/127\.0\.0\.1/u);
    assert.match(dockerfile, /STOPSIGNAL SIGTERM/u);
    assert.match(dockerfile, /COPY --chown=node:node contracts \.\/contracts/u);
    assert.match(dockerfile, /COPY --chown=node:node standards\/generated \.\/standards\/generated/u);
    assert.doesNotMatch(dockerfile, /(?:latest|ADD\s+https?:)/u);
  });
}

test("DSaaS image healthcheck supplies the configured public Host over HTTPS", async () => {
  const dockerfile = await readFile(new URL("../../deploy/images/Dockerfile.dsaas", import.meta.url), "utf8");
  assert.match(dockerfile, /MOLIT_DSAAS_CONFIG/u);
  assert.match(dockerfile, /new URL\(config\.publicOrigin\)\.host/u);
  assert.match(dockerfile, /headers:\{host\}/u);
});

test("EDC control-plane and data-plane final targets are pinned, non-root, and health-checked", async () => {
  const dockerfile = await readFile(new URL("../../deploy/edc/Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /FROM eclipse-temurin:17-jdk-jammy@sha256:[0-9a-f]{64} AS build/gu);
  assert.match(dockerfile, /FROM eclipse-temurin:17-jre-jammy@sha256:[0-9a-f]{64} AS runtime-base/gu);
  assert.match(dockerfile, /FROM runtime-base AS control-plane/gu);
  assert.match(dockerfile, /FROM runtime-base AS data-plane/gu);
  assert.match(dockerfile, /USER 10001:10001/gu);
  assert.match(dockerfile, /HEALTHCHECK/gu);
  assert.match(dockerfile, /STOPSIGNAL SIGTERM/gu);
  assert.doesNotMatch(dockerfile, /(?:latest|ADD\s+https?:)/gu);
});

test("the EDC schema migration target disables the inherited PostgreSQL healthcheck", async () => {
  const dockerfile = await readFile(new URL("../../deploy/edc/Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /AS schema-migration[\s\S]*USER 70:70\s+HEALTHCHECK NONE\s+ENTRYPOINT \["\/opt\/molit-edc-schema\/run-schema-migration\.sh"\]/u);
});

test("non-runnable hardening reference points to the supported Kubernetes production path", async () => {
  const compose = await readFile(new URL("../../deploy/images/compose.hardening.reference.yaml", import.meta.url), "utf8");
  assert.match(compose, /not a runnable production topology/gu);
  assert.match(compose, /deploy\/kubernetes\/ha\/apply\.ps1/gu);
  assert.match(compose, /read_only: true/gu);
  assert.match(compose, /cap_drop: \["ALL"\]/gu);
  assert.match(compose, /no-new-privileges:true/gu);
  assert.doesNotMatch(compose, /^services:/gmu);
});

test("release build uses one immutable Git tree for source digest and Docker context", async () => {
  const build = await readFile(new URL("../../deploy/images/build-sign-verify.ps1", import.meta.url), "utf8");
  assert.match(build, /\$SourceCommit = \(git rev-parse HEAD\)\.Trim\(\)/u);
  assert.match(build, /\$SourceTree = \(git rev-parse \$SourceTreeExpression\)\.Trim\(\)/u);
  assert.match(build, /git archive --format=tar "--output=\$SourceArchive" \$SourceTree/u);
  assert.match(build, /Get-FileHash -LiteralPath \$SourceArchive -Algorithm SHA256/u);
  assert.match(build, /\$BuildContext = \$FrozenRoot/u);
  assert.match(build, /\$BuildDockerfile = Join-Path \$FrozenRoot \$Dockerfile/u);
  assert.doesNotMatch(build, /\$BuildContext = "\."/u);
});

test("release build signs the production-eligible EDC schema migration target", async () => {
  const [build, artifactsText] = await Promise.all([
    readFile(new URL("../../deploy/images/build-sign-verify.ps1", import.meta.url), "utf8"),
    readFile(new URL("../../deploy/edc/runtime-artifacts.v1.json", import.meta.url), "utf8"),
  ]);
  const artifacts = JSON.parse(artifactsText);
  assert.match(build, /ValidateSet\([^\r\n]+"edc-schema-migration"\)/u);
  assert.match(build, /"edc-schema-migration" \{ "schema-migration" \}/u);
  assert.match(build, /postgres:17\.10-alpine3\.24@sha256:[0-9a-f]{64}/u);
  assert.equal(artifacts.artifacts["schema-migration"].dockerTarget, "schema-migration");
  assert.equal(artifacts.artifacts["schema-migration"].productionEligible, true);
  assert.equal(artifacts.artifacts["schema-migration"].eligibilityMode, "signed-admission-only");
  assert.match(build, /--service \$Service --runtime-class \$ArtifactPolicy\.RuntimeClass --production-eligible \$ArtifactPolicy\.ProductionEligible/u);
});

test("release paths cover the fencing webhook and adopted PostgreSQL and Collector images", async () => {
  const [build, adoption] = await Promise.all([
    readFile(new URL("../../deploy/images/build-sign-verify.ps1", import.meta.url), "utf8"),
    readFile(new URL("../../deploy/images/adopt-sign-verify.ps1", import.meta.url), "utf8"),
  ]);
  assert.match(build, /ValidateSet\([^\r\n]+"fencing-webhook"/u);
  assert.match(build, /deploy\/kubernetes\/fencing-webhook\.Dockerfile/u);
  assert.match(adoption, /ValidateSet\("postgres-operand", "otel-collector"\)/u);
  assert.match(adoption, /imagetools create --tag \$MirrorTag \$UpstreamImage/u);
  assert.match(adoption, /runtime-image-inventory\.v1\.json/u);
  assert.match(adoption, /canonical service repository/u);
  assert.match(adoption, /--provenance-mode external-adoption/u);
  assert.match(adoption, /verify-attestation/u);
});

test("tracked project files contain no PEM private keys or PKCS#12 containers", async () => {
  const { stdout } = await execute("git", ["ls-files", "-z", "--", "."], { cwd: root, encoding: null });
  const paths = stdout.toString("utf8").split("\0").filter(Boolean);
  const privateKeyBlock = /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----\s+[A-Za-z0-9+/=\r\n]{64,}-----END \1-----/u;
  for (const path of paths) {
    const content = await readFile(new URL(path.replaceAll("\\", "/"), new URL("../..", import.meta.url))).catch(() => null);
    assert.equal(/\.(?:p12|pfx)$/iu.test(path), false, "PKCS#12 container is tracked in " + path);
    if (content) assert.equal(isPkcs12Container(content), false, "PKCS#12 container is tracked in " + path);
    if (content) assert.equal(privateKeyBlock.test(content.toString("utf8")), false, `private key material is tracked in ${path}`);
  }
});
