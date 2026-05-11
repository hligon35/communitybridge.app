import AsyncStorage from '@react-native-async-storage/async-storage';

export const SETTINGS_KEYS = {
  arrivalEnabled: 'settings_arrival_enabled_v1',
  orgArrivalEnabled: 'settings_arrival_org_enabled_v1',
  pushEnabled: 'settings_push_enabled_v1',
  pushChats: 'settings_push_chats_v1',
  pushTimelinePosts: 'settings_push_timeline_posts_v1',
  pushMentionsPosts: 'settings_push_mentions_posts_v1',
  pushTagsPosts: 'settings_push_tags_posts_v1',
  pushRepliesComments: 'settings_push_replies_comments_v1',
  pushMentionsComments: 'settings_push_mentions_comments_v1',
  pushUpdates: 'settings_push_updates_v1',
  showEmail: 'settings_show_email_v1',
  showPhone: 'settings_show_phone_v1',
  showIds: 'settings_show_ids_v1',
  businessAddress: 'business_address_v1',
};

const listenersByKey = new Map();

function emitSettingChange(key, value) {
  const listeners = listenersByKey.get(String(key));
  if (!listeners || !listeners.size) return;
  listeners.forEach((listener) => {
    try {
      listener(value);
    } catch (_) {
      // ignore listener failures
    }
  });
}

export function subscribeToSetting(key, listener) {
  const normalizedKey = String(key);
  const listeners = listenersByKey.get(normalizedKey) || new Set();
  listeners.add(listener);
  listenersByKey.set(normalizedKey, listeners);
  return () => {
    const current = listenersByKey.get(normalizedKey);
    if (!current) return;
    current.delete(listener);
    if (!current.size) listenersByKey.delete(normalizedKey);
  };
}

export async function readBooleanSetting(key, defaultValue = false) {
  try {
    const raw = await AsyncStorage.getItem(String(key));
    if (raw == null) return !!defaultValue;
    return raw === '1';
  } catch (_) {
    return !!defaultValue;
  }
}

export async function writeBooleanSetting(key, value) {
  const normalizedValue = !!value;
  try {
    await AsyncStorage.setItem(String(key), normalizedValue ? '1' : '0');
  } catch (_) {
    // ignore storage failures; still notify in-memory listeners
  }
  emitSettingChange(String(key), normalizedValue);
  return normalizedValue;
}

export async function readJsonSetting(key, defaultValue = null) {
  try {
    const raw = await AsyncStorage.getItem(String(key));
    if (!raw) return defaultValue;
    return JSON.parse(raw);
  } catch (_) {
    return defaultValue;
  }
}

export async function writeJsonSetting(key, value) {
  try {
    await AsyncStorage.setItem(String(key), JSON.stringify(value));
  } catch (_) {
    // ignore storage failures; still notify in-memory listeners
  }
  emitSettingChange(String(key), value);
  return value;
}

export async function applyCurrentUserPrivacySettings(profile, currentUser) {
  if (!profile || !currentUser?.id || profile.id !== currentUser.id) return profile;
  const [showEmail, showPhone] = await Promise.all([
    readBooleanSetting(SETTINGS_KEYS.showEmail, true),
    readBooleanSetting(SETTINGS_KEYS.showPhone, true),
  ]);
  return {
    ...profile,
    showEmail,
    showPhone,
  };
}