[CmdletBinding()]
param(
  [string]$ReportPath = ".local/postgres-ha-pitr-run.json"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$ResolvedReportPath = if ([IO.Path]::IsPathRooted($ReportPath)) {
  [IO.Path]::GetFullPath($ReportPath)
} else {
  [IO.Path]::GetFullPath((Join-Path $Root $ReportPath))
}
node (Join-Path $PSScriptRoot "run-ha-pitr.mjs") --report $ResolvedReportPath
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL HA/PITR test failed" }
