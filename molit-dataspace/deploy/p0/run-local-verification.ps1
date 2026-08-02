[CmdletBinding()]
param(
  [string]$EvidencePath = "",
  [switch]$SkipKeycloak,
  [switch]$SkipKind,
  [switch]$SkipHaPitr
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
if (-not $EvidencePath) {
  $EvidencePath = Join-Path $root ".local/p0/local-verification.json"
}
$EvidencePath = [System.IO.Path]::GetFullPath($EvidencePath)
$evidenceDirectory = Split-Path -Parent $EvidencePath
New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
$logDirectory = Join-Path $evidenceDirectory "logs"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Get-Sha256([string]$Value) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $algorithm.ComputeHash($bytes)
    return (($hash | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally {
    $algorithm.Dispose()
  }
}

function Get-ToolVersion([string]$FilePath, [string[]]$Arguments) {
  try {
    $value = (& $FilePath @Arguments 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $value) { return $null }
    return $value
  } catch {
    return $null
  }
}

function Invoke-VerificationStep($Definition) {
  $startedAt = [DateTimeOffset]::UtcNow
  $logPath = Join-Path $logDirectory "$($Definition.id).log"
  if (Test-Path -LiteralPath $logPath) { Remove-Item -LiteralPath $logPath -Force }
  foreach ($artifact in @($Definition.artifacts)) {
    $artifactPath = [System.IO.Path]::GetFullPath((Join-Path $evidenceDirectory $artifact.pathRelativeToEvidence))
    if (-not $artifactPath.StartsWith("$evidenceDirectory$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "P0 artifact escapes the evidence directory: $($Definition.id)"
    }
    if (Test-Path -LiteralPath $artifactPath) { Remove-Item -LiteralPath $artifactPath -Force }
  }
  Write-Host "[$($Definition.id)] $($Definition.file) $($Definition.arguments -join ' ')"
  & $Definition.file @($Definition.arguments) 2>&1 | Tee-Object -FilePath $logPath | Out-Host
  $exitCode = $LASTEXITCODE
  if ($Definition.expectedExitCodes -contains $exitCode) {
    foreach ($artifact in @($Definition.artifacts)) {
      $artifactPath = [System.IO.Path]::GetFullPath((Join-Path $evidenceDirectory $artifact.pathRelativeToEvidence))
      if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
        [System.IO.File]::AppendAllText($logPath, "Expected P0 artifact is missing: $($artifact.pathRelativeToEvidence)`n", [System.Text.UTF8Encoding]::new($false))
        $exitCode = 97
        break
      }
      & $node tools/operations/validate-json-evidence.mjs --schema $artifact.schema --input $artifactPath 2>&1 | Tee-Object -FilePath $logPath -Append | Out-Host
      if ($LASTEXITCODE -ne 0) {
        $exitCode = 98
        break
      }
    }
  }
  if (-not (Test-Path -LiteralPath $logPath)) {
    [System.IO.File]::WriteAllText($logPath, "", [System.Text.UTF8Encoding]::new($false))
  }
  $finishedAt = [DateTimeOffset]::UtcNow
  $passed = $Definition.expectedExitCodes -contains $exitCode
  $log = Get-Item -LiteralPath $logPath
  return [ordered]@{
    id = $Definition.id
    command = $Definition.command
    arguments = @($Definition.arguments)
    expectedExitCodes = @($Definition.expectedExitCodes)
    exitCode = $exitCode
    status = if ($passed) { "passed" } else { "failed" }
    startedAt = $startedAt.ToString("o")
    finishedAt = $finishedAt.ToString("o")
    durationMs = [Math]::Round(($finishedAt - $startedAt).TotalMilliseconds, 3)
    log = [ordered]@{
      pathRelativeToEvidence = "logs/$($Definition.id).log"
      sha256 = (Get-FileHash -LiteralPath $logPath -Algorithm SHA256).Hash.ToLowerInvariant()
      bytes = $log.Length
    }
  }
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$verificationProfilePath = Join-Path $root "deploy/p0/verification-steps.v1.json"
$verificationProfile = Get-Content -LiteralPath $verificationProfilePath -Raw | ConvertFrom-Json
if ($verificationProfile.schemaVersion -ne "molit.p0-verification-steps/1" -or $verificationProfile.executable -ne "npm") {
  throw "P0 verification profile is invalid"
}

function Get-ProjectSourceDigest {
  $raw = (& $node tools/operations/worktree-source-digest.mjs | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw "Cannot compute the project source digest" }
  try { $value = $raw | ConvertFrom-Json } catch { throw "Project source digest output is invalid" }
  if ($value.algorithm -ne "git-ls-files-content-sha256-v1" -or $value.digest -notmatch '^[a-f0-9]{64}$' -or [int64]$value.fileCount -lt 1) {
    throw "Project source digest output is incomplete"
  }
  return $value
}

$startedAt = [DateTimeOffset]::UtcNow
$skipIds = @()
if ($SkipKeycloak) { $skipIds += "keycloak-integration" }
if ($SkipKind) { $skipIds += "kubernetes-kind-30" }
if ($SkipHaPitr) { $skipIds += "postgres-ha-pitr" }
$definitions = @($verificationProfile.steps | ForEach-Object {
  [ordered]@{
    id = $_.id
    command = $verificationProfile.executable
    file = $npm
    arguments = @($_.arguments | ForEach-Object { $_.Replace("{{EVIDENCE_DIR}}", $evidenceDirectory) })
    expectedExitCodes = @($_.expectedExitCodes | ForEach-Object { [int]$_ })
    artifacts = @($_.artifacts)
    skip = $skipIds -contains $_.id
  }
})

$steps = [System.Collections.Generic.List[object]]::new()
$skipped = [System.Collections.Generic.List[string]]::new()
$originalLocation = Get-Location
try {
  Set-Location $root
  $sourceCommit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[a-f0-9]{40}$') {
    throw "Cannot determine the source commit"
  }
  $sourceStatus = (& git status --porcelain=v1 --untracked-files=all -- . | Out-String).Replace("`r`n", "`n")
  if ($LASTEXITCODE -ne 0) { throw "Cannot determine the project worktree status" }
  $sourceAtStart = Get-ProjectSourceDigest

  foreach ($definition in $definitions) {
    if ($definition.skip) {
      $skipped.Add($definition.id)
      Write-Output "[$($definition.id)] skipped"
      continue
    }
    $steps.Add((Invoke-VerificationStep $definition))
  }

  $sourceAtFinish = Get-ProjectSourceDigest
  $sourceStatusAtFinish = (& git status --porcelain=v1 --untracked-files=all -- . | Out-String).Replace("`r`n", "`n")
  if ($LASTEXITCODE -ne 0) { throw "Cannot verify the final project worktree status" }
  $sourceStable = $sourceAtStart.digest -eq $sourceAtFinish.digest -and [int64]$sourceAtStart.fileCount -eq [int64]$sourceAtFinish.fileCount -and $sourceStatus -ceq $sourceStatusAtFinish
  $finishedAt = [DateTimeOffset]::UtcNow
  $failed = @($steps | Where-Object { $_.status -ne "passed" })
  $complete = $failed.Count -eq 0 -and $skipped.Count -eq 0 -and $sourceStable
  $artifacts = @($definitions | Where-Object { -not $_.skip } | ForEach-Object {
    $stepId = $_.id
    @($_.artifacts) | ForEach-Object {
      $artifactPath = [System.IO.Path]::GetFullPath((Join-Path $evidenceDirectory $_.pathRelativeToEvidence))
      if (Test-Path -LiteralPath $artifactPath -PathType Leaf) {
        $artifact = Get-Item -LiteralPath $artifactPath
        [ordered]@{
          sourceStepId = $stepId
          pathRelativeToEvidence = $_.pathRelativeToEvidence
          schema = $_.schema
          sha256 = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
          bytes = $artifact.Length
        }
      }
    }
  })
  $report = [ordered]@{
    schemaVersion = "molit.p0-local-verification/1"
    startedAt = $startedAt.ToString("o")
    finishedAt = $finishedAt.ToString("o")
    durationMs = [Math]::Round(($finishedAt - $startedAt).TotalMilliseconds, 3)
    source = [ordered]@{
      commit = $sourceCommit
      worktreeClean = [string]::IsNullOrWhiteSpace($sourceStatus)
      immutableReleaseEvidence = [string]::IsNullOrWhiteSpace($sourceStatus)
      statusSha256 = Get-Sha256 $sourceStatus
      digestAlgorithm = $sourceAtStart.algorithm
      worktreeDigest = $sourceAtStart.digest
      fileCount = [int64]$sourceAtStart.fileCount
      stableDuringRun = $sourceStable
    }
    environment = [ordered]@{
      operatingSystem = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
      architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
      node = Get-ToolVersion "node" @("--version")
      npm = Get-ToolVersion $npm @("--version")
      docker = Get-ToolVersion "docker" @("version", "--format", "{{.Server.Version}}")
      kubectl = Get-ToolVersion "kubectl" @("version", "--client", "--output=json")
      kind = Get-ToolVersion "kind" @("version")
    }
    verificationProfile = [ordered]@{
      path = "deploy/p0/verification-steps.v1.json"
      sha256 = (Get-FileHash -LiteralPath $verificationProfilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    complete = $complete
    skipped = @($skipped)
    steps = @($steps)
    artifacts = @($artifacts)
    externalOperatingEvidence = "not-evaluated-as-pass"
  }
  [System.IO.File]::WriteAllText(
    $EvidencePath,
    (($report | ConvertTo-Json -Depth 20) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
  node tools/operations/verify-p0-local-evidence.mjs --input $EvidencePath
  if ($LASTEXITCODE -ne 0) { throw "P0 local verification evidence does not satisfy its schema" }
  Write-Output "P0 local verification evidence: $EvidencePath"
  if (-not $complete) {
    if ($failed.Count -gt 0 -or -not $sourceStable) { exit 1 }
    exit 3
  }
} finally {
  Set-Location $originalLocation
}
