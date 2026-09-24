// Backend Constants

// Validation
export const VALIDATION = {
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 30,
  PASSWORD_MIN_LENGTH: 6,
  PASSWORD_MAX_LENGTH: 128,
  OTP_LENGTH: 6,
  PHONE_REGEX: /^\+?1?\d{9,15}$/,
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  AGENT_CODE_PREFIX: 'AGT',
  AGENT_CODE_LENGTH: 8,
};

// Error Messages
export const ERRORS = {
  INVALID_CREDENTIALS: 'Invalid email/phone or password',
  USER_EXISTS: 'User already exists',
  USER_NOT_FOUND: 'User not found',
  INVALID_TOKEN: 'Invalid or expired token',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  OTP_INVALID: 'Invalid OTP code',
  OTP_EXPIRED: 'OTP code expired',
  USER_BANNED: 'User is banned',
  WEAK_PASSWORD: 'Password must be at least 6 characters',
  INVALID_PHONE: 'Invalid phone number',
  INVALID_EMAIL: 'Invalid email address',
  INVALID_USERNAME: 'Username must be 3-30 characters',
};

// Success Messages
export const SUCCESS = {
  USER_REGISTERED: 'User registered successfully',
  AGENT_REGISTERED: 'Agent registered successfully',
  LOGIN_SUCCESS: 'Login successful',
  OTP_SENT: 'OTP sent to your phone',
  OTP_VERIFIED: 'OTP verified successfully',
  LOGOUT_SUCCESS: 'Logged out successfully',
  TOKEN_REFRESHED: 'Token refreshed successfully',
};

// Role-based defaults
export const ROLE_DEFAULTS = {
  USER: { role: 'USER', svipLevel: null },
  AGENT: { role: 'AGENT', svipLevel: null },
  HOST: { role: 'HOST', svipLevel: null },
  VIP: { role: 'VIP', svipLevel: 1 },
  SVIP: { role: 'SVIP', svipLevel: 2 },
  MODERATOR: { role: 'MODERATOR', svipLevel: null },
  SUPER_ADMIN: { role: 'SUPER_ADMIN', svipLevel: null },
};

// OAuth Providers
export const OAUTH_PROVIDERS = {
  GOOGLE: 'google',
  FACEBOOK: 'facebook',
  APPLE: 'apple',
};

// Ban Types
export const BAN_TYPES = {
  ONE_DAY: '1d',
  THREE_DAYS: '3d',
  NETWORK: 'network',
};

// Token refresh threshold (5 minutes before expiry)
export const TOKEN_REFRESH_THRESHOLD = 5 * 60;
