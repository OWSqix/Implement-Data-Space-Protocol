[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Context,
  [Parameter(Mandatory = $true)][string]$RegistryPrefix,
  [Parameter(Mandatory = $true)][string]$CosignPublicKeyPath
)

$ErrorActionPreference = "Stop"
if ($RegistryPrefix -notmatch '^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9._/-]+$' -or $RegistryPrefix.Contains('..') -or $RegistryPrefix.EndsWith('/')) {
  throw "RegistryPrefix must be one repository path without scheme, traversal, or trailing slash"
}
if (-not (Test-Path -LiteralPath $CosignPublicKeyPath -PathType Leaf)) { throw "Cosign public key does not exist" }
$PublicKey = Get-Content -LiteralPath $CosignPublicKeyPath -Raw
if ($PublicKey -notmatch '(?s)^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$' -or $PublicKey -match 'PRIVATE KEY') {
  throw "CosignPublicKeyPath must contain one PEM public key"
}
$CanonicalPublicKey = (($PublicKey -replace "`r`n", "`n").Trim()) + "`n"
$Sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $TrustAnchorSha256 = ([BitConverter]::ToString($Sha256.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($CanonicalPublicKey)))).Replace('-', '').ToLowerInvariant()
} finally {
  $Sha256.Dispose()
}
$CurrentContext = (kubectl config current-context).Trim()
if ($LASTEXITCODE -ne 0 -or $CurrentContext -ne $Context) { throw "kubectl current context does not match the explicit Context parameter" }
kubectl --context $Context get crd validatingpolicies.policies.kyverno.io | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Kyverno ValidatingPolicy CRD is missing" }
kubectl --context $Context get crd imagevalidatingpolicies.policies.kyverno.io | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Kyverno ImageValidatingPolicy CRD is missing" }
kubectl --context $Context -n kyverno wait deployment/kyverno-admission-controller --for=condition=Available --timeout=5m
if ($LASTEXITCODE -ne 0) { throw "Kyverno admission controller is unavailable" }

$IndentedKey = (($CanonicalPublicKey.Trim() -split '\n') | ForEach-Object { "            $_" }) -join "`n"
$Template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'verify-images.template.yaml') -Raw
$Rendered = $Template.Replace('@@REGISTRY_PREFIX@@', $RegistryPrefix).Replace('@@COSIGN_PUBLIC_KEY@@', $IndentedKey).Replace('@@COSIGN_PUBLIC_KEY_SHA256@@', $TrustAnchorSha256).Replace('@@ALLOW_INSECURE_REGISTRY@@', 'false')
if ($Rendered -match '@@[A-Z_]+@@') { throw "An unresolved admission policy placeholder remains" }
$Temporary = Join-Path ([IO.Path]::GetTempPath()) "molit-image-policy-$PID-$([Guid]::NewGuid().ToString('N')).yaml"
try {
  [IO.File]::WriteAllText($Temporary, $Rendered, [Text.UTF8Encoding]::new($false))
  kubectl --context $Context apply --server-side --field-manager=molit-supply-chain -f $Temporary
  if ($LASTEXITCODE -ne 0) { throw "Image verification policy apply failed" }
  kubectl --context $Context wait validatingpolicy/molit-restrict-release-images --for=condition=Ready --timeout=2m
  if ($LASTEXITCODE -ne 0) { throw "Canonical image-reference policy did not become ready" }
  $ImagePolicies = @('molit-verify-release-images')
  foreach ($PolicyName in $ImagePolicies) {
    kubectl --context $Context wait "imagevalidatingpolicy/$PolicyName" --for=condition=Ready --timeout=2m
    if ($LASTEXITCODE -ne 0) { throw "Image validation policy did not become ready: $PolicyName" }
  }
  $LegacyPolicies = @(
    'molit-runtime-identity-caas',
    'molit-runtime-identity-dsaas',
    'molit-runtime-identity-fencing-webhook',
    'molit-runtime-identity-edc-control-plane',
    'molit-runtime-identity-edc-data-plane',
    'molit-runtime-identity-edc-schema-migration',
    'molit-runtime-identity-postgres-operand',
    'molit-runtime-identity-otel-collector'
  )
  kubectl --context $Context delete imagevalidatingpolicy @LegacyPolicies --ignore-not-found=true
  if ($LASTEXITCODE -ne 0) { throw "Legacy image identity policy cleanup failed" }
  [pscustomobject]@{
    applied = $true
    context = $Context
    trustAnchorSha256 = $TrustAnchorSha256
    imagePolicyCount = $ImagePolicies.Count
    transparencyLog = 'disabled'
  } | ConvertTo-Json -Compress
} finally {
  Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue
}
