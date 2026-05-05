const { isSpecialAccessUser } = require('./authState');
const { seededDemoRoleIdentities } = require('../seed/demoModeSeed');

const DEMO_ROLE_IDENTITIES = Object.freeze(seededDemoRoleIdentities);

function hasScreenshotSeedRequest() {
  if (!__DEV__) return false;
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
  if (hasScreenshotSeedRequest() && user?.id) return user;
  return getDemoRoleIdentity(user?.role, user) || user;
}

module.exports = {
  DEMO_ROLE_IDENTITIES,
  getDemoRoleIdentity,
  getEffectiveChatIdentity,
};