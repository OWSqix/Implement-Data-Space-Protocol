param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$OpenSslPath = ""
)

$ErrorActionPreference = "Stop"
$directory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $directory -Force | Out-Null
if (-not $OpenSslPath) {
  $candidate = Get-Command openssl -ErrorAction SilentlyContinue
  if ($candidate) { $OpenSslPath = $candidate.Source }
  elseif (Test-Path "C:\Program Files\Git\usr\bin\openssl.exe") { $OpenSslPath = "C:\Program Files\Git\usr\bin\openssl.exe" }
  else { throw "OpenSSL is required to issue the ephemeral kind webhook certificate" }
}
$OpenSslPath = (Resolve-Path -LiteralPath $OpenSslPath).Path
$caKey = Join-Path $directory "ca.key"
$caCertificate = Join-Path $directory "ca.crt"
$serverKey = Join-Path $directory "tls.key"
$serverRequest = Join-Path $directory "tls.csr"
$serverCertificate = Join-Path $directory "tls.crt"
$extensions = Join-Path $directory "tls.ext"

@"
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:molit-caas-fencing-webhook,DNS:molit-caas-fencing-webhook.molit-caas-system,DNS:molit-caas-fencing-webhook.molit-caas-system.svc,DNS:molit-caas-fencing-webhook.molit-caas-system.svc.cluster.local
"@ | Set-Content -LiteralPath $extensions -Encoding ascii

& $OpenSslPath genrsa -out $caKey 3072
if ($LASTEXITCODE -ne 0) { throw "Webhook test CA key generation failed" }
& $OpenSslPath req -x509 -new -sha256 -key $caKey -days 2 -subj "/CN=molit-kind-fencing-test-ca" -out $caCertificate
if ($LASTEXITCODE -ne 0) { throw "Webhook test CA certificate generation failed" }
& $OpenSslPath genrsa -out $serverKey 2048
if ($LASTEXITCODE -ne 0) { throw "Webhook test server key generation failed" }
& $OpenSslPath req -new -sha256 -key $serverKey -subj "/CN=molit-caas-fencing-webhook.molit-caas-system.svc" -out $serverRequest
if ($LASTEXITCODE -ne 0) { throw "Webhook test certificate request generation failed" }
& $OpenSslPath x509 -req -sha256 -in $serverRequest -CA $caCertificate -CAkey $caKey -CAcreateserial -days 2 -extfile $extensions -out $serverCertificate
if ($LASTEXITCODE -ne 0) { throw "Webhook test server certificate signing failed" }
& $OpenSslPath verify -CAfile $caCertificate $serverCertificate
if ($LASTEXITCODE -ne 0) { throw "Webhook test certificate verification failed" }

[pscustomobject]@{
  caCertificate = $caCertificate
  serverCertificate = $serverCertificate
  serverPrivateKey = $serverKey
} | ConvertTo-Json
