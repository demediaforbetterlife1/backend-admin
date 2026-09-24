/** Shared VIP tier ordering — re-exports premium tier config */
const premium = require('./premium.tiers');
module.exports = { TIER_ORDER: premium.TIER_ORDER, normalizeTier: premium.normalizeTier };
