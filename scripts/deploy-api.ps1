# Build + push API container locally, then deploy to Cloud Run.
# Avoids `gcloud run deploy --source` which triggers a Cloud Build path
# that requires granting the GCP-owned compute default service account
# object-viewer on the staging bucket. That IAM binding is blocked by the
# org policy `constraints/iam.allowedPolicyMemberDomains` (allowed value
# customer C0284dfqm only). Building and pushing from this workstation
# bypasses the Cloud Build service account entirely.

param(
  [string]$Project = 'communitybridge-26apr',
  [string]$Region  = 'us-central1',
  [string]$Service = 'communitybridge',
  [string]$Repo    = 'cloud-run-source-deploy',
  [string]$EnvFile = 'env/cloudrun.env',
  [string]$Tag     = (Get-Date -Format 'yyyyMMdd-HHmmss')
)

$ErrorActionPreference = 'Stop'
$image = "$Region-docker.pkg.dev/$Project/$Repo/${Service}:$Tag"
$generatedEnvVarsFile = $null

function Convert-EnvFileToCloudRunYaml {
  param(
    [string]$SourcePath,
    [string]$DestinationPath
  )

  if (-not (Test-Path -LiteralPath $SourcePath)) {
    return $null
  }

  $secretKeys = @(
    'CB_DATABASE_URL', 'BB_DATABASE_URL',
    'CB_JWT_SECRET', 'BB_JWT_SECRET',
    'CB_SMTP_URL', 'BB_SMTP_URL',
    'CB_TWILIO_AUTH_TOKEN', 'BB_TWILIO_AUTH_TOKEN',
    'CB_ADMIN_PASSWORD', 'BB_ADMIN_PASSWORD',
    'CB_FIREBASE_SERVICE_ACCOUNT_JSON', 'BB_FIREBASE_SERVICE_ACCOUNT_JSON',
    'CB_RECAPTCHA_SECRET_KEY', 'BB_RECAPTCHA_SECRET_KEY'
  )
  $reservedKeys = @(
    'PORT',
    'K_SERVICE',
    'K_REVISION',
    'K_CONFIGURATION'
  )

  $lines = @()
  foreach ($rawLine in Get-Content -LiteralPath $SourcePath) {
    $line = [string]$rawLine
    if ($line -match '^\s*$' -or $line -match '^\s*#') { continue }
    if ($line -notmatch '^\s*([^=]+?)\s*=\s*(.*)\s*$') { continue }
    $key = [string]$Matches[1].Trim()
    $value = [string]$Matches[2]
    if (-not $key -or $secretKeys -contains $key -or $reservedKeys -contains $key) { continue }
    $escaped = $value.Replace("'", "''")
    $lines += ($key + ": '" + $escaped + "'")
  }

  if (-not $lines.Count) {
    return $null
  }

  $destinationDir = Split-Path -Parent $DestinationPath
  if ($destinationDir -and -not (Test-Path -LiteralPath $destinationDir)) {
    New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
  }

  Set-Content -LiteralPath $DestinationPath -Value ($lines -join [Environment]::NewLine) -Encoding utf8
  return $DestinationPath
}

Write-Host "==> Building $image"
docker build -t $image .
if ($LASTEXITCODE -ne 0) { throw "docker build failed" }

Write-Host "==> Pushing $image"
docker push $image
if ($LASTEXITCODE -ne 0) { throw "docker push failed" }

if ($EnvFile) {
  $resolvedEnvFile = Resolve-Path -LiteralPath $EnvFile -ErrorAction SilentlyContinue
  $envPath = if ($resolvedEnvFile) { $resolvedEnvFile.Path } else { $EnvFile }
  $generatedEnvVarsFile = Convert-EnvFileToCloudRunYaml -SourcePath $envPath -DestinationPath (Join-Path $PSScriptRoot '..\tmp\cloudrun-nonsecrets.env.yaml')
  if ($generatedEnvVarsFile) {
    Write-Host "==> Applying runtime env from $generatedEnvVarsFile"
  }
}

Write-Host "==> Deploying to Cloud Run: $Service ($Region)"
$deployArgs = @(
  'run', 'deploy', $Service,
  '--image', $image,
  '--region', $Region,
  '--project', $Project,
  '--platform', 'managed',
  '--quiet'
)
if ($generatedEnvVarsFile) {
  $deployArgs += @('--env-vars-file', $generatedEnvVarsFile)
}
gcloud @deployArgs
if ($LASTEXITCODE -ne 0) { throw "gcloud run deploy failed" }

Write-Host "==> Done. Image: $image"
