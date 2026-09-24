/**
 * Admin Icon Management Routes
 *
 * Provides full CRUD, publish, restore, rollback, and version-history for the
 * dynamic icon system. Every endpoint is protected by `authenticate` +
 * `requireRole('ADMIN', 'SUPER_ADMIN')`.
 *
 * Storage:  Cloudinary (folder: icons/<category>)
 * Upload:   multipart/form-data via multer (memory storage)
 * Limits:   configurable via env MAX_ICON_SIZE_BYTES (default 2 MB)
 *
 * Routes:
 *   GET    /admin/icons               — list all icons (paginatable, filterable)
 *   GET    /admin/icons/:id           — get single icon + version history
 *   POST   /admin/icons/upload        — upload / replace an icon
 *   PUT    /admin/icons/:id           — update metadata (displayName, category)
 *   DELETE /admin/icons/:id           — soft-delete (marks inactive)
 *   POST   /admin/icons/publish       — publish all pending changes
 *   POST   /admin/icons/restore/:id   — restore default icon for one key
 *   POST   /admin/icons/revert/:id    — rollback to a specific previous version
 */

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { authenticateAdmin, requireAdmin } = require('../middleware/adminAuthMiddleware');
const prisma = require('../prismaClient');
const cloudinary = require('../config/cloudinary.config');

const router = express.Router();

// ─── Auth guard applied to every route in this file ──────────────────────────
router.use(authenticateAdmin, requireAdmin);

// ─── Multer — in-memory storage, validation happens before upload ─────────────
const MAX_SIZE = parseInt(process.env.MAX_ICON_SIZE_BYTES ?? '2097152', 10); // 2 MB default

const ALLOWED_MIME = new Set([
  'image/png',
  'image/svg+xml',
  'image/webp',
  'image/jpeg',
  'image/jpg',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      return cb(null, true);
    }
    return cb(
      Object.assign(new Error(`Unsupported mime type: ${file.mimetype}. Allowed: PNG, SVG, WEBP, JPG`), { status: 415 }),
    );
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Upload a buffer to Cloudinary and return { url, storagePath }. */
async function uploadToCloudinary(buffer, mimeType, publicIdPrefix) {
  return new Promise((resolve, reject) => {
    const ext = mimeType === 'image/svg+xml' ? 'svg' : mimeType.split('/')[1];
    const uploadOptions = {
      folder: `icons/${publicIdPrefix}`,
      resource_type: 'image',
      format: ext === 'svg' ? 'svg' : ext,
      transformation:
        ext !== 'svg'
          ? [{ quality: 'auto:good', fetch_format: 'auto' }]
          : undefined,
    };

    const stream = cloudinary.uploader.upload_stream(uploadOptions, (err, result) => {
      if (err) return reject(err);
      resolve({
        url: result.secure_url,
        storagePath: result.public_id,
        width: result.width ?? null,
        height: result.height ?? null,
        size: result.bytes ?? null,
      });
    });
    stream.end(buffer);
  });
}

/** Delete a file from Cloudinary by its public_id. */
async function deleteFromCloudinary(storagePath) {
  try {
    await cloudinary.uploader.destroy(storagePath, { resource_type: 'image' });
  } catch (err) {
    console.warn(`[icons] Cloudinary delete failed for ${storagePath}:`, err.message);
  }
}

/** Generate an ETag from buffer content. */
function generateEtag(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/** Write an audit log entry. */
async function auditLog(tx, { iconId, adminId, action, oldVersion, newVersion, oldUrl, newUrl, req }) {
  await tx.iconAuditLog.create({
    data: {
      iconId,
      adminId: adminId ?? null,
      action,
      oldVersion: oldVersion ?? null,
      newVersion: newVersion ?? null,
      oldUrl: oldUrl ?? null,
      newUrl: newUrl ?? null,
      ipAddress: req?.ip ?? null,
      userAgent: req?.headers?.['user-agent'] ?? null,
    },
  });
}

// ─── Icon category map (key prefix → category enum) ──────────────────────────
const CATEGORY_MAP = {
  nav_: 'NAVIGATION',
  room_: 'ROOM',
  voice_: 'VOICE',
  social_: 'SOCIAL',
  wallet_: 'WALLET',
  vip_: 'VIP',
  media_: 'MEDIA',
  status_: 'STATUS',
  settings_: 'SETTINGS',
  admin_: 'ADMIN',
  action_: 'ACTIONS',
  store_: 'STORE',
};

function inferCategory(key) {
  for (const [prefix, cat] of Object.entries(CATEGORY_MAP)) {
    if (key.startsWith(prefix)) return cat;
  }
  return 'ACTIONS';
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/icons
// List all icons. Supports ?category=&search=&page=&limit=&pendingOnly=
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { category, search, pendingOnly, page = '1', limit = '50' } = req.query;

    const take = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (Math.max(1, parseInt(page, 10)) - 1) * take;

    const where = { isActive: true };
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { key: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (pendingOnly === 'true') where.isPending = true;

    const [icons, total] = await Promise.all([
      prisma.appIcon.findMany({
        where,
        orderBy: [{ category: 'asc' }, { displayName: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          key: true,
          category: true,
          displayName: true,
          url: true,
          defaultUrl: true,
          mimeType: true,
          width: true,
          height: true,
          size: true,
          version: true,
          isActive: true,
          isPublished: true,
          isPending: true,
          etag: true,
          createdById: true,
          updatedById: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.appIcon.count({ where }),
    ]);

    return res.json({
      success: true,
      data: icons,
      pagination: {
        page: parseInt(page, 10),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error('[icons] GET / error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/icons/:id
// Get a single icon with full version history and audit log.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const icon = await prisma.appIcon.findUnique({
      where: { id: req.params.id },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 20,
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!icon) return res.status(404).json({ success: false, error: 'Icon not found' });

    return res.json({ success: true, data: icon });
  } catch (err) {
    console.error('[icons] GET /:id error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/icons/upload
// Upload a new icon or replace an existing one by key.
// Body (multipart): file (required), key (required), displayName, category,
//                   defaultUrl (required on first upload)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { key, displayName, category, defaultUrl } = req.body;

    if (!key || typeof key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(key)) {
      return res.status(400).json({
        success: false,
        error: 'key is required and must be lowercase alphanumeric with underscores',
      });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'file is required' });
    }

    const { buffer, mimetype } = req.file;
    const resolvedCategory = category ?? inferCategory(key);
    const etag = generateEtag(buffer);
    const existing = await prisma.appIcon.findUnique({ where: { key } });

    // Validate category enum
    const validCategories = ['NAVIGATION', 'ROOM', 'VOICE', 'SOCIAL', 'WALLET', 'VIP', 'MEDIA', 'STATUS', 'SETTINGS', 'ADMIN', 'ACTIONS', 'STORE'];
    if (!validCategories.includes(resolvedCategory)) {
      return res.status(400).json({ success: false, error: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
    }

    if (!existing && !defaultUrl) {
      return res.status(400).json({ success: false, error: 'defaultUrl is required for new icons' });
    }

    // Upload to Cloudinary
    const uploaded = await uploadToCloudinary(buffer, mimetype, resolvedCategory.toLowerCase());

    if (existing) {
      // Replace: snapshot current version first
      const result = await prisma.$transaction(async (tx) => {
        // Save old version to history
        await tx.iconVersion.create({
          data: {
            iconId: existing.id,
            version: existing.version,
            url: existing.url,
            storagePath: existing.storagePath,
            mimeType: existing.mimeType,
            width: existing.width,
            height: existing.height,
            size: existing.size,
            uploadedById: existing.updatedById,
          },
        });

        // Update the icon record (mark pending until published)
        const updated = await tx.appIcon.update({
          where: { id: existing.id },
          data: {
            url: uploaded.url,
            storagePath: uploaded.storagePath,
            mimeType: mimetype,
            width: uploaded.width,
            height: uploaded.height,
            size: uploaded.size,
            version: existing.version + 1,
            etag,
            displayName: displayName ?? existing.displayName,
            category: resolvedCategory,
            isPending: true,
            isPublished: false,
            updatedById: req.admin.id,
          },
        });

        await auditLog(tx, {
          iconId: existing.id,
          adminId: req.admin.id,
          action: 'REPLACE',
          oldVersion: existing.version,
          newVersion: existing.version + 1,
          oldUrl: existing.url,
          newUrl: uploaded.url,
          req,
        });

        return updated;
      });

      return res.json({ success: true, data: result, message: 'Icon replaced — publish to make it live' });
    } else {
      // New icon
      const result = await prisma.$transaction(async (tx) => {
        const created = await tx.appIcon.create({
          data: {
            key,
            category: resolvedCategory,
            displayName: displayName ?? key,
            url: uploaded.url,
            storagePath: uploaded.storagePath,
            mimeType: mimetype,
            width: uploaded.width,
            height: uploaded.height,
            size: uploaded.size,
            version: 1,
            etag,
            defaultUrl: defaultUrl ?? uploaded.url,
            isActive: true,
            isPublished: false,
            isPending: true,
            createdById: req.admin.id,
            updatedById: req.admin.id,
          },
        });

        await auditLog(tx, {
          iconId: created.id,
          adminId: req.admin.id,
          action: 'UPLOAD',
          oldVersion: null,
          newVersion: 1,
          oldUrl: null,
          newUrl: uploaded.url,
          req,
        });

        return created;
      });

      return res.status(201).json({ success: true, data: result, message: 'Icon created — publish to make it live' });
    }
  } catch (err) {
    console.error('[icons] POST /upload error:', err.message);
    if (err.message?.includes('file too large')) {
      return res.status(413).json({ success: false, error: `File exceeds maximum size of ${MAX_SIZE} bytes` });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /admin/icons/:id
// Update metadata only (displayName, category). Does NOT change the image URL.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { displayName, category } = req.body;

    const existing = await prisma.appIcon.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Icon not found' });

    const validCategories = ['NAVIGATION', 'ROOM', 'VOICE', 'SOCIAL', 'WALLET', 'VIP', 'MEDIA', 'STATUS', 'SETTINGS', 'ADMIN', 'ACTIONS', 'STORE'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({ success: false, error: `Invalid category` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.appIcon.update({
        where: { id: req.params.id },
        data: {
          ...(displayName ? { displayName } : {}),
          ...(category ? { category } : {}),
          updatedById: req.admin.id,
          isPending: true,
        },
      });

      await auditLog(tx, {
        iconId: existing.id,
        adminId: req.admin.id,
        action: 'REPLACE',
        oldVersion: existing.version,
        newVersion: existing.version,
        oldUrl: existing.url,
        newUrl: existing.url,
        req,
      });

      return u;
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[icons] PUT /:id error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /admin/icons/:id
// Soft-delete: marks isActive=false, does NOT delete from Cloudinary.
// The default URL is preserved so the app can fall back to it.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.appIcon.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Icon not found' });

    await prisma.$transaction(async (tx) => {
      await tx.appIcon.update({
        where: { id: req.params.id },
        data: {
          isActive: false,
          isPending: false,
          updatedById: req.admin.id,
        },
      });

      await auditLog(tx, {
        iconId: existing.id,
        adminId: req.admin.id,
        action: 'DELETE',
        oldVersion: existing.version,
        newVersion: existing.version,
        oldUrl: existing.url,
        newUrl: null,
        req,
      });
    });

    return res.json({ success: true, message: 'Icon deleted' });
  } catch (err) {
    console.error('[icons] DELETE /:id error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/icons/publish
// Publish all pending icons. Clients will get new URLs on next fetch.
// Body: { iconIds?: string[] }  — if omitted, publishes ALL pending icons.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/publish', async (req, res) => {
  try {
    const { iconIds } = req.body;
    const where = iconIds?.length
      ? { id: { in: iconIds }, isPending: true }
      : { isPending: true };

    const pending = await prisma.appIcon.findMany({ where });
    if (!pending.length) {
      return res.json({ success: true, data: { published: 0 }, message: 'No pending changes to publish' });
    }

    const publishedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.appIcon.updateMany({
        where,
        data: {
          isPublished: true,
          isPending: false,
          publishedAt,
          updatedById: req.admin.id,
        },
      });

      for (const icon of pending) {
        await auditLog(tx, {
          iconId: icon.id,
          adminId: req.admin.id,
          action: 'PUBLISH',
          oldVersion: icon.version,
          newVersion: icon.version,
          oldUrl: icon.url,
          newUrl: icon.url,
          req,
        });
      }
    });

    return res.json({
      success: true,
      data: { published: pending.length, publishedAt },
      message: `${pending.length} icon(s) published`,
    });
  } catch (err) {
    console.error('[icons] POST /publish error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/icons/restore/:id
// Restore an icon to its default (factory) state.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/restore/:id', async (req, res) => {
  try {
    const existing = await prisma.appIcon.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Icon not found' });

    const oldUrl = existing.url;
    const oldVersion = existing.version;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.appIcon.update({
        where: { id: req.params.id },
        data: {
          url: existing.defaultUrl,
          storagePath: '',
          isPending: false,
          isPublished: true,
          isActive: true,
          version: existing.version + 1,
          updatedById: req.admin.id,
          publishedAt: new Date(),
        },
      });

      await auditLog(tx, {
        iconId: existing.id,
        adminId: req.admin.id,
        action: 'REVERT_TO_DEFAULT',
        oldVersion,
        newVersion: u.version,
        oldUrl,
        newUrl: existing.defaultUrl,
        req,
      });

      return u;
    });

    return res.json({ success: true, data: updated, message: 'Icon restored to default' });
  } catch (err) {
    console.error('[icons] POST /restore/:id error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/icons/revert/:id
// Rollback to a specific previous version.
// Body: { versionId: string }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/revert/:id', async (req, res) => {
  try {
    const { versionId } = req.body;
    if (!versionId) {
      return res.status(400).json({ success: false, error: 'versionId is required' });
    }

    const [icon, targetVersion] = await Promise.all([
      prisma.appIcon.findUnique({ where: { id: req.params.id } }),
      prisma.iconVersion.findUnique({ where: { id: versionId } }),
    ]);

    if (!icon) return res.status(404).json({ success: false, error: 'Icon not found' });
    if (!targetVersion || targetVersion.iconId !== icon.id) {
      return res.status(404).json({ success: false, error: 'Version not found for this icon' });
    }

    const oldUrl = icon.url;
    const oldVersion = icon.version;

    const updated = await prisma.$transaction(async (tx) => {
      // Snapshot current before rollback
      await tx.iconVersion.create({
        data: {
          iconId: icon.id,
          version: icon.version,
          url: icon.url,
          storagePath: icon.storagePath,
          mimeType: icon.mimeType,
          width: icon.width,
          height: icon.height,
          size: icon.size,
          uploadedById: icon.updatedById,
        },
      });

      const u = await tx.appIcon.update({
        where: { id: icon.id },
        data: {
          url: targetVersion.url,
          storagePath: targetVersion.storagePath,
          mimeType: targetVersion.mimeType,
          width: targetVersion.width,
          height: targetVersion.height,
          size: targetVersion.size,
          version: icon.version + 1,
          isPending: true,
          isPublished: false,
          updatedById: req.admin.id,
        },
      });

      await auditLog(tx, {
        iconId: icon.id,
        adminId: req.admin.id,
        action: 'ROLLBACK',
        oldVersion,
        newVersion: u.version,
        oldUrl,
        newUrl: targetVersion.url,
        req,
      });

      return u;
    });

    return res.json({ success: true, data: updated, message: 'Icon reverted — publish to make it live' });
  } catch (err) {
    console.error('[icons] POST /revert/:id error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Public endpoint (no admin guard): GET /api/icons
// Flutter app fetches published icons without admin auth.
// Supports ETag-based cache validation.
// ─────────────────────────────────────────────────────────────────────────────
const publicIconRouter = express.Router();

publicIconRouter.get('/', async (req, res) => {
  try {
    // Simplified: Use local database as single source of truth
    const icons = await prisma.appIcon.findMany({
      where: { 
        isActive: true, 
        isPublished: true 
      },
      select: { 
        id: true,
        key: true, 
        category: true,
        displayName: true,
        url: true, 
        mimeType: true,
        version: true,
        updatedAt: true,
      },
    });

    // Generate simple ETag based on latest update timestamp
    const latestUpdate = icons.length > 0 
      ? new Date(Math.max(...icons.map(i => new Date(i.updatedAt).getTime())))
      : new Date();
    const manifestEtag = latestUpdate.getTime().toString();

    // Handle ETag conditional request BEFORE building manifest
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === `"${manifestEtag}"`) {
      return res.status(304).end();
    }

    // Build simplified manifest with single canonical URL
    const manifest = {};
    icons.forEach(icon => {
      manifest[icon.key] = {
        id: icon.id,
        key: icon.key,
        category: icon.category,
        displayName: icon.displayName,
        url: icon.url, // Single canonical URL
        mimeType: icon.mimeType,
        version: icon.version,
        updatedAt: icon.updatedAt,
      };
    });

    res.setHeader('ETag', `"${manifestEtag}"`);
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');

    return res.json({ success: true, data: manifest, etag: manifestEtag });
  } catch (err) {
    console.error('[public-icons] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Icon Proxy Endpoint: GET /api/icon-proxy/:filename
// Proxies icon requests from client to avoid CORS issues with admin dashboard
// ─────────────────────────────────────────────────────────────────────────────
const iconProxyRouter = express.Router();

iconProxyRouter.get('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Security: validate filename (no path traversal)
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ success: false, error: 'Invalid filename' });
    }

    // Construct URL to admin dashboard
    const adminDashboardUrl = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3001';
    const iconUrl = `${adminDashboardUrl}/icons/${filename}`;
    
    debugPrint(`[icon-proxy] Proxying: ${iconUrl}`);

    // Fetch from admin dashboard
    const https = iconUrl.startsWith('https') ? require('https') : require('http');
    const urlParsed = new URL(iconUrl);
    
    const proxyReq = https.get({
      hostname: urlParsed.hostname,
      port: urlParsed.port,
      path: urlParsed.pathname,
      timeout: 5000,
    }, (proxyRes) => {
      // Forward status and headers
      res.status(proxyRes.statusCode);
      res.set('Content-Type', proxyRes.headers['content-type'] || 'image/png');
      res.set('Cache-Control', 'public, max-age=3600');
      res.set('Access-Control-Allow-Origin', '*');
      
      // Pipe response
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[icon-proxy] Error fetching ${iconUrl}:`, err.message);
      res.status(502).json({ success: false, error: 'Failed to fetch icon' });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.status(504).json({ success: false, error: 'Icon fetch timeout' });
    });

  } catch (err) {
    console.error('[icon-proxy] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

function debugPrint(msg) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(msg);
  }
}

module.exports = { adminIconRouter: router, publicIconRouter, iconProxyRouter };
