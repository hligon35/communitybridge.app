import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, InteractionManager, NativeModules, Platform, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Api from './Api';
import { useAuth } from './AuthContext';
import {
  seededScreenshotParents,
  seededScreenshotTherapists,
  seededScreenshotStaffWorkspacesById,
  seededScreenshotChildren,
  seededScreenshotMoodHistoryByChild,
  seededScreenshotAttendanceByDate,
  seededScreenshotAttendanceHistoryByChild,
  seededScreenshotArrivalPingsByChild,
  seededScreenshotPickupQueueByChild,
  seededScreenshotTapEventsByChild,
  seededScreenshotItemsNeededByChild,
  seededScreenshotSkillAcquisitionByChild,
  seededScreenshotBehaviorTrackingByChild,
  seededScreenshotDashboardMetrics,
  seededScreenshotTherapistDocumentationInsights,
  seededScreenshotOrganizationInsights,
  seededScreenshotMessages,
  seededScreenshotPosts,
  seededScreenshotUrgentMemos,
  seededScreenshotTimeChangeProposals,
  seededScreenshotSessionSummaries,
  seededScreenshotOrgSettings,
  seededScreenshotExportJobs,
  seededScreenshotAuditLogs,
} from './seed/screenshotSeedData';
import { countUnreadVisibleThreads, getConversationKey } from './utils/chatThreads';
import { DEMO_ROLE_IDENTITIES, getEffectiveChatIdentity } from './utils/demoIdentity';
import { isAdminRole, isBcbaRole, isOfficeAdminRole } from './core/tenant/models';
import { attachTherapistsToChildren, mergeById } from './utils/directoryState';
import { setApplicationBadgeCountAsync } from './utils/pushNotifications';
import { buildScopedStorageKeys, getStorageScopeId } from './utils/storageScope';

const DataContext = createContext(null);

export function useData() {
  return useContext(DataContext);
}

function getMessageConversationKeys(message) {
  const rawValues = [message?.threadId, message?.id];
  return Array.from(new Set(rawValues.map((value) => String(value || '').trim()).filter(Boolean)));
}

function matchesThreadKey(message, key, user) {
  const threadKey = String(key || '').trim();
  if (!threadKey) return false;
  if (getConversationKey(message, user) === threadKey) return true;
  const messageKeys = getMessageConversationKeys(message);
  if (messageKeys.includes(threadKey)) return true;
  return messageKeys.some((messageKey) => threadKey === `thread:${messageKey}`);
}

function collectThreadKeys(message, user) {
  const keys = new Set();
  const conversationKey = String(getConversationKey(message, user) || '').trim();
  if (conversationKey) keys.add(conversationKey);
  getMessageConversationKeys(message).forEach((value) => {
    keys.add(value);
    keys.add(`thread:${value}`);
  });
  return Array.from(keys).filter(Boolean);
}

function normalizeDeletedThreadsMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((accumulator, [key, deletedAt]) => {
    const normalizedKey = String(key || '').trim();
    const deletedAtMs = Date.parse(String(deletedAt || ''));
    if (normalizedKey && Number.isFinite(deletedAtMs)) accumulator[normalizedKey] = new Date(deletedAtMs).toISOString();
    return accumulator;
  }, {});
}

function filterDeletedMessages(items, deletedThreadMap, user) {
  const deletedEntries = Object.entries(normalizeDeletedThreadsMap(deletedThreadMap));
  if (!deletedEntries.length) return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).filter((message) => {
    const createdAtMs = Date.parse(String(message?.createdAt || ''));
    return !deletedEntries.some(([key, deletedAt]) => {
      const deletedAtMs = Date.parse(String(deletedAt || ''));
      if (!Number.isFinite(createdAtMs) || !Number.isFinite(deletedAtMs)) return false;
      return createdAtMs <= deletedAtMs && matchesThreadKey(message, key, user);
    });
  });
}

function deriveTherapistsFromChildren(childrenArr) {
  try {
    const ids = new Set();
    (childrenArr || []).forEach((c) => {
      const assigned = c?.assignedABA || c?.assigned_ABA || c?.assigned || [];
      if (Array.isArray(assigned)) {
        assigned.forEach((id) => {
          const s = id != null ? String(id).trim() : '';
          if (s) ids.add(s);
        });
      }
    });

    return Array.from(ids).map((id) => {
      const pretty = id.startsWith('aba-') ? `ABA ${id.replace(/^aba-/, '')}` : `Staff ${id}`;
      return {
        id,
        name: pretty,
        role: 'therapist',
        avatar: '',
        phone: '',
        email: '',
      };
    });
  } catch (e) {
    return [];
  }
}

function stripComputedChildFields(child) {
  if (!child || typeof child !== 'object') return child;
  const { amTherapist, pmTherapist, bcaTherapist, ...rest } = child;
  return rest;
}

function cloneSeedValue(value) {
  return JSON.parse(JSON.stringify(value));
}

// Note: removed legacy demo children and therapist pools so the
// directory is driven only by the dev seed toggle (seeded data)
// or persisted AsyncStorage values. When the dev seed is off and
// no persisted data exists, children/therapists will be empty arrays.

// Seeded directory: 16 students (3-5yo), with 4 siblings (same family), parents and therapists
// Directory seed data is provided from `src/seed/directorySeed.js` (imported above)

export function DataProvider({ children: reactChildren }) {
  const { user, loading, needsMfa, refreshMfaState, markMfaRequired, isDemoReviewer } = useAuth();
  const needsMfaRef = useRef(Boolean(needsMfa));
  const mfaRefreshInFlightRef = useRef(false);
  const mfaEscalatedRef = useRef(false);
  const fetchInFlightRef = useRef(null);
  const messageRefreshInFlightRef = useRef(null);
  const lastFetchAtRef = useRef(0);
  const initialSyncDoneForUserRef = useRef(null);
  const storageScopeId = useMemo(() => getStorageScopeId(user), [user?.id, user?.uid, user?.email]);
  const storageKeys = useMemo(() => buildScopedStorageKeys(user), [storageScopeId]);
  const sensitiveStorageKeys = useMemo(() => ([
    storageKeys.posts,
    storageKeys.messages,
    storageKeys.memos,
    storageKeys.children,
    storageKeys.parents,
    storageKeys.therapists,
    storageKeys.archivedThreads,
    storageKeys.threadReads,
  ]), [storageKeys]);
  useEffect(() => {
    needsMfaRef.current = Boolean(needsMfa);
    if (!needsMfa) mfaEscalatedRef.current = false;
  }, [needsMfa]);
  const [posts, setPosts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [threadReads, setThreadReads] = useState({});
  const [urgentMemos, setUrgentMemos] = useState([]);
  const [timeChangeProposals, setTimeChangeProposals] = useState([]);
  const [archivedThreads, setArchivedThreads] = useState([]);
  const [deletedThreads, setDeletedThreads] = useState({});
  const [children, setChildren] = useState([]);
  const [parents, setParents] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [blockedUserIds, setBlockedUserIds] = useState([]);
  const [chatBlockedUserIds, setChatBlockedUserIds] = useState([]);
  const [activeSeedPreset, setActiveSeedPreset] = useState('');
  const [seededSessionSummariesByChild, setSeededSessionSummariesByChild] = useState({});
  const [seededOrgSettings, setSeededOrgSettings] = useState({});
  const [seededExportJobs, setSeededExportJobs] = useState([]);
  const [seededAuditLogs, setSeededAuditLogs] = useState([]);
  const [seededMoodHistoryByChild, setSeededMoodHistoryByChild] = useState({});
  const [seededAttendanceByDate, setSeededAttendanceByDate] = useState({});
  const [seededAttendanceHistoryByChild, setSeededAttendanceHistoryByChild] = useState({});
  const [seededArrivalPingsByChild, setSeededArrivalPingsByChild] = useState({});
  const [seededPickupQueueByChild, setSeededPickupQueueByChild] = useState({});
  const [seededTapEventsByChild, setSeededTapEventsByChild] = useState({});
  const [seededItemsNeededByChild, setSeededItemsNeededByChild] = useState({});
  const [seededSkillAcquisitionByChild, setSeededSkillAcquisitionByChild] = useState({});
  const [seededBehaviorTrackingByChild, setSeededBehaviorTrackingByChild] = useState({});
  const [seededStaffWorkspacesById, setSeededStaffWorkspacesById] = useState({});
  const [seededDashboardMetrics, setSeededDashboardMetrics] = useState({});
  const [seededTherapistDocumentationInsights, setSeededTherapistDocumentationInsights] = useState(null);
  const [seededOrganizationInsights, setSeededOrganizationInsights] = useState(null);
  const [storageReady, setStorageReady] = useState(false);

  function buildScreenshotDirectory() {
    const screenshotParents = cloneSeedValue(seededScreenshotParents);
    const screenshotChildren = cloneSeedValue(seededScreenshotChildren);
    const screenshotTherapists = cloneSeedValue(seededScreenshotTherapists);
    return {
      parents: screenshotParents,
      therapists: screenshotTherapists,
      children: attachTherapistsToChildren(screenshotChildren, screenshotTherapists),
    };
  }

  function buildScreenshotSeedState() {
    const directory = buildScreenshotDirectory();
    const screenshotSessionSummariesByChild = (Array.isArray(seededScreenshotSessionSummaries) ? seededScreenshotSessionSummaries : []).reduce((accumulator, item) => {
      const childId = String(item?.childId || '').trim();
      if (!childId) return accumulator;
      if (!accumulator[childId]) accumulator[childId] = [];
      accumulator[childId].push(cloneSeedValue(item));
      return accumulator;
    }, {});
    return {
      posts: cloneSeedValue(seededScreenshotPosts),
      messages: cloneSeedValue(seededScreenshotMessages),
      threadReads: {},
      urgentMemos: cloneSeedValue(seededScreenshotUrgentMemos),
      archivedThreads: [],
      deletedThreads: {},
      timeChangeProposals: cloneSeedValue(seededScreenshotTimeChangeProposals),
      children: directory.children,
      parents: directory.parents,
      therapists: directory.therapists,
      blockedUserIds: [],
      chatBlockedUserIds: [],
      activeSeedPreset: 'screenshot',
      sessionSummariesByChild: screenshotSessionSummariesByChild,
      orgSettings: cloneSeedValue(seededScreenshotOrgSettings),
      exportJobs: cloneSeedValue(seededScreenshotExportJobs),
      auditLogs: cloneSeedValue(seededScreenshotAuditLogs),
      moodHistoryByChild: cloneSeedValue(seededScreenshotMoodHistoryByChild),
      attendanceByDate: cloneSeedValue(seededScreenshotAttendanceByDate),
      attendanceHistoryByChild: cloneSeedValue(seededScreenshotAttendanceHistoryByChild),
      arrivalPingsByChild: cloneSeedValue(seededScreenshotArrivalPingsByChild),
      pickupQueueByChild: cloneSeedValue(seededScreenshotPickupQueueByChild),
      tapEventsByChild: cloneSeedValue(seededScreenshotTapEventsByChild),
      itemsNeededByChild: cloneSeedValue(seededScreenshotItemsNeededByChild),
      skillAcquisitionByChild: cloneSeedValue(seededScreenshotSkillAcquisitionByChild),
      behaviorTrackingByChild: cloneSeedValue(seededScreenshotBehaviorTrackingByChild),
      staffWorkspacesById: cloneSeedValue(seededScreenshotStaffWorkspacesById),
      dashboardMetrics: cloneSeedValue(seededScreenshotDashboardMetrics),
      therapistDocumentationInsights: cloneSeedValue(seededScreenshotTherapistDocumentationInsights),
      organizationInsights: cloneSeedValue(seededScreenshotOrganizationInsights),
    };
  }

  function resetLocalState() {
    setPosts([]);
    setMessages([]);
    setThreadReads({});
    setUrgentMemos([]);
    setTimeChangeProposals([]);
    setArchivedThreads([]);
    setDeletedThreads({});
    setChildren([]);
    setParents([]);
    setTherapists([]);
    setBlockedUserIds([]);
    setChatBlockedUserIds([]);
    setActiveSeedPreset('');
    setSeededSessionSummariesByChild({});
    setSeededOrgSettings({});
    setSeededExportJobs([]);
    setSeededAuditLogs([]);
    setSeededMoodHistoryByChild({});
    setSeededAttendanceByDate({});
    setSeededAttendanceHistoryByChild({});
    setSeededArrivalPingsByChild({});
    setSeededPickupQueueByChild({});
    setSeededTapEventsByChild({});
    setSeededItemsNeededByChild({});
    setSeededSkillAcquisitionByChild({});
    setSeededBehaviorTrackingByChild({});
    setSeededStaffWorkspacesById({});
    setSeededDashboardMetrics({});
    setSeededTherapistDocumentationInsights(null);
    setSeededOrganizationInsights(null);
  }

  function applyLocalStateSnapshot(snapshot) {
    setPosts(Array.isArray(snapshot?.posts) ? snapshot.posts : []);
    setMessages(Array.isArray(snapshot?.messages) ? snapshot.messages : []);
    setThreadReads(snapshot?.threadReads && typeof snapshot.threadReads === 'object' ? snapshot.threadReads : {});
    setUrgentMemos(Array.isArray(snapshot?.urgentMemos) ? snapshot.urgentMemos : []);
    setArchivedThreads(Array.isArray(snapshot?.archivedThreads) ? snapshot.archivedThreads : []);
    setDeletedThreads(normalizeDeletedThreadsMap(snapshot?.deletedThreads));
    setTimeChangeProposals(Array.isArray(snapshot?.timeChangeProposals) ? snapshot.timeChangeProposals : []);
    setChildren(Array.isArray(snapshot?.children) ? snapshot.children : []);
    setParents(Array.isArray(snapshot?.parents) ? snapshot.parents : []);
    setTherapists(Array.isArray(snapshot?.therapists) ? snapshot.therapists : []);
    setBlockedUserIds(Array.isArray(snapshot?.blockedUserIds) ? snapshot.blockedUserIds : []);
    setChatBlockedUserIds(Array.isArray(snapshot?.chatBlockedUserIds) ? snapshot.chatBlockedUserIds : []);
    setActiveSeedPreset(typeof snapshot?.activeSeedPreset === 'string' ? snapshot.activeSeedPreset : '');
    setSeededSessionSummariesByChild(snapshot?.sessionSummariesByChild && typeof snapshot.sessionSummariesByChild === 'object' ? snapshot.sessionSummariesByChild : {});
    setSeededOrgSettings(snapshot?.orgSettings && typeof snapshot.orgSettings === 'object' ? snapshot.orgSettings : {});
    setSeededExportJobs(Array.isArray(snapshot?.exportJobs) ? snapshot.exportJobs : []);
    setSeededAuditLogs(Array.isArray(snapshot?.auditLogs) ? snapshot.auditLogs : []);
    setSeededMoodHistoryByChild(snapshot?.moodHistoryByChild && typeof snapshot.moodHistoryByChild === 'object' ? snapshot.moodHistoryByChild : {});
    setSeededAttendanceByDate(snapshot?.attendanceByDate && typeof snapshot.attendanceByDate === 'object' ? snapshot.attendanceByDate : {});
    setSeededAttendanceHistoryByChild(snapshot?.attendanceHistoryByChild && typeof snapshot.attendanceHistoryByChild === 'object' ? snapshot.attendanceHistoryByChild : {});
    setSeededArrivalPingsByChild(snapshot?.arrivalPingsByChild && typeof snapshot.arrivalPingsByChild === 'object' ? snapshot.arrivalPingsByChild : {});
    setSeededPickupQueueByChild(snapshot?.pickupQueueByChild && typeof snapshot.pickupQueueByChild === 'object' ? snapshot.pickupQueueByChild : {});
    setSeededTapEventsByChild(snapshot?.tapEventsByChild && typeof snapshot.tapEventsByChild === 'object' ? snapshot.tapEventsByChild : {});
    setSeededItemsNeededByChild(snapshot?.itemsNeededByChild && typeof snapshot.itemsNeededByChild === 'object' ? snapshot.itemsNeededByChild : {});
    setSeededSkillAcquisitionByChild(snapshot?.skillAcquisitionByChild && typeof snapshot.skillAcquisitionByChild === 'object' ? snapshot.skillAcquisitionByChild : {});
    setSeededBehaviorTrackingByChild(snapshot?.behaviorTrackingByChild && typeof snapshot.behaviorTrackingByChild === 'object' ? snapshot.behaviorTrackingByChild : {});
    setSeededStaffWorkspacesById(snapshot?.staffWorkspacesById && typeof snapshot.staffWorkspacesById === 'object' ? snapshot.staffWorkspacesById : {});
    setSeededDashboardMetrics(snapshot?.dashboardMetrics && typeof snapshot.dashboardMetrics === 'object' ? snapshot.dashboardMetrics : {});
    setSeededTherapistDocumentationInsights(snapshot?.therapistDocumentationInsights && typeof snapshot.therapistDocumentationInsights === 'object' ? snapshot.therapistDocumentationInsights : null);
    setSeededOrganizationInsights(snapshot?.organizationInsights && typeof snapshot.organizationInsights === 'object' ? snapshot.organizationInsights : null);
  }

  function resetScreenshotSeed() {
    AsyncStorage.setItem(storageKeys.seedStatus, 'seeded').catch(() => {});
    applyLocalStateSnapshot(buildScreenshotSeedState());
  }

  // Hydrate from storage then attempt remote sync.
  //
  // This effect must NOT re-run on every `user` object reference change;
  // otherwise each re-render of AuthContext (which produces a new user object)
  // replays the hydration, clobbering state that `fetchAndSync` has already
  // populated and causing UI flicker / race conditions. Dedupe on the stable
  // user id so we only hydrate once per signed-in identity.
  const hydratedForUserRef = useRef(null);
  useEffect(() => {
    let mounted = true;
    const userKey = storageScopeId;
    if (hydratedForUserRef.current === userKey) return undefined;
    hydratedForUserRef.current = userKey;
    setStorageReady(false);
    resetLocalState();
    (async () => {
      try {
        const [blockedRaw, chatBlockedRaw, deletedThreadsRaw, seedStatusRaw] = await Promise.all([
          AsyncStorage.getItem(storageKeys.blocked),
          AsyncStorage.getItem(storageKeys.chatBlocked),
          AsyncStorage.getItem(storageKeys.deletedThreads),
          AsyncStorage.getItem(storageKeys.seedStatus),
        ]);
        await AsyncStorage.multiRemove(sensitiveStorageKeys).catch(() => {});
        if (!mounted) return;

        if (isDemoReviewer) {
          const seedStatus = String(seedStatusRaw || '').trim().toLowerCase();
          if (seedStatus === 'cleared') {
            resetLocalState();
            return;
          }

          const screenshotState = buildScreenshotSeedState();
          if (blockedRaw) {
            try {
              const parsed = JSON.parse(blockedRaw);
              screenshotState.blockedUserIds = Array.isArray(parsed) ? parsed : [];
            } catch (_) {}
          }
          if (chatBlockedRaw) {
            try {
              const parsed = JSON.parse(chatBlockedRaw);
              screenshotState.chatBlockedUserIds = Array.isArray(parsed) ? parsed : [];
            } catch (_) {}
          }
          applyLocalStateSnapshot(screenshotState);
          return;
        }

        setPosts([]);
        setMessages([]);
        setThreadReads({});
        setUrgentMemos([]);
        setParents([]);
        setTherapists([]);
        setChildren([]);
        setArchivedThreads([]);
        setDeletedThreads({});
        // Blocked users
        if (blockedRaw) {
          try { const parsed = JSON.parse(blockedRaw); if (Array.isArray(parsed)) setBlockedUserIds(parsed); else setBlockedUserIds([]); }
          catch (e) { setBlockedUserIds([]); }
        } else {
          setBlockedUserIds([]);
        }
        if (chatBlockedRaw) {
          try { const parsed = JSON.parse(chatBlockedRaw); if (Array.isArray(parsed)) setChatBlockedUserIds(parsed); else setChatBlockedUserIds([]); }
          catch (e) { setChatBlockedUserIds([]); }
        } else {
          setChatBlockedUserIds([]);
        }
        if (deletedThreadsRaw) {
          try {
            const parsed = JSON.parse(deletedThreadsRaw);
            setDeletedThreads(normalizeDeletedThreadsMap(parsed));
          }
          catch (e) { setDeletedThreads({}); }
        } else {
          setDeletedThreads({});
        }
      } catch (e) {
        console.warn('hydrate failed', e.message);
      } finally {
        if (mounted) setStorageReady(true);
      }
      // NOTE: network sync will be triggered by a separate effect
      // after auth finishes loading to ensure requests include auth token.
    })();
    return () => { mounted = false; };
  }, [isDemoReviewer, sensitiveStorageKeys, storageKeys, storageScopeId]);

  useEffect(() => {
    if (!storageReady) return;
    AsyncStorage.multiRemove(sensitiveStorageKeys).catch(() => {});
  }, [
    archivedThreads,
    children,
    messages,
    parents,
    posts,
    sensitiveStorageKeys,
    storageReady,
    therapists,
    threadReads,
    urgentMemos,
  ]);

  // Persist blocked user ids
  useEffect(() => {
    if (!storageReady) return;
    AsyncStorage.setItem(storageKeys.blocked, JSON.stringify(blockedUserIds)).catch(() => {});
  }, [blockedUserIds, storageKeys.blocked, storageReady]);
  useEffect(() => {
    if (!storageReady) return;
    AsyncStorage.setItem(storageKeys.chatBlocked, JSON.stringify(chatBlockedUserIds)).catch(() => {});
  }, [chatBlockedUserIds, storageKeys.chatBlocked, storageReady]);

  // (Removed) dev-only directory seeding and demo data.

  // Dev: poll a dev-clear server running on the packager host to trigger clearing persisted data
  useEffect(() => {
    if (!__DEV__) return undefined;
    if (Platform.OS === 'web') return undefined;
    let disposed = false;
    let pollInFlight = false;
    const port = process.env.DEV_CLEAR_PORT || 4001;
    // derive packager host from scriptURL
    let host = 'localhost';
    try {
      const scriptURL = NativeModules?.SourceCode?.scriptURL || '';
      const m = scriptURL.match(/https?:\/\/([^:/]+)/);
      if (m && m[1]) host = m[1];
    } catch (e) {}

    const base = `http://${host}:${port}`;
    const iv = setInterval(async () => {
      if (disposed || pollInFlight) return;
      pollInFlight = true;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 1500) : null;
      try {
        const res = await fetch(`${base}/clear-status`, controller ? { signal: controller.signal } : undefined);
        if (!res.ok) return;
        const json = await res.json();
        if (json && json.clear) {
          await clearAllData();
          await fetch(`${base}/ack`, { method: 'POST' }).catch(() => {});
        }
      } catch (e) {
        // ignore
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        pollInFlight = false;
      }
    }, 3000);
    return () => {
      disposed = true;
      clearInterval(iv);
    };
  }, []);

  const maybeRefreshMfaOnPermissionDenied = async (e) => {
    const code = e?.code ? String(e.code) : '';
    const msg = String(e?.message || e || '').toLowerCase();
    const isPermissionDenied = code === 'permission-denied' || msg.includes('missing or insufficient permissions');
    if (!isPermissionDenied) return;

    try {
      // Based on firestore.rules, this error on core collections is a strong signal
      // that MFA is enabled and the session is not verified.
      if (!mfaEscalatedRef.current && typeof markMfaRequired === 'function') {
        mfaEscalatedRef.current = true;
        try { markMfaRequired(); } catch (_) {}
        // Prevent rapid re-fetching before AuthContext state propagates.
        needsMfaRef.current = true;
      }

      if (needsMfaRef.current) return;
      if (mfaRefreshInFlightRef.current) return;
      if (typeof refreshMfaState !== 'function') return;

      mfaRefreshInFlightRef.current = true;
      await refreshMfaState();
    } catch (_) {
      // ignore
    } finally {
      mfaRefreshInFlightRef.current = false;
    }
  };

  async function fetchAndSync(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const force = Boolean(opts.force);

    if (isDemoReviewer) return;

    // Avoid Firestore reads while MFA is required but not verified.
    if (!user || needsMfaRef.current) return;

    // Dedupe rapid calls (navigation remounts, multiple screens, overlays)
    if (!force) {
      if (fetchInFlightRef.current) return fetchInFlightRef.current;
      const now = Date.now();
      if (now - lastFetchAtRef.current < 1200) return;
    }

    const run = (async () => {
      const normalizeRemotePosts = (remotePosts) => remotePosts.map((p) => {
        const out = { ...(p || {}) };
        if (out.text && !out.body) out.body = out.text;
        if (out.author && typeof out.author === 'string') out.author = { id: null, name: out.author, avatar: null };
        if (!Array.isArray(out.comments)) out.comments = [];
        if (typeof out.likes !== 'number') out.likes = Number(out.likes) || 0;
        if (!out.createdAt) out.createdAt = new Date().toISOString();
        return out;
      });

      const [postsResult, messagesResult, memosResult, proposalsResult] = await Promise.allSettled([
        Api.getPosts(),
        Api.getMessages(),
        Api.getUrgentMemos(),
        Api.getTimeChangeProposals(),
      ]);

      if (postsResult.status === 'fulfilled') {
        if (Array.isArray(postsResult.value)) setPosts(normalizeRemotePosts(postsResult.value));
      } else {
        console.warn('getPosts failed', postsResult.reason?.message || postsResult.reason);
        await maybeRefreshMfaOnPermissionDenied(postsResult.reason);
      }

      if (messagesResult.status === 'fulfilled') {
        if (Array.isArray(messagesResult.value)) setMessages(filterDeletedMessages(messagesResult.value, deletedThreads, user));
      } else {
        console.warn('getMessages failed', messagesResult.reason?.message || messagesResult.reason);
      }

      if (memosResult.status === 'fulfilled') {
        const memos = memosResult.value;
        setUrgentMemos(Array.isArray(memos) ? memos : (memos?.memos || []));
      } else {
        console.warn('getUrgentMemos failed', memosResult.reason?.message || memosResult.reason);
        await maybeRefreshMfaOnPermissionDenied(memosResult.reason);
      }

      if (proposalsResult.status === 'fulfilled') {
        const proposals = proposalsResult.value;
        setTimeChangeProposals(Array.isArray(proposals) ? proposals : (proposals?.proposals || []));
      } else {
        console.warn('getTimeChangeProposals failed', proposalsResult.reason?.message || proposalsResult.reason);
        await maybeRefreshMfaOnPermissionDenied(proposalsResult.reason);
      }

      // Directory sync. Admins can read/seed the full directory; non-admins use /api/directory/me.
      setDirectoryLoading(true);
      setDirectoryError('');
      try {
        const isAdmin = Boolean(user && (isAdminRole(user.role) || isBcbaRole(user.role) || isOfficeAdminRole(user.role)));
        let dir = isAdmin ? await Api.getDirectory() : await Api.getDirectoryMe();
        if (dir && dir.ok) {
          let remoteChildren = Array.isArray(dir.children) ? dir.children : [];
          let remoteParents = Array.isArray(dir.parents) ? dir.parents : [];
          let remoteTherapists = Array.isArray(dir.therapists) ? dir.therapists : [];

          // If server directory is empty and this is an admin session, seed it from local (persisted + additions).
          if (isAdmin && !remoteChildren.length && !remoteParents.length && !remoteTherapists.length) {
            const localParents = mergeById(parents || [], []);
            const localChildren = mergeById((children || []).map(stripComputedChildFields), []);
            const derivedTherapists = deriveTherapistsFromChildren(localChildren);
            const localTherapists = mergeById(therapists || [], derivedTherapists);

            await Api.mergeDirectory({
              parents: localParents,
              children: localChildren,
              therapists: localTherapists,
            });

            dir = await Api.getDirectory();
            if (dir && dir.ok) {
              remoteChildren = Array.isArray(dir.children) ? dir.children : remoteChildren;
              remoteParents = Array.isArray(dir.parents) ? dir.parents : remoteParents;
              remoteTherapists = Array.isArray(dir.therapists) ? dir.therapists : remoteTherapists;
            }
          }

          setParents(remoteParents);
          setTherapists(remoteTherapists);
          setChildren(attachTherapistsToChildren(remoteChildren, remoteTherapists, dir.aba));
        }
      } catch (e) {
        console.warn('getDirectory failed', e?.message || e);
        setDirectoryError(String(e?.message || e || 'Could not load assigned children.'));
      } finally {
        setDirectoryLoading(false);
      }
    })();

    fetchInFlightRef.current = run;
    try {
      await run;
    } finally {
      lastFetchAtRef.current = Date.now();
      if (fetchInFlightRef.current === run) fetchInFlightRef.current = null;
    }
  }

  // Trigger network fetch once auth has finished loading and a user is signed in.
  useEffect(() => {
    let mounted = true;
    if (loading || !user || needsMfa || isDemoReviewer) return () => { mounted = false; };

    const userKey = [
      user?.id || user?.uid || user?.email || '',
      user?.role || '',
      user?.passwordSetupRequired ? 'setup' : 'active',
    ].join(':');
    if (userKey && initialSyncDoneForUserRef.current === userKey) {
      return () => { mounted = false; };
    }
    if (userKey) initialSyncDoneForUserRef.current = userKey;

    try {
      InteractionManager.runAfterInteractions(() => {
        if (!mounted) return;
        console.log('DataProvider: running fetchAndSync after auth ready', new Date().toISOString());
        fetchAndSync().catch((e) => console.warn('fetchAndSync after auth failed', e?.message || e));
      });
    } catch (_) {
      // fallback
      fetchAndSync().catch(() => {});
    }

    return () => { mounted = false; };
  }, [isDemoReviewer, loading, user, needsMfa]);

  useEffect(() => {
    if (loading || !user || needsMfa || isDemoReviewer) return undefined;

    let active = true;

    const refreshMessagesOnly = async () => {
      if (!active) return;
      if (messageRefreshInFlightRef.current) return messageRefreshInFlightRef.current;

      const run = (async () => {
        try {
          const remoteMessages = await Api.getMessages();
          if (active && Array.isArray(remoteMessages)) setMessages(filterDeletedMessages(remoteMessages, deletedThreads, user));
        } catch (e) {
          console.warn('message refresh failed', e?.message || e);
        }
      })();

      messageRefreshInFlightRef.current = run;
      try {
        await run;
      } finally {
        if (messageRefreshInFlightRef.current === run) messageRefreshInFlightRef.current = null;
      }
      return run;
    };

    refreshMessagesOnly().catch(() => {});

    const intervalId = setInterval(() => {
      refreshMessagesOnly().catch(() => {});
    }, 3000);

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshMessagesOnly().catch(() => {});
    });

    return () => {
      active = false;
      clearInterval(intervalId);
      appStateSubscription?.remove?.();
    };
  }, [deletedThreads, isDemoReviewer, loading, needsMfa, user?.id, user?.uid]);

  async function createPost(payload) {
    if (isDemoReviewer) {
      const created = {
        ...(payload || {}),
        id: `demo-post-${Date.now()}`,
        createdAt: new Date().toISOString(),
        author: payload?.author || { id: user?.id || 'reviewer-1', name: user?.name || 'App Review', avatar: null },
        likes: 0,
        shares: 0,
        comments: [],
      };
      setPosts((s) => [created, ...(s || [])]);
      return created;
    }
    const temp = { ...payload, id: `temp-${Date.now()}`, createdAt: new Date().toISOString(), pending: true };
    setPosts((s) => [temp, ...s]);
    try {
      const created = await Api.createPost(payload);
      // normalize backend field names (mock may return `text`)
      if (created && created.text && !created.body) created.body = created.text;
      // normalize author shape: mock may return a string
      if (created && created.author && typeof created.author === 'string') {
        created.author = { id: null, name: created.author, avatar: null };
      }
      // ensure arrays and fields exist
      if (created && !Array.isArray(created.comments)) created.comments = [];
      if (created && typeof created.likes !== 'number') created.likes = Number(created.likes) || 0;
      if (created && !created.createdAt) created.createdAt = new Date().toISOString();
      console.log('DataProvider: created post from API', created && created.id, created && (created.body || created.text || created.title));
      setPosts((s) => [created, ...s.filter((p) => p.id !== temp.id)]);
      return created;
    } catch (e) {
      console.warn('createPost failed', e.message);
      setPosts((s) => s.filter((p) => p.id !== temp.id));
      throw e;
    }
  }

  async function like(postId) {
    if (isDemoReviewer) {
      let updated = null;
      setPosts((s) => (s || []).map((p) => {
        if (p.id !== postId) return p;
        updated = { ...p, likes: (p.likes || 0) + 1 };
        return updated;
      }));
      return updated;
    }
    try {
      const updated = await Api.likePost(postId);
      setPosts((s) => s.map((p) => (p.id === postId ? { ...p, ...updated } : p)));
      return updated;
    } catch (e) {
      console.warn('like failed', e.message);
    }
  }

  async function comment(postId, commentBody) {
    if (isDemoReviewer) {
      const created = {
        id: `demo-comment-${Date.now()}`,
        body: String(commentBody?.body || commentBody || '').trim(),
        author: { id: user?.id || 'reviewer-1', name: user?.name || 'App Review' },
        createdAt: new Date().toISOString(),
        reactions: {},
        userReactions: {},
        replies: [],
      };
      setPosts((s) => (s || []).map((p) => (p.id === postId ? { ...p, comments: [...(p.comments || []), created] } : p)));
      return created;
    }
    try {
      const created = await Api.commentPost(postId, commentBody);
      setPosts((s) => s.map((p) => (p.id === postId ? { ...p, comments: [...(p.comments || []), created] } : p)));
      return created;
    } catch (e) {
      console.warn('comment failed', e.message);
    }
  }

  async function replyToComment(postId, parentCommentId, replyBody) {
    // optimistic reply
    const temp = { ...replyBody, id: `temp-reply-${Date.now()}`, createdAt: new Date().toISOString() };
    setPosts((s) => s.map((p) => {
      if (p.id !== postId) return p;
      const comments = (p.comments || []).map((c) => {
        if (c.id !== parentCommentId) return c;
        return { ...c, replies: [...(c.replies || []), temp] };
      });
      return { ...p, comments };
    }));

    try {
      const created = await Api.commentPost(postId, { ...replyBody, parentId: parentCommentId });
      setPosts((s) => s.map((p) => {
        if (p.id !== postId) return p;
        const comments = (p.comments || []).map((c) => {
          if (c.id !== parentCommentId) return c;
          return { ...c, replies: (c.replies || []).map((r) => (r.id === temp.id ? created : r)) };
        });
        return { ...p, comments };
      }));
      return created;
    } catch (e) {
      console.warn('replyToComment failed', e.message || e);
      setPosts((s) => s.map((p) => {
        if (p.id !== postId) return p;
        const comments = (p.comments || []).map((c) => {
          if (c.id !== parentCommentId) return c;
          return { ...c, replies: (c.replies || []).filter((r) => r.id !== temp.id) };
        });
        return { ...p, comments };
      }));
      throw e;
    }
  }

  async function reactToComment(postId, commentId, emoji) {
    const uid = user?.id || 'anonymous';
    setPosts((s) => s.map((p) => {
      if (p.id !== postId) return p;
      const comments = (p.comments || []).map((c) => {
        if (c.id !== commentId) return c;
        const reactions = { ...(c.reactions || {}) };
        const userReactions = { ...(c.userReactions || {}) };
        const prev = userReactions[uid];
        if (prev === emoji) {
          // toggle off
          reactions[emoji] = Math.max(0, (reactions[emoji] || 1) - 1);
          delete userReactions[uid];
        } else {
          if (prev) {
            reactions[prev] = Math.max(0, (reactions[prev] || 1) - 1);
          }
          reactions[emoji] = (reactions[emoji] || 0) + 1;
          userReactions[uid] = emoji;
        }
        return { ...c, reactions, userReactions };
      });
      return { ...p, comments };
    }));

    // Best-effort notify server if API supports it
    try {
      if (Api.reactComment) await Api.reactComment(postId, commentId, { emoji });
    } catch (e) {
      // ignore
      console.warn('reactToComment API failed', e?.message || e);
    }
  }

  async function share(postId) {
    // Find the post
    const p = posts.find((x) => x.id === postId);
    if (!p) return;

    // Compose share content
    const message = p.title ? `${p.title}\n\n${p.body || ''}` : (p.body || '');
    try {
      await Share.share({ message, url: p.image, title: p.title || 'Post' });
    } catch (e) {
      console.warn('native share failed', e.message || e);
    }

    // Optimistically increment local share count
    setPosts((s) => s.map((x) => (x.id === postId ? { ...x, shares: (x.shares || 0) + 1 } : x)));

    // Attempt to notify backend (best-effort)
    try {
      if (Api.sharePost) await Api.sharePost(postId);
    } catch (e) {
      // ignore server errors; local increment keeps UX responsive
      console.warn('sharePost API failed', e.message || e);
    }
  }

  function deletePost(postId) {
    try {
      setPosts((s) => (s || []).filter((p) => p.id !== postId));
      // persist immediately
      AsyncStorage.setItem(storageKeys.posts, JSON.stringify((posts || []).filter((p) => p.id !== postId))).catch(() => {});
    } catch (e) {
      console.warn('deletePost failed', e?.message || e);
    }
  }

  function deleteComment(postId, commentId, parentCommentId = null) {
    try {
      setPosts((s) => (s || []).map((p) => {
        if (p.id !== postId) return p;
        if (!parentCommentId) {
          return { ...p, comments: (p.comments || []).filter((c) => c.id !== commentId) };
        }
        return {
          ...p,
          comments: (p.comments || []).map((c) => {
            if (c.id !== parentCommentId) return c;
            return { ...c, replies: (c.replies || []).filter((r) => r.id !== commentId) };
          }),
        };
      }));
      // best-effort persist
      AsyncStorage.setItem(storageKeys.posts, JSON.stringify((posts || []).map((p) => p))).catch(() => {});
    } catch (e) {
      console.warn('deleteComment failed', e?.message || e);
    }
  }

  async function recordShare(postId, { notifyServer = true } = {}) {
    // Only increment and optionally notify the server without invoking native share UI
    setPosts((s) => s.map((x) => (x.id === postId ? { ...x, shares: (x.shares || 0) + 1 } : x)));
    if (!notifyServer) return;
    try {
      if (Api.sharePost) await Api.sharePost(postId);
    } catch (e) {
      console.warn('recordShare API failed', e.message || e);
    }
  }

  async function proposeTimeChange(childId, type, proposedISO, note) {
    try {
      const payload = { childId, type, proposedISO, note, proposerId: user?.id };
      const created = await Api.proposeTimeChange ? await Api.proposeTimeChange(payload) : { id: `proposal-${Date.now()}`, childId, type, proposedISO, note, proposerId: user?.id, scope: 'temporary', createdAt: new Date().toISOString() };
      // server should return the created proposal; append locally
      setTimeChangeProposals((s) => [created, ...s]);
      return created;
    } catch (e) {
      console.warn('proposeTimeChange failed', e?.message || e);
      return null;
    }
  }

  async function respondToProposal(proposalId, action) {
    try {
      if (!Api.respondTimeChange) {
        return { ok: false, error: 'Time change responses are unavailable right now.' };
      }
      const res = await Api.respondTimeChange(proposalId, action);
      if (res?.ok !== true && !res?.updatedChild) {
        return { ok: false, error: 'The time change request could not be updated.' };
      }

      setTimeChangeProposals((s) => (s || []).filter((p) => p.id !== proposalId));

      if (res && res.updatedChild && res.updatedChild.id) {
        setChildren((prev) => (prev || []).map((c) => (c.id === res.updatedChild.id ? { ...c, ...res.updatedChild } : c)));
      }

      return { ...res, ok: true };
    } catch (e) {
      console.warn('respondToProposal failed', e?.message || e);
      return { ok: false, error: e?.message || 'Could not update the proposal.' };
    }
  }

  async function sendMessage(payload) {
    const chatUser = getEffectiveChatIdentity(user);
    const senderId = chatUser?.id != null ? String(chatUser.id) : '';
    if (senderId && (chatBlockedUserIds || []).some((id) => String(id) === senderId)) {
      const err = new Error('Your messaging access has been disabled by an administrator.');
      err.code = 'BB_CHAT_BLOCKED';
      throw err;
    }
    // Attach sender info from auth (if available) so UI shows names immediately
    const sender = chatUser ? { id: chatUser.id, name: chatUser.name, email: chatUser.email } : undefined;
    const payloadWithSender = { ...payload, sender };
    const temp = { ...payloadWithSender, id: `temp-${Date.now()}`, createdAt: new Date().toISOString(), outgoing: true };
    const restoredThreadKeys = collectThreadKeys(temp, user);
    if (restoredThreadKeys.length) {
      setDeletedThreads((s) => {
        const current = normalizeDeletedThreadsMap(s);
        const next = { ...current };
        restoredThreadKeys.forEach((value) => { delete next[String(value)]; });
        AsyncStorage.setItem(storageKeys.deletedThreads, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
    setMessages((s) => [temp, ...s]);
    if (isDemoReviewer) return temp;
    try {
      const sent = await Api.sendMessage(payloadWithSender);
      setMessages((s) => [sent, ...s.filter((m) => m.id !== temp.id)]);
      return sent;
    } catch (e) {
      console.warn('sendMessage failed', e.message);
      return temp;
    }
  }

  function markThreadRead(threadId, readAt) {
    const key = threadId != null ? String(threadId) : '';
    if (!key) return;
    const iso = readAt ? new Date(readAt).toISOString() : new Date().toISOString();
    setThreadReads((prev) => {
      const current = prev && typeof prev === 'object' ? prev : {};
      if (current[key] === iso) return current;
      return { ...current, [key]: iso };
    });
  }

  function archiveThread(threadId) {
    try {
      setArchivedThreads((s) => {
        const next = Array.from(new Set([...(s || []), threadId]));
        AsyncStorage.setItem(storageKeys.archivedThreads, JSON.stringify(next)).catch(() => {});
        return next;
      });
    } catch (e) {
      console.warn('archiveThread failed', e?.message || e);
    }
  }

  function unarchiveThread(threadId) {
    try {
      setArchivedThreads((s) => {
        const next = (s || []).filter((t) => t !== threadId);
        AsyncStorage.setItem(storageKeys.archivedThreads, JSON.stringify(next)).catch(() => {});
        return next;
      });
    } catch (e) {
      console.warn('unarchiveThread failed', e?.message || e);
    }
  }

  function deleteThread(threadId) {
    try {
      const key = threadId != null ? String(threadId) : '';
      const deletionKeys = Array.from(new Set([
        key,
        ...(messages || []).filter((message) => matchesThreadKey(message, key, user)).flatMap((message) => collectThreadKeys(message, user)),
      ].map((value) => String(value || '').trim()).filter(Boolean)));
      const shouldDeleteMessage = (message) => deletionKeys.some((candidate) => matchesThreadKey(message, candidate, user));
      const deletedAt = new Date().toISOString();
      setDeletedThreads((s) => {
        const next = { ...normalizeDeletedThreadsMap(s) };
        deletionKeys.forEach((value) => {
          next[String(value)] = deletedAt;
        });
        AsyncStorage.setItem(storageKeys.deletedThreads, JSON.stringify(next)).catch(() => {});
        return next;
      });
      setMessages((s) => {
        const next = (s || []).filter((m) => !shouldDeleteMessage(m));
        AsyncStorage.setItem(storageKeys.messages, JSON.stringify(next)).catch(() => {});
        return next;
      });
      setArchivedThreads((s) => {
        const next = (s || []).filter((t) => !deletionKeys.includes(String(t)));
        AsyncStorage.setItem(storageKeys.archivedThreads, JSON.stringify(next)).catch(() => {});
        return next;
      });
      setThreadReads((s) => {
        const next = { ...(s || {}) };
        deletionKeys.forEach((value) => { delete next[value]; });
        AsyncStorage.setItem(storageKeys.threadReads, JSON.stringify(next)).catch(() => {});
        return next;
      });
    } catch (e) {
      console.warn('deleteThread failed', e?.message || e);
    }
  }

  async function markUrgentRead(memoIds) {
    try {
      await Api.ackUrgentMemo(memoIds);
    } catch (e) {
      console.warn('ackUrgentMemo failed', e.message);
    }
  }

  // Send a time-update urgent alert to admin (dropoff/pickup)
  async function sendTimeUpdateAlert(childId, updateType, proposedISO, note) {
    try {
      const temp = {
        id: `urgent-${Date.now()}`,
        type: 'time_update',
        updateType, // 'pickup' or 'dropoff'
        childId,
        proposerId: user?.id,
        proposedISO,
        note: note || '',
        status: 'pending', // pending -> waiting for admin
        createdAt: new Date().toISOString(),
      };
      setUrgentMemos((s) => [temp, ...(s || [])]);
      if (isDemoReviewer) return temp;
      // Attempt server send; if server returns canonical memo, replace temp
      if (Api.sendUrgentMemo) {
        try {
          const created = await Api.sendUrgentMemo(temp);
          if (created && created.id) {
            setUrgentMemos((s) => (s || []).map((m) => (m.id === temp.id ? created : m)));
            return created;
          }
        } catch (e) {
          console.warn('sendUrgentMemo API failed', e?.message || e);
        }
      }
      return temp;
    } catch (e) {
      console.warn('sendTimeUpdateAlert failed', e?.message || e);
      return null;
    }
  }

  // Send a general admin memo to multiple recipients
  async function sendAdminMemo({ recipients = [], subject = '', body = '', childId = null, ...extra } = {}) {
    try {
      const temp = {
        id: `urgent-${Date.now()}`,
        type: 'admin_memo',
        subject: subject || '',
        body: body || '',
        childId: childId || null,
        recipients: Array.isArray(recipients) ? recipients : [],
        proposerId: user?.id,
        proposerName: String(user?.name || user?.displayName || user?.email || '').trim() || 'Office',
        status: 'sent',
        createdAt: new Date().toISOString(),
        ...extra,
      };
      // Optimistically add to local urgent memos so admins can see it immediately
      setUrgentMemos((s) => [temp, ...(s || [])]);

      if (isDemoReviewer) return temp;

      // Attempt server send if API supports it
      if (Api.sendUrgentMemo) {
        try {
          const created = await Api.sendUrgentMemo(temp);
          if (created && created.id) {
            setUrgentMemos((s) => (s || []).map((m) => (m.id === temp.id ? created : m)));
            return created;
          }
        } catch (e) {
          console.warn('sendAdminMemo API failed', e?.message || e);
        }
      }
      return temp;
    } catch (e) {
      console.warn('sendAdminMemo failed', e?.message || e);
      return null;
    }
  }

  async function createStaffLog({ type = '', title = '', body = '', childId = null, recipients = [], ...extra } = {}) {
    try {
      const normalizedType = String(type || '').trim().toLowerCase() || 'quick_note';
      const temp = {
        id: `urgent-${Date.now()}`,
        type: normalizedType,
        title: String(title || '').trim(),
        body: String(body || '').trim(),
        childId: childId || null,
        recipients: Array.isArray(recipients) ? recipients : [],
        proposerId: user?.id,
        proposerName: String(user?.name || user?.displayName || user?.email || '').trim() || 'Staff',
        status: 'pending',
        createdAt: new Date().toISOString(),
        ...extra,
      };
      setUrgentMemos((s) => [temp, ...(s || [])]);

      if (isDemoReviewer) return temp;

      if (Api.sendUrgentMemo) {
        try {
          const created = await Api.sendUrgentMemo(temp);
          if (created && created.id) {
            setUrgentMemos((s) => (s || []).map((m) => (m.id === temp.id ? created : m)));
            return created;
          }
        } catch (e) {
          console.warn('createStaffLog API failed', e?.message || e);
        }
      }
      return temp;
    } catch (e) {
      console.warn('createStaffLog failed', e?.message || e);
      return null;
    }
  }

  // Update urgent memo status locally and attempt server notify
  async function respondToUrgentMemo(memoId, action) {
    try {
      // action: 'accepted' | 'denied' | 'opened'
      // Find memo locally
      const localMemo = (urgentMemos || []).find((m) => m.id === memoId);
      setUrgentMemos((s) => (s || []).map((m) => (m.id === memoId ? { ...m, status: action, respondedAt: new Date().toISOString() } : m)));
      if (!isDemoReviewer && Api.respondUrgentMemo) {
        try {
          await Api.respondUrgentMemo(memoId, action);
        } catch (e) {
          console.warn('respondUrgentMemo API failed', e?.message || e);
        }
      }
      // If this was a time_update and accepted, apply the time change to the child locally
      if (action === 'accepted' && localMemo && localMemo.type === 'time_update') {
        try {
          const childId = localMemo.childId;
          const field = localMemo.updateType === 'pickup' ? 'pickupTimeISO' : 'dropoffTimeISO';
          setChildren((prev) => (prev || []).map((c) => (c.id === childId ? { ...c, [field]: localMemo.proposedISO } : c)));
        } catch (e) {
          console.warn('apply urgent memo accepted to child failed', e?.message || e);
        }
      }

      return true;
    } catch (e) {
      console.warn('respondToUrgentMemo failed', e?.message || e);
      return false;
    }
  }

  function clearMessages() {
    try {
      setMessages([]);
      setThreadReads({});
      setArchivedThreads([]);
      setDeletedThreads({});
      AsyncStorage.removeItem(storageKeys.messages).catch(() => {});
      AsyncStorage.removeItem(storageKeys.threadReads).catch(() => {});
      AsyncStorage.removeItem(storageKeys.archivedThreads).catch(() => {});
      AsyncStorage.removeItem(storageKeys.deletedThreads).catch(() => {});
    } catch (e) {
      console.warn('clearMessages failed', e?.message || e);
    }
  }

  async function clearAllData() {
    try {
      resetLocalState();
      setApplicationBadgeCountAsync(0).catch(() => {});
      const keys = Object.values(storageKeys);
      await AsyncStorage.multiRemove(keys);
      await AsyncStorage.setItem(storageKeys.seedStatus, 'cleared');
    } catch (e) {
      console.warn('clearAllData failed', e?.message || e);
    }
  }

  function blockUser(userId) {
    try {
      if (!userId) return;
      setBlockedUserIds((s) => Array.from(new Set([...(s || []), userId])));
      // remove posts authored by this user locally
      setPosts((s) => (s || []).filter((p) => {
        const authorId = p?.author?.id || p?.author?.name;
        if (!authorId) return true;
        return `${authorId}` !== `${userId}`;
      }));
      // remove messages where this user is sender or recipient
      setMessages((s) => (s || []).filter((m) => {
        const senderId = m?.sender?.id || m?.sender?.name;
        if (senderId && `${senderId}` === `${userId}`) return false;
        const toIds = (m.to || []).map(t => t.id || t.name).filter(Boolean);
        if (toIds.find(t => `${t}` === `${userId}`)) return false;
        return true;
      }));
      AsyncStorage.setItem(storageKeys.blocked, JSON.stringify(Array.from(new Set([...(blockedUserIds || []), userId])))).catch(() => {});
    } catch (e) {
      console.warn('blockUser failed', e?.message || e);
    }
  }

  function unblockUser(userId) {
    try {
      setBlockedUserIds((s) => (s || []).filter((id) => `${id}` !== `${userId}`));
      AsyncStorage.setItem(storageKeys.blocked, JSON.stringify((blockedUserIds || []).filter((id) => `${id}` !== `${userId}`))).catch(() => {});
    } catch (e) {
      console.warn('unblockUser failed', e?.message || e);
    }
  }

  function blockChatUser(userId) {
    try {
      if (!userId) return;
      setChatBlockedUserIds((s) => Array.from(new Set([...(s || []), String(userId)])));
    } catch (e) {
      console.warn('blockChatUser failed', e?.message || e);
    }
  }

  function unblockChatUser(userId) {
    try {
      setChatBlockedUserIds((s) => (s || []).filter((id) => `${id}` !== `${userId}`));
    } catch (e) {
      console.warn('unblockChatUser failed', e?.message || e);
    }
  }

  const unreadThreadCount = useMemo(() => countUnreadVisibleThreads(messages, threadReads, user, archivedThreads), [archivedThreads, messages, threadReads, user]);
  const pendingUrgentCount = useMemo(() => {
    const role = String(user?.role || '').trim().toLowerCase();
    const uid = String(user?.id || user?.uid || '').trim();
    const items = Array.isArray(urgentMemos) ? urgentMemos : [];

    return items.filter((memo) => {
      if (memo?.ack) return false;

      const status = String(memo?.status || '').trim().toLowerCase();
      const recipients = Array.isArray(memo?.recipients) ? memo.recipients : [];
      const recipientIds = recipients.map((item) => String(item?.id || item || '').trim()).filter(Boolean);
      const proposerId = String(memo?.proposerId || memo?.proposerUid || '').trim();
      const isAdminRole = role === 'admin' || role === 'administrator' || role === 'orgadmin' || role === 'org_admin' || role === 'campusadmin' || role === 'campus_admin' || role === 'superadmin' || role === 'super_admin';

      if (isAdminRole) {
        return !status || status === 'pending';
      }

      if (uid && recipientIds.includes(uid)) {
        return true;
      }

      if (role === 'parent') {
        return proposerId === uid && (!status || status === 'pending');
      }

      return false;
    }).length;
  }, [urgentMemos, user]);

  useEffect(() => {
    setApplicationBadgeCountAsync(unreadThreadCount + pendingUrgentCount).catch(() => {});
  }, [pendingUrgentCount, unreadThreadCount]);

  return (
    <DataContext.Provider value={{
      posts,
      messages,
      urgentMemos,
      sendTimeUpdateAlert,
      respondToUrgentMemo,
      children,
      parents,
      therapists,
      directoryLoading,
      directoryError,
      setChildren,
      setParents,
      setTherapists,
      // legacy therapist pools removed; use `therapists` only
      clearMessages,
      archiveThread,
      unarchiveThread,
      deleteThread,
      archivedThreads,
      createPost,
      like,
      comment,
      replyToComment,
      reactToComment,
      deleteComment,
      share,
      recordShare,
      sendMessage,
      markThreadRead,
      threadReads,
      unreadThreadCount,
      fetchAndSync,
      markUrgentRead,
      sendAdminMemo,
      createStaffLog,
      blockedUserIds,
      blockUser,
      unblockUser,
      chatBlockedUserIds,
      activeSeedPreset,
      seededSessionSummariesByChild,
      seededOrgSettings,
      seededExportJobs,
      seededAuditLogs,
      seededMoodHistoryByChild,
      seededAttendanceByDate,
      seededAttendanceHistoryByChild,
      seededArrivalPingsByChild,
      seededPickupQueueByChild,
      seededTapEventsByChild,
      seededItemsNeededByChild,
      seededSkillAcquisitionByChild,
      seededBehaviorTrackingByChild,
      seededStaffWorkspacesById,
      seededDashboardMetrics,
      seededTherapistDocumentationInsights,
      seededOrganizationInsights,
      blockChatUser,
      unblockChatUser,
      clearAllData,
      resetScreenshotSeed,
      // time change proposals
      timeChangeProposals,
      proposeTimeChange,
      respondToProposal,
      deletePost,
    }}>
      {reactChildren}
    </DataContext.Provider>
  );
}

export default DataContext;
