const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const prisma = require('../prismaClient');
const cloudinary = require('../config/cloudinary.config');
const { authenticate } = require('../middleware/authMiddleware');
const notificationService = require('../services/notification.service');
const vipCacheService = require('../services/vip.cache.service');

const router = express.Router();

const VALID_VISIBILITY = ['PUBLIC', 'FOLLOWERS', 'PRIVATE'];
const MAX_MEDIA_PER_POST = 9;
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
const ALLOWED_MIMES = [...ALLOWED_IMAGE_MIMES, ...ALLOWED_VIDEO_MIMES];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const FEED_PAGE_SIZE = 20;
const COMMENTS_PAGE_SIZE = 20;
const VALID_REPORT_REASONS = ['SPAM', 'HARASSMENT', 'HATE_SPEECH', 'VIOLENCE', 'NUDITY', 'MISINFORMATION', 'OTHER'];
const FEED_CACHE_TTL_MS = 30 * 1000;

const createPostLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  handler: (_req, res) => res.status(429).json({ success: false, error: 'Too many posts. Please wait before posting again.' }),
  skip: (req) => ['ADMIN', 'SUPER_ADMIN'].includes(req.user?.role),
});

const likePostLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  handler: (_req, res) => res.status(429).json({ success: false, error: 'Too many likes. Slow down.' }),
});

const commentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  handler: (_req, res) => res.status(429).json({ success: false, error: 'Too many comments. Please wait.' }),
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  handler: (_req, res) => res.status(429).json({ success: false, error: 'Too many uploads. Please wait.' }),
});

const multerStorage = multer.memoryStorage();
const upload = multer({
  storage: multerStorage,
  limits: { fileSize: MAX_VIDEO_BYTES, files: MAX_MEDIA_PER_POST },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

function emitPostEvent(eventName, data) {
  try {
    if (global.__io) global.__io.emit(eventName, data);
  } catch (err) {
    console.warn(`[POST] Socket emit failed for ${eventName}:`, err.message);
  }
}

function parseMediaUrls(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatPost(post, requestingUserId) {
  const likedByMe      = post.likes     ? post.likes.some(l => l.userId === requestingUserId)     : false;
  const bookmarkedByMe = post.bookmarks ? post.bookmarks.some(b => b.userId === requestingUserId) : false;
  return {
    id:           post.id,
    userId:       post.userId,
    username:     post.user?.username    ?? '',
    userAvatar:   post.user?.avatar      ?? null,
    displayName:  post.user?.displayName ?? null,
    content:      post.content,
    mediaUrls:    parseMediaUrls(post.mediaUrls),
    visibility:   post.visibility,
    likesCount:   post._count?.likes    ?? 0,
    commentsCount:post._count?.comments ?? 0,
    viewsCount:   post.viewsCount       ?? 0,
    isLiked:      likedByMe,
    isBookmarked: bookmarkedByMe,
    createdAt:    post.createdAt,
    updatedAt:    post.updatedAt,
  };
}

function formatComment(comment) {
  return {
    id:          comment.id,
    postId:      comment.postId,
    userId:      comment.userId,
    username:    comment.user?.username    ?? '',
    userAvatar:  comment.user?.avatar      ?? null,
    displayName: comment.user?.displayName ?? null,
    content:     comment.content,
    createdAt:   comment.createdAt,
  };
}

const postInclude = (userId) => ({
  user:      { select: { id: true, username: true, avatar: true, displayName: true } },
  _count:    { select: { likes: true, comments: true } },
  likes:     { where: { userId }, select: { userId: true } },
  bookmarks: { where: { userId }, select: { userId: true } },
});

const feedCache = new Map();

function getFeedCache(key) {
  const entry = feedCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    feedCache.delete(key);
    return null;
  }
  return entry.value;
}

function setFeedCache(key, value) {
  feedCache.set(key, { value, expiresAt: Date.now() + FEED_CACHE_TTL_MS });
  if (feedCache.size > 500) {
    const oldest = feedCache.keys().next().value;
    feedCache.delete(oldest);
  }
}

function invalidateFeedCache() {
  feedCache.clear();
}

// ── GET /api/posts/search ──────────────────────────────────────────────────────
router.get('/search', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const q      = String(req.query.q || '').trim();
    const limit  = Math.min(50, parseInt(req.query.limit || '20', 10));

    if (!q) {
      return res.json({ success: true, data: [] });
    }

    console.log('[POST] SEARCH_POSTS', { userId, query: q, limit });

    // Search in post content with case-insensitive partial match
    // Only search PUBLIC posts and FOLLOWERS posts if user follows the author
    const posts = await prisma.post.findMany({
      where: {
        visibility: 'PUBLIC',
        content: { 
          contains: q, 
          mode: 'insensitive' 
        },
      },
      include: postInclude(userId),
      take: limit,
      orderBy: [
        { likes: { _count: 'desc' } }, // Popular posts first
        { createdAt: 'desc' },
      ],
    });

    const formatted = posts.map(p => formatPost(p, userId));
    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('[POST] GET /search error:', err);
    res.status(500).json({ success: false, error: 'Failed to search posts' });
  }
});

// ── GET /api/posts/feed ────────────────────────────────────────────────────────
router.get('/feed', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const tab    = (req.query.type || 'recommend').toLowerCase();
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || FEED_PAGE_SIZE));
    const skip   = (page - 1) * limit;

    if (tab === 'recommend' && page === 1) {
      const cacheKey = `feed:recommend:${limit}`;
      const cached   = getFeedCache(cacheKey);
      if (cached) {
        const personalised = cached.data.map(p => ({
          ...p,
          isLiked:      false,
          isBookmarked: false,
        }));
        return res.json({ success: true, data: personalised, meta: cached.meta, cached: true });
      }
    }

    let where = { visibility: 'PUBLIC' };

    if (tab === 'follow') {
      const following = await prisma.follow.findMany({
        where:  { followerId: userId },
        select: { followingId: true },
      });
      const followingIds = following.map(f => f.followingId);
      if (followingIds.length === 0) {
        return res.json({ success: true, data: [], meta: { page, limit, hasMore: false, total: 0 } });
      }
      where = { userId: { in: followingIds }, visibility: { in: ['PUBLIC', 'FOLLOWERS'] } };
    }

    const orderBy = tab === 'latest'
      ? { createdAt: 'desc' }
      : [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }];

    const [posts, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy, skip, take: limit, include: postInclude(userId) }),
      prisma.post.count({ where }),
    ]);

    const meta = { page, limit, total, hasMore: skip + posts.length < total };
    const formatted = posts.map(p => formatPost(p, userId));

    if (tab === 'recommend' && page === 1) {
      setFeedCache(`feed:recommend:${limit}`, { data: formatted, meta });
    }

    res.json({ success: true, data: formatted, meta });
  } catch (err) {
    console.error('[POST] GET /feed error:', err);
    res.status(500).json({ success: false, error: 'Failed to load feed' });
  }
});

// ── GET /api/posts/topics ──────────────────────────────────────────────────────
router.get('/topics', authenticate, async (req, res) => {
  try {
    const topics = await prisma.topic.findMany({ orderBy: { newPostsCount: 'desc' }, take: 10 });
    res.json({ success: true, data: topics });
  } catch (err) {
    console.error('[POST] GET /topics error:', err);
    res.status(500).json({ success: false, error: 'Failed to load topics' });
  }
});

// ── GET /api/posts/user/:targetUserId ─────────────────────────────────────────
router.get('/user/:targetUserId', authenticate, async (req, res) => {
  try {
    const requestingUserId = req.user.id;
    const { targetUserId } = req.params;
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || FEED_PAGE_SIZE));
    const skip  = (page - 1) * limit;

    const isSelf = requestingUserId === targetUserId;
    const where  = {
      userId: targetUserId,
      ...(!isSelf ? { visibility: { in: ['PUBLIC', 'FOLLOWERS'] } } : {}),
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit, include: postInclude(requestingUserId) }),
      prisma.post.count({ where }),
    ]);

    res.json({
      success: true,
      data:    posts.map(p => formatPost(p, requestingUserId)),
      meta:    { page, limit, total, hasMore: skip + posts.length < total },
    });
  } catch (err) {
    console.error('[POST] GET /user/:userId error:', err);
    res.status(500).json({ success: false, error: 'Failed to load user posts' });
  }
});

// ── GET /api/posts/:postId ─────────────────────────────────────────────────────
router.get('/:postId', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const post   = await prisma.post.findUnique({ where: { id: req.params.postId }, include: postInclude(userId) });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    if (post.visibility === 'PRIVATE' && post.userId !== userId) {
      return res.status(403).json({ success: false, error: 'This post is private' });
    }
    res.json({ success: true, data: formatPost(post, userId) });
  } catch (err) {
    console.error('[POST] GET /:postId error:', err);
    res.status(500).json({ success: false, error: 'Failed to load post' });
  }
});

// ── POST /api/posts ────────────────────────────────────────────────────────────
router.post('/', authenticate, createPostLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { content, media, visibility } = req.body;

    const hasContent = typeof content === 'string' && content.trim().length > 0;
    const mediaArr   = Array.isArray(media)
      ? media.filter(u => typeof u === 'string' && u.startsWith('http'))
      : [];

    if (!hasContent && mediaArr.length === 0) {
      return res.status(400).json({ success: false, error: 'Post must have content or media' });
    }
    if (mediaArr.length > MAX_MEDIA_PER_POST) {
      return res.status(400).json({ success: false, error: `Maximum ${MAX_MEDIA_PER_POST} media items allowed` });
    }

    const finalVisibility = VALID_VISIBILITY.includes(visibility) ? visibility : 'PUBLIC';

    const post = await prisma.post.create({
      data: { id: uuidv4(), userId, content: hasContent ? content.trim() : null, mediaUrls: mediaArr, visibility: finalVisibility },
      include: postInclude(userId),
    });

    const formatted = formatPost(post, userId);
    invalidateFeedCache();
    emitPostEvent('post:created', { post: formatted });

    res.status(201).json({ success: true, data: formatted });
  } catch (err) {
    console.error('[POST] POST / error:', err);
    res.status(500).json({ success: false, error: 'Failed to create post' });
  }
});

// ── PUT /api/posts/:postId ─────────────────────────────────────────────────────
router.put('/:postId', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const post   = await prisma.post.findUnique({ where: { id: req.params.postId } });
    if (!post)              return res.status(404).json({ success: false, error: 'Post not found' });
    if (post.userId !== userId) return res.status(403).json({ success: false, error: 'Not authorized' });

    const { content, visibility } = req.body;
    const updates = {};
    if (content !== undefined) {
      updates.content = typeof content === 'string' && content.trim().length > 0 ? content.trim() : null;
    }
    if (visibility !== undefined && VALID_VISIBILITY.includes(visibility)) {
      updates.visibility = visibility;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to update' });
    }

    const updated = await prisma.post.update({ where: { id: req.params.postId }, data: updates, include: postInclude(userId) });
    invalidateFeedCache();
    res.json({ success: true, data: formatPost(updated, userId) });
  } catch (err) {
    console.error('[POST] PUT /:postId error:', err);
    res.status(500).json({ success: false, error: 'Failed to update post' });
  }
});

// ── DELETE /api/posts/:postId ──────────────────────────────────────────────────
router.delete('/:postId', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const post   = await prisma.post.findUnique({ where: { id: req.params.postId } });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const isOwner = post.userId === userId;
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
    if (!isOwner && !isAdmin) return res.status(403).json({ success: false, error: 'Not authorized' });

    const mediaUrls = parseMediaUrls(post.mediaUrls);
    await prisma.post.delete({ where: { id: req.params.postId } });
    invalidateFeedCache();
    emitPostEvent('post:deleted', { postId: req.params.postId });

    for (const url of mediaUrls) {
      try {
        const publicId = extractCloudinaryPublicId(url);
        if (publicId) await cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
      } catch (cleanupErr) {
        console.warn('[POST] Cloudinary cleanup failed for:', url, cleanupErr.message);
      }
    }

    res.json({ success: true, message: 'Post deleted' });
  } catch (err) {
    console.error('[POST] DELETE /:postId error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete post' });
  }
});

// ── POST /api/posts/:postId/like ───────────────────────────────────────────────
router.post('/:postId/like', authenticate, likePostLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const postId = req.params.postId;

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, userId: true } });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const existing = await prisma.postLike.findUnique({ where: { postId_userId: { postId, userId } } });
    if (existing) return res.status(409).json({ success: false, error: 'Already liked' });

    await prisma.postLike.create({ data: { id: uuidv4(), postId, userId } });
    const count = await prisma.postLike.count({ where: { postId } });

    emitPostEvent('post:liked', { postId, userId, likesCount: count });

    if (post.userId !== userId) {
      const liker = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
      const name  = liker?.displayName || liker?.username || 'Someone';
      notificationService.sendPushNotification(
        post.userId,
        'SYSTEM',
        'New Like',
        `${name} liked your post`,
        { type: 'POST_LIKED', postId, userId },
      ).catch(() => {});
    }

    res.json({ success: true, data: { liked: true, likesCount: count } });
  } catch (err) {
    console.error('[POST] POST /:postId/like error:', err);
    res.status(500).json({ success: false, error: 'Failed to like post' });
  }
});

// ── DELETE /api/posts/:postId/like ────────────────────────────────────────────
router.delete('/:postId/like', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const postId = req.params.postId;

    await prisma.postLike.deleteMany({ where: { postId, userId } });
    const count = await prisma.postLike.count({ where: { postId } });

    emitPostEvent('post:liked', { postId, userId, likesCount: count });
    res.json({ success: true, data: { liked: false, likesCount: count } });
  } catch (err) {
    console.error('[POST] DELETE /:postId/like error:', err);
    res.status(500).json({ success: false, error: 'Failed to unlike post' });
  }
});

// ── GET /api/posts/:postId/comments ───────────────────────────────────────────
router.get('/:postId/comments', authenticate, async (req, res) => {
  try {
    const postId = req.params.postId;
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || COMMENTS_PAGE_SIZE));
    const skip   = (page - 1) * limit;

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const [comments, total] = await Promise.all([
      prisma.postComment.findMany({
        where: { postId }, orderBy: { createdAt: 'asc' }, skip, take: limit,
        include: { user: { select: { id: true, username: true, avatar: true, displayName: true } } },
      }),
      prisma.postComment.count({ where: { postId } }),
    ]);

    res.json({ success: true, data: comments.map(formatComment), meta: { page, limit, total, hasMore: skip + comments.length < total } });
  } catch (err) {
    console.error('[POST] GET /:postId/comments error:', err);
    res.status(500).json({ success: false, error: 'Failed to load comments' });
  }
});

// ── POST /api/posts/:postId/comments ──────────────────────────────────────────
router.post('/:postId/comments', authenticate, commentLimiter, async (req, res) => {
  try {
    const userId  = req.user.id;
    const postId  = req.params.postId;
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

    if (!content) return res.status(400).json({ success: false, error: 'Comment cannot be empty' });
    if (content.length > 1000) return res.status(400).json({ success: false, error: 'Comment too long (max 1000 chars)' });

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true, userId: true } });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const comment = await prisma.postComment.create({
      data:    { id: uuidv4(), postId, userId, content },
      include: { user: { select: { id: true, username: true, avatar: true, displayName: true } } },
    });

    const formatted = formatComment(comment);
    emitPostEvent('post:commented', { postId, comment: formatted });

    if (post.userId !== userId) {
      const commenter = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
      const name      = commenter?.displayName || commenter?.username || 'Someone';
      notificationService.sendPushNotification(
        post.userId,
        'SYSTEM',
        'New Comment',
        `${name} commented on your post`,
        { type: 'POST_COMMENTED', postId, commentId: comment.id, userId },
      ).catch(() => {});
    }

    res.status(201).json({ success: true, data: formatted });
  } catch (err) {
    console.error('[POST] POST /:postId/comments error:', err);
    res.status(500).json({ success: false, error: 'Failed to add comment' });
  }
});

// ── DELETE /api/posts/:postId/comments/:commentId ─────────────────────────────
router.delete('/:postId/comments/:commentId', authenticate, async (req, res) => {
  try {
    const userId    = req.user.id;
    const commentId = req.params.commentId;

    const comment = await prisma.postComment.findUnique({ where: { id: commentId } });
    if (!comment) return res.status(404).json({ success: false, error: 'Comment not found' });

    const isOwner = comment.userId === userId;
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
    if (!isOwner && !isAdmin) return res.status(403).json({ success: false, error: 'Not authorized' });

    await prisma.postComment.delete({ where: { id: commentId } });
    res.json({ success: true, message: 'Comment deleted' });
  } catch (err) {
    console.error('[POST] DELETE /:postId/comments/:commentId error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete comment' });
  }
});

// ── POST /api/posts/:postId/view ───────────────────────────────────────────────
router.post('/:postId/view', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const postId = req.params.postId;

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const existing = await prisma.postView.findUnique({ where: { postId_userId: { postId, userId } } });
    if (!existing) {
      await prisma.$transaction([
        prisma.postView.create({ data: { id: uuidv4(), postId, userId } }),
        prisma.post.update({ where: { id: postId }, data: { viewsCount: { increment: 1 } } }),
      ]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[POST] POST /:postId/view error:', err);
    res.status(500).json({ success: false, error: 'Failed to record view' });
  }
});

// ── POST /api/posts/:postId/bookmark ──────────────────────────────────────────
router.post('/:postId/bookmark', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const postId = req.params.postId;

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const existing = await prisma.postBookmark.findUnique({ where: { postId_userId: { postId, userId } } });
    if (existing) return res.status(409).json({ success: false, error: 'Already bookmarked' });

    await prisma.postBookmark.create({ data: { id: uuidv4(), postId, userId } });
    res.json({ success: true, data: { bookmarked: true } });
  } catch (err) {
    console.error('[POST] POST /:postId/bookmark error:', err);
    res.status(500).json({ success: false, error: 'Failed to bookmark post' });
  }
});

// ── DELETE /api/posts/:postId/bookmark ────────────────────────────────────────
router.delete('/:postId/bookmark', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const postId = req.params.postId;

    await prisma.postBookmark.deleteMany({ where: { postId, userId } });
    res.json({ success: true, data: { bookmarked: false } });
  } catch (err) {
    console.error('[POST] DELETE /:postId/bookmark error:', err);
    res.status(500).json({ success: false, error: 'Failed to remove bookmark' });
  }
});

// ── POST /api/posts/:postId/report ────────────────────────────────────────────
router.post('/:postId/report', authenticate, async (req, res) => {
  try {
    const reporterId = req.user.id;
    const postId     = req.params.postId;
    const { reason, details } = req.body;

    if (!VALID_REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ success: false, error: `Invalid reason. Must be one of: ${VALID_REPORT_REASONS.join(', ')}` });
    }

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const existing = await prisma.postReport.findUnique({ where: { postId_reporterId: { postId, reporterId } } });
    if (existing) return res.status(409).json({ success: false, error: 'You already reported this post' });

    await prisma.postReport.create({
      data: {
        id: uuidv4(), postId, reporterId, reason,
        details: typeof details === 'string' ? details.slice(0, 500) : null,
      },
    });

    res.json({ success: true, message: 'Post reported' });
  } catch (err) {
    console.error('[POST] POST /:postId/report error:', err);
    res.status(500).json({ success: false, error: 'Failed to report post' });
  }
});

// ── POST /api/posts/media/upload ──────────────────────────────────────────────
router.post(
  '/media/upload',
  authenticate,
  uploadLimiter,
  upload.array('files', MAX_MEDIA_PER_POST),
  async (req, res) => {
    const uploadedPublicIds = [];
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, error: 'No files provided' });
      }

      const results = await Promise.all(
        req.files.map(async (file) => {
          const isVideo  = ALLOWED_VIDEO_MIMES.includes(file.mimetype);
          const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
          if (file.size > maxBytes) {
            throw new Error(`File ${file.originalname} exceeds maximum size of ${maxBytes / (1024 * 1024)}MB`);
          }

          const ext          = path.extname(file.originalname).toLowerCase().replace('.', '') || 'jpg';
          const publicId     = `moments/${req.user.id}/${uuidv4()}.${ext}`;
          const resourceType = isVideo ? 'video' : 'image';

          const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                public_id:      publicId,
                resource_type:  resourceType,
                overwrite:      false,
                transformation: isVideo
                  ? [{ quality: 'auto', fetch_format: 'mp4' }]
                  : [{ quality: 'auto', fetch_format: 'auto', width: 1920, crop: 'limit' }],
              },
              (error, uploadResult) => { if (error) reject(error); else resolve(uploadResult); }
            );
            stream.end(file.buffer);
          });

          uploadedPublicIds.push(result.public_id);
          return {
            url:          result.secure_url,
            publicId:     result.public_id,
            resourceType,
            width:        result.width    ?? null,
            height:       result.height   ?? null,
            duration:     result.duration ?? null,
            bytes:        result.bytes,
            thumbnailUrl: isVideo
              ? cloudinary.url(result.public_id, {
                  resource_type:  'video',
                  format:         'jpg',
                  transformation: [{ start_offset: '0' }],
                })
              : null,
          };
        })
      );

      res.json({ success: true, data: results });
    } catch (err) {
      console.error('[POST] POST /media/upload error:', err);
      for (const pid of uploadedPublicIds) {
        cloudinary.uploader.destroy(pid, { resource_type: 'auto' }).catch(() => {});
      }
      if (err.message && (err.message.startsWith('Unsupported file type') || err.message.includes('exceeds maximum size'))) {
        return res.status(400).json({ success: false, error: err.message });
      }
      res.status(500).json({ success: false, error: 'Media upload failed' });
    }
  }
);

function extractCloudinaryPublicId(url) {
  try {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

module.exports = router;
