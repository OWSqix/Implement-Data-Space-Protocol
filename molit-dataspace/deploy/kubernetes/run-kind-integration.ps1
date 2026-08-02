param(
  [ValidatePattern("^[a-z0-9][a-z0-9-]{1,40}$")][string]$ClusterName = "molit-p0-gate",
  [switch]$ReuseCluster,
  [switch]$KeepCluster,
  [ValidateRange(1, 100)][int]$Cycles = 30,
  [string]$EvidencePath = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$toolDirectory = Join-Path $root ".local/bin"
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) "molit-kind-gate-$([Guid]::NewGuid().ToString('N'))"
$kindPath = Join-Path $toolDirectory "kind.exe"
$kubectlPath = Join-Path $toolDirectory "kubectl-v1.35.0.exe"
$kindVersion = "v0.31.0"
$kindSha256 = "2c3a9ff954de16244380778683cf99e271bfc2fac9c6c4e797e4623c45e59d9d"
$kubectlVersion = "v1.35.0"
$kubectlSha256 = "4c5d14b8673bd55f813a8965ad70d5150e3960ee5f274025e2286aea3a0fa8b6"
$nodeImage = "kindest/node:v1.35.0@sha256:452d707d4862f52530247495d180205e029056831160e22870e37e3f6c1ac31f"
$context = "kind-$ClusterName"
$createdCluster = $false
$previousKubeconfig = $env:KUBECONFIG
New-Item -ItemType Directory -Path $toolDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $temporary | Out-Null

function Ensure-Tool {
  param([string]$Path, [string]$Uri, [string]$ExpectedSha256)
  if (-not (Test-Path -LiteralPath $Path)) {
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Path
  }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedSha256) { throw "Tool checksum mismatch for ${Path}: $actual" }
}

function Invoke-Checked {
  param([string]$Command, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Command failed: $Command $($Arguments -join ' ')" }
}

try {
  Ensure-Tool -Path $kindPath -Uri "https://kind.sigs.k8s.io/dl/$kindVersion/kind-windows-amd64" -ExpectedSha256 $kindSha256
  Ensure-Tool -Path $kubectlPath -Uri "https://dl.k8s.io/$kubectlVersion/bin/windows/amd64/kubectl.exe" -ExpectedSha256 $kubectlSha256
  $reportedKindVersion = (& $kindPath version).Trim()
  if ($reportedKindVersion -notmatch "kind v0\.31\.0") { throw "Unexpected kind version: $reportedKindVersion" }

  $clusters = @(& $kindPath get clusters)
  if ($ReuseCluster) {
    if ($clusters -notcontains $ClusterName) { throw "Requested kind cluster does not exist: $ClusterName" }
  } else {
    if ($clusters -contains $ClusterName) { throw "Refusing to replace existing kind cluster: $ClusterName" }
    $kubeconfig = Join-Path $temporary "kubeconfig"
    Invoke-Checked $kindPath -Arguments @("create", "cluster", "--name", $ClusterName, "--image", $nodeImage, "--kubeconfig", $kubeconfig, "--wait", "180s")
    $createdCluster = $true
    $env:KUBECONFIG = $kubeconfig
  }

  Invoke-Checked $kubectlPath -Arguments @("--context", $context, "wait", "--for=condition=Ready", "nodes", "--all", "--timeout=120s")
  $nodes = @(& $kubectlPath --context $context get nodes -o name)
  if ($LASTEXITCODE -ne 0 -or $nodes.Count -lt 1) { throw "kind node inventory is empty" }
  foreach ($node in $nodes) {
    Invoke-Checked $kubectlPath -Arguments @("--context", $context, "label", $node, "topology.kubernetes.io/zone=kind-zone-a", "--overwrite")
  }

  $tagSuffix = $ClusterName.Replace("-", "")
  $webhookTag = "molit-fencing-webhook:$tagSuffix"
  $baselineTag = "molit-kind-workload:$tagSuffix-baseline"
  $upgradeTag = "molit-kind-workload:$tagSuffix-upgrade"
  Invoke-Checked docker -Arguments @("build", "-f", (Join-Path $PSScriptRoot "fencing-webhook.Dockerfile"), "-t", $webhookTag, $root)
  Invoke-Checked docker -Arguments @("build", "--build-arg", "MOLIT_TEST_RELEASE=baseline", "-f", (Join-Path $PSScriptRoot "test-workload.Dockerfile"), "-t", $baselineTag, $root)
  Invoke-Checked docker -Arguments @("build", "--build-arg", "MOLIT_TEST_RELEASE=upgrade", "-f", (Join-Path $PSScriptRoot "test-workload.Dockerfile"), "-t", $upgradeTag, $root)
  $webhookDigest = (& docker image inspect $webhookTag --format '{{.Id}}').Trim().Replace("sha256:", "")
  $baselineDigest = (& docker image inspect $baselineTag --format '{{.Id}}').Trim().Replace("sha256:", "")
  $upgradeDigest = (& docker image inspect $upgradeTag --format '{{.Id}}').Trim().Replace("sha256:", "")
  foreach ($value in @($webhookDigest, $baselineDigest, $upgradeDigest)) {
    if ($value -notmatch "^[a-f0-9]{64}$") { throw "Docker image digest extraction failed" }
  }
  Invoke-Checked $kindPath -Arguments @("load", "docker-image", $webhookTag, $baselineTag, $upgradeTag, "--name", $ClusterName)
  $webhookImage = "docker.io/library/molit-fencing-webhook@sha256:$webhookDigest"
  $baselineImage = "docker.io/library/molit-kind-workload@sha256:$baselineDigest"
  $upgradeImage = "docker.io/library/molit-kind-workload@sha256:$upgradeDigest"
  foreach ($node in @(& $kindPath get nodes --name $ClusterName)) {
    Invoke-Checked docker -Arguments @("exec", $node, "ctr", "-n", "k8s.io", "images", "tag", "--force", "docker.io/library/$webhookTag", $webhookImage)
    Invoke-Checked docker -Arguments @("exec", $node, "ctr", "-n", "k8s.io", "images", "tag", "--force", "docker.io/library/$baselineTag", $baselineImage)
    Invoke-Checked docker -Arguments @("exec", $node, "ctr", "-n", "k8s.io", "images", "tag", "--force", "docker.io/library/$upgradeTag", $upgradeImage)
  }

  Invoke-Checked $kubectlPath -Arguments @("--context", $context, "apply", "-f", (Join-Path $PSScriptRoot "control-plane-rbac.yaml"))
  Invoke-Checked $kubectlPath -Arguments @("--context", $context, "apply", "-f", (Join-Path $PSScriptRoot "fencing-admission-policy.yaml"))
  $certificateDirectory = Join-Path $temporary "webhook-certificate"
  Invoke-Checked powershell -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "new-test-webhook-certificate.ps1"), "-OutputDirectory", $certificateDirectory)
  Invoke-Checked powershell -Arguments @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "install-fencing-webhook.ps1"),
    "-WebhookImage", $webhookImage,
    "-CertificateFile", (Join-Path $certificateDirectory "tls.crt"),
    "-PrivateKeyFile", (Join-Path $certificateDirectory "tls.key"),
    "-CaCertificateFile", (Join-Path $certificateDirectory "ca.crt"),
    "-KubectlPath", $kubectlPath,
    "-Context", $context
  )

  if (-not $EvidencePath) { $EvidencePath = Join-Path $root ".local/kubernetes-lifecycle-repeat.json" }
  $EvidencePath = [System.IO.Path]::GetFullPath($EvidencePath)
  Invoke-Checked powershell -Arguments @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "run-integration.ps1"),
    "-ControlPlaneImage", $baselineImage,
    "-DataPlaneImage", $baselineImage,
    "-UpgradeControlPlaneImage", $upgradeImage,
    "-UpgradeDataPlaneImage", $upgradeImage,
    "-KubectlPath", $kubectlPath,
    "-Context", $context,
    "-RunRepeat",
    "-Cycles", [string]$Cycles,
    "-EvidencePath", $EvidencePath
  )

  $report = Get-Content -LiteralPath $EvidencePath -Raw | ConvertFrom-Json
  $report | Add-Member -NotePropertyName bootstrap -NotePropertyValue ([pscustomobject]@{
    kindVersion = $reportedKindVersion
    kindExecutableSha256 = $kindSha256
    kubectlVersion = $kubectlVersion
    kubectlExecutableSha256 = $kubectlSha256
    nodeImage = $nodeImage
    webhookImage = $webhookImage
    baselineWorkloadImage = $baselineImage
    upgradeWorkloadImage = $upgradeImage
    clusterName = $ClusterName
  }) -Force
  [System.IO.File]::WriteAllText($EvidencePath, (($report | ConvertTo-Json -Depth 100) + "`n"), [System.Text.UTF8Encoding]::new($false))
  Write-Output "Kubernetes lifecycle evidence: $EvidencePath"
} finally {
  if ($createdCluster -and -not $KeepCluster) {
    & $kindPath delete cluster --name $ClusterName
  }
  if ($null -eq $previousKubeconfig) { Remove-Item Env:KUBECONFIG -ErrorAction SilentlyContinue }
  else { $env:KUBECONFIG = $previousKubeconfig }
  $resolvedTemporary = [System.IO.Path]::GetFullPath($temporary)
  $resolvedSystemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolvedTemporary.StartsWith($resolvedSystemTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force -ErrorAction SilentlyContinue
  }
}
