import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import AppDropdown from '../components/AppDropdown';
import SessionSummarySnapshot from '../components/SessionSummarySnapshot';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useData } from '../DataContext';
import { getChildSessionSummaries } from '../Api';

function formatSessionStamp(item) {
  const source = item?.approvedAt || item?.updatedAt || item?.generatedAt || '';
  if (!source) return 'Approved summary';
  try {
    return new Date(source).toLocaleString();
  } catch (_) {
    return 'Approved summary';
  }
}

export default function RecentApprovedSessionsScreen() {
  const route = useRoute();
  const { children = [], seededSessionSummariesByChild = {} } = useData();
  const childId = String(route?.params?.childId || '').trim();
  const initialSessionId = String(route?.params?.initialSessionId || '').trim();
  const child = (Array.isArray(children) ? children : []).find((entry) => String(entry?.id || '').trim() === childId) || null;
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(initialSessionId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;

    async function loadSessions() {
      if (!childId) {
        if (!disposed) {
          setSessions([]);
          setError('');
          setLoading(false);
        }
        return;
      }
      const seededItems = Array.isArray(seededSessionSummariesByChild?.[childId]) ? seededSessionSummariesByChild[childId] : null;
      if (seededItems) {
        const approvedItems = seededItems
          .filter((item) => String(item?.status || '').trim().toLowerCase() === 'approved')
          .sort((left, right) => {
            const leftStamp = Date.parse(String(left?.approvedAt || left?.updatedAt || left?.generatedAt || ''));
            const rightStamp = Date.parse(String(right?.approvedAt || right?.updatedAt || right?.generatedAt || ''));
            return (Number.isFinite(rightStamp) ? rightStamp : 0) - (Number.isFinite(leftStamp) ? leftStamp : 0);
          });
        if (!disposed) {
          setSessions(approvedItems);
          setError('');
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError('');
      try {
        const result = await getChildSessionSummaries(childId, 24).catch(() => ({ items: [] }));
        if (disposed) return;
        const approvedItems = (Array.isArray(result?.items) ? result.items : [])
          .filter((item) => String(item?.status || '').trim().toLowerCase() === 'approved')
          .sort((left, right) => {
            const leftStamp = Date.parse(String(left?.approvedAt || left?.updatedAt || left?.generatedAt || ''));
            const rightStamp = Date.parse(String(right?.approvedAt || right?.updatedAt || right?.generatedAt || ''));
            return (Number.isFinite(rightStamp) ? rightStamp : 0) - (Number.isFinite(leftStamp) ? leftStamp : 0);
          });
        setSessions(approvedItems);
      } catch (loadError) {
        if (!disposed) {
          setSessions([]);
          setError(String(loadError?.message || loadError || 'Could not load approved sessions.'));
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    loadSessions();
    return () => {
      disposed = true;
    };
  }, [childId, seededSessionSummariesByChild]);

  useEffect(() => {
    if (!sessions.length) {
      setSelectedSessionId('');
      return;
    }
    const match = sessions.some((item) => String(item?.sessionId || item?.id || '').trim() === selectedSessionId);
    if (!match) {
      const preferred = sessions.find((item) => String(item?.sessionId || item?.id || '').trim() === initialSessionId);
      setSelectedSessionId(String(preferred?.sessionId || preferred?.id || sessions[0]?.sessionId || sessions[0]?.id || '').trim());
    }
  }, [initialSessionId, selectedSessionId, sessions]);

  const selectedSession = useMemo(() => {
    return sessions.find((item) => String(item?.sessionId || item?.id || '').trim() === selectedSessionId) || sessions[0] || null;
  }, [selectedSessionId, sessions]);

  const sessionOptions = useMemo(() => {
    return sessions.map((item, index) => ({
      value: String(item?.sessionId || item?.id || `session-${index}`).trim(),
      label: formatSessionStamp(item),
    }));
  }, [sessions]);

  const selectedLabel = sessionOptions.find((option) => option.value === selectedSessionId)?.label || 'Select a session';

  return (
    <ScreenWrapper style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Recent Approved Sessions</Text>
        <Text style={styles.subtitle}>{child?.name ? `${child.name} session summaries` : 'Approved session summaries'} are read only.</Text>

        {loading ? <ActivityIndicator style={styles.loader} size="small" color="#2563eb" /> : null}
        {!loading && error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading && !error ? (
          <>
            <View style={styles.dropdownWrap}>
              <AppDropdown
                accessibilityLabel="Choose approved session"
                containerStyle={styles.dropdownContainer}
                buttonStyle={styles.dropdownButton}
                textStyle={styles.dropdownButtonText}
                minMenuWidth={260}
                options={sessionOptions}
                onSelect={setSelectedSessionId}
                placeholder="Select a session"
                selectedValue={selectedSessionId}
                value={selectedLabel}
                width={260}
              />
            </View>

            {selectedSession ? (
              <SessionSummarySnapshot
                summary={selectedSession}
                title="Approved Session Summary"
                subtitle={formatSessionStamp(selectedSession)}
                emptyText="No approved session summary has been recorded yet."
                metricsTwoByTwo
              />
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No approved sessions are available yet.</Text>
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 24 },
  title: { fontSize: 24, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  subtitle: { marginTop: 8, color: '#64748b', lineHeight: 20, textAlign: 'center' },
  loader: { marginTop: 24 },
  error: { marginTop: 24, color: '#b91c1c', textAlign: 'center' },
  dropdownWrap: { marginTop: 18, alignItems: 'center' },
  dropdownContainer: { alignItems: 'center' },
  dropdownButton: { backgroundColor: '#ffffff' },
  dropdownButtonText: { textAlign: 'center', fontWeight: '700' },
  emptyCard: { marginTop: 18, borderRadius: 16, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  emptyText: { color: '#64748b', textAlign: 'center' },
});