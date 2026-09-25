# 📋 Quick Reference: Get Your Credentials

## 🔥 Firebase (5 minutes)

### What you need:
- Service Account JSON file (for push notifications)

### Steps:
1. **Go to**: https://console.firebase.google.com/
2. **Create project** (or select existing)
3. **Click**: ⚙️ (Settings) → Project settings → Service accounts
4. **Click**: "Generate new private key"
5. **Save**: `firebase-service-account.json` in backend folder

### Quick Test:
```powershell
# Verify the JSON is valid
Get-Content firebase-service-account.json | ConvertFrom-Json
```

---

## ☁️ Cloudinary (3 minutes)

### What you need:
- Cloud Name
- API Key  
- API Secret

### Steps:
1. **Go to**: https://cloudinary.com/users/register/free
2. **Sign up** with email
3. **Verify email** (check inbox)
4. **Dashboard**: You'll see credentials immediately:
   ```
   Cloud name: dxxxxxxxxxxxxx
   API Key: 123456789012345
   API Secret: [Click "Show"] → abcdefghijklmnop
   ```
5. **Copy all three values**

### What they look like:
```
CLOUDINARY_CLOUD_NAME=dxxxxxxxxxxxxx          (starts with 'd')
CLOUDINARY_API_KEY=123456789012345            (15 digits)
CLOUDINARY_API_SECRET=abcdefghijklmnop        (random string)
```

---

## 🚀 Deploy with Credentials

### Option 1: Interactive Script (Recommended)
```powershell
cd e:\voicechat\voicechat_app\backend
.\deploy-with-credentials.ps1
```
The script will:
- Find your Firebase JSON automatically
- Ask for Cloudinary credentials
- Set all secrets in Fly.io
- Deploy the app

### Option 2: Manual Commands
```powershell
cd e:\voicechat\voicechat_app\backend

# Firebase
$fb = Get-Content firebase-service-account.json -Raw
$fb = $fb -replace '\s+', ' '
fly secrets set "FIREBASE_SERVICE_ACCOUNT=$fb" --app demedia-back-end

# Cloudinary  
fly secrets set `
  CLOUDINARY_CLOUD_NAME="your-cloud-name" `
  CLOUDINARY_API_KEY="your-api-key" `
  CLOUDINARY_API_SECRET="your-api-secret" `
  --app demedia-back-end

# Deploy
fly deploy --app demedia-back-end
```

---

## ✅ Verification

### Check secrets are set:
```powershell
fly secrets list --app demedia-back-end
```

You should see:
- `FIREBASE_SERVICE_ACCOUNT`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

### Test deployment:
```powershell
# Wait 30 seconds after deploy, then:
Invoke-WebRequest https://demedia-back-end.fly.dev/health
```

Expected response:
```json
{"success":true,"status":"ok"}
```

---

## 🎯 What Each Service Does

### Firebase
- **Purpose**: Push notifications to mobile devices
- **Used for**: Notifying users about messages, room invites, gifts, etc.
- **Without it**: App works but no push notifications

### Cloudinary
- **Purpose**: Image hosting and optimization
- **Used for**: User avatars, room covers, post images, gifts
- **Without it**: Image uploads will fail

---

## 📞 Get Help

### Can't find credentials?
- **Firebase**: Settings → Service accounts → "Generate new private key"
- **Cloudinary**: Dashboard → Account Details → API Keys

### Still having issues?
1. Check the full guide: `SETUP_FIREBASE_CLOUDINARY.md`
2. View deployment logs: `fly logs --app demedia-back-end`
3. Check app status: `fly status --app demedia-back-end`

---

## 🔒 Security Reminder

- ✅ Never commit `firebase-service-account.json` to git
- ✅ Add to `.gitignore`
- ✅ Don't share credentials publicly
- ✅ Use Fly secrets (not .env in production)
