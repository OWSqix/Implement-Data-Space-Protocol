param(
  [Parameter(Mandatory = $true)][ValidatePattern("@sha256:[a-f0-9]{64}$")][string]$ControlPlaneImage,
  [Parameter(Mandatory = $true)][ValidatePattern("@sha256:[a-f0-9]{64}$")][string]$DataPlaneImage,
  [Parameter(Mandatory = $true)][ValidatePattern("@sha256:[a-f0-9]{64}$")][string]$UpgradeControlPlaneImage,
  [Parameter(Mandatory = $true)][ValidatePattern("@sha256:[a-f0-9]{64}$")][string]$UpgradeDataPlaneImage,
  [string]$KubectlPath = "kubectl",
  [string]$Context = "",
  [switch]$RunRepeat,
  [ValidateRange(1, 100)][int]$Cycles = 30,
  [string]$EvidencePath = ""
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) "molit-kube-it-$([Guid]::NewGuid().ToString('N'))"
$contextArguments = if ($Context) { @("--context", $Context) } else { @() }
New-Item -ItemType Directory -Path $temporary | Out-Null

function Invoke-Kubectl {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & $KubectlPath @contextArguments @Arguments
  if ($LASTEXITCODE -ne 0) { throw "kubectl failed: $($Arguments -join ' ')" }
}

try {
  Invoke-Kubectl -Arguments @("apply", "-f", (Join-Path $PSScriptRoot "control-plane-rbac.yaml"))
  Invoke-Kubectl -Arguments @("apply", "-f", (Join-Path $PSScriptRoot "fencing-admission-policy.yaml"))
  Invoke-Kubectl -Arguments @("get", "validatingwebhookconfiguration", "molit-caas-fencing", "-o", "name")

  $tokenFile = Join-Path $temporary "token"
  $caFile = Join-Path $temporary "ca.crt"
  $token = & $KubectlPath @contextArguments -n molit-caas-system create token molit-caas-controller --duration=30m
  if ($LASTEXITCODE -ne 0 -or -not $token) { throw "Kubernetes integration service-account token issuance failed" }
  [System.IO.File]::WriteAllText($tokenFile, $token.Trim(), [System.Text.UTF8Encoding]::new($false))
  $clusterRaw = & $KubectlPath @contextArguments config view --raw --minify -o json
  if ($LASTEXITCODE -ne 0) { throw "Kubernetes integration cluster configuration read failed" }
  $cluster = $clusterRaw | ConvertFrom-Json
  $caData = $cluster.clusters[0].cluster.'certificate-authority-data'
  if ($caData) {
    [System.IO.File]::WriteAllBytes($caFile, [Convert]::FromBase64String($caData))
  } elseif ($cluster.clusters[0].cluster.'certificate-authority') {
    Copy-Item -LiteralPath $cluster.clusters[0].cluster.'certificate-authority' -Destination $caFile
  } else {
    throw "Kubernetes cluster CA is absent from the active kubeconfig"
  }

  $env:MOLIT_KUBERNETES_INTEGRATION = "1"
  $env:MOLIT_KUBERNETES_API_SERVER = $cluster.clusters[0].cluster.server
  $env:MOLIT_KUBERNETES_TOKEN_FILE = $tokenFile
  $env:MOLIT_KUBERNETES_CA_FILE = $caFile
  $env:MOLIT_EDC_CONTROL_PLANE_IMAGE = $ControlPlaneImage
  $env:MOLIT_EDC_DATA_PLANE_IMAGE = $DataPlaneImage
  $env:MOLIT_EDC_UPGRADE_CONTROL_PLANE_IMAGE = $UpgradeControlPlaneImage
  $env:MOLIT_EDC_UPGRADE_DATA_PLANE_IMAGE = $UpgradeDataPlaneImage
  node --test (Join-Path $root "tests/integration/kubernetes-edc-provisioner.test.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Kubernetes EDC provisioner integration test failed" }

  if ($RunRepeat) {
    if (-not $EvidencePath) { $EvidencePath = Join-Path $root ".local/kubernetes-lifecycle-repeat.json" }
    $env:MOLIT_KUBERNETES_REPEAT = "1"
    $env:MOLIT_KUBERNETES_REPEAT_CYCLES = [string]$Cycles
    $env:MOLIT_KUBERNETES_EVIDENCE_PATH = [System.IO.Path]::GetFullPath($EvidencePath)
    node --test (Join-Path $root "tests/integration/kubernetes-lifecycle-repeat.test.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Kubernetes repeated lifecycle test failed" }
  }
} finally {
  @(
    "MOLIT_KUBERNETES_INTEGRATION", "MOLIT_KUBERNETES_API_SERVER", "MOLIT_KUBERNETES_TOKEN_FILE",
    "MOLIT_KUBERNETES_CA_FILE", "MOLIT_EDC_CONTROL_PLANE_IMAGE", "MOLIT_EDC_DATA_PLANE_IMAGE",
    "MOLIT_EDC_UPGRADE_CONTROL_PLANE_IMAGE", "MOLIT_EDC_UPGRADE_DATA_PLANE_IMAGE",
    "MOLIT_KUBERNETES_REPEAT", "MOLIT_KUBERNETES_REPEAT_CYCLES", "MOLIT_KUBERNETES_EVIDENCE_PATH"
  ) | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  $resolvedTemporary = [System.IO.Path]::GetFullPath($temporary)
  $resolvedSystemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolvedTemporary.StartsWith($resolvedSystemTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force -ErrorAction SilentlyContinue
  }
}
