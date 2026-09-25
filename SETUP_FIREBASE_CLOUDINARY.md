# 🔥 Firebase & ☁️ Cloudinary Setup Guide

Follow these steps to set up Firebase (for push notifications) and Cloudinary (for image uploads).

---

## 🔥 Part 1: Firebase Setup (Push Notifications)

### Step 1: Create Firebase Project

1. **Go to Firebase Console**
   - Visit: https://console.firebase.google.com/
   - Click "Add project" or "Create a project"

2. **Configure Project**
   - **Project name**: Enter your app name (e.g., "Nexus Voice" or "VoiceChat")
   - **Google Analytics**: You can disable it for now (optional)
   - Click "Create project"
   - Wait for project creation (~30 seconds)
   - Click "Continue"

### Step 2: Add Android App (if you have one)

1. **Register Android App**
   - In Firebase Console, click the Android icon
   - **Android package name**: `com.yourcompany.voicechat` (must match your Flutter app)
   - **App nickname**: "VoiceChat Android" (optional)
   - Click "Register app"

2. **Download config file**
   - Download `google-services.json`
   - Save it to: `voicechat_app/client/android/app/google-services.json`

### Step 3: Add iOS App (if you have one)

1. **Register iOS App**
   - Click the iOS icon
   - **Bundle ID**: `com.yourcompany.voicechat` (must match your Flutter app)
   - **App nickname**: "VoiceChat iOS" (optional)
   - Click "Register app"

2. **Download config file**
   - Download `GoogleService-Info.plist`
   - Save it to: `voicechat_app/client/ios/Runner/GoogleService-Info.plist`

### Step 4: Generate Service Account Key

1. **Go to Project Settings**
   - Click the ⚙️ (gear icon) next to "Project Overview"
   - Click "Project settings"

2. **Navigate to Service Accounts**
   - Click the "Service accounts" tab
   - Click "Generate new private key"
   - Click "Generate key"
   - A JSON file will download

3. **Save the JSON file**
   - Save it as `firebase-service-account.json` in your backend folder
   - **IMPORTANT**: Never commit this file to git!

### Step 5: Enable Cloud Messaging

1. **Go to Cloud Messaging**
   - In Firebase Console, click "Cloud Messaging" in the left menu
   - If prompted, enable the Cloud Messaging API

2. **Get Server Key** (for older versions)
   - You'll see "Server key" - this is your legacy server key
   - Not needed for service account auth (which we're using)

---

## ☁️ Part 2: Cloudinary Setup (Image Uploads)

### Step 1: Create Cloudinary Account

1. **Sign Up**
   - Visit: https://cloudinary.com/users/register/free
   - Fill in your details:
     - Email address
     - Password
     - Select "I'm a developer"
   - Click "Create Account"

2. **Verify Email**
   - Check your email inbox
   - Click the verification link
   - Complete any additional setup steps

### Step 2: Get Your Credentials

1. **Access Dashboard**
   - After login, you'll see the Dashboard
   - Or visit: https://cloudinary.com/console

2. **Find Your Credentials**
   - On the Dashboard, you'll see:
     - **Cloud name**: e.g., `dxxxxxxxxxxxxx`
     - **API Key**: e.g., `123456789012345`
     - **API Secret**: Click "Show" to reveal (e.g., `abcdefghijklmnopqrstuvwxyz`)

3. **Copy These Values**
   - You'll need all three for deployment:
     - `CLOUDINARY_CLOUD_NAME`
     - `CLOUDINARY_API_KEY`
     - `CLOUDINARY_API_SECRET`

### Step 3: Configure Upload Settings (Optional)

1. **Media Library**
   - Go to "Media Library" in the left menu
   - This is where all uploaded images will appear

2. **Settings**
   - Go to Settings > Upload
   - You can configure:
     - Upload presets
     - Folder structure
     - File size limits
     - Format conversions

---

## 🚀 Part 3: Deploy with Credentials

### Option A: Quick Deploy Script

I'll create a script that reads your Firebase JSON and sets all secrets:

```powershell
cd e:\voicechat\voicechat_app\backend
.\deploy-with-credentials.ps1
```

### Option B: Manual Secret Setup

```powershell
# Navigate to backend
cd e:\voicechat\voicechat_app\backend

# Set Firebase credentials (replace with your file path)
$firebase = Get-Content -Path "firebase-service-account.json" -Raw
$firebase = $firebase -replace '"','\"' -replace '\n','' -replace '\r',''
fly secrets set "FIREBASE_SERVICE_ACCOUNT=$firebase" --app demedia-back-end

# Set Cloudinary credentials (replace with your values)
fly secrets set CLOUDINARY_CLOUD_NAME="your-cloud-name" --app demedia-back-end
fly secrets set CLOUDINARY_API_KEY="your-api-key" --app demedia-back-end
fly secrets set CLOUDINARY_API_SECRET="your-api-secret" --app demedia-back-end

# Deploy
fly deploy --app demedia-back-end
```

---

## ✅ Verification Checklist

### Firebase
- [ ] Project created
- [ ] Service account JSON downloaded
- [ ] JSON file saved securely (not in git)
- [ ] Cloud Messaging enabled

### Cloudinary
- [ ] Account created and verified
- [ ] Cloud name copied
- [ ] API key copied
- [ ] API secret copied (revealed and copied)

### Deployment
- [ ] Secrets set in Fly.io
- [ ] App deployed successfully
- [ ] Health check passes
- [ ] Push notifications work
- [ ] Image uploads work

---

## 🔒 Security Notes

1. **Never commit credentials to git**
   - Add `firebase-service-account.json` to `.gitignore`
   - Never share your API secrets publicly

2. **Rotate secrets periodically**
   - Firebase: Generate new service account key every 90 days
   - Cloudinary: Regenerate API secret from dashboard

3. **Use environment variables**
   - Credentials are stored as Fly.io secrets
   - Never hardcode in source code

---

## 🆘 Troubleshooting

### Firebase Issues

**Problem**: "Permission denied" errors
- **Solution**: Make sure Cloud Messaging API is enabled
- Go to: https://console.cloud.google.com/apis/library/fcm.googleapis.com
- Enable the API

**Problem**: Invalid service account JSON
- **Solution**: Download a fresh service account key
- Make sure the JSON is valid (test with: `node -e "JSON.parse(require('fs').readFileSync('firebase-service-account.json'))"`)

### Cloudinary Issues

**Problem**: Upload fails with "Invalid API key"
- **Solution**: Double-check you copied all three credentials correctly
- Make sure there are no extra spaces

**Problem**: "Cloud name not found"
- **Solution**: Use the exact cloud name from your dashboard (usually starts with 'd')

---

## 📞 Support Links

- **Firebase Documentation**: https://firebase.google.com/docs
- **Firebase Console**: https://console.firebase.google.com/
- **Cloudinary Documentation**: https://cloudinary.com/documentation
- **Cloudinary Console**: https://cloudinary.com/console

---

## 🎯 Next Steps

After setting up both services:

1. Run the deployment script
2. Test push notifications in your Flutter app
3. Test image uploads
4. Monitor usage in dashboards

Your backend will be fully functional with:
- ✅ Push notifications via Firebase
- ✅ Image uploads via Cloudinary
- ✅ All features working in production!
