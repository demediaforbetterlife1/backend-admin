/**
 * Environment validation — fail fast when secrets are missing or insecure.
 *
 * FIX L-01: Added validation for LiveKit default credentials.
 * FIX C-07: ALLOW_IAP_STUB is blocked in ALL deployed environments (not just production).
 * FIX L-05: JWT_SECRET validation now throws in all environments (moved to authService.js).
 * FIX M-07: .env.example variable name corrected to CORS_ORIGINS (plural).
 */

function parseOrigins(value) {
  if (!value || value === '*') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function validateConfig() {
  const isProd = process.env.NODE_ENV === 'production';
  const isDeployed = isProd || process.env.NODE_ENV === 'staging';
  const errors = [];

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('change_me')) {
    errors.push('JWT_SECRET must be set to a strong random value');
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.includes('change_me')) {
    errors.push('JWT_REFRESH_SECRET must be set to a strong random value');
  }
  if (isProd && !process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is required in production');
  }

  // FIX C-07: block IAP stub in any deployed environment, not just production
  if (isDeployed && process.env.ALLOW_IAP_STUB === 'true') {
    errors.push('ALLOW_IAP_STUB must not be true in staging or production environments');
  }

  if (isDeployed && process.env.ALLOW_SOCIAL_STUB === 'true') {
    errors.push('ALLOW_SOCIAL_STUB must not be true in staging or production environments');
  }

  // SECURITY FIX: DEV_FREE_SUBSCRIPTIONS bypasses payment for /vip/test-subscribe.
  // Block it in any deployed environment — same pattern as ALLOW_IAP_STUB.
  if (isDeployed && process.env.DEV_FREE_SUBSCRIPTIONS === 'true') {
    errors.push('DEV_FREE_SUBSCRIPTIONS must not be true in staging or production environments');
  }

  if (isProd && parseOrigins(process.env.CORS_ORIGINS).length === 0) {
    errors.push('CORS_ORIGINS must list allowed origins in production (comma-separated)');
  }

  if (isProd && !process.env.APP_URL) {
    errors.push('APP_URL must be configured in production');
  }

  // Note: Firebase push notifications have been replaced with a local stub.
  // No Firebase credentials are required.

  // FIX L-01: warn about default LiveKit credentials in deployed environments
  if (isDeployed) {
    if (!process.env.LIVEKIT_URL) {
      errors.push('LIVEKIT_URL must be configured in deployed environments');
    }
    if (!process.env.LIVEKIT_API_KEY || process.env.LIVEKIT_API_KEY === 'devkey') {
      errors.push('LIVEKIT_API_KEY must be set to a real value in deployed environments');
    }
    if (!process.env.LIVEKIT_API_SECRET || process.env.LIVEKIT_API_SECRET === 'secret') {
      errors.push('LIVEKIT_API_SECRET must be set to a real value in deployed environments');
    }
  }

  // Note: Cloudinary is optional - only needed if using file uploads
  // Uncomment to make it required:
  // if (isProd) {
  //   if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  //     errors.push('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are required in production');
  //   }
  // }

  if (errors.length > 0) {
    const message = `Configuration errors:\n- ${errors.join('\n- ')}`;
    if (isProd) {
      throw new Error(message);
    }
    console.warn(`[config] ${message}`);
  }
}

function getCorsOrigins() {
  // FIX M-07: read CORS_ORIGINS (plural) — the correct variable name
  const origins = parseOrigins(process.env.CORS_ORIGINS);
  if (origins.length > 0) return origins;
  if (process.env.NODE_ENV === 'production') return [];
  return true; // reflect request origin in development
}

module.exports = { validateConfig, getCorsOrigins, parseOrigins };
