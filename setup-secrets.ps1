# ═══════════════════════════════════════════════════════════════════════════
# Fly.io Secrets Setup Script
# Interactive script to set all required secrets
# ═══════════════════════════════════════════════════════════════════════════

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Fly.io Secrets Setup" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$appName = "demedia-back-end"

# Check if fly CLI is installed
if (-not (Get-Command fly -ErrorAction SilentlyContinue)) {
    Write-Host "✗ Fly CLI not found!" -ForegroundColor Red
    exit 1
}

# Check if logged in
$authStatus = fly auth whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Not logged in to Fly.io" -ForegroundColor Red
    Write-Host "Run: fly auth login" -ForegroundColor Yellow
    exit 1
}

Write-Host "This script will help you set up all required secrets." -ForegroundColor Yellow
Write-Host "You can skip any secret by pressing Enter." -ForegroundColor Yellow
Write-Host ""

function Set-FlySecret {
    param (
        [string]$Name,
        [string]$Description,
        [bool]$Required = $false,
        [bool]$Secure = $false
    )
    
    Write-Host "$Name" -ForegroundColor Cyan
    Write-Host "  $Description" -ForegroundColor Gray
    
    if ($Secure) {
        $value = Read-Host "  Value" -AsSecureString
        $plainValue = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($value))
    } else {
        $plainValue = Read-Host "  Value"
    }
    
    if ($plainValue) {
        Write-Host "  Setting secret..." -ForegroundColor Gray
        fly secrets set "$Name=$plainValue" --app $appName --stage
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ Set" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Failed" -ForegroundColor Red
        }
    } elseif ($Required) {
        Write-Host "  ⚠ Required secret skipped!" -ForegroundColor Yellow
    } else {
        Write-Host "  Skipped" -ForegroundColor Gray
    }
    Write-Host ""
}

Write-Host "═══ Critical Secrets (Required) ═══" -ForegroundColor Yellow
Write-Host ""

Set-FlySecret -Name "DATABASE_URL" -Description "PostgreSQL connection string" -Required $true -Secure $true
Set-FlySecret -Name "JWT_SECRET" -Description "JWT signing secret (32+ chars)" -Required $true -Secure $true
Set-FlySecret -Name "JWT_REFRESH_SECRET" -Description "JWT refresh signing secret (32+ chars)" -Required $true -Secure $true
Set-FlySecret -Name "LIVEKIT_URL" -Description "LiveKit WebSocket URL (wss://...)" -Required $true
Set-FlySecret -Name "LIVEKIT_API_KEY" -Description "LiveKit API key" -Required $true -Secure $true
Set-FlySecret -Name "LIVEKIT_API_SECRET" -Description "LiveKit API secret" -Required $true -Secure $true

Write-Host "═══ Admin Configuration ═══" -ForegroundColor Yellow
Write-Host ""

Set-FlySecret -Name "ADMIN_SEED_EMAIL" -Description "Admin dashboard email"
Set-FlySecret -Name "ADMIN_SEED_PASSWORD" -Description "Admin dashboard password (8+ chars)" -Secure $true
Set-FlySecret -Name "ADMIN_SEED_NAME" -Description "Admin display name"
Set-FlySecret -Name "INTERNAL_SERVICE_TOKEN" -Description "Internal service token (32+ chars)" -Secure $true

Write-Host "═══ Twilio (SMS/OTP) ═══" -ForegroundColor Yellow
Write-Host ""

Set-FlySecret -Name "TWILIO_ACCOUNT_SID" -Description "Twilio Account SID"
Set-FlySecret -Name "TWILIO_AUTH_TOKEN" -Description "Twilio Auth Token" -Secure $true
Set-FlySecret -Name "TWILIO_PHONE_NUMBER" -Description "Twilio Phone Number (+1234567890)"

Write-Host "═══ OAuth (Social Login) ═══" -ForegroundColor Yellow
Write-Host ""

Set-FlySecret -Name "GOOGLE_CLIENT_ID" -Description "Google OAuth Client ID"
Set-FlySecret -Name "GOOGLE_CLIENT_SECRET" -Description "Google OAuth Client Secret" -Secure $true
Set-FlySecret -Name "FACEBOOK_APP_ID" -Description "Facebook App ID"
Set-FlySecret -Name "FACEBOOK_APP_SECRET" -Description "Facebook App Secret" -Secure $true

Write-Host "═══ Cloudinary (Uploads) ═══" -ForegroundColor Yellow
Write-Host ""

Set-FlySecret -Name "CLOUDINARY_CLOUD_NAME" -Description "Cloudinary Cloud Name"
Set-FlySecret -Name "CLOUDINARY_API_KEY" -Description "Cloudinary API Key"
Set-FlySecret -Name "CLOUDINARY_API_SECRET" -Description "Cloudinary API Secret" -Secure $true

Write-Host "═══ Firebase (Push Notifications) ═══" -ForegroundColor Yellow
Write-Host ""

Set-FlySecret -Name "FIREBASE_SERVICE_ACCOUNT" -Description "Firebase Service Account JSON (single line)" -Secure $true

Write-Host "═══ Application Configuration ═══" -ForegroundColor Yellow
Write-Host ""

Set-FlySecret -Name "CORS_ORIGINS" -Description "Allowed origins (comma-separated)"
Set-FlySecret -Name "APP_URL" -Description "App URL (https://demedia-back-end.fly.dev)"
Set-FlySecret -Name "APP_NAME" -Description "App Name (Nexus Voice)"
Set-FlySecret -Name "NODE_ENV" -Description "Environment (production)"

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Secrets Setup Complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

Write-Host "View all secrets:" -ForegroundColor Yellow
Write-Host "  fly secrets list --app $appName" -ForegroundColor White
Write-Host ""

Write-Host "Deploy now:" -ForegroundColor Yellow
Write-Host "  .\deploy.ps1" -ForegroundColor White
Write-Host ""
