import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { getTherapySessionSummaryText } from '../../../Api';
import SessionSummarySnapshot from '../../../components/SessionSummarySnapshot';
import { THERAPY_EVENT_GROUPS } from '../constants/behaviorCatalog';
import BehaviorTapGrid from './BehaviorTapGrid';
import LiveEventFeed from './LiveEventFeed';
const { summarizeSessionStamp } = require('../utils/previewWorkspace');

function toLineItems(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function TherapySessionPanel({ workspace, mode = 'combined', title = 'Therapy Session Workspace', trackerPaused = false, hideTrackerFeed = false, showInactiveTracker = false, inactiveTrackerMessage = '', onSubmitted }) {
  const showTracker = mode === 'combined' || mode === 'tracker';
  const showSummary = mode === 'combined' || mode === 'summary';
  const [progressLevel, setProgressLevel] = useState('');
  const [independenceLevel, setIndependenceLevel] = useState('');
  const [interferingBehaviorLevel, setInterferingBehaviorLevel] = useState('');
  const [monthlyGoalCategory, setMonthlyGoalCategory] = useState('');
  const [monthlyGoalDescription, setMonthlyGoalDescription] = useState('');
  const [monthlyGoalTargetCriteria, setMonthlyGoalTargetCriteria] = useState('');
  const [programsWorkedOnText, setProgramsWorkedOnText] = useState('');
  const [successCriteriaText, setSuccessCriteriaText] = useState('');
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState('');
  const [artifactText, setArtifactText] = useState('');
  const feedItems = [
    ...workspace.queuedEvents.slice().reverse().map((entry) => ({
      feedId: entry.localId,
      label: entry.label,
      intensity: entry.intensity,
      detailLabel: entry.detailLabel,
      occurredAt: entry.occurredAt,
      status: 'queued',
    })),
    ...workspace.recentEvents,
  ].slice(0, 12);

  useEffect(() => {
    const summary = workspace.draftSummary?.summary || {};
    setProgressLevel(String(summary?.dailyRecap?.progressLevel || ''));
    setIndependenceLevel(String(summary?.dailyRecap?.independenceLevel || ''));
    setInterferingBehaviorLevel(String(summary?.dailyRecap?.interferingBehaviorLevel || ''));
    setMonthlyGoalCategory(String(summary?.monthlyGoal?.category || ''));
    setMonthlyGoalDescription(String(summary?.monthlyGoal?.description || ''));
    setMonthlyGoalTargetCriteria(String(summary?.monthlyGoal?.targetCriteria || ''));
    setProgramsWorkedOnText(Array.isArray(summary?.programsWorkedOn) ? summary.programsWorkedOn.join(', ') : '');
    setSuccessCriteriaText(Array.isArray(summary?.successCriteriaMet) ? summary.successCriteriaMet.join('\n') : '');
  }, [workspace.draftSummary]);

  const composedSummary = useMemo(() => {
    if (!workspace.draftSummary?.summary) return null;
    return {
      ...(workspace.draftSummary.summary || {}),
      dailyRecap: {
        ...(workspace.draftSummary.summary?.dailyRecap || {}),
        therapistNarrative: workspace.summaryNarrative || workspace.draftSummary.summary?.dailyRecap?.therapistNarrative || '',
        progressLevel: progressLevel.trim(),
        independenceLevel: independenceLevel.trim(),
        interferingBehaviorLevel: interferingBehaviorLevel.trim(),
      },
      monthlyGoal: {
        ...(workspace.draftSummary.summary?.monthlyGoal || {}),
        category: monthlyGoalCategory.trim(),
        description: monthlyGoalDescription.trim(),
        targetCriteria: monthlyGoalTargetCriteria.trim(),
      },
      programsWorkedOn: toLineItems(programsWorkedOnText),
      successCriteriaMet: toLineItems(successCriteriaText),
    };
  }, [independenceLevel, interferingBehaviorLevel, monthlyGoalCategory, monthlyGoalDescription, monthlyGoalTargetCriteria, programsWorkedOnText, progressLevel, successCriteriaText, workspace.draftSummary, workspace.summaryNarrative]);

  async function openArtifactPreview() {
    const sessionId = String(workspace.draftSummary?.sessionId || '').trim();
    if (!sessionId) return;
    setArtifactOpen(true);
    setArtifactLoading(true);
    setArtifactError('');
    setArtifactText('');
    try {
      const result = await getTherapySessionSummaryText(sessionId);
      setArtifactText(String(result?.text || '').trim());
    } catch (error) {
      setArtifactError(String(error?.message || error || 'Could not load the session summary artifact.'));
    } finally {
      setArtifactLoading(false);
    }
  }

  return (
    <View style={styles.sectionCard}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.headerMetaRow}>
          {workspace.activeSession ? <Text style={styles.sessionMetaText}>Active {workspace.activeSession.sessionType} session started {summarizeSessionStamp(workspace.activeSession)}.</Text> : null}
          {workspace.loadingSession || workspace.savingSession || workspace.syncingQueuedEvents ? <ActivityIndicator size="small" color="#2563eb" /> : null}
        </View>
      </View>
      {workspace.preview ? <Text style={styles.previewBanner}>Preview mode: changes stay local to this screen.</Text> : null}
      {workspace.queueSyncError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{workspace.queueSyncError}</Text>
          {workspace.queuedEvents?.length ? (
            <TouchableOpacity style={styles.errorBannerButton} onPress={() => workspace.retryQueuedEvents?.().catch?.(() => {})}>
              <Text style={styles.errorBannerButtonText}>Retry Sync</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {showTracker ? <Text style={styles.trackerHelpText}>Tap a button to open the event menu and define the event before it is queued.</Text> : null}

      {showTracker ? (
        <View>
          {workspace.activeSession ? (
            <>
              <BehaviorTapGrid
                groups={THERAPY_EVENT_GROUPS}
                queuedEvents={workspace.queuedEvents}
                disabled={trackerPaused || workspace.savingSession || workspace.syncingQueuedEvents}
                onQueueEvent={workspace.queueSessionEvent}
                onUndoLast={workspace.undoLastQueuedEvent}
              />
              {!hideTrackerFeed ? <LiveEventFeed items={feedItems} /> : null}
            </>
          ) : showInactiveTracker ? (
            <>
              <View style={styles.inactiveTrackerWrap}>
                <BehaviorTapGrid
                  groups={THERAPY_EVENT_GROUPS}
                  queuedEvents={[]}
                  disabled
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.bodyText}>No active therapist session for this learner.</Text>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => workspace.handleStartSession('AM')} disabled={workspace.savingSession}>
                  <Text style={styles.secondaryButtonText}>Start AM</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryButton} onPress={() => workspace.handleStartSession('PM')} disabled={workspace.savingSession}>
                  <Text style={styles.primaryButtonText}>Start PM</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      ) : null}

      {showSummary ? (
        <View style={showTracker ? styles.summaryTop : null}>
          {workspace.draftSummary?.summary ? (
            <View>
              <SessionSummarySnapshot
                summary={{
                  ...workspace.draftSummary,
                  summary: composedSummary || workspace.draftSummary.summary,
                }}
                title="Session Report"
                subtitle="Review before submitting"
                emptyText="Session report unavailable."
              />
              <Text style={[styles.subtitle, { marginTop: 14 }]}>Progress Level</Text>
              <TextInput
                value={progressLevel}
                onChangeText={setProgressLevel}
                placeholder="Moderate progress"
                style={styles.singleLineInput}
              />
              <Text style={[styles.subtitle, { marginTop: 12 }]}>Independence Level</Text>
              <TextInput
                value={independenceLevel}
                onChangeText={setIndependenceLevel}
                placeholder="Prompt dependent"
                style={styles.singleLineInput}
              />
              <Text style={[styles.subtitle, { marginTop: 12 }]}>Behavior Level</Text>
              <TextInput
                value={interferingBehaviorLevel}
                onChangeText={setInterferingBehaviorLevel}
                placeholder="Low"
                style={styles.singleLineInput}
              />
              <Text style={[styles.subtitle, { marginTop: 12 }]}>Monthly Goal</Text>
              <TextInput
                value={monthlyGoalCategory}
                onChangeText={setMonthlyGoalCategory}
                placeholder="Communication, adaptive living, safety"
                style={styles.singleLineInput}
              />
              <TextInput
                value={monthlyGoalDescription}
                onChangeText={setMonthlyGoalDescription}
                placeholder="Add or refine the current monthly goal"
                multiline
                style={styles.noteInput}
              />
              <TextInput
                value={monthlyGoalTargetCriteria}
                onChangeText={setMonthlyGoalTargetCriteria}
                placeholder="80% independence across 3 sessions"
                multiline
                style={styles.noteInput}
              />
              <Text style={[styles.subtitle, { marginTop: 12 }]}>Programs Worked On</Text>
              <TextInput
                value={programsWorkedOnText}
                onChangeText={setProgramsWorkedOnText}
                placeholder="Program A, Program B"
                multiline
                style={styles.noteInput}
              />
              <Text style={[styles.subtitle, { marginTop: 12 }]}>Milestones Met</Text>
              <TextInput
                value={successCriteriaText}
                onChangeText={setSuccessCriteriaText}
                placeholder="One milestone per line"
                multiline
                style={styles.noteInput}
              />
              <Text style={[styles.subtitle, { marginTop: 14 }]}>Notes</Text>
              <TextInput
                value={workspace.summaryNarrative}
                onChangeText={workspace.setSummaryNarrative}
                placeholder="Add session notes"
                multiline
                style={styles.noteInput}
              />
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => openArtifactPreview().catch(() => {})} disabled={workspace.savingSession || !workspace.draftSummary?.sessionId}>
                  <Text style={styles.secondaryButtonText}>Preview SessionSummary.txt</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => workspace.handleSaveDraft(composedSummary)} disabled={workspace.savingSession}>
                  <Text style={styles.secondaryButtonText}>Save Draft</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryButton} onPress={async () => {
                  const result = await workspace.handleApproveSummary(composedSummary);
                  if (result?.submitted && typeof onSubmitted === 'function') await onSubmitted(result);
                }} disabled={workspace.savingSession}>
                  <Text style={styles.primaryButtonText}>Submit</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text style={styles.bodyText}>End a session to generate a summary draft for review.</Text>
          )}
        </View>
      ) : null}

      <Modal transparent visible={artifactOpen} animationType="fade" onRequestClose={() => setArtifactOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>SessionSummary.txt Preview</Text>
            <Text style={styles.modalSubtitle}>Review the generated text artifact that backs the approved session summary.</Text>
            {artifactLoading ? <ActivityIndicator style={styles.artifactLoading} size="small" color="#2563eb" /> : null}
            {artifactError ? <Text style={styles.artifactError}>{artifactError}</Text> : null}
            {!artifactLoading && !artifactError ? (
              <ScrollView style={styles.artifactTextWrap} contentContainerStyle={styles.artifactTextContent}>
                <Text style={styles.artifactText}>{artifactText || 'No generated session summary artifact is available yet.'}</Text>
              </ScrollView>
            ) : null}
            <View style={styles.modalActionRow}>
              <TouchableOpacity style={styles.modalSecondaryButton} onPress={() => setArtifactOpen(false)}>
                <Text style={styles.modalSecondaryButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionCard: { marginTop: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f8fafc' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerMetaRow: { flexDirection: 'row', alignItems: 'center', marginLeft: 12, flex: 1, justifyContent: 'flex-end' },
  title: { fontWeight: '700', marginBottom: 6 },
  subtitle: { fontWeight: '700', marginBottom: 6 },
  sessionMetaText: { color: '#475569', fontSize: 12, textAlign: 'right', marginRight: 10, flexShrink: 1 },
  trackerHelpText: { marginTop: 4, color: '#475569', lineHeight: 18 },
  bodyText: { color: '#374151' },
  inactiveTrackerWrap: { opacity: 0.55 },
  previewBanner: { marginTop: 8, marginBottom: 4, color: '#1d4ed8', backgroundColor: '#eff6ff', borderRadius: 10, padding: 10, lineHeight: 18 },
  errorBanner: { marginTop: 8, borderRadius: 12, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', padding: 12 },
  errorBannerText: { color: '#991b1b', lineHeight: 18 },
  errorBannerButton: { alignSelf: 'flex-start', marginTop: 10, borderRadius: 10, backgroundColor: '#fee2e2', paddingHorizontal: 12, paddingVertical: 9 },
  errorBannerButtonText: { color: '#991b1b', fontWeight: '700' },
  singleLineInput: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 },
  noteInput: { minHeight: 88, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, marginTop: 12, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#e2e8f0', marginRight: 8 },
  secondaryButtonText: { color: '#0f172a', fontWeight: '700' },
  primaryButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563eb' },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  summaryTop: { marginTop: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)', justifyContent: 'center', padding: 18 },
  modalCard: { borderRadius: 18, backgroundColor: '#ffffff', padding: 18, maxHeight: '80%' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  modalSubtitle: { marginTop: 8, color: '#475569', lineHeight: 18 },
  modalActionRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  modalSecondaryButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#e2e8f0' },
  modalSecondaryButtonText: { color: '#0f172a', fontWeight: '700' },
  artifactLoading: { marginTop: 16 },
  artifactError: { marginTop: 16, color: '#b91c1c', lineHeight: 20 },
  artifactTextWrap: { marginTop: 12, maxHeight: 360, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, backgroundColor: '#f8fafc' },
  artifactTextContent: { padding: 12 },
  artifactText: { color: '#334155', lineHeight: 20 },
});