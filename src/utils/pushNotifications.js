import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Api from '../Api';
import { reportErrorToSentry } from './reportError';

export const PUSH_STORAGE_KEYS = Object.freeze({
  enabled: 'settings_push_enabled_v1',
  chats: 'settings_push_chats_v1',
  timelinePosts: 'settings_push_timeline_posts_v1',
  mentionsPosts: 'settings_push_mentions_posts_v1',
  tagsPosts: 'settings_push_tags_posts_v1',
  updates: 'settings_push_updates_v1',
  token: 'push_expo_token_v1',
});

const DEFAULT_PUSH_CHANNEL_ID = 'communitybridge-alerts-v2';

function reportPushIssue(error, context = {}) {
  try {
    return reportErrorToSentry(error, {
      area: 'notifications',
      ...context,
      platform: Platform.OS,
    });
  } catch (_) {
    return '';
  }
}

function getNotificationPermissionRequestOptions() {
  if (Platform.OS === 'ios') {
    return {
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    };
  }
  return undefined;
}

let notificationsLib = null;
function getNotificationsLib() {
  if (notificationsLib) return notificationsLib;
  try {
    // Lazy require so Expo Go can run without triggering warnings at import-time.
    // eslint-disable-next-line global-require
    notificationsLib = require('expo-notifications');
    return notificationsLib;
  } catch (e) {
    return null;
  }
}

let deviceLib = null;
function getDeviceLib() {
  if (deviceLib) return deviceLib;
  try {
    // eslint-disable-next-line global-require
    deviceLib = require('expo-device');
    return deviceLib;
  } catch (e) {
    return null;
  }
}

function isExpoGo() {
  try {
    // eslint-disable-next-line global-require
    const ConstantsModule = require('expo-constants');
    const Constants = ConstantsModule?.default || ConstantsModule;
    return String(Constants?.appOwnership || '').toLowerCase() === 'expo';
  } catch (e) {
    return false;
  }
}

// Read EAS projectId from app.json so getExpoPushTokenAsync works reliably in EAS builds.
const EAS_PROJECT_ID = (() => {
  try {
    const cfg = require('../../app.json');
    return cfg?.expo?.extra?.eas?.projectId || '';
  } catch (e) {
    return '';
  }
})();

export function configureNotificationHandling() {
  if (Platform.OS === 'web') return;
  if (isExpoGo()) return;

  // Show alerts by default when a notification arrives.
  const Notifications = getNotificationsLib();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  if (Platform.OS === 'android' && typeof Notifications.setNotificationChannelAsync === 'function') {
    Notifications.setNotificationChannelAsync(DEFAULT_PUSH_CHANNEL_ID, {
      name: 'CommunityBridge alerts',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 200, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    }).catch(() => {});
  }
}

export async function setApplicationBadgeCountAsync(count) {
  if (Platform.OS === 'web') {
    return { ok: false, reason: 'web-unsupported' };
  }
  if (isExpoGo()) {
    return { ok: false, reason: 'expo-go' };
  }

  const Notifications = getNotificationsLib();
  if (!Notifications || typeof Notifications.setBadgeCountAsync !== 'function') {
    return { ok: false, reason: 'missing-deps' };
  }

  try {
    const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Math.trunc(Number(count))) : 0;
    const applied = await Notifications.setBadgeCountAsync(safeCount);
    return { ok: !!applied, count: safeCount };
  } catch (e) {
    return { ok: false, reason: 'set-badge-failed', message: e?.message || String(e) };
  }
}

export async function registerForExpoPushTokenAsync() {
  if (Platform.OS === 'web') {
    return { ok: false, reason: 'web-unsupported' };
  }
  if (isExpoGo()) {
    return { ok: false, reason: 'expo-go' };
  }

  const Device = getDeviceLib();
  const Notifications = getNotificationsLib();
  if (!Device || !Notifications) {
    return { ok: false, reason: 'missing-deps' };
  }

  if (!Device.isDevice) {
    return { ok: false, reason: 'not-device' };
  }

  // iOS will prompt; Android depends on OS version.
  const existing = await Notifications.getPermissionsAsync();
  let status = existing?.status;
  let requested = null;
  if (status !== 'granted') {
    requested = await Notifications.requestPermissionsAsync(getNotificationPermissionRequestOptions());
    status = requested?.status;
  }

  if (status !== 'granted') {
    reportPushIssue(new Error('Push notification permission not granted.'), {
      action: 'push_permission',
      permissionStatus: String(status || ''),
      canAskAgain: Boolean(requested?.canAskAgain ?? existing?.canAskAgain),
      hasIosSoundPermission: Boolean(requested?.ios?.allowsSound ?? existing?.ios?.allowsSound),
      hasIosAlertPermission: Boolean(requested?.ios?.allowsAlert ?? existing?.ios?.allowsAlert),
      hasIosBadgePermission: Boolean(requested?.ios?.allowsBadge ?? existing?.ios?.allowsBadge),
    });
    return { ok: false, reason: 'permission-denied' };
  }

  // Android: channel required for visible notifications.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(DEFAULT_PUSH_CHANNEL_ID, {
      name: 'CommunityBridge alerts',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 200, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync(EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined);
    return { ok: true, token: token?.data || '' };
  } catch (e) {
    reportPushIssue(e, {
      action: 'push_token',
      reason: 'token-failed',
      hasProjectId: Boolean(EAS_PROJECT_ID),
    });
    return { ok: false, reason: 'token-failed', message: e?.message || String(e) };
  }
}

async function readStoredPushPreferences() {
  const values = await AsyncStorage.multiGet([
    PUSH_STORAGE_KEYS.enabled,
    PUSH_STORAGE_KEYS.chats,
    PUSH_STORAGE_KEYS.timelinePosts,
    PUSH_STORAGE_KEYS.mentionsPosts,
    PUSH_STORAGE_KEYS.tagsPosts,
    PUSH_STORAGE_KEYS.updates,
    PUSH_STORAGE_KEYS.token,
  ]);
  const map = new Map(values || []);
  const enabledSetting = map.get(PUSH_STORAGE_KEYS.enabled);
  const enabled = enabledSetting == null ? true : enabledSetting === '1';
  return {
    enabled,
    token: String(map.get(PUSH_STORAGE_KEYS.token) || '').trim(),
    preferences: {
      chats: map.get(PUSH_STORAGE_KEYS.chats) !== '0',
      timelinePosts: map.get(PUSH_STORAGE_KEYS.timelinePosts) !== '0',
      mentionsPosts: map.get(PUSH_STORAGE_KEYS.mentionsPosts) !== '0',
      tagsPosts: map.get(PUSH_STORAGE_KEYS.tagsPosts) !== '0',
      updates: map.get(PUSH_STORAGE_KEYS.updates) !== '0',
    },
  };
}

export async function syncLoggedInDevicePushRegistration({ userId } = {}) {
  if (Platform.OS === 'web' || isExpoGo()) {
    return { ok: false, skipped: true, reason: Platform.OS === 'web' ? 'web-unsupported' : 'expo-go' };
  }

  const nextUserId = String(userId || '').trim();
  if (!nextUserId) return { ok: false, skipped: true, reason: 'missing-user' };

  const stored = await readStoredPushPreferences();
  if (!stored.enabled) {
    if (stored.token) {
      await Api.unregisterPushToken({ token: stored.token, userId: nextUserId, platform: Platform.OS }).catch(() => {});
    }
    return { ok: true, skipped: true, reason: 'push-disabled' };
  }

  let token = '';
  const registration = await registerForExpoPushTokenAsync();
  if (registration.ok && registration.token) {
    token = String(registration.token || '').trim();
    if (!token) return { ok: false, reason: 'token-missing' };
    if (token !== stored.token) {
      await AsyncStorage.setItem(PUSH_STORAGE_KEYS.token, token).catch(() => {});
    }
  } else if (stored.token) {
    token = stored.token;
  } else {
    reportPushIssue(new Error(`Push registration failed: ${registration?.reason || 'unknown'}`), {
      action: 'push_sync',
      reason: String(registration?.reason || 'unknown'),
      usedStoredToken: false,
      pushEnabled: Boolean(stored.enabled),
    });
    return registration;
  }

  try {
    await Api.registerPushToken({
      token,
      userId: nextUserId,
      platform: Platform.OS,
      enabled: true,
      preferences: stored.preferences,
    });
  } catch (e) {
    reportPushIssue(e, {
      action: 'push_register',
      hasToken: Boolean(token),
      usedStoredToken: token === stored.token,
      pushEnabled: Boolean(stored.enabled),
    });
    throw e;
  }
  return { ok: true, token };
}

export async function unregisterLoggedInDevicePushRegistration({ userId } = {}) {
  if (Platform.OS === 'web' || isExpoGo()) {
    return { ok: false, skipped: true, reason: Platform.OS === 'web' ? 'web-unsupported' : 'expo-go' };
  }

  const storedToken = String(await AsyncStorage.getItem(PUSH_STORAGE_KEYS.token).catch(() => '') || '').trim();
  const nextUserId = String(userId || '').trim();
  if (!storedToken) return { ok: true, skipped: true, reason: 'no-token' };

  await Api.unregisterPushToken({ token: storedToken, userId: nextUserId, platform: Platform.OS }).catch(() => {});
  return { ok: true, token: storedToken };
}

export default {
  configureNotificationHandling,
  setApplicationBadgeCountAsync,
  registerForExpoPushTokenAsync,
  syncLoggedInDevicePushRegistration,
  unregisterLoggedInDevicePushRegistration,
};
