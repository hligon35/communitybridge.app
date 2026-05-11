import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

function safeText(value, fallback = 'Not recorded yet.') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function joinValues(values, fallback = 'Not recorded yet.') {
  if (!Array.isArray(values) || !values.length) return fallback;
  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(', ') || fallback;
}

function describeBehaviors(values) {
  if (!Array.isArray(values) || !values.length) return 'No interfering behaviors recorded.';
  return values
    .map((entry) => {
      const behavior = safeText(entry?.behavior, 'Behavior');
      const frequency = Number(entry?.frequency) || 0;
      const intensity = safeText(entry?.intensity, 'Moderate');
      return `${behavior} (${frequency}x, ${intensity})`;
    })
    .join(', ');
}

function describeSimpleEntries(values, key, fallback) {
  if (!Array.isArray(values) || !values.length) return fallback;
  return values
    .map((entry) => safeText(entry?.[key], ''))
    .filter(Boolean)
    .join(', ') || fallback;
}

export default function SessionSummarySnapshot({
  summary,
  title = 'Session Summary',
  subtitle = '',
  emptyText = 'No approved session summary has been recorded yet.',
  metricsTwoByTwo = false,
}) {
  const payload = summary?.summary && typeof summary.summary === 'object' ? summary.summary : (summary && typeof summary === 'object' ? summary : null);

  if (!payload) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <Text style={styles.empty}>{emptyText}</Text>
      </View>
    );
  }

  const sections = [
    {
      key: 'daily-recap',
      label: 'Daily Recap',
      value: safeText(payload?.dailyRecap?.therapistNarrative, 'No recap note recorded.'),
    },
    {
      key: 'monthly-goal',
      label: 'Monthly Focus',
      value: safeText(payload?.monthlyGoal?.description, 'No monthly goal recorded.'),
    },
    {
      key: 'success',
      label: 'Milestones Met',
      value: joinValues(payload?.successCriteriaMet, 'No milestones marked yet.'),
    },
    {
      key: 'programs',
      label: 'Programs Covered',
      value: joinValues(payload?.programsWorkedOn, 'No programs recorded yet.'),
    },
    {
      key: 'behaviors',
      label: 'Behavior Tracking',
      value: describeBehaviors(payload?.interferingBehaviors),
    },
    {
      key: 'meals',
      label: 'Meals',
      value: describeSimpleEntries(payload?.meals, 'type', 'No meals logged.'),
    },
    {
      key: 'toileting',
      label: 'Toileting',
      value: describeSimpleEntries(payload?.toileting, 'status', 'No toileting data logged.'),
    },
  ];

  const moodLabel = safeText(payload?.moodScore?.selectedLabel, 'Not scored');
  const moodValue = payload?.moodScore?.selectedValue != null ? String(payload.moodScore.selectedValue) : '—';
  const progressLabel = safeText(payload?.dailyRecap?.progressLevel, 'Not rated');
  const independenceLabel = safeText(payload?.dailyRecap?.independenceLevel, 'Not rated');
  const behaviorLevel = safeText(payload?.dailyRecap?.interferingBehaviorLevel, 'Not rated');

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      <View style={[styles.metricsGrid, metricsTwoByTwo ? styles.metricsGridTwoByTwo : null]}>
        <View style={[styles.metricChip, metricsTwoByTwo ? styles.metricChipTwoByTwo : null]}>
          <Text style={styles.metricLabel}>Mood</Text>
          <Text style={styles.metricValue}>{moodValue} · {moodLabel}</Text>
        </View>
        <View style={[styles.metricChip, metricsTwoByTwo ? styles.metricChipTwoByTwo : null]}>
          <Text style={styles.metricLabel}>Progress</Text>
          <Text style={styles.metricValue}>{progressLabel}</Text>
        </View>
        <View style={[styles.metricChip, metricsTwoByTwo ? styles.metricChipTwoByTwo : null]}>
          <Text style={styles.metricLabel}>Independence</Text>
          <Text style={styles.metricValue}>{independenceLabel}</Text>
        </View>
        <View style={[styles.metricChip, metricsTwoByTwo ? styles.metricChipTwoByTwo : null]}>
          <Text style={styles.metricLabel}>Behavior Level</Text>
          <Text style={styles.metricValue}>{behaviorLevel}</Text>
        </View>
      </View>

      {sections.map((section) => (
        <View key={section.key} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.label}</Text>
          <Text style={styles.sectionText}>{section.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  subtitle: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 12,
  },
  empty: {
    marginTop: 12,
    color: '#475569',
    lineHeight: 20,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    marginTop: 12,
    justifyContent: 'space-between',
  },
  metricsGridTwoByTwo: {
    flexWrap: 'wrap',
  },
  metricChip: {
    width: '24%',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 10,
  },
  metricChipTwoByTwo: {
    width: '48%',
    marginBottom: 8,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  metricValue: {
    marginTop: 4,
    color: '#0f172a',
    fontWeight: '700',
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  sectionText: {
    color: '#475569',
    lineHeight: 20,
  },
});