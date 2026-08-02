$ErrorActionPreference = "Stop"

$image = "otel/opentelemetry-collector-contrib@sha256:125bdbeb7590cc1952c5b3430ecf14063568980c2c93d5b38676cc0446ed8108"
$directory = (Resolve-Path $PSScriptRoot).Path

docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker engine is not available" }

docker run --rm --entrypoint /otelcol-contrib `
  --mount "type=bind,source=$directory,target=/work,readonly" `
  --env UPSTREAM_OTLP_ENDPOINT=https://telemetry.invalid `
  $image validate --config=/work/otel-collector.production.yaml
if ($LASTEXITCODE -ne 0) { throw "OpenTelemetry Collector configuration validation failed" }
