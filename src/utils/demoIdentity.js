const { isSpecialAccessUser } = require('./authState');
const { seededDemoRoleIdentities } = require('../seed/demoModeSeed');

const DEMO_ROLE_IDENTITIES = Object.freeze({
  ...seededDemoRoleIdentities,
  bcba: { id: 'bcba-001', name: 'Dr. Marissa Bennett', email: 'review-bcba@communitybridge.app', role: 'bcba' },
});

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function getDemoRoleIdentity(role, fallbackUser) {
  const normalized = normalizeRole(role);
  const base = DEMO_ROLE_IDENTITIES[normalized] || null;
  if (!base) return fallbackUser || null;
  return {
    ...base,
  };
}

function getEffectiveChatIdentity(user) {
  if (!user) return user;
  if (!isSpecialAccessUser(user?.email)) return user;

  // Special-access sessions intentionally reuse one Firebase account while
  // impersonating multiple role personas. Chats must follow the active persona,
  // not the shared login id, or thread visibility/unread state becomes incorrect.
  return getDemoRoleIdentity(user?.role, user) || user;
}

module.exports = {
  DEMO_ROLE_IDENTITIES,
  getDemoRoleIdentity,
  getEffectiveChatIdentity,
};