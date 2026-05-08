import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Api from '../Api';
import { useData } from '../DataContext';
import { useAuth } from '../AuthContext';
import { setArrivalBackgroundState, startArrivalBackgroundLocation, stopArrivalBackgroundLocation } from '../utils/arrivalBackgroundLocation';
import { SETTINGS_KEYS, readBooleanSetting, readJsonSetting, subscribeToSetting } from '../utils/appSettings';
import {
  buildArrivalWindowsForUser,
  evaluateArrivalWindows,
  FOREGROUND_POLL_INTERVAL_MS,
  normalizeArrivalOrgConfig,
  readArrivalRuntimeState,
  writeArrivalRuntimeState,
} from '../utils/arrivalDetection';

const ARRIVAL_KEY = SETTINGS_KEYS.arrivalEnabled;
const BUSINESS_ADDR_KEY = SETTINGS_KEYS.businessAddress;
const ORG_ARRIVAL_KEY = SETTINGS_KEYS.orgArrivalEnabled;

export default function useArrivalDetector() {
  const { children } = useData();
  const { user } = useAuth();
  const intervalRef = useRef(null);
  const locationPermissionRef = useRef(null);
  const bgRef = useRef({ active: false, userId: null });
  const appState = useRef(AppState.currentState);
  const [enabled, setEnabled] = useState(false);
  const [orgEnabled, setOrgEnabled] = useState(true);
  const [business, setBusiness] = useState(null);

  function _buildBackgroundWindows() {
    return buildArrivalWindowsForUser({ user, children });
  }

  function _buildBackgroundOrg() {
    const config = normalizeArrivalOrgConfig(business);
    if (!config.hasConfig) return null;
    return {
      lat: config.org.lat,
      lng: config.org.lng,
      dropZoneMiles: config.arrivalRadiusMiles,
    };
  }

  useEffect(() => {
    let mounted = true;
    async function refreshFromStorage() {
      try {
        const a = await readBooleanSetting(ARRIVAL_KEY, false);
        const o = await readBooleanSetting(ORG_ARRIVAL_KEY, true);
        const bRaw = await readJsonSetting(BUSINESS_ADDR_KEY, null);
        if (!mounted) return;
        setEnabled(!!a);
        setOrgEnabled(!!o);
        if (bRaw) setBusiness(JSON.parse(bRaw));

        // Prefer server-backed org settings when available (keeps all devices consistent).
        try {
          const remote = await Api.getOrgSettings();
          const item = remote && remote.ok ? remote.item : null;
          if (item && typeof item === 'object') {
            if (typeof item.orgArrivalEnabled === 'boolean') setOrgEnabled(!!item.orgArrivalEnabled);
            if (typeof item.lat === 'number' && typeof item.lng === 'number') {
              setBusiness({
                address: item.address || '',
                lat: item.lat,
                lng: item.lng,
                dropZoneMiles: typeof item.dropZoneMiles === 'number' ? item.dropZoneMiles : undefined,
              });
            }
          }
        } catch (e) {
          // ignore; stay with local settings
        }
      } catch (e) {
        // ignore
      }
    }

    refreshFromStorage();

    const unsubArrival = subscribeToSetting(ARRIVAL_KEY, (value) => setEnabled(!!value));
    const unsubOrgArrival = subscribeToSetting(ORG_ARRIVAL_KEY, (value) => setOrgEnabled(value !== false));
    const unsubBusiness = subscribeToSetting(BUSINESS_ADDR_KEY, (value) => {
      setBusiness(value && typeof value === 'object' ? value : null);
    });

    const sub = AppState.addEventListener ? AppState.addEventListener('change', (next) => _handleAppState(next, refreshFromStorage)) : null;
    return () => {
      mounted = false;
      try { unsubArrival(); } catch (_) {}
      try { unsubOrgArrival(); } catch (_) {}
      try { unsubBusiness(); } catch (_) {}
      if (sub && sub.remove) sub.remove();
    };
  }, []);

  useEffect(() => {
    const effectiveEnabled = enabled && orgEnabled;
    if (!effectiveEnabled) {
      _stopInterval();
      // Best-effort stop; do not block UI if it fails.
      stopArrivalBackgroundLocation().catch(() => {});
      bgRef.current = { active: false, userId: null };
      return;
    }

    // Keep background task aligned with the latest schedule + org drop-zone.
    // If we can't build windows yet, background pings are suppressed.
    if (Platform.OS !== 'web') {
      setArrivalBackgroundState({
        org: _buildBackgroundOrg(),
        windows: _buildBackgroundWindows(),
      }).catch(() => {});
    }

    // Start background location updates when arrival detection is enabled.
    // This requires a rebuild and the user granting "Always" location permission.
    if (user && Platform.OS !== 'web') {
      const uid = user.id;
      if (!bgRef.current.active || bgRef.current.userId !== uid) {
        bgRef.current = { active: true, userId: uid };
        const role = (user.role || '').toString().toLowerCase();
        startArrivalBackgroundLocation({ userId: uid, role }).catch(() => {});
      }
    }

    // start checking periodically when enabled
    _evaluateAndSchedule();
    return () => { _stopInterval(); };
  }, [enabled, orgEnabled, children, user, business]);

  function _handleAppState(next, refreshFromStorage) {
    appState.current = next;
    // If app becomes active, evaluate windows immediately
    if (next === 'active') {
      locationPermissionRef.current = null;
      try { if (typeof refreshFromStorage === 'function') refreshFromStorage(); } catch (e) {}
      _evaluateAndSchedule();
    }
  }

  function _stopInterval() {
    try { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } } catch (e) {}
  }

  async function _getLocation() {
    try {
      // dynamic import to avoid crashing when expo-location not installed
      const Location = require('expo-location');
      let granted = locationPermissionRef.current === true;
      if (!granted) {
        const existing = await Location.getForegroundPermissionsAsync();
        if (existing?.granted) {
          granted = true;
          locationPermissionRef.current = true;
        } else if (existing?.canAskAgain === false) {
          locationPermissionRef.current = false;
          return null;
        } else {
          const requested = await Location.requestForegroundPermissionsAsync();
          granted = !!requested?.granted;
          locationPermissionRef.current = granted ? true : false;
        }
      }
      if (!granted) return null;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
    } catch (e) {
      console.warn('arrival: location failed', e?.message || e);
      return null;
    }
  }

  async function _ping(payload) {
    try { await Api.pingArrival(payload); } catch (e) { console.warn('arrival ping failed', e?.message || e); }
  }

  async function _processArrivalWindows() {
    const windows = _buildBackgroundWindows();
    const runtimeState = await readArrivalRuntimeState();
    const location = await _getLocation();
    const result = evaluateArrivalWindows({
      windows,
      org: _buildBackgroundOrg(),
      location,
      actorId: user?.id,
      actorRole: user?.role,
      actorName: user?.name || user?.displayName,
      previousState: runtimeState,
      source: 'foreground',
    });
    await writeArrivalRuntimeState(result.nextState);
    for (const event of result.events) {
      await _ping(event);
    }
    return result;
  }

  async function _evaluateAndSchedule() {
    try {
      if (!enabled || !orgEnabled) {
        _stopInterval();
        await writeArrivalRuntimeState({});
        return;
      }
      if (!user) return;

      const result = await _processArrivalWindows();
      const shouldPoll = Array.isArray(result?.activeWindows) && result.activeWindows.length > 0;

      if (shouldPoll) {
        if (!intervalRef.current) {
          intervalRef.current = setInterval(async () => {
            if (appState.current !== 'active') return; // only when active
            await _processArrivalWindows();
          }, FOREGROUND_POLL_INTERVAL_MS);
        }
      } else {
        _stopInterval();
        await writeArrivalRuntimeState({});
      }
    } catch (e) {
      console.warn('arrival evaluate failed', e?.message || e);
    }
  }

  return { enabled, business };
}
