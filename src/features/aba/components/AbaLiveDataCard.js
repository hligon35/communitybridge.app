import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

function StatChip({ label, value, accent = '#2563eb' }) {
  return (
    <View style={styles.statChip}>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function AbaLiveDataCard({ controller, disabled = false }) {
  const [selectedTargetId, setSelectedTargetId] = useState('');
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
});