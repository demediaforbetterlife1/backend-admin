/**
 * Input Validation Utilities
 * 
 * All authentication endpoints MUST validate input BEFORE processing.
 * This prevents malformed requests from reaching business logic.
 */

// ─────────────────────────────────────────────────────────────────────────
// Validation Rules
// ─────────────────────────────────────────────────────────────────────────

const RULES = {
  username: {
    minLength: 3,
    maxLength: 50,
    pattern: /^[a-zA-Z0-9_-]+$/, // alphanumeric, underscore, hyphen
    message: 'Username must be 3-50 characters, alphanumeric with _ or -',
  },
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    maxLength: 255,
    message: 'Invalid email address',
  },
  phone: {
    minLength: 10,
    maxLength: 15,
    message: 'Invalid phone number',
  },
  password: {
    minLength: 8,
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    message: 'Password must be 8+ chars with uppercase, lowercase, and number',
  },
  displayName: {
    minLength: 2,
    maxLength: 30,
    message: 'Display name must be 2-30 characters',
  },
  otp: {
    length: 6,
    pattern: /^\d{6}$/,
    message: 'OTP must be exactly 6 digits',
  },
};

const { throwError } = require('./apiResponse');

// ─────────────────────────────────────────────────────────────────────────
// Validator Functions
// ─────────────────────────────────────────────────────────────────────────

function validateUsername(username) {
  if (!username) throwError('Username is required', 'VALIDATION_ERROR');
  if (typeof username !== 'string') throwError('Username must be a string', 'VALIDATION_ERROR');
  
  const trimmed = username.trim();
  if (trimmed.length < RULES.username.minLength || trimmed.length > RULES.username.maxLength) {
    throwError(RULES.username.message, 'VALIDATION_ERROR');
  }
  if (!RULES.username.pattern.test(trimmed)) {
    throwError(RULES.username.message, 'VALIDATION_ERROR');
  }
  return trimmed;
}

function validateDisplayName(displayName) {
  if (!displayName || typeof displayName !== 'string') throwError('Display name is required', 'VALIDATION_ERROR');
  const trimmed = displayName.trim();
  if (trimmed.length < RULES.displayName.minLength || trimmed.length > RULES.displayName.maxLength) {
    throwError(RULES.displayName.message, 'VALIDATION_ERROR');
  }
  return trimmed;
}

function validateEmail(email) {
  if (!email) return null; // optional
  if (typeof email !== 'string') throwError('Email must be a string', 'VALIDATION_ERROR');
  
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length > RULES.email.maxLength) throwError(RULES.email.message, 'VALIDATION_ERROR');
  if (!RULES.email.pattern.test(trimmed)) throwError(RULES.email.message, 'VALIDATION_ERROR');
  return trimmed;
}

function validatePhone(phone) {
  if (!phone) return null; // optional
  if (typeof phone !== 'string') throwError('Phone must be a string', 'VALIDATION_ERROR');

  const normalized = phone.trim().replace(/\D/g, '');
  if (normalized.length < RULES.phone.minLength || normalized.length > RULES.phone.maxLength) {
    throwError(RULES.phone.message, 'VALIDATION_ERROR');
  }

  // Normalize to E.164-style digits, adding '+' if missing.
  const formattedPhone = `+${normalized}`;
  if (!phone.trim().startsWith('+')) {
    return formattedPhone;
  }
  return formattedPhone.replace(/^\+\+/, '+');
}

function validatePassword(password) {
  if (!password) throwError('Password is required', 'VALIDATION_ERROR');
  if (typeof password !== 'string') throwError('Password must be a string', 'VALIDATION_ERROR');
  
  if (password.length < RULES.password.minLength || password.length > RULES.password.maxLength) {
    throwError(RULES.password.message, 'VALIDATION_ERROR');
  }
  if (RULES.password.requireUppercase && !/[A-Z]/.test(password)) {
    throwError(RULES.password.message, 'VALIDATION_ERROR');
  }
  if (RULES.password.requireLowercase && !/[a-z]/.test(password)) {
    throwError(RULES.password.message, 'VALIDATION_ERROR');
  }
  if (RULES.password.requireNumber && !/\d/.test(password)) {
    throwError(RULES.password.message, 'VALIDATION_ERROR');
  }
  return password;
}

function validateOtp(code) {
  if (!code) throwError('OTP code is required', 'VALIDATION_ERROR');
  if (typeof code !== 'string') throwError('OTP must be a string', 'VALIDATION_ERROR');
  
  if (!RULES.otp.pattern.test(code)) {
    throwError(RULES.otp.message, 'VALIDATION_ERROR');
  }
  return code;
}

function validateRole(role) {
  if (!role) return null; // optional
  const validRoles = ['USER', 'AGENT'];
  if (!validRoles.includes(role.toUpperCase())) {
    throwError('Invalid role', 'VALIDATION_ERROR');
  }
  return role.toUpperCase();
}

function validateProvider(provider) {
  if (!provider) throwError('Provider is required', 'VALIDATION_ERROR');
  const validProviders = ['google', 'facebook', 'apple'];
  if (!validProviders.includes(provider.toLowerCase())) {
    throwError('Invalid provider', 'VALIDATION_ERROR');
  }
  return provider.toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────
// Request Validation Middleware
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate registration request body
 */
function validateRegisterRequest(body, isAgent = false) {
  const { username, email, phone, password } = body;

  const validated = {
    username: validateUsername(username),
    email: validateEmail(email),
    phone: validatePhone(phone),
    password: validatePassword(password),
  };

  // At least email or phone required
  if (!validated.email && !validated.phone) {
    throw new Error('Email or phone is required');
  }

  return validated;
}

/**
 * Validate login request body
 */
function validateLoginRequest(body) {
  const { email, phone, password } = body;

  const validated = {
    email: validateEmail(email),
    phone: validatePhone(phone),
    password: validatePassword(password),
  };

  // At least email or phone required
  if (!validated.email && !validated.phone) {
    throw new Error('Email or phone is required');
  }

  return validated;
}

/**
 * Validate OTP send request body
 */
function validateSendOtpRequest(body) {
  const { phone, role } = body;

  return {
    phone: validatePhone(phone) || (() => { throw new Error('Phone is required'); })(),
    role: validateRole(role),
  };
}

/**
 * Validate OTP verify request body
 */
function validateVerifyOtpRequest(body) {
  const { phone, code, role } = body;

  return {
    phone: validatePhone(phone) || (() => { throw new Error('Phone is required'); })(),
    code: validateOtp(code),
    role: validateRole(role),
  };
}

/**
 * Validate social login request body
 */
function validateSocialLoginRequest(body) {
  const { provider, providerId, idToken, email, username, avatar } = body;

  return {
    provider: validateProvider(provider),
    providerId: providerId || (() => { throw new Error('providerId is required'); })(),
    idToken, // can be null for development
    email: validateEmail(email),
    username: username ? validateUsername(username) : null,
    avatar: avatar && typeof avatar === 'string' ? avatar.substring(0, 2048) : null,
  };
}

/**
 * Validate refresh token request
 */
function validateRefreshRequest(body) {
  const { refreshToken } = body;
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new Error('Refresh token is required');
  }
  return { refreshToken };
}

function validateProfileRequest(body) {
  const { displayName, countryCode, gender, dateOfBirth, interests, accountType, bio } = body;

  // Check required fields are present and not empty
  if (!displayName || typeof displayName !== 'string' || displayName.trim() === '') {
    throw new Error('Display name is required');
  }
  if (!countryCode || typeof countryCode !== 'string' || countryCode.trim() === '') {
    throw new Error('Country code is required');
  }
  if (!gender || typeof gender !== 'string' || gender.trim() === '') {
    throw new Error('Gender is required');
  }
  if (!dateOfBirth || typeof dateOfBirth !== 'string' || dateOfBirth.trim() === '') {
    throw new Error('Date of birth is required');
  }
  if (!interests || !Array.isArray(interests) || interests.length === 0) {
    throw new Error('At least one interest is required');
  }
  if (!accountType || typeof accountType !== 'string' || accountType.trim() === '') {
    throw new Error('Account type is required');
  }

  // Validate displayName format
  const validatedDisplayName = validateDisplayName(displayName);

  // Validate account type
  const validAccountTypes = ['user', 'agent', 'USER', 'AGENT'];
  if (!validAccountTypes.includes(accountType)) {
    throw new Error('Invalid account type');
  }

  return {
    displayName: validatedDisplayName,
    countryCode: countryCode.trim(),
    gender: gender.trim(),
    dateOfBirth: dateOfBirth.trim(),
    interests: interests,
    accountType: accountType.trim(),
    bio: bio && typeof bio === 'string' ? bio.trim() : null,
  };
}

module.exports = {
  validateUsername,
  validateDisplayName,
  validateEmail,
  validatePhone,
  validatePassword,
  validateOtp,
  validateRole,
  validateProvider,
  validateRegisterRequest,
  validateLoginRequest,
  validateSendOtpRequest,
  validateVerifyOtpRequest,
  validateSocialLoginRequest,
  validateRefreshRequest,
  validateProfileRequest,
  RULES,
};
