import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Api from '../Api';
import {
  BACKGROUND_DEFERRED_DISTANCE_METERS,
  BACKGROUND_DEFERRED_INTERVAL_MS,
  BACKGROUND_DISTANCE_INTERVAL_METERS,
  BACKGROUND_TIME_INTERVAL_MS,
  evaluateArrivalWindows,
  normalizeArrivalOrgConfig,
  readArrivalRuntimeState,
  writeArrivalRuntimeState,
} from './arrivalDetection';

const TASK_NAME = 'ARRIVAL_BG_LOCATION_TASK_V1';

const STORAGE_ENABLED_KEY = 'arrival_bg_enabled_v1';
const STORAGE_USER_KEY = 'arrival_bg_user_v1';
const STORAGE_STATE_KEY = 'arrival_bg_state_v1';

function safeJsonParse(s) {
  try {
    return JSON.parse(String(s || ''));
  } catch (_) {
    return null;
  }
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch (_) {
    return '';
  }
}

TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  try {
    if (error) return;

    const enabled = await AsyncStorage.getItem(STORAGE_ENABLED_KEY);
    if (enabled !== '1') return;

    const userRaw = await AsyncStorage.getItem(STORAGE_USER_KEY);
    const user = safeJsonParse(userRaw) || {};

    const locations = data?.locations;
    if (!Array.isArray(locations) || locations.length === 0) return;

    const last = locations[locations.length - 1];
    const coords = last?.coords;
    if (!coords) return;

    const payload = {
      source: 'bg-location',
      at: nowIso(),
      userId: user.userId || undefined,
      role: user.role || undefined,
      lat: typeof coords.latitude === 'number' ? coords.latitude : undefined,
      lng: typeof coords.longitude === 'number' ? coords.longitude : undefined,
      accuracy: typeof coords.accuracy === 'number' ? coords.accuracy : undefined,
      altitude: typeof coords.altitude === 'number' ? coords.altitude : undefined,
      speed: typeof coords.speed === 'number' ? coords.speed : undefined,
      heading: typeof coords.heading === 'number' ? coords.heading : undefined,
    };

    // Tighten: only send pings during scheduled windows and (when configured) only inside drop-zone.
    const stateRaw = await AsyncStorage.getItem(STORAGE_STATE_KEY);
    const state = safeJsonParse(stateRaw) || {};
    const runtimeState = await readArrivalRuntimeState();
    const result = evaluateArrivalWindows({
      windows: Array.isArray(state?.windows) ? state.windows : [],
      org: normalizeArrivalOrgConfig(state?.org).hasConfig ? state.org : null,
      location: {
        lat: payload.lat,
        lng: payload.lng,
        accuracy: payload.accuracy,
      },
      actorId: user.userId || undefined,
      actorRole: user.role || undefined,
      previousState: runtimeState,
      source: 'bg-location',
    });
    await writeArrivalRuntimeState(result.nextState);

    for (const event of result.events) {
      await Api.pingArrival(event);
    }

  } catch (_) {
    // swallow
  }
});

export async function startArrivalBackgroundLocation({ userId, role } = {}) {
  if (Platform.OS === 'web') return { ok: false, reason: 'web-unsupported' };

  await AsyncStorage.setItem(STORAGE_ENABLED_KEY, '1');
  await AsyncStorage.setItem(STORAGE_USER_KEY, JSON.stringify({ userId: userId || '', role: role || '' }));

  // iOS requires foreground permission before background permission.
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg?.granted) return { ok: false, reason: 'foreground-permission-denied' };

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg?.granted) return { ok: false, reason: 'background-permission-denied' };

  const already = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
  if (already) return { ok: true, started: false };

  await Location.startLocationUpdatesAsync(TASK_NAME, {
    // Tighten battery/network: low-ish accuracy + less frequent updates.
    accuracy: Location.Accuracy.Low,
    timeInterval: BACKGROUND_TIME_INTERVAL_MS,
    distanceInterval: BACKGROUND_DISTANCE_INTERVAL_METERS,
    deferredUpdatesInterval: BACKGROUND_DEFERRED_INTERVAL_MS,
    deferredUpdatesDistance: BACKGROUND_DEFERRED_DISTANCE_METERS,
    pausesUpdatesAutomatically: true,

    // Android 8+ requires a foreground service notification for background location.
    foregroundService: {
      notificationTitle: 'CommunityBridge',
      notificationBody: 'Arrival detection is active in the background.',
    },

    // iOS-only options are safe to pass; Android ignores unknown keys.
    showsBackgroundLocationIndicator: false,
    activityType: Location.ActivityType.Other,
  });

  return { ok: true, started: true };
}

// Called from the foreground app to keep background behavior aligned with real schedules.
export async function setArrivalBackgroundState({ org, windows } = {}) {
  try {
    const clean = {
      org: org && typeof org === 'object' ? {
        lat: Number(org.lat),
        lng: Number(org.lng),
        dropZoneMiles: Number(org.dropZoneMiles),
      } : null,
      windows: Array.isArray(windows) ? windows.slice(0, 500) : [],
      updatedAt: nowIso(),
    };
    await AsyncStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(clean));
  } catch (_) {
    // ignore
  }
}

export async function stopArrivalBackgroundLocation() {
  if (Platform.OS === 'web') return { ok: true };

  await AsyncStorage.setItem(STORAGE_ENABLED_KEY, '0');
  await writeArrivalRuntimeState({});

  try {
    const started = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
    if (started) await Location.stopLocationUpdatesAsync(TASK_NAME);
  } catch (_) {
    // ignore
  }

  return { ok: true };
}

export const arrivalBackgroundTaskName = TASK_NAME;
