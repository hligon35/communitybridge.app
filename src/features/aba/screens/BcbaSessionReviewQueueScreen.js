import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScreenWrapper } from '../../../components/ScreenWrapper';
import { useAuth } from '../../../AuthContext';
import { useData } from '../../../DataContext';
import * as Api from '../../../Api';

function Stat({ label, value }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function BcbaSessionReviewQueueScreen({ navigation }) {
  const { user } = useAuth();
  const { children = [] } = useData();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState([]);
  const [parentSummariesBySheetId, setParentSummariesBySheetId] = useState({});

  const childNameById = useMemo(() => (Array.isArray(children) ? children : []).reduce((accumulator, child) => {
    const key = String(child?.id || '').trim();
    if (key) accumulator[key] = String(child?.name || 'Learner').trim() || 'Learner';
    return accumulator;
  }, {}), [children]);

  async function loadQueue(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await Api.listSessionDataSheetsForBcba(String(user?.id || '').trim(), 100);
      const sheets = (Array.isArray(result?.items) ? result.items : []).filter((item) => ['completed', 'reviewed'].includes(String(item?.sessionState || '').trim().toLowerCase()));
      setItems(sheets);
      const uniqueChildIds = Array.from(new Set(sheets.map((item) => String(item?.childId || '').trim()).filter(Boolean)));
      const summaryResults = await Promise.all(uniqueChildIds.map(async (childId) => ({
        childId,
        result: await Api.listParentSummariesByChild(childId, 50).catch(() => ({ items: [] })),
      })));
      const nextSummaryMap = {};
      summaryResults.forEach(({ result }) => {
        (Array.isArray(result?.items) ? result.items : []).forEach((summary) => {
          const key = String(summary?.sessionDataSheetId || '').trim();
          if (key) nextSummaryMap[key] = summary;
        });
      });
      setParentSummariesBySheetId(nextSummaryMap);
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue().catch(() => {});
  }, [user?.id]);

  async function markReviewed(sheet) {
    if (!sheet?.id) return;
    const reviewedAt = new Date().toISOString();
    const updatedSheet = await Api.saveSessionDataSheet({
      ...sheet,
      sessionState: 'reviewed',
      reviewedBy: String(user?.id || '').trim(),
      reviewedAt,
    }, sheet);
    const summary = parentSummariesBySheetId[String(sheet.id || '').trim()] || null;
    if (summary?.id) {
      const approved = await Api.saveParentSummary({
        ...summary,
        reviewedBy: String(user?.id || '').trim(),
        status: 'approved',
      }, summary);
      setParentSummariesBySheetId((current) => ({
        ...current,
        [String(sheet.id || '').trim()]: approved?.item || summary,
      }));
    }
    setItems((current) => current.map((entry) => (entry.id === sheet.id ? (updatedSheet?.item || entry) : entry)));
  }

  return (
    <ScreenWrapper style={styles.screen} bannerTitle="BCBA Review Queue">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadQueue(true).catch(() => {})} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>BCBA Caseload Dashboard</Text>
          <Text style={styles.title}>Session Review Queue</Text>
          <Text style={styles.subtitle}>Review structured ABA session sheets, approve parent-safe summaries, and open a learner clinical profile for trends or decisions.</Text>
        </View>

        <View style={styles.statsRow}>
          <Stat label="Pending review" value={items.filter((item) => String(item?.sessionState || '').trim().toLowerCase() === 'completed').length} />
          <Stat label="Reviewed" value={items.filter((item) => String(item?.sessionState || '').trim().toLowerCase() === 'reviewed').length} />
        </View>

        {loading ? <ActivityIndicator style={styles.loader} color="#2563eb" /> : null}

        {!loading && !items.length ? <Text style={styles.emptyText}>No BCBA session sheets are waiting right now.</Text> : null}

        {items.map((sheet) => {
          const summary = parentSummariesBySheetId[String(sheet.id || '').trim()] || null;
          const quickStats = sheet?.quickStats || {};
          const isReviewed = String(sheet?.sessionState || '').trim().toLowerCase() === 'reviewed';
          return (
            <View key={sheet.id} style={styles.sheetCard}>
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle}>{childNameById[String(sheet?.childId || '').trim()] || 'Learner'}</Text>
                  <Text style={styles.sheetMeta}>{sheet?.date || 'Date unavailable'} • {sheet?.sessionBlock || 'Session'} • {isReviewed ? 'Reviewed' : 'Awaiting review'}</Text>
                </View>
                <View style={[styles.statusChip, isReviewed ? styles.statusReviewed : styles.statusPending]}>
                  <Text style={[styles.statusChipText, isReviewed ? styles.statusReviewedText : styles.statusPendingText]}>{isReviewed ? 'Reviewed' : 'Pending'}</Text>
                </View>
              </View>

              <View style={styles.statsRow}>
                <Stat label="Events" value={quickStats.behaviorEventCount || 0} />
                <Stat label="Trials" value={quickStats.skillTrialCount || 0} />
              </View>
              <View style={styles.statsRow}>
                <Stat label="% Correct" value={quickStats.percentCorrect || 0} />
                <Stat label="ABC" value={quickStats.abcObservationCount || 0} />
              </View>

              {sheet?.therapistSessionNotes ? <Text style={styles.notesText}>Therapist notes: {sheet.therapistSessionNotes}</Text> : null}
              {summary?.highLevelProgress ? <Text style={styles.notesText}>Parent-safe draft: {summary.highLevelProgress}</Text> : null}

              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('LearnerClinicalProfile', { childId: sheet.childId })}>
                  <Text style={styles.secondaryButtonText}>Open Clinical Profile</Text>
                </TouchableOpacity>
                {!isReviewed ? (
                  <TouchableOpacity style={styles.primaryButton} onPress={() => markReviewed(sheet).catch(() => {})}>
                    <Text style={styles.primaryButtonText}>Mark Reviewed</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  heroCard: { borderRadius: 20, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', padding: 18 },
  eyebrow: { color: '#1d4ed8', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' },
  title: { marginTop: 6, fontSize: 24, fontWeight: '800', color: '#0f172a' },
  subtitle: { marginTop: 8, color: '#475569', lineHeight: 20 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 12 },
  statCard: { width: '48%', borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 12, marginBottom: 10 },
  statValue: { fontSize: 24, fontWeight: '800', color: '#2563eb' },
  statLabel: { marginTop: 6, color: '#475569', fontWeight: '700' },
  loader: { marginTop: 24 },
  emptyText: { marginTop: 20, color: '#64748b', lineHeight: 20 },
  sheetCard: { marginTop: 12, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  sheetMeta: { marginTop: 4, color: '#64748b' },
  statusChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  statusPending: { backgroundColor: '#fef3c7' },
  statusReviewed: { backgroundColor: '#dcfce7' },
  statusChipText: { fontWeight: '800', fontSize: 12 },
  statusPendingText: { color: '#92400e' },
  statusReviewedText: { color: '#166534' },
  notesText: { marginTop: 10, color: '#334155', lineHeight: 20 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  primaryButton: { borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  secondaryButton: { borderRadius: 12, backgroundColor: '#e2e8f0', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  secondaryButtonText: { color: '#0f172a', fontWeight: '800' },
});