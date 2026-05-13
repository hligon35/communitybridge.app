const DEV_SWITCH_EMAIL = 'dev@communitybridge.app';
const APP_REVIEW_EMAIL = 'appreview@communitybridge.app';
const DEV_SWITCH_EMAILS = new Set([
  DEV_SWITCH_EMAIL,
]);
const RESERVED_SUPER_ADMIN_EMAILS = new Set([
  'alphazonelabsllc@gmail.com',
]);
const RESERVED_PARENT_EMAILS = new Set([
  APP_REVIEW_EMAIL,
]);
const DEFAULT_MFA_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEV_MFA_WINDOW_MS = 4 * 60 * 60 * 1000;

/** @param {string | null | undefined} role */
function normalizeRoleOverride(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin' || value === 'administrator') return 'admin';
  if (value === 'bcba') return 'bcba';
  if (value === 'office' || value === 'officeadmin' || value === 'office admin') return 'office';
  if (value === 'therapist') return 'therapist';
  if (value === 'parent') return 'parent';
  return '';
}

/** @param {string | null | undefined} email */
function isDevSwitcherUser(email) {
  return DEV_SWITCH_EMAILS.has(String(email || '').trim().toLowerCase());
}

/** @param {string | null | undefined} email */
function isSpecialAccessUser(email) {
  return isDevSwitcherUser(email);
}

/** @param {string | null | undefined} email */
function isReservedSuperAdminEmail(email) {
  return RESERVED_SUPER_ADMIN_EMAILS.has(String(email || '').trim().toLowerCase());
}

/** @param {string | null | undefined} email */
function isReservedParentEmail(email) {
  return RESERVED_PARENT_EMAILS.has(String(email || '').trim().toLowerCase());
}

/** @param {{ email?: string | null | undefined, name?: string | null | undefined, role?: string | null | undefined } | null | undefined} user */
function applyReservedUserOverrides(user) {
  const item = user && typeof user === 'object' ? { ...user } : user;
  if (!item || typeof item !== 'object') return item;
  if (isReservedSuperAdminEmail(item.email)) {
    return {
      ...item,
      role: 'superAdmin',
    };
  }
  if (!isReservedParentEmail(item.email)) return item;
  return {
    ...item,
    name: String(item.name || '').trim() || 'App Reviewer',
    role: 'parent',
  };
}

/** @param {{ email?: string | null | undefined, devUser?: boolean | null | undefined } | null | undefined} profile */
function getMfaFreshnessWindowMs(profile) {
  const email = String(profile?.email || '').trim().toLowerCase();
  const isDevUser = profile?.devUser === true || isSpecialAccessUser(email);
  return isDevUser ? DEV_MFA_WINDOW_MS : DEFAULT_MFA_WINDOW_MS;
}

module.exports = {
  DEV_SWITCH_EMAIL,
  APP_REVIEW_EMAIL,
  DEFAULT_MFA_WINDOW_MS,
  DEV_MFA_WINDOW_MS,
  normalizeRoleOverride,
  isDevSwitcherUser,
  isSpecialAccessUser,
  isReservedParentEmail,
  isReservedSuperAdminEmail,
  applyReservedUserOverrides,
  getMfaFreshnessWindowMs,
};