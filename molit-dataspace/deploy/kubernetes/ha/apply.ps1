[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Context,
  [Parameter(Mandatory = $true)][string]$CaasImage,
  [Parameter(Mandatory = $true)][string]$DsaasImage,
  [Parameter(Mandatory = $true)][string]$PostgresImage,
  [Parameter(Mandatory = $true)][string]$DatabaseToolImage,
  [Parameter(Mandatory = $true)][string]$RegistryPrefix,
  [Parameter(Mandatory = $true)][string]$StorageClass,
  [Parameter(Mandatory = $true)][string]$BackupDestination,
  [Parameter(Mandatory = $true)][string]$BackupEndpoint,
  [Parameter(Mandatory = $true)][string]$CaasIdentityConfigFile,
  [Parameter(Mandatory = $true)][string]$DsaasIdentityConfigFile,
  [Parameter(Mandatory = $true)][string]$CaasObservabilityConfigFile,
  [Parameter(Mandatory = $true)][string]$DsaasObservabilityConfigFile,
  [Parameter(Mandatory = $true)][ValidateSet("InCluster", "External")][string]$ObservabilityBackendMode,
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,127}$")][string]$DatabaseBootstrapApprovedBy,
  [Parameter(Mandatory = $true)][ValidatePattern("^[A-Za-z0-9][A-Za-z0-9._:@/-]{7,255}$")][string]$DatabaseBootstrapApprovalReference,
  [ValidatePattern("^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$")][string]$ControlStoreCutoverInputClaim = "",
  [string]$OtelCollectorImage = "",
  [string]$ObservabilityStorageClass = "",
  [ValidatePattern("^[1-9][0-9]*(?:Mi|Gi|Ti)$")][string]$ObservabilityQueueSize = "20Gi"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$DigestImage = '^[^\s"'']+@sha256:[a-f0-9]{64}$'
if ($RegistryPrefix -notmatch '^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9._/-]+$' -or $RegistryPrefix.Contains('..') -or $RegistryPrefix.EndsWith('/')) {
  throw "RegistryPrefix must be one approved repository path without scheme, traversal, or trailing slash"
}
function Assert-ApprovedImage {
  param([string]$Reference, [string]$Label)
  if ($Reference -notmatch $DigestImage) { throw "$Label must be an immutable sha256 digest reference" }
  if (-not $Reference.StartsWith("$RegistryPrefix/", [StringComparison]::Ordinal)) { throw "$Label must use the approved RegistryPrefix" }
}
foreach ($Image in @(
  [pscustomobject]@{ Reference = $CaasImage; Label = "CaaS image" },
  [pscustomobject]@{ Reference = $DsaasImage; Label = "DSaaS image" },
  [pscustomobject]@{ Reference = $PostgresImage; Label = "CloudNativePG operand image" },
  [pscustomobject]@{ Reference = $DatabaseToolImage; Label = "database migration/bootstrap image" }
)) {
  Assert-ApprovedImage $Image.Reference $Image.Label
}
if ($ObservabilityBackendMode -eq "InCluster") { Assert-ApprovedImage $OtelCollectorImage "OpenTelemetry Collector image" }
if ($StorageClass -notmatch '^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$') { throw "StorageClass is not a DNS subdomain" }
if ($ObservabilityBackendMode -eq "InCluster" -and $ObservabilityStorageClass -notmatch '^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$') { throw "ObservabilityStorageClass is required in InCluster mode" }
if ($BackupDestination -notmatch '^s3://[A-Za-z0-9][A-Za-z0-9._/-]{2,1023}$' -or $BackupDestination.Contains('..')) { throw "BackupDestination must be one unambiguous s3 URI" }
$Endpoint = [Uri]$BackupEndpoint
if (-not $Endpoint.IsAbsoluteUri -or $Endpoint.Scheme -ne "https" -or $Endpoint.UserInfo -or $Endpoint.Query -or $Endpoint.Fragment -or $Endpoint.AbsolutePath -ne "/") { throw "BackupEndpoint must be one bare HTTPS origin" }

function Invoke-Kubectl {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & kubectl --context $Context @Arguments
  if ($LASTEXITCODE -ne 0) { throw "kubectl failed: $($Arguments -join ' ')" }
}

if ($ControlStoreCutoverInputClaim) {
  $CutoverClaim = & kubectl --context $Context -n molit-caas-system get persistentvolumeclaim $ControlStoreCutoverInputClaim -o json
  if ($LASTEXITCODE -ne 0) { throw "Control-store cutover input PVC is missing" }
  $CutoverClaimObject = $CutoverClaim | ConvertFrom-Json
  if ($CutoverClaimObject.status.phase -ne "Bound") { throw "Control-store cutover input PVC must be Bound before workloads are suspended" }
}

function Get-SecretObject {
  param([string]$Namespace, [string]$Name)
  $Raw = & kubectl --context $Context -n $Namespace get secret $Name -o json
  if ($LASTEXITCODE -ne 0) { throw "Required secret is missing: $Namespace/$Name" }
  return $Raw | ConvertFrom-Json
}

function Assert-SecretKeys {
  param([string]$Namespace, [string]$Name, [string[]]$Keys)
  $Secret = Get-SecretObject $Namespace $Name
  $Available = @($Secret.data.PSObject.Properties.Name)
  foreach ($Key in $Keys) {
    if ($Available -notcontains $Key) { throw "Required secret key is missing: $Namespace/$Name#$Key" }
  }
  return $Secret
}

function Get-SecretText {
  param($Secret, [string]$Key)
  $Property = $Secret.data.PSObject.Properties[$Key]
  if ($null -eq $Property) { throw "Secret key is missing: $Key" }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$Property.Value))
}

function Assert-BasicAuthRoleSecret {
  param([string]$Name, [switch]$RequireReloadLabel)
  $Secret = Assert-SecretKeys "molit-caas-system" $Name @("username", "password")
  if ($Secret.type -ne "kubernetes.io/basic-auth") { throw "$Name must use kubernetes.io/basic-auth" }
  if ($RequireReloadLabel) {
    $Reload = $Secret.metadata.labels.PSObject.Properties["cnpg.io/reload"]
    if ($null -eq $Reload -or [string]$Reload.Value -ne "true") { throw "$Name must declare cnpg.io/reload=true" }
  }
  $Username = Get-SecretText $Secret "username"
  $Password = Get-SecretText $Secret "password"
  if ($Username -notmatch '^[a-z][a-z0-9_]{2,62}$') { throw "$Name username is not an approved PostgreSQL role identifier" }
  if ($Password.Length -lt 20 -or $Password.Length -gt 256 -or $Password -match '[\x00-\x1f\x7f]') { throw "$Name password is outside the bounded credential contract" }
  return [pscustomobject]@{ Name = $Name; Password = $Password; Secret = $Secret; Username = $Username }
}

function Assert-DatabaseCredentialUrl {
  param([string]$Value, $Credential, [string]$Label)
  try { $Uri = [Uri]$Value } catch { throw "$Label is not a valid PostgreSQL URL" }
  if (-not $Uri.IsAbsoluteUri -or $Uri.Scheme -notin @("postgres", "postgresql") -or $Uri.Query -or $Uri.Fragment -or $Uri.AbsolutePath -ne "/molit_control_store") { throw "$Label must be one unambiguous molit_control_store PostgreSQL URL" }
  $Parts = $Uri.UserInfo.Split(':', 2)
  if ($Parts.Count -ne 2) { throw "$Label must contain one encoded username and password" }
  $Username = [Uri]::UnescapeDataString($Parts[0])
  $Password = [Uri]::UnescapeDataString($Parts[1])
  if ($null -ne $Credential -and ($Username -cne $Credential.Username -or $Password -cne $Credential.Password)) { throw "$Label credentials do not match the managed role Secret" }
  if ($Username -notmatch '^[a-z][a-z0-9_]{2,62}$' -or $Password.Length -lt 20 -or $Password.Length -gt 256 -or $Password -match '[\x00-\x1f\x7f]') { throw "$Label credentials are outside the bounded authority contract" }
  return $Username
}

function Enter-ControlPlaneQuiescence {
  param($State)
  $CronJobRaw = & kubectl --context $Context -n molit-caas-system get cronjob molit-caas-orphan-recovery --ignore-not-found -o json
  if ($LASTEXITCODE -ne 0) { throw "Failed to inspect the orphan-recovery CronJob before offline cutover" }
  if ($CronJobRaw) {
    $CronJob = $CronJobRaw | ConvertFrom-Json
    $State.CronJobExists = $true
    $State.CronJobSuspend = [bool]$CronJob.spec.suspend
    Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "patch", "cronjob/molit-caas-orphan-recovery", "--type=merge", "-p", '{"spec":{"suspend":true}}') | Out-Null
  }
  $JobsDrained = $false
  for ($Attempt = 0; $Attempt -lt 150; $Attempt += 1) {
    $JobsRaw = & kubectl --context $Context -n molit-caas-system get jobs -o json
    if ($LASTEXITCODE -ne 0) { throw "Failed to inspect orphan-recovery Jobs before offline cutover" }
    $Jobs = ($JobsRaw | ConvertFrom-Json).items
    $ActiveJobs = @($Jobs | Where-Object {
      $CronLabel = $_.metadata.labels.PSObject.Properties['batch.kubernetes.io/cronjob-name']
      $Owned = @($_.metadata.ownerReferences | Where-Object { $_.kind -eq 'CronJob' -and $_.name -eq 'molit-caas-orphan-recovery' }).Count -gt 0
      $BelongsToCronJob = ($null -ne $CronLabel -and [string]$CronLabel.Value -eq 'molit-caas-orphan-recovery') -or $Owned
      $Active = if ($null -eq $_.status.active) { 0 } else { [int]$_.status.active }
      $BelongsToCronJob -and $Active -gt 0
    })
    if ($ActiveJobs.Count -eq 0) { $JobsDrained = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $JobsDrained) { throw "Active orphan-recovery Jobs did not drain before offline cutover" }
  foreach ($Name in @("molit-caas", "molit-dsaas")) {
    $ExistingRaw = & kubectl --context $Context -n molit-caas-system get deployment $Name --ignore-not-found -o json
    if ($LASTEXITCODE -ne 0) { throw "Failed to inspect deployment/$Name before offline cutover" }
    if (-not $ExistingRaw) { continue }
    $Existing = $ExistingRaw | ConvertFrom-Json
    $State.Deployments[$Name] = [int]$Existing.spec.replicas
    Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "scale", "deployment/$Name", "--replicas=0") | Out-Null
    $Stopped = $false
    for ($Attempt = 0; $Attempt -lt 150; $Attempt += 1) {
      $Deployment = (& kubectl --context $Context -n molit-caas-system get deployment $Name -o json) | ConvertFrom-Json
      if ($LASTEXITCODE -ne 0) { throw "Failed to observe deployment/$Name during offline cutover" }
      $Replicas = if ($null -eq $Deployment.status.replicas) { 0 } else { [int]$Deployment.status.replicas }
      $ReadyReplicas = if ($null -eq $Deployment.status.readyReplicas) { 0 } else { [int]$Deployment.status.readyReplicas }
      if ($Replicas -eq 0 -and $ReadyReplicas -eq 0) { $Stopped = $true; break }
      Start-Sleep -Seconds 2
    }
    if (-not $Stopped) { throw "deployment/$Name did not quiesce before offline cutover" }
  }
}

function Restore-ControlPlaneQuiescence {
  param($State, [switch]$Deployments)
  $Failures = [Collections.Generic.List[string]]::new()
  if ($Deployments) {
    foreach ($Entry in $State.Deployments.GetEnumerator()) {
      try { Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "scale", "deployment/$($Entry.Key)", "--replicas=$($Entry.Value)") | Out-Null }
      catch { $Failures.Add("deployment/$($Entry.Key): $($_.Exception.Message)") }
    }
  }
  if ($State.CronJobExists) {
    $SuspendValue = if ($State.CronJobSuspend) { 'true' } else { 'false' }
    try { Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "patch", "cronjob/molit-caas-orphan-recovery", "--type=merge", "-p", "{`"spec`":{`"suspend`":$SuspendValue}}") | Out-Null }
    catch { $Failures.Add("cronjob/molit-caas-orphan-recovery: $($_.Exception.Message)") }
  }
  if ($Failures.Count -gt 0) { throw "Control-plane quiescence recovery failed: $($Failures -join '; ')" }
}

function Publish-CutoverRecoveryReceipt {
  param($State, [string]$FailureMessage, [bool]$DatabaseCutoverStarted)
  foreach ($Name in @("molit-caas", "molit-dsaas")) {
    $Existing = & kubectl --context $Context -n molit-caas-system get deployment $Name --ignore-not-found -o name
    if ($LASTEXITCODE -ne 0) { throw "Failed to inspect deployment/$Name while preserving the cutover fence" }
    if ($Existing) { Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "scale", "deployment/$Name", "--replicas=0") | Out-Null }
  }
  $CronJob = & kubectl --context $Context -n molit-caas-system get cronjob molit-caas-orphan-recovery --ignore-not-found -o name
  if ($LASTEXITCODE -ne 0) { throw "Failed to inspect the orphan-recovery CronJob while preserving the cutover fence" }
  if ($CronJob) { Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "patch", "cronjob/molit-caas-orphan-recovery", "--type=merge", "-p", '{"spec":{"suspend":true}}') | Out-Null }
  $DatabaseRefenceSucceeded = $false
  $DatabaseRefenceError = $null
  if (-not $DatabaseCutoverStarted) {
    $DatabaseRefenceError = "not-required-before-database-cutover"
  } elseif ($PostgresFencedPath -and $RuntimeFenceJobPath -and (Test-Path -LiteralPath $PostgresFencedPath) -and (Test-Path -LiteralPath $RuntimeFenceJobPath)) {
    try {
      Invoke-Kubectl -Arguments @("apply", "--server-side", "--field-manager=molit-platform-release", "-f", $PostgresFencedPath) | Out-Null
      Assert-ManagedRoleIntent $false @($CaasDatabaseCredential.Username, $DsaasDatabaseCredential.Username)
      Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "delete", "job", "molit-control-store-runtime-fence", "--ignore-not-found", "--wait=true") | Out-Null
      Invoke-Kubectl -Arguments @("apply", "-f", $RuntimeFenceJobPath) | Out-Null
      Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "wait", "--for=condition=complete", "job/molit-control-store-runtime-fence", "--timeout=300s") | Out-Null
      $DatabaseRefenceSucceeded = $true
    } catch { $DatabaseRefenceError = $_.Exception.Message }
  } else {
    $DatabaseRefenceError = "fenced Cluster or runtime-fence Job manifest was not available"
  }
  $Receipt = [ordered]@{
    schemaVersion = "molit.control-store-cutover-recovery/1"
    phase = if ($DatabaseCutoverStarted) { "database-cutover" } else { "pre-cutover-mutation" }
    createdAt = [DateTimeOffset]::UtcNow.ToString("o")
    failureMessage = $FailureMessage.Substring(0, [Math]::Min($FailureMessage.Length, 2048))
    runtimeRolesMayBeFenced = $DatabaseCutoverStarted
    workloadsKeptOffline = $true
    databaseRefenceAttempted = $DatabaseCutoverStarted
    databaseRefenceSucceeded = $DatabaseRefenceSucceeded
    databaseRefenceError = $DatabaseRefenceError
    originalState = [ordered]@{
      cronJobExisted = [bool]$State.CronJobExists
      cronJobSuspend = [bool]$State.CronJobSuspend
      deploymentReplicas = $State.Deployments
    }
    recoveryProcedure = @(
      "inspect migration and cutover Job logs",
      "verify control_store_mode and scoped_control_state roots",
      "rerun the approved HA apply entrypoint to complete runtime-role bootstrap",
      "do not scale control-plane Deployments before the bootstrap Job succeeds"
    )
  }
  $ReceiptPath = Join-Path $TemporaryDirectory "control-store-cutover-recovery.json"
  [IO.File]::WriteAllText($ReceiptPath, (($Receipt | ConvertTo-Json -Depth 10) + "`n"), [Text.UTF8Encoding]::new($false))
  $ManifestRaw = & kubectl --context $Context -n molit-caas-system create configmap molit-control-store-cutover-recovery --from-file="receipt.json=$ReceiptPath" --dry-run=client -o json
  if ($LASTEXITCODE -ne 0) { throw "Cutover recovery receipt ConfigMap rendering failed" }
  $Manifest = $ManifestRaw | ConvertFrom-Json
  $Manifest.metadata | Add-Member -Force -NotePropertyName annotations -NotePropertyValue ([pscustomobject]@{ "data.molit.go.kr/recovery-receipt-sha256" = (Get-Sha256 ([IO.File]::ReadAllText($ReceiptPath))) })
  $ManifestPath = Join-Path $TemporaryDirectory "control-store-cutover-recovery.manifest.json"
  [IO.File]::WriteAllText($ManifestPath, ($Manifest | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  Invoke-Kubectl -Arguments @("apply", "-f", $ManifestPath) | Out-Null
}

function Read-JsonFile {
  param([string]$Path, [string]$Label)
  $Resolved = (Resolve-Path -LiteralPath $Path).Path
  $Raw = [IO.File]::ReadAllText($Resolved)
  try { $Value = $Raw | ConvertFrom-Json } catch { throw "$Label is not valid JSON" }
  return [pscustomobject]@{ Path = $Resolved; Raw = $Raw; Value = $Value }
}

function Get-Sha256 {
  param([string]$Value)
  $Hasher = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($Hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "").ToLowerInvariant() }
  finally { $Hasher.Dispose() }
}

function Assert-RuntimePaths {
  param($Runtime, [string]$Service)
  $Prefix = if ($Service -eq "caas") { "/run/molit/caas.json" } else { "/run/molit/dsaas.json" }
  if ($Runtime.environment -ne "production") { throw "$Service runtime configuration must use production mode" }
  if ($Runtime.identityConfigPath -ne "/run/molit/identity/$Service.json") { throw "$Service identityConfigPath does not match the mounted ConfigMap" }
  if ($Runtime.observabilityConfigPath -ne "/run/molit/observability/$Service.json") { throw "$Service observabilityConfigPath does not match the mounted ConfigMap" }
  if ($Runtime.tls.certFile -ne "/var/run/secrets/molit-inbound/tls.crt" -or $Runtime.tls.keyFile -ne "/var/run/secrets/molit-inbound/tls.key" -or $Runtime.tls.clientCaFile -ne "/var/run/secrets/molit-inbound/client-ca.crt") { throw "$Service inbound TLS paths do not match the mounted Secret" }
  if ($Service -eq "dsaas") {
    if ($Runtime.serviceRegistryPath -ne "/run/molit/dsaas/service-registry.json" -or $Runtime.approvalDecisionRegistryPath -ne "/run/molit/dsaas/approval-decision-registry.json") { throw "DSaaS registry paths do not match the mounted runtime Secret" }
    if ($Runtime.caas.auth.clientSecretRef -ne "file:///var/run/secrets/molit-caas-client/client-secret" -or $Runtime.caas.auth.caFile -ne "/var/run/secrets/molit-caas-client/ca.crt" -or $Runtime.caas.auth.certFile -ne "/var/run/secrets/molit-caas-client/tls.crt" -or $Runtime.caas.auth.keyFile -ne "/var/run/secrets/molit-caas-client/tls.key") { throw "DSaaS outbound CaaS mTLS paths do not match the mounted Secret" }
  }
}

function Assert-IdentityConfig {
  param($Identity, [string]$Service)
  if ($Identity.Value.mode -ne "rfc7662-introspection" -or $Identity.Value.introspection.clientSecretRef -ne "file:///var/run/secrets/molit-identity/introspection-client-secret") { throw "$Service identity configuration is not bound to the operational introspection Secret" }
}

function Assert-ObservabilityConfig {
  param($Configuration, [string]$Service)
  if ($Configuration.Value.service.name -ne "molit-$Service" -or $Configuration.Value.service.environment -ne "production") { throw "$Service observability service identity is invalid" }
  $Endpoints = @($Configuration.Value.tracing.endpoint, $Configuration.Value.metrics.endpoint, $Configuration.Value.logs.endpoint, $Configuration.Value.audit.baseUrl)
  foreach ($Value in $Endpoints) {
    $Uri = [Uri]$Value
    if (-not $Uri.IsAbsoluteUri -or $Uri.Scheme -ne "https" -or $Uri.UserInfo -or $Uri.Fragment) { throw "$Service observability endpoints must use HTTPS without embedded credentials" }
    $Internal = $Uri.Host.EndsWith(".svc", [StringComparison]::OrdinalIgnoreCase)
    if ($ObservabilityBackendMode -eq "External" -and $Internal) { throw "External observability mode cannot reference a cluster-local .svc endpoint" }
  }
  if ($ObservabilityBackendMode -eq "InCluster") {
    foreach ($Value in @($Configuration.Value.tracing.endpoint, $Configuration.Value.metrics.endpoint, $Configuration.Value.logs.endpoint)) {
      if (([Uri]$Value).Host -ne "otel-collector.observability.svc") { throw "InCluster OTLP endpoints must target otel-collector.observability.svc" }
    }
    if ($Configuration.Value.audit.baseUrl -cne "https://worm-audit.observability.svc/") { throw "InCluster audit.baseUrl must target https://worm-audit.observability.svc/ exactly" }
  }
  foreach ($Signal in @($Configuration.Value.tracing, $Configuration.Value.metrics, $Configuration.Value.logs, $Configuration.Value.audit)) {
    if ($Signal.tls.caRef -ne "file:///var/run/secrets/molit-observability/ca.crt" -or $Signal.tls.certificateRef -ne "file:///var/run/secrets/molit-observability/tls.crt" -or $Signal.tls.privateKeyRef -ne "file:///var/run/secrets/molit-observability/tls.key") { throw "$Service observability mTLS references do not match the mounted Secret" }
    $Reload = [int64]$Signal.tls.reloadIntervalMs
    if ($Reload -lt 250 -or $Reload -gt 300000) { throw "$Service observability mTLS reloadIntervalMs is outside the operational range" }
  }
  if ($Configuration.Value.tracing.authorizationRef -ne "file:///var/run/secrets/molit-observability/otlp-token" -or $Configuration.Value.metrics.authorizationRef -ne "file:///var/run/secrets/molit-observability/otlp-token" -or $Configuration.Value.logs.authorizationRef -ne "file:///var/run/secrets/molit-observability/otlp-token" -or $Configuration.Value.tracing.tenantSaltRef -ne "file:///var/run/secrets/molit-observability/tenant-salt" -or $Configuration.Value.audit.authorizationRef -ne "file:///var/run/secrets/molit-observability/worm-token") { throw "$Service observability credential references do not match the mounted Secret" }
  $Outbox = $Configuration.Value.usageMeter.outbox
  foreach ($Field in @("maxAttempts", "batchSize", "leaseMs", "pollIntervalMs", "retryBaseMs", "retryMaxMs", "healthIntervalMs")) {
    if ($null -eq $Outbox.PSObject.Properties[$Field]) { throw "$Service usageMeter.outbox.$Field is required" }
  }
  if ([int64]$Outbox.retryMaxMs -lt [int64]$Outbox.retryBaseMs) { throw "$Service usageMeter outbox retry maximum is below its base delay" }
}

function Assert-ManagedRoleIntent {
  param([bool]$Login, [string[]]$RoleNames)
  $ClusterRaw = & kubectl --context $Context -n molit-caas-system get cluster molit-control-store -o json
  if ($LASTEXITCODE -ne 0) { throw "CloudNativePG managed-role intent could not be observed" }
  $Cluster = $ClusterRaw | ConvertFrom-Json
  $Roles = @($Cluster.spec.managed.roles | Where-Object { $_.name -in $RoleNames })
  if ($Roles.Count -ne $RoleNames.Count -or @($Roles | Where-Object { [bool]$_.login -ne $Login }).Count -ne 0) {
    throw "CloudNativePG managed-role LOGIN intent does not match the cutover phase"
  }
}

$CurrentContext = (kubectl config current-context).Trim()
if ($LASTEXITCODE -ne 0 -or $CurrentContext -ne $Context) { throw "kubectl current context does not match the explicit Context parameter" }
foreach ($Crd in @('clusters.postgresql.cnpg.io', 'scheduledbackups.postgresql.cnpg.io', 'objectstores.barmancloud.cnpg.io', 'gateways.gateway.networking.k8s.io', 'httproutes.gateway.networking.k8s.io')) { Invoke-Kubectl -Arguments @("get", "crd", $Crd) | Out-Null }
Invoke-Kubectl -Arguments @("get", "namespace", "molit-caas-system") | Out-Null
Invoke-Kubectl -Arguments @("get", "validatingwebhookconfiguration", "molit-caas-fencing") | Out-Null

$RuntimeEnvironment = Assert-SecretKeys "molit-caas-system" "molit-control-plane-runtime" @("MOLIT_CAAS_DATABASE_URL", "MOLIT_CAAS_DATABASE_CA", "MOLIT_DSAAS_POSTGRES_URL", "MOLIT_DSAAS_POSTGRES_CA_PEM")
$SchemaOwnerCredential = Assert-BasicAuthRoleSecret "molit-control-store-app"
$CaasDatabaseCredential = Assert-BasicAuthRoleSecret "molit-caas-database-role" -RequireReloadLabel
$DsaasDatabaseCredential = Assert-BasicAuthRoleSecret "molit-dsaas-database-role" -RequireReloadLabel
if ($SchemaOwnerCredential.Username -ne "molit_control_store") { throw "molit-control-store-app username must be molit_control_store" }
if ($CaasDatabaseCredential.Username -eq $DsaasDatabaseCredential.Username -or $CaasDatabaseCredential.Username -eq $SchemaOwnerCredential.Username -or $DsaasDatabaseCredential.Username -eq $SchemaOwnerCredential.Username) { throw "schema owner, CaaS, and DSaaS PostgreSQL roles must be distinct" }
$CaasRuntimeSecret = Assert-SecretKeys "molit-caas-system" "molit-caas-runtime-config" @("caas.json")
$DsaasRuntimeSecret = Assert-SecretKeys "molit-caas-system" "molit-dsaas-runtime-config" @("dsaas.json", "service-registry.json", "approval-decision-registry.json")
Assert-SecretKeys "molit-caas-system" "molit-caas-tls" @("tls.crt", "tls.key", "client-ca.crt") | Out-Null
Assert-SecretKeys "molit-caas-system" "molit-dsaas-tls" @("tls.crt", "tls.key", "client-ca.crt") | Out-Null
Assert-SecretKeys "molit-caas-system" "molit-identity" @("introspection-client-secret") | Out-Null
Assert-SecretKeys "molit-caas-system" "molit-observability" @("otlp-token", "worm-token", "tenant-salt", "ca.crt", "tls.crt", "tls.key") | Out-Null
Assert-SecretKeys "molit-caas-system" "molit-caas-client" @("client-secret", "ca.crt", "tls.crt", "tls.key") | Out-Null
$MigrationDatabase = Assert-SecretKeys "molit-caas-system" "molit-control-store-database" @("url")
Assert-SecretKeys "molit-caas-system" "molit-control-store-database-ca" @("ca.crt") | Out-Null
Assert-SecretKeys "molit-caas-system" "molit-backup-credentials" @("access-key-id", "secret-access-key") | Out-Null
$null = Assert-DatabaseCredentialUrl (Get-SecretText $RuntimeEnvironment "MOLIT_CAAS_DATABASE_URL") $CaasDatabaseCredential "CaaS runtime database URL"
$null = Assert-DatabaseCredentialUrl (Get-SecretText $RuntimeEnvironment "MOLIT_DSAAS_POSTGRES_URL") $DsaasDatabaseCredential "DSaaS runtime database URL"
$MigrationAuthority = Assert-DatabaseCredentialUrl (Get-SecretText $MigrationDatabase "url") $null "migration-authority database URL"
if ($MigrationAuthority -in @($CaasDatabaseCredential.Username, $DsaasDatabaseCredential.Username)) { throw "Migration authority must be distinct from both runtime roles" }

$CaasRuntimeRaw = Get-SecretText $CaasRuntimeSecret "caas.json"
$DsaasRuntimeRaw = Get-SecretText $DsaasRuntimeSecret "dsaas.json"
$DsaasServiceRegistryRaw = Get-SecretText $DsaasRuntimeSecret "service-registry.json"
$DsaasApprovalRegistryRaw = Get-SecretText $DsaasRuntimeSecret "approval-decision-registry.json"
try { $CaasRuntime = $CaasRuntimeRaw | ConvertFrom-Json; $DsaasRuntime = $DsaasRuntimeRaw | ConvertFrom-Json } catch { throw "Runtime configuration Secret contains invalid JSON" }
Assert-RuntimePaths $CaasRuntime "caas"
Assert-RuntimePaths $DsaasRuntime "dsaas"
$DsaasPublicOrigin = [Uri]$DsaasRuntime.publicOrigin
if (-not $DsaasPublicOrigin.IsAbsoluteUri -or $DsaasPublicOrigin.Scheme -ne "https" -or $DsaasPublicOrigin.AbsolutePath -ne "/" -or $DsaasRuntime.allowedHosts -notcontains $DsaasPublicOrigin.Host) { throw "DSaaS publicOrigin hostname must be present verbatim in allowedHosts for Kubernetes health probes" }
$DsaasHealthHost = $DsaasPublicOrigin.Host
foreach ($Provisioner in $CaasRuntime.provisioners.PSObject.Properties.Value) {
  if ($Provisioner.type -ne "kubernetes-edc") { continue }
  if ($Provisioner.routing.mode -ne "gateway-api") { throw "Production Kubernetes provisioner does not declare a Gateway API route profile" }
  Invoke-Kubectl -Arguments @("-n", $Provisioner.routing.parentRef.namespace, "get", "gateway", $Provisioner.routing.parentRef.name) | Out-Null
}
$CaasIdentity = Read-JsonFile $CaasIdentityConfigFile "CaaS identity configuration"
$DsaasIdentity = Read-JsonFile $DsaasIdentityConfigFile "DSaaS identity configuration"
$CaasObservability = Read-JsonFile $CaasObservabilityConfigFile "CaaS observability configuration"
$DsaasObservability = Read-JsonFile $DsaasObservabilityConfigFile "DSaaS observability configuration"
Assert-IdentityConfig $CaasIdentity "caas"
Assert-IdentityConfig $DsaasIdentity "dsaas"
Assert-ObservabilityConfig $CaasObservability "caas"
Assert-ObservabilityConfig $DsaasObservability "dsaas"

$TemporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) "molit-ha-$PID-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $TemporaryDirectory | Out-Null
$QuiescenceState = [pscustomobject]@{
  CronJobExists = $false
  CronJobSuspend = $false
  Deployments = [ordered]@{}
}
$ReleaseSucceeded = $false
$ReleaseMutationStarted = $false
$DatabaseCutoverStarted = $false
$PostgresFencedPath = $null
$RuntimeFenceJobPath = $null
$ReleaseFailureMessage = "HA release failed"
try {
  Enter-ControlPlaneQuiescence $QuiescenceState
  $ReleaseMutationStarted = $true
  $IdentityManifest = Join-Path $TemporaryDirectory "identity-config.yaml"
  & kubectl --context $Context -n molit-caas-system create configmap molit-identity-config --from-file="caas.json=$($CaasIdentity.Path)" --from-file="dsaas.json=$($DsaasIdentity.Path)" --dry-run=client -o yaml | Set-Content -LiteralPath $IdentityManifest -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Identity ConfigMap rendering failed" }
  Invoke-Kubectl -Arguments @("apply", "-f", $IdentityManifest)
  $ObservabilityManifest = Join-Path $TemporaryDirectory "observability-config.yaml"
  & kubectl --context $Context -n molit-caas-system create configmap molit-observability-config --from-file="caas.json=$($CaasObservability.Path)" --from-file="dsaas.json=$($DsaasObservability.Path)" --dry-run=client -o yaml | Set-Content -LiteralPath $ObservabilityManifest -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Observability ConfigMap rendering failed" }
  Invoke-Kubectl -Arguments @("apply", "-f", $ObservabilityManifest)

  $MigrationManifest = Join-Path $TemporaryDirectory "migrations.yaml"
  & kubectl --context $Context -n molit-caas-system create configmap molit-control-store-migrations `
    --from-file="001_control_store.sql=$(Join-Path $Root 'deploy/control-store/postgres/001_control_store.sql')" `
    --from-file="002_normalized_projection.sql=$(Join-Path $Root 'deploy/control-store/postgres/002_normalized_projection.sql')" `
    --from-file="003_usage_metering.sql=$(Join-Path $Root 'deploy/control-store/postgres/003_usage_metering.sql')" `
    --from-file="004_authoritative_scoped_state.sql=$(Join-Path $Root 'deploy/control-store/postgres/004_authoritative_scoped_state.sql')" `
    --from-file="runtime-role-fence.sql=$(Join-Path $Root 'deploy/control-store/postgres/runtime-role-fence.sql')" `
    --from-file="runtime-role-login-verification.sql=$(Join-Path $Root 'deploy/control-store/postgres/runtime-role-login-verification.sql')" `
    --from-file="runtime-role-bootstrap.sql=$(Join-Path $Root 'deploy/control-store/postgres/runtime-role-bootstrap.sql')" `
    --dry-run=client -o yaml | Set-Content -LiteralPath $MigrationManifest -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Control-store migration ConfigMap rendering failed" }
  Invoke-Kubectl -Arguments @("apply", "-f", $MigrationManifest)
  $BootstrapPolicyManifest = Join-Path $TemporaryDirectory "bootstrap-policy.yaml"
  & kubectl --context $Context -n molit-caas-system create configmap molit-control-store-bootstrap-policy --from-literal="approved-by=$DatabaseBootstrapApprovedBy" --from-literal="approval-reference=$DatabaseBootstrapApprovalReference" --dry-run=client -o yaml | Set-Content -LiteralPath $BootstrapPolicyManifest -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Control-store bootstrap policy ConfigMap rendering failed" }
  Invoke-Kubectl -Arguments @("apply", "-f", $BootstrapPolicyManifest)

  if ($ObservabilityBackendMode -eq "InCluster") {
    Invoke-Kubectl -Arguments @("get", "namespace", "observability") | Out-Null
    Assert-SecretKeys "observability" "molit-otel-collector" @("server-cert", "server-key", "client-ca", "ingress-token", "upstream-token", "upstream-ca", "upstream-endpoint") | Out-Null
    Invoke-Kubectl -Arguments @("-n", "observability", "get", "service", "worm-audit") | Out-Null
    $CollectorConfigManifest = Join-Path $TemporaryDirectory "collector-config.yaml"
    & kubectl --context $Context -n observability create configmap molit-otel-collector-config --from-file="config.yaml=$(Join-Path $Root 'deploy/observability/otel-collector.production.yaml')" --dry-run=client -o yaml | Set-Content -LiteralPath $CollectorConfigManifest -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "OpenTelemetry Collector ConfigMap rendering failed" }
    Invoke-Kubectl -Arguments @("apply", "-f", $CollectorConfigManifest)
    $CollectorTemplate = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "observability.template.yaml"))
    $CollectorDigest = Get-Sha256 ([IO.File]::ReadAllText((Join-Path $Root "deploy/observability/otel-collector.production.yaml")))
    $Collector = $CollectorTemplate.Replace("@@OTEL_COLLECTOR_IMAGE@@", $OtelCollectorImage).Replace("@@OBSERVABILITY_STORAGE_CLASS@@", $ObservabilityStorageClass).Replace("@@OBSERVABILITY_QUEUE_SIZE@@", $ObservabilityQueueSize).Replace("@@OTEL_CONFIGURATION_SHA256@@", $CollectorDigest)
    if ($Collector -match '@@[A-Z_]+@@') { throw "An unresolved observability manifest placeholder remains" }
    $CollectorPath = Join-Path $TemporaryDirectory "observability.yaml"
    [IO.File]::WriteAllText($CollectorPath, $Collector, [Text.UTF8Encoding]::new($false))
    Invoke-Kubectl -Arguments @("apply", "--server-side", "--field-manager=molit-platform-release", "-f", $CollectorPath)
    Invoke-Kubectl -Arguments @("-n", "observability", "rollout", "status", "statefulset/otel-collector", "--timeout=15m")
  }

  $PostgresBase = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "postgres.template.yaml")).Replace("@@POSTGRES_IMAGE@@", $PostgresImage).Replace("@@STORAGE_CLASS@@", $StorageClass).Replace("@@BACKUP_DESTINATION@@", $BackupDestination).Replace("@@BACKUP_ENDPOINT@@", $BackupEndpoint).Replace("@@CAAS_DATABASE_ROLE@@", $CaasDatabaseCredential.Username).Replace("@@DSAAS_DATABASE_ROLE@@", $DsaasDatabaseCredential.Username)
  $PostgresFenced = $PostgresBase.Replace("@@RUNTIME_ROLE_LOGIN@@", "false")
  $PostgresUnfenced = $PostgresBase.Replace("@@RUNTIME_ROLE_LOGIN@@", "true")
  $PostgresFencedPath = Join-Path $TemporaryDirectory "postgres-fenced.yaml"
  $PostgresUnfencedPath = Join-Path $TemporaryDirectory "postgres-unfenced.yaml"
  [IO.File]::WriteAllText($PostgresFencedPath, $PostgresFenced, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($PostgresUnfencedPath, $PostgresUnfenced, [Text.UTF8Encoding]::new($false))
  $DatabaseCutoverStarted = $true
  Invoke-Kubectl -Arguments @("apply", "--server-side", "--field-manager=molit-platform-release", "-f", $PostgresFencedPath)
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "wait", "cluster/molit-control-store", "--for=condition=Ready", "--timeout=15m")
  Assert-ManagedRoleIntent $false @($CaasDatabaseCredential.Username, $DsaasDatabaseCredential.Username)

  $RuntimeFenceJob = [IO.File]::ReadAllText((Join-Path $Root "deploy/kubernetes/control-store-runtime-fence-job.yaml")).Replace("@@DATABASE_TOOL_IMAGE@@", $DatabaseToolImage)
  if ($RuntimeFenceJob -match '@@[A-Z_]+@@') { throw "An unresolved runtime-fence Job placeholder remains" }
  $RuntimeFenceJobPath = Join-Path $TemporaryDirectory "control-store-runtime-fence-job.yaml"
  [IO.File]::WriteAllText($RuntimeFenceJobPath, $RuntimeFenceJob, [Text.UTF8Encoding]::new($false))
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "delete", "job", "molit-control-store-runtime-fence", "--ignore-not-found", "--wait=true")
  Invoke-Kubectl -Arguments @("apply", "-f", $RuntimeFenceJobPath)
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "wait", "--for=condition=complete", "job/molit-control-store-runtime-fence", "--timeout=300s")

  $MigrationJobTemplate = [IO.File]::ReadAllText((Join-Path $Root "deploy/kubernetes/control-store-migration-job.yaml"))
  $CutoverInputVolume = if ($ControlStoreCutoverInputClaim) {
    "          persistentVolumeClaim:`n            claimName: $ControlStoreCutoverInputClaim"
  } else {
    "          emptyDir: { sizeLimit: 1Mi }"
  }
  $MigrationJob = $MigrationJobTemplate.Replace("@@DATABASE_TOOL_IMAGE@@", $DatabaseToolImage).Replace("@@CAAS_IMAGE@@", $CaasImage).Replace("@@CUTOVER_INPUT_VOLUME@@", $CutoverInputVolume)
  if ($MigrationJob -match '@@[A-Z_]+@@') { throw "An unresolved migration Job placeholder remains" }
  $MigrationJobPath = Join-Path $TemporaryDirectory "control-store-migration-job.yaml"
  [IO.File]::WriteAllText($MigrationJobPath, $MigrationJob, [Text.UTF8Encoding]::new($false))
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "delete", "job", "molit-control-store-migration", "--ignore-not-found", "--wait=true")
  Invoke-Kubectl -Arguments @("apply", "-f", $MigrationJobPath)
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "wait", "--for=condition=complete", "job/molit-control-store-migration", "--timeout=300s")

  $ReceiptOutput = & kubectl --context $Context -n molit-caas-system logs job/molit-control-store-migration -c cutover
  if ($LASTEXITCODE -ne 0) { throw "Control-store cutover receipt could not be read" }
  $ReceiptRaw = @($ReceiptOutput | Where-Object { $_.TrimStart().StartsWith("{") } | Select-Object -Last 1)[0]
  try { $Receipt = $ReceiptRaw | ConvertFrom-Json } catch { throw "Control-store cutover receipt is not valid JSON" }
  $ReceiptComponents = @($Receipt.components)
  if ($Receipt.schemaVersion -ne "molit.control-store-schema-receipt/1" -or $Receipt.migration.component -ne "postgres-scoped-control-store" -or [int]$Receipt.migration.version -ne 4 -or $ReceiptComponents.Count -ne 2) { throw "Control-store cutover receipt has an incompatible schema or migration version" }
  foreach ($Component in @("caas", "dsaas")) {
    $Rows = @($ReceiptComponents | Where-Object { $_.component -eq $Component })
    if ($Rows.Count -ne 1) { throw "Control-store cutover receipt is incomplete for $Component" }
    $Row = $Rows[0]
    $ScopeMapAbsent = $null -eq $Row.scopeMapSha256
    $ScopeApprovalAbsent = $null -eq $Row.scopeMapApprovalEvidenceSha256
    if ($Row.mode -ne "scoped-authoritative" -or $Row.sourceKind -notin @("json-snapshot", "fresh-install", "legacy-file-snapshot") -or
      [int64]$Row.sourceSnapshotRevision -lt 1 -or $Row.sourceSnapshotSha256 -notmatch '^[a-f0-9]{64}$' -or
      $Row.PSObject.Properties.Name -notcontains "legacyKeyConversionCount" -or [int64]$Row.legacyKeyConversionCount -lt 0 -or
      ($null -ne $Row.sourceApprovalEvidenceSha256 -and $Row.sourceApprovalEvidenceSha256 -notmatch '^[a-f0-9]{64}$') -or
      ($Row.sourceKind -eq "legacy-file-snapshot" -and $Row.sourceApprovalEvidenceSha256 -notmatch '^[a-f0-9]{64}$') -or
      $ScopeMapAbsent -ne $ScopeApprovalAbsent -or
      (-not $ScopeMapAbsent -and ($Row.scopeMapSha256 -notmatch '^[a-f0-9]{64}$' -or $Row.scopeMapApprovalEvidenceSha256 -notmatch '^[a-f0-9]{64}$')) -or
      $Row.stateRootSha256 -notmatch '^[a-f0-9]{64}$' -or $Row.currentStateRootSha256 -notmatch '^[a-f0-9]{64}$') { throw "Control-store cutover receipt is incomplete for $Component" }
  }
  $ReceiptPath = Join-Path $TemporaryDirectory "control-store-schema-receipt.json"
  [IO.File]::WriteAllText($ReceiptPath, $ReceiptRaw, [Text.UTF8Encoding]::new($false))
  $ReceiptManifest = Join-Path $TemporaryDirectory "control-store-schema-receipt.json.manifest"
  $ReceiptManifestRaw = & kubectl --context $Context -n molit-caas-system create configmap molit-control-store-schema-receipt --from-file="receipt.json=$ReceiptPath" --dry-run=client -o json
  if ($LASTEXITCODE -ne 0) { throw "Control-store schema receipt ConfigMap rendering failed" }
  $ReceiptManifestObject = $ReceiptManifestRaw | ConvertFrom-Json
  $ReceiptManifestObject | Add-Member -NotePropertyName immutable -NotePropertyValue $true
  $ReceiptManifestObject.metadata | Add-Member -Force -NotePropertyName annotations -NotePropertyValue ([pscustomobject]@{ "data.molit.go.kr/receipt-sha256" = (Get-Sha256 $ReceiptRaw) })
  [IO.File]::WriteAllText($ReceiptManifest, ($ReceiptManifestObject | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "delete", "configmap", "molit-control-store-schema-receipt", "--ignore-not-found", "--wait=true")
  Invoke-Kubectl -Arguments @("apply", "-f", $ReceiptManifest)

  $BootstrapJobTemplate = [IO.File]::ReadAllText((Join-Path $Root "deploy/kubernetes/control-store-runtime-bootstrap-job.yaml"))
  $BootstrapJob = $BootstrapJobTemplate.Replace("@@DATABASE_TOOL_IMAGE@@", $DatabaseToolImage)
  if ($BootstrapJob -match '@@[A-Z_]+@@') { throw "An unresolved bootstrap Job placeholder remains" }
  $BootstrapJobPath = Join-Path $TemporaryDirectory "control-store-runtime-bootstrap-job.yaml"
  [IO.File]::WriteAllText($BootstrapJobPath, $BootstrapJob, [Text.UTF8Encoding]::new($false))
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "delete", "job", "molit-control-store-runtime-bootstrap", "--ignore-not-found", "--wait=true")
  Invoke-Kubectl -Arguments @("apply", "-f", $BootstrapJobPath)
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "wait", "--for=condition=complete", "job/molit-control-store-runtime-bootstrap", "--timeout=300s")

  Invoke-Kubectl -Arguments @("apply", "--server-side", "--field-manager=molit-platform-release", "-f", $PostgresUnfencedPath)
  Assert-ManagedRoleIntent $true @($CaasDatabaseCredential.Username, $DsaasDatabaseCredential.Username)
  $LoginVerificationJob = [IO.File]::ReadAllText((Join-Path $Root "deploy/kubernetes/control-store-runtime-login-verification-job.yaml")).Replace("@@DATABASE_TOOL_IMAGE@@", $DatabaseToolImage)
  if ($LoginVerificationJob -match '@@[A-Z_]+@@') { throw "An unresolved runtime LOGIN verification Job placeholder remains" }
  $LoginVerificationJobPath = Join-Path $TemporaryDirectory "control-store-runtime-login-verification-job.yaml"
  [IO.File]::WriteAllText($LoginVerificationJobPath, $LoginVerificationJob, [Text.UTF8Encoding]::new($false))
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "delete", "job", "molit-control-store-runtime-login-verification", "--ignore-not-found", "--wait=true")
  Invoke-Kubectl -Arguments @("apply", "-f", $LoginVerificationJobPath)
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "wait", "--for=condition=complete", "job/molit-control-store-runtime-login-verification", "--timeout=300s")

  $CaasConfigurationDigest = Get-Sha256 ($CaasRuntimeRaw + "`n" + $CaasIdentity.Raw + "`n" + $CaasObservability.Raw + "`n" + $ReceiptRaw)
  $DsaasConfigurationDigest = Get-Sha256 ($DsaasRuntimeRaw + "`n" + $DsaasServiceRegistryRaw + "`n" + $DsaasApprovalRegistryRaw + "`n" + $DsaasIdentity.Raw + "`n" + $DsaasObservability.Raw + "`n" + $ReceiptRaw)
  $Application = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "control-plane.template.yaml")).Replace("@@CAAS_IMAGE@@", $CaasImage).Replace("@@DSAAS_IMAGE@@", $DsaasImage).Replace("@@CAAS_CONFIGURATION_SHA256@@", $CaasConfigurationDigest).Replace("@@DSAAS_CONFIGURATION_SHA256@@", $DsaasConfigurationDigest).Replace("@@DSAAS_HEALTH_HOST@@", $DsaasHealthHost)
  if (($Application + $PostgresFenced + $PostgresUnfenced) -match '@@[A-Z_]+@@') { throw "An unresolved manifest placeholder remains" }
  $ApplicationPath = Join-Path $TemporaryDirectory "control-plane.yaml"
  [IO.File]::WriteAllText($ApplicationPath, $Application, [Text.UTF8Encoding]::new($false))
  Invoke-Kubectl -Arguments @("apply", "--server-side", "--field-manager=molit-platform-release", "-f", $ApplicationPath)
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "rollout", "status", "deployment/molit-caas", "--timeout=15m")
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "rollout", "status", "deployment/molit-dsaas", "--timeout=15m")
  Restore-ControlPlaneQuiescence $QuiescenceState
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "delete", "configmap", "molit-control-store-cutover-recovery", "--ignore-not-found", "--wait=true") | Out-Null
  $ReleaseSucceeded = $true
} catch {
  $ReleaseFailureMessage = $_.Exception.Message
  throw
} finally {
  if (-not $ReleaseSucceeded) {
    if ($ReleaseMutationStarted) {
      try { Publish-CutoverRecoveryReceipt $QuiescenceState $ReleaseFailureMessage $DatabaseCutoverStarted }
      catch { Write-Error "Offline cutover failed and its recovery receipt could not be published. $($_.Exception.Message)" -ErrorAction Continue }
    } else {
      try { Restore-ControlPlaneQuiescence $QuiescenceState -Deployments }
      catch { Write-Error "Offline cutover failed and automatic state restoration was incomplete. $($_.Exception.Message)" -ErrorAction Continue }
    }
  }
  $ResolvedTemporary = [IO.Path]::GetFullPath($TemporaryDirectory)
  $ResolvedSystemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ($ResolvedTemporary.StartsWith($ResolvedSystemTemp, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $ResolvedTemporary -Recurse -Force -ErrorAction SilentlyContinue }
}
