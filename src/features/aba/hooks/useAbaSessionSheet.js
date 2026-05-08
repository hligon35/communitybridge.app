import { useEffect, useMemo, useRef, useState } from 'react';
import * as Api from '../../../Api';
import { flushOfflineQueue, listOfflineQueueItems, subscribeToOfflineQueue } from '../../../utils/offlineQueue';
import { buildParentSafeSummaryDraft, computeAbaQuickStats } from '../services/abaAggregates';

const ABA_OFFLINE_KINDS = new Set([
  'saveSessionDataSheet',
  'saveBehaviorEvent',
  'saveAbcObservation',
  'saveSkillTrial',
  'saveIntervalSample',
  'saveDurationTimer',
  'saveLatencyRecord',
  'saveTargetReview',
  'savePhaseChange',
  'saveParentSummary',
]);

function toDateKey(value = new Date()) {
  const stamp = Date.parse(String(value || ''));
  return Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function resolveBcbaId(child) {
  const candidate = child?.bcbaTherapist || child?.bcaTherapist || child?.bcba || null;
  if (!candidate) return '';
  if (typeof candidate === 'string') return String(candidate).trim();
  return String(candidate?.id || candidate?.uid || '').trim();
}

function resolveSetting(child) {
  return String(child?.campusName || child?.programName || child?.location || 'Clinic').trim() || 'Clinic';
}

function createPreviewId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useAbaSessionSheet({ child, activeSession, user, preview = false }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [targets, setTargets] = useState([]);
  const [behaviorEvents, setBehaviorEvents] = useState([]);
  const [abcObservations, setAbcObservations] = useState([]);
  const [skillTrials, setSkillTrials] = useState([]);
  const [durationTimers, setDurationTimers] = useState([]);
  const [intervalSamples, setIntervalSamples] = useState([]);
  const [latencyRecords, setLatencyRecords] = useState([]);
  const [saveError, setSaveError] = useState('');
  const [pendingOfflineWriteCount, setPendingOfflineWriteCount] = useState(0);
  const [syncingPendingOfflineWrites, setSyncingPendingOfflineWrites] = useState(false);
  const lastFailedActionRef = useRef(null);
  const therapistId = String(user?.id || user?.uid || '').trim();
  const bcbaId = resolveBcbaId(child);
  const activeSheetId = String(sheet?.id || '').trim();

  const targetMap = useMemo(() => targets.reduce((accumulator, item) => {
    const key = String(item?.id || '').trim();
    if (key) accumulator[key] = item;
    return accumulator;
  }, {}), [targets]);

  const quickStats = useMemo(() => computeAbaQuickStats({ behaviorEvents, skillTrials, durationTimers, abcObservations, intervalSamples, latencyRecords }), [abcObservations, behaviorEvents, durationTimers, intervalSamples, latencyRecords, skillTrials]);
  const activeTargets = useMemo(() => targets.filter((item) => !['discontinued', 'mastered'].includes(String(item?.status || '').trim().toLowerCase())), [targets]);
  const runningDurationTimer = useMemo(() => durationTimers.find((item) => !item?.completed) || null, [durationTimers]);
  const runningLatencyRecord = useMemo(() => latencyRecords.find((item) => !item?.completed) || null, [latencyRecords]);

  useEffect(() => {
    let disposed = false;
    async function loadTargets() {
      if (preview || !child?.id) {
        if (!disposed) setTargets([]);
        return;
      }
      try {
        const result = await Api.listBehaviorTargetsByChild(child.id, 100);
        if (!disposed) setTargets(Array.isArray(result?.items) ? result.items : []);
      } catch (_) {
        if (!disposed) setTargets([]);
      }
    }
    loadTargets();
    return () => {
      disposed = true;
    };
  }, [child?.id, preview]);

  useEffect(() => {
    let disposed = false;
    async function loadSheet() {
      if (!activeSession?.id) {
        if (!disposed) {
          setSheet(null);
          setBehaviorEvents([]);
          setAbcObservations([]);
          setSkillTrials([]);
          setDurationTimers([]);
          setIntervalSamples([]);
          setLatencyRecords([]);
        }
        return;
      }
      if (preview) {
        if (!disposed) {
          setSheet({
            id: createPreviewId('sheet'),
            sessionId: String(activeSession.id || ''),
            childId: String(child?.id || 'preview-child'),
            therapistId,
            bcbaId,
            date: toDateKey(activeSession.startedAt || new Date().toISOString()),
            sessionBlock: String(activeSession.sessionType || 'AM').trim(),
            startAt: activeSession.startedAt || new Date().toISOString(),
            setting: resolveSetting(child),
            room: String(child?.room || '').trim() || null,
            sessionState: 'in_progress',
            attendanceStatus: 'present',
            targetIds: [],
            quickStats: {},
          });
          setBehaviorEvents([]);
          setAbcObservations([]);
          setSkillTrials([]);
          setDurationTimers([]);
          setIntervalSamples([]);
          setLatencyRecords([]);
        }
        return;
      }

      setLoading(true);
      try {
        const existing = await Api.getSessionDataSheetBySession(activeSession.id);
        const currentSheet = existing?.item || null;
        if (disposed) return;
        setSheet(currentSheet);
        if (!currentSheet?.id) {
          setBehaviorEvents([]);
          setAbcObservations([]);
          setSkillTrials([]);
          setDurationTimers([]);
          setIntervalSamples([]);
          setLatencyRecords([]);
          return;
        }
        const [eventsResult, abcResult, trialsResult, durationsResult, intervalsResult, latencyResult] = await Promise.all([
          Api.listBehaviorEventsBySheet(currentSheet.id, 500),
          Api.listAbcObservationsBySheet(currentSheet.id, 250),
          Api.listSkillTrialsBySheet(currentSheet.id, 1000),
          Api.listDurationTimersBySheet(currentSheet.id, 1000),
          Api.listIntervalSamplesBySheet(currentSheet.id, 1000),
          Api.listLatencyRecordsBySheet(currentSheet.id, 1000),
        ]);
        if (disposed) return;
        setBehaviorEvents(Array.isArray(eventsResult?.items) ? eventsResult.items : []);
        setAbcObservations(Array.isArray(abcResult?.items) ? abcResult.items : []);
        setSkillTrials(Array.isArray(trialsResult?.items) ? trialsResult.items : []);
        setDurationTimers(Array.isArray(durationsResult?.items) ? durationsResult.items : []);
        setIntervalSamples(Array.isArray(intervalsResult?.items) ? intervalsResult.items : []);
        setLatencyRecords(Array.isArray(latencyResult?.items) ? latencyResult.items : []);
      } catch (_) {
        if (!disposed) {
          setSheet(null);
          setBehaviorEvents([]);
          setAbcObservations([]);
          setSkillTrials([]);
          setDurationTimers([]);
          setIntervalSamples([]);
          setLatencyRecords([]);
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    loadSheet();
    return () => {
      disposed = true;
    };
  }, [activeSession?.id, activeSession?.sessionType, activeSession?.startedAt, bcbaId, child, preview, therapistId]);

  useEffect(() => {
    setSaveError('');
    lastFailedActionRef.current = null;
  }, [activeSession?.id, preview]);

  useEffect(() => {
    if (preview) {
      setPendingOfflineWriteCount(0);
      return () => {};
    }

    let disposed = false;

    async function refreshPendingOfflineWrites() {
      try {
        const items = await listOfflineQueueItems();
        if (disposed) return;
        const count = (Array.isArray(items) ? items : []).filter((item) => ABA_OFFLINE_KINDS.has(String(item?.kind || '').trim())).length;
        setPendingOfflineWriteCount(count);
      } catch (_) {
        if (!disposed) setPendingOfflineWriteCount(0);
      }
    }

    refreshPendingOfflineWrites().catch(() => {});
    const unsubscribe = subscribeToOfflineQueue(() => {
      refreshPendingOfflineWrites().catch(() => {});
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [preview]);

  async function runTrackedSave(operation, retryFactory) {
    setSaving(true);
    setSaveError('');
    try {
      const result = await operation();
      lastFailedActionRef.current = null;
      return result;
    } catch (error) {
      if (error?.queued || error?.code === 'BB_QUEUED_OFFLINE') {
        lastFailedActionRef.current = null;
        setSaveError('');
        const items = await listOfflineQueueItems().catch(() => []);
        const count = (Array.isArray(items) ? items : []).filter((item) => ABA_OFFLINE_KINDS.has(String(item?.kind || '').trim())).length;
        setPendingOfflineWriteCount(count);
        return { queuedOffline: true, pendingOfflineWriteCount: count };
      }
      setSaveError(String(error?.message || error || 'Could not save the ABA record.'));
      lastFailedActionRef.current = typeof retryFactory === 'function' ? retryFactory : null;
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function retryLastSave() {
    if (typeof lastFailedActionRef.current !== 'function') return null;
    return lastFailedActionRef.current();
  }

  async function syncPendingOfflineWrites() {
    if (preview || syncingPendingOfflineWrites) return null;
    setSyncingPendingOfflineWrites(true);
    setSaveError('');
    try {
      const result = await flushOfflineQueue();
      const items = await listOfflineQueueItems().catch(() => []);
      const count = (Array.isArray(items) ? items : []).filter((item) => ABA_OFFLINE_KINDS.has(String(item?.kind || '').trim())).length;
      setPendingOfflineWriteCount(count);
      return result;
    } catch (error) {
      setSaveError(String(error?.message || error || 'Could not sync pending ABA writes.'));
      return null;
    } finally {
      setSyncingPendingOfflineWrites(false);
    }
  }

  async function ensureSheet() {
    if (sheet?.id) return sheet;
    if (!activeSession?.id) throw new Error('Start a therapy session before recording ABA data.');
    const payload = {
      sessionId: String(activeSession.id || '').trim(),
      childId: String(child?.id || '').trim(),
      therapistId,
      bcbaId,
      date: toDateKey(activeSession.startedAt || new Date().toISOString()),
      sessionBlock: String(activeSession.sessionType || 'AM').trim() || 'AM',
      startAt: activeSession.startedAt || new Date().toISOString(),
      setting: resolveSetting(child),
      room: String(child?.room || '').trim() || null,
      sessionState: 'in_progress',
      attendanceStatus: 'present',
      targetIds: activeTargets.map((item) => item.id),
      quickStats,
    };
    if (preview) {
      const next = { id: createPreviewId('sheet'), ...payload };
      setSheet(next);
      return next;
    }
    const result = await Api.saveSessionDataSheet(payload, sheet || null);
    const next = result?.item || null;
    if (next) setSheet(next);
    return next;
  }

  async function refreshSheetStats(nextBehaviorEvents = behaviorEvents, nextSkillTrials = skillTrials, nextDurationTimers = durationTimers, nextAbc = abcObservations, nextIntervalSamples = intervalSamples, nextLatencyRecords = latencyRecords) {
    const currentSheet = await ensureSheet();
    const nextQuickStats = computeAbaQuickStats({
      behaviorEvents: nextBehaviorEvents,
      skillTrials: nextSkillTrials,
      durationTimers: nextDurationTimers,
      abcObservations: nextAbc,
      intervalSamples: nextIntervalSamples,
      latencyRecords: nextLatencyRecords,
    });
    if (preview) {
      setSheet((current) => current ? { ...current, quickStats: nextQuickStats } : current);
      return nextQuickStats;
    }
    const result = await Api.saveSessionDataSheet({
      ...currentSheet,
      targetIds: Array.from(new Set([
        ...(Array.isArray(currentSheet?.targetIds) ? currentSheet.targetIds : []),
        ...activeTargets.map((item) => item.id),
      ])),
      quickStats: nextQuickStats,
      updatedAt: new Date().toISOString(),
    }, currentSheet);
    if (result?.item) setSheet(result.item);
    return nextQuickStats;
  }

  async function recordFrequencyEvent({ targetId, count = 1, note = '', intensity = null, magnitudeNote = null, promptLevelAtOccurrence = null } = {}) {
    return runTrackedSave(async () => {
      const currentSheet = await ensureSheet();
      const payload = {
        sessionDataSheetId: currentSheet.id,
        sessionId: String(activeSession?.id || '').trim(),
        childId: String(child?.id || '').trim(),
        targetId: String(targetId || '').trim(),
        observedAt: new Date().toISOString(),
        recordedBy: therapistId,
        count,
        intensity,
        magnitudeNote,
        promptLevelAtOccurrence,
        note,
      };
      const created = preview ? { id: createPreviewId('behavior-event'), ...payload } : (await Api.saveBehaviorEvent(payload))?.item;
      const next = [created, ...behaviorEvents].filter(Boolean);
      setBehaviorEvents(next);
      await refreshSheetStats(next, skillTrials, durationTimers, abcObservations, intervalSamples, latencyRecords);
      return created;
    }, () => recordFrequencyEvent({ targetId, count, note, intensity, magnitudeNote, promptLevelAtOccurrence }));
  }

  async function addAbcObservation({ targetId = '', antecedentNarrative = '', antecedentTag = '', behaviorTopography = '', consequenceNarrative = '', perceivedFunction = '', safetyRisk = false, note = '' } = {}) {
    return runTrackedSave(async () => {
      const currentSheet = await ensureSheet();
      const payload = {
        sessionDataSheetId: currentSheet.id,
        sessionId: String(activeSession?.id || '').trim(),
        childId: String(child?.id || '').trim(),
        targetId: String(targetId || '').trim() || null,
        recordedBy: therapistId,
        observedAt: new Date().toISOString(),
        antecedent: {
          tag: antecedentTag || null,
          narrative: antecedentNarrative,
        },
        behavior: {
          topography: behaviorTopography,
          safetyRisk: Boolean(safetyRisk),
        },
        consequence: {
          narrative: consequenceNarrative,
        },
        perceivedFunction: perceivedFunction || null,
        followUpRequired: Boolean(safetyRisk),
        note,
      };
      const created = preview ? { id: createPreviewId('abc'), ...payload } : (await Api.saveAbcObservation(payload))?.item;
      const next = [created, ...abcObservations].filter(Boolean);
      setAbcObservations(next);
      await refreshSheetStats(behaviorEvents, skillTrials, durationTimers, next, intervalSamples, latencyRecords);
      return created;
    }, () => addAbcObservation({ targetId, antecedentNarrative, antecedentTag, behaviorTopography, consequenceNarrative, perceivedFunction, safetyRisk, note }));
  }

  async function addSkillTrial({ targetId, outcome = 'correct', promptLevel = '', learnerResponse = '', note = '' } = {}) {
    return runTrackedSave(async () => {
      const currentSheet = await ensureSheet();
      const payload = {
        sessionDataSheetId: currentSheet.id,
        sessionId: String(activeSession?.id || '').trim(),
        childId: String(child?.id || '').trim(),
        targetId: String(targetId || '').trim(),
        recordedBy: therapistId,
        trialNumber: skillTrials.length + 1,
        observedAt: new Date().toISOString(),
        learnerResponse,
        outcome,
        promptLevel,
        note,
      };
      const created = preview ? { id: createPreviewId('skill-trial'), ...payload } : (await Api.saveSkillTrial(payload))?.item;
      const next = [created, ...skillTrials].filter(Boolean);
      setSkillTrials(next);
      await refreshSheetStats(behaviorEvents, next, durationTimers, abcObservations, intervalSamples, latencyRecords);
      return created;
    }, () => addSkillTrial({ targetId, outcome, promptLevel, learnerResponse, note }));
  }

  async function toggleDurationTimer({ targetId, note = '' } = {}) {
    return runTrackedSave(async () => {
      const currentSheet = await ensureSheet();
      if (runningDurationTimer?.id) {
        const stoppedAt = new Date().toISOString();
        const startedStamp = Date.parse(String(runningDurationTimer.startedAt || ''));
        const stoppedStamp = Date.parse(stoppedAt);
        const durationSeconds = Number.isFinite(startedStamp) && Number.isFinite(stoppedStamp)
          ? Math.max(0, Math.round((stoppedStamp - startedStamp) / 1000))
          : 0;
        const payload = {
          ...runningDurationTimer,
          stoppedAt,
          durationSeconds,
          completed: true,
          note: note || runningDurationTimer.note || '',
        };
        const updated = preview ? payload : (await Api.saveDurationTimer(payload, runningDurationTimer))?.item;
        const next = durationTimers.map((item) => (item?.id === runningDurationTimer.id ? updated : item));
        setDurationTimers(next);
        await refreshSheetStats(behaviorEvents, skillTrials, next, abcObservations, intervalSamples, latencyRecords);
        return updated;
      }
      const payload = {
        sessionDataSheetId: currentSheet.id,
        sessionId: String(activeSession?.id || '').trim(),
        childId: String(child?.id || '').trim(),
        targetId: String(targetId || '').trim(),
        recordedBy: therapistId,
        startedAt: new Date().toISOString(),
        completed: false,
        note,
      };
      const created = preview ? { id: createPreviewId('duration-timer'), ...payload } : (await Api.saveDurationTimer(payload))?.item;
      const next = [created, ...durationTimers].filter(Boolean);
      setDurationTimers(next);
      await refreshSheetStats(behaviorEvents, skillTrials, next, abcObservations, intervalSamples, latencyRecords);
      return created;
    }, () => toggleDurationTimer({ targetId, note }));
  }

  async function recordIntervalSample({ targetId, intervalType = 'whole_interval', intervalMinutes = 5, observed = false, note = '' } = {}) {
    return runTrackedSave(async () => {
      const currentSheet = await ensureSheet();
      const intervalLengthMs = Math.max(1, Number(intervalMinutes) || 5) * 60 * 1000;
      const intervalEndAt = new Date();
      const intervalStartAt = new Date(intervalEndAt.getTime() - intervalLengthMs);
      const payload = {
        sessionDataSheetId: currentSheet.id,
        sessionId: String(activeSession?.id || '').trim(),
        childId: String(child?.id || '').trim(),
        targetId: String(targetId || '').trim(),
        recordedBy: therapistId,
        intervalType,
        intervalIndex: intervalSamples.length,
        intervalStartAt: intervalStartAt.toISOString(),
        intervalEndAt: intervalEndAt.toISOString(),
        observed: Boolean(observed),
        note,
      };
      const created = preview ? { id: createPreviewId('interval-sample'), ...payload } : (await Api.saveIntervalSample(payload))?.item;
      const next = [created, ...intervalSamples].filter(Boolean);
      setIntervalSamples(next);
      await refreshSheetStats(behaviorEvents, skillTrials, durationTimers, abcObservations, next, latencyRecords);
      return created;
    }, () => recordIntervalSample({ targetId, intervalType, intervalMinutes, observed, note }));
  }

  async function startLatencyRecording({ targetId, cueDescription = '' } = {}) {
    if (runningLatencyRecord?.id) return runningLatencyRecord;
    return runTrackedSave(async () => {
      const currentSheet = await ensureSheet();
      const payload = {
        sessionDataSheetId: currentSheet.id,
        sessionId: String(activeSession?.id || '').trim(),
        childId: String(child?.id || '').trim(),
        targetId: String(targetId || '').trim(),
        recordedBy: therapistId,
        cueAt: new Date().toISOString(),
        cueDescription,
        completed: false,
      };
      const created = preview ? { id: createPreviewId('latency-record'), ...payload } : (await Api.saveLatencyRecord(payload))?.item;
      const next = [created, ...latencyRecords].filter(Boolean);
      setLatencyRecords(next);
      await refreshSheetStats(behaviorEvents, skillTrials, durationTimers, abcObservations, intervalSamples, next);
      return created;
    }, () => startLatencyRecording({ targetId, cueDescription }));
  }

  async function stopLatencyRecording({ responseDescription = '' } = {}) {
    if (!runningLatencyRecord?.id) return null;
    return runTrackedSave(async () => {
      const responseAt = new Date().toISOString();
      const cueStamp = Date.parse(String(runningLatencyRecord.cueAt || ''));
      const responseStamp = Date.parse(responseAt);
      const latencyMs = Number.isFinite(cueStamp) && Number.isFinite(responseStamp)
        ? Math.max(0, responseStamp - cueStamp)
        : 0;
      const payload = {
        ...runningLatencyRecord,
        responseAt,
        responseDescription,
        latencyMs,
        completed: true,
      };
      const updated = preview ? payload : (await Api.saveLatencyRecord(payload, runningLatencyRecord))?.item;
      const next = latencyRecords.map((item) => (item?.id === runningLatencyRecord.id ? updated : item));
      setLatencyRecords(next);
      await refreshSheetStats(behaviorEvents, skillTrials, durationTimers, abcObservations, intervalSamples, next);
      return updated;
    }, () => stopLatencyRecording({ responseDescription }));
  }

  async function completeCurrentSheet({ therapistSessionNotes = '', parentSafeSessionNotes = '' } = {}) {
    return runTrackedSave(async () => {
      const currentSheet = await ensureSheet();
      const completedAt = new Date().toISOString();
      const nextQuickStats = computeAbaQuickStats({ behaviorEvents, skillTrials, durationTimers, abcObservations, intervalSamples, latencyRecords });
      const sheetPayload = {
        ...currentSheet,
        endAt: activeSession?.endedAt || completedAt,
        sessionState: 'completed',
        therapistSessionNotes,
        parentSafeSessionNotes,
        quickStats: nextQuickStats,
        completedBy: therapistId,
        completedAt,
        targetIds: Array.from(new Set([
          ...(Array.isArray(currentSheet?.targetIds) ? currentSheet.targetIds : []),
          ...activeTargets.map((item) => item.id),
        ])),
      };
      const savedSheet = preview ? sheetPayload : (await Api.saveSessionDataSheet(sheetPayload, currentSheet))?.item;
      if (savedSheet) setSheet(savedSheet);
      const parentDraft = buildParentSafeSummaryDraft({
        childName: child?.name || 'Learner',
        sheet: savedSheet,
        trials: skillTrials,
        events: behaviorEvents,
        targetsById: targetMap,
      });
      const parentSummaryPayload = {
        childId: String(child?.id || '').trim(),
        sessionId: String(activeSession?.id || '').trim(),
        sessionDataSheetId: String(savedSheet?.id || '').trim(),
        authoredBy: therapistId,
        date: savedSheet?.date || toDateKey(completedAt),
        strengthsObserved: parentDraft.strengthsObserved,
        focusAreas: parentDraft.focusAreas,
        highLevelProgress: parentDraft.highLevelProgress,
        homeCarryoverTip: parentDraft.homeCarryoverTip,
        sensitiveDetailsExcluded: true,
        status: 'draft',
      };
      const savedParentSummary = preview ? { id: createPreviewId('parent-summary'), ...parentSummaryPayload } : (await Api.saveParentSummary(parentSummaryPayload))?.item;
      return { sheet: savedSheet, parentSummary: savedParentSummary, quickStats: nextQuickStats };
    }, () => completeCurrentSheet({ therapistSessionNotes, parentSafeSessionNotes }));
  }

  return {
    loading,
    saving,
    sheet,
    targets,
    activeTargets,
    behaviorEvents,
    abcObservations,
    skillTrials,
    durationTimers,
    intervalSamples,
    latencyRecords,
    saveError,
    pendingOfflineWriteCount,
    syncingPendingOfflineWrites,
    runningDurationTimer,
    runningLatencyRecord,
    quickStats,
    ensureSheet,
    recordFrequencyEvent,
    addAbcObservation,
    addSkillTrial,
    toggleDurationTimer,
    recordIntervalSample,
    startLatencyRecording,
    stopLatencyRecording,
    completeCurrentSheet,
    retryLastSave,
    syncPendingOfflineWrites,
  };
}

export default useAbaSessionSheet;