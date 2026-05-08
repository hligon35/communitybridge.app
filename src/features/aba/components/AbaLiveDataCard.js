import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

function StatChip({ label, value, accent = '#2563eb' }) {
  return (
    <View style={styles.statChip}>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function OutcomeButton({ label, active, onPress }) {
  return (
    <TouchableOpacity style={[styles.outcomeButton, active ? styles.outcomeButtonActive : null]} onPress={onPress}>
      <Text style={[styles.outcomeButtonText, active ? styles.outcomeButtonTextActive : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function AbaLiveDataCard({ controller, disabled = false }) {
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [showAbcModal, setShowAbcModal] = useState(false);
  const [abcAntecedent, setAbcAntecedent] = useState('');
  const [abcBehavior, setAbcBehavior] = useState('');
  const [abcConsequence, setAbcConsequence] = useState('');
  const [abcFunction, setAbcFunction] = useState('');
  const [abcSafetyRisk, setAbcSafetyRisk] = useState(false);
  const [skillOutcome, setSkillOutcome] = useState('correct');
  const [skillPromptLevel, setSkillPromptLevel] = useState('');
  const [skillNote, setSkillNote] = useState('');
  const [intervalType, setIntervalType] = useState('whole_interval');
  const [intervalMinutes, setIntervalMinutes] = useState('5');
  const [intervalNote, setIntervalNote] = useState('');
  const [latencyCueDescription, setLatencyCueDescription] = useState('');
  const [latencyResponseDescription, setLatencyResponseDescription] = useState('');
  const targetOptions = useMemo(() => Array.isArray(controller?.activeTargets) ? controller.activeTargets : [], [controller?.activeTargets]);
  const selectedTarget = targetOptions.find((item) => item.id === selectedTargetId) || targetOptions[0] || null;

  useEffect(() => {
    if (!selectedTargetId && targetOptions[0]?.id) {
      setSelectedTargetId(targetOptions[0].id);
      return;
    }
    if (selectedTargetId && !targetOptions.some((item) => item.id === selectedTargetId)) {
      setSelectedTargetId(targetOptions[0]?.id || '');
    }
  }, [selectedTargetId, targetOptions]);

  async function submitAbc() {
    await controller.addAbcObservation({
      targetId: selectedTarget?.id || '',
      antecedentNarrative: abcAntecedent,
      behaviorTopography: abcBehavior,
      consequenceNarrative: abcConsequence,
      perceivedFunction: abcFunction,
      safetyRisk: abcSafetyRisk,
    });
    setAbcAntecedent('');
    setAbcBehavior('');
    setAbcConsequence('');
    setAbcFunction('');
    setAbcSafetyRisk(false);
    setShowAbcModal(false);
  }

  async function submitSkillTrial() {
    if (!selectedTarget?.id) return;
    await controller.addSkillTrial({
      targetId: selectedTarget.id,
      outcome: skillOutcome,
      promptLevel: skillPromptLevel,
      note: skillNote,
    });
    setSkillPromptLevel('');
    setSkillNote('');
  }

  async function submitIntervalSample(observed) {
    if (!selectedTarget?.id) return;
    await controller.recordIntervalSample({
      targetId: selectedTarget.id,
      intervalType,
      intervalMinutes: Number(intervalMinutes) || 5,
      observed,
      note: intervalNote,
    });
    setIntervalNote('');
  }

  async function handleLatencyAction() {
    if (!selectedTarget?.id) return;
    if (controller?.runningLatencyRecord?.id) {
      await controller.stopLatencyRecording({ responseDescription: latencyResponseDescription });
      setLatencyResponseDescription('');
      return;
    }
    await controller.startLatencyRecording({
      targetId: selectedTarget.id,
      cueDescription: latencyCueDescription,
    });
    setLatencyCueDescription('');
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>ABA Live Data Pad</Text>
      <Text style={styles.subtitle}>Structured live capture for frequency, duration, ABC observations, and teaching trials. Parent-safe notes stay separate from internal clinical detail.</Text>
      {controller?.pendingOfflineWriteCount ? (
        <View style={styles.infoBanner}>
          <Text style={styles.infoBannerText}>{controller.pendingOfflineWriteCount} ABA update{controller.pendingOfflineWriteCount === 1 ? '' : 's'} saved locally and waiting to sync.</Text>
          <TouchableOpacity style={styles.infoBannerButton} onPress={() => controller.syncPendingOfflineWrites?.().catch?.(() => {})} disabled={controller?.syncingPendingOfflineWrites}>
            <Text style={styles.infoBannerButtonText}>{controller?.syncingPendingOfflineWrites ? 'Syncing...' : 'Try Sync Now'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {controller?.saveError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{controller.saveError}</Text>
          <TouchableOpacity style={styles.errorBannerButton} onPress={() => controller.retryLastSave?.().catch?.(() => {})}>
            <Text style={styles.errorBannerButtonText}>Retry Last Save</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.statsRow}>
        <StatChip label="Events" value={controller?.quickStats?.behaviorEventCount || 0} accent="#dc2626" />
        <StatChip label="Trials" value={controller?.quickStats?.skillTrialCount || 0} accent="#2563eb" />
        <StatChip label="% Correct" value={controller?.quickStats?.percentCorrect || 0} accent="#16a34a" />
        <StatChip label="ABC" value={controller?.quickStats?.abcObservationCount || 0} accent="#7c3aed" />
        <StatChip label="Intervals" value={controller?.quickStats?.intervalSampleCount || 0} accent="#0f766e" />
        <StatChip label="Latency" value={controller?.quickStats?.latencyRecordCount || 0} accent="#b45309" />
      </View>

      <Text style={styles.fieldLabel}>Target</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {targetOptions.length ? targetOptions.map((target) => {
          const active = target.id === selectedTarget?.id;
          return (
            <TouchableOpacity key={target.id} style={[styles.targetChip, active ? styles.targetChipActive : null]} onPress={() => setSelectedTargetId(target.id)}>
              <Text style={[styles.targetChipText, active ? styles.targetChipTextActive : null]}>{target.parentFriendlyLabel || target.targetName || 'Target'}</Text>
              <Text style={[styles.targetChipMeta, active ? styles.targetChipMetaActive : null]}>{String(target.measurementType || 'frequency').replaceAll('_', ' ')}</Text>
            </TouchableOpacity>
          );
        }) : <Text style={styles.emptyText}>No active BCBA targets are assigned to this learner yet.</Text>}
      </ScrollView>

      <View style={styles.captureRow}>
        <TouchableOpacity
          style={[styles.primaryButton, (!selectedTarget?.id || disabled) ? styles.buttonDisabled : null]}
          disabled={!selectedTarget?.id || disabled}
          onPress={() => controller.recordFrequencyEvent({ targetId: selectedTarget.id })}
        >
          <Text style={styles.primaryButtonText}>+ Frequency Event</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryButton, (!selectedTarget?.id || disabled) ? styles.buttonDisabled : null]}
          disabled={!selectedTarget?.id || disabled}
          onPress={() => controller.toggleDurationTimer({ targetId: selectedTarget.id })}
        >
          <Text style={styles.secondaryButtonText}>{controller?.runningDurationTimer ? 'Stop Duration' : 'Start Duration'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>ABC Quick Entry</Text>
        <Text style={styles.sectionBody}>Capture antecedent, behavior topography, and consequence without leaving the live session screen.</Text>
        <TouchableOpacity style={[styles.secondaryButton, disabled ? styles.buttonDisabled : null]} disabled={disabled} onPress={() => setShowAbcModal(true)}>
          <Text style={styles.secondaryButtonText}>Add ABC Observation</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Skill Trial Runner</Text>
        <Text style={styles.sectionBody}>Record trial outcomes quickly for percent-correct and task-analysis style instruction.</Text>
        <View style={styles.outcomeRow}>
          {[
            { key: 'correct', label: 'Correct' },
            { key: 'incorrect', label: 'Incorrect' },
            { key: 'prompted_correct', label: 'Prompted' },
            { key: 'no_response', label: 'No Response' },
          ].map((option) => (
            <OutcomeButton key={option.key} label={option.label} active={skillOutcome === option.key} onPress={() => setSkillOutcome(option.key)} />
          ))}
        </View>
        <TextInput value={skillPromptLevel} onChangeText={setSkillPromptLevel} placeholder="Prompt level used" style={styles.input} />
        <TextInput value={skillNote} onChangeText={setSkillNote} placeholder="Optional trial note" style={styles.input} />
        <TouchableOpacity
          style={[styles.primaryButton, (!selectedTarget?.id || disabled) ? styles.buttonDisabled : null]}
          disabled={!selectedTarget?.id || disabled}
          onPress={submitSkillTrial}
        >
          <Text style={styles.primaryButtonText}>Record Trial</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Interval Quick Entry</Text>
        <Text style={styles.sectionBody}>Capture whole, partial, or momentary interval samples without leaving the live session screen.</Text>
        <View style={styles.outcomeRow}>
          {[
            { key: 'whole_interval', label: 'Whole' },
            { key: 'partial_interval', label: 'Partial' },
            { key: 'momentary_time_sampling', label: 'MTS' },
          ].map((option) => (
            <OutcomeButton key={option.key} label={option.label} active={intervalType === option.key} onPress={() => setIntervalType(option.key)} />
          ))}
        </View>
        <TextInput value={intervalMinutes} onChangeText={setIntervalMinutes} placeholder="Interval minutes" keyboardType="number-pad" style={styles.input} />
        <TextInput value={intervalNote} onChangeText={setIntervalNote} placeholder="Optional interval note" style={styles.input} />
        <View style={styles.captureRow}>
          <TouchableOpacity
            style={[styles.primaryButton, (!selectedTarget?.id || disabled) ? styles.buttonDisabled : null]}
            disabled={!selectedTarget?.id || disabled}
            onPress={() => submitIntervalSample(true)}
          >
            <Text style={styles.primaryButtonText}>Observed</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, (!selectedTarget?.id || disabled) ? styles.buttonDisabled : null]}
            disabled={!selectedTarget?.id || disabled}
            onPress={() => submitIntervalSample(false)}
          >
            <Text style={styles.secondaryButtonText}>Not Observed</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Latency Probe</Text>
        <Text style={styles.sectionBody}>Start a latency timer at the cue, then stop it when the learner responds.</Text>
        <TextInput
          value={controller?.runningLatencyRecord?.id ? latencyResponseDescription : latencyCueDescription}
          onChangeText={controller?.runningLatencyRecord?.id ? setLatencyResponseDescription : setLatencyCueDescription}
          placeholder={controller?.runningLatencyRecord?.id ? 'Response description' : 'Cue description'}
          style={styles.input}
        />
        <TouchableOpacity
          style={[styles.primaryButton, (!selectedTarget?.id || disabled) ? styles.buttonDisabled : null]}
          disabled={!selectedTarget?.id || disabled}
          onPress={handleLatencyAction}
        >
          <Text style={styles.primaryButtonText}>{controller?.runningLatencyRecord?.id ? 'Stop Latency' : 'Start Latency'}</Text>
        </TouchableOpacity>
      </View>

      <Modal transparent visible={showAbcModal} animationType="fade" onRequestClose={() => setShowAbcModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>ABC Observation</Text>
            <TextInput value={abcAntecedent} onChangeText={setAbcAntecedent} placeholder="Antecedent" style={styles.input} multiline />
            <TextInput value={abcBehavior} onChangeText={setAbcBehavior} placeholder="Behavior topography" style={styles.input} multiline />
            <TextInput value={abcConsequence} onChangeText={setAbcConsequence} placeholder="Consequence / staff response" style={styles.input} multiline />
            <TextInput value={abcFunction} onChangeText={setAbcFunction} placeholder="Perceived function" style={styles.input} />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Safety risk</Text>
              <Switch value={abcSafetyRisk} onValueChange={setAbcSafetyRisk} />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowAbcModal(false)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, (!abcAntecedent.trim() || !abcBehavior.trim() || !abcConsequence.trim()) ? styles.buttonDisabled : null]}
                disabled={!abcAntecedent.trim() || !abcBehavior.trim() || !abcConsequence.trim()}
                onPress={submitAbc}
              >
                <Text style={styles.primaryButtonText}>Save ABC</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#f8fbff' },
  title: { fontWeight: '800', color: '#0f172a', fontSize: 16 },
  subtitle: { marginTop: 6, color: '#475569', lineHeight: 20 },
  infoBanner: { marginTop: 12, borderRadius: 14, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', padding: 12 },
  infoBannerText: { color: '#1d4ed8', lineHeight: 18 },
  infoBannerButton: { marginTop: 10, alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#dbeafe', paddingHorizontal: 12, paddingVertical: 9 },
  infoBannerButtonText: { color: '#1d4ed8', fontWeight: '800' },
  errorBanner: { marginTop: 12, borderRadius: 14, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', padding: 12 },
  errorBannerText: { color: '#991b1b', lineHeight: 18 },
  errorBannerButton: { marginTop: 10, alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#fee2e2', paddingHorizontal: 12, paddingVertical: 9 },
  errorBannerButtonText: { color: '#991b1b', fontWeight: '800' },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 },
  statChip: { width: '48%', borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 12, marginBottom: 10 },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { marginTop: 4, color: '#475569', fontWeight: '700' },
  fieldLabel: { marginTop: 4, marginBottom: 8, color: '#0f172a', fontWeight: '800' },
  chipRow: { paddingBottom: 2 },
  targetChip: { marginRight: 8, borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#dbeafe', paddingHorizontal: 12, paddingVertical: 10, minWidth: 140 },
  targetChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  targetChipText: { fontWeight: '800', color: '#0f172a' },
  targetChipTextActive: { color: '#ffffff' },
  targetChipMeta: { marginTop: 4, fontSize: 11, color: '#64748b' },
  targetChipMetaActive: { color: 'rgba(255,255,255,0.82)' },
  emptyText: { color: '#64748b', lineHeight: 20 },
  captureRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  primaryButton: { borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  secondaryButton: { borderRadius: 12, backgroundColor: '#e2e8f0', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  secondaryButtonText: { color: '#0f172a', fontWeight: '800' },
  buttonDisabled: { opacity: 0.5 },
  sectionCard: { marginTop: 4, borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 14 },
  sectionTitle: { fontWeight: '800', color: '#0f172a', marginBottom: 6 },
  sectionBody: { color: '#475569', lineHeight: 20, marginBottom: 12 },
  outcomeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  outcomeButton: { borderRadius: 999, backgroundColor: '#eff6ff', paddingVertical: 8, paddingHorizontal: 10, marginRight: 8, marginBottom: 8 },
  outcomeButtonActive: { backgroundColor: '#2563eb' },
  outcomeButtonText: { color: '#1d4ed8', fontWeight: '800', fontSize: 12 },
  outcomeButtonTextActive: { color: '#ffffff' },
  input: { marginTop: 8, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.42)', justifyContent: 'center', padding: 20 },
  modalCard: { borderRadius: 18, backgroundColor: '#ffffff', padding: 18 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  switchLabel: { color: '#0f172a', fontWeight: '700' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
});