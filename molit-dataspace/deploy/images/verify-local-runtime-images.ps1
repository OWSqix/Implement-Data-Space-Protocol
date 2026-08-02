[CmdletBinding()]
param(
  [string]$EvidencePath = ".local/p0/runtime-images.json"
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$EvidencePath = if ([System.IO.Path]::IsPathRooted($EvidencePath)) {
  [System.IO.Path]::GetFullPath($EvidencePath)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $root $EvidencePath))
}
$evidenceDirectory = Split-Path -Parent $EvidencePath
New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
$runId = "$PID-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$inventoryRelativePath = "deploy/supply-chain/runtime-image-inventory.v1.json"
$inventoryPath = Join-Path $root $inventoryRelativePath
$images = @(
  [ordered]@{
    service = "caas"
    tag = "molit-caas-p0-$runId`:local"
    dockerfile = "deploy/images/Dockerfile.caas"
    context = "."
    target = $null
    allowedUsers = @("node", "1000", "1000:1000")
    modules = @("./src/caas/runtime.mjs", "./src/caas/server.mjs")
    runtimeJar = $false
    expectedProductionEligible = "true"
    expectedRuntimeClass = "caas-control-plane"
    healthMode = "required"
  },
  [ordered]@{
    service = "dsaas"
    tag = "molit-dsaas-p0-$runId`:local"
    dockerfile = "deploy/images/Dockerfile.dsaas"
    context = "."
    target = $null
    allowedUsers = @("node", "1000", "1000:1000")
    modules = @("./src/dsaas/runtime.mjs", "./src/dsaas/server.mjs")
    runtimeJar = $false
    expectedProductionEligible = "true"
    expectedRuntimeClass = "dsaas-control-plane"
    healthMode = "required"
  },
  [ordered]@{
    service = "fencing-webhook"
    tag = "molit-fencing-webhook-p0-$runId`:local"
    dockerfile = "deploy/kubernetes/fencing-webhook.Dockerfile"
    context = "."
    target = $null
    allowedUsers = @("1000", "1000:1000")
    modules = @("./kubernetes-fencing-webhook.mjs")
    runtimeJar = $false
    expectedProductionEligible = "true"
    expectedRuntimeClass = "fencing-webhook"
    healthMode = "absent"
  },
  [ordered]@{
    service = "edc-control-plane"
    tag = "molit-edc-control-plane-p0-$runId`:local"
    dockerfile = "deploy/edc/Dockerfile"
    context = "deploy/edc"
    target = "control-plane"
    allowedUsers = @("10001", "10001:10001")
    modules = @()
    runtimeJar = $true
    expectedProductionEligible = "false"
    expectedRuntimeClass = "edc-control-plane"
    healthMode = "required"
  },
  [ordered]@{
    service = "edc-data-plane"
    tag = "molit-edc-data-plane-p0-$runId`:local"
    dockerfile = "deploy/edc/Dockerfile"
    context = "deploy/edc"
    target = "data-plane"
    allowedUsers = @("10001", "10001:10001")
    modules = @()
    runtimeJar = $true
    expectedProductionEligible = "false"
    expectedRuntimeClass = "edc-data-plane"
    healthMode = "required"
  },
  [ordered]@{
    service = "edc-schema-migration"
    tag = "molit-edc-schema-migration-p0-$runId`:local"
    dockerfile = "deploy/edc/Dockerfile"
    context = "deploy/edc"
    target = "schema-migration"
    allowedUsers = @("70", "70:70")
    modules = @()
    runtimeJar = $false
    expectedProductionEligible = "true"
    expectedRuntimeClass = "schema-migration"
    healthMode = "disabled"
  }
)
$startedAt = [DateTimeOffset]::UtcNow
$results = [System.Collections.Generic.List[object]]::new()
$externalAdoptions = [System.Collections.Generic.List[object]]::new()
$inventorySchemaValidated = $false
$originalLocation = Get-Location
$failure = $null
try {
  Set-Location $root
  docker version --format "{{.Server.Version}}" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Docker daemon is unavailable" }
  node tools/operations/validate-json-evidence.mjs `
    --schema contracts/supply-chain-runtime-image-inventory.v1.schema.json `
    --input $inventoryPath
  if ($LASTEXITCODE -ne 0) { throw "runtime image inventory does not satisfy its schema" }
  $inventorySchemaValidated = $true
  $inventory = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json
  $adoptionScript = Get-Content -LiteralPath (Join-Path $root "deploy/images/adopt-sign-verify.ps1") -Raw
  foreach ($requiredText in @("--provenance-mode external-adoption", "--runtime-class `$RuntimeClass", "--production-eligible true", "tools/supply-chain/verify.mjs")) {
    if (-not $adoptionScript.Contains($requiredText)) { throw "external adoption release path is missing: $requiredText" }
  }
  foreach ($service in @("postgres-operand", "otel-collector")) {
    $entries = @($inventory.artifacts | Where-Object { $_.service -eq $service })
    if ($entries.Count -ne 1) { throw "$service must have exactly one runtime inventory entry" }
    $entry = $entries[0]
    if ($entry.runtimeClass -ne $service -or $entry.provenanceMode -ne "external-adoption" -or $entry.productionEligible -ne $true -or $entry.upstreamImage -notmatch '@sha256:[a-f0-9]{64}$') {
      throw "$service external adoption inventory entry is invalid"
    }
    $externalAdoptions.Add([ordered]@{
      service = $service
      runtimeClass = $entry.runtimeClass
      upstreamImage = $entry.upstreamImage
      provenanceMode = $entry.provenanceMode
      productionEligible = $true
      releasePathContractDeclared = $true
      operatingRegistryEvidence = $false
    })
  }

  foreach ($image in $images) {
    $inventoryEntries = @($inventory.artifacts | Where-Object { $_.service -eq $image.service })
    if ($inventoryEntries.Count -ne 1) { throw "$($image.service) must have exactly one runtime inventory entry" }
    $inventoryEntry = $inventoryEntries[0]
    if ($inventoryEntry.provenanceMode -ne "source-build" -or $inventoryEntry.runtimeClass -ne $image.expectedRuntimeClass -or ([string]$inventoryEntry.productionEligible).ToLowerInvariant() -ne $image.expectedProductionEligible) {
      throw "$($image.service) local build expectation differs from the runtime inventory"
    }
    $buildArguments = @("build", "--file", $image.dockerfile, "--tag", $image.tag)
    if ($image.target) { $buildArguments += @("--target", $image.target) }
    $buildArguments += $image.context
    docker @buildArguments
    if ($LASTEXITCODE -ne 0) { throw "$($image.service) runtime image build failed" }
    $inspection = docker image inspect $image.tag | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $inspection.Count -ne 1) { throw "$($image.service) image inspection failed" }
    $config = $inspection[0].Config
    if ($config.User -notin @($image.allowedUsers)) { throw "$($image.service) image does not declare the expected non-root runtime user" }
    $health = @()
    if ($null -ne $config.Healthcheck -and $null -ne $config.Healthcheck.Test) { $health = @($config.Healthcheck.Test) }
    if ($image.healthMode -eq "required" -and $health.Count -lt 2) { throw "$($image.service) image healthcheck is missing" }
    if ($image.healthMode -eq "absent" -and $health.Count -ne 0) { throw "$($image.service) image must not inherit an unrelated healthcheck" }
    if ($image.healthMode -eq "disabled" -and -not ($health.Count -eq 1 -and $health[0] -eq "NONE")) {
      throw "$($image.service) one-shot image must disable the inherited healthcheck"
    }
    if ($image.modules.Count -gt 0) {
      $moduleExpression = "await Promise.all([" + (($image.modules | ForEach-Object { "import('$_')" }) -join ",") + "]);"
      docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true `
        --user $config.User --entrypoint node $image.tag --input-type=module -e $moduleExpression
    } elseif ($image.runtimeJar) {
      docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true `
        --user $config.User --entrypoint /bin/sh $image.tag -c "test -r /opt/edc/runtime.jar && java -version"
    } else {
      docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true `
        --user $config.User --entrypoint /bin/sh $image.tag -c "test -r /opt/molit-edc-schema/run-schema-migration.sh && test -x /opt/molit-edc-schema/run-schema-migration.sh"
    }
    if ($LASTEXITCODE -ne 0) { throw "$($image.service) read-only non-root runtime probe failed" }
    $productionEligible = $config.Labels.'kr.go.molit.dataspace.production-eligible'
    $runtimeClass = $config.Labels.'kr.go.molit.dataspace.runtime-class'
    if ($null -ne $image.expectedProductionEligible -and $productionEligible -ne $image.expectedProductionEligible) {
      throw "$($image.service) production eligibility label differs from the reviewed target"
    }
    if ($runtimeClass -ne $image.expectedRuntimeClass) { throw "$($image.service) runtime class label differs from the reviewed target" }
    $results.Add([ordered]@{
      service = $image.service
      imageId = $inspection[0].Id
      user = $config.User
      healthcheck = $health
      readOnlyNonRootRuntimeProbe = $true
      productionEligibleLabel = $productionEligible
      runtimeClassLabel = $runtimeClass
    })
  }
} catch {
  $failure = $_
} finally {
  foreach ($image in $images) {
    try { docker image rm --force $image.tag 2>$null | Out-Null } catch { }
  }
  Set-Location $originalLocation
}

$finishedAt = [DateTimeOffset]::UtcNow
$report = [ordered]@{
  schemaVersion = "molit.runtime-image-local-verification/1"
  startedAt = $startedAt.ToString("o")
  finishedAt = $finishedAt.ToString("o")
  durationMs = [Math]::Round(($finishedAt - $startedAt).TotalMilliseconds, 3)
  status = if ($null -eq $failure) { "passed" } else { "failed" }
  operatingRegistryEvidence = $false
  inventory = [ordered]@{
    path = $inventoryRelativePath
    sha256 = (Get-FileHash -LiteralPath $inventoryPath -Algorithm SHA256).Hash.ToLowerInvariant()
    schemaValidated = $inventorySchemaValidated
  }
  images = @($results)
  externalAdoptions = @($externalAdoptions)
  failureCode = if ($null -eq $failure) { $null } else { "RUNTIME_IMAGE_LOCAL_VERIFICATION_FAILED" }
  failureMessage = if ($null -eq $failure) { $null } else { $failure.Exception.Message }
}
[System.IO.File]::WriteAllText(
  $EvidencePath,
  (($report | ConvertTo-Json -Depth 12) + "`n"),
  [System.Text.UTF8Encoding]::new($false)
)
node tools/operations/validate-json-evidence.mjs `
  --schema contracts/runtime-image-local-verification.v1.schema.json `
  --input $EvidencePath
if ($LASTEXITCODE -ne 0) { throw "runtime image evidence does not satisfy its schema" }
Write-Output "Runtime image evidence: $EvidencePath"
if ($null -ne $failure) { throw $failure }
