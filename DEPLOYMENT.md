# Backend Deployment to Fly.io

This guide walks you through deploying the backend to Fly.io.

## Prerequisites

1. **Install Fly CLI**
   ```powershell
   # Windows (PowerShell - run as Administrator)
   iwr https://fly.io/install.ps1 -useb | iex
   
   # If you get execution policy error, first run:
   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
   
   # Verify installation (restart PowerShell after install)
   fly version
   ```

2. **Login to Fly.io**
   ```bash
   fly auth login
   ```

3. **Prepare Database** (if not already set up)
   - Create a PostgreSQL database (Neon, Supabase, or Fly Postgres)
   - Get the connection string

## Deployment Steps

### 1. Configure Secrets

Set all required environment variables as Fly secrets:

```bash
# Navigate to backend directory
cd e:\voicechat\voicechat_app\backend

# Database
fly secrets set DATABASE_URL="postgresql://user:password@host:port/database?sslmode=require"

# JWT Secrets (generate with: openssl rand -hex 32)
fly secrets set JWT_SECRET="your-strong-random-secret-32-chars"
fly secrets set JWT_REFRESH_SECRET="your-strong-random-refresh-secret-32-chars"

# Admin Dashboard
fly secrets set ADMIN_SEED_EMAIL="admin@yourdomain.com"
fly secrets set ADMIN_SEED_PASSWORD="your-strong-admin-password"
fly secrets set ADMIN_SEED_NAME="Admin"
fly secrets set INTERNAL_SERVICE_TOKEN="your-internal-service-token"

# LiveKit (REQUIRED)
fly secrets set LIVEKIT_URL="wss://your-livekit-server.livekit.cloud"
fly secrets set LIVEKIT_API_KEY="your-livekit-api-key"
fly secrets set LIVEKIT_API_SECRET="your-livekit-api-secret"

# Twilio (SMS/OTP)
fly secrets set TWILIO_ACCOUNT_SID="your-twilio-sid"
fly secrets set TWILIO_AUTH_TOKEN="your-twilio-token"
fly secrets set TWILIO_PHONE_NUMBER="+1234567890"

# OAuth (Optional - for social login)
fly secrets set GOOGLE_CLIENT_ID="your-google-client-id"
fly secrets set GOOGLE_CLIENT_SECRET="your-google-client-secret"
fly secrets set FACEBOOK_APP_ID="your-facebook-app-id"
fly secrets set FACEBOOK_APP_SECRET="your-facebook-app-secret"

# Cloudinary (for uploads)
fly secrets set CLOUDINARY_CLOUD_NAME="your-cloud-name"
fly secrets set CLOUDINARY_API_KEY="your-api-key"
fly secrets set CLOUDINARY_API_SECRET="your-api-secret"

# Firebase (for push notifications - single line JSON)
fly secrets set FIREBASE_SERVICE_ACCOUNT='{"type":"service_account","project_id":"your-project"}'

# CORS Origins (your frontend URLs)
fly secrets set CORS_ORIGINS="https://your-frontend.com,https://your-admin.com"

# App Configuration
fly secrets set APP_URL="https://demedia-back-end.fly.dev"
fly secrets set APP_NAME="Nexus Voice"
fly secrets set NODE_ENV="production"

# Redis (optional - if you have Redis)
# fly secrets set REDIS_URL="redis://your-redis-url:6379"
```

### 2. Deploy

```bash
# First deployment (creates the app)
fly deploy

# Or if app already exists
fly deploy --app demedia-back-end

# Watch logs during deployment
fly logs --app demedia-back-end
```

### 3. Verify Deployment

```bash
# Check app status
fly status --app demedia-back-end

# Check health endpoint
fly open /health --app demedia-back-end

# View logs
fly logs --app demedia-back-end
```

## Post-Deployment

### 1. Update Flutter App

Update the API URL in your Flutter app:

```dart
// In your API service or config
const String API_BASE_URL = 'https://demedia-back-end.fly.dev/api';
```

### 2. Update Admin Dashboard

Update the API URL in your Next.js admin dashboard:

```typescript
// In .env.local or config
NEXT_PUBLIC_API_URL=https://demedia-back-end.fly.dev
```

## Useful Commands

```bash
# Scale to 2 machines
fly scale count 2 --app demedia-back-end

# Scale memory
fly scale memory 512 --app demedia-back-end

# View secrets
fly secrets list --app demedia-back-end

# SSH into the machine
fly ssh console --app demedia-back-end

# Restart app
fly apps restart demedia-back-end

# View metrics
fly dashboard demedia-back-end

# Run Prisma migrations
fly ssh console --app demedia-back-end -C "cd /app && npx prisma migrate deploy"
```

## Troubleshooting

### Database Connection Issues

If you see database errors:

1. Check DATABASE_URL secret:
   ```bash
   fly secrets list --app demedia-back-end
   ```

2. Test database from within the machine:
   ```bash
   fly ssh console --app demedia-back-end
   # Inside the machine:
   node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); p.\$queryRaw\`SELECT 1\`.then(r => console.log('DB OK', r)).catch(e => console.error('DB Error', e)).finally(() => p.\$disconnect())"
   ```

### LiveKit Issues

If voice rooms fail:
1. Verify LiveKit credentials are correct
2. Test LiveKit endpoint: `curl https://your-livekit-server.livekit.cloud`

### Viewing Logs

```bash
# Real-time logs
fly logs --app demedia-back-end

# Last 200 lines
fly logs --app demedia-back-end -a 200
```

## Updating the App

When you make code changes:

```bash
# Commit changes
git add .
git commit -m "Update backend"

# Deploy
fly deploy --app demedia-back-end
```

## Custom Domain (Optional)

To use your own domain:

```bash
# Add certificate
fly certs add yourdomain.com --app demedia-back-end

# Get DNS instructions
fly certs show yourdomain.com --app demedia-back-end
```

## Cost Optimization

- **Free tier**: 3 shared-cpu-1x VMs with 256MB RAM (should be enough for small apps)
- **Auto-stop**: Machines automatically stop when idle and start on request
- **Monitor usage**: `fly dashboard demedia-back-end`

## Security Notes

1. ✅ Never commit `.env` file to git
2. ✅ Use strong random secrets (32+ characters)
3. ✅ Rotate secrets periodically
4. ✅ Enable HTTPS only (already configured)
5. ✅ Use production database with SSL
6. ✅ Set `NODE_ENV=production`
7. ✅ Configure CORS_ORIGINS with your actual domains

## Database Migrations

The app runs `prisma migrate deploy` automatically on startup (configured in fly.toml).

To create new migrations locally:

```bash
# Create migration
npx prisma migrate dev --name your_migration_name

# Deploy will happen automatically on next fly deploy
```

## Monitoring

View metrics at: https://fly.io/apps/demedia-back-end/monitoring

Track:
- Response times
- Error rates
- Memory usage
- CPU usage
- Network traffic

## Support

- Fly.io Docs: https://fly.io/docs/
- Fly.io Community: https://community.fly.io/
- Your app dashboard: https://fly.io/apps/demedia-back-end
