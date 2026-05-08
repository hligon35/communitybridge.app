import AsyncStorage from '@react-native-async-storage/async-storage';

export const ARRIVAL_RUNTIME_STATE_KEY = 'arrival_runtime_state_v2';
export const DEFAULT_WINDOW_MIN = 30;
export const DEFAULT_WINDOW_AFTER_MIN = 0;
export const APPROACHING_BUFFER_MILES = 0.25;
export const ARRIVAL_RADIUS_MIN_MILES = 0.2;
export const ARRIVAL_RADIUS_MAX_MILES = 0.3;
export const EXIT_GRACE_MS = 5 * 60 * 1000;
export const HEARTBEAT_MINUTES = [20, 10, 5];
export const FOREGROUND_POLL_INTERVAL_MS = 60 * 1000;
export const BACKGROUND_TIME_INTERVAL_MS = 5 * 60 * 1000;
export const BACKGROUND_DISTANCE_INTERVAL_METERS = 250;
export const BACKGROUND_DEFERRED_INTERVAL_MS = 5 * 60 * 1000;
export const BACKGROUND_DEFERRED_DISTANCE_METERS = 500;

function safeString(value) {
  return String(value || '').trim();
}

function safeLower(value) {
  return safeString(value).toLowerCase();
}

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch (_) {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeIdList(values) {
  const input = Array.isArray(values) ? values : [values];
  const out = new Set();
  input.forEach((entry) => {
    if (Array.isArray(entry)) {
      entry.forEach((inner) => {
        const id = safeString(inner?.id || inner?.uid || inner);
        if (id) out.add(id);
      });
      return;
    }
    const id = safeString(entry?.id || entry?.uid || entry);
    if (id) out.add(id);
  });
  return Array.from(out);
}

export function parseIso(value) {
  try {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch (_) {
    return null;
  }
}

export function nowIso() {
  try {
    return new Date().toISOString();
  } catch (_) {
    return '';
  }
}

export function isWithinArrivalMonitorWindow(targetDate, now = new Date(), before = DEFAULT_WINDOW_MIN, after = DEFAULT_WINDOW_AFTER_MIN) {
  if (!targetDate) return false;
  const start = new Date(targetDate.getTime() - before * 60000);
  const end = new Date(targetDate.getTime() + after * 60000);
  return now >= start && now <= end;
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineMiles(a, b) {
  if (!a || !b) return null;
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return null;
  const radiusMiles = 3958.7613;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aa = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return radiusMiles * c;
}

function collectIdsFromObject(source) {
  if (!source || typeof source !== 'object') return [];
  return normalizeIdList([
    source.therapistId,
    source.staffId,
    source.staffUid,
    source.providerId,
    source.assignedStaffId,
    source.assignedProviderId,
    source.amTherapistId,
    source.pmTherapistId,
    source.bcaTherapistId,
    source.bcbaId,
    source.recipientIds,
    source.recipients,
    source.assignedABA,
    source.assignedTherapists,
    source.assignedStaff,
    source.staffIds,
    source.therapistIds,
  ]);
}

export function collectArrivalRecipientIds(...sources) {
  const out = new Set();
  sources.forEach((source) => {
    collectIdsFromObject(source).forEach((id) => out.add(id));
  });
  return Array.from(out);
}

export function normalizeArrivalOrgConfig(raw) {
  const lat = Number(raw?.lat);
  const lng = Number(raw?.lng);
  const configuredRadius = Number(raw?.dropZoneMiles);
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
  const hasRadius = Number.isFinite(configuredRadius) && configuredRadius > 0;
  if (!hasLocation || !hasRadius) {
    return {
      hasConfig: false,
      org: null,
      arrivalRadiusMiles: null,
      approachingRadiusMiles: null,
    };
  }
  const arrivalRadiusMiles = clamp(configuredRadius, ARRIVAL_RADIUS_MIN_MILES, ARRIVAL_RADIUS_MAX_MILES);
  return {
    hasConfig: true,
    org: { lat, lng },
    arrivalRadiusMiles,
    approachingRadiusMiles: arrivalRadiusMiles + APPROACHING_BUFFER_MILES,
  };
}

export function buildArrivalWindowsForUser({ user, children = [] } = {}) {
  const windows = [];
  const role = safeLower(user?.role);
  const actorName = safeString(user?.name || user?.displayName || user?.fullName);

  if (role === 'parent') {
    (Array.isArray(children) ? children : []).forEach((child) => {
      const childId = safeString(child?.id);
      const childName = safeString(child?.name || child?.fullName || child?.firstName);
      const upcoming = Array.isArray(child?.upcoming) ? child.upcoming : [];
      upcoming.forEach((event) => {
        const startISO = safeString(event?.whenISO || event?.startISO);
        if (!startISO) return;
        windows.push({
          role,
          childId: childId || undefined,
          childName: childName || undefined,
          eventId: safeString(event?.id) || undefined,
          startISO,
          actorName,
          parentName: actorName || undefined,
          recipientIds: collectArrivalRecipientIds(child, event),
        });
      });
    });
    return windows;
  }

  if (role === 'therapist') {
    const shifts = Array.isArray(user?.shifts) ? user.shifts : [];
    shifts.forEach((shift) => {
      const startISO = safeString(shift?.startISO || shift?.whenISO);
      if (!startISO) return;
      windows.push({
        role,
        shiftId: safeString(shift?.id) || undefined,
        childId: safeString(shift?.childId) || undefined,
        childName: safeString(shift?.childName || shift?.learnerName) || undefined,
        eventId: safeString(shift?.eventId) || undefined,
        startISO,
        actorName,
        therapistName: actorName || undefined,
        recipientIds: collectArrivalRecipientIds(shift),
      });
    });
  }

  return windows;
}

export function getActiveArrivalWindows(windows = [], now = new Date()) {
  return (Array.isArray(windows) ? windows : []).filter((entry) => {
    const start = parseIso(entry?.startISO || entry?.whenISO);
    return !!start && isWithinArrivalMonitorWindow(start, now);
  });
}

export function buildArrivalSessionKey(window, actorId = '') {
  const role = safeLower(window?.role);
  const scopedActorId = safeString(actorId || window?.userId || window?.actorId);
  const childId = safeString(window?.childId);
  const eventId = safeString(window?.eventId);
  const shiftId = safeString(window?.shiftId);
  const startISO = safeString(window?.startISO || window?.whenISO || window?.sessionStart);
  if (role === 'parent') {
    return ['arrival', role, scopedActorId, childId, eventId, startISO].filter(Boolean).join(':');
  }
  return ['arrival', role || 'user', scopedActorId, shiftId || childId, startISO].filter(Boolean).join(':');
}

function getMinutesUntilStart(startDate, now) {
  if (!startDate) return null;
  return Math.ceil((startDate.getTime() - now.getTime()) / 60000);
}

function selectHeartbeatMinute(heartbeatSent, minutesUntilStart) {
  if (!Number.isFinite(minutesUntilStart) || minutesUntilStart <= 0) return null;
  const sentMap = heartbeatSent && typeof heartbeatSent === 'object' ? heartbeatSent : {};
  const thresholds = HEARTBEAT_MINUTES.slice().sort((a, b) => a - b);
  return thresholds.find((threshold) => minutesUntilStart <= threshold && !sentMap[String(threshold)]);
}

function buildEventPayload({
  eventType,
  heartbeatMinute,
  window,
  actorId,
  actorName,
  actorRole,
  source,
  startISO,
  currentIso,
  location,
  orgConfig,
  distanceMiles,
  minutesUntilStart,
  sessionKey,
}) {
  return {
    source,
    eventType,
    heartbeatMinute: heartbeatMinute != null ? Number(heartbeatMinute) : undefined,
    sessionKey,
    sessionStart: startISO,
    when: startISO,
    detectedAt: currentIso,
    userId: safeString(actorId) || undefined,
    role: safeLower(actorRole || window?.role) || undefined,
    actorName: safeString(actorName || window?.actorName) || undefined,
    parentName: safeString(window?.parentName) || undefined,
    therapistName: safeString(window?.therapistName) || undefined,
    childId: safeString(window?.childId) || undefined,
    childName: safeString(window?.childName) || undefined,
    eventId: safeString(window?.eventId) || undefined,
    shiftId: safeString(window?.shiftId) || undefined,
    recipientIds: normalizeIdList(window?.recipientIds),
    lat: Number.isFinite(Number(location?.lat)) ? Number(location.lat) : undefined,
    lng: Number.isFinite(Number(location?.lng)) ? Number(location.lng) : undefined,
    accuracy: Number.isFinite(Number(location?.accuracy)) ? Number(location.accuracy) : undefined,
    orgLat: orgConfig?.org?.lat,
    orgLng: orgConfig?.org?.lng,
    dropZoneMiles: orgConfig?.arrivalRadiusMiles,
    arrivalRadiusMiles: orgConfig?.arrivalRadiusMiles,
    approachingRadiusMiles: orgConfig?.approachingRadiusMiles,
    distanceMiles,
    minutesUntilStart: Number.isFinite(minutesUntilStart) ? minutesUntilStart : undefined,
  };
}

export function evaluateArrivalWindows({
  windows = [],
  org,
  location,
  actorId,
  actorRole,
  actorName,
  previousState = {},
  now = new Date(),
  source = 'foreground',
} = {}) {
  const activeWindows = getActiveArrivalWindows(windows, now);
  const nextState = {};
  const events = [];
  const currentIso = now.toISOString();
  const orgConfig = normalizeArrivalOrgConfig(org);
  const locPoint = Number.isFinite(Number(location?.lat)) && Number.isFinite(Number(location?.lng))
    ? { lat: Number(location.lat), lng: Number(location.lng), accuracy: Number(location?.accuracy) }
    : null;
  const priorState = previousState && typeof previousState === 'object' ? previousState : {};

  activeWindows.forEach((window) => {
    const startDate = parseIso(window?.startISO || window?.whenISO || window?.sessionStart);
    if (!startDate) return;

    const startISO = startDate.toISOString();
    const sessionKey = buildArrivalSessionKey(window, actorId);
    if (!sessionKey) return;

    const prev = priorState[sessionKey] && typeof priorState[sessionKey] === 'object' ? priorState[sessionKey] : {};
    const next = {
      ...prev,
      sessionKey,
      sessionStart: startISO,
      role: safeLower(actorRole || window?.role) || undefined,
      actorId: safeString(actorId) || undefined,
      actorName: safeString(actorName || window?.actorName || prev?.actorName) || undefined,
      childId: safeString(window?.childId) || undefined,
      childName: safeString(window?.childName) || undefined,
      eventId: safeString(window?.eventId) || undefined,
      shiftId: safeString(window?.shiftId) || undefined,
      recipientIds: normalizeIdList(window?.recipientIds),
      lastEvaluatedAt: currentIso,
      outsideSince: prev?.outsideSince || null,
      heartbeatSent: prev?.heartbeatSent && typeof prev.heartbeatSent === 'object' ? { ...prev.heartbeatSent } : {},
    };

    if (!orgConfig.hasConfig || !locPoint) {
      nextState[sessionKey] = next;
      return;
    }

    const distanceMiles = haversineMiles(locPoint, orgConfig.org);
    const minutesUntilStart = getMinutesUntilStart(startDate, now);
    next.lastDistanceMiles = distanceMiles;
    next.lastSeenAt = prev?.lastSeenAt || null;

    if (!Number.isFinite(distanceMiles)) {
      nextState[sessionKey] = next;
      return;
    }

    if (distanceMiles <= orgConfig.arrivalRadiusMiles) {
      next.outsideSince = null;
      next.lastSeenAt = currentIso;

      if (prev?.status !== 'arrived') {
        next.status = 'arrived';
        next.arrivedAt = currentIso;
        events.push(buildEventPayload({
          eventType: 'arrived',
          window,
          actorId,
          actorName,
          actorRole,
          source,
          startISO,
          currentIso,
          location: locPoint,
          orgConfig,
          distanceMiles,
          minutesUntilStart,
          sessionKey,
        }));
      } else {
        next.status = 'arrived';
        const heartbeatMinute = selectHeartbeatMinute(next.heartbeatSent, minutesUntilStart);
        if (heartbeatMinute != null) {
          next.heartbeatSent[String(heartbeatMinute)] = currentIso;
          events.push(buildEventPayload({
            eventType: 'heartbeat',
            heartbeatMinute,
            window,
            actorId,
            actorName,
            actorRole,
            source,
            startISO,
            currentIso,
            location: locPoint,
            orgConfig,
            distanceMiles,
            minutesUntilStart,
            sessionKey,
          }));
        }
      }

      nextState[sessionKey] = next;
      return;
    }

    if (distanceMiles <= orgConfig.approachingRadiusMiles) {
      next.outsideSince = null;
      next.lastSeenAt = currentIso;
      if (!prev?.approachingAt || prev?.status === 'exited') {
        next.status = 'approaching';
        next.approachingAt = currentIso;
        events.push(buildEventPayload({
          eventType: 'approaching',
          window,
          actorId,
          actorName,
          actorRole,
          source,
          startISO,
          currentIso,
          location: locPoint,
          orgConfig,
          distanceMiles,
          minutesUntilStart,
          sessionKey,
        }));
      } else {
        next.status = prev?.status === 'arrived' ? 'arrived' : 'approaching';
      }

      nextState[sessionKey] = next;
      return;
    }

    if (prev?.status === 'arrived' || prev?.status === 'approaching') {
      const outsideSince = prev?.outsideSince || currentIso;
      next.outsideSince = outsideSince;
      const outsideAt = parseIso(outsideSince);
      if (outsideAt && (now.getTime() - outsideAt.getTime()) >= EXIT_GRACE_MS) {
        next.status = 'exited';
        next.exitedAt = currentIso;
        next.lastSeenAt = currentIso;
        events.push(buildEventPayload({
          eventType: 'exit',
          window,
          actorId,
          actorName,
          actorRole,
          source,
          startISO,
          currentIso,
          location: locPoint,
          orgConfig,
          distanceMiles,
          minutesUntilStart,
          sessionKey,
        }));
      } else {
        next.status = prev?.status;
      }
    } else {
      next.status = prev?.status || 'idle';
    }

    nextState[sessionKey] = next;
  });

  return {
    nextState,
    events,
    activeWindows,
  };
}

export async function readArrivalRuntimeState() {
  try {
    const raw = await AsyncStorage.getItem(ARRIVAL_RUNTIME_STATE_KEY);
    const parsed = safeJsonParse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

export async function writeArrivalRuntimeState(state) {
  try {
    const next = state && typeof state === 'object' ? state : {};
    await AsyncStorage.setItem(ARRIVAL_RUNTIME_STATE_KEY, JSON.stringify(next));
  } catch (_) {
    // ignore
  }
}