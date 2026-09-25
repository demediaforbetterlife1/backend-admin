# Complete Deployment Script
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Backend Deployment - Set Secrets and Deploy" -ForegroundColor Cyan
Write-Host ""

$appName = "demedia-back-end"

# Check fly CLI
if (-not (Get-Command fly -ErrorAction SilentlyContinue)) {
    Write-Host "Fly CLI not found! Install with: iwr https://fly.io/install.ps1 -useb | iex" -ForegroundColor Red
    exit 1
}

# Check authentication
Write-Host "Checking authentication..." -ForegroundColor Cyan
fly auth whoami 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged in! Run: fly auth login" -ForegroundColor Red
    exit 1
}
Write-Host "Authenticated" -ForegroundColor Green
Write-Host ""

# Set secrets from .env
Write-Host "Setting secrets from .env file..." -ForegroundColor Cyan
Write-Host ""

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Write-Host ".env file not found!" -ForegroundColor Red
    exit 1
}

# Read DATABASE_URL
$databaseUrl = (Select-String -Path $envPath -Pattern "^DATABASE_URL=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value
Write-Host "Setting DATABASE_URL..." -ForegroundColor Gray
fly secrets set "DATABASE_URL=$databaseUrl" --app $appName --stage | Out-Null

# Read JWT secrets
$jwtSecret = (Select-String -Path $envPath -Pattern "^JWT_SECRET=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value
Write-Host "Setting JWT_SECRET..." -ForegroundColor Gray
fly secrets set "JWT_SECRET=$jwtSecret" --app $appName --stage | Out-Null

$jwtRefreshSecret = (Select-String -Path $envPath -Pattern "^JWT_REFRESH_SECRET=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value
Write-Host "Setting JWT_REFRESH_SECRET..." -ForegroundColor Gray
fly secrets set "JWT_REFRESH_SECRET=$jwtRefreshSecret" --app $appName --stage | Out-Null

# Read LiveKit
$livekitUrl = (Select-String -Path $envPath -Pattern "^LIVEKIT_URL=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value
Write-Host "Setting LIVEKIT_URL..." -ForegroundColor Gray
fly secrets set "LIVEKIT_URL=$livekitUrl" --app $appName --stage | Out-Null

$livekitKey = (Select-String -Path $envPath -Pattern "^LIVEKIT_API_KEY=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value
Write-Host "Setting LIVEKIT_API_KEY..." -ForegroundColor Gray
fly secrets set "LIVEKIT_API_KEY=$livekitKey" --app $appName --stage | Out-Null

$livekitSecret = (Select-String -Path $envPath -Pattern "^LIVEKIT_API_SECRET=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value
Write-Host "Setting LIVEKIT_API_SECRET..." -ForegroundColor Gray
fly secrets set "LIVEKIT_API_SECRET=$livekitSecret" --app $appName --stage | Out-Null

# Read Admin credentials
$adminEmail = (Select-String -Path $envPath -Pattern "^ADMIN_SEED_EMAIL=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value
Write-Host "Setting ADMIN_SEED_EMAIL..." -ForegroundColor Gray
fly secrets set "ADMIN_SEED_EMAIL=$adminEmail" --app $appName --stage | Out-Null

$adminPassword = (Select-String -Path $envPath -Pattern "^ADMIN_SEED_PASSWORD=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value
Write-Host "Setting ADMIN_SEED_PASSWORD..." -ForegroundColor Gray
fly secrets set "ADMIN_SEED_PASSWORD=$adminPassword" --app $appName --stage | Out-Null

$adminName = (Select-String -Path $envPath -Pattern "^ADMIN_SEED_NAME=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value
Write-Host "Setting ADMIN_SEED_NAME..." -ForegroundColor Gray
fly secrets set "ADMIN_SEED_NAME=$adminName" --app $appName --stage | Out-Null

$serviceToken = (Select-String -Path $envPath -Pattern "^INTERNAL_SERVICE_TOKEN=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value
Write-Host "Setting INTERNAL_SERVICE_TOKEN..." -ForegroundColor Gray
fly secrets set "INTERNAL_SERVICE_TOKEN=$serviceToken" --app $appName --stage | Out-Null

# Set production environment
Write-Host "Setting production configuration..." -ForegroundColor Gray
fly secrets set "NODE_ENV=production" --app $appName --stage | Out-Null
fly secrets set "APP_URL=https://$appName.fly.dev" --app $appName --stage | Out-Null
fly secrets set "CORS_ORIGINS=https://$appName.fly.dev" --app $appName --stage | Out-Null
fly secrets set "LOG_OTP=false" --app $appName --stage | Out-Null
fly secrets set "DEV_FREE_SUBSCRIPTIONS=false" --app $appName --stage | Out-Null
fly secrets set "ALLOW_SOCIAL_STUB=false" --app $appName --stage | Out-Null

Write-Host ""
Write-Host "Secrets configured successfully" -ForegroundColor Green
Write-Host ""

# Deploy
Write-Host "Deploying to Fly.io..." -ForegroundColor Cyan
Write-Host ""

fly deploy --app $appName

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Deployment failed!" -ForegroundColor Red
    Write-Host "Check logs: fly logs --app $appName" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Deployment Successful!" -ForegroundColor Green
Write-Host ""
Write-Host "Backend URL: https://$appName.fly.dev" -ForegroundColor Cyan
Write-Host "API Base: https://$appName.fly.dev/api" -ForegroundColor Cyan
Write-Host "Health: https://$appName.fly.dev/health" -ForegroundColor Cyan
Write-Host ""
Write-Host "Update your Flutter app API URL to: https://$appName.fly.dev/api" -ForegroundColor Yellow
Write-Host ""
