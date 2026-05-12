import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

export { Sentry };

const SENSITIVE_USER_KEYS = new Set(['email', 'ip_address', 'username', 'name']);
const SENSITIVE_DATA_PARTS = [
  'password', 'email', 'token', 'phone', 'address', 'body', 'note', 'notes', 'subject',
  'memo', 'recipient', 'avatar', 'lat', 'lng',
];

function getExpoExtraValue(key) {
  try {
    return (
      Constants?.expoConfig?.extra?.[key] ??
      Constants?.easConfig?.extra?.[key] ??
      Constants?.manifest2?.extra?.[key] ??
      Constants?.manifest?.extra?.[key]
    );
  } catch (_) {
    return undefined;
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && (value.constructor === Object || Object.getPrototypeOf(value) === null);
}

function isSensitiveKey(key) {
  const normalized = String(key || '').toLowerCase();
  return SENSITIVE_DATA_PARTS.some((part) => normalized.includes(part));
}

function scrubUser(user) {
  if (!user || typeof user !== 'object') return user;
  return Object.fromEntries(Object.entries(user).map(([key, value]) => (
    [key, SENSITIVE_USER_KEYS.has(String(key || '').toLowerCase()) ? '[REDACTED]' : value]
  )));
}

function scrubValue(value, parentKey = '') {
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, parentKey));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => (
      [key, isSensitiveKey(key) || isSensitiveKey(parentKey) ? '[REDACTED]' : scrubValue(entryValue, key)]
    )));
  }
  if (typeof value === 'string' && isSensitiveKey(parentKey)) return '[REDACTED]';
  return value;
}

function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const next = { ...event };
  if (next.user) next.user = scrubUser(next.user);
  if (next.contexts) next.contexts = scrubValue(next.contexts);
  if (next.extra) next.extra = scrubValue(next.extra);
  if (next.request) next.request = scrubValue(next.request);
  if (Array.isArray(next.breadcrumbs)) {
    next.breadcrumbs = next.breadcrumbs.map((crumb) => scrubValue(crumb));
  }
  return next;
}

export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN || getExpoExtraValue('EXPO_PUBLIC_SENTRY_DSN');
  if (!dsn) return;

  const environment = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || getExpoExtraValue('EXPO_PUBLIC_SENTRY_ENVIRONMENT');

  Sentry.init({
    dsn,
    environment: environment || undefined,
    enableNative: true,
    beforeSend(event) {
      return scrubEvent(event);
    },
  });
}

export function addSentryBreadcrumb({ category = 'app', message = '', data = null, level = 'info', type } = {}) {
  try {
    if (!Sentry || typeof Sentry.addBreadcrumb !== 'function') return;
    Sentry.addBreadcrumb({
      category: String(category || 'app'),
      message: String(message || '').trim() || undefined,
      level,
      type: type ? String(type) : undefined,
      data: data && typeof data === 'object' ? scrubValue(data) : undefined,
    });
  } catch (_) {
    // ignore breadcrumb failures
  }
}
