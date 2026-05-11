import React from 'react';
import { TouchableOpacity, StyleSheet, Text, View } from 'react-native';
import SessionSummarySnapshot from '../../../components/SessionSummarySnapshot';

export default function LatestSummaryCard({ summary, subtitle = '', onOpenInsights, onOpenArtifact, artifactDisabled = false, metricsTwoByTwo = false }) {
  return (
    <View style={styles.wrap}>
      <SessionSummarySnapshot summary={summary} subtitle={subtitle} title="Latest Session Summary" emptyText="No approved session summary has been recorded yet." metricsTwoByTwo={metricsTwoByTwo} />
      {(onOpenInsights || onOpenArtifact) ? (
        <View style={styles.actionsRow}>
          {onOpenInsights ? (
            <TouchableOpacity style={styles.primaryAction} onPress={onOpenInsights}>
              <Text style={styles.primaryActionText}>View full insights</Text>
            </TouchableOpacity>
          ) : null}
          {onOpenArtifact ? (
            <TouchableOpacity style={[styles.secondaryAction, artifactDisabled ? styles.secondaryActionDisabled : null]} onPress={onOpenArtifact} disabled={artifactDisabled}>
              <Text style={[styles.secondaryActionText, artifactDisabled ? styles.secondaryActionTextDisabled : null]}>Open SessionSummary.txt</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  primaryAction: { borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  primaryActionText: { color: '#ffffff', fontWeight: '800' },
  secondaryAction: { borderRadius: 12, backgroundColor: '#eff6ff', paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10 },
  secondaryActionDisabled: { backgroundColor: '#e5e7eb' },
  secondaryActionText: { color: '#1d4ed8', fontWeight: '800' },
  secondaryActionTextDisabled: { color: '#94a3b8' },
});