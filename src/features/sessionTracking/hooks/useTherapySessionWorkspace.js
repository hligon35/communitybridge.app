import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import {
  approveTherapySessionSummary,
  appendTherapySessionEvent,
  appendTherapySessionEventsBulk,
  endTherapySession,
  getActiveTherapySession,
  getLatestChildSessionSummary,
  getTherapySessionEvents,
  getTherapySessionSummary,
  startTherapySession,
  updateTherapySessionSummary,
} from '../../../Api';
import {
  PREVIEW_DRAFT_SUMMARY,
  PREVIEW_EVENTS,
  createPreviewDraftSummary,
  createPreviewSession,
  mapEventToFeedItem,
  summarizeSessionStamp,
} from '../utils/previewWorkspace';

export function useTherapySessionWorkspace({ child, preview = false, canManageSession = true, fetchAndSync, initialDraftSummary = null, seededRecentEvents = [] }) {
  const [activeSession, setActiveSession] = useState(null);
  const [draftSummary, setDraftSummary] = useState(null);
  const [latestApprovedSummary, setLatestApprovedSummary] = useState(null);
  const [sessionNote, setSessionNote] = useState('');
  const [summaryNarrative, setSummaryNarrative] = useState('');
  const [loadingSession, setLoadingSession] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [queuedEvents, setQueuedEvents] = useState([]);
  const [syncingQueuedEvents, setSyncingQueuedEvents] = useState(false);
  const [queueSyncError, setQueueSyncError] = useState('');
  const [recentEvents, setRecentEvents] = useState([]);
  const [previewActiveSessionState, setPreviewActiveSessionState] = useState(null);
  const [previewDraftSummaryState, setPreviewDraftSummaryState] = useState(() => (preview ? PREVIEW_DRAFT_SUMMARY : null));
  const [previewLatestApprovedSummary, setPreviewLatestApprovedSummary] = useState(() => (preview ? PREVIEW_DRAFT_SUMMARY : null));
  const [previewRecentEvents, setPreviewRecentEvents] = useState(() => (preview ? [...PREVIEW_EVENTS] : []));
  const flushTimerRef = useRef(null);
  const queuedEventsRef = useRef([]);

  const effectiveActiveSession = preview ? previewActiveSessionState : activeSession;
  const effectiveDraftSummary = preview ? previewDraftSummaryState : draftSummary;
  const effectiveLatestApprovedSummary = preview ? previewLatestApprovedSummary : latestApprovedSummary;
  const effectiveRecentEvents = preview ? previewRecentEvents : recentEvents;
  const stableSeededRecentEvents = useMemo(() => (Array.isArray(seededRecentEvents) ? seededRecentEvents : []), [seededRecentEvents]);
  const seededRecentEventsKey = useMemo(() => JSON.stringify(
    stableSeededRecentEvents.map((item) => ({
      feedId: item?.feedId || item?.id || '',
      label: item?.label || '',
      occurredAt: item?.occurredAt || item?.createdAt || '',
      status: item?.status || '',
    }))
  ), [stableSeededRecentEvents]);
  const summarySubtitle = useMemo(() => {
    if (!effectiveLatestApprovedSummary) return '';
    const stamp = summarizeSessionStamp(effectiveLatestApprovedSummary);
    return stamp ? `Approved ${stamp}` : '';
  }, [effectiveLatestApprovedSummary]);

  useEffect(() => {
    queuedEventsRef.current = queuedEvents;
  }, [queuedEvents]);

  useEffect(() => {
    if (!queuedEvents.length) setQueueSyncError('');
  }, [queuedEvents.length]);

  useEffect(() => {
    let disposed = false;
    const demoRecentEvents = stableSeededRecentEvents;
    async function loadSessionState() {
      if (preview || !child?.id || !canManageSession) {
        if (!disposed) {
          setActiveSession(null);
          setDraftSummary(null);
          setLatestApprovedSummary(null);
          if (!preview) setSummaryNarrative('');
        }
        return;
      }
      setLoadingSession(true);
      try {
        const [activeResult, latestResult] = await Promise.all([
          getActiveTherapySession(child.id),
          getLatestChildSessionSummary(child.id),
        ]);
        if (disposed) return;
        setActiveSession(activeResult?.item || null);
        setLatestApprovedSummary(latestResult?.item || null);
        if (activeResult?.item?.id) {
          const eventsResult = await getTherapySessionEvents(activeResult.item.id, 24).catch(() => ({ items: [] }));
          if (!disposed) setRecentEvents((eventsResult.items || []).map((item) => mapEventToFeedItem(item)).slice(0, 12));
        } else if (!disposed) {
          setRecentEvents([...demoRecentEvents]);
        }
      } catch (_) {
        if (!disposed) {
          setActiveSession(null);
          setLatestApprovedSummary(null);
          setRecentEvents([...demoRecentEvents]);
        }
      } finally {
        if (!disposed) setLoadingSession(false);
      }
    }
    loadSessionState();
    return () => {
      disposed = true;
    };
  }, [preview, child?.id, canManageSession, seededRecentEventsKey]);

  useEffect(() => {
    if (!preview) {
      const narrative = draftSummary?.summary?.dailyRecap?.therapistNarrative;
      setSummaryNarrative(typeof narrative === 'string' ? narrative : '');
    }
  }, [draftSummary, preview]);

  useEffect(() => {
    if (preview || !initialDraftSummary) return;
    setDraftSummary(initialDraftSummary);
  }, [initialDraftSummary, preview]);

  useEffect(() => {
    if (preview) {
      const previewNarrative = previewDraftSummaryState?.summary?.dailyRecap?.therapistNarrative;
      if (typeof previewNarrative === 'string') setSummaryNarrative(previewNarrative);
    }
  }, [preview, previewDraftSummaryState]);

  useEffect(() => () => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
  }, []);

  useEffect(() => {
    setQueuedEvents([]);
    queuedEventsRef.current = [];
    if (!preview) setRecentEvents([]);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
  }, [activeSession?.id, preview]);

  async function refreshApprovedSummary() {
    try {
      if (preview || !child?.id) return;
      const result = await getLatestChildSessionSummary(child.id);
      setLatestApprovedSummary(result?.item || null);
    } catch (_) {
      setLatestApprovedSummary(null);
    }
  }

  function armQueueFlush() {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    if (!queuedEventsRef.current.length || !effectiveActiveSession?.id) return;
    flushTimerRef.current = setTimeout(() => {
      flushQueuedEvents().catch((e) => {
        Alert.alert('Could not sync tap events', String(e?.message || e || 'Please try again.'));
      });
    }, 1200);
  }

  function queueSessionEvent(payload, preset, intensityOverride = null, variantOption = null) {
    if (!effectiveActiveSession?.id || syncingQueuedEvents || savingSession) return;
    const occurredAt = payload?.occurredAt || new Date().toISOString();
    const queuedEvent = {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: preset?.label || payload?.label || payload?.eventType || 'Event',
      intensity: intensityOverride || payload?.intensity || null,
      detailLabel: variantOption?.detailLabel || null,
      occurredAt,
      payload: { ...payload, occurredAt },
    };
    setQueuedEvents((current) => {
      const next = [...current, queuedEvent].slice(-12);
      queuedEventsRef.current = next;
      return next;
    });
    armQueueFlush();
  }

  function undoLastQueuedEvent() {
    if (!queuedEventsRef.current.length || syncingQueuedEvents || savingSession) return;
    setQueuedEvents((current) => {
      const next = current.slice(0, -1);
      queuedEventsRef.current = next;
      return next;
    });
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    if (queuedEventsRef.current.length > 0) armQueueFlush();
  }

  async function flushQueuedEvents() {
    const eventsToSend = queuedEventsRef.current.slice();
    if (!eventsToSend.length || !effectiveActiveSession?.id) return;
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    setSyncingQueuedEvents(true);
    setQueueSyncError('');
    try {
      if (preview) {
        setPreviewRecentEvents((current) => {
          const nextItems = eventsToSend.map((entry) => ({
            feedId: entry.localId,
            label: entry.label,
            intensity: entry.intensity,
            detailLabel: entry.detailLabel,
            occurredAt: entry.occurredAt,
            status: 'synced',
          }));
          return [...nextItems.reverse(), ...current].slice(0, 12);
        });
        setQueuedEvents([]);
        queuedEventsRef.current = [];
        return;
      }
      const result = await appendTherapySessionEventsBulk(activeSession.id, eventsToSend.map((entry) => entry.payload));
      const syncedItems = Array.isArray(result?.items) ? result.items : [];
      setRecentEvents((current) => {
        const nextItems = eventsToSend.map((entry, index) => ({
          ...(syncedItems[index] ? mapEventToFeedItem(syncedItems[index]) : {
            feedId: entry.localId,
            label: entry.label,
            intensity: entry.intensity,
            detailLabel: entry.detailLabel,
            occurredAt: entry.occurredAt,
            status: 'synced',
          }),
        }));
        return [...nextItems.reverse(), ...current].slice(0, 12);
      });
      setQueuedEvents([]);
      queuedEventsRef.current = [];
      setQueueSyncError('');
    } catch (error) {
      setQueueSyncError(String(error?.message || error || 'Could not sync queued session events.'));
      throw error;
    } finally {
      setSyncingQueuedEvents(false);
    }
  }

  async function retryQueuedEvents() {
    if (!queuedEventsRef.current.length || syncingQueuedEvents) return;
    try {
      await flushQueuedEvents();
    } catch (_) {
      // Preserve the queued events and visible retry state.
    }
  }

  async function handleStartSession(sessionType) {
    if (preview) {
      setPreviewActiveSessionState(createPreviewSession(sessionType));
      setPreviewDraftSummaryState(createPreviewDraftSummary(summaryNarrative, previewRecentEvents));
      setSessionNote('');
      return;
    }
    if (!child?.id || savingSession) return;
    setSavingSession(true);
    try {
      const result = await startTherapySession({
        childId: child.id,
        childName: child.name,
        organizationId: child.organizationId,
        programId: child.programId || child.branchId,
        campusId: child.campusId,
        sessionType,
      });
      setActiveSession(result?.item || null);
      setDraftSummary(null);
      setSessionNote('');
      Alert.alert('Session started', `${sessionType} session opened for ${child.name}.`);
    } catch (e) {
      Alert.alert('Could not start session', String(e?.message || e || 'Please try again.'));
    } finally {
      setSavingSession(false);
    }
  }

  async function handleSaveNote() {
    if (preview) {
      const trimmed = sessionNote.trim();
      if (!trimmed) return;
      setPreviewRecentEvents((current) => ([{
        feedId: `preview-note-${Date.now()}`,
        label: 'Therapist note',
        detailLabel: trimmed,
        occurredAt: new Date().toISOString(),
        status: 'synced',
      }, ...current].slice(0, 12)));
      setSessionNote('');
      return;
    }
    if (!activeSession?.id || !sessionNote.trim() || savingSession) return;
    setSavingSession(true);
    try {
      const result = await appendTherapySessionEvent(activeSession.id, {
        eventType: 'note',
        eventCode: 'therapist_note',
        label: 'Therapist note',
        metadata: { note: sessionNote.trim() },
      });
      if (result?.item) setRecentEvents((current) => [mapEventToFeedItem(result.item), ...current].slice(0, 12));
      setSessionNote('');
      Alert.alert('Saved', 'Therapist note added to the session.');
    } catch (e) {
      Alert.alert('Could not save note', String(e?.message || e || 'Please try again.'));
    } finally {
      setSavingSession(false);
    }
  }

  async function handleEndSession() {
    if (preview) {
      await flushQueuedEvents();
      setPreviewActiveSessionState(null);
      const nextDraft = createPreviewDraftSummary(summaryNarrative, previewRecentEvents);
      setPreviewDraftSummaryState(nextDraft);
      return { draftSummary: nextDraft };
    }
    if (!activeSession?.id || savingSession || syncingQueuedEvents) return;
    setSavingSession(true);
    try {
      const endingSession = activeSession;
      await flushQueuedEvents();
      const result = await endTherapySession(endingSession.id, {});
      setActiveSession(null);
      const sessionId = result?.item?.id || endingSession.id;
      const summaryResult = sessionId ? await getTherapySessionSummary(sessionId).catch(() => ({ item: result?.summary || null })) : { item: result?.summary || null };
      const nextDraft = summaryResult?.item || result?.summary || null;
      setDraftSummary(nextDraft);
      setSessionNote('');
      return { draftSummary: nextDraft };
    } catch (e) {
      Alert.alert('Could not end session', String(e?.message || e || 'Please try again.'));
    } finally {
      setSavingSession(false);
    }
  }

  async function handleSaveDraft() {
    const overrideSummary = arguments[0] || null;
    if (preview) {
      const nextPreviewDraft = overrideSummary
        ? {
            ...(previewDraftSummaryState || PREVIEW_DRAFT_SUMMARY),
            summary: overrideSummary,
          }
        : createPreviewDraftSummary(summaryNarrative, previewRecentEvents);
      setPreviewDraftSummaryState(nextPreviewDraft);
      return;
    }
    if (!draftSummary?.sessionId || savingSession) return;
    setSavingSession(true);
    try {
      const nextSummary = overrideSummary || {
        ...(draftSummary.summary || {}),
        dailyRecap: {
          ...(draftSummary.summary?.dailyRecap || {}),
          therapistNarrative: summaryNarrative.trim(),
        },
      };
      const result = await updateTherapySessionSummary(draftSummary.sessionId, { summary: nextSummary });
      setDraftSummary(result?.item || null);
      Alert.alert('Draft saved', 'The summary draft was updated.');
    } catch (e) {
      Alert.alert('Could not save draft', String(e?.message || e || 'Please try again.'));
    } finally {
      setSavingSession(false);
    }
  }

  async function handleApproveSummary() {
    const overrideSummary = arguments[0] || null;
    if (preview) {
      const nextSummary = overrideSummary
        ? {
            ...(previewDraftSummaryState || PREVIEW_DRAFT_SUMMARY),
            summary: overrideSummary,
          }
        : createPreviewDraftSummary(summaryNarrative, previewRecentEvents);
      setPreviewDraftSummaryState(nextSummary);
      setPreviewLatestApprovedSummary({ ...nextSummary, approvedAt: new Date().toISOString() });
      return;
    }
    if (!draftSummary?.sessionId || savingSession) return;
    setSavingSession(true);
    try {
      const nextSummary = overrideSummary || {
        ...(draftSummary.summary || {}),
        dailyRecap: {
          ...(draftSummary.summary?.dailyRecap || {}),
          therapistNarrative: summaryNarrative.trim(),
        },
      };
      const result = await approveTherapySessionSummary(draftSummary.sessionId, { summary: nextSummary });
      setDraftSummary(null);
      setLatestApprovedSummary(result?.item || null);
      await refreshApprovedSummary();
      fetchAndSync?.({ force: true })?.catch?.(() => {});
      Alert.alert('Submitted', 'The session report was submitted successfully.');
      return { submitted: true, item: result?.item || null };
    } catch (e) {
      Alert.alert('Could not approve summary', String(e?.message || e || 'Please try again.'));
    } finally {
      setSavingSession(false);
    }
  }

  return {
    activeSession: effectiveActiveSession,
    draftSummary: effectiveDraftSummary,
    latestApprovedSummary: effectiveLatestApprovedSummary,
    recentEvents: effectiveRecentEvents,
    queuedEvents,
    queueSyncError,
    sessionNote,
    summaryNarrative,
    loadingSession,
    savingSession,
    syncingQueuedEvents,
    summarySubtitle,
    setSessionNote,
    setSummaryNarrative,
    queueSessionEvent,
    undoLastQueuedEvent,
    flushQueuedEvents,
    retryQueuedEvents,
    handleStartSession,
    handleSaveNote,
    handleEndSession,
    handleSaveDraft,
    handleApproveSummary,
    preview,
  };
}