/**
 * Payment webhook handler
 *
 * Provides a secure endpoint for App Store and Google Play server notifications.
 * Uses a shared secret to protect against spoofed webhook requests.
 */

const inappService = require('./inapp.purchase.service');

function validateWebhookSecret(headerSecret) {
  const expected = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!expected) {
    throw new Error('Payment webhook secret is not configured');
  }
  if (!headerSecret || headerSecret !== expected) {
    throw new Error('Invalid webhook secret');
  }
}

async function handleAppleWebhook(payload, headerSecret) {
  validateWebhookSecret(headerSecret);

  const notificationType = payload.notification_type || payload.notificationType;
  const receipt = payload.latest_receipt || payload.receipt;
  const bundleId = payload.bundle_id || payload.bundleId;

  if (!notificationType || !receipt || !bundleId) {
    throw new Error('Invalid Apple webhook payload');
  }

  // For production, the app should reconcile receipts via /payment/verify-receipt
  // and use server notifications to update subscription state when renewals occur.
  return {
    platform: 'iOS',
    notificationType,
    bundleId,
    processedAt: new Date().toISOString(),
    message: 'Apple webhook received',
  };
}

async function handleAndroidWebhook(payload, headerSecret) {
  validateWebhookSecret(headerSecret);

  const notification = payload.subscriptionNotification || payload.oneTimeProductNotification || payload;
  if (!notification) {
    throw new Error('Invalid Android webhook payload');
  }

  return {
    platform: 'ANDROID',
    notification,
    processedAt: new Date().toISOString(),
    message: 'Google Play webhook received',
  };
}

async function handleWebhook(platform, payload, headerSecret) {
  if (!platform || !payload) {
    throw new Error('platform and payload are required');
  }

  if (platform === 'iOS') {
    return handleAppleWebhook(payload, headerSecret);
  }

  if (platform === 'ANDROID') {
    return handleAndroidWebhook(payload, headerSecret);
  }

  throw new Error('Unsupported webhook platform');
}

module.exports = {
  handleWebhook,
};
