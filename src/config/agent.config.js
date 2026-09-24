const AGENT_CONFIG = {
  commissionRates: {
    GIFT_SENT: 0.05,
    VIP_PURCHASE: 0.10,
    COIN_PURCHASE: 0.03,
  },
  tierThresholds: {
    BRONZE: { min: 0, max: 10 },
    SILVER: { min: 11, max: 50 },
    GOLD: { min: 51, max: 200 },
    PLATINUM: { min: 201, max: 500 },
    DIAMOND: { min: 501, max: Infinity },
  },
  tierBonusMultiplier: {
    BRONZE: 1.0,
    SILVER: 1.1,
    GOLD: 1.2,
    PLATINUM: 1.35,
    DIAMOND: 1.5,
  },
  referralActivationActions: ['GIFT_SENT', 'VIP_PURCHASE', 'ROOM_JOINED_3_TIMES'],
  inactivityDays: 30,
};

module.exports = {
  AGENT_CONFIG,
};
