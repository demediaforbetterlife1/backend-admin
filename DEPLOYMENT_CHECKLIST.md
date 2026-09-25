# 📋 Deployment Checklist

Use this checklist to ensure a successful deployment.

## Pre-Deployment

### 1. Prerequisites Installed
- [ ] Fly CLI installed (`fly version` works)
- [ ] Logged in to Fly.io (`fly auth whoami` works)
- [ ] Node.js installed (for generating secrets)

### 2. Database Ready
- [ ] PostgreSQL database created (Neon, Supabase, or Fly Postgres)
- [ ] Database connection string obtained
- [ ] Database accessible from internet
- [ ] SSL mode enabled (`?sslmode=require` in connection string)

### 3. LiveKit Ready
- [ ] LiveKit account created (https://livekit.io)
- [ ] LiveKit server URL obtained (wss://...)
- [ ] LiveKit API key obtained
- [ ] LiveKit API secret obtained
- [ ] LiveKit server tested and accessible

### 4. Other Services (Optional)
- [ ] Twilio account (for SMS/OTP)
- [ ] Cloudinary account (for uploads)
- [ ] Firebase project (for push notifications)
- [ ] OAuth apps created (Google, Facebook, Apple)

## Secrets Configuration

### Critical Secrets (REQUIRED)
- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `JWT_SECRET` - Random 32+ character string
- [ ] `JWT_REFRESH_SECRET` - Random 32+ character string
- [ ] `LIVEKIT_URL` - LiveKit WebSocket URL
- [ ] `LIVEKIT_API_KEY` - LiveKit API key
- [ ] `LIVEKIT_API_SECRET` - LiveKit API secret

### Admin Dashboard Secrets (REQUIRED)
- [ ] `ADMIN_SEED_EMAIL` - Admin email
- [ ] `ADMIN_SEED_PASSWORD` - Admin password (8+ chars)
- [ ] `ADMIN_SEED_NAME` - Admin display name
- [ ] `INTERNAL_SERVICE_TOKEN` - Random 32+ character string

### Application Secrets (RECOMMENDED)
- [ ] `NODE_ENV` - Set to "production"
- [ ] `APP_URL` - https://demedia-back-end.fly.dev
- [ ] `CORS_ORIGINS` - Your frontend URLs (comma-separated)
- [ ] `APP_NAME` - Your app name

### Optional Service Secrets
- [ ] `TWILIO_ACCOUNT_SID` - Twilio Account SID
- [ ] `TWILIO_AUTH_TOKEN` - Twilio Auth Token
- [ ] `TWILIO_PHONE_NUMBER` - Twilio phone number
- [ ] `GOOGLE_CLIENT_ID` - Google OAuth Client ID
- [ ] `GOOGLE_CLIENT_SECRET` - Google OAuth Client Secret
- [ ] `FACEBOOK_APP_ID` - Facebook App ID
- [ ] `FACEBOOK_APP_SECRET` - Facebook App Secret
- [ ] `CLOUDINARY_CLOUD_NAME` - Cloudinary cloud name
- [ ] `CLOUDINARY_API_KEY` - Cloudinary API key
- [ ] `CLOUDINARY_API_SECRET` - Cloudinary API secret
- [ ] `FIREBASE_SERVICE_ACCOUNT` - Firebase service account JSON
- [ ] `REDIS_URL` - Redis connection URL (optional)

## Deployment Steps

### 1. Verify Secrets
```powershell
fly secrets list --app demedia-back-end
```
- [ ] All critical secrets are listed
- [ ] No typos in secret names
- [ ] Values are set (not empty)

### 2. Deploy
```powershell
cd e:\voicechat\voicechat_app\backend
.\deploy.ps1
# OR
fly deploy --app demedia-back-end
```
- [ ] Deployment started successfully
- [ ] Docker build completed
- [ ] Database migrations ran
- [ ] Health check passed

### 3. Verify Deployment
```powershell
# Check status
fly status --app demedia-back-end

# Test health endpoint
curl https://demedia-back-end.fly.dev/health

# View logs
fly logs --app demedia-back-end
```
- [ ] App is running
- [ ] Health endpoint returns 200 OK
- [ ] No errors in logs
- [ ] Database connection successful

## Post-Deployment

### 1. Test Critical Endpoints

#### Health Check
```bash
curl https://demedia-back-end.fly.dev/health
# Expected: {"success":true,"status":"ok"}
```
- [ ] Health endpoint works

#### Database Health
```bash
curl https://demedia-back-end.fly.dev/health/database
# Expected: {"success":true}
```
- [ ] Database connection works

#### Authentication
```bash
curl https://demedia-back-end.fly.dev/health/auth
# Expected: {"success":true,"auth":"available"}
```
- [ ] Auth service is available

### 2. Test Admin Dashboard Login
- [ ] Navigate to admin dashboard
- [ ] Login with `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD`
- [ ] Dashboard loads successfully
- [ ] Can view users, rooms, etc.

### 3. Update Client Apps

#### Flutter App
Update API URL in config:
```dart
const String API_BASE_URL = 'https://demedia-back-end.fly.dev/api';
```
- [ ] API URL updated in Flutter app
- [ ] Flutter app rebuilt
- [ ] Login works
- [ ] Can create rooms
- [ ] Voice rooms work

#### Admin Dashboard
Update `.env.local`:
```bash
NEXT_PUBLIC_API_URL=https://demedia-back-end.fly.dev
INTERNAL_SERVICE_TOKEN=your-token-here
```
- [ ] API URL updated in admin dashboard
- [ ] Dashboard rebuilt
- [ ] Can fetch data from backend
- [ ] Can perform admin actions

### 4. Test Core Features
- [ ] User registration works
- [ ] User login works
- [ ] Phone OTP works (if Twilio configured)
- [ ] Social login works (if OAuth configured)
- [ ] Can create posts
- [ ] Can create rooms
- [ ] Voice rooms work (LiveKit)
- [ ] Can send gifts
- [ ] Can upload images (Cloudinary)
- [ ] Push notifications work (Firebase)

## Monitoring

### Set Up Monitoring
- [ ] Enable Fly.io monitoring: `fly dashboard demedia-back-end`
- [ ] Set up alerts for downtime
- [ ] Monitor error rates
- [ ] Monitor response times
- [ ] Monitor memory usage

### Regular Checks
- [ ] Check logs weekly: `fly logs --app demedia-back-end`
- [ ] Monitor disk usage
- [ ] Check database size
- [ ] Review error logs

## Security Checklist

### Secrets Management
- [ ] All secrets are strong (32+ chars)
- [ ] No secrets in git repository
- [ ] No secrets in logs
- [ ] Secrets rotated periodically (every 90 days)

### Application Security
- [ ] HTTPS enforced (force_https = true)
- [ ] CORS configured with specific origins
- [ ] Rate limiting enabled
- [ ] NODE_ENV set to "production"
- [ ] Database SSL enabled
- [ ] Admin password is strong

### Access Control
- [ ] Admin dashboard requires authentication
- [ ] API requires authentication for protected routes
- [ ] Only authorized IPs can access admin (if applicable)

## Backup & Recovery

### Database Backups
- [ ] Database backups configured
- [ ] Backup schedule set (daily recommended)
- [ ] Test backup restoration

### Application Backups
- [ ] Code is in git repository
- [ ] fly.toml is committed
- [ ] Deployment scripts are committed
- [ ] .env.example is up to date

## Performance Optimization

### Scaling
- [ ] Monitor concurrent connections
- [ ] Scale machines if needed: `fly scale count 2`
- [ ] Scale memory if needed: `fly scale memory 512`

### Caching
- [ ] Redis configured (optional)
- [ ] Static assets cached
- [ ] API responses cached where appropriate

## Troubleshooting

### Common Issues

#### App won't start
```powershell
fly logs --app demedia-back-end
# Check for:
# - Missing secrets
# - Database connection errors
# - Port binding issues
```

#### Database connection fails
```powershell
fly ssh console --app demedia-back-end
# Test connection
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$queryRaw\`SELECT 1\`.then(console.log).catch(console.error).finally(()=>p.\$disconnect())"
```

#### Health check fails
```powershell
fly logs --app demedia-back-end | Select-String "health"
# Look for health check errors
```

## Rollback Plan

If deployment fails:

1. **Rollback to previous version**
   ```powershell
   fly releases --app demedia-back-end
   fly releases rollback <version> --app demedia-back-end
   ```

2. **Check logs**
   ```powershell
   fly logs --app demedia-back-end -a 500
   ```

3. **Restore database** (if migrations failed)
   - Restore from backup
   - Run migrations manually

## Success Criteria

✅ Deployment is successful when:
- [ ] App is accessible at https://demedia-back-end.fly.dev
- [ ] Health check returns 200 OK
- [ ] No errors in logs
- [ ] Flutter app can connect and authenticate
- [ ] Admin dashboard can connect
- [ ] Voice rooms work
- [ ] All core features are functional

## Post-Deployment Tasks

- [ ] Update DNS (if using custom domain)
- [ ] Update documentation with new URLs
- [ ] Notify team about deployment
- [ ] Monitor for 24 hours
- [ ] Remove `ADMIN_SEED_PASSWORD` from secrets after first login

---

## Quick Command Reference

```powershell
# Deploy
fly deploy --app demedia-back-end

# View status
fly status --app demedia-back-end

# View logs
fly logs --app demedia-back-end

# List secrets
fly secrets list --app demedia-back-end

# Set secret
fly secrets set SECRET_NAME="value" --app demedia-back-end

# SSH into machine
fly ssh console --app demedia-back-end

# Restart app
fly apps restart demedia-back-end

# Scale
fly scale count 2 --app demedia-back-end
fly scale memory 512 --app demedia-back-end

# Dashboard
fly dashboard demedia-back-end
```

---

**Ready to deploy? Follow the [Quick Start Guide](DEPLOY_QUICKSTART.md)!**
