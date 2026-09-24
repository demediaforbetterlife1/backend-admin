/**
 * Unified API Response Handler
 * 
 * All authentication endpoints MUST use these helpers to ensure consistent
 * response format and proper HTTP status codes across the entire system.
 */

/**
 * Success response format:
 * {
 *   "success": true,
 *   "data": { ... },
 *   "message": "Human-readable message"
 * }
 */
function successResponse(data, message = null) {
  return {
    success: true,
    data,
    ...(message && { message }),
  };
}

/**
 * Error response format:
 * {
 *   "success": false,
 *   "message": "User-friendly error message",
 *   "errorCode": "ERROR_CODE" (optional, for debugging)
 * }
 * 
 * NOTE: Never include raw exception details, stack traces, or server internals.
 */
function errorResponse(message, errorCode = null) {
  const response = {
    success: false,
    message,
  };
  if (errorCode) {
    response.errorCode = errorCode;
  }
  return response;
}

/**
 * Send a successful response with optional HTTP status code
 */
function sendSuccess(res, data, statusCode = 200, message = null) {
  res.status(statusCode).json(successResponse(data, message));
}

/**
 * Send an error response with appropriate HTTP status code
 * 
 * Common status codes:
 * - 400: Bad request (validation failed, missing fields)
 * - 401: Unauthorized (invalid credentials, expired token)
 * - 403: Forbidden (banned account, insufficient permissions)
 * - 404: Not found
 * - 409: Conflict (user already exists, duplicate data)
 * - 429: Too many requests (rate limit)
 * - 500: Internal server error
 */
function sendError(res, message, statusCode = 400, errorCode = null) {
  res.status(statusCode).json(errorResponse(message, errorCode));
}

function throwError(message, errorCode) {
  const err = new Error(message);
  err.errorCode = errorCode;
  throw err;
}

/**
 * Error handler wrapper for async route handlers
 * Catches exceptions and sends standardized error response
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      console.error('[API Error]', err.message, err.stack);
      
      // Determine appropriate status code based on error type
      let statusCode = 500;
      let userMessage = 'An unexpected error occurred. Please try again.';
      let errorCode = err.errorCode || err.code || 'INTERNAL_ERROR';

      // Map error codes to HTTP status codes
      if (errorCode === 'VALIDATION_ERROR') {
        statusCode = 400;
        userMessage = err.message;
      } else if (errorCode === 'NOT_FOUND') {
        statusCode = 404;
        userMessage = err.message;
      } else if (errorCode === 'CONFLICT') {
        statusCode = 409;
        userMessage = err.message;
      } else if (errorCode === 'ACCOUNT_BANNED' || errorCode === 'USER_BANNED') {
        statusCode = 403;
        userMessage = 'Your account has been suspended';
      } else if (errorCode === 'AUTH_FAILED') {
        statusCode = 401;
        userMessage = err.message;
      } else if (err.message.includes('required')) {
        statusCode = 400;
        userMessage = err.message;
      } else if (err.message.includes('not found')) {
        statusCode = 404;
        userMessage = err.message;
      } else if (err.message.includes('already exists') || err.message.includes('already in use') || err.message.includes('already taken')) {
        statusCode = 409;
        userMessage = err.message;
      } else if (err.message.includes('suspended') || err.message.includes('banned')) {
        statusCode = 403;
        userMessage = err.message;
      } else if (err.message.includes('Incorrect') || err.message.includes('Invalid')) {
        statusCode = 401;
        userMessage = err.message;
      }

      sendError(res, userMessage, statusCode, errorCode);
    });
  };
}

module.exports = {
  successResponse,
  errorResponse,
  sendSuccess,
  sendError,
  throwError,
  asyncHandler,
};
