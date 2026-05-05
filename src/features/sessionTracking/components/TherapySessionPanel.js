import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import SessionSummarySnapshot from '../../../components/SessionSummarySnapshot';
import { THERAPY_EVENT_GROUPS } from '../constants/behaviorCatalog';
import BehaviorTapGrid from './BehaviorTapGrid';
import LiveEventFeed from './LiveEventFeed';
const { summarizeSessionStamp } = require('../utils/previewWorkspace');

export default function TherapySessionPanel({ workspace, mode = 'combined', title = 'Therapy Session Workspace', trackerPaused = false, hideTrackerFeed = false, showInactiveTracker = false, inactiveTrackerMessage = '', onSubmitted }) {
  const showTracker = mode === 'combined' || mode === 'tracker';
  const showSummary = mode === 'combined' || mode === 'summary';
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
                  summary: {
                    ...(workspace.draftSummary.summary || {}),
                    dailyRecap: {
                      ...(workspace.draftSummary.summary?.dailyRecap || {}),
                      therapistNarrative: workspace.summaryNarrative || workspace.draftSummary.summary?.dailyRecap?.therapistNarrative || '',
                    },
                  },
                }}
                title="Session Report"
                subtitle="Review before submitting"
                emptyText="Session report unavailable."
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
                <TouchableOpacity style={styles.primaryButton} onPress={async () => {
                  const result = await workspace.handleApproveSummary();
                  if (result?.submitted && typeof onSubmitted === 'function') onSubmitted(result);
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
  noteInput: { minHeight: 88, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, marginTop: 12, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#e2e8f0', marginRight: 8 },
  secondaryButtonText: { color: '#0f172a', fontWeight: '700' },
  primaryButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563eb' },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  summaryTop: { marginTop: 14 },
});