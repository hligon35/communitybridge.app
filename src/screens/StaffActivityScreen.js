import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useData } from '../DataContext';

function formatActivityTimestamp(value) {
  const parsed = value ? new Date(value) : null;
  if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) return 'Recently updated';
  return parsed.toLocaleString();
}

function getStaffActivityMeta(item) {
  const type = String(item?.type || '').trim().toLowerCase();
  const actor = String(item?.staffName || item?.proposerName || item?.title || 'Staff').trim();
  if (type === 'clock_event') {
    const status = String(item?.clockStatus || '').trim().toLowerCase() === 'out' ? 'Clocked out' : 'Clocked in';
    return {
      title: `${actor} · ${status}`,
      body: item?.body || `${actor} ${status.toLowerCase()}.`,
      stamp: formatActivityTimestamp(item?.eventAt || item?.createdAt),
    };
  }
  return {
    title: item?.title || actor,
    body: item?.body || 'Operational activity recorded.',
    stamp: formatActivityTimestamp(item?.createdAt),
  };
}

export default function StaffActivityScreen() {
  const { urgentMemos = [] } = useData();

  const staffActivity = useMemo(() => {
    return (Array.isArray(urgentMemos) ? urgentMemos : [])
      .filter((item) => ['clock_event', 'quick_note', 'incident_log', 'unexpected_data'].includes(String(item?.type || '').trim().toLowerCase()))
      .sort((left, right) => new Date(right?.eventAt || right?.createdAt || 0).getTime() - new Date(left?.eventAt || left?.createdAt || 0).getTime());
  }, [urgentMemos]);

  return (
    <ScreenWrapper style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Staff activity</Text>
          <Text style={styles.rowText}>Clock-ins, clock-outs, and quick operational logs land here for office review without changing the underlying staff workflow.</Text>
          {staffActivity.length ? staffActivity.map((item) => {
            const meta = getStaffActivityMeta(item);
            return (
              <View key={item.id} style={styles.threadRow}>
                <Text style={styles.threadTitle}>{meta.title}</Text>
                <Text style={styles.rowText}>{meta.body}</Text>
                <Text style={styles.activityStamp}>{meta.stamp}</Text>
              </View>
            );
          }) : <Text style={styles.rowText}>No staff activity has been recorded yet.</Text>}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  card: { borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  rowText: { color: '#475569', lineHeight: 20, marginBottom: 8 },
  threadRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  threadTitle: { fontWeight: '800', color: '#0f172a' },
  activityStamp: { color: '#94a3b8', fontSize: 12 },
});