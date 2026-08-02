param(
  [Parameter(Mandatory = $true)][string]$Context,
  [Parameter(Mandatory = $true)][ValidatePattern("@sha256:[a-f0-9]{64}$")][string]$FencingWebhookImage,
  [Parameter(Mandatory = $true)][string]$FencingCertificateFile,
  [Parameter(Mandatory = $true)][string]$FencingPrivateKeyFile,
  [Parameter(Mandatory = $true)][string]$FencingCaCertificateFile,
  [switch]$RunDatabaseMigration
)

$ErrorActionPreference = "Stop"
if ($RunDatabaseMigration) {
  throw "Database migration is disabled in the foundation bootstrap entrypoint. Use deploy/kubernetes/ha/apply.ps1 so migration 4, offline scoped cutover, runtime-role bootstrap, and the schema receipt cannot be bypassed."
}
$currentContext = (kubectl config current-context).Trim()
if ($LASTEXITCODE -ne 0 -or $currentContext -ne $Context) { throw "kubectl current context does not match the explicit Context parameter" }

kubectl --context $Context apply -f (Join-Path $PSScriptRoot "control-plane-rbac.yaml")
if ($LASTEXITCODE -ne 0) { throw "CaaS Kubernetes RBAC bootstrap failed" }
kubectl --context $Context apply -f (Join-Path $PSScriptRoot "fencing-admission-policy.yaml")
if ($LASTEXITCODE -ne 0) { throw "CaaS fencing admission policy bootstrap failed" }
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "install-fencing-webhook.ps1") `
  -WebhookImage $FencingWebhookImage `
  -CertificateFile $FencingCertificateFile `
  -PrivateKeyFile $FencingPrivateKeyFile `
  -CaCertificateFile $FencingCaCertificateFile `
  -Context $Context
if ($LASTEXITCODE -ne 0) { throw "CaaS target-side fencing webhook bootstrap failed" }
