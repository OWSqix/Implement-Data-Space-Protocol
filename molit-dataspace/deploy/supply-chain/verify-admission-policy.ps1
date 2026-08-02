[CmdletBinding()]
param(
  [string]$KyvernoCliImage = "ghcr.io/kyverno/kyverno-cli:v1.18.1@sha256:b7e272572d244ddec0b83469f7200ba883555bf69de4b294cee52a197c8c6590",
  [string]$CosignImage = "ghcr.io/sigstore/cosign/cosign:v3.0.6@sha256:de9c65609e6bde17e6b48de485ee788407c9502fa08b8f4459f595b21f56cd00",
  [string]$RegistryImage = "ghcr.io/project-zot/zot-linux-amd64:v2.1.18@sha256:34f18f783037f967dba10df02f9d4086c4d626f5643ef9f5e51e4a4547280a0b",
  [string]$FixtureImage = "busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662",
  [ValidateRange(10, 600)]
  [int]$KyvernoTimeoutSeconds = 90,
  [ValidateRange(0, 10)]
  [int]$KyvernoLogLevel = 0
)

$ErrorActionPreference = "Stop"
$Password = "molit-kyverno-cli-fixture"
$RunId = "$PID-$([Guid]::NewGuid().ToString('N'))"
$RegistryName = "molit-kyverno-registry-$RunId"
$NetworkName = "molit-kyverno-network-$RunId"
$Temporary = Join-Path ([IO.Path]::GetTempPath()) "molit-kyverno-$RunId"
$Utf8 = [Text.UTF8Encoding]::new($false)

function Write-Utf8([string]$Path, [string]$Value) {
  [IO.File]::WriteAllText($Path, $Value, $Utf8)
}

function Canonical-PemSha256([string]$Value) {
  $Canonical = (($Value -replace "`r`n", "`n").Trim()) + "`n"
  $Sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($Sha.ComputeHash($Utf8.GetBytes($Canonical)))).Replace('-', '').ToLowerInvariant() }
  finally { $Sha.Dispose() }
}

function Invoke-Kyverno([string]$PolicyPath, [string]$ResourcePath, [bool]$Registry) {
  $DockerPath = $Temporary.Replace('\', '/')
  $ContainerName = "molit-kyverno-cli-$RunId-$([Guid]::NewGuid().ToString('N'))"
  $Arguments = @("run", "--rm", "--name", $ContainerName, "--network", $NetworkName, "-v", "${DockerPath}:/work", $KyvernoCliImage, "--v=$KyvernoLogLevel", "apply", "/work/$([IO.Path]::GetFileName($PolicyPath))", "--resource", "/work/$([IO.Path]::GetFileName($ResourcePath))", "--detailed-results", "--remove-color")
  if ($Registry) { $Arguments += "--registry" }
  $StartInfo = [Diagnostics.ProcessStartInfo]::new()
  $StartInfo.FileName = "docker"
  $StartInfo.UseShellExecute = $false
  $StartInfo.RedirectStandardOutput = $true
  $StartInfo.RedirectStandardError = $true
  $StartInfo.Arguments = ($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }
    else { $_ }
  }) -join ' '
  $Process = [Diagnostics.Process]::new()
  $Process.StartInfo = $StartInfo
  if (-not $Process.Start()) { throw "Kyverno CLI process did not start" }
  $Stdout = $Process.StandardOutput.ReadToEndAsync()
  $Stderr = $Process.StandardError.ReadToEndAsync()
  if (-not $Process.WaitForExit($KyvernoTimeoutSeconds * 1000)) {
    docker kill --signal=QUIT $ContainerName 2>$null | Out-Null
    if (-not $Process.WaitForExit(5000)) {
      docker rm -f $ContainerName 2>$null | Out-Null
      try { $Process.Kill($true) } catch {}
      $Process.WaitForExit()
    }
    $TimedOutOutput = (($Stdout.GetAwaiter().GetResult(), $Stderr.GetAwaiter().GetResult()) | Where-Object { $_ }) -join "`n"
    throw "Kyverno CLI exceeded ${KyvernoTimeoutSeconds}s for $([IO.Path]::GetFileName($ResourcePath)):`n$TimedOutOutput"
  }
  $Output = (($Stdout.GetAwaiter().GetResult(), $Stderr.GetAwaiter().GetResult()) | Where-Object { $_ }) -join "`n"
  return [pscustomobject]@{ exitCode = $Process.ExitCode; output = $Output }
}

function Assert-Denied([pscustomobject]$Result, [string]$Pattern, [string]$Label) {
  if ($Result.exitCode -eq 0) { throw "Kyverno admitted $Label" }
  if ($Result.output -notmatch $Pattern) { throw "Kyverno denied $Label for an unexpected reason:`n$($Result.output)" }
}

function Write-ReleasePredicate([string]$Path, [string]$ImageName, [string]$Digest, [string]$Service, [string]$RuntimeClass, [bool]$ProductionEligible = $true) {
  $Now = [DateTimeOffset]::UtcNow.ToString('o')
  $Artifact = [ordered]@{ service = $Service; runtimeClass = $RuntimeClass; productionEligible = $ProductionEligible }
  $Predicate = [ordered]@{
    schemaVersion = "molit.supply-chain-release/1"
    artifact = $Artifact
    image = [ordered]@{ name = $ImageName; digest = $Digest }
    vulnerabilityGate = [ordered]@{
      decision = "pass"
      blockingSeverities = @("UNKNOWN", "HIGH", "CRITICAL")
      findingCount = 0
      databaseUpdatedAt = $Now
      evaluatedAt = $Now
    }
    provenance = [ordered]@{
      predicateType = "https://slsa.dev/provenance/v1"
      predicate = [ordered]@{
        buildDefinition = [ordered]@{ externalParameters = [ordered]@{ artifact = $Artifact } }
        runDetails = [ordered]@{ metadata = [ordered]@{ finishedOn = $Now } }
      }
    }
  }
  Write-Utf8 $Path (($Predicate | ConvertTo-Json -Depth 20 -Compress) + "`n")
}

docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker daemon is unavailable" }
New-Item -ItemType Directory -Path $Temporary | Out-Null

try {
  docker network create $NetworkName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Fixture Docker network creation failed" }
  docker run --detach --name $RegistryName --network $NetworkName --publish "[::1]::5000" $RegistryImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Pinned local registry did not start" }
  $PortLine = ((& docker ps --filter "name=^/$RegistryName`$" --format '{{.Ports}}') | Select-Object -First 1).Trim()
  $PortMatch = [regex]::Match($PortLine, ':(?<port>[0-9]+)->5000/tcp')
  if (-not $PortMatch.Success) { throw "Cannot resolve the local registry port" }
  $PublishedPort = $PortMatch.Groups['port'].Value
  $DaemonPortLine = ((& docker port $RegistryName 5000/tcp) | Select-Object -First 1).Trim()
  $DaemonPortMatch = [regex]::Match($DaemonPortLine, ':(?<port>[0-9]+)$')
  if (-not $DaemonPortMatch.Success) { throw "Cannot resolve the Docker daemon registry port" }
  $DaemonPort = $DaemonPortMatch.Groups['port'].Value
  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
    try {
      $Response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$PublishedPort/v2/" -TimeoutSec 2
      if ($Response.StatusCode -eq 200) { $Ready = $true; break }
    } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $Ready) { throw "Local registry did not become ready" }

  $LocalPrefix = "localhost:$DaemonPort/molit"
  $ContainerPrefix = "$RegistryName`:5000/molit"
  docker pull $FixtureImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Pinned fixture image pull failed" }
  foreach ($Service in @("caas", "dsaas", "fencing-webhook", "edc-control-plane", "edc-schema-migration", "postgres-operand", "otel-collector")) {
    docker tag $FixtureImage "$LocalPrefix/$Service`:fixture"
    docker push "$LocalPrefix/$Service`:fixture" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Fixture image push failed: $Service" }
  }
  $RepoDigests = (docker image inspect "$LocalPrefix/caas`:fixture" | ConvertFrom-Json).RepoDigests
  $RepoDigest = $RepoDigests | Where-Object { $_.StartsWith("$LocalPrefix/caas@", [StringComparison]::Ordinal) } | Select-Object -First 1
  if ($RepoDigest -notmatch '@(?<digest>sha256:[a-f0-9]{64})$') { throw "Fixture image digest is unavailable" }
  $Digest = $Matches.digest

  $DockerPath = $Temporary.Replace('\', '/')
  $env:COSIGN_PASSWORD = $Password
  docker run --rm --network $NetworkName -e COSIGN_PASSWORD -v "${DockerPath}:/work" $CosignImage generate-key-pair --output-key-prefix /work/cosign | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Cosign fixture key generation failed" }
  docker run --rm --network $NetworkName -e COSIGN_PASSWORD -v "${DockerPath}:/work" $CosignImage generate-key-pair --output-key-prefix /work/wrong-cosign | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Cosign wrong-key fixture generation failed" }
  $PublicKey = Get-Content -LiteralPath (Join-Path $Temporary 'cosign.pub') -Raw
  $TrustAnchorSha256 = Canonical-PemSha256 $PublicKey

  $CorrectPredicate = Join-Path $Temporary 'correct-release-bundle.json'
  $CorrectDsaasPredicate = Join-Path $Temporary 'correct-dsaas-release-bundle.json'
  $CorrectSchemaPredicate = Join-Path $Temporary 'correct-schema-release-bundle.json'
  $WrongPredicate = Join-Path $Temporary 'wrong-runtime-release-bundle.json'
  $WrongKeyPredicate = Join-Path $Temporary 'wrong-key-release-bundle.json'
  $FalseEligiblePredicate = Join-Path $Temporary 'false-eligible-release-bundle.json'
  Write-ReleasePredicate $CorrectPredicate "$ContainerPrefix/caas" $Digest "caas" "caas-control-plane"
  Write-ReleasePredicate $CorrectDsaasPredicate "$ContainerPrefix/dsaas" $Digest "dsaas" "dsaas-control-plane"
  Write-ReleasePredicate $CorrectSchemaPredicate "$ContainerPrefix/edc-schema-migration" $Digest "edc-schema-migration" "schema-migration"
  Write-ReleasePredicate $WrongPredicate "$ContainerPrefix/fencing-webhook" $Digest "caas" "caas-control-plane"
  Write-ReleasePredicate $WrongKeyPredicate "$ContainerPrefix/otel-collector" $Digest "otel-collector" "otel-collector"
  Write-ReleasePredicate $FalseEligiblePredicate "$ContainerPrefix/postgres-operand" $Digest "postgres-operand" "postgres-operand" $false
  $CorrectImage = "$ContainerPrefix/caas@$Digest"
  $CorrectDsaasImage = "$ContainerPrefix/dsaas@$Digest"
  $CorrectSchemaImage = "$ContainerPrefix/edc-schema-migration@$Digest"
  $WrongImage = "$ContainerPrefix/fencing-webhook@$Digest"
  $WrongKeyImage = "$ContainerPrefix/otel-collector@$Digest"
  $FalseEligibleImage = "$ContainerPrefix/postgres-operand@$Digest"
  foreach ($Image in @($CorrectImage, $CorrectDsaasImage, $CorrectSchemaImage, $WrongImage, $FalseEligibleImage)) {
    docker run --rm --network $NetworkName -e COSIGN_PASSWORD -v "${DockerPath}:/work" $CosignImage sign --yes --new-bundle-format=false --use-signing-config=false --tlog-upload=false --allow-http-registry --allow-insecure-registry --key /work/cosign.key $Image | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Cosign fixture signature failed: $Image" }
  }
  docker run --rm --network $NetworkName -e COSIGN_PASSWORD -v "${DockerPath}:/work" $CosignImage sign --yes --new-bundle-format=false --use-signing-config=false --tlog-upload=false --allow-http-registry --allow-insecure-registry --key /work/wrong-cosign.key $WrongKeyImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Cosign wrong-key image signature fixture failed" }
  docker run --rm --network $NetworkName -e COSIGN_PASSWORD -v "${DockerPath}:/work" $CosignImage attest --yes --new-bundle-format=false --use-signing-config=false --tlog-upload=false --allow-http-registry --allow-insecure-registry --key /work/cosign.key --type https://data.molit.go.kr/attestations/release-bundle/v1 --predicate /work/correct-release-bundle.json $CorrectImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Correct release attestation fixture failed" }
  docker run --rm --network $NetworkName -e COSIGN_PASSWORD -v "${DockerPath}:/work" $CosignImage attest --yes --new-bundle-format=false --use-signing-config=false --tlog-upload=false --allow-http-registry --allow-insecure-registry --key /work/cosign.key --type https://data.molit.go.kr/attestations/release-bundle/v1 --predicate /work/correct-dsaas-release-bundle.json $CorrectDsaasImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Correct DSaaS release attestation fixture failed" }
  docker run --rm --network $NetworkName -e COSIGN_PASSWORD -v "${DockerPath}:/work" $CosignImage attest --yes --new-bundle-format=false --use-signing-config=false --tlog-upload=false --allow-http-registry --allow-insecure-registry --key /work/cosign.key --type https://data.molit.go.kr/attestations/release-bundle/v1 --predicate /work/correct-schema-release-bundle.json $CorrectSchemaImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Correct schema-migration release attestation fixture failed" }
  docker run --rm --network $NetworkName -e COSIGN_PASSWORD -v "${DockerPath}:/work" $CosignImage attest --yes --new-bundle-format=false --use-signing-config=false --tlog-upload=false --allow-http-registry --allow-insecure-registry --key /work/cosign.key --type https://data.molit.go.kr/attestations/release-bundle/v1 --predicate /work/wrong-runtime-release-bundle.json $WrongImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Wrong-runtime release attestation fixture failed" }
  docker run --rm --network $NetworkName -e COSIGN_PASSWORD -v "${DockerPath}:/work" $CosignImage attest --yes --new-bundle-format=false --use-signing-config=false --tlog-upload=false --allow-http-registry --allow-insecure-registry --key /work/cosign.key --type https://data.molit.go.kr/attestations/release-bundle/v1 --predicate /work/false-eligible-release-bundle.json $FalseEligibleImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "False-eligible release attestation fixture failed" }
  docker run --rm --network $NetworkName -e COSIGN_PASSWORD -v "${DockerPath}:/work" $CosignImage attest --yes --new-bundle-format=false --use-signing-config=false --tlog-upload=false --allow-http-registry --allow-insecure-registry --key /work/wrong-cosign.key --type https://data.molit.go.kr/attestations/release-bundle/v1 --predicate /work/wrong-key-release-bundle.json $WrongKeyImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Wrong-key release attestation fixture failed" }

  $IndentedKey = (($PublicKey.Trim() -split '\r?\n') | ForEach-Object { "            $_" }) -join "`n"
  $Template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'verify-images.template.yaml') -Raw
  $Rendered = $Template.Replace('@@REGISTRY_PREFIX@@', $ContainerPrefix).Replace('@@COSIGN_PUBLIC_KEY@@', $IndentedKey).Replace('@@COSIGN_PUBLIC_KEY_SHA256@@', $TrustAnchorSha256).Replace('@@ALLOW_INSECURE_REGISTRY@@', 'true')
  if ($Rendered -match '@@[A-Z_]+@@') { throw "An unresolved admission policy placeholder remains" }
  $PolicyPath = Join-Path $Temporary 'policy.yaml'
  Write-Utf8 $PolicyPath $Rendered

  $UnrelatedPath = Join-Path $Temporary 'unrelated.yaml'
  Write-Utf8 $UnrelatedPath @'
apiVersion: v1
kind: Pod
metadata: { name: unrelated, namespace: default }
spec:
  containers:
    - { name: app, image: "docker.io/library/busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662" }
'@
  $UnrelatedResult = Invoke-Kyverno $PolicyPath $UnrelatedPath $false
  if ($UnrelatedResult.exitCode -ne 0) { throw "Kyverno rejected an unrelated namespace:`n$($UnrelatedResult.output)" }

  $CorrectPath = Join-Path $Temporary 'correct-regular.yaml'
  Write-Utf8 $CorrectPath "apiVersion: v1`nkind: Pod`nmetadata: { name: correct-regular, namespace: molit-caas-system }`nspec:`n  containers:`n    - { name: app, image: `"$CorrectImage`", command: ['sleep', '3600'] }`n"
  $CorrectResult = Invoke-Kyverno $PolicyPath $CorrectPath $true
  if ($CorrectResult.exitCode -ne 0) { throw "Kyverno rejected a correctly signed regular container:`n$($CorrectResult.output)" }

  $CorrectInitPath = Join-Path $Temporary 'correct-init.yaml'
  Write-Utf8 $CorrectInitPath "apiVersion: v1`nkind: Pod`nmetadata: { name: correct-init, namespace: molit-caas-system }`nspec:`n  initContainers:`n    - { name: migration, image: `"$CorrectSchemaImage`", command: ['true'] }`n  containers:`n    - { name: app, image: `"$CorrectImage`", command: ['sleep', '3600'] }`n"
  $CorrectInitResult = Invoke-Kyverno $PolicyPath $CorrectInitPath $true
  if ($CorrectInitResult.exitCode -ne 0) { throw "Kyverno rejected a correctly signed init container:`n$($CorrectInitResult.output)" }

  $CorrectEphemeralPath = Join-Path $Temporary 'correct-ephemeral.yaml'
  Write-Utf8 $CorrectEphemeralPath "apiVersion: v1`nkind: Pod`nmetadata: { name: correct-ephemeral, namespace: molit-caas-system }`nspec:`n  containers:`n    - { name: app, image: `"$CorrectImage`", command: ['sleep', '3600'] }`n  ephemeralContainers:`n    - { name: debug, image: `"$CorrectDsaasImage`", targetContainerName: app, command: ['true'] }`n"
  $CorrectEphemeralResult = Invoke-Kyverno $PolicyPath $CorrectEphemeralPath $true
  if ($CorrectEphemeralResult.exitCode -ne 0) { throw "Kyverno rejected a correctly signed ephemeral container:`n$($CorrectEphemeralResult.output)" }

  $ForeignPath = Join-Path $Temporary 'foreign.yaml'
  Write-Utf8 $ForeignPath @'
apiVersion: v1
kind: Pod
metadata: { name: foreign, namespace: observability }
spec:
  containers:
    - { name: app, image: "docker.io/library/busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662" }
'@
  Assert-Denied (Invoke-Kyverno $PolicyPath $ForeignPath $false) 'molit-restrict-release-images' 'a foreign registry image'

  $MutablePath = Join-Path $Temporary 'mutable.yaml'
  Write-Utf8 $MutablePath "apiVersion: v1`nkind: Pod`nmetadata: { name: mutable, namespace: molit-caas-system }`nspec:`n  containers:`n    - { name: app, image: `"$ContainerPrefix/caas`:latest`" }`n"
  Assert-Denied (Invoke-Kyverno $PolicyPath $MutablePath $false) 'molit-restrict-release-images' 'a mutable release image'

  $UnknownPath = Join-Path $Temporary 'unknown.yaml'
  Write-Utf8 $UnknownPath "apiVersion: v1`nkind: Pod`nmetadata: { name: unknown, namespace: molit-caas-system }`nspec:`n  containers:`n    - { name: app, image: `"$ContainerPrefix/not-in-inventory@$Digest`" }`n"
  Assert-Denied (Invoke-Kyverno $PolicyPath $UnknownPath $false) 'molit-restrict-release-images' 'an unknown repository under the approved prefix'

  $UnsignedInitPath = Join-Path $Temporary 'unsigned-init.yaml'
  Write-Utf8 $UnsignedInitPath "apiVersion: v1`nkind: Pod`nmetadata: { name: unsigned-init, namespace: molit-caas-system }`nspec:`n  initContainers:`n    - { name: migration, image: `"$ContainerPrefix/edc-control-plane@$Digest`", command: ['true'] }`n  containers:`n    - { name: app, image: `"$CorrectImage`", command: ['sleep', '3600'] }`n"
  Assert-Denied (Invoke-Kyverno $PolicyPath $UnsignedInitPath $true) 'molit-verify-release-images' 'an unsigned init container'

  $WrongRuntimeInitPath = Join-Path $Temporary 'wrong-runtime-init.yaml'
  Write-Utf8 $WrongRuntimeInitPath "apiVersion: v1`nkind: Pod`nmetadata: { name: wrong-runtime-init, namespace: molit-caas-system }`nspec:`n  initContainers:`n    - { name: migration, image: `"$WrongImage`", command: ['true'] }`n  containers:`n    - { name: app, image: `"$CorrectImage`", command: ['sleep', '3600'] }`n"
  Assert-Denied (Invoke-Kyverno $PolicyPath $WrongRuntimeInitPath $true) 'molit-verify-release-images' 'a signed init container with the wrong runtime class'

  $WrongKeyPath = Join-Path $Temporary 'wrong-key.yaml'
  Write-Utf8 $WrongKeyPath "apiVersion: v1`nkind: Pod`nmetadata: { name: wrong-key, namespace: molit-caas-system }`nspec:`n  containers:`n    - { name: telemetry, image: `"$WrongKeyImage`", command: ['sleep', '3600'] }`n"
  Assert-Denied (Invoke-Kyverno $PolicyPath $WrongKeyPath $true) 'molit-verify-release-images' 'an image signed by an untrusted key'

  $FalseEligiblePath = Join-Path $Temporary 'false-eligible.yaml'
  Write-Utf8 $FalseEligiblePath "apiVersion: v1`nkind: Pod`nmetadata: { name: false-eligible, namespace: molit-caas-system }`nspec:`n  containers:`n    - { name: database, image: `"$FalseEligibleImage`", command: ['sleep', '3600'] }`n"
  Assert-Denied (Invoke-Kyverno $PolicyPath $FalseEligiblePath $true) 'molit-verify-release-images' 'a signed image whose release bundle is not production eligible'

  [pscustomobject]@{
    policyApiVersion = "policies.kyverno.io/v1"
    unrelatedAllowed = $true
    correctlySignedRegularContainerAllowed = $true
    correctlySignedInitContainerAllowed = $true
    correctlySignedEphemeralContainerAllowed = $true
    foreignRegistryDenied = $true
    mutableTagDenied = $true
    unknownRepositoryDenied = $true
    unsignedInitContainerDenied = $true
    signedWrongKeyDenied = $true
    signedWrongRuntimeInitContainerDenied = $true
    signedFalseEligibleDenied = $true
    trustAnchorSha256 = $TrustAnchorSha256
    transparencyLog = 'disabled'
  } | ConvertTo-Json -Compress
} finally {
  Remove-Item Env:COSIGN_PASSWORD -ErrorAction SilentlyContinue
  docker rm -f $RegistryName 2>$null | Out-Null
  docker network rm $NetworkName 2>$null | Out-Null
  if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Recurse -Force }
}
