const { isDemoReviewerUser, isSpecialAccessUser } = require('./authState');

const DEMO_ROLE_IDENTITIES = Object.freeze({
  admin: { id: 'admin-demo', name: 'Jordan Admin', email: 'admin-demo@communitybridge.app', role: 'admin' },
  therapist: { id: 'ABA-001', name: 'Daniel Lopez', email: 'daniel.lopez@communitybridge.app', role: 'therapist' },
  parent: { id: 'PT-001', name: 'Carlos Garcia', email: 'carlos.garcia@communitybridge.app', role: 'parent' },
});
const isDevRuntime = typeof __DEV__ !== 'undefined' && Boolean(__DEV__);

function hasScreenshotSeedRequest() {
  if (!isDevRuntime) return false;
  try {
    const href = String(globalThis?.location?.href || '');
    if (!href) return false;
    const url = new URL(href);
    return url.searchParams.get('seed') === 'screenshot';
  } catch {
    return false;
  }
}

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function getDemoRoleIdentity(role, fallbackUser) {
  const normalized = normalizeRole(role);
  const base = DEMO_ROLE_IDENTITIES[normalized] || null;
  if (!base) return fallbackUser || null;
  return {
    ...base,
    email: base.email || fallbackUser?.email || '',
  };
}

function getEffectiveChatIdentity(user) {
  if (!user) return user;
  if (!isSpecialAccessUser(user?.email)) return user;
  if (isDemoReviewerUser(user?.email) && user?.id) return user;
  if (hasScreenshotSeedRequest() && user?.id) return user;
  return getDemoRoleIdentity(user?.role, user) || user;
}

module.exports = {
  DEMO_ROLE_IDENTITIES,
  getDemoRoleIdentity,
  getEffectiveChatIdentity,
};