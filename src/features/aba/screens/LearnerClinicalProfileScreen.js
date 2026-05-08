import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { ScreenWrapper } from '../../../components/ScreenWrapper';
import InsightStatCard from '../../sessionInsights/components/InsightStatCard';
import TrendMiniChart from '../../sessionInsights/components/TrendMiniChart';
import { useAuth } from '../../../AuthContext';
import { useData } from '../../../DataContext';
import * as Api from '../../../Api';
import {
  buildDurationSeries,
  buildFrequencySeries,
  buildLatencySeries,
  buildPercentCorrectSeries,
} from '../services/abaAggregates';

function toLineItems(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toChartItems(series = []) {
  return series.slice(-6).map((item) => ({ label: String(item?.date || '').slice(5) || 'Date', value: item?.value || 0 }));
}

function DecisionChip({ active, label, onPress }) {
  return (
    <TouchableOpacity style={[styles.decisionChip, active ? styles.decisionChipActive : null]} onPress={onPress}>
      <Text style={[styles.decisionChipText, active ? styles.decisionChipTextActive : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function LearnerClinicalProfileScreen() {
  const route = useRoute();
  const { user } = useAuth();
  const { children = [] } = useData();
  const childId = String(route?.params?.childId || '').trim();
  const child = (Array.isArray(children) ? children : []).find((item) => String(item?.id || '').trim() === childId) || null;
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState([]);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [events, setEvents] = useState([]);
  const [trials, setTrials] = useState([]);
  const [durations, setDurations] = useState([]);
  const [latencyRecords, setLatencyRecords] = useState([]);
  const [phaseChanges, setPhaseChanges] = useState([]);
  const [reviewHistory, setReviewHistory] = useState([]);
  const [trendSummary, setTrendSummary] = useState('');
  const [interpretation, setInterpretation] = useState('');
  const [decision, setDecision] = useState('continue');
  const [actionItemsText, setActionItemsText] = useState('');
  const [nextReviewDate, setNextReviewDate] = useState('');
  const [targetStatus, setTargetStatus] = useState('active');
  const [masteryCriteria, setMasteryCriteria] = useState('');
  const [parentFriendlyLabel, setParentFriendlyLabel] = useState('');
  const [parentSummaryTemplate, setParentSummaryTemplate] = useState('');
  const [visibleToParent, setVisibleToParent] = useState(false);
  const [phaseType, setPhaseType] = useState('intervention');
  const [phaseNote, setPhaseNote] = useState('');
  const [savingAction, setSavingAction] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackTone, setFeedbackTone] = useState('info');

  const selectedTarget = targets.find((item) => item.id === selectedTargetId) || targets[0] || null;
  const frequencySeries = useMemo(() => toChartItems(buildFrequencySeries(events)), [events]);
  const durationSeries = useMemo(() => toChartItems(buildDurationSeries(durations)), [durations]);
  const percentCorrectSeries = useMemo(() => toChartItems(buildPercentCorrectSeries(trials)), [trials]);
  const latencySeries = useMemo(() => toChartItems(buildLatencySeries(latencyRecords)), [latencyRecords]);

  useEffect(() => {
    setTargetStatus(String(selectedTarget?.status || 'active'));
    setMasteryCriteria(String(selectedTarget?.masteryCriteria || ''));
    setParentFriendlyLabel(String(selectedTarget?.parentFriendlyLabel || ''));
    setParentSummaryTemplate(String(selectedTarget?.parentSummaryTemplate || ''));
    setVisibleToParent(Boolean(selectedTarget?.visibleToParent));
    setPhaseType(String(phaseChanges[0]?.phaseType || 'intervention'));
    setPhaseNote('');
  }, [phaseChanges, selectedTarget]);

  useEffect(() => {
    let disposed = false;
    async function loadTargets() {
      setLoading(true);
      try {
        const result = await Api.listBehaviorTargetsByChild(childId, 100);
        if (!disposed) {
          const nextTargets = Array.isArray(result?.items) ? result.items : [];
          setTargets(nextTargets);
          setSelectedTargetId((current) => current || nextTargets[0]?.id || '');
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    if (childId) loadTargets().catch(() => {
      if (!disposed) setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [childId]);

  useEffect(() => {
    let disposed = false;
    async function loadTargetData() {
      if (!selectedTarget?.id) {
        if (!disposed) {
          setEvents([]);
          setTrials([]);
          setDurations([]);
          setLatencyRecords([]);
          setPhaseChanges([]);
          setReviewHistory([]);
        }
        return;
      }
      setLoading(true);
      try {
        const sheetsResult = await Api.listSessionDataSheetsForBcba(String(user?.id || '').trim(), 100);
        const childSheets = (Array.isArray(sheetsResult?.items) ? sheetsResult.items : []).filter((item) => String(item?.childId || '').trim() === childId);
        const [targetPhaseChanges, targetReviews] = await Promise.all([
          Api.listPhaseChangesByTarget(selectedTarget.id, 50).catch(() => ({ items: [] })),
          Api.listTargetReviewsByTarget(selectedTarget.id, 20).catch(() => ({ items: [] })),
        ]);
        const detailResults = await Promise.all(childSheets.map(async (sheet) => {
          const [sheetEvents, sheetTrials, sheetDurations, sheetLatency] = await Promise.all([
            Api.listBehaviorEventsBySheet(sheet.id, 200).catch(() => ({ items: [] })),
            Api.listSkillTrialsBySheet(sheet.id, 200).catch(() => ({ items: [] })),
            Api.listDurationTimersBySheet(sheet.id, 200).catch(() => ({ items: [] })),
            Api.listLatencyRecordsBySheet(sheet.id, 200).catch(() => ({ items: [] })),
          ]);
          return {
            events: Array.isArray(sheetEvents?.items) ? sheetEvents.items : [],
            trials: Array.isArray(sheetTrials?.items) ? sheetTrials.items : [],
            durations: Array.isArray(sheetDurations?.items) ? sheetDurations.items : [],
            latency: Array.isArray(sheetLatency?.items) ? sheetLatency.items : [],
          };
        }));
        if (disposed) return;
        setEvents(detailResults.flatMap((item) => item.events).filter((item) => String(item?.targetId || '').trim() === selectedTarget.id));
        setTrials(detailResults.flatMap((item) => item.trials).filter((item) => String(item?.targetId || '').trim() === selectedTarget.id));
        setDurations(detailResults.flatMap((item) => item.durations).filter((item) => String(item?.targetId || '').trim() === selectedTarget.id));
        setLatencyRecords(detailResults.flatMap((item) => item.latency).filter((item) => String(item?.targetId || '').trim() === selectedTarget.id));
        setPhaseChanges(Array.isArray(targetPhaseChanges?.items) ? targetPhaseChanges.items : []);
        setReviewHistory(Array.isArray(targetReviews?.items) ? targetReviews.items : []);
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    loadTargetData().catch(() => {
      if (!disposed) setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [childId, selectedTarget?.id, user?.id]);

  async function saveTargetAdjustments() {
    if (!selectedTarget?.id) return;
    setSavingAction(true);
    setFeedbackMessage('');
    try {
      const result = await Api.saveBehaviorTarget({
        ...selectedTarget,
        status: targetStatus,
        masteryCriteria,
        visibleToParent,
        parentFriendlyLabel,
        parentSummaryTemplate,
      }, selectedTarget);
      const saved = result?.item || null;
      if (saved) {
        setTargets((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      }
      setFeedbackTone('success');
      setFeedbackMessage('Target settings updated.');
    } catch (error) {
      setFeedbackTone('error');
      setFeedbackMessage(String(error?.message || error || 'Could not update target settings.'));
    } finally {
      setSavingAction(false);
    }
  }

  async function savePhaseUpdate() {
    if (!selectedTarget?.id) return;
    setSavingAction(true);
    setFeedbackMessage('');
    try {
      const result = await Api.savePhaseChange({
        childId,
        targetId: selectedTarget.id,
        changedBy: String(user?.id || '').trim(),
        phaseType,
        effectiveDate: new Date().toISOString(),
        note: phaseNote.trim() || null,
      });
      const saved = result?.item || null;
      if (saved) setPhaseChanges((current) => [saved, ...current]);
      setPhaseNote('');
      setFeedbackTone('success');
      setFeedbackMessage('Phase change recorded.');
    } catch (error) {
      setFeedbackTone('error');
      setFeedbackMessage(String(error?.message || error || 'Could not record the phase change.'));
    } finally {
      setSavingAction(false);
    }
  }

  async function saveReviewDecision() {
    if (!selectedTarget?.id) return;
    setSavingAction(true);
    setFeedbackMessage('');
    try {
      const result = await Api.saveTargetReview({
        childId,
        targetId: selectedTarget.id,
        bcbaId: String(user?.id || '').trim(),
        reviewDate: new Date().toISOString(),
        reviewWindow: {
          startDate: null,
          endDate: new Date().toISOString(),
        },
        trendSummary,
        interpretation,
        decision,
        actionItems: toLineItems(actionItemsText),
        parentSafeSummary: parentSummaryTemplate || selectedTarget.parentSummaryTemplate || null,
        nextReviewDate: nextReviewDate.trim() || null,
      });
      const saved = result?.item || null;
      if (saved) setReviewHistory((current) => [saved, ...current]);
      setTrendSummary('');
      setInterpretation('');
      setActionItemsText('');
      setNextReviewDate('');
      setFeedbackTone('success');
      setFeedbackMessage('Review saved.');
    } catch (error) {
      setFeedbackTone('error');
      setFeedbackMessage(String(error?.message || error || 'Could not save the review decision.'));
    } finally {
      setSavingAction(false);
    }
  }

  return (
    <ScreenWrapper style={styles.screen} bannerTitle="Learner Clinical Profile">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>Learner Clinical Profile</Text>
          <Text style={styles.title}>{child?.name || 'Learner'}</Text>
          <Text style={styles.subtitle}>Target-level behavior trends, clinical phase markers, and BCBA review decisions stay here and remain separate from parent-safe summaries.</Text>
          {feedbackMessage ? <Text style={[styles.feedbackText, feedbackTone === 'error' ? styles.feedbackError : styles.feedbackSuccess]}>{feedbackMessage}</Text> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.targetRow}>
          {targets.map((target) => {
            const active = target.id === selectedTarget?.id;
            return (
              <TouchableOpacity key={target.id} style={[styles.targetChip, active ? styles.targetChipActive : null]} onPress={() => setSelectedTargetId(target.id)}>
                <Text style={[styles.targetChipText, active ? styles.targetChipTextActive : null]}>{target.targetName}</Text>
                <Text style={[styles.targetChipMeta, active ? styles.targetChipMetaActive : null]}>{String(target.measurementType || '').replaceAll('_', ' ')}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {loading ? <ActivityIndicator style={styles.loader} color="#2563eb" /> : null}

        {selectedTarget ? (
          <>
            <View style={styles.statsRow}>
              <InsightStatCard label="Frequency events" value={events.reduce((total, item) => total + (Number(item?.count) || 0), 0)} hint="Total recorded frequency count." />
              <InsightStatCard label="Trials" value={trials.length} hint="Skill-trial entries for this target." accent="#16a34a" />
              <InsightStatCard label="% Correct" value={percentCorrectSeries.length ? percentCorrectSeries[percentCorrectSeries.length - 1].value : 0} hint="Latest percent-correct sample." accent="#7c3aed" />
              <InsightStatCard label="Duration sec" value={durations.reduce((total, item) => total + (Number(item?.durationSeconds) || 0), 0)} hint="Total completed duration across loaded sessions." accent="#dc2626" />
            </View>

            <TrendMiniChart title="Frequency / Rate" items={frequencySeries} color="#dc2626" emptyText="No frequency trend captured yet." />
            <TrendMiniChart title="Duration" items={durationSeries} color="#2563eb" emptyText="No duration trend captured yet." />
            <TrendMiniChart title="Percent Correct" items={percentCorrectSeries} color="#16a34a" emptyText="No teaching-trial trend captured yet." />
            <TrendMiniChart title="Latency" items={latencySeries} color="#7c3aed" emptyText="No latency trend captured yet." />

            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>Target Management</Text>
              <Text style={styles.sectionHint}>Adjust the active target plan without leaving the clinical trend view.</Text>
              <Text style={styles.fieldLabel}>Target status</Text>
              <View style={styles.decisionRow}>
                {['draft', 'active', 'on_hold', 'mastered', 'discontinued'].map((option) => (
                  <DecisionChip key={option} label={option.replaceAll('_', ' ')} active={targetStatus === option} onPress={() => setTargetStatus(option)} />
                ))}
              </View>
              <TextInput value={masteryCriteria} onChangeText={setMasteryCriteria} placeholder="Mastery criteria" style={styles.input} />
              <TextInput value={parentFriendlyLabel} onChangeText={setParentFriendlyLabel} placeholder="Parent-friendly label" style={styles.input} />
              <TextInput value={parentSummaryTemplate} onChangeText={setParentSummaryTemplate} placeholder="Parent summary template" style={[styles.input, styles.multiline]} multiline />
              <Text style={styles.fieldLabel}>Visible to parent</Text>
              <View style={styles.decisionRow}>
                <DecisionChip label="Visible" active={visibleToParent} onPress={() => setVisibleToParent(true)} />
                <DecisionChip label="Internal only" active={!visibleToParent} onPress={() => setVisibleToParent(false)} />
              </View>
              <TouchableOpacity style={[styles.primaryButton, savingAction ? styles.primaryButtonDisabled : null]} onPress={() => saveTargetAdjustments().catch(() => {})} disabled={savingAction}>
                <Text style={styles.primaryButtonText}>Save Target Settings</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.phaseCard}>
              <Text style={styles.phaseTitle}>Phase Changes</Text>
              <Text style={styles.sectionHint}>Log phase shifts directly from the trend view so graph interpretation and program changes stay aligned.</Text>
              <View style={styles.decisionRow}>
                {['baseline', 'intervention', 'generalization', 'maintenance', 'probe', 'discontinued'].map((option) => (
                  <DecisionChip key={option} label={option.replaceAll('_', ' ')} active={phaseType === option} onPress={() => setPhaseType(option)} />
                ))}
              </View>
              <TextInput value={phaseNote} onChangeText={setPhaseNote} placeholder="Phase note or rationale" style={[styles.input, styles.multilineSmall]} multiline />
              <TouchableOpacity style={[styles.primaryButton, savingAction ? styles.primaryButtonDisabled : null]} onPress={() => savePhaseUpdate().catch(() => {})} disabled={savingAction}>
                <Text style={styles.primaryButtonText}>Record Phase Change</Text>
              </TouchableOpacity>
              <View style={styles.phaseRow}>
                {phaseChanges.length ? phaseChanges.map((phase) => (
                  <View key={phase.id} style={styles.phaseChip}>
                    <Text style={styles.phaseChipText}>{String(phase.phaseType || '').replaceAll('_', ' ')}</Text>
                    <Text style={styles.phaseChipMeta}>{String(phase.effectiveDate || '').slice(0, 10)}</Text>
                    {phase.note ? <Text style={styles.phaseChipNote}>{phase.note}</Text> : null}
                  </View>
                )) : <Text style={styles.phaseEmpty}>No phase changes recorded yet.</Text>}
              </View>
            </View>

            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>Clinical Review Decision</Text>
              <TextInput value={trendSummary} onChangeText={setTrendSummary} placeholder="Trend summary" style={styles.input} />
              <TextInput value={interpretation} onChangeText={setInterpretation} placeholder="Clinical interpretation" style={[styles.input, styles.multiline]} multiline />
              <TextInput value={actionItemsText} onChangeText={setActionItemsText} placeholder="Action items, one per line" style={[styles.input, styles.multilineSmall]} multiline />
              <TextInput value={nextReviewDate} onChangeText={setNextReviewDate} placeholder="Next review date (YYYY-MM-DD or ISO)" style={styles.input} />
              <View style={styles.decisionRow}>
                {[
                  'continue',
                  'modify_prompting',
                  'modify_reinforcement',
                  'change_target',
                  'move_to_maintenance',
                  'discontinue',
                ].map((option) => (
                  <DecisionChip key={option} label={option.replaceAll('_', ' ')} active={decision === option} onPress={() => setDecision(option)} />
                ))}
              </View>
              <TouchableOpacity style={[styles.primaryButton, savingAction ? styles.primaryButtonDisabled : null]} onPress={() => saveReviewDecision().catch(() => {})} disabled={savingAction}>
                <Text style={styles.primaryButtonText}>Save Review</Text>
              </TouchableOpacity>
              <View style={styles.reviewHistoryWrap}>
                <Text style={styles.reviewHistoryTitle}>Recent Reviews</Text>
                {reviewHistory.length ? reviewHistory.slice(0, 4).map((item) => (
                  <View key={item.id} style={styles.reviewHistoryCard}>
                    <Text style={styles.reviewHistoryDecision}>{String(item.decision || 'continue').replaceAll('_', ' ')}</Text>
                    <Text style={styles.reviewHistoryMeta}>{String(item.reviewDate || '').slice(0, 10) || 'Review saved'}</Text>
                    {item.trendSummary ? <Text style={styles.reviewHistoryBody}>{item.trendSummary}</Text> : null}
                  </View>
                )) : <Text style={styles.phaseEmpty}>No BCBA review history recorded yet.</Text>}
              </View>
            </View>
          </>
        ) : !loading ? <Text style={styles.emptyText}>No active behavior targets are available for this learner yet.</Text> : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  heroCard: { borderRadius: 20, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#dbeafe', padding: 18 },
  eyebrow: { color: '#1d4ed8', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' },
  title: { marginTop: 6, fontSize: 24, fontWeight: '800', color: '#0f172a' },
  subtitle: { marginTop: 8, color: '#475569', lineHeight: 20 },
  feedbackText: { marginTop: 12, lineHeight: 20, fontWeight: '700' },
  feedbackSuccess: { color: '#166534' },
  feedbackError: { color: '#b91c1c' },
  targetRow: { marginTop: 12, paddingBottom: 4 },
  targetChip: { marginRight: 8, borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#dbeafe', paddingHorizontal: 12, paddingVertical: 10, minWidth: 160 },
  targetChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  targetChipText: { color: '#0f172a', fontWeight: '800' },
  targetChipTextActive: { color: '#ffffff' },
  targetChipMeta: { marginTop: 4, color: '#64748b', fontSize: 11 },
  targetChipMetaActive: { color: 'rgba(255,255,255,0.84)' },
  loader: { marginTop: 22 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 },
  phaseCard: { marginTop: 12, borderRadius: 16, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 14 },
  phaseTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  sectionHint: { marginTop: 6, color: '#475569', lineHeight: 20 },
  fieldLabel: { marginTop: 12, color: '#0f172a', fontWeight: '700' },
  phaseRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  phaseChip: { borderRadius: 14, backgroundColor: '#eff6ff', paddingHorizontal: 12, paddingVertical: 10, marginRight: 8, marginBottom: 8 },
  phaseChipText: { color: '#1d4ed8', fontWeight: '800', textTransform: 'capitalize' },
  phaseChipMeta: { marginTop: 4, color: '#64748b', fontSize: 11 },
  phaseChipNote: { marginTop: 6, color: '#334155', lineHeight: 18, maxWidth: 220 },
  phaseEmpty: { color: '#64748b' },
  reviewCard: { marginTop: 12, borderRadius: 16, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 14 },
  reviewTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  input: { marginTop: 10, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff' },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  multilineSmall: { minHeight: 72, textAlignVertical: 'top' },
  decisionRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  decisionChip: { borderRadius: 999, backgroundColor: '#e2e8f0', paddingVertical: 8, paddingHorizontal: 10, marginRight: 8, marginBottom: 8 },
  decisionChipActive: { backgroundColor: '#2563eb' },
  decisionChipText: { color: '#0f172a', fontWeight: '700', fontSize: 12, textTransform: 'capitalize' },
  decisionChipTextActive: { color: '#ffffff' },
  primaryButton: { marginTop: 4, borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14, alignSelf: 'flex-start' },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  reviewHistoryWrap: { marginTop: 16 },
  reviewHistoryTitle: { color: '#0f172a', fontWeight: '800' },
  reviewHistoryCard: { marginTop: 10, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', padding: 12 },
  reviewHistoryDecision: { color: '#1d4ed8', fontWeight: '800', textTransform: 'capitalize' },
  reviewHistoryMeta: { marginTop: 4, color: '#64748b', fontSize: 12 },
  reviewHistoryBody: { marginTop: 8, color: '#334155', lineHeight: 18 },
  emptyText: { marginTop: 22, color: '#64748b', lineHeight: 20 },
});