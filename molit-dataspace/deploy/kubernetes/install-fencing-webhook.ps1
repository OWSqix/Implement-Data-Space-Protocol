param(
  [Parameter(Mandatory = $true)][ValidatePattern("@sha256:[a-f0-9]{64}$")][string]$WebhookImage,
  [Parameter(Mandatory = $true)][string]$CertificateFile,
  [Parameter(Mandatory = $true)][string]$PrivateKeyFile,
  [Parameter(Mandatory = $true)][string]$CaCertificateFile,
  [string]$KubectlPath = "kubectl",
  [string]$Context = ""
)

$ErrorActionPreference = "Stop"
$contextArguments = if ($Context) { @("--context", $Context) } else { @() }
$certificate = (Resolve-Path -LiteralPath $CertificateFile).Path
$privateKey = (Resolve-Path -LiteralPath $PrivateKeyFile).Path
$caCertificate = (Resolve-Path -LiteralPath $CaCertificateFile).Path
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) "molit-fencing-webhook-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporary | Out-Null

function Invoke-Kubectl {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & $KubectlPath @contextArguments @Arguments
  if ($LASTEXITCODE -ne 0) { throw "kubectl failed: $($Arguments -join ' ')" }
}

try {
  $secretManifest = Join-Path $temporary "tls-secret.yaml"
  & $KubectlPath @contextArguments -n molit-caas-system create secret tls molit-caas-fencing-webhook-tls `
    --cert=$certificate --key=$privateKey --dry-run=client -o yaml | Set-Content -LiteralPath $secretManifest -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Fencing webhook TLS Secret rendering failed" }
  Invoke-Kubectl -Arguments @("apply", "-f", $secretManifest)

  $workloadTemplate = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "fencing-webhook.template.yaml"))
  $certificateDigest = (Get-FileHash -LiteralPath $certificate -Algorithm SHA256).Hash.ToLowerInvariant()
  $workload = $workloadTemplate.Replace("__WEBHOOK_IMAGE__", $WebhookImage).Replace("__TLS_SHA256__", $certificateDigest)
  if ($workload.Contains("__WEBHOOK_IMAGE__") -or $workload.Contains("__TLS_SHA256__")) { throw "Fencing webhook workload template rendering failed" }
  $workloadManifest = Join-Path $temporary "fencing-webhook.yaml"
  [System.IO.File]::WriteAllText($workloadManifest, $workload, [System.Text.UTF8Encoding]::new($false))
  Invoke-Kubectl -Arguments @("apply", "-f", $workloadManifest)
  Invoke-Kubectl -Arguments @("-n", "molit-caas-system", "rollout", "status", "deployment/molit-caas-fencing-webhook", "--timeout=180s")

  $caBundle = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($caCertificate))
  $configurationTemplate = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "fencing-webhook-configuration.template.yaml"))
  $configuration = $configurationTemplate.Replace("__CA_BUNDLE__", $caBundle)
  if ($configuration.Contains("__CA_BUNDLE__")) { throw "Fencing webhook CA template rendering failed" }
  $configurationManifest = Join-Path $temporary "fencing-webhook-configuration.yaml"
  [System.IO.File]::WriteAllText($configurationManifest, $configuration, [System.Text.UTF8Encoding]::new($false))
  Invoke-Kubectl -Arguments @("apply", "-f", $configurationManifest)
  Invoke-Kubectl -Arguments @("get", "validatingwebhookconfiguration", "molit-caas-fencing", "-o", "name")
} finally {
  $resolvedTemporary = [System.IO.Path]::GetFullPath($temporary)
  $resolvedSystemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolvedTemporary.StartsWith($resolvedSystemTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force -ErrorAction SilentlyContinue
  }
}
