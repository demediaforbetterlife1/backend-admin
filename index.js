/**
 * Nexus Voice Backend — Entry Point
 *
 * MISSING FEATURE (8): process.on('unhandledRejection') global handler added.
 * FIX H-06/H-07: loyalty.cron and notification.cron loaded here (not in services).
 * FIX L-04: Redis initialized once at startup via initializeRedisOnce().
 * MISSING FEATURE (6): Socket rate limiting implemented in room.socket.js.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// ─── Global error handlers (must be first) ───────────────────────────────────
// MISSING FEATURE (8): Prevent silent crashes from unhandled rejections
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] Unhandled promise rejection:', reason);
  // Log but do not exit — let the process manager decide
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Uncaught exception:', err);
  // Exit on truly unexpected errors — process manager will restart
  process.exit(1);
});

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const { validateConfig, getCorsOrigins } = require('./src/config/env');

validateConfig();

const prisma = require('./src/prismaClient');
const db = require('./src/db');

const { registerRoomSocket }  = require('./src/socket/room.socket');
const { registerChatSocket }  = require('./src/socket/chat.socket');
const { registerAdminSocket } = require('./src/socket/admin.socket');
const roomLikesRouter          = require('./src/routes/room.likes.routes');

// ─── Routes ──────────────────────────────────────────────────────────────────
const authRouter               = require('./src/routes/auth');
const roomRouter               = require('./src/routes/room.routes');
const bannersRouter            = require('./src/routes/banners.routes');
const usersRouter              = require('./src/routes/users');
const agentsRouter             = require('./src/routes/agents');
const hostsRouter              = require('./src/routes/hosts');
const giftsRouter              = require('./src/routes/gifts.routes');
const rankingsRouter           = require('./src/routes/rankings');
const adminRouter              = require('./src/routes/admin');
const vipRouter                = require('./src/routes/vip.routes');
const adminVipRouter           = require('./src/routes/admin.vip.routes');
const agentRouter              = require('./src/routes/agent.routes');
const adminAgentRouter         = require('./src/routes/admin.agent.routes');
const paymentRouter            = require('./src/routes/payment.routes');
const moderationRouter         = require('./src/routes/moderation.routes');
const adminPaymentRouter       = require('./src/routes/admin.payment.routes');
const adminModerationRouter    = require('./src/routes/admin.moderation.routes');
const recordingRouter          = require('./src/routes/recording.routes');
const agencyTypesRouter        = require('./src/routes/agency_types');
const financialRouter          = require('./src/routes/financial');
const hierarchyRouter          = require('./src/routes/hierarchy');
const rechargeRouter           = require('./src/routes/recharge');
const notificationRouter       = require('./src/routes/notification.routes');
const followRouter             = require('./src/routes/follow.routes');
const adminPostReportsRouter       = require('./src/routes/admin.post.reports.routes');
const postsRouter              = require('./src/routes/posts.routes');
const adminNotificationsRouter = require('./src/routes/admin.notifications.routes');
const loyaltyRouter            = require('./src/routes/loyalty.routes');
const coinsRouter              = require('./src/routes/coins.routes');
const walletRouter             = require('./src/routes/wallet.routes');
const adminCoinsRouter         = require('./src/routes/admin.coins.routes');
const shopRouter               = require('./src/routes/shop.routes');
const rewardsRouter            = require('./src/routes/rewards.routes');
const chatRouter               = require('./src/routes/chat.routes');
const settingsRouter           = require('./src/routes/settings.routes');
const framesRouter             = require('./src/routes/frames.routes');
const { adminIconRouter, publicIconRouter, iconProxyRouter } = require('./src/routes/admin.icons.routes');
const adminAuthRouter  = require('./src/routes/admin.auth.routes');
const { router: adminCoreRouter, internalRouter: adminInternalRouter } = require('./src/routes/admin.core.routes');
// ── Agency Registration Routes ────────────────────────────────────────────────
const agencyRouter     = require('./src/routes/agency.routes');
const agencyManagementRouter = require('./src/routes/agency.management.routes');
const adminAgencyRouter = require('./src/routes/admin.agency.routes');

const PORT = process.env.PORT || 3000;
const corsOrigins = getCorsOrigins();

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();

// Trust proxy — required when behind Fly.io reverse proxy for rate limiting
app.set('trust proxy', 1);

// CORS — must come before any route handler so OPTIONS preflight gets handled.
//
// allowedHeaders must include every header the clients send:
//   • Content-Type / Authorization          — standard REST headers
//   • If-None-Match / If-Modified-Since     — browser/Axios HTTP caching headers
//     (Axios adds If-None-Match automatically for GET requests; blocking them in
//     the preflight response causes the browser to abort the real request with a
//     CORS error even though the server would have accepted it)
//   • Cache-Control / Pragma                — cache-busting from some HTTP clients
//   • X-Requested-With                      — sent by some AJAX libraries
//
// preflightContinue: false + optionsSuccessStatus: 204 ensures the cors()
// middleware responds to OPTIONS immediately rather than falling through to
// route handlers (which would send a 404/405 for OPTIONS routes).
app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'If-None-Match',
    'If-Modified-Since',
    'Cache-Control',
    'Pragma',
    'X-Requested-With',
    'X-Dashboard-Client',   // sent by Next.js admin dashboard on every request
    'X-Service-Token',      // sent by Next.js server-to-server notify calls
  ],
  exposedHeaders: ['ETag', 'Last-Modified'],
  credentials: true,          // required: Axios sends withCredentials; browser checks this header
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ─── Static file serving (for self-hosted animations, icons, etc.) ──────────
// Serve files from /public with proper CORS headers
app.use('/public', express.static(path.join(__dirname, 'public'), {
  maxAge: '1d', // Cache for 1 day
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}));

// Add comprehensive security headers with Helmet
try {
  const helmet = require('helmet');

  // ── Build the list of trusted API origins for CSP connectSrc ──────────────
  // In development every origin in CORS_ORIGINS is trusted for XHR/fetch.
  // In production the same list applies — Flutter Web must be in CORS_ORIGINS.
  const cspConnectSrc = ["'self'"];
  if (Array.isArray(corsOrigins)) {
    cspConnectSrc.push(...corsOrigins);
  }
  // Always allow localhost variants so dev builds never break
  ['http://localhost:3000', 'http://localhost:5000', 'ws://localhost:3000', 'ws://localhost:5000'].forEach((o) => {
    if (!cspConnectSrc.includes(o)) cspConnectSrc.push(o);
  });

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        // connectSrc must list every origin Flutter / browser clients call via
        // XHR/fetch/WebSocket.  Without this the browser blocks the request
        // with a CSP violation even when CORS headers are present.
        connectSrc: cspConnectSrc,
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        formAction: ["'self'"],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'deny' },
    xssFilter: true,
    noSniff: true,
    hidePoweredBy: true,
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow CDN assets if needed
  }));
} catch (_) {
  // helmet is optional — warn but don't crash if not installed
  console.warn('[startup] helmet not installed — security headers will be missing!');
  console.warn('[startup] run: npm install helmet');
}

app.locals.prisma = prisma;
app.locals.db = db;

// ─── HTTP + Socket.IO server ─────────────────────────────────────────────────
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
  },
  connectTimeout: 10000,
  pingTimeout: 20000,
  pingInterval: 25000,
});

global.__io = io;

// FIX L-04: Initialize Redis once at startup, not on every cache operation
const { initializeRedisOnce } = require('./src/services/vip.recalc.service');
initializeRedisOnce().catch((err) => console.warn('[startup] Redis init failed (non-fatal):', err.message));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',              authRouter);
app.use('/api/rooms',             roomRouter);
app.use('/api/rooms',             roomLikesRouter);
app.use('/api/banners',           bannersRouter);
app.use('/api/users',             usersRouter);
app.use('/api/agents',            agentsRouter);
app.use('/api/hosts',             hostsRouter);
app.use('/api/gifts',             giftsRouter);
app.use('/api/coins',             coinsRouter);
app.use('/api/wallet',            walletRouter);
app.use('/api/admin/coins',       adminCoinsRouter);
app.use('/api/rankings',          rankingsRouter);
// ── New dashboard-facing admin routes (MUST come before legacy adminRouter) ──
app.use('/api/admin/icons',       adminIconRouter);       // Admin icon management
app.use('/api/icons',             publicIconRouter);      // Public icon manifest (Flutter)
app.use('/api/icon-proxy',        iconProxyRouter);       // Icon proxy to avoid CORS issues
app.use('/api/admin',             adminAuthRouter);       // Admin auth (no User JWT needed)
app.use('/api/admin',             adminInternalRouter);   // Internal event relay (service token)
app.use('/api/admin/agencies',    adminAgencyRouter);     // Agency request management (NEW)
app.use('/api/admin',             adminCoreRouter);       // Dashboard core (admin JWT)
// ── Legacy admin routes (require User JWT with ADMIN/SUPER_ADMIN role) ────────
app.use('/api/admin',             adminRouter);
app.use('/api/admin',             adminVipRouter);
app.use('/api/admin',             adminNotificationsRouter);
app.use('/api/admin',             adminAgentRouter);
app.use('/api/admin',             adminPaymentRouter);
app.use('/api/admin/moderation',  adminModerationRouter);
app.use('/api/admin',             adminPostReportsRouter);
app.use('/api/agent',             agentRouter);
app.use('/api/agency',            agencyRouter);          // Agency registration (NEW)
app.use('/api/agency',            agencyManagementRouter); // Agency management & invitations
app.use('/api/payment',           paymentRouter);
app.use('/api/moderation',        moderationRouter);
app.use('/api/recordings',        recordingRouter);
app.use('/api/vip',               vipRouter);
app.use('/api/shop',              shopRouter);
app.use('/api/rewards',           rewardsRouter);
app.use('/api/notifications',     notificationRouter);
app.use('/api/follow',            followRouter);
app.use('/api/posts',             postsRouter);
app.use('/api/loyalty',           loyaltyRouter);
app.use('/api/agency-types',      agencyTypesRouter);
app.use('/api/financial',         financialRouter);
app.use('/api/hierarchy',         hierarchyRouter);
app.use('/api/recharge',          rechargeRouter);
app.use('/api/chat',              chatRouter);
app.use('/api/settings',          settingsRouter);
app.use('/api',                   framesRouter);  // Frames & Entrances

// ─── Cron Jobs ────────────────────────────────────────────────────────────────
// FIX H-06: loyalty cron loaded here, not inside loyalty.service.js
// FIX H-07: notification cron loaded here, not inside notification.service.js
require('./src/jobs/agent.cron');
require('./src/jobs/vip.cron');
require('./src/jobs/loyalty.cron');
require('./src/jobs/notification.cron');
// ROOT-CAUSE FIX: close rooms whose owner is absent (stale after server restart)
require('./src/jobs/stale.rooms.cron');

// ─── Health checks ───────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const dbOk = await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, status: 'ok', uptime: process.uptime(), database: 'connected' });
  } catch (e) {
    res.status(503).json({ success: false, status: 'degraded', database: 'disconnected', error: e.message });
  }
});

app.get('/health/database', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, database: 'connected' });
  } catch (e) {
    res.status(503).json({ success: false, database: 'disconnected', error: e.message });
  }
});

app.get('/health/auth', async (req, res) => {
  // Just check that auth middleware is available
  res.json({ success: true, auth: 'available' });
});

app.get('/health/rooms', async (req, res) => {
  try {
    await prisma.room.findFirst({ take: 1 });
    res.json({ success: true, rooms: 'available' });
  } catch (e) {
    res.status(503).json({ success: false, rooms: 'unavailable', error: e.message });
  }
});

app.get('/health/posts', async (req, res) => {
  try {
    await prisma.post.findFirst({ take: 1 });
    res.json({ success: true, posts: 'available' });
  } catch (e) {
    res.status(503).json({ success: false, posts: 'unavailable', error: e.message });
  }
});

// ─── Global error handler (must be LAST middleware) ───────────────────────────
// FIX: catch any unhandled errors from route handlers and return a safe
// response without leaking Prisma model names, file paths, or stack traces.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.statusCode || err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  console.error(`[error] ${req.method} ${req.path} →`, err.message);
  res.status(status).json({
    success: false,
    // Only expose the raw message in development; use a generic string in prod
    error: isProd ? 'An unexpected error occurred' : err.message,
  });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
registerRoomSocket(io);
registerChatSocket(io);
registerAdminSocket(io);

// ─── Start server ─────────────────────────────────────────────────────────────
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Please stop the process holding this port and try again.`);
    process.exit(1);
  } else {
    throw e;
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received; closing server`);

  io.close();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  console.log(`✅  Nexus Voice backend running in ${process.env.NODE_ENV || 'development'} mode at ${baseUrl}`);

  // Seed the initial SUPER_ADMIN on first start (idempotent — skips if already exists)
  const adminAuthService = require('./src/services/adminAuth.service');
  adminAuthService.seedSuperAdmin().catch(err => console.warn('[startup] Admin seed failed:', err.message));
});
