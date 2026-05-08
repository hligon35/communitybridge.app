const getExpoPublicEnv = (key) => {
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key] != null) {
      return String(process.env[key]);
    }
  } catch (_) {
    // no-op
  }
  return '';
};

function getExpoExtraValue(key) {
  try {
    // eslint-disable-next-line global-require
    const ConstantsModule = require('expo-constants');
    const Constants = ConstantsModule?.default || ConstantsModule;
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

function getWebOrigin() {
  try {
    // In web builds, prefer the current origin so deployments accessed via IP
    // (or alternate hostnames) can still reach the co-hosted /api reverse proxy.
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      const origin = String(window.location.origin).trim();
      if (origin) return origin;
    }
  } catch (_) {
    // ignore
  }
  return '';
}

function getWebDevApiBaseUrl() {
  try {
    if (typeof window === 'undefined' || !window.location) return '';
    const host = String(window.location.hostname || '').trim();
    const port = String(window.location.port || '').trim();

    // In Expo web dev, the app runs on Metro (usually 8081). The API server is separate (3005).
    // Use the same hostname so LAN/IP access still works.
    if ((typeof __DEV__ !== 'undefined' && __DEV__) && (port === '8081' || port === '19006')) {
      if (host) return `http://${host}:3005`;
      return 'http://localhost:3005';
    }
  } catch (_) {
    // ignore
  }
  return '';
}

function getPreferredWebApiBaseUrl() {
  try {
    if (typeof window === 'undefined' || !window.location) return '';

    const origin = String(window.location.origin || '').trim();
    const port = String(window.location.port || '').trim();
    if (!origin) return '';

    // Expo web dev runs on Metro and needs the separate local API server.
    if ((typeof __DEV__ !== 'undefined' && __DEV__) && (port === '8081' || port === '19006')) {
      return '';
    }

    // Hosted web builds should use the same origin and rely on /api rewrites.
    return origin;
  } catch (_) {
    return '';
  }
}

function envFlag(value, defaultValue = false) {
  try {
    if (value == null) return defaultValue;
    const v = String(value).trim().toLowerCase();
    if (!v) return defaultValue;
    if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
    return defaultValue;
  } catch (_) {
    return defaultValue;
  }
}

// API base URL
// Prefer environment-driven config so dev/staging/prod can be swapped without code edits:
//   EXPO_PUBLIC_API_BASE_URL=https://communitybridge.app
// In production builds, this should be set via EAS/CI secrets.
//
// Production default:
// This repo is intended to run against the public domain below. Keeping a
// production fallback prevents "Network Error" caused by a missing build-time
// env var in release builds.
const DEFAULT_PROD_BASE_URL = 'https://api.communitybridge.app';
//
// Dev convenience:
// If EXPO_PUBLIC_API_BASE_URL is not set, try to infer the host IP from Expo/Metro
// so physical devices on the same network can reach the local API server.
const getDevHostFromExpo = () => {
  try {
    // `expo-constants` exists in Expo apps; we require it lazily to avoid
    // hard crashes if it isn't available in some runtimes.
    // eslint-disable-next-line global-require
    const ConstantsModule = require('expo-constants');
    const Constants = ConstantsModule?.default || ConstantsModule;

    // Common locations across Expo SDK versions.
    const hostUri =
      Constants?.expoConfig?.hostUri ||
      Constants?.manifest?.debuggerHost ||
      Constants?.manifest2?.extra?.expoClient?.hostUri ||
      '';

    // hostUri/debuggerHost typically looks like: "192.168.1.10:19000"
    const host = String(hostUri).split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') return host;
  } catch (_) {
    // ignore
  }
  return '';
};

const fallbackDevBaseUrl = (() => {
  const inferredHost = getDevHostFromExpo();
  if (inferredHost) return `http://${inferredHost}:3005`;
  return 'http://localhost:3005';
})();

const fallbackWebBaseUrl = getWebOrigin();

const webDevApiBaseUrl = getWebDevApiBaseUrl();
const preferredWebApiBaseUrl = getPreferredWebApiBaseUrl();

const apiBaseOverride = String(
  // NOTE: Expo only inlines EXPO_PUBLIC_* for static references.
  // This file previously used dynamic env lookup (process.env[key]), which can be empty in production.
  // app.config.js copies EXPO_PUBLIC_* into Constants.expoConfig.extra, so read that too.
  process.env.EXPO_PUBLIC_API_BASE_URL ||
    getExpoExtraValue('EXPO_PUBLIC_API_BASE_URL') ||
    ''
).trim();

export const BASE_URL =
  // In Expo web dev (Metro), always prefer the local API server on :3005.
  // This prevents dev sessions from accidentally targeting production when
  // EXPO_PUBLIC_API_BASE_URL is set for release builds.
  (((typeof __DEV__ !== 'undefined' && __DEV__) && webDevApiBaseUrl)
    ? webDevApiBaseUrl
    : (preferredWebApiBaseUrl ||
      apiBaseOverride ||
      ((typeof __DEV__ !== 'undefined' && __DEV__)
        ? fallbackDevBaseUrl
        : (fallbackWebBaseUrl || DEFAULT_PROD_BASE_URL))));

try {
  if (!BASE_URL && !(typeof __DEV__ !== 'undefined' && __DEV__)) {
    console.warn('[config] Missing EXPO_PUBLIC_API_BASE_URL for production build');
  }
} catch (_) {
  // no-op
}
// Use `10.0.2.2` for Android emulator when pointing to host machine
export const EMULATOR_HOST = '10.0.2.2';

// Optional: Google Places API key (enables address autocomplete in Admin -> Arrival Controls)
// Leave empty to disable autocomplete.
// Prefer setting via environment variable so it isn't committed:
//   EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=... (Expo will inline EXPO_PUBLIC_* vars)
export const GOOGLE_PLACES_API_KEY = getExpoPublicEnv('EXPO_PUBLIC_GOOGLE_PLACES_API_KEY');

// Testing toggle:
// - In Expo Go, __DEV__ is true, so the app auto-logs in with a dev token.
// - Set EXPO_PUBLIC_DISABLE_DEV_AUTOLOGIN=1 to force the real login flow in dev.
export const DISABLE_DEV_AUTOLOGIN = envFlag(getExpoPublicEnv('EXPO_PUBLIC_DISABLE_DEV_AUTOLOGIN'), false);

// Debug toggles
// - DEBUG_LOGS: enables logger.debug(...) output in dev
// Keep defaults quiet in production builds.
export const DEBUG_LOGS = (typeof __DEV__ !== 'undefined' ? __DEV__ : false);

// - DEBUG_LOG_COLORS: enables ANSI color codes in logs (useful in Metro/terminal)
// Default on in dev.
export const DEBUG_LOG_COLORS = (typeof __DEV__ !== 'undefined' ? __DEV__ : false);

// - DEBUG_LOG_LEVEL: minimum level to emit.
// One of: 'debug' | 'info' | 'warn' | 'error'
// Default: 'debug' in dev, 'info' otherwise.
export const DEBUG_LOG_LEVEL = (typeof __DEV__ !== 'undefined' && __DEV__) ? 'debug' : 'info';

// Dev-only convenience: auto-authenticate on startup.
// Set EXPO_PUBLIC_DEV_AUTO_LOGIN=true to enable.
export const DEV_AUTO_LOGIN = (getExpoPublicEnv('EXPO_PUBLIC_DEV_AUTO_LOGIN') || '').toLowerCase() === 'true';

// Default the dev switcher to ON only in dev builds. Store builds must opt in
// explicitly so reviewer/dev tooling cannot surface by accident.
export const ENABLE_DEV_SWITCHER = envFlag(
  getExpoPublicEnv('EXPO_PUBLIC_ENABLE_DEV_SWITCHER'),
  typeof __DEV__ !== 'undefined' && __DEV__
);

export default {
  BASE_URL,
  EMULATOR_HOST,
  GOOGLE_PLACES_API_KEY,
  DISABLE_DEV_AUTOLOGIN,
  DEBUG_LOGS,
  DEBUG_LOG_COLORS,
  DEBUG_LOG_LEVEL,
  DEV_AUTO_LOGIN,
  ENABLE_DEV_SWITCHER,
};
