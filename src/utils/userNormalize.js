/**
 * Normalize JWT / DB user payload for req.user
 */
function normalizeRole(role) {
  if (!role) return 'USER';
  const upper = String(role).toUpperCase();
  const map = {
    USER: 'USER',
    HOST: 'HOST',
    VIP: 'VIP',
    SVIP: 'SVIP',
    AGENT: 'AGENT',
    MODERATOR: 'MODERATOR',
    ADMIN: 'ADMIN',
    SUPER_ADMIN: 'SUPER_ADMIN',
  };
  return map[upper] || 'USER';
}

function normalizeAuthUser(payload) {
  const userId = payload.id || payload.userId || payload.sub;
  return {
    id: userId,
    userId,
    username: payload.username,
    role: normalizeRole(payload.role),
  };
}

module.exports = { normalizeAuthUser, normalizeRole };
