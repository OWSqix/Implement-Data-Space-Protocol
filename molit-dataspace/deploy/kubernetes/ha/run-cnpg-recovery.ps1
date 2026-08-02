[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Context,
  [Parameter(Mandatory = $true)][ValidatePattern("^[a-z0-9](?:[-a-z0-9]{0,30}[a-z0-9])?$")][string]$RecoveryId,
  [Parameter(Mandatory = $true)][string]$RecoveryTargetTime,
  [Parameter(Mandatory = $true)][string]$PostgresImage,
  [Parameter(Mandatory = $true)][string]$DatabaseToolImage,
  [Parameter(Mandatory = $true)][string]$RegistryPrefix,
  [Parameter(Mandatory = $true)][string]$StorageClass,
  [Parameter(Mandatory = $true)][string]$CaasDatabaseRole,
  [Parameter(Mandatory = $true)][string]$DsaasDatabaseRole,
  [Parameter(Mandatory = $true)][ValidatePattern("^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$")][string]$RecoveryDatabaseSecret,
  [Parameter(Mandatory = $true)][ValidatePattern("^[a-f0-9]{64}$")][string]$ExpectedCaasStateRoot,
  [Parameter(Mandatory = $true)][ValidatePattern("^[a-f0-9]{64}$")][string]$ExpectedDsaasStateRoot
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$ClusterName = "molit-control-store-recovery-$RecoveryId"
$DigestImage = '^[^\s"'']+@sha256:[a-f0-9]{64}$'
if ($PostgresImage -notmatch $DigestImage -or $DatabaseToolImage -notmatch $DigestImage) { throw "Recovery images must use immutable sha256 references" }
if ($RegistryPrefix -notmatch '^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9._/-]+$' -or $RegistryPrefix.Contains('..') -or $RegistryPrefix.EndsWith('/')) { throw "RegistryPrefix is invalid" }
if ($PostgresImage.Substring(0, $PostgresImage.IndexOf('@')) -cne "$RegistryPrefix/postgres-operand") { throw "PostgresImage must use the canonical postgres-operand repository" }
if ($DatabaseToolImage.Substring(0, $DatabaseToolImage.IndexOf('@')) -cne "$RegistryPrefix/edc-schema-migration") { throw "DatabaseToolImage must use the canonical edc-schema-migration repository" }
if ($StorageClass -notmatch '^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$') { throw "StorageClass is invalid" }
if ($CaasDatabaseRole -notmatch '^[a-z][a-z0-9_]{2,62}$' -or $DsaasDatabaseRole -notmatch '^[a-z][a-z0-9_]{2,62}$' -or $CaasDatabaseRole -eq $DsaasDatabaseRole) { throw "Runtime database roles are invalid" }
if ($RecoveryTargetTime -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$') { throw "RecoveryTargetTime must be an RFC 3339 timestamp" }
try {
  $Target = [DateTimeOffset]::ParseExact($RecoveryTargetTime, @("yyyy-MM-dd'T'HH:mm:ssK", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFFK"), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None)
} catch { throw "RecoveryTargetTime must be an exact RFC 3339 timestamp" }
$Now = [DateTimeOffset]::UtcNow
if ($Target -gt $Now) { throw "RecoveryTargetTime cannot be in the future" }
if ($Target -lt $Now.AddDays(-30)) { throw "RecoveryTargetTime is outside the 30-day backup retention window" }
$CanonicalTarget = $Target.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

function Invoke-Kubectl([string[]]$Arguments) {
  & kubectl --context $Context @Arguments
  if ($LASTEXITCODE -ne 0) { throw "kubectl failed: $($Arguments -join ' ')" }
}

$CurrentContext = (& kubectl config current-context).Trim()
if ($LASTEXITCODE -ne 0 -or $CurrentContext -ne $Context) { throw "kubectl current context does not match Context" }
foreach ($Path in @(
  "cluster.spec.bootstrap.recovery.source",
  "cluster.spec.bootstrap.recovery.recoveryTarget.targetTime",
  "cluster.spec.externalClusters.plugin.name",
  "cluster.spec.externalClusters.plugin.parameters"
)) {
  & kubectl --context $Context explain $Path --api-version=postgresql.cnpg.io/v1 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Installed CloudNativePG CRD lacks recovery capability: $Path" }
}
Invoke-Kubectl @("get", "crd", "objectstores.barmancloud.cnpg.io") | Out-Null
Invoke-Kubectl @("-n", "molit-caas-system", "get", "objectstore", "molit-control-store-backup") | Out-Null
$ExistingRecovery = & kubectl --context $Context -n molit-caas-system get cluster $ClusterName --ignore-not-found -o name
if ($LASTEXITCODE -ne 0) { throw "Recovery Cluster reuse check failed" }
if ($ExistingRecovery) { throw "RecoveryId already belongs to an existing Cluster and cannot be reused" }
$RecoverySecret = (& kubectl --context $Context -n molit-caas-system get secret $RecoveryDatabaseSecret -o json) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $null -eq $RecoverySecret.data.username -or $null -eq $RecoverySecret.data.password) { throw "RecoveryDatabaseSecret must contain the target-time username and password" }

$Temporary = Join-Path ([IO.Path]::GetTempPath()) "molit-cnpg-recovery-$PID-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $Temporary | Out-Null
try {
  $Manifest = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "postgres-recovery.template.yaml"))
  $Manifest = $Manifest.Replace("@@RECOVERY_CLUSTER_NAME@@", $ClusterName).Replace("@@RECOVERY_TARGET_TIME@@", $CanonicalTarget)
  $Manifest = $Manifest.Replace("@@POSTGRES_IMAGE@@", $PostgresImage).Replace("@@STORAGE_CLASS@@", $StorageClass)
  $Manifest = $Manifest.Replace("@@CAAS_DATABASE_ROLE@@", $CaasDatabaseRole).Replace("@@DSAAS_DATABASE_ROLE@@", $DsaasDatabaseRole)
  if ($Manifest -match '@@[A-Z_]+@@') { throw "An unresolved recovery manifest placeholder remains" }
  $ManifestPath = Join-Path $Temporary "recovery.yaml"
  [IO.File]::WriteAllText($ManifestPath, $Manifest, [Text.UTF8Encoding]::new($false))
  Invoke-Kubectl @("apply", "--server-side", "--dry-run=server", "-f", $ManifestPath) | Out-Null
  Invoke-Kubectl @("apply", "--server-side", "--field-manager=molit-platform-recovery", "-f", $ManifestPath) | Out-Null
  Invoke-Kubectl @("-n", "molit-caas-system", "wait", "cluster/$ClusterName", "--for=condition=Ready", "--timeout=30m") | Out-Null
  $Recovery = (& kubectl --context $Context -n molit-caas-system get cluster $ClusterName -o json) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $Recovery.spec.bootstrap.recovery.source -ne "molit-control-store-backup-source" `
    -or $Recovery.spec.externalClusters[0].name -ne $Recovery.spec.bootstrap.recovery.source `
    -or $Recovery.spec.externalClusters[0].plugin.name -ne "barman-cloud.cloudnative-pg.io" `
    -or $Recovery.spec.externalClusters[0].plugin.parameters.barmanObjectName -ne "molit-control-store-backup" `
    -or $Recovery.spec.externalClusters[0].plugin.parameters.serverName -ne "molit-control-store") { throw "Recovery Cluster source/plugin/server binding is inconsistent" }

  $VerificationConfigMap = Join-Path $Temporary "verification-configmap.yaml"
  & kubectl --context $Context -n molit-caas-system create configmap molit-control-store-recovery-verification `
    --from-file="recovery-verification.sql=$(Join-Path $Root 'deploy/control-store/postgres/recovery-verification.sql')" `
    --dry-run=client -o yaml | Set-Content -LiteralPath $VerificationConfigMap -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Recovery verification ConfigMap rendering failed" }
  Invoke-Kubectl @("apply", "-f", $VerificationConfigMap) | Out-Null
  $Job = [IO.File]::ReadAllText((Join-Path $Root "deploy/kubernetes/control-store-recovery-verification-job.template.yaml"))
  $Job = $Job.Replace("@@RECOVERY_CLUSTER_NAME@@", $ClusterName).Replace("@@DATABASE_TOOL_IMAGE@@", $DatabaseToolImage)
  $Job = $Job.Replace("@@RECOVERY_DATABASE_SECRET@@", $RecoveryDatabaseSecret)
  $Job = $Job.Replace("@@EXPECTED_CAAS_STATE_ROOT@@", $ExpectedCaasStateRoot).Replace("@@EXPECTED_DSAAS_STATE_ROOT@@", $ExpectedDsaasStateRoot)
  if ($Job -match '@@[A-Z_]+@@') { throw "An unresolved recovery verification Job placeholder remains" }
  $JobPath = Join-Path $Temporary "verification-job.yaml"
  [IO.File]::WriteAllText($JobPath, $Job, [Text.UTF8Encoding]::new($false))
  Invoke-Kubectl @("-n", "molit-caas-system", "delete", "job", "$ClusterName-verification", "--ignore-not-found", "--wait=true") | Out-Null
  Invoke-Kubectl @("apply", "-f", $JobPath) | Out-Null
  Invoke-Kubectl @("-n", "molit-caas-system", "wait", "--for=condition=complete", "job/$ClusterName-verification", "--timeout=300s") | Out-Null
  Invoke-Kubectl @("-n", "molit-caas-system", "logs", "job/$ClusterName-verification")
} finally {
  $Resolved = [IO.Path]::GetFullPath($Temporary)
  if ($Resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $Resolved -Recurse -Force -ErrorAction SilentlyContinue }
}
