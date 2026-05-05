const DEV_SWITCH_EMAIL = 'dev@communitybridge.app';
const APP_REVIEW_EMAIL = 'appreview@communitybridge.app';
const DEFAULT_MFA_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEV_MFA_WINDOW_MS = 4 * 60 * 60 * 1000;

/** @param {string | null | undefined} role */
function normalizeRoleOverride(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin' || value === 'administrator') return 'admin';
  if (value === 'bcba') return 'bcba';
  if (value === 'therapist') return 'therapist';
  if (value === 'parent') return 'parent';
  return '';
}

/** @param {string | null | undefined} email */
function isDevSwitcherUser(email) {
  return String(email || '').trim().toLowerCase() === DEV_SWITCH_EMAIL;
}

/** @param {string | null | undefined} email */
function isDemoReviewerUser(email) {
  return String(email || '').trim().toLowerCase() === APP_REVIEW_EMAIL;
}

/** @param {string | null | undefined} email */
function isSpecialAccessUser(email) {
  return isDevSwitcherUser(email) || isDemoReviewerUser(email);
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
  isDemoReviewerUser,
  isSpecialAccessUser,
  getMfaFreshnessWindowMs,
};