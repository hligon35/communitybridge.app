const { isDemoReviewerUser, isSpecialAccessUser } = require('./authState');

const DEMO_ROLE_IDENTITIES = Object.freeze({
  admin: { id: 'user-admin-review', name: 'Linda Carter', email: 'review-admin@communitybridge.app', role: 'admin' },
  therapist: { id: 'aba-101', name: 'Jordan Ellis', email: 'review-therapist@communitybridge.app', role: 'therapist' },
  bcba: { id: 'bcba-001', name: 'Dr. Marissa Bennett', email: 'review-bcba@communitybridge.app', role: 'bcba' },
  parent: { id: 'par-dev-001', name: 'Joshua Simmons', email: 'dev@communitybridge.app', role: 'parent' },
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
    email: fallbackUser?.email || base.email || '',
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