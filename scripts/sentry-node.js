let SentryNode = null;
let initialized = false;

const SENSITIVE_PARTS = [
  'password', 'email', 'token', 'phone', 'address', 'body', 'note', 'notes', 'subject',
  'memo', 'recipient', 'avatar', 'lat', 'lng',
];

function safeString(value) {
  try {
    return value == null ? '' : String(value);
  } catch (_) {
    return '';
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && (value.constructor === Object || Object.getPrototypeOf(value) === null);
}

function isSensitiveKey(key) {
  const normalized = safeString(key).toLowerCase();
  return SENSITIVE_PARTS.some((part) => normalized.includes(part));
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

function getNodeSentry() {
  if (SentryNode) return SentryNode;
  try {
    // eslint-disable-next-line global-require
    SentryNode = require('@sentry/node');
  } catch (_) {
    SentryNode = null;
  }
  return SentryNode;
}

function initServerSentry({ service = 'api-server' } = {}) {
  const Sentry = getNodeSentry();
  if (!Sentry || initialized) return !!Sentry;

  const dsn = safeString(
    process.env.SENTRY_DSN
    || process.env.EXPO_PUBLIC_SENTRY_DSN
    || process.env.CB_SENTRY_DSN
    || process.env.BB_SENTRY_DSN
  ).trim();
  if (!dsn) return false;

  const environment = safeString(
    process.env.SENTRY_ENVIRONMENT
    || process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT
    || process.env.NODE_ENV
  ).trim();

  Sentry.init({
    dsn,
    environment: environment || undefined,
    beforeSend(event) {
      return scrubValue(event);
    },
    initialScope(scope) {
      scope.setTag('bb_service', safeString(service || 'api-server') || 'api-server');
      return scope;
    },
  });

  initialized = true;
  return true;
}

function captureServerException(error, context = {}) {
  try {
    const Sentry = getNodeSentry();
    if (!Sentry || !initialized) return '';
    return Sentry.withScope((scope) => {
      if (context && typeof context === 'object') {
        const area = safeString(context.area).trim();
        const action = safeString(context.action).trim();
        if (area) scope.setTag('bb_area', area);
        if (action) scope.setTag('bb_action', action);
        scope.setExtras(scrubValue(context));
      }
      return Sentry.captureException(error instanceof Error ? error : new Error(safeString(error) || 'Unknown server error'));
    });
  } catch (_) {
    return '';
  }
}

module.exports = {
  initServerSentry,
  captureServerException,
};