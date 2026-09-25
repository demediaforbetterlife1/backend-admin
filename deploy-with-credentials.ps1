# Deploy with Firebase & Cloudinary Credentials
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Firebase & Cloudinary Configuration" -ForegroundColor Cyan
Write-Host ""

$appName = "demedia-back-end"

# Check fly CLI
if (-not (Get-Command fly -ErrorAction SilentlyContinue)) {
    Write-Host "Fly CLI not found!" -ForegroundColor Red
    exit 1
}

Write-Host "This script will configure Firebase and Cloudinary." -ForegroundColor Yellow
Write-Host "Make sure you have:" -ForegroundColor Yellow
Write-Host "  1. Firebase service account JSON file" -ForegroundColor White
Write-Host "  2. Cloudinary credentials (cloud name, API key, secret)" -ForegroundColor White
Write-Host ""

$continue = Read-Host "Ready to continue? (y/n)"
if ($continue -ne "y") {
    Write-Host "Cancelled. See SETUP_FIREBASE_CLOUDINARY.md for help" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "=== Step 1: Firebase Configuration ===" -ForegroundColor Yellow
Write-Host ""

# Look for Firebase JSON
$firebaseFile = $null
$possibleFiles = @("firebase-service-account.json", "serviceAccountKey.json", "firebase-adminsdk.json")

foreach ($file in $possibleFiles) {
    if (Test-Path $file) {
        $firebaseFile = $file
        break
    }
}

if (-not $firebaseFile) {
    Write-Host "Firebase JSON not found in current directory" -ForegroundColor Yellow
    $firebasePath = Read-Host "Enter full path to Firebase JSON (or press Enter to skip)"
    
    if ($firebasePath -and (Test-Path $firebasePath)) {
        $firebaseFile = $firebasePath
    }
}

if ($firebaseFile) {
    Write-Host "Found: $firebaseFile" -ForegroundColor Green
    
    try {
        $firebaseContent = Get-Content -Path $firebaseFile -Raw
        $firebaseJson = $firebaseContent | ConvertFrom-Json
        
        if (-not $firebaseJson.project_id) {
            throw "Invalid Firebase JSON"
        }
        
        Write-Host "Project ID: $($firebaseJson.project_id)" -ForegroundColor Gray
        Write-Host "Setting Firebase secret..." -ForegroundColor Cyan
        
        # Minify JSON
        $firebaseMinified = $firebaseContent -replace '\s+', ' ' -replace '\r?\n', ''
        
        # Create temp file
        $tempFile = [System.IO.Path]::GetTempFileName()
        "FIREBASE_SERVICE_ACCOUNT=$firebaseMinified" | Out-File -FilePath $tempFile -NoNewline -Encoding ASCII
        
        # Import secret
        Get-Content $tempFile | fly secrets import --app $appName
        Remove-Item $tempFile -Force
        
        Write-Host "Firebase configured!" -ForegroundColor Green
    }
    catch {
        Write-Host "Failed to configure Firebase: $_" -ForegroundColor Red
        Write-Host "You can set this manually later" -ForegroundColor Yellow
    }
}
else {
    Write-Host "Skipping Firebase - push notifications will not work" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Step 2: Cloudinary Configuration ===" -ForegroundColor Yellow
Write-Host ""
Write-Host "Get credentials from: https://cloudinary.com/console" -ForegroundColor Gray
Write-Host ""

$cloudName = Read-Host "Cloud Name (or press Enter to skip)"

if ($cloudName) {
    $cloudKey = Read-Host "API Key"
    $cloudSecretSecure = Read-Host "API Secret" -AsSecureString
    $cloudSecret = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($cloudSecretSecure))
    
    if ($cloudKey -and $cloudSecret) {
        Write-Host "Setting Cloudinary secrets..." -ForegroundColor Cyan
        
        fly secrets set CLOUDINARY_CLOUD_NAME="$cloudName" CLOUDINARY_API_KEY="$cloudKey" CLOUDINARY_API_SECRET="$cloudSecret" --app $appName --stage
        
        Write-Host "Cloudinary configured!" -ForegroundColor Green
    }
}
else {
    Write-Host "Skipping Cloudinary - image uploads will not work" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Configuration Complete!" -ForegroundColor Green
Write-Host ""

$deploy = Read-Host "Deploy now? (y/n)"

if ($deploy -eq "y") {
    Write-Host ""
    Write-Host "Deploying..." -ForegroundColor Cyan
    fly deploy --app $appName
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Deployment Successful!" -ForegroundColor Green
        Write-Host "Backend URL: https://$appName.fly.dev" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Test: Invoke-WebRequest https://$appName.fly.dev/health" -ForegroundColor Yellow
    }
    else {
        Write-Host "Deployment failed. Check logs: fly logs --app $appName" -ForegroundColor Red
    }
}
else {
    Write-Host "Deploy later with: fly deploy --app $appName" -ForegroundColor Yellow
}
