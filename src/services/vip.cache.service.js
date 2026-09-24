/**
 * VIP Cache Service
 *
 * FIX M-02: In-memory fallback cache now has TTL enforcement and size limit
 *           to prevent unbounded memory growth.
 */

const { createClient } = require('redis');

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
const MAX_MEMORY_CACHE_SIZE = 10000; // max entries before LRU eviction

// FIX M-02: memory cache stores { value, expiresAt } with TTL
const MEMORY_CACHE = new Map();

let redisClient = null;
let redisReady = false;

async function initializeRedis() {
  if (redisClient || !process.env.REDIS_URL) return null;

  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (error) => {
    console.warn('[vip.cache] Redis unavailable:', error.message);
    redisReady = false;
  });
  redisClient.on('reconnecting', () => {
    console.info('[vip.cache] Redis reconnecting...');
  });
  redisClient.on('ready', () => {
    redisReady = true;
    console.info('[vip.cache] Redis connected');
  });

  try {
    await redisClient.connect();
    redisReady = true;
    return redisClient;
  } catch (error) {
    console.warn('[vip.cache] Failed to connect to Redis:', error.message);
    redisReady = false;
    redisClient = null;
    return null;
  }
}

/**
 * FIX M-02: Evict expired entries and enforce size limit (LRU-style).
 */
function evictMemoryCache() {
  const now = Date.now();
  // Remove expired entries first
  for (const [key, entry] of MEMORY_CACHE.entries()) {
    if (now > entry.expiresAt) {
      MEMORY_CACHE.delete(key);
    }
  }
  // If still over limit, remove oldest entries (Map preserves insertion order)
  if (MEMORY_CACHE.size > MAX_MEMORY_CACHE_SIZE) {
    const toDelete = MEMORY_CACHE.size - MAX_MEMORY_CACHE_SIZE;
    let deleted = 0;
    for (const key of MEMORY_CACHE.keys()) {
      MEMORY_CACHE.delete(key);
      deleted++;
      if (deleted >= toDelete) break;
    }
  }
}

async function getVipStatus(userId) {
  const key = `vip:status:${userId}`;

  if (redisReady && redisClient) {
    try {
      const cached = await redisClient.get(key);
      if (cached) return JSON.parse(cached);
      return null;
    } catch (err) {
      console.warn('[vip.cache] Redis get failed, falling back to memory:', err.message);
    }
  }

  // FIX M-02: check TTL before returning from memory cache
  const entry = MEMORY_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    MEMORY_CACHE.delete(key);
    return null;
  }
  if (entry.value?.expiresAt && new Date(entry.value.expiresAt) <= new Date()) {
    MEMORY_CACHE.delete(key);
    return null;
  }
  return entry.value;
}

async function setVipStatus(userId, snapshot) {
  const key = `vip:status:${userId}`;

  if (redisReady && redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(snapshot), { EX: CACHE_TTL_SECONDS });
      return;
    } catch (err) {
      console.warn('[vip.cache] Redis set failed, falling back to memory:', err.message);
    }
  }

  // FIX M-02: store with TTL and enforce size limit
  MEMORY_CACHE.set(key, { value: snapshot, expiresAt: Date.now() + CACHE_TTL_MS });
  if (MEMORY_CACHE.size > MAX_MEMORY_CACHE_SIZE) {
    evictMemoryCache();
  }
}

async function invalidateVipStatus(userId) {
  const key = `vip:status:${userId}`;

  if (redisReady && redisClient) {
    try {
      await redisClient.del(key);
    } catch (err) {
      console.warn('[vip.cache] Redis del failed:', err.message);
    }
  }

  MEMORY_CACHE.delete(key);
}

module.exports = {
  initializeRedis,
  getVipStatus,
  setVipStatus,
  invalidateVipStatus,
};
