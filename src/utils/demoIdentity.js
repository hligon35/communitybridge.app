const { isSpecialAccessUser } = require('./authState');
const { seededDemoRoleIdentities } = require('../seed/demoModeSeed');

const DEMO_EMAIL_IDENTITIES = Object.freeze({});

const DEMO_ROLE_IDENTITIES = Object.freeze({
  ...seededDemoRoleIdentities,
  parent: seededDemoRoleIdentities.parent,
  therapist: seededDemoRoleIdentities.therapist,
  bcba: { id: 'bcba-demo', name: 'CommunityBridge BCBA', email: 'bcba-demo@communitybridge.app', role: 'bcba' },
  office: { id: 'office-demo', name: 'CommunityBridge Office', email: 'office-demo@communitybridge.app', role: 'office' },
  admin: seededDemoRoleIdentities.admin,
});

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function getDemoRoleIdentity(role, fallbackUser) {
  const emailKey = String(fallbackUser?.email || '').trim().toLowerCase();
  const emailIdentity = DEMO_EMAIL_IDENTITIES[emailKey] || null;
  if (emailIdentity) {
    return {
      ...emailIdentity,
    };
  }
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
  DEMO_EMAIL_IDENTITIES,
  DEMO_ROLE_IDENTITIES,
  getDemoRoleIdentity,
  getEffectiveChatIdentity,
};