import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const CANONICAL_FIREBASE_WEB_CONFIG = Object.freeze({
  apiKey: 'AIzaSyC0Q3xKa55tizgve_q9E5bD0oGdnVtNKiQ',
  authDomain: 'communitybridge-26apr.firebaseapp.com',
  projectId: 'communitybridge-26apr',
  storageBucket: 'communitybridge-26apr.firebasestorage.app',
  messagingSenderId: '752508556236',
  appId: '1:752508556236:web:dc183f4851108dd8c14369',
  measurementId: 'G-HYK2C00ZRK',
  functionsRegion: 'us-central1',
});

function getCanonicalFirebaseWebValue(key) {
  switch (String(key || '')) {
    case 'EXPO_PUBLIC_FIREBASE_API_KEY':
      return CANONICAL_FIREBASE_WEB_CONFIG.apiKey;
    case 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN':
      return CANONICAL_FIREBASE_WEB_CONFIG.authDomain;
    case 'EXPO_PUBLIC_FIREBASE_PROJECT_ID':
      return CANONICAL_FIREBASE_WEB_CONFIG.projectId;
    case 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET':
      return CANONICAL_FIREBASE_WEB_CONFIG.storageBucket;
    case 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID':
      return CANONICAL_FIREBASE_WEB_CONFIG.messagingSenderId;
    case 'EXPO_PUBLIC_FIREBASE_APP_ID':
      return CANONICAL_FIREBASE_WEB_CONFIG.appId;
    case 'EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID':
      return CANONICAL_FIREBASE_WEB_CONFIG.measurementId;
    case 'EXPO_PUBLIC_FIREBASE_FUNCTIONS_REGION':
      return CANONICAL_FIREBASE_WEB_CONFIG.functionsRegion;
    default:
      return '';
  }
}

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

function getExpoPublicEnv(key) {
  // IMPORTANT: Expo inlines EXPO_PUBLIC_* vars only for *static* references.
  // Dynamic lookups like process.env[key] will often be empty in production.
  try {
    switch (String(key || '')) {
      case 'EXPO_PUBLIC_FIREBASE_API_KEY':
        return String(
          process.env.EXPO_PUBLIC_FIREBASE_API_KEY ||
            getExpoExtraValue('EXPO_PUBLIC_FIREBASE_API_KEY') ||
            ''
        );
      case 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN':
        return String(
          process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ||
            getExpoExtraValue('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN') ||
            ''
        );
      case 'EXPO_PUBLIC_FIREBASE_PROJECT_ID':
        return String(
          process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
            getExpoExtraValue('EXPO_PUBLIC_FIREBASE_PROJECT_ID') ||
            ''
        );
      case 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET':
        return String(
          process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ||
            getExpoExtraValue('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET') ||
            ''
        );
      case 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID':
        return String(
          process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
            getExpoExtraValue('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID') ||
            ''
        );
      case 'EXPO_PUBLIC_FIREBASE_APP_ID':
        return String(
          process.env.EXPO_PUBLIC_FIREBASE_APP_ID ||
            getExpoExtraValue('EXPO_PUBLIC_FIREBASE_APP_ID') ||
            ''
        );
      case 'EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID':
        return String(
          process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ||
            getExpoExtraValue('EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID') ||
            ''
        );
      case 'EXPO_PUBLIC_FIREBASE_FUNCTIONS_REGION':
        return String(
          process.env.EXPO_PUBLIC_FIREBASE_FUNCTIONS_REGION ||
            getExpoExtraValue('EXPO_PUBLIC_FIREBASE_FUNCTIONS_REGION') ||
            ''
        );
      case 'EXPO_PUBLIC_ENABLE_APP_CHECK':
        return String(
          process.env.EXPO_PUBLIC_ENABLE_APP_CHECK ||
            getExpoExtraValue('EXPO_PUBLIC_ENABLE_APP_CHECK') ||
            ''
        );
      case 'EXPO_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY':
        return String(
          process.env.EXPO_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY ||
            getExpoExtraValue('EXPO_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY') ||
            ''
        );
      case 'EXPO_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN':
        return String(
          process.env.EXPO_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN ||
            getExpoExtraValue('EXPO_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN') ||
            ''
        );
      default:
        return '';
    }
  } catch (_) {
    return '';
  }
}

function parseBooleanLike(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return false;
  return null;
}

function getFirebaseConfigFromGoogleServices() {
  try {
    // eslint-disable-next-line global-require
    const gs = require('../google-services.json');

    const projectId = String(gs?.project_info?.project_id || '');
    const storageBucket = String(gs?.project_info?.storage_bucket || '');
    const messagingSenderId = String(gs?.project_info?.project_number || '');

    const client0 = Array.isArray(gs?.client) ? gs.client[0] : null;
    const appId = String(client0?.client_info?.mobilesdk_app_id || '');

    const apiKey = String(
      (Array.isArray(client0?.api_key)
        ? client0.api_key[0]?.current_key
        : client0?.api_key?.current_key) ||
        ''
    );

    return {
      apiKey,
      projectId,
      storageBucket,
      messagingSenderId,
      appId,
      authDomain: projectId ? `${projectId}.firebaseapp.com` : '',
    };
  } catch (_) {
    return null;
  }
}

const fromGoogleServices = getFirebaseConfigFromGoogleServices();

function isWebFirebaseAppId(value) {
  return String(value || '').includes(':web:');
}

function isJsSdkFirebaseAppId(value) {
  return isWebFirebaseAppId(value);
}

function shouldUseCanonicalFirebaseWebConfig() {
  const rawAppId = String(getExpoPublicEnv('EXPO_PUBLIC_FIREBASE_APP_ID') || '').trim();
  if (!rawAppId) return true;
  return !isWebFirebaseAppId(rawAppId);
}

function getFirebaseConfigValue(key) {
  const envValue = getExpoPublicEnv(key);
  const canonicalValue = getCanonicalFirebaseWebValue(key);
  const preferCanonicalWebConfig = shouldUseCanonicalFirebaseWebConfig();

  if (Platform.OS === 'web') {
    if (preferCanonicalWebConfig && canonicalValue) return canonicalValue;
    if (key === 'EXPO_PUBLIC_FIREBASE_APP_ID') {
      return isWebFirebaseAppId(envValue) ? envValue : canonicalValue;
    }
    return envValue || canonicalValue;
  }

  if (Platform.OS === 'ios') {
    if (preferCanonicalWebConfig && canonicalValue) return canonicalValue;
    if (key === 'EXPO_PUBLIC_FIREBASE_APP_ID') {
      return isJsSdkFirebaseAppId(envValue) ? envValue : canonicalValue;
    }
    return envValue || canonicalValue;
  }

  if (Platform.OS === 'android') {
    if (preferCanonicalWebConfig && canonicalValue) return canonicalValue;
    if (key === 'EXPO_PUBLIC_FIREBASE_APP_ID') {
      return isJsSdkFirebaseAppId(envValue) ? envValue : canonicalValue;
    }
    return envValue || canonicalValue;
  }

  return envValue || canonicalValue;
}

const firebaseConfig = {
  apiKey: getFirebaseConfigValue('EXPO_PUBLIC_FIREBASE_API_KEY') || '',
  authDomain: getFirebaseConfigValue('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN') || '',
  projectId: getFirebaseConfigValue('EXPO_PUBLIC_FIREBASE_PROJECT_ID') || '',
  storageBucket: getFirebaseConfigValue('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET') || '',
  messagingSenderId: getFirebaseConfigValue('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID') || '',
  appId: getFirebaseConfigValue('EXPO_PUBLIC_FIREBASE_APP_ID') || '',
  measurementId: getFirebaseConfigValue('EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID') || '',
};

function maskValue(value, keepStart = 6, keepEnd = 4) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= keepStart + keepEnd) return text;
  return `${text.slice(0, keepStart)}...${text.slice(-keepEnd)}`;
}

function getAppIdPlatform(value) {
  const text = String(value || '');
  if (text.includes(':web:')) return 'web';
  if (text.includes(':ios:')) return 'ios';
  if (text.includes(':android:')) return 'android';
  return 'unknown';
}

export function getFirebaseConfigDebugInfo() {
  return {
    platform: Platform.OS,
    projectId: String(firebaseConfig.projectId || ''),
    authDomain: String(firebaseConfig.authDomain || ''),
    appIdHint: maskValue(firebaseConfig.appId, 14, 8),
    appIdPlatform: getAppIdPlatform(firebaseConfig.appId),
    apiKeyHint: maskValue(firebaseConfig.apiKey, 10, 4),
    storageBucket: String(firebaseConfig.storageBucket || ''),
    messagingSenderId: String(firebaseConfig.messagingSenderId || ''),
    usingJsSdkFallback: false,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeoutId = null;
  try {
    if (controller) {
      timeoutId = setTimeout(() => {
        try { controller.abort(); } catch (_) {}
      }, timeoutMs);
    }
    const response = await fetch(url, {
      ...options,
      ...(controller ? { signal: controller.signal } : {}),
    });
    return response;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function probeFirebaseEndpoint(name, url, options) {
  try {
    const response = await fetchWithTimeout(url, options, 8000);
    let body = '';
    try {
      body = await response.text();
    } catch (_) {
      body = '';
    }
    return {
      name,
      ok: response.ok,
      status: Number(response.status || 0),
      bodyHint: maskValue(body.replace(/\s+/g, ' ').trim(), 80, 0),
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      errorName: String(error?.name || ''),
      errorMessage: String(error?.message || error || ''),
    };
  }
}

async function probeFirebaseJsonEndpoint(name, url, options) {
  try {
    const response = await fetchWithTimeout(url, options, 8000);
    let json = null;
    try {
      json = await response.json();
    } catch (_) {
      json = null;
    }
    return {
      name,
      ok: response.ok,
      status: Number(response.status || 0),
      json,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      errorName: String(error?.name || ''),
      errorMessage: String(error?.message || error || ''),
      json: null,
    };
  }
}

export async function probeFirebaseAuthNetwork() {
  const apiKey = String(firebaseConfig.apiKey || '').trim();
  const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
  const tokenUrl = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`;

  const [identityToolkit, secureExchange] = await Promise.all([
    probeFirebaseEndpoint('identityToolkit', signInUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'probe@communitybridge.app', password: 'invalid', returnSecureToken: true }),
    }),
    probeFirebaseEndpoint('secureToken', tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=invalid',
    }),
  ]);

  return {
    config: getFirebaseConfigDebugInfo(),
    identityToolkit,
    secureExchange,
  };
}

export async function probeFirebasePasswordSignIn(email, password) {
  const apiKey = String(firebaseConfig.apiKey || '').trim();
  const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;

  const result = await probeFirebaseJsonEndpoint('passwordSignIn', signInUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim(),
      password: String(password || ''),
      returnSecureToken: true,
    }),
  });

  return {
    name: result.name,
    ok: result.ok,
    status: result.status,
    errorMessage: String(result?.json?.error?.message || result?.errorMessage || ''),
    localIdHint: maskValue(result?.json?.localId || '', 6, 4),
  };
}

export async function createFirebaseUserWithPasswordViaRest(email, password) {
  const apiKey = String(firebaseConfig.apiKey || '').trim();
  const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`;

  const result = await probeFirebaseJsonEndpoint('passwordSignUp', signUpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: String(email || '').trim(),
      password: String(password || ''),
      returnSecureToken: true,
    }),
  });

  return {
    name: result.name,
    ok: result.ok,
    status: result.status,
    errorMessage: String(result?.json?.error?.message || result?.errorMessage || ''),
    localIdHint: maskValue(result?.json?.localId || '', 6, 4),
  };
}

const required = ['apiKey', 'projectId', 'appId'];
const missing = required.filter((k) => !firebaseConfig[k]);
if (missing.length) {
  // Don’t crash the app at import-time; AuthContext will surface a friendly error.
  try {
    console.warn(`[firebase] Missing Firebase config: ${missing.join(', ')}`);
  } catch (_) {}
}

const APP_GLOBAL_KEY = '__bb_firebase_app_instance__';
const APP_ERROR_GLOBAL_KEY = '__bb_firebase_app_init_error__';

function getFirebaseApp() {
  try {
    const cached = globalThis?.[APP_GLOBAL_KEY];
    if (cached) return cached;
  } catch (_) {}

  // If config is obviously missing, avoid creating a broken app instance.
  if (missing.length) {
    const err = new Error(`Firebase config missing: ${missing.join(', ')}`);
    err.code = 'BB_FIREBASE_CONFIG_MISSING';
    try {
      if (globalThis) {
        globalThis[APP_GLOBAL_KEY] = null;
        globalThis[APP_ERROR_GLOBAL_KEY] = err;
      }
    } catch (_) {}
    return null;
  }

  let app = null;
  let initErr = null;

  try {
    if (getApps().length) {
      app = getApp();
    } else {
      initializeApp(firebaseConfig);
      app = getApp();
    }
  } catch (e) {
    initErr = e || new Error('Firebase app initialization failed');
    app = null;
    try {
      console.warn('[firebase] App initialization failed', initErr);
    } catch (_) {}
  }

  try {
    if (globalThis) {
      globalThis[APP_GLOBAL_KEY] = app;
      globalThis[APP_ERROR_GLOBAL_KEY] = initErr;
    }
  } catch (_) {}

  return app;
}

export function getFirebaseAppInitError() {
  try {
    return globalThis?.[APP_ERROR_GLOBAL_KEY] || null;
  } catch (_) {
    return null;
  }
}

export const firebaseApp = getFirebaseApp();

async function initWebAppCheckMaybe(app) {
  try {
    if (!app) return;
    if (Platform.OS !== 'web') return;

    const enabledFlag = parseBooleanLike(getExpoPublicEnv('EXPO_PUBLIC_ENABLE_APP_CHECK'));
    // In local dev, default App Check to OFF unless explicitly enabled.
    // This avoids reCAPTCHA failures (ad blockers, localhost, CSP) from
    // spamming logs and interfering with auth/network requests.
    if ((typeof __DEV__ !== 'undefined' && __DEV__) && enabledFlag !== true) return;

    if (enabledFlag === false) return;

    const siteKey = String(getExpoPublicEnv('EXPO_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY') || '').trim();
    if (!siteKey) return;

    const debugToken = String(getExpoPublicEnv('EXPO_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN') || '').trim();
    if (debugToken) {
      try {
        globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken === 'true' ? true : debugToken;
      } catch (_) {
        // ignore
      }
    }

    const mod = await import('firebase/app-check');
    const initializeAppCheck = mod.initializeAppCheck || mod.default?.initializeAppCheck;
    const ReCaptchaV3Provider = mod.ReCaptchaV3Provider || mod.default?.ReCaptchaV3Provider;
    if (typeof initializeAppCheck !== 'function' || typeof ReCaptchaV3Provider !== 'function') return;

    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
      try {
        console.log('[firebase] App Check enabled (web)');
      } catch (_) {}
    } catch (e) {
      // ignore "already exists" and similar initialization errors
      try {
        console.warn('[firebase] App Check init skipped', e);
      } catch (_) {}
    }
  } catch (e) {
    try {
      console.warn('[firebase] App Check init failed', e);
    } catch (_) {}
  }
}

// Fire-and-forget: App Check just needs to be initialized early.
void initWebAppCheckMaybe(firebaseApp);

const AUTH_GLOBAL_KEY = '__bb_firebase_auth_instance__';
const AUTH_ERROR_GLOBAL_KEY = '__bb_firebase_auth_init_error__';
const AUTH_INIT_ATTEMPTED_GLOBAL_KEY = '__bb_firebase_auth_init_attempted__';
const AUTH_REGISTERED_GLOBAL_KEY = '__bb_firebase_auth_registered__';
let authInstance = globalThis?.[AUTH_GLOBAL_KEY];
let authInitError = globalThis?.[AUTH_ERROR_GLOBAL_KEY] || null;

function ensureReactNativeAuthRegistered() {
  // Firebase 10.x in this app exposes `firebase/auth` and `firebase/auth/cordova`,
  // not the older internal `@firebase/auth` RN path. On native, explicitly loading
  // the Cordova/native-friendly auth entry ensures the auth component is registered
  // before initializeAuth()/getAuth() run.
  if (Platform.OS === 'web') return true;

  try {
    if (globalThis?.[AUTH_REGISTERED_GLOBAL_KEY]) return true;
  } catch (_) {}

  try {
    // eslint-disable-next-line global-require
    require('firebase/auth/cordova');
    try {
      if (globalThis) globalThis[AUTH_REGISTERED_GLOBAL_KEY] = true;
    } catch (_) {}
    return true;
  } catch (e) {
    try {
      // eslint-disable-next-line global-require
      require('firebase/auth');
      try {
        if (globalThis) globalThis[AUTH_REGISTERED_GLOBAL_KEY] = true;
      } catch (_) {}
      return true;
    } catch (fallbackError) {
      const err = fallbackError || e || new Error('Failed to load a native Firebase Auth entry');
      try {
        console.warn('[firebase] Failed to register React Native Auth component', err);
      } catch (_) {}
      authInitError = err;
      try {
        if (globalThis) globalThis[AUTH_ERROR_GLOBAL_KEY] = err;
      } catch (_) {}
      return false;
    }
  }
}

function isAuthComponentNotRegisteredError(e) {
  try {
    const msg = String(e?.message || '');
    return msg.includes('Component auth has not been registered yet');
  } catch (_) {
    return false;
  }
}

function markAuthInitAttempted() {
  try {
    if (globalThis) globalThis[AUTH_INIT_ATTEMPTED_GLOBAL_KEY] = true;
  } catch (_) {}
}

function hasAuthInitBeenAttempted() {
  try {
    return Boolean(globalThis?.[AUTH_INIT_ATTEMPTED_GLOBAL_KEY]);
  } catch (_) {
    return false;
  }
}

export function getAuthInstance() {
  let inst = null;
  try {
    inst = globalThis?.[AUTH_GLOBAL_KEY] || null;
  } catch (_) {
    inst = null;
  }
  if (inst) return inst;

  const app = getFirebaseApp();
  if (!app) {
    authInitError = getFirebaseAppInitError() || new Error('Firebase App is not initialized.');
    try {
      if (globalThis) {
        globalThis[AUTH_GLOBAL_KEY] = null;
        globalThis[AUTH_ERROR_GLOBAL_KEY] = authInitError;
      }
    } catch (_) {}
    return null;
  }

  // Ensure Auth is registered before calling getAuth()/initializeAuth.
  ensureReactNativeAuthRegistered();

  try {
    // Prefer explicit React Native Auth initialization to avoid web-targeted builds
    // throwing: "Component auth has not been registered yet".
    if (Platform.OS !== 'web') {
      // Native builds should require a fresh login after the app is closed.
      // Initializing Auth without AsyncStorage-backed persistence keeps the
      // session in-memory for the current launch only.
      inst = initializeAuth(getApp());
    } else {
      inst = getAuth(getApp());
    }
    authInitError = null;
  } catch (e1) {
    // If already initialized (or init fails), fall back to getAuth().
    if (isAuthComponentNotRegisteredError(e1) && !hasAuthInitBeenAttempted()) {
      markAuthInitAttempted();
    }
    try {
      inst = getAuth(getApp());
      authInitError = null;
    } catch (e2) {
      authInitError = e2 || e1 || new Error('Firebase Auth initialization failed');
      inst = null;
    }
    try {
      console.warn('[firebase] Auth initialization failed', authInitError);
    } catch (_) {}
  }

  try {
    if (globalThis) {
      globalThis[AUTH_GLOBAL_KEY] = inst;
      globalThis[AUTH_ERROR_GLOBAL_KEY] = authInitError;
    }
  } catch (_) {
    // ignore
  }

  return inst;
}

export function getAuthInitError() {
  try {
    return globalThis?.[AUTH_ERROR_GLOBAL_KEY] || authInitError || null;
  } catch (_) {
    return authInitError || null;
  }
}

export const auth = getAuthInstance();
export const db = firebaseApp ? getFirestore(firebaseApp) : null;
export const storage = firebaseApp ? getStorage(firebaseApp) : null;

const region = getExpoPublicEnv('EXPO_PUBLIC_FIREBASE_FUNCTIONS_REGION') || 'us-central1';
export const functions = firebaseApp ? getFunctions(firebaseApp, region) : null;
