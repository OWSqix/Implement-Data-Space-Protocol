[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet("caas", "dsaas", "fencing-webhook", "edc-control-plane", "edc-data-plane", "edc-schema-migration")][string]$Service,
  [Parameter(Mandatory = $true)][string]$ImageTag,
  [Parameter(Mandatory = $true)][string]$PrivateKeyPath,
  [Parameter(Mandatory = $true)][string]$PublicKeyPath,
  [Parameter(Mandatory = $true)][string]$CosignPrivateKeyPath,
  [Parameter(Mandatory = $true)][string]$CosignPublicKeyPath,
  [Parameter(Mandatory = $true)][string]$RegistryConfigPath,
  [string]$OutputDirectory = ".local/supply-chain",
  [string]$BuilderId = "https://data.molit.go.kr/builders/release-buildkit/v1"
)

$ErrorActionPreference = "Stop"
$BaseImage = "node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d"
$BuildImage = $BaseImage
$SyftImage = "anchore/syft:v1.46.0@sha256:473a60e3a58e29aca3aedb3e99e787bb4ef273917e44d10fcbea4330a07320bb"
$TrivyImage = "aquasec/trivy:0.72.0@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f"
$CosignImage = "ghcr.io/sigstore/cosign/cosign:v3.0.6@sha256:de9c65609e6bde17e6b48de485ee788407c9502fa08b8f4459f595b21f56cd00"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Set-Location $Root
$ArtifactPolicy = switch ($Service) {
  "caas" { [pscustomobject]@{ RuntimeClass = "caas-control-plane"; ProductionEligible = "true" } }
  "dsaas" { [pscustomobject]@{ RuntimeClass = "dsaas-control-plane"; ProductionEligible = "true" } }
  "fencing-webhook" { [pscustomobject]@{ RuntimeClass = "fencing-webhook"; ProductionEligible = "true" } }
  "edc-control-plane" { [pscustomobject]@{ RuntimeClass = "edc-control-plane"; ProductionEligible = "false" } }
  "edc-data-plane" { [pscustomobject]@{ RuntimeClass = "edc-data-plane"; ProductionEligible = "false" } }
  "edc-schema-migration" { [pscustomobject]@{ RuntimeClass = "schema-migration"; ProductionEligible = "true" } }
}

if ($ImageTag.Contains("@") -or -not $ImageTag.Contains(":")) { throw "ImageTag must be a mutable registry tag used only as the push target" }
if (-not (Test-Path -LiteralPath $PrivateKeyPath) -or -not (Test-Path -LiteralPath $PublicKeyPath) -or -not (Test-Path -LiteralPath $CosignPrivateKeyPath) -or -not (Test-Path -LiteralPath $CosignPublicKeyPath)) { throw "Signing key paths must exist outside the repository" }
if (-not (Test-Path -LiteralPath $RegistryConfigPath)) { throw "Standalone registry authentication config does not exist" }
$GitRoot = (Resolve-Path (git rev-parse --show-toplevel)).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
$PrivateKeyResolved = (Resolve-Path -LiteralPath $PrivateKeyPath).Path
foreach ($KeyPath in @($PrivateKeyResolved, (Resolve-Path -LiteralPath $CosignPrivateKeyPath).Path)) {
  if ($KeyPath.StartsWith("$GitRoot$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) { throw "Private signing keys must be outside the Git worktree" }
}
if ((git status --porcelain -- .).Length -ne 0) { throw "Release builds require a clean project worktree" }
$SourceCommit = (git rev-parse HEAD).Trim()
$ProjectPrefix = (git rev-parse --show-prefix).Trim().TrimEnd('/')
$SourceTreeExpression = if ($ProjectPrefix) { "${SourceCommit}:$ProjectPrefix" } else { "${SourceCommit}^{tree}" }
$SourceTree = (git rev-parse $SourceTreeExpression).Trim()
if ($SourceCommit -notmatch '^[0-9a-f]{40,64}$' -or $SourceTree -notmatch '^[0-9a-f]{40,64}$') { throw "Git source commit or project tree is invalid" }
$TempRoot = (Resolve-Path ([IO.Path]::GetTempPath())).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
$SourceWork = New-Item -ItemType Directory (Join-Path $TempRoot "molit-source-$([Guid]::NewGuid().ToString('N'))")
$SourceArchive = Join-Path $SourceWork.FullName "source.tar"
$FrozenRoot = Join-Path $SourceWork.FullName "source"
New-Item -ItemType Directory $FrozenRoot | Out-Null
try {
git archive --format=tar "--output=$SourceArchive" $SourceTree
if ($LASTEXITCODE -ne 0) { throw "Git source archive failed" }
$SourceDigest = "sha256:$((Get-FileHash -LiteralPath $SourceArchive -Algorithm SHA256).Hash.ToLowerInvariant())"
tar -xf $SourceArchive -C $FrozenRoot
if ($LASTEXITCODE -ne 0) { throw "Frozen build context extraction failed" }

$Output = New-Item -ItemType Directory -Force (Join-Path $OutputDirectory $Service)
if ((Get-ChildItem -LiteralPath $Output.FullName -Force | Measure-Object).Count -ne 0) { throw "Supply-chain output directory must be empty" }
$StartedOn = [DateTimeOffset]::UtcNow.ToString("o")
$InvocationId = [Guid]::NewGuid().ToString()
$MetadataPath = Join-Path $Output.FullName "build-metadata.json"
$Dockerfile = "deploy/images/Dockerfile.$Service"
$BuildContext = $FrozenRoot
$BuildTarget = $null
if ($Service -eq "fencing-webhook") {
  $Dockerfile = "deploy/kubernetes/fencing-webhook.Dockerfile"
}
if ($Service -in @("edc-control-plane", "edc-data-plane", "edc-schema-migration")) {
  $Dockerfile = "deploy/edc/Dockerfile"
  $BuildContext = Join-Path $FrozenRoot "deploy/edc"
  $BuildTarget = switch ($Service) {
    "edc-control-plane" { "control-plane" }
    "edc-data-plane" { "data-plane" }
    "edc-schema-migration" { "schema-migration" }
  }
  $BaseImage = if ($Service -eq "edc-schema-migration") {
    "postgres:17.10-alpine3.24@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"
  } else {
    "eclipse-temurin:17-jre-jammy@sha256:475d8e96b4b2bfe08999e5e854755c773af1581acdf959a4545d88f0696a2339"
  }
  $BuildImage = "eclipse-temurin:17-jdk-jammy@sha256:723151f3fc88ca2060153ee08ab8dbbea7983d6ed6f2622fe440acf178737c94"
}
$BuildDockerfile = Join-Path $FrozenRoot $Dockerfile
if (-not (Test-Path -LiteralPath $BuildDockerfile -PathType Leaf)) { throw "Frozen Dockerfile is missing" }

$BuildArguments = @("buildx", "build", "--platform", "linux/amd64", "--file", $BuildDockerfile, "--tag", $ImageTag, "--push", "--provenance=mode=max", "--sbom=true", "--metadata-file", $MetadataPath)
if ($null -ne $BuildTarget) { $BuildArguments += @("--target", $BuildTarget) }
$BuildArguments += $BuildContext
& docker $BuildArguments
if ($LASTEXITCODE -ne 0) { throw "BuildKit push failed" }
$Metadata = Get-Content -LiteralPath $MetadataPath -Raw | ConvertFrom-Json
$ImageDigest = $Metadata.'containerimage.digest'
if ($ImageDigest -notmatch '^sha256:[0-9a-f]{64}$') { throw "BuildKit did not return an OCI image digest" }
$Repository = $ImageTag.Substring(0, $ImageTag.LastIndexOf(":"))
$ImmutableImage = "$Repository@$ImageDigest"

$Spdx = Join-Path $Output.FullName "image.spdx.json"
$Cdx = Join-Path $Output.FullName "image.cyclonedx.json"
$Scan = Join-Path $Output.FullName "image.scan.json"
$TrivyRaw = Join-Path $Output.FullName "trivy.raw.json"
$Work = New-Item -ItemType Directory (Join-Path $TempRoot "molit-supply-$InvocationId")
try {
  $SpdxRaw = Join-Path $Work.FullName "spdx.raw.json"
  $CdxRaw = Join-Path $Work.FullName "cyclonedx.raw.json"
  $TrivyScannerOutput = Join-Path $Work.FullName "trivy.scanner-output.json"
  $TrivyVersion = Join-Path $Work.FullName "trivy-version.raw.json"
  $TrivyCache = New-Item -ItemType Directory (Join-Path $Work.FullName "trivy-cache")
  $RegistryMount = "$((Resolve-Path -LiteralPath $RegistryConfigPath).Path):/root/.docker/config.json:ro"
  $TrivyCacheMount = "$($TrivyCache.FullName):/root/.cache/trivy"
  [IO.File]::WriteAllText($SpdxRaw, ((docker run --rm -v $RegistryMount $SyftImage $ImmutableImage -o spdx-json) -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  if ($LASTEXITCODE -ne 0) { throw "Syft SPDX generation failed" }
  [IO.File]::WriteAllText($CdxRaw, ((docker run --rm -v $RegistryMount $SyftImage $ImmutableImage -o cyclonedx-json) -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  if ($LASTEXITCODE -ne 0) { throw "Syft CycloneDX generation failed" }
  [IO.File]::WriteAllText($TrivyScannerOutput, ((docker run --rm -v $RegistryMount -v $TrivyCacheMount $TrivyImage --quiet image --image-src remote --scanners vuln,secret,misconfig --format json $ImmutableImage) -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  if ($LASTEXITCODE -ne 0) { throw "Trivy image scan failed" }
  [IO.File]::WriteAllText($TrivyVersion, ((docker run --rm -v $TrivyCacheMount $TrivyImage version --format json) -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  if ($LASTEXITCODE -ne 0) { throw "Trivy version evidence failed" }

  node tools/supply-chain/normalize-artifacts.mjs --kind spdx --input $SpdxRaw --output $Spdx --image-digest $ImageDigest
  if ($LASTEXITCODE -ne 0) { throw "SPDX normalization failed" }
  node tools/supply-chain/normalize-artifacts.mjs --kind cyclonedx --input $CdxRaw --output $Cdx --image-digest $ImageDigest
  if ($LASTEXITCODE -ne 0) { throw "CycloneDX normalization failed" }
  node tools/supply-chain/normalize-artifacts.mjs --kind trivy-evidence --input $TrivyScannerOutput --output $TrivyRaw --image-digest $ImageDigest
  if ($LASTEXITCODE -ne 0) { throw "Trivy evidence redaction failed" }
  node tools/supply-chain/normalize-artifacts.mjs --kind trivy --input $TrivyScannerOutput --version $TrivyVersion --database-metadata (Join-Path $TrivyCache.FullName "db/metadata.json") --scanner-image $TrivyImage --output $Scan --image-digest $ImageDigest
  if ($LASTEXITCODE -ne 0) { throw "Trivy Gate normalization failed" }
} finally {
  $ResolvedWork = $null
  $ResolvedWorkItem = Resolve-Path -LiteralPath $Work.FullName -ErrorAction SilentlyContinue
  if ($null -ne $ResolvedWorkItem) { $ResolvedWork = $ResolvedWorkItem.Path }
  if ($null -ne $ResolvedWork -and $ResolvedWork.StartsWith("$TempRoot$([IO.Path]::DirectorySeparatorChar)molit-supply-", [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $ResolvedWork -Recurse -Force
  }
}
if ((git rev-parse HEAD).Trim() -ne $SourceCommit -or (git status --porcelain -- .).Length -ne 0) { throw "Project source changed during the frozen release build" }
$FinishedOn = [DateTimeOffset]::UtcNow.ToString("o")
$Bundle = Join-Path $Output.FullName "release-bundle.json"
node tools/supply-chain/attest.mjs --image-name $Repository --image-digest $ImageDigest --source-digest $SourceDigest --dockerfile $Dockerfile --base-image $BaseImage --build-image $BuildImage --sbom-generator-image $SyftImage --scanner-image $TrivyImage --signer-image $CosignImage --builder-id $BuilderId --invocation-id $InvocationId --started-on $StartedOn --finished-on $FinishedOn --spdx $Spdx --cyclonedx $Cdx --scan $Scan --scan-raw $TrivyRaw --private-key $PrivateKeyPath --output $Bundle --service $Service --runtime-class $ArtifactPolicy.RuntimeClass --production-eligible $ArtifactPolicy.ProductionEligible --provenance-mode source-build
if ($LASTEXITCODE -ne 0) { throw "Attestation creation or vulnerability gate failed" }
node tools/supply-chain/verify.mjs --bundle $Bundle --public-key $PublicKeyPath --image-name $Repository --image-digest $ImageDigest --source-digest $SourceDigest --service $Service --runtime-class $ArtifactPolicy.RuntimeClass --production-eligible $ArtifactPolicy.ProductionEligible
if ($LASTEXITCODE -ne 0) { throw "Independent bundle verification failed" }

$RegistryMount = "$((Resolve-Path -LiteralPath $RegistryConfigPath).Path):/root/.docker/config.json:ro"
$CosignPrivateMount = "$((Resolve-Path -LiteralPath $CosignPrivateKeyPath).Path):/keys/cosign.key:ro"
$CosignPublicMount = "$((Resolve-Path -LiteralPath $CosignPublicKeyPath).Path):/keys/cosign.pub:ro"
$EvidenceMount = "$($Output.FullName):/evidence:ro"
docker run --rm -e COSIGN_PASSWORD -v $RegistryMount -v $CosignPrivateMount $CosignImage sign --yes --use-signing-config=false --tlog-upload=false --key /keys/cosign.key $ImmutableImage
if ($LASTEXITCODE -ne 0) { throw "OCI image signature publication failed" }
docker run --rm -e COSIGN_PASSWORD -v $RegistryMount -v $CosignPrivateMount -v $EvidenceMount $CosignImage attest --yes --use-signing-config=false --tlog-upload=false --key /keys/cosign.key --type https://data.molit.go.kr/attestations/release-bundle/v1 --predicate /evidence/release-bundle.json $ImmutableImage
if ($LASTEXITCODE -ne 0) { throw "OCI release attestation publication failed" }
$CosignVerify = (docker run --rm -v $RegistryMount -v $CosignPublicMount $CosignImage verify --insecure-ignore-tlog --key /keys/cosign.pub $ImmutableImage) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) { throw "OCI image signature verification failed" }
[IO.File]::WriteAllText((Join-Path $Output.FullName "cosign.verify.json"), "$CosignVerify`n", [Text.UTF8Encoding]::new($false))
$CosignAttestation = (docker run --rm -v $RegistryMount -v $CosignPublicMount $CosignImage verify-attestation --insecure-ignore-tlog --key /keys/cosign.pub --type https://data.molit.go.kr/attestations/release-bundle/v1 $ImmutableImage) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) { throw "OCI release attestation verification failed" }
[IO.File]::WriteAllText((Join-Path $Output.FullName "cosign.attestation.verify.json"), "$CosignAttestation`n", [Text.UTF8Encoding]::new($false))
} finally {
  $ResolvedSourceWork = Resolve-Path -LiteralPath $SourceWork.FullName -ErrorAction SilentlyContinue
  if ($null -ne $ResolvedSourceWork -and $ResolvedSourceWork.Path.StartsWith("$TempRoot$([IO.Path]::DirectorySeparatorChar)molit-source-", [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $ResolvedSourceWork.Path -Recurse -Force
  }
}
