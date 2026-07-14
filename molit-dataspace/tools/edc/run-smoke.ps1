[CmdletBinding()]
param(
    [switch]$Keep,
    [string]$RecordEvidence
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$compose = Join-Path $repo 'deploy\edc\compose.yaml'
$overlay = Join-Path $repo 'deploy\edc\compose.smoke.yaml'
$recorder = Join-Path $repo 'tools\edc\record-smoke.mjs'

function New-RandomHex([int]$ByteCount) {
    $bytes = New-Object byte[] $ByteCount
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

$env:EDC_POSTGRES_PASSWORD = New-RandomHex 24
$env:PROVIDER_API_KEY = New-RandomHex 24
$env:CONSUMER_API_KEY = New-RandomHex 24

function Wait-ForHealthyService([string]$Service, [int]$TimeoutSeconds = 300) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $containerId = (& docker compose -f $compose -f $overlay ps -q $Service).Trim()
        if ($LASTEXITCODE -ne 0) { throw "Could not resolve container for $Service" }
        if ($containerId) {
            $status = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $containerId).Trim()
            if ($LASTEXITCODE -ne 0) { throw "Could not inspect $Service" }
            if ($status -eq 'healthy') { return }
            if ($status -in @('dead', 'exited', 'unhealthy')) {
                throw "$Service entered terminal status $status before the smoke test"
            }
        }
        Start-Sleep -Seconds 2
    }
    throw "$Service did not become healthy within $TimeoutSeconds seconds"
}

$temporary = $null
$prepareFile = $null
$stdoutFile = $null
$imagesFile = $null
$errorFile = $null
$runExitCode = 1
$cleanStartStatus = 'not-run'
$cleanupStatus = 'not-run'
$runError = $null

if ($RecordEvidence) {
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ("molit-edc-evidence-" + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($temporary) | Out-Null
    $prepareFile = Join-Path $temporary 'prepare.json'
    $stdoutFile = Join-Path $temporary 'stdout.txt'
    $imagesFile = Join-Path $temporary 'images.tsv'
    $errorFile = Join-Path $temporary 'error.txt'
    [IO.File]::WriteAllBytes($stdoutFile, [byte[]]::new(0))
    [IO.File]::WriteAllBytes($imagesFile, [byte[]]::new(0))
    [IO.File]::WriteAllBytes($errorFile, [byte[]]::new(0))
    try {
        node $recorder prepare --state $prepareFile --command ".\tools\edc\run-smoke.ps1 -RecordEvidence $RecordEvidence"
        if ($LASTEXITCODE -ne 0) { throw "EDC evidence prepare exited with $LASTEXITCODE" }
    }
    catch {
        Remove-Item Env:EDC_POSTGRES_PASSWORD, Env:PROVIDER_API_KEY, Env:CONSUMER_API_KEY -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
        throw
    }
}

try {
    docker compose -f $compose -f $overlay down --volumes --remove-orphans
    if ($LASTEXITCODE -ne 0) { throw "EDC clean-start reset exited with $LASTEXITCODE" }
    $cleanStartStatus = 'pass'
    docker compose -f $compose -f $overlay up --detach --build `
        provider-control-plane provider-data-plane consumer-control-plane consumer-data-plane provider-backend
    if ($LASTEXITCODE -ne 0) { throw "EDC topology startup exited with $LASTEXITCODE" }
    Wait-ForHealthyService 'provider-control-plane'
    Wait-ForHealthyService 'provider-data-plane'
    Wait-ForHealthyService 'consumer-control-plane'
    Wait-ForHealthyService 'consumer-data-plane'
    Wait-ForHealthyService 'provider-backend'
    # --no-deps prevents the one-shot key generator from replacing the key
    # material after every required process has passed its health check.
    if ($RecordEvidence) {
        $smokeLines = @(& docker compose -f $compose -f $overlay run --rm --no-deps --use-aliases smoke)
        $runExitCode = $LASTEXITCODE
        $smokeText = $(if ($smokeLines.Count) { ($smokeLines -join "`n") + "`n" } else { '' })
        [IO.File]::WriteAllText($stdoutFile, $smokeText, [Text.UTF8Encoding]::new($false))
        [Console]::Out.Write($smokeText)
    }
    else {
        docker compose -f $compose -f $overlay run --rm --no-deps --use-aliases smoke
        $runExitCode = $LASTEXITCODE
    }
    if ($runExitCode -ne 0) { throw "EDC smoke exited with $runExitCode" }
}
catch {
    $runError = $_
    if ($cleanStartStatus -eq 'not-run') { $cleanStartStatus = 'failed' }
    if ($RecordEvidence) { [IO.File]::WriteAllText($errorFile, $_.Exception.Message, [Text.UTF8Encoding]::new($false)) }
}
finally {
    if ($RecordEvidence) {
        $imageLines = @()
        foreach ($service in @('provider-control-plane', 'provider-data-plane', 'consumer-control-plane', 'consumer-data-plane', 'provider-backend', 'smoke')) {
            $imageId = (& docker compose -f $compose -f $overlay images -q $service).Trim()
            if ($LASTEXITCODE -eq 0 -and $imageId -match '^sha256:[0-9a-f]{64}$') {
                $imageLines += "$service`t$imageId"
            }
        }
        [IO.File]::WriteAllText($imagesFile, ($imageLines -join "`n") + $(if ($imageLines.Count) { "`n" } else { '' }), [Text.UTF8Encoding]::new($false))
    }
    if (-not $Keep) {
        docker compose -f $compose -f $overlay down --volumes --remove-orphans
        $cleanupStatus = $(if ($LASTEXITCODE -eq 0) { 'pass' } else { 'failed' })
        if ($cleanupStatus -eq 'failed' -and -not $runError) {
            $runError = [InvalidOperationException]::new('EDC cleanup failed')
            $runExitCode = 1
        }
    }
    else {
        $cleanupStatus = 'kept'
    }
    if ($RecordEvidence) {
        node $recorder complete --state $prepareFile --stdout $stdoutFile --images $imagesFile `
            --output $RecordEvidence --exit-code $runExitCode --clean-start $cleanStartStatus `
            --cleanup $cleanupStatus --error-file $errorFile
        if ($LASTEXITCODE -ne 0 -and -not $runError) {
            $runError = [InvalidOperationException]::new("EDC evidence complete exited with $LASTEXITCODE")
        }
    }
    Remove-Item Env:EDC_POSTGRES_PASSWORD, Env:PROVIDER_API_KEY, Env:CONSUMER_API_KEY -ErrorAction SilentlyContinue
    if ($temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($runError) { throw $runError }
