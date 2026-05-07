import React, { useLayoutEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { ScreenWrapper } from '../../../components/ScreenWrapper';
import { useData } from '../../../DataContext';
import useChildProgressInsights from '../hooks/useChildProgressInsights';
import InsightStatCard from '../components/InsightStatCard';
import TrendMiniChart from '../components/TrendMiniChart';
import EmptyInsightsState from '../components/EmptyInsightsState';
import LatestSummaryCard from '../components/LatestSummaryCard';
import BehaviorTrendList from '../components/BehaviorTrendList';

export default function ChildProgressInsightsScreen({ navigation }) {
  const route = useRoute();
  const { children = [] } = useData();
  const childId = route?.params?.childId || '';
  const child = (children || []).find((item) => item?.id === childId) || null;
  const { loading, error, data } = useChildProgressInsights(childId, { limit: 20 });

  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      headerLeft: () => null,
    });
  }, [navigation]);

  return (
    <ScreenWrapper style={styles.container} bannerShowBack={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Progress Insights</Text>
          <Text style={styles.title}>{child?.name || 'Child progress'}</Text>
          <Text style={styles.subtitle}>Approved session summaries are translated into simple progress, behavior, and participation trends for families and care teams.</Text>
        </View>

        {loading ? <ActivityIndicator style={styles.loader} color="#2563eb" /> : null}
        {!loading && error ? (
          <EmptyInsightsState title="Could not load insights" message={error} />
        ) : null}
        {!loading && !error && (!data || !data.stats || !data.stats.sessions) ? (
          <EmptyInsightsState />
        ) : null}

        {!loading && !error && data?.stats?.sessions ? (
          <>
            <View style={styles.statsRow}>
              <InsightStatCard label="Sessions" value={data.stats.sessions} hint="Approved session records in range." />
              <InsightStatCard label="Approved summaries" value={data.stats.approvedSummaries} hint="Therapist-approved progress outputs." accent="#16a34a" />
              <InsightStatCard label="Average mood" value={data.stats.averageMood == null ? '—' : data.stats.averageMood} hint="Average mood score across approved sessions." accent="#f59e0b" />
              <InsightStatCard label="Behavior events" value={data.stats.behaviorEventsCount} hint="Count of summarized behavior events." accent="#dc2626" />
              <InsightStatCard label="Milestones met" value={data.stats.successCriteriaCount} hint="Tracked success criteria across approved sessions." />
              <InsightStatCard label="Programs worked" value={data.stats.programsWorkedOnCount} hint="Programs or goals touched in the selected range." accent="#7c3aed" />
            </View>

            <TrendMiniChart title="Mood over time" items={data?.trends?.mood || []} color="#0ea5e9" />
            <TrendMiniChart title="Behavior frequency" items={data?.trends?.behaviorFrequency || []} color="#dc2626" />
            <TrendMiniChart title="Independence trend" items={data?.trends?.independence || []} color="#16a34a" />
            <TrendMiniChart title="Progress trend" items={data?.trends?.progressLevel || []} color="#7c3aed" />

            <BehaviorTrendList items={data?.latestSummary?.interferingBehaviors || []} />
            <LatestSummaryCard
              summary={data?.latestSummary}
              subtitle={data?.latestSummary?.approvedAt ? `Approved ${new Date(data.latestSummary.approvedAt).toLocaleString()}` : ''}
            />
          </>
        ) : null}

      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  hero: { borderRadius: 22, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', padding: 18 },
  eyebrow: { color: '#1d4ed8', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' },
  title: { marginTop: 6, fontSize: 24, fontWeight: '800', color: '#0f172a' },
  subtitle: { marginTop: 8, color: '#475569', lineHeight: 20 },
  loader: { marginTop: 24 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 },
});