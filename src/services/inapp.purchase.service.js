/**
 * In-App Purchase Service
 *
 * FIX C-07: Real receipt verification stubs are clearly gated.
 *           ALLOW_IAP_STUB is blocked in production by validateConfig().
 *           Placeholder integration points are clearly marked for Apple/Google.
 */

const prisma = require('../prismaClient');
const coinsService = require('./coins.service');
const vipService = require('./vip.service');

const ALLOW_IAP_STUB = process.env.ALLOW_IAP_STUB === 'true';

function resolveStoreProductId(pkg, platform) {
  if (!pkg) return null;
  if (platform === 'iOS') return pkg.storeProductIdIos || pkg.id || pkg.tier;
  return pkg.storeProductIdAndroid || pkg.id || pkg.tier;
}

async function getCatalogItem(type, itemId, platform, verifiedProductId) {
  if (type === 'COIN_PURCHASE') {
    const pkg = await prisma.coinPackage.findUnique({ where: { id: itemId } });
    if (!pkg || !pkg.isActive) throw new Error('Coin package not found');
    const expected = resolveStoreProductId(pkg, platform);
    const allowed = [pkg.id, expected, itemId].filter(Boolean);
    if (!allowed.includes(verifiedProductId)) {
      throw new Error('Receipt productId does not match requested package');
    }
    return { amountEGP: pkg.priceEGP };
  }

  const plan = await prisma.vipPlan.findUnique({ where: { tier: itemId } });
  if (!plan || !plan.isActive) throw new Error('VIP plan not found');
  const expected = resolveStoreProductId(plan, platform);
  const allowed = [plan.tier, expected, itemId].filter(Boolean);
  if (!allowed.includes(verifiedProductId)) {
    throw new Error('Receipt productId does not match requested VIP tier');
  }
  return { amountEGP: plan.priceEGP };
}

/**
 * iOS receipt verification.
 *
 * FIX C-07: In production, requires APPLE_SHARED_SECRET and calls the
 * App Store Server API. In development with ALLOW_IAP_STUB=true, returns
 * a stub response for testing.
 *
 * TODO: Replace the stub with the App Store Server API v2 (JWT-based):
 *   https://developer.apple.com/documentation/appstoreserverapi
 *   Use @apple/app-store-server-library for the implementation.
 */
async function verifyIOSReceipt(receipt) {
  if (!receipt?.receiptData || !receipt?.productId || !receipt?.transactionId) {
    throw new Error('Invalid iOS receipt: receiptData, productId, and transactionId are required');
  }

  // FIX C-07: stub only allowed in non-production with explicit opt-in
  if (ALLOW_IAP_STUB && process.env.NODE_ENV !== 'production') {
    console.warn('[iap] iOS receipt verification stubbed — ALLOW_IAP_STUB=true');
    return {
      isValid: true,
      platform: 'iOS',
      productId: receipt.productId,
      transactionId: receipt.transactionId,
      originalTransactionId: receipt.originalTransactionId || receipt.transactionId,
      purchaseDate: receipt.purchaseDate ? new Date(receipt.purchaseDate) : new Date(),
    };
  }

  // TODO: Refactor to use AppStoreServerAPIClient with Apple keys
  // For now, retaining the old logic for backward compatibility
  // until Apple keys are fully configured in the environment.
  if (!process.env.APPLE_SHARED_SECRET) {
    throw new Error('APPLE_SHARED_SECRET is not configured for iOS receipt verification');
  }

  const verifyEndpoint = async (url) => {
    const payload = {
      'receipt-data': receipt.receiptData,
      password: process.env.APPLE_SHARED_SECRET,
      'exclude-old-transactions': true,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Apple receipt verification HTTP ${res.status}`);
    }
    return res.json();
  };

  const prodResponse = await verifyEndpoint('https://buy.itunes.apple.com/verifyReceipt');
  const appleResponse = prodResponse.status === 21007
    ? await verifyEndpoint('https://sandbox.itunes.apple.com/verifyReceipt')
    : prodResponse;

  if (appleResponse.status !== 0) {
    throw new Error(`Apple receipt verification failed with status ${appleResponse.status}`);
  }

  const transactions = Array.isArray(appleResponse.latest_receipt_info)
    ? appleResponse.latest_receipt_info
    : Array.isArray(appleResponse.receipt?.in_app)
      ? appleResponse.receipt.in_app
      : [];

  if (!transactions.length) {
    throw new Error('Apple receipt verification did not return any purchased transactions');
  }

  const matched = transactions.find((tx) => (
    tx.product_id === receipt.productId &&
    (tx.transaction_id === receipt.transactionId || tx.original_transaction_id === receipt.transactionId)
  )) || transactions.find((tx) => tx.product_id === receipt.productId);

  if (!matched) {
    throw new Error('Apple receipt verification did not match the expected product or transaction');
  }

  const purchaseTimeMs = parseInt(matched.purchase_date_ms || matched.original_purchase_date_ms || '0', 10) || Date.now();
  return {
    isValid: true,
    platform: 'iOS',
    productId: matched.product_id,
    transactionId: matched.transaction_id,
    originalTransactionId: matched.original_transaction_id || matched.transaction_id,
    purchaseDate: new Date(purchaseTimeMs),
    rawResponse: appleResponse,
  };
}

/**
 * Android receipt verification.
 *
 * FIX C-07: In production, requires GOOGLE_PLAY_CREDENTIALS and calls the
 * Google Play Developer API. In development with ALLOW_IAP_STUB=true, returns
 * a stub response for testing.
 *
 * TODO: Replace the stub with the Google Play Developer API:
 *   https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/get
 *   Use googleapis package for the implementation.
 */
function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function verifyAndroidReceipt(receipt) {
  if (!receipt?.purchaseToken || !receipt?.packageName || !receipt?.productId) {
    throw new Error('Invalid Android receipt: purchaseToken, packageName, and productId are required');
  }

  // FIX C-07: stub only allowed in non-production with explicit opt-in
  if (ALLOW_IAP_STUB && process.env.NODE_ENV !== 'production') {
    console.warn('[iap] Android receipt verification stubbed — ALLOW_IAP_STUB=true');
    return {
      isValid: true,
      platform: 'ANDROID',
      productId: receipt.productId,
      transactionId: receipt.purchaseToken,
      purchaseDate: receipt.purchaseDate ? new Date(receipt.purchaseDate) : new Date(),
    };
  }

  if (!process.env.GOOGLE_PLAY_CREDENTIALS) {
    throw new Error('GOOGLE_PLAY_CREDENTIALS is not configured for Android receipt verification');
  }

  const credentials = JSON.parse(process.env.GOOGLE_PLAY_CREDENTIALS);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('GOOGLE_PLAY_CREDENTIALS is missing required OAuth fields');
  }

  const tokenUri = credentials.token_uri || 'https://oauth2.googleapis.com/token';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const jwtHeader = { alg: 'RS256', typ: 'JWT' };
  const jwtClaims = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri,
    exp: nowSeconds + 3600,
    iat: nowSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(jwtHeader));
  const encodedClaims = base64UrlEncode(JSON.stringify(jwtClaims));
  const unsignedJwt = `${encodedHeader}.${encodedClaims}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(credentials.private_key, 'base64url');
  const jwt = `${unsignedJwt}.${signature}`;

  const tokenResponse = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`Failed to obtain Google access token: ${tokenResponse.status} ${body}`);
  }

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    throw new Error('Google access token response did not include access_token');
  }

  const buildUrl = (endpoint) => `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(receipt.packageName)}/${endpoint}/${encodeURIComponent(receipt.productId)}/tokens/${encodeURIComponent(receipt.purchaseToken)}`;
  const productUrl = buildUrl('purchases/products');

  let purchaseResponse = await fetch(productUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/json',
    },
  });

  let purchaseData = await purchaseResponse.json();
  if (!purchaseResponse.ok) {
    const isNotFound = purchaseResponse.status === 404 || purchaseData.error?.status === 404 || purchaseData.error?.status === 'NOT_FOUND';
    if (isNotFound) {
      const subscriptionUrl = buildUrl('purchases/subscriptions');
      purchaseResponse = await fetch(subscriptionUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/json',
        },
      });
      purchaseData = await purchaseResponse.json();
    }
  }

  if (!purchaseResponse.ok) {
    throw new Error(`Google Play receipt verification failed: ${purchaseData.error?.message || purchaseResponse.statusText}`);
  }

  if (purchaseData.purchaseState !== undefined && purchaseData.purchaseState !== 0) {
    throw new Error(`Google Play purchase is not completed: state=${purchaseData.purchaseState}`);
  }

  const purchaseTimeMillis = purchaseData.purchaseTimeMillis || purchaseData.startTimeMillis || purchaseData.expiryTimeMillis || '0';
  return {
    isValid: true,
    platform: 'ANDROID',
    packageName: receipt.packageName,
    productId: receipt.productId,
    purchaseToken: receipt.purchaseToken,
    purchaseDate: new Date(parseInt(purchaseTimeMillis, 10) || Date.now()),
    rawResponse: purchaseData,
  };
}

async function verifyReceipt(receipt, platform) {
  if (!platform || !['iOS', 'ANDROID'].includes(platform)) {
    throw new Error('Invalid platform. Must be iOS or ANDROID');
  }

  const verified = platform === 'iOS'
    ? await verifyIOSReceipt(receipt)
    : await verifyAndroidReceipt(receipt);

  if (!verified.isValid) throw new Error('Receipt verification failed');
  return verified;
}

async function processReceiptAndFulfill(userId, receipt, platform, type, itemId, autoRenew = false) {
  const verified = await verifyReceipt(receipt, platform);
  const receiptId = verified.transactionId;

  const existingOrder = await prisma.paymentOrder.findUnique({ where: { receiptId } });
  if (existingOrder?.status === 'SUCCESS') {
    // Idempotency: return the existing order so the client can safely complete the purchase.
    return existingOrder;
  }

  const catalog = await getCatalogItem(type, itemId, platform, verified.productId);
  const amountEGP = catalog.amountEGP;
  const amountCents = Math.round(amountEGP * 100);

  return prisma.$transaction(async (tx) => {
    const order = await tx.paymentOrder.upsert({
      where: { receiptId },
      create: {
        userId,
        type,
        itemId,
        amountEGP,
        amountCents,
        currency: 'EGP',
        platform,
        receiptId,
        status: 'SUCCESS',
        paidAt: new Date(),
        receiptData: verified,
      },
      update: {
        status: 'SUCCESS',
        paidAt: new Date(),
        receiptData: verified,
        failureReason: null,
      },
    });

    if (type === 'COIN_PURCHASE') {
      await coinsService.purchaseCoins(userId, itemId, order.id, tx);
    } else if (type === 'VIP_SUBSCRIPTION') {
      await vipService.subscribeTier(userId, itemId, 'iap', autoRenew, tx, false, receiptId, platform, type, 'SUCCESS');
    }

    return order;
  });
}

module.exports = {
  verifyReceipt,
  processReceiptAndFulfill,
  verifyIOSReceipt,
  verifyAndroidReceipt,
};
