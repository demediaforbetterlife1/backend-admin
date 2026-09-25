# 🚀 Quick Start: Deploy Backend to Fly.io

Follow these steps to deploy your backend to Fly.io in minutes.

## Step 1: Install Fly CLI

```powershell
# Open PowerShell as Administrator and run:
iwr https://fly.io/install.ps1 -useb | iex

# Verify installation (you may need to restart PowerShell)
fly version
```

**Note:** If you get a script execution error, first enable scripts:
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Step 2: Login to Fly.io

```powershell
fly auth login
```

This opens your browser to authenticate.

## Step 3: Prepare Your Secrets

You need to set these **critical secrets** before deploying:

1. **Database** (PostgreSQL connection string)
2. **JWT Secrets** (for authentication)
3. **LiveKit** (for voice rooms)
4. **Admin credentials** (for dashboard)

### Generate Strong Secrets

```powershell
# Generate JWT secrets (run twice for two secrets)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Set Secrets

```powershell
cd e:\voicechat\voicechat_app\backend

# Database (REQUIRED)
fly secrets set DATABASE_URL="postgresql://user:password@host:5432/db?sslmode=require" --app demedia-back-end

# JWT Secrets (REQUIRED)
fly secrets set JWT_SECRET="your-32-char-secret-here" --app demedia-back-end
fly secrets set JWT_REFRESH_SECRET="your-32-char-refresh-secret-here" --app demedia-back-end

# LiveKit (REQUIRED for voice rooms)
fly secrets set LIVEKIT_URL="wss://your-livekit.livekit.cloud" --app demedia-back-end
fly secrets set LIVEKIT_API_KEY="your-livekit-api-key" --app demedia-back-end
fly secrets set LIVEKIT_API_SECRET="your-livekit-api-secret" --app demedia-back-end

# Admin Dashboard (REQUIRED)
fly secrets set ADMIN_SEED_EMAIL="admin@yourdomain.com" --app demedia-back-end
fly secrets set ADMIN_SEED_PASSWORD="your-strong-password" --app demedia-back-end
fly secrets set ADMIN_SEED_NAME="Admin" --app demedia-back-end

# Internal Service Token (REQUIRED for admin dashboard)
fly secrets set INTERNAL_SERVICE_TOKEN="your-32-char-token-here" --app demedia-back-end

# Application Config
fly secrets set NODE_ENV="production" --app demedia-back-end
fly secrets set APP_URL="https://demedia-back-end.fly.dev" --app demedia-back-end
fly secrets set CORS_ORIGINS="https://your-frontend.com,https://your-admin.com" --app demedia-back-end
```

### Optional Secrets (Add these if you use these services)

```powershell
# Twilio (for SMS/OTP)
fly secrets set TWILIO_ACCOUNT_SID="your-sid" --app demedia-back-end
fly secrets set TWILIO_AUTH_TOKEN="your-token" --app demedia-back-end
fly secrets set TWILIO_PHONE_NUMBER="+1234567890" --app demedia-back-end

# Google OAuth
fly secrets set GOOGLE_CLIENT_ID="your-client-id" --app demedia-back-end
fly secrets set GOOGLE_CLIENT_SECRET="your-client-secret" --app demedia-back-end

# Cloudinary (for uploads)
fly secrets set CLOUDINARY_CLOUD_NAME="your-cloud-name" --app demedia-back-end
fly secrets set CLOUDINARY_API_KEY="your-api-key" --app demedia-back-end
fly secrets set CLOUDINARY_API_SECRET="your-api-secret" --app demedia-back-end

# Firebase (for push notifications)
fly secrets set FIREBASE_SERVICE_ACCOUNT='{"type":"service_account","project_id":"your-project"}' --app demedia-back-end
```

## Step 4: Deploy!

```powershell
cd e:\voicechat\voicechat_app\backend

# Run the deployment script
.\deploy.ps1

# Or deploy manually
fly deploy --app demedia-back-end
```

The deployment will:
1. Build Docker image
2. Run database migrations
3. Start the server
4. Create admin account

## Step 5: Verify Deployment

```powershell
# Check app status
fly status --app demedia-back-end

# View logs
fly logs --app demedia-back-end

# Test health endpoint
fly open /health --app demedia-back-end
```

Your backend is now live at: **https://demedia-back-end.fly.dev**

## Step 6: Update Your Apps

### Flutter App

Update API URL in your Flutter config:

```dart
// lib/config/api_config.dart or similar
const String API_BASE_URL = 'https://demedia-back-end.fly.dev/api';
```

### Admin Dashboard

Update `.env.local`:

```bash
NEXT_PUBLIC_API_URL=https://demedia-back-end.fly.dev
```

## Common Issues

### "App not found"

First deployment? The script will create the app automatically, or run:

```powershell
fly apps create demedia-back-end --org personal
```

### "Database connection failed"

Check your DATABASE_URL:
1. Must be PostgreSQL
2. Must include `?sslmode=require`
3. Must be accessible from internet

### "LiveKit connection failed"

Verify your LiveKit credentials are correct and the server is accessible.

### View detailed logs

```powershell
fly logs --app demedia-back-end -a 200
```

## Useful Commands

```powershell
# View all secrets
fly secrets list --app demedia-back-end

# Update a secret
fly secrets set SECRET_NAME="new-value" --app demedia-back-end

# Restart app
fly apps restart demedia-back-end

# Scale up
fly scale count 2 --app demedia-back-end

# SSH into machine
fly ssh console --app demedia-back-end

# View metrics
fly dashboard demedia-back-end
```

## Cost

- **Free tier**: 3 shared VMs with 256MB RAM
- **Auto-stop**: Machines stop when idle, start automatically on request
- **Typical cost**: $0-5/month for small apps

## Need Help?

1. Read full deployment guide: `DEPLOYMENT.md`
2. Check logs: `fly logs --app demedia-back-end`
3. Fly.io docs: https://fly.io/docs/
4. Community: https://community.fly.io/

---

## TL;DR (Experienced Users)

```powershell
# Install & login
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
fly auth login

# Set critical secrets
fly secrets set DATABASE_URL="postgresql://..." --app demedia-back-end
fly secrets set JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" --app demedia-back-end
fly secrets set JWT_REFRESH_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" --app demedia-back-end
fly secrets set LIVEKIT_URL="wss://..." LIVEKIT_API_KEY="..." LIVEKIT_API_SECRET="..." --app demedia-back-end
fly secrets set ADMIN_SEED_EMAIL="admin@domain.com" ADMIN_SEED_PASSWORD="password" --app demedia-back-end

# Deploy
cd e:\voicechat\voicechat_app\backend
fly deploy --app demedia-back-end

# Verify
fly open /health --app demedia-back-end
```

Done! 🎉
