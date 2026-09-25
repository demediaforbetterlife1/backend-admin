# 🚀 Backend Deployment to Fly.io

## Quick Summary

Your backend is ready to deploy to Fly.io! I've created all the necessary deployment files and scripts.

## 📁 Created Files

1. **DEPLOY_QUICKSTART.md** - Start here! Quick deployment guide
2. **DEPLOYMENT.md** - Complete documentation with all details
3. **DEPLOYMENT_CHECKLIST.md** - Step-by-step checklist
4. **deploy.ps1** - Automated deployment script
5. **setup-secrets.ps1** - Interactive secrets configuration
6. **fly.toml** - Fly.io configuration (already configured)

## ⚡ Quick Start (3 Minutes)

### 1. Install Fly CLI

```powershell
# Run PowerShell as Administrator
iwr https://fly.io/install.ps1 -useb | iex

# Restart PowerShell, then login
fly auth login
```

### 2. Set Required Secrets

Generate JWT secrets:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set secrets:
```powershell
fly secrets set DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require" --app demedia-back-end
fly secrets set JWT_SECRET="your-32-char-secret" --app demedia-back-end
fly secrets set JWT_REFRESH_SECRET="your-32-char-refresh-secret" --app demedia-back-end
fly secrets set LIVEKIT_URL="wss://your-livekit.livekit.cloud" --app demedia-back-end
fly secrets set LIVEKIT_API_KEY="your-api-key" --app demedia-back-end
fly secrets set LIVEKIT_API_SECRET="your-api-secret" --app demedia-back-end
fly secrets set ADMIN_SEED_EMAIL="admin@yourdomain.com" --app demedia-back-end
fly secrets set ADMIN_SEED_PASSWORD="your-admin-password" --app demedia-back-end
```

### 3. Deploy

```powershell
cd e:\voicechat\voicechat_app\backend
.\deploy.ps1
```

That's it! Your backend will be live at:
**https://demedia-back-end.fly.dev**

## 📋 What You Need

### Required
- PostgreSQL database (Neon, Supabase, or Fly Postgres)
- LiveKit account and credentials (https://livekit.io)
- JWT secrets (generate with Node.js)
- Admin credentials for dashboard

### Optional
- Twilio (for SMS/OTP)
- Cloudinary (for uploads)
- Firebase (for push notifications)
- OAuth apps (Google, Facebook, Apple)

## 📖 Next Steps

1. **Read** [DEPLOY_QUICKSTART.md](DEPLOY_QUICKSTART.md) for detailed instructions
2. **Follow** [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) to ensure nothing is missed
3. **Deploy** using `.\deploy.ps1`
4. **Update** Flutter app with new API URL: `https://demedia-back-end.fly.dev/api`
5. **Update** Admin dashboard with new URL

## 🔧 Configuration

The `fly.toml` file is already configured with:
- ✅ Docker build from Dockerfile
- ✅ Automatic database migrations on deploy
- ✅ Health checks on `/health` endpoint
- ✅ HTTPS enforcement
- ✅ Auto-start/stop for cost savings
- ✅ WebSocket support for Socket.IO

## 🎯 Features

Your deployment includes:
- ✅ Automatic SSL/HTTPS
- ✅ Auto-scaling (starts/stops based on traffic)
- ✅ Database migration on deploy
- ✅ Health monitoring
- ✅ Zero-downtime deploys
- ✅ Logs and metrics
- ✅ SSH access to machines

## 💰 Cost

- **Free tier**: 3 shared VMs with 256MB RAM each
- **Typical cost**: $0-5/month for small to medium apps
- **Auto-stop**: Machines stop when idle to save costs

## 🆘 Need Help?

1. Check [DEPLOYMENT.md](DEPLOYMENT.md) for detailed docs
2. View logs: `fly logs --app demedia-back-end`
3. Fly.io docs: https://fly.io/docs/
4. Community: https://community.fly.io/

## 📝 Important Notes

### After First Deployment
- Test all endpoints work
- Login to admin dashboard with `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD`
- Update Flutter app API URL
- Update Admin dashboard API URL
- Remove `ADMIN_SEED_PASSWORD` from secrets after first login

### Security
- ✅ Use strong secrets (32+ characters)
- ✅ Never commit secrets to git
- ✅ Rotate secrets periodically
- ✅ Enable CORS with specific origins
- ✅ Use production database with SSL

### Monitoring
- Check dashboard: `fly dashboard demedia-back-end`
- View metrics: Response times, errors, memory, CPU
- Set up alerts for downtime

## 🚀 Deployment Commands

```powershell
# Deploy
fly deploy --app demedia-back-end

# View logs
fly logs --app demedia-back-end

# Check status
fly status --app demedia-back-end

# List secrets
fly secrets list --app demedia-back-end

# Restart
fly apps restart demedia-back-end

# Scale
fly scale count 2 --app demedia-back-end

# SSH
fly ssh console --app demedia-back-end

# Dashboard
fly dashboard demedia-back-end
```

---

**Ready to deploy? Open [DEPLOY_QUICKSTART.md](DEPLOY_QUICKSTART.md) and follow the steps!**
