import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { getChildSessionSummaries } from '../Api';
import SessionSummarySnapshot from '../components/SessionSummarySnapshot';
import { THERAPY_ROLE_LABELS } from '../utils/roleTerminology';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useData } from '../DataContext';
import { useAuth } from '../AuthContext';
import { avatarSourceFor } from '../utils/idVisibility';
import { USER_ROLES, isAdminRole, isStaffRole, normalizeUserRole } from '../core/tenant/models';
import TherapySessionPanel from '../features/sessionTracking/components/TherapySessionPanel';
import { useTherapySessionWorkspace } from '../features/sessionTracking/hooks/useTherapySessionWorkspace';
import { useAbaSessionSheet } from '../features/aba/hooks/useAbaSessionSheet';
import { isChildLinkedToTherapist } from '../features/sessionTracking/utils/dashboardSessionTarget';
const { PREVIEW_CHILD } = require('../features/sessionTracking/utils/previewWorkspace');

export default function SummaryReviewScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { childId, sessionPreview, draftSummary, reviewSession } = route.params || {};
  const { children = [], fetchAndSync, seededSessionSummariesByChild = {} } = useData();
  const role = normalizeUserRole(user?.role);
  const isTherapist = role === USER_ROLES.THERAPIST;
  const canManageSession = isAdminRole(user?.role) || isStaffRole(user?.role);
  const child = (children || []).find((entry) => entry.id === childId) || null;
  const preview = Boolean(sessionPreview) || !child;
  const displayChild = child || PREVIEW_CHILD;
  const workspace = useTherapySessionWorkspace({ child, preview, canManageSession, fetchAndSync, initialDraftSummary: draftSummary || null });
  const abaSession = useAbaSessionSheet({ child, activeSession: reviewSession || null, user, preview });
  const [previousSessions, setPreviousSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [expandedSessionId, setExpandedSessionId] = useState('');
  const [therapistCloseoutNotes, setTherapistCloseoutNotes] = useState('');
  const [parentSafeCloseoutNotes, setParentSafeCloseoutNotes] = useState('');

  useEffect(() => {
    setTherapistCloseoutNotes(String(abaSession?.sheet?.therapistSessionNotes || ''));
    setParentSafeCloseoutNotes(String(abaSession?.sheet?.parentSafeSessionNotes || ''));
  }, [abaSession?.sheet?.id, abaSession?.sheet?.parentSafeSessionNotes, abaSession?.sheet?.therapistSessionNotes]);

  const subtitle = useMemo(() => {
    if (preview) return 'Interactive preview';
    return [displayChild.age, displayChild.room].filter(Boolean).join(' • ');
  }, [displayChild.age, displayChild.room, preview]);

  const therapistChildren = useMemo(() => {
    const therapistId = String(user?.id || '').trim();
    if (!isTherapist || !therapistId) return [];
    return (Array.isArray(children) ? children : []).filter((entry) => isChildLinkedToTherapist(entry, therapistId));
  }, [children, isTherapist, user?.id]);

  const therapistChildNameById = useMemo(() => {
    return therapistChildren.reduce((accumulator, entry) => {
      const key = String(entry?.id || '').trim();
      if (key) accumulator[key] = String(entry?.name || 'Learner').trim() || 'Learner';
      return accumulator;
    }, {});
  }, [therapistChildren]);

  useEffect(() => {
    let disposed = false;

    async function loadPreviousSessions() {
      if (!isTherapist) {
        if (!disposed) {
          setPreviousSessions([]);
          setSessionsError('');
          setExpandedSessionId('');
        }
        return;
      }

      setSessionsLoading(true);
      setSessionsError('');
      try {
        const therapistId = String(user?.id || '').trim();
        const targetChildren = child?.id ? [child] : therapistChildren;
        if (!targetChildren.length) {
          if (!disposed) {
            setPreviousSessions([]);
            setExpandedSessionId('');
          }
          return;
        }

        const results = await Promise.all(
          targetChildren.map(async (entry) => {
            const seededItems = Array.isArray(seededSessionSummariesByChild?.[entry.id]) ? seededSessionSummariesByChild[entry.id] : null;
            const result = seededItems
              ? { items: seededItems }
              : await getChildSessionSummaries(entry.id, 40).catch(() => ({ items: [] }));
            return (Array.isArray(result?.items) ? result.items : []).map((item) => ({
              ...item,
              childName: therapistChildNameById[String(entry?.id || '').trim()] || String(entry?.name || 'Learner').trim() || 'Learner',
            }));
          })
        );

        const ownSessions = results
          .flat()
          .filter((item) => String(item?.therapistId || '').trim() === therapistId)
          .sort((left, right) => {
            const leftStamp = Date.parse(String(left?.approvedAt || left?.updatedAt || left?.generatedAt || ''));
            const rightStamp = Date.parse(String(right?.approvedAt || right?.updatedAt || right?.generatedAt || ''));
            return (Number.isFinite(rightStamp) ? rightStamp : 0) - (Number.isFinite(leftStamp) ? leftStamp : 0);
          });
        const currentSessionId = String(workspace.draftSummary?.sessionId || '').trim();
        const filtered = ownSessions.filter((item) => String(item?.sessionId || '').trim() !== currentSessionId);
        if (!disposed) {
          setPreviousSessions(filtered);
          setExpandedSessionId((current) => (filtered.some((item) => item.id === current) ? current : ''));
        }
      } catch (error) {
        if (!disposed) {
          setPreviousSessions([]);
          setSessionsError(error?.message || 'Could not load previous sessions.');
        }
      } finally {
        if (!disposed) setSessionsLoading(false);
      }
    }

    loadPreviousSessions();
    return () => {
      disposed = true;
    };
  }, [child, isTherapist, seededSessionSummariesByChild, therapistChildNameById, therapistChildren, user?.id, workspace.draftSummary?.sessionId]);

  const filteredSessions = useMemo(() => {
    const query = String(searchQuery || '').trim().toLowerCase();
    const now = Date.now();
    return previousSessions.filter((item) => {
      const sourceStamp = item?.approvedAt || item?.updatedAt || item?.generatedAt || '';
      const sourceTime = Date.parse(String(sourceStamp || ''));
      if (dateFilter === '7d' && Number.isFinite(sourceTime) && now - sourceTime > 7 * 24 * 60 * 60 * 1000) return false;
      if (dateFilter === '30d' && Number.isFinite(sourceTime) && now - sourceTime > 30 * 24 * 60 * 60 * 1000) return false;

      if (!query) return true;
      const summary = item?.summary || {};
      const haystack = [
        item?.childName,
        item?.summaryText,
        summary?.dailyRecap?.therapistNarrative,
        Array.isArray(summary?.programsWorkedOn) ? summary.programsWorkedOn.join(' ') : '',
        Array.isArray(summary?.successCriteriaMet) ? summary.successCriteriaMet.join(' ') : '',
        sourceStamp ? new Date(sourceStamp).toLocaleString() : '',
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [dateFilter, previousSessions, searchQuery]);

  const hasPreviousSessionsSection = isTherapist;

  function returnToWorkspaceRoot() {
    const parentNavigation = navigation.getParent?.();
    const parentState = parentNavigation?.getState?.();
    const parentRouteNames = Array.isArray(parentState?.routeNames)
      ? parentState.routeNames
      : Array.isArray(parentState?.routes)
        ? parentState.routes.map((entry) => entry?.name).filter(Boolean)
        : [];
    const currentRootRoute = parentState?.routes?.[parentState?.index ?? 0]?.name || '';

    if (currentRootRoute === 'Home' && parentRouteNames.includes('Home')) {
      parentNavigation.navigate('Home', { screen: 'CommunityMain' });
      return;
    }
    if (currentRootRoute === 'Controls' && parentRouteNames.includes('Controls')) {
      parentNavigation.navigate('Controls', { screen: 'ControlsMain' });
      return;
    }
    if (parentRouteNames.includes('Home')) {
      parentNavigation.navigate('Home', { screen: 'CommunityMain' });
      return;
    }
    if (parentRouteNames.includes('Controls')) {
      parentNavigation.navigate('Controls', { screen: 'ControlsMain' });
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }

  async function handleSummarySubmitted() {
    if (reviewSession?.id && abaSession?.sheet?.id) {
      try {
        await abaSession.completeCurrentSheet({
          therapistSessionNotes: therapistCloseoutNotes,
          parentSafeSessionNotes: parentSafeCloseoutNotes,
        });
      } catch (_) {
        // Keep the legacy summary submission path intact even if the ABA closeout update fails.
      }
    }
    returnToWorkspaceRoot();
  }

  function formatSessionStamp(item) {
    const source = item?.approvedAt || item?.updatedAt || item?.generatedAt || '';
    if (!source) return 'Session date unavailable';
    try {
      return new Date(source).toLocaleString();
    } catch (_) {
      return 'Session date unavailable';
    }
  }

  function buildSessionPreview(item) {
    const summary = item?.summary || {};
    const dailyRecap = String(summary?.dailyRecap?.therapistNarrative || '').trim();
    if (dailyRecap) return dailyRecap;
    const programs = Array.isArray(summary?.programsWorkedOn) ? summary.programsWorkedOn.filter(Boolean) : [];
    if (programs.length) return `Programs: ${programs.slice(0, 3).join(', ')}`;
    return `No ${THERAPY_ROLE_LABELS.therapist} notes recorded.`;
  }

  const historySubtitle = child?.id
    ? `Search and filter your previously recorded ${THERAPY_ROLE_LABELS.therapist.toLowerCase()} session reports for this learner.`
    : `Search and filter your previously recorded ${THERAPY_ROLE_LABELS.therapist.toLowerCase()} session reports across assigned learners.`;

  return (
    <ScreenWrapper style={styles.container} bannerTitle="Session Report">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <Image source={avatarSourceFor(displayChild)} style={styles.avatar} />
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>Session Report</Text>
              <Text style={styles.name}>{displayChild.name}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
          </View>
        </View>
        {reviewSession?.id || abaSession?.sheet?.id ? (
          <View style={styles.abaCloseoutCard}>
            <Text style={styles.abaCloseoutTitle}>ABA Closeout Notes</Text>
            <Text style={styles.abaCloseoutSubtitle}>Review and edit the internal clinical closeout plus the parent-safe note before the ABA sheet is finalized.</Text>
            <Text style={styles.abaCloseoutLabel}>Therapist / clinical note</Text>
            <TextInput
              value={therapistCloseoutNotes}
              onChangeText={setTherapistCloseoutNotes}
              placeholder="Internal clinical closeout note"
              multiline
              style={styles.abaCloseoutInput}
            />
            <Text style={styles.abaCloseoutLabel}>Parent-safe note</Text>
            <TextInput
              value={parentSafeCloseoutNotes}
              onChangeText={setParentSafeCloseoutNotes}
              placeholder="Parent-safe session note"
              multiline
              style={styles.abaCloseoutInput}
            />
          </View>
        ) : null}
        <TherapySessionPanel workspace={workspace} mode="summary" title="Session Report" onSubmitted={handleSummarySubmitted} />
        {hasPreviousSessionsSection ? (
          <View style={styles.historyCard}>
            <Text style={styles.historyTitle}>Previous Sessions</Text>
            <Text style={styles.historySubtitle}>{historySubtitle}</Text>
            <View style={styles.searchRow}>
              <MaterialIcons name="search" size={18} color="#64748b" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={child?.id ? 'Search notes, programs, or dates' : 'Search learners, notes, programs, or dates'}
                placeholderTextColor="#94a3b8"
                style={styles.searchInput}
              />
            </View>
            <View style={styles.filterRow}>
              {[
                { key: 'all', label: 'All' },
                { key: '7d', label: 'Last 7 Days' },
                { key: '30d', label: 'Last 30 Days' },
              ].map((option) => {
                const active = dateFilter === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.filterChip, active ? styles.filterChipActive : null]}
                    onPress={() => setDateFilter(option.key)}
                  >
                    <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : null]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {sessionsLoading ? <ActivityIndicator style={styles.historyLoading} size="small" color="#2563eb" /> : null}
            {sessionsError ? <Text style={styles.historyError}>{sessionsError}</Text> : null}

            {!sessionsLoading && !sessionsError && !previousSessions.length ? (
              <Text style={styles.historyEmpty}>{child?.id ? `No previously recorded sessions by this ${THERAPY_ROLE_LABELS.therapist.toLowerCase()} for this learner yet.` : `No previously recorded sessions by this ${THERAPY_ROLE_LABELS.therapist.toLowerCase()} yet.`}</Text>
            ) : null}

            {!sessionsLoading && !sessionsError && previousSessions.length && !filteredSessions.length ? (
              <Text style={styles.historyEmpty}>No previous sessions match the current search or filter.</Text>
            ) : null}

            {filteredSessions.map((item) => {
              const expanded = expandedSessionId === item.id;
              return (
                <View key={item.id || item.sessionId} style={styles.historyEntry}>
                  <TouchableOpacity
                    style={styles.historyEntryHeader}
                    onPress={() => setExpandedSessionId((current) => (current === item.id ? '' : item.id))}
                  >
                    <View style={styles.historyEntryTextWrap}>
                      <Text style={styles.historyEntryTitle}>{formatSessionStamp(item)}</Text>
                      {!child?.id && item?.childName ? <Text style={styles.historyEntryMeta}>{item.childName}</Text> : null}
                      <Text style={styles.historyEntryPreview} numberOfLines={expanded ? 0 : 2}>{buildSessionPreview(item)}</Text>
                    </View>
                    <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={26} color="#334155" />
                  </TouchableOpacity>
                  {expanded ? (
                    <View style={styles.historyEntryBody}>
                      <SessionSummarySnapshot
                        summary={item}
                        title="Recorded Session"
                        subtitle={`Submitted ${formatSessionStamp(item)}`}
                        emptyText="Session details unavailable."
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  headerCard: { borderRadius: 18, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff', padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#e5e7eb' },
  headerTextWrap: { marginLeft: 12, flex: 1 },
  title: { color: '#2563eb', fontWeight: '800', textTransform: 'uppercase', fontSize: 12 },
  name: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginTop: 4 },
  subtitle: { marginTop: 4, color: '#64748b' },
  abaCloseoutCard: { marginTop: 12, borderRadius: 18, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#f8fbff', padding: 16 },
  abaCloseoutTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  abaCloseoutSubtitle: { marginTop: 6, color: '#475569', lineHeight: 20 },
  abaCloseoutLabel: { marginTop: 12, color: '#0f172a', fontWeight: '700' },
  abaCloseoutInput: { minHeight: 88, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, marginTop: 8, textAlignVertical: 'top' },
  historyCard: { marginTop: 12, borderRadius: 18, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff', padding: 16 },
  historyTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  historySubtitle: { marginTop: 6, color: '#64748b', lineHeight: 20 },
  searchRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#dbe4f0', borderRadius: 12, backgroundColor: '#f8fafc', paddingHorizontal: 12, minHeight: 46 },
  searchInput: { flex: 1, marginLeft: 8, color: '#0f172a', paddingVertical: 10 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  filterChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#e2e8f0', marginRight: 8, marginBottom: 8 },
  filterChipActive: { backgroundColor: '#2563eb' },
  filterChipText: { color: '#0f172a', fontWeight: '700', fontSize: 12 },
  filterChipTextActive: { color: '#fff' },
  historyLoading: { marginTop: 16 },
  historyError: { marginTop: 16, color: '#b91c1c', lineHeight: 20 },
  historyEmpty: { marginTop: 16, color: '#64748b', lineHeight: 20 },
  historyEntry: { marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f8fafc', overflow: 'hidden' },
  historyEntryHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 },
  historyEntryTextWrap: { flex: 1, paddingRight: 10 },
  historyEntryTitle: { fontWeight: '800', color: '#0f172a' },
  historyEntryMeta: { marginTop: 4, color: '#2563eb', fontWeight: '700' },
  historyEntryPreview: { marginTop: 6, color: '#475569', lineHeight: 20 },
  historyEntryBody: { paddingHorizontal: 14, paddingBottom: 14 },
});