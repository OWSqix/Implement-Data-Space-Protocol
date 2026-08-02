$ErrorActionPreference = "Stop"

$composeFile = Join-Path $PSScriptRoot "compose.test.yml"
$project = "molit-identity-$([Guid]::NewGuid().ToString('N').Substring(0, 12))"
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$adminUser = "identity-admin"
$adminPassword = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
$userPassword = [Guid]::NewGuid().ToString("N") + "!aA1"
$resourceSecret = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
$baseUrl = "http://127.0.0.1:$port"

$env:IDENTITY_TEST_PORT = "$port"
$env:IDENTITY_BOOTSTRAP_ADMIN_USERNAME = $adminUser
$env:IDENTITY_BOOTSTRAP_ADMIN_PASSWORD = $adminPassword

function Invoke-FormPost([string]$Uri, [hashtable]$Body, [hashtable]$Headers = @{}) {
  return Invoke-RestMethod -Method Post -Uri $Uri -Headers $Headers -ContentType "application/x-www-form-urlencoded" -Body $Body
}

function Invoke-AdminPost([string]$Uri, [object]$Body, [string]$Token) {
  $json = $Body | ConvertTo-Json -Depth 20 -Compress
  Invoke-RestMethod -Method Post -Uri $Uri -Headers @{ Authorization = "Bearer $Token" } -ContentType "application/json" -Body $json
}

try {
  docker compose --project-name $project --file $composeFile up --detach --quiet-pull
  if ($LASTEXITCODE -ne 0) { throw "Keycloak compose startup failed" }

  $ready = $false
  for ($attempt = 0; $attempt -lt 90; $attempt += 1) {
    try {
      $null = Invoke-RestMethod -Method Get -Uri "$baseUrl/realms/master/.well-known/openid-configuration" -TimeoutSec 2
      $ready = $true
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $ready) { throw "Keycloak did not become ready" }

  $adminToken = (Invoke-FormPost "$baseUrl/realms/master/protocol/openid-connect/token" @{
    grant_type = "password"
    client_id = "admin-cli"
    username = $adminUser
    password = $adminPassword
  }).access_token

  Invoke-AdminPost "$baseUrl/admin/realms" @{
    realm = "molit-identity-test"
    enabled = $true
    accessTokenLifespan = 300
    ssoSessionIdleTimeout = 600
    ssoSessionMaxLifespan = 1200
  } $adminToken

  $mappers = @(
    @{ name = "actor-type"; protocol = "openid-connect"; protocolMapper = "oidc-hardcoded-claim-mapper"; config = @{ "claim.name" = "actor_type"; "claim.value" = "human"; "jsonType.label" = "String"; "access.token.claim" = "true" } },
    @{ name = "molit-roles"; protocol = "openid-connect"; protocolMapper = "oidc-hardcoded-claim-mapper"; config = @{ "claim.name" = "molit_roles"; "claim.value" = "identity.operator"; "jsonType.label" = "String"; "access.token.claim" = "true" } },
    @{ name = "tenant-ids"; protocol = "openid-connect"; protocolMapper = "oidc-hardcoded-claim-mapper"; config = @{ "claim.name" = "tenant_ids"; "claim.value" = "tenant-a"; "jsonType.label" = "String"; "access.token.claim" = "true" } },
    @{ name = "authentication-method"; protocol = "openid-connect"; protocolMapper = "oidc-hardcoded-claim-mapper"; config = @{ "claim.name" = "amr"; "claim.value" = "pwd"; "jsonType.label" = "String"; "access.token.claim" = "true" } },
    @{ name = "control-plane-audience"; protocol = "openid-connect"; protocolMapper = "oidc-audience-mapper"; config = @{ "included.client.audience" = "molit-control-plane"; "access.token.claim" = "true" } },
    @{ name = "resource-server-audience"; protocol = "openid-connect"; protocolMapper = "oidc-audience-mapper"; config = @{ "included.client.audience" = "identity-resource-server"; "access.token.claim" = "true" } }
  )
  Invoke-AdminPost "$baseUrl/admin/realms/molit-identity-test/clients" @{
    clientId = "identity-test-client"
    enabled = $true
    publicClient = $true
    directAccessGrantsEnabled = $true
    standardFlowEnabled = $false
    protocol = "openid-connect"
    protocolMappers = $mappers
  } $adminToken
  Invoke-AdminPost "$baseUrl/admin/realms/molit-identity-test/clients" @{
    clientId = "identity-resource-server"
    secret = $resourceSecret
    enabled = $true
    publicClient = $false
    serviceAccountsEnabled = $true
    standardFlowEnabled = $false
    directAccessGrantsEnabled = $false
    protocol = "openid-connect"
  } $adminToken
  Invoke-AdminPost "$baseUrl/admin/realms/molit-identity-test/users" @{
    username = "operator-one"
    firstName = "Identity"
    lastName = "Operator"
    email = "operator-one@example.invalid"
    emailVerified = $true
    enabled = $true
    requiredActions = @()
    credentials = @(@{ type = "password"; value = $userPassword; temporary = $false })
  } $adminToken

  $env:MOLIT_IDENTITY_TEST_BASE_URL = $baseUrl
  $env:MOLIT_IDENTITY_TEST_USERNAME = "operator-one"
  $env:MOLIT_IDENTITY_TEST_PASSWORD = $userPassword
  $env:MOLIT_IDENTITY_TEST_RESOURCE_SECRET = $resourceSecret
  node --test tests/integration/identity-keycloak.test.mjs
  if ($LASTEXITCODE -ne 0) { throw "operational identity integration test failed" }
} finally {
  Remove-Item Env:MOLIT_IDENTITY_TEST_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:MOLIT_IDENTITY_TEST_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:MOLIT_IDENTITY_TEST_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:MOLIT_IDENTITY_TEST_RESOURCE_SECRET -ErrorAction SilentlyContinue
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  docker compose --project-name $project --file $composeFile down --volumes --remove-orphans *> $null
  $ErrorActionPreference = $previousErrorAction
  Remove-Item Env:IDENTITY_TEST_PORT -ErrorAction SilentlyContinue
  Remove-Item Env:IDENTITY_BOOTSTRAP_ADMIN_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:IDENTITY_BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
}
