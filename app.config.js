// Dynamic Expo config to ensure EXPO_PUBLIC_* values are available at runtime
// via Constants.expoConfig.extra (not just process.env).
const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) return;
      const key = trimmed.slice(0, separatorIndex).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) return;
      const value = trimmed.slice(separatorIndex + 1).trim();
      process.env[key] = value;
    });
  } catch (_) {
    // Keep Expo config resilient if a local env file is malformed.
  }
}

loadEnvFile(path.resolve(__dirname, '.env'));
loadEnvFile(path.resolve(__dirname, '.env.local'));
loadEnvFile(path.resolve(__dirname, 'env', 'expo.env'));

module.exports = ({ config }) => {
  const extra = { ...(config.extra || {}) };
  const usesNonExemptEncryption = false;

  const keys = [
    // Firebase (public config, required for Auth/Firestore/Functions)
    'EXPO_PUBLIC_FIREBASE_API_KEY',
    'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
    'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
    'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    'EXPO_PUBLIC_FIREBASE_APP_ID',
    'EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID',
    'EXPO_PUBLIC_FIREBASE_FUNCTIONS_REGION',

    // Firebase App Check (web)
    'EXPO_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY',
    'EXPO_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN',
    'EXPO_PUBLIC_ENABLE_APP_CHECK',

    // Google OAuth (public client IDs)
    'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',

    'EXPO_PUBLIC_SENTRY_DSN',
    'EXPO_PUBLIC_SENTRY_ENVIRONMENT',
    'EXPO_PUBLIC_API_BASE_URL',
    'EXPO_PUBLIC_ENABLE_DEV_SWITCHER',
  ];

  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) {
      extra[key] = value;
    }
  }

  return {
    ...config,
    ios: {
      ...(config.ios || {}),
      config: {
        ...((config.ios && config.ios.config) || {}),
        usesNonExemptEncryption,
      },
    },
    extra,
  };
};
