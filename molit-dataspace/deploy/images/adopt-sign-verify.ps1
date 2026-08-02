[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet("postgres-operand", "otel-collector")][string]$Service,
  [Parameter(Mandatory = $true)][string]$UpstreamImage,
  [Parameter(Mandatory = $true)][string]$MirrorTag,
  [Parameter(Mandatory = $true)][string]$RegistryPrefix,
  [Parameter(Mandatory = $true)][string]$PrivateKeyPath,
  [Parameter(Mandatory = $true)][string]$PublicKeyPath,
  [Parameter(Mandatory = $true)][string]$CosignPrivateKeyPath,
  [Parameter(Mandatory = $true)][string]$CosignPublicKeyPath,
  [Parameter(Mandatory = $true)][string]$RegistryConfigPath,
  [string]$OutputDirectory = ".local/supply-chain-adoption",
  [string]$BuilderId = "https://data.molit.go.kr/builders/external-image-adoption/v1"
)

$ErrorActionPreference = "Stop"
$PinnedImage = '^[^@\s]+@sha256:[a-f0-9]{64}$'
$SyftImage = "anchore/syft:v1.46.0@sha256:473a60e3a58e29aca3aedb3e99e787bb4ef273917e44d10fcbea4330a07320bb"
$TrivyImage = "aquasec/trivy:0.72.0@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f"
$CosignImage = "ghcr.io/sigstore/cosign/cosign:v3.0.6@sha256:de9c65609e6bde17e6b48de485ee788407c9502fa08b8f4459f595b21f56cd00"
$RuntimeClass = if ($Service -eq "postgres-operand") { "postgres-operand" } else { "otel-collector" }
$Root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Set-Location $Root
$StartedOn = [DateTimeOffset]::UtcNow.ToString("o")
$InvocationId = [Guid]::NewGuid().ToString()

if ($UpstreamImage -notmatch $PinnedImage) { throw "UpstreamImage must be an immutable sha256 reference" }
$UpstreamDigest = $UpstreamImage.Substring($UpstreamImage.LastIndexOf("@") + 1)
if ($RegistryPrefix -notmatch '^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9._/-]+$' -or $RegistryPrefix.Contains('..') -or $RegistryPrefix.EndsWith('/')) { throw "RegistryPrefix is invalid" }
if ($MirrorTag.Contains("@") -or -not $MirrorTag.Contains(":") -or $MirrorTag.Substring(0, $MirrorTag.LastIndexOf(":")) -cne "$RegistryPrefix/$Service") {
  throw "MirrorTag must be a mutable tag in the canonical service repository"
}
$Inventory = Get-Content -LiteralPath (Join-Path $Root "deploy/supply-chain/runtime-image-inventory.v1.json") -Raw | ConvertFrom-Json
$InventoryRows = @($Inventory.artifacts | Where-Object { $_.service -eq $Service })
if ($Inventory.schemaVersion -ne "molit.supply-chain-runtime-image-inventory/1" -or $InventoryRows.Count -ne 1 -or
  $InventoryRows[0].provenanceMode -ne "external-adoption" -or $InventoryRows[0].runtimeClass -ne $RuntimeClass -or
  $InventoryRows[0].productionEligible -ne $true -or $InventoryRows[0].upstreamImage -cne $UpstreamImage) {
  throw "External adoption request differs from the reviewed runtime image inventory"
}
foreach ($Path in @($PrivateKeyPath, $PublicKeyPath, $CosignPrivateKeyPath, $CosignPublicKeyPath, $RegistryConfigPath)) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Adoption key and registry configuration paths must exist" }
}
$GitRoot = (Resolve-Path (git rev-parse --show-toplevel)).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
foreach ($KeyPath in @((Resolve-Path -LiteralPath $PrivateKeyPath).Path, (Resolve-Path -LiteralPath $CosignPrivateKeyPath).Path)) {
  if ($KeyPath.StartsWith("$GitRoot$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) { throw "Private signing keys must be outside the Git worktree" }
}
if ((git status --porcelain -- .).Length -ne 0) { throw "External adoption requires a clean policy worktree" }

function Assert-RemoteDigest {
  param([string]$Reference, [string]$Expected)
  $Inspection = (& docker buildx imagetools inspect $Reference) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $Inspection -notmatch "(?m)^Digest:\s+$([regex]::Escape($Expected))\s*$") {
    throw "Registry manifest digest does not match the declared adoption subject: $Reference"
  }
}
$SourceCommit = (git rev-parse HEAD).Trim()
$ProjectPrefix = (git rev-parse --show-prefix).Trim().TrimEnd('/')
$SourceTreeExpression = if ($ProjectPrefix) { "${SourceCommit}:$ProjectPrefix" } else { "${SourceCommit}^{tree}" }
$SourceTree = (git rev-parse $SourceTreeExpression).Trim()
$TempRoot = (Resolve-Path ([IO.Path]::GetTempPath())).Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
$Work = New-Item -ItemType Directory (Join-Path $TempRoot "molit-adoption-$([Guid]::NewGuid().ToString('N'))")
try {
  $PreviousDockerConfig = $env:DOCKER_CONFIG
  $DockerConfigDirectory = New-Item -ItemType Directory (Join-Path $Work.FullName "docker-config")
  Copy-Item -LiteralPath (Resolve-Path -LiteralPath $RegistryConfigPath).Path -Destination (Join-Path $DockerConfigDirectory.FullName "config.json")
  $env:DOCKER_CONFIG = $DockerConfigDirectory.FullName
  Assert-RemoteDigest $UpstreamImage $UpstreamDigest
  docker buildx imagetools create --tag $MirrorTag $UpstreamImage
  if ($LASTEXITCODE -ne 0) { throw "Digest-preserving mirror copy failed" }
  Assert-RemoteDigest $MirrorTag $UpstreamDigest
  $MirrorRepository = $MirrorTag.Substring(0, $MirrorTag.LastIndexOf(":"))
  $MirrorDigest = $UpstreamDigest
  $MirrorImage = "$MirrorRepository@$MirrorDigest"
  docker pull $MirrorImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Mirrored adoption subject could not be pulled by digest" }
  $SourceArchive = Join-Path $Work.FullName "policy-source.tar"
  git archive --format=tar "--output=$SourceArchive" $SourceTree
  if ($LASTEXITCODE -ne 0) { throw "Adoption policy source archive failed" }
  $SourceDigest = "sha256:$((Get-FileHash -LiteralPath $SourceArchive -Algorithm SHA256).Hash.ToLowerInvariant())"
  $Output = New-Item -ItemType Directory -Force (Join-Path $OutputDirectory $Service)
  if ((Get-ChildItem -LiteralPath $Output.FullName -Force | Measure-Object).Count -ne 0) { throw "Adoption output directory must be empty" }
  $RegistryMount = "$((Resolve-Path -LiteralPath $RegistryConfigPath).Path):/root/.docker/config.json:ro"
  $TrivyCache = New-Item -ItemType Directory (Join-Path $Work.FullName "trivy-cache")
  $TrivyCacheMount = "$($TrivyCache.FullName):/root/.cache/trivy"
  $SpdxRaw = Join-Path $Work.FullName "spdx.raw.json"
  $CdxRaw = Join-Path $Work.FullName "cyclonedx.raw.json"
  $TrivyScannerOutput = Join-Path $Work.FullName "trivy.scanner-output.json"
  $TrivyVersion = Join-Path $Work.FullName "trivy-version.raw.json"
  [IO.File]::WriteAllText($SpdxRaw, ((docker run --rm -v $RegistryMount $SyftImage $MirrorImage -o spdx-json) -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  if ($LASTEXITCODE -ne 0) { throw "Adopted image SPDX generation failed" }
  [IO.File]::WriteAllText($CdxRaw, ((docker run --rm -v $RegistryMount $SyftImage $MirrorImage -o cyclonedx-json) -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  if ($LASTEXITCODE -ne 0) { throw "Adopted image CycloneDX generation failed" }
  [IO.File]::WriteAllText($TrivyScannerOutput, ((docker run --rm -v $RegistryMount -v $TrivyCacheMount $TrivyImage --quiet image --image-src remote --scanners vuln,secret,misconfig --format json $MirrorImage) -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  if ($LASTEXITCODE -ne 0) { throw "Adopted image Trivy scan failed" }
  [IO.File]::WriteAllText($TrivyVersion, ((docker run --rm -v $TrivyCacheMount $TrivyImage version --format json) -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  if ($LASTEXITCODE -ne 0) { throw "Adopted image Trivy version evidence failed" }

  $Spdx = Join-Path $Output.FullName "image.spdx.json"
  $Cdx = Join-Path $Output.FullName "image.cyclonedx.json"
  $Scan = Join-Path $Output.FullName "image.scan.json"
  $TrivyRaw = Join-Path $Output.FullName "trivy.raw.json"
  node tools/supply-chain/normalize-artifacts.mjs --kind spdx --input $SpdxRaw --output $Spdx --image-digest $MirrorDigest
  if ($LASTEXITCODE -ne 0) { throw "SPDX normalization failed" }
  node tools/supply-chain/normalize-artifacts.mjs --kind cyclonedx --input $CdxRaw --output $Cdx --image-digest $MirrorDigest
  if ($LASTEXITCODE -ne 0) { throw "CycloneDX normalization failed" }
  node tools/supply-chain/normalize-artifacts.mjs --kind trivy-evidence --input $TrivyScannerOutput --output $TrivyRaw --image-digest $MirrorDigest
  if ($LASTEXITCODE -ne 0) { throw "Trivy evidence normalization failed" }
  node tools/supply-chain/normalize-artifacts.mjs --kind trivy --input $TrivyScannerOutput --version $TrivyVersion --database-metadata (Join-Path $TrivyCache.FullName "db/metadata.json") --scanner-image $TrivyImage --output $Scan --image-digest $MirrorDigest
  if ($LASTEXITCODE -ne 0) { throw "Trivy Gate normalization failed" }

  $FinishedOn = [DateTimeOffset]::UtcNow.ToString("o")
  $Bundle = Join-Path $Output.FullName "release-bundle.json"
  node tools/supply-chain/attest.mjs --image-name $MirrorImage.Substring(0, $MirrorImage.LastIndexOf("@")) --image-digest $MirrorDigest --source-digest $SourceDigest --dockerfile "external:$UpstreamImage" --base-image $UpstreamImage --build-image $UpstreamImage --sbom-generator-image $SyftImage --scanner-image $TrivyImage --signer-image $CosignImage --builder-id $BuilderId --invocation-id $InvocationId --started-on $StartedOn --finished-on $FinishedOn --spdx $Spdx --cyclonedx $Cdx --scan $Scan --scan-raw $TrivyRaw --private-key $PrivateKeyPath --output $Bundle --service $Service --runtime-class $RuntimeClass --production-eligible true --provenance-mode external-adoption
  if ($LASTEXITCODE -ne 0) { throw "External adoption attestation failed" }
  node tools/supply-chain/verify.mjs --bundle $Bundle --public-key $PublicKeyPath --image-name $MirrorImage.Substring(0, $MirrorImage.LastIndexOf("@")) --image-digest $MirrorDigest --source-digest $SourceDigest --service $Service --runtime-class $RuntimeClass --production-eligible true
  if ($LASTEXITCODE -ne 0) { throw "External adoption bundle verification failed" }

  $CosignPrivateMount = "$((Resolve-Path -LiteralPath $CosignPrivateKeyPath).Path):/keys/cosign.key:ro"
  $CosignPublicMount = "$((Resolve-Path -LiteralPath $CosignPublicKeyPath).Path):/keys/cosign.pub:ro"
  $EvidenceMount = "$($Output.FullName):/evidence:ro"
  docker run --rm -e COSIGN_PASSWORD -v $RegistryMount -v $CosignPrivateMount $CosignImage sign --yes --use-signing-config=false --tlog-upload=false --key /keys/cosign.key $MirrorImage
  if ($LASTEXITCODE -ne 0) { throw "Adopted image signature publication failed" }
  docker run --rm -e COSIGN_PASSWORD -v $RegistryMount -v $CosignPrivateMount -v $EvidenceMount $CosignImage attest --yes --use-signing-config=false --tlog-upload=false --key /keys/cosign.key --type https://data.molit.go.kr/attestations/release-bundle/v1 --predicate /evidence/release-bundle.json $MirrorImage
  if ($LASTEXITCODE -ne 0) { throw "Adopted image attestation publication failed" }
  docker run --rm -v $RegistryMount -v $CosignPublicMount $CosignImage verify --insecure-ignore-tlog --key /keys/cosign.pub $MirrorImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Adopted image signature verification failed" }
  docker run --rm -v $RegistryMount -v $CosignPublicMount $CosignImage verify-attestation --insecure-ignore-tlog --key /keys/cosign.pub --type https://data.molit.go.kr/attestations/release-bundle/v1 $MirrorImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Adopted image attestation verification failed" }
} finally {
  if ($null -eq $PreviousDockerConfig) { Remove-Item Env:DOCKER_CONFIG -ErrorAction SilentlyContinue }
  else { $env:DOCKER_CONFIG = $PreviousDockerConfig }
  $Resolved = Resolve-Path -LiteralPath $Work.FullName -ErrorAction SilentlyContinue
  if ($null -ne $Resolved -and $Resolved.Path.StartsWith("$TempRoot$([IO.Path]::DirectorySeparatorChar)molit-adoption-", [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $Resolved.Path -Recurse -Force
  }
}
