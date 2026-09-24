/**
 * VIP 1–10 and SVIP 1–10 tier definitions — privileges, rewards, cosmetics.
 */

const VIP_LEVELS = {};
for (let i = 1; i <= 10; i++) {
  VIP_LEVELS[`VIP_${i}`] = {
    tier: `VIP_${i}`,
    displayName: `VIP ${i}`,
    level: i,
    group: 'VIP',
    minSpend: i * 100,
    earningBonus: 1 + i * 0.02,
    maxRooms: Math.min(2 + Math.floor(i / 3), 5),
    canRecord: i >= 3,
    canGoPrivate: false,
    seatPriority: true,
    antiKickLevel: Math.min(i, 3),
    dailyRewardCoins: 20 + i * 8,
    nicknameColor: i >= 5 ? '#FFD700' : i >= 3 ? '#F5C842' : null,
    supportLevel: i >= 7 ? 'PRIORITY' : 'STANDARD',
    features: [
      'VIP badge',
      i >= 2 ? 'Colored nickname' : null,
      i >= 3 ? 'Profile frame slot' : null,
      i >= 4 ? 'Chat bubble style' : null,
      i >= 5 ? 'VIP mic effect' : null,
      i >= 6 ? 'Exclusive emojis' : null,
      i >= 7 ? 'Priority room join' : null,
      i >= 8 ? 'VIP-only gifts' : null,
      i >= 9 ? 'Welcome message' : null,
      i >= 10 ? 'Premium profile customization' : null,
    ].filter(Boolean),
  };
}

const SVIP_LEVELS = {};
for (let i = 1; i <= 10; i++) {
  SVIP_LEVELS[`SVIP_${i}`] = {
    tier: `SVIP_${i}`,
    displayName: `SVIP ${i}`,
    level: i,
    group: 'SVIP',
    minSpend: 2000 + i * 1500,
    earningBonus: 1.2 + i * 0.08,
    maxRooms: Math.min(3 + i, 12),
    canRecord: true,
    canGoPrivate: i >= 1,
    seatPriority: true,
    antiKickLevel: Math.min(2 + i, 8),
    dailyRewardCoins: 100 + i * 35,
    nicknameColor: i >= 7 ? '#FF00FF' : '#9B59B6',
    ghostMode: i >= 5,
    invisibleMode: i >= 8,
    supportLevel: i >= 8 ? 'DEDICATED' : i >= 4 ? 'VIP_SUPPORT' : 'PRIORITY',
    features: [
      'Animated legendary frame',
      i >= 2 ? 'Full-screen entrance' : 'Entrance effect',
      i >= 3 ? 'Neon nickname' : null,
      i >= 4 ? 'Animated chat bubble' : null,
      i >= 5 ? 'Ghost mode' : null,
      i >= 6 ? 'Special mic aura' : null,
      i >= 7 ? 'Custom room theme' : null,
      i >= 8 ? 'Invisible mode' : null,
      i >= 9 ? 'Priority speaker' : null,
      i >= 10 ? 'Legendary SVIP crown' : null,
    ].filter(Boolean),
  };
}

const TEST_VIP = {
  tier: 'TEST_VIP',
  displayName: 'Test VIP',
  level: 1,
  group: 'VIP',
  minSpend: 0,
  earningBonus: VIP_LEVELS.VIP_1.earningBonus,
  maxRooms: VIP_LEVELS.VIP_1.maxRooms,
  canRecord: VIP_LEVELS.VIP_1.canRecord,
  canGoPrivate: VIP_LEVELS.VIP_1.canGoPrivate,
  seatPriority: VIP_LEVELS.VIP_1.seatPriority,
  antiKickLevel: VIP_LEVELS.VIP_1.antiKickLevel,
  dailyRewardCoins: VIP_LEVELS.VIP_1.dailyRewardCoins,
  nicknameColor: VIP_LEVELS.VIP_1.nicknameColor,
  supportLevel: VIP_LEVELS.VIP_1.supportLevel,
  features: [...VIP_LEVELS.VIP_1.features],
};

const TEST_SVIP = {
  tier: 'TEST_SVIP',
  displayName: 'Test SVIP',
  level: 1,
  group: 'SVIP',
  minSpend: 0,
  earningBonus: SVIP_LEVELS.SVIP_1.earningBonus,
  maxRooms: SVIP_LEVELS.SVIP_1.maxRooms,
  canRecord: SVIP_LEVELS.SVIP_1.canRecord,
  canGoPrivate: SVIP_LEVELS.SVIP_1.canGoPrivate,
  seatPriority: SVIP_LEVELS.SVIP_1.seatPriority,
  antiKickLevel: SVIP_LEVELS.SVIP_1.antiKickLevel,
  dailyRewardCoins: SVIP_LEVELS.SVIP_1.dailyRewardCoins,
  nicknameColor: SVIP_LEVELS.SVIP_1.nicknameColor,
  ghostMode: SVIP_LEVELS.SVIP_1.ghostMode,
  invisibleMode: SVIP_LEVELS.SVIP_1.invisibleMode,
  supportLevel: SVIP_LEVELS.SVIP_1.supportLevel,
  features: [...SVIP_LEVELS.SVIP_1.features],
};

const TIER_DEFINITIONS = { ...VIP_LEVELS, ...SVIP_LEVELS, TEST_VIP, TEST_SVIP };

const TIER_ORDER = { NONE: 0, VIP: 1 };
for (let i = 1; i <= 10; i++) TIER_ORDER[`VIP_${i}`] = i;
for (let i = 1; i <= 10; i++) TIER_ORDER[`SVIP_${i}`] = 10 + i;
TIER_ORDER.TEST_VIP = 1;
TIER_ORDER.TEST_SVIP = 11;

function normalizeTier(tier) {
  if (!tier || tier === 'NONE') return 'NONE';
  if (tier === 'VIP') return 'VIP_1';
  if (tier === 'SVIP') return 'SVIP_1';
  if (tier === 'TEST_VIP') return 'TEST_VIP';
  if (tier === 'TEST_SVIP') return 'TEST_SVIP';
  return tier;
}

function getTierDefinition(tier) {
  const n = normalizeTier(tier);
  return TIER_DEFINITIONS[n] || null;
}

function getDailyRewardAmount(tier) {
  const def = getTierDefinition(tier);
  if (def) return def.dailyRewardCoins;
  if (tier === 'VIP') return VIP_LEVELS.VIP_1.dailyRewardCoins;
  return 15;
}

function chooseEffectiveTier(subscriptionTier, spendTier) {
  const a = normalizeTier(subscriptionTier);
  const b = normalizeTier(spendTier);
  if (a === 'NONE') return b;
  if (b === 'NONE') return a;
  return (TIER_ORDER[a] || 0) >= (TIER_ORDER[b] || 0) ? a : b;
}

function getTierFromSpend(totalSpend) {
  let best = 'NONE';
  for (const [tier, def] of Object.entries(TIER_DEFINITIONS)) {
    if (totalSpend >= def.minSpend && (TIER_ORDER[tier] || 0) > (TIER_ORDER[best] || 0)) {
      best = tier;
    }
  }
  return best;
}

function isSvipTier(tier) {
  const n = normalizeTier(tier);
  return n.startsWith('SVIP') || n === 'TEST_SVIP';
}

function tierLevel(tier) {
  const n = normalizeTier(tier);
  if (n === 'TEST_VIP') return 1;
  if (n === 'TEST_SVIP') return 1;
  const m = n.match(/^(VIP|SVIP)_(\d+)$/);
  return m ? parseInt(m[2], 10) : (n === 'VIP' ? 1 : 0);
}

module.exports = {
  VIP_LEVELS,
  SVIP_LEVELS,
  TIER_DEFINITIONS,
  TIER_ORDER,
  normalizeTier,
  getTierDefinition,
  getDailyRewardAmount,
  chooseEffectiveTier,
  getTierFromSpend,
  isSvipTier,
  tierLevel,
};
