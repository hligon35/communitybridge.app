const { isSpecialAccessUser } = require('./authState');
const { seededDemoRoleIdentities } = require('../seed/demoModeSeed');

const DEMO_EMAIL_IDENTITIES = Object.freeze({
  'hligon35@gmail.com': { id: 'par-dev-001', name: 'Harold Ligon', email: 'hligon35@gmail.com', role: 'parent' },
  'cheyanne2448@gmail.com': { id: 'par-001', name: 'Cheyanne Cook', email: 'cheyanne2448@gmail.com', role: 'parent' },
  'abatech1@communitybridge.app': { id: 'aba-101', name: 'CommunityBridge ABA Tech 1', email: 'abatech1@communitybridge.app', role: 'therapist' },
  'abatech2@communitybridge.app': { id: 'aba-102', name: 'CommunityBridge ABA Tech 2', email: 'abatech2@communitybridge.app', role: 'therapist' },
  'abatech3@communitybridge.app': { id: 'aba-103', name: 'CommunityBridge ABA Tech 3', email: 'abatech3@communitybridge.app', role: 'therapist' },
  'abatech4@communitybridge.app': { id: 'aba-104', name: 'CommunityBridge ABA Tech 4', email: 'abatech4@communitybridge.app', role: 'therapist' },
  'bcba@communitybridge.app': { id: 'bcba-001', name: 'CommunityBridge BCBA', email: 'bcba@communitybridge.app', role: 'bcba' },
  'office@communitybridge.app': { id: 'office-001', name: 'CommunityBridge Office', email: 'office@communitybridge.app', role: 'office' },
  'admin@communitybridge.app': { id: 'staff-001', name: 'CommunityBridge Admin', email: 'admin@communitybridge.app', role: 'admin' },
});

const DEMO_ROLE_IDENTITIES = Object.freeze({
  ...seededDemoRoleIdentities,
  parent: { id: 'par-dev-001', name: 'Harold Ligon', email: 'hligon35@gmail.com', role: 'parent' },
  therapist: { id: 'aba-101', name: 'CommunityBridge ABA Tech 1', email: 'abatech1@communitybridge.app', role: 'therapist' },
  bcba: { id: 'bcba-001', name: 'CommunityBridge BCBA', email: 'bcba@communitybridge.app', role: 'bcba' },
  office: { id: 'office-001', name: 'CommunityBridge Office', email: 'office@communitybridge.app', role: 'office' },
  admin: { id: 'staff-001', name: 'CommunityBridge Admin', email: 'admin@communitybridge.app', role: 'admin' },
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