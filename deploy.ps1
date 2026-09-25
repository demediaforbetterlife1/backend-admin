# ═══════════════════════════════════════════════════════════════════════════
# Fly.io Deployment Script for Backend
# ═══════════════════════════════════════════════════════════════════════════

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Backend Deployment to Fly.io" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Check if fly CLI is installed
if (-not (Get-Command fly -ErrorAction SilentlyContinue)) {
    Write-Host "✗ Fly CLI not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install Fly CLI:" -ForegroundColor Yellow
    Write-Host "  pwsh -Command `"iwr https://fly.io/install.ps1 -useb | iex`"" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host "✓ Fly CLI found" -ForegroundColor Green
Write-Host ""

# Check if logged in
$authStatus = fly auth whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Not logged in to Fly.io" -ForegroundColor Red
    Write-Host ""
    Write-Host "Login to Fly.io:" -ForegroundColor Yellow
    Write-Host "  fly auth login" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host "✓ Logged in to Fly.io" -ForegroundColor Green
Write-Host ""

# Check if app exists
$appExists = fly status --app demedia-back-end 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠ App 'demedia-back-end' not found" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "This is your first deployment. The app will be created." -ForegroundColor Yellow
    Write-Host ""
    
    $createApp = Read-Host "Create app 'demedia-back-end'? (y/n)"
    if ($createApp -ne "y") {
        Write-Host "Deployment cancelled" -ForegroundColor Yellow
        exit 0
    }
    
    Write-Host ""
    Write-Host "Creating app..." -ForegroundColor Cyan
    fly apps create demedia-back-end --org personal
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Failed to create app" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "✓ App created" -ForegroundColor Green
    Write-Host ""
}

# Check if secrets are configured
Write-Host "Checking secrets..." -ForegroundColor Cyan
$secrets = fly secrets list --app demedia-back-end 2>&1

$missingSecrets = @()

# Critical secrets
$criticalSecrets = @(
    "DATABASE_URL",
    "JWT_SECRET",
    "JWT_REFRESH_SECRET",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET"
)

foreach ($secret in $criticalSecrets) {
    if ($secrets -notmatch $secret) {
        $missingSecrets += $secret
    }
}

if ($missingSecrets.Count -gt 0) {
    Write-Host ""
    Write-Host "✗ Missing critical secrets:" -ForegroundColor Red
    foreach ($secret in $missingSecrets) {
        Write-Host "  - $secret" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Set secrets with:" -ForegroundColor Yellow
    Write-Host "  fly secrets set $($missingSecrets[0])=`"your-value`" --app demedia-back-end" -ForegroundColor White
    Write-Host ""
    Write-Host "See DEPLOYMENT.md for all required secrets" -ForegroundColor Yellow
    Write-Host ""
    
    $continue = Read-Host "Continue deployment anyway? (y/n)"
    if ($continue -ne "y") {
        Write-Host "Deployment cancelled" -ForegroundColor Yellow
        exit 0
    }
} else {
    Write-Host "✓ All critical secrets configured" -ForegroundColor Green
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Deploying..." -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Deploy
fly deploy --app demedia-back-end

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "✗ Deployment failed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check logs with:" -ForegroundColor Yellow
    Write-Host "  fly logs --app demedia-back-end" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✓ Deployment Successful!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

# Get app URL
$appUrl = "https://demedia-back-end.fly.dev"
Write-Host "App URL: $appUrl" -ForegroundColor Cyan
Write-Host "Health Check: $appUrl/health" -ForegroundColor Cyan
Write-Host "API Base: $appUrl/api" -ForegroundColor Cyan
Write-Host ""

# Test health endpoint
Write-Host "Testing health endpoint..." -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "$appUrl/health" -TimeoutSec 10 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "✓ Health check passed" -ForegroundColor Green
    } else {
        Write-Host "⚠ Health check returned status: $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠ Health check failed (app might still be starting)" -ForegroundColor Yellow
    Write-Host "  Wait a few seconds and try: $appUrl/health" -ForegroundColor White
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Update Flutter app API URL to: $appUrl/api" -ForegroundColor White
Write-Host "  2. Update Admin dashboard API URL to: $appUrl" -ForegroundColor White
Write-Host "  3. Test the deployment: $appUrl/health" -ForegroundColor White
Write-Host ""
Write-Host "View logs:" -ForegroundColor Yellow
Write-Host "  fly logs --app demedia-back-end" -ForegroundColor White
Write-Host ""
Write-Host "View dashboard:" -ForegroundColor Yellow
Write-Host "  fly dashboard demedia-back-end" -ForegroundColor White
Write-Host ""
