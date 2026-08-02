$ErrorActionPreference = "Stop"

$composeFile = Join-Path $PSScriptRoot "compose.test.yml"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "../../..")
$projectName = "molit-control-store-it-$PID-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$primaryFailure = $null
$cleanupExitCode = 0

try {
  docker compose -p $projectName -f $composeFile up -d --wait
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL control-store test database did not start" }

  $binding = docker compose -p $projectName -f $composeFile port postgres 5432
  if ($LASTEXITCODE -ne 0 -or $binding -notmatch ':(\d+)$') {
    throw "PostgreSQL control-store test port was not published"
  }
  $port = $Matches[1]
  $env:MOLIT_POSTGRES_INTEGRATION_URL = "postgresql://molit_control_store_test:molit-control-store-test@127.0.0.1:$port/molit_control_store_test"
  node --test --test-concurrency=1 `
    (Join-Path $projectRoot "tests/integration/dsaas-postgres-store-docker.test.mjs") `
    (Join-Path $projectRoot "tests/integration/normalized-control-store-docker.test.mjs") `
    (Join-Path $projectRoot "tests/integration/observability-worm-dispatcher-postgres.test.mjs") `
    (Join-Path $projectRoot "tests/integration/tenant-isolation-postgres.test.mjs") `
    (Join-Path $projectRoot "tests/integration/usage-meter-postgres.test.mjs") `
    (Join-Path $projectRoot "tests/integration/scoped-control-store-postgres.test.mjs") `
    (Join-Path $projectRoot "tests/integration/scoped-control-store-postgres-tls.test.mjs")
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL control-store integration test failed" }
} catch {
  $primaryFailure = $_
} finally {
  Remove-Item Env:MOLIT_POSTGRES_INTEGRATION_URL -ErrorAction SilentlyContinue
  docker compose -p $projectName -f $composeFile down --volumes --remove-orphans
  $cleanupExitCode = $LASTEXITCODE
}

if ($null -ne $primaryFailure) { throw $primaryFailure }
if ($cleanupExitCode -ne 0) { throw "PostgreSQL control-store test resources were not removed" }
