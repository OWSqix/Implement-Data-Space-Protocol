[CmdletBinding()]
param(
  [string]$EvidencePath = ".local/edc-schema-postgres-verification.json"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$PostgresImage = "postgres:17.10-alpine3.24@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"
$CertificateToolImage = "eclipse-temurin:17-jdk-jammy@sha256:723151f3fc88ca2060153ee08ab8dbbea7983d6ed6f2622fe440acf178737c94"
$RunId = "$PID-$([Guid]::NewGuid().ToString('N').Substring(0, 12))"
$Network = "molit-edc-schema-network-$RunId"
$DatabaseContainer = "molit-edc-schema-postgres-$RunId"
$WrongDatabaseAlias = "molit-edc-schema-wrong-$RunId"
$TlsVolume = "molit-edc-schema-tls-$RunId"
$MigrationImage = "molit-edc-schema-migration-$RunId`:local"
$DatabasePassword = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
$DatabaseUser = "molit_edc_schema"
$DatabaseName = "molit_edc"
$RequiredVersion = "edc-0.18.0-sql-v1"
$StartedAt = [DateTimeOffset]::UtcNow.ToString("o")
$Utf8 = [Text.UTF8Encoding]::new($false)

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-SourceTreeBinding {
  $Files = @(Get-ChildItem -LiteralPath (Join-Path $Root "deploy/edc") -Recurse -File | Where-Object {
    $_.FullName -notmatch '[\\/](?:build|\.gradle)[\\/]'
  } | Sort-Object FullName)
  $Lines = foreach ($File in $Files) {
    $Relative = $File.FullName.Substring($Root.Length + 1).Replace('\', '/')
    "$Relative`0$(Get-FileSha256 $File.FullName)"
  }
  $Hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $Digest = ([BitConverter]::ToString($Hasher.ComputeHash($Utf8.GetBytes(($Lines -join "`n"))))).Replace('-', '').ToLowerInvariant()
  } finally { $Hasher.Dispose() }
  return [pscustomobject]@{ Digest = $Digest; FileCount = $Files.Count }
}

function Invoke-Docker([string[]]$Arguments, [string]$Failure) {
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

function Test-DockerCommandRejected([string[]]$Arguments) {
  $PreviousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell converts native stderr into ErrorRecord objects. The
    # negative TLS probes intentionally write stderr, so judge only exit status.
    $ErrorActionPreference = "Continue"
    & docker @Arguments 2>$null | Out-Null
    return $LASTEXITCODE -ne 0
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }
}

$ResolvedEvidencePath = if ([IO.Path]::IsPathRooted($EvidencePath)) {
  [IO.Path]::GetFullPath($EvidencePath)
} else {
  [IO.Path]::GetFullPath((Join-Path $Root $EvidencePath))
}
$TrackedEvidence = [IO.Path]::GetFullPath((Join-Path $Root "evidence/edc/schema-migration-postgres.v1.json"))
if ($ResolvedEvidencePath -eq $TrackedEvidence) { throw "Runtime verification cannot overwrite tracked release evidence" }
$EvidenceDirectory = [IO.Path]::GetDirectoryName($ResolvedEvidencePath)
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$SourceBefore = Get-SourceTreeBinding
$SourceCommit = (& git -C $Root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $SourceCommit -notmatch '^[a-f0-9]{40}$') { throw "A full source commit is required" }
$ManifestPath = Join-Path $PSScriptRoot "migration-manifest.v1.json"
$MigrationRunnerPath = Join-Path $PSScriptRoot "run-schema-migration.sh"
$DockerfilePath = Join-Path $Root "deploy/edc/Dockerfile"
$ScriptPath = $MyInvocation.MyCommand.Path
$ArtifactDigest = Get-FileSha256 $ManifestPath

try {
  Invoke-Docker @("network", "create", "--label", "molit.test=edc-schema-postgres", $Network) "EDC schema test network creation failed"
  Invoke-Docker @("volume", "create", "--label", "molit.test=edc-schema-postgres", $TlsVolume) "EDC schema TLS volume creation failed"
  $CertificateScript = @"
set -eu
umask 077
cd /tls
openssl genrsa -out ca.key 3072
openssl req -x509 -new -key ca.key -sha256 -days 2 -subj '/CN=MOLIT EDC Schema Test CA' -out ca.crt
openssl genrsa -out server.key 3072
openssl req -new -key server.key -subj '/CN=$DatabaseContainer' -out server.csr
printf '%s\n' 'subjectAltName=DNS:$DatabaseContainer' 'extendedKeyUsage=serverAuth' > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 2 -sha256 -extfile server.ext
openssl genrsa -out wrong-ca.key 3072
openssl req -x509 -new -key wrong-ca.key -sha256 -days 2 -subj '/CN=MOLIT Wrong Test CA' -out wrong-ca.crt
chmod 0600 server.key
chmod 0644 server.crt ca.crt wrong-ca.crt
chown -R 70:70 /tls
"@
  Invoke-Docker @("run", "--rm", "--user", "0:0", "-v", "${TlsVolume}:/tls", $CertificateToolImage, "sh", "-ceu", $CertificateScript) "TLS fixture generation failed"
  Invoke-Docker @("run", "--detach", "--name", $DatabaseContainer, "--network", $Network, "--network-alias", $DatabaseContainer, "--network-alias", $WrongDatabaseAlias,
    "-e", "POSTGRES_USER=$DatabaseUser", "-e", "POSTGRES_PASSWORD=$DatabasePassword", "-e", "POSTGRES_DB=$DatabaseName",
    "-v", "${TlsVolume}:/tls:ro", $PostgresImage, "postgres", "-c", "ssl=on", "-c", "ssl_cert_file=/tls/server.crt",
    "-c", "ssl_key_file=/tls/server.key", "-c", "ssl_ca_file=/tls/ca.crt") "TLS PostgreSQL fixture failed to start"
  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 120; $Attempt += 1) {
    & docker exec $DatabaseContainer pg_isready -U $DatabaseUser -d $DatabaseName 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $Ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $Ready) { throw "TLS PostgreSQL fixture did not become ready" }

  Invoke-Docker @("build", "--file", $DockerfilePath, "--target", "schema-migration", "--tag", $MigrationImage, (Join-Path $Root "deploy/edc")) "EDC schema migration image build failed"
  $LocalImageId = (& docker image inspect --format '{{.Id}}' $MigrationImage).Trim()
  if ($LASTEXITCODE -ne 0 -or $LocalImageId -notmatch '^sha256:[a-f0-9]{64}$') { throw "EDC schema migration image ID is unavailable" }
  $JdbcUrl = "jdbc:postgresql://${DatabaseContainer}:5432/${DatabaseName}?sslmode=verify-full&sslrootcert=/tls/ca.crt"
  $NegativeBaseArguments = @("run", "--rm", "--network", $Network, "-v", "${TlsVolume}:/tls:ro",
    "-e", "MOLIT_EDC_SCHEMA_COMPONENT=control-plane", "-e", "MOLIT_EDC_DATABASE_TLS_MODE=verify-full",
    "-e", "MOLIT_EDC_REQUIRED_SCHEMA_VERSION=$RequiredVersion", "-e", "MOLIT_EDC_MIGRATION_ARTIFACT_SHA256=$ArtifactDigest",
    "-e", "EDC_DATASOURCE_DEFAULT_USER=$DatabaseUser", "-e", "EDC_DATASOURCE_DEFAULT_PASSWORD=$DatabasePassword")
  $WrongHostnameArguments = @($NegativeBaseArguments) + @("-e", "EDC_DATASOURCE_DEFAULT_URL=jdbc:postgresql://${WrongDatabaseAlias}:5432/${DatabaseName}?sslmode=verify-full&sslrootcert=/tls/ca.crt", "-e", "PGSSLROOTCERT=/tls/ca.crt", $MigrationImage, "migrate-and-verify")
  $WrongHostnameRejected = Test-DockerCommandRejected $WrongHostnameArguments
  if (-not $WrongHostnameRejected) { throw "verify-full admitted a PostgreSQL hostname outside the certificate SAN" }
  $WrongCaArguments = @($NegativeBaseArguments) + @("-e", "EDC_DATASOURCE_DEFAULT_URL=jdbc:postgresql://${DatabaseContainer}:5432/${DatabaseName}?sslmode=verify-full&sslrootcert=/tls/wrong-ca.crt", "-e", "PGSSLROOTCERT=/tls/wrong-ca.crt", $MigrationImage, "migrate-and-verify")
  $WrongCaRejected = Test-DockerCommandRejected $WrongCaArguments
  if (-not $WrongCaRejected) { throw "verify-full admitted a PostgreSQL certificate from an untrusted CA" }
  $SuccessfulRuns = @{ "control-plane" = 0; "data-plane" = 0 }
  foreach ($Cycle in 1..2) {
    foreach ($Component in @("control-plane", "data-plane")) {
      Invoke-Docker @("run", "--rm", "--network", $Network, "-v", "${TlsVolume}:/tls:ro",
        "-e", "MOLIT_EDC_SCHEMA_COMPONENT=$Component", "-e", "MOLIT_EDC_DATABASE_TLS_MODE=verify-full",
        "-e", "MOLIT_EDC_REQUIRED_SCHEMA_VERSION=$RequiredVersion", "-e", "MOLIT_EDC_MIGRATION_ARTIFACT_SHA256=$ArtifactDigest",
        "-e", "EDC_DATASOURCE_DEFAULT_URL=$JdbcUrl", "-e", "EDC_DATASOURCE_DEFAULT_USER=$DatabaseUser",
        "-e", "EDC_DATASOURCE_DEFAULT_PASSWORD=$DatabasePassword", "-e", "PGSSLROOTCERT=/tls/ca.crt",
        $MigrationImage, "migrate-and-verify") "EDC $Component schema migration failed in cycle $Cycle"
      $SuccessfulRuns[$Component] += 1
    }
  }

  $Query = "SELECT (SELECT count(*) FROM unnest(ARRAY['edc_asset','edc_contract_definitions','edc_contract_agreement','edc_contract_negotiation','edc_policydefinitions','edc_transfer_process','edc_edr_entry','edc_jti_validation','edc_data_plane_instance','edc_policy_monitor','edc_federated_catalog','edc_target_node_directory']) n(name) WHERE to_regclass('public.'||name) IS NOT NULL)::text || ':' || (SELECT count(*) FROM unnest(ARRAY['edc_accesstokendata','edc_data_plane']) n(name) WHERE to_regclass('public.'||name) IS NOT NULL)::text || ':' || (SELECT count(*) FROM molit_edc_schema_version)::text || ':' || (SELECT string_agg(component || '=' || required_version, ',' ORDER BY component) FROM molit_edc_schema_version)"
  $Verification = (& docker run --rm --network $Network -v "${TlsVolume}:/tls:ro" --entrypoint psql -e "PGPASSWORD=$DatabasePassword" -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/tls/ca.crt $MigrationImage -X -A -t -v ON_ERROR_STOP=1 -h $DatabaseContainer -U $DatabaseUser -d $DatabaseName -c $Query).Trim()
  if ($LASTEXITCODE -ne 0) { throw "EDC schema verification query failed" }
  $ExpectedVerification = "12:2:2:control-plane=$RequiredVersion,data-plane=$RequiredVersion"
  if ($Verification -ne $ExpectedVerification) { throw "EDC schema verification mismatch: $Verification" }
  $CaCertificate = (& docker run --rm -v "${TlsVolume}:/tls:ro" $PostgresImage sha256sum /tls/ca.crt).Trim().Split(' ')[0]
  if ($LASTEXITCODE -ne 0 -or $CaCertificate -notmatch '^[a-f0-9]{64}$') { throw "TLS CA digest verification failed" }
  $SourceAfter = Get-SourceTreeBinding
  if ($SourceBefore.Digest -ne $SourceAfter.Digest -or $SourceBefore.FileCount -ne $SourceAfter.FileCount) { throw "EDC schema source changed during verification" }

  $Evidence = [ordered]@{
    schemaVersion = "molit.edc-schema-postgres-verification/1"
    status = "pass"
    sourceCommit = $SourceCommit
    startedAt = $StartedAt
    finishedAt = [DateTimeOffset]::UtcNow.ToString("o")
    artifact = [ordered]@{
      dockerTarget = "schema-migration"
      localImageId = $LocalImageId
      dockerfileSha256 = Get-FileSha256 $DockerfilePath
      migrationRunnerSha256 = Get-FileSha256 $MigrationRunnerPath
      migrationManifestSha256 = $ArtifactDigest
      verificationScriptSha256 = Get-FileSha256 $ScriptPath
      sourceTreeSha256 = $SourceAfter.Digest
      sourceFileCount = $SourceAfter.FileCount
      requiredVersion = $RequiredVersion
    }
    database = [ordered]@{
      image = $PostgresImage
      tlsMode = "verify-full"
      serverNameVerified = $DatabaseContainer
      caCertificateSha256 = $CaCertificate
    }
    execution = [ordered]@{
      cycles = 2
      components = @(
        [ordered]@{ name = "control-plane"; successfulRuns = $SuccessfulRuns["control-plane"]; requiredTableCount = 12; versionMarkerCount = 1 },
        [ordered]@{ name = "data-plane"; successfulRuns = $SuccessfulRuns["data-plane"]; requiredTableCount = 2; versionMarkerCount = 1 }
      )
      totalSuccessfulRuns = 4
      markerSummary = "2:control-plane=$RequiredVersion,data-plane=$RequiredVersion"
      idempotentRepeat = $true
      sourceStableDuringRun = $true
      negativeTls = [ordered]@{
        wrongHostnameRejected = $WrongHostnameRejected
        wrongCaRejected = $WrongCaRejected
      }
    }
    productionGate = [ordered]@{
      policyName = "molit-verify-release-images"
      attestationPredicateType = "https://data.molit.go.kr/attestations/release-bundle/v1"
      localImageIsNotReleaseAuthorization = $true
    }
  }
  $TemporaryEvidence = Join-Path $EvidenceDirectory ".$([IO.Path]::GetFileName($ResolvedEvidencePath)).$RunId.tmp"
  [IO.File]::WriteAllText($TemporaryEvidence, (($Evidence | ConvertTo-Json -Depth 20) + "`n"), $Utf8)
  node (Join-Path $Root "tools/operations/validate-json-evidence.mjs") --schema (Join-Path $Root "contracts/edc-schema-postgres-verification.v1.schema.json") --input $TemporaryEvidence
  if ($LASTEXITCODE -ne 0) { throw "EDC schema verification evidence violates its contract" }
  Move-Item -LiteralPath $TemporaryEvidence -Destination $ResolvedEvidencePath -Force
  $Evidence | ConvertTo-Json -Depth 20 -Compress
} finally {
  docker rm -f $DatabaseContainer 2>$null | Out-Null
  docker image rm -f $MigrationImage 2>$null | Out-Null
  docker volume rm -f $TlsVolume 2>$null | Out-Null
  docker network rm $Network 2>$null | Out-Null
}
