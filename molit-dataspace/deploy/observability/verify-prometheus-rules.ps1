$ErrorActionPreference = "Stop"

$image = "prom/prometheus@sha256:69f5241418838263316593f7274a304b095c40bcf22e57272865da91bd60a8ac"
$directory = (Resolve-Path $PSScriptRoot).Path

docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker engine is not available" }

docker run --rm --entrypoint /bin/promtool `
  --mount "type=bind,source=$directory,target=/work,readonly" `
  $image check rules /work/prometheus-rules.yaml
if ($LASTEXITCODE -ne 0) { throw "Prometheus recording or alert rule validation failed" }
