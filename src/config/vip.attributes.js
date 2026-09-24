const TIER_DEFINITIONS = {
  VIP_1: {
    tier: 'VIP_1',
    displayName: 'VIP 1',
    minSpend: 100,
    earningBonus: 1.1,
    maxRooms: 2,
    canRecord: false,
    canGoPrivate: false,
    seatPriority: true,
    antiKickLevel: 1,
    supportLevel: 'STANDARD',
    features: ['أولوية المقعد', 'تأثير VIP عادي'],
  },
  VIP_2: {
    tier: 'VIP_2',
    displayName: 'VIP 2',
    minSpend: 300,
    earningBonus: 1.15,
    maxRooms: 2,
    canRecord: false,
    canGoPrivate: false,
    seatPriority: true,
    antiKickLevel: 1,
    supportLevel: 'STANDARD',
    features: ['أولوية المقعد', 'مكافآت أعلى'],
  },
  VIP_3: {
    tier: 'VIP_3',
    displayName: 'VIP 3',
    minSpend: 700,
    earningBonus: 1.2,
    maxRooms: 3,
    canRecord: true,
    canGoPrivate: false,
    seatPriority: true,
    antiKickLevel: 2,
    supportLevel: 'PRIORITY',
    features: ['تسجيل الغرف', 'أولوية دعم', 'مكافآت أعلى'],
  },
  SVIP_1: {
    tier: 'SVIP_1',
    displayName: 'SVIP 1',
    minSpend: 2500,
    earningBonus: 1.3,
    maxRooms: 3,
    canRecord: true,
    canGoPrivate: true,
    seatPriority: true,
    antiKickLevel: 2,
    supportLevel: 'PRIORITY',
    features: ['غرف خاصة', 'إطار مميز', 'دعم أعلى'],
  },
  SVIP_2: {
    tier: 'SVIP_2',
    displayName: 'SVIP 2',
    minSpend: 5000,
    earningBonus: 1.45,
    maxRooms: 4,
    canRecord: true,
    canGoPrivate: true,
    seatPriority: true,
    antiKickLevel: 3,
    supportLevel: 'VIP_SUPPORT',
    features: ['غرف خاصة', 'تقليل إقصاء', 'مكافآت متقدمة'],
  },
  SVIP_3: {
    tier: 'SVIP_3',
    displayName: 'SVIP 3',
    minSpend: 10000,
    earningBonus: 1.7,
    maxRooms: 5,
    canRecord: true,
    canGoPrivate: true,
    seatPriority: true,
    antiKickLevel: 4,
    supportLevel: 'DEDICATED',
    features: ['دعم مخصص', 'خصائص SVIP كاملة', 'مكافآت قصوى'],
  },
};

const TIER_ORDER = {
  NONE: 0,
  VIP_1: 1,
  VIP_2: 2,
  VIP_3: 3,
  SVIP_1: 4,
  SVIP_2: 5,
  SVIP_3: 6,
  VIP: 1,
  SVIP: 4,
  SVIP_4: 7,
  SVIP_5: 8,
};

const USD_RATE_EGP = 35;

function normalizeTier(tier) {
  if (!tier || tier === 'NONE') return 'NONE';
  if (tier === 'VIP') return 'VIP_1';
  if (tier === 'SVIP') return 'SVIP_1';
  return tier;
}

function getTierFromSpend(totalSpend) {
  if (totalSpend >= TIER_DEFINITIONS.SVIP_3.minSpend) return 'SVIP_3';
  if (totalSpend >= TIER_DEFINITIONS.SVIP_2.minSpend) return 'SVIP_2';
  if (totalSpend >= TIER_DEFINITIONS.SVIP_1.minSpend) return 'SVIP_1';
  if (totalSpend >= TIER_DEFINITIONS.VIP_3.minSpend) return 'VIP_3';
  if (totalSpend >= TIER_DEFINITIONS.VIP_2.minSpend) return 'VIP_2';
  if (totalSpend >= TIER_DEFINITIONS.VIP_1.minSpend) return 'VIP_1';
  return 'NONE';
}

function chooseEffectiveTier(subscriptionTier, spendTier) {
  const normalizedSubscription = normalizeTier(subscriptionTier);
  const normalizedSpend = normalizeTier(spendTier);

  if (!normalizedSubscription || normalizedSubscription === 'NONE') return normalizedSpend;
  if (!normalizedSpend || normalizedSpend === 'NONE') return normalizedSubscription;

  return TIER_ORDER[normalizedSubscription] >= TIER_ORDER[normalizedSpend]
    ? normalizedSubscription
    : normalizedSpend;
}

function toUsdFromCoins(coins) {
  return Number((coins / 100).toFixed(2));
}

function toUsdFromEgp(egp) {
  return Number((egp / USD_RATE_EGP).toFixed(2));
}

module.exports = {
  TIER_DEFINITIONS,
  TIER_ORDER,
  USD_RATE_EGP,
  normalizeTier,
  getTierFromSpend,
  chooseEffectiveTier,
  toUsdFromCoins,
  toUsdFromEgp,
};
