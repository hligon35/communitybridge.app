import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Linking, Modal, TouchableWithoutFeedback, Alert, Platform, ActivityIndicator } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useData } from '../DataContext';
import { useAuth } from '../AuthContext';
import { ScreenWrapper } from '../components/ScreenWrapper';
import ImageToggle from '../components/ImageToggle';
import EmptyInsightsState from '../features/sessionInsights/components/EmptyInsightsState';
import InsightStatCard from '../features/sessionInsights/components/InsightStatCard';
import LatestSummaryCard from '../features/sessionInsights/components/LatestSummaryCard';
import TrendMiniChart from '../features/sessionInsights/components/TrendMiniChart';
import BehaviorTrendList from '../features/sessionInsights/components/BehaviorTrendList';
import useChildProgressInsights from '../features/sessionInsights/hooks/useChildProgressInsights';
import { childHasParent, findLinkedParentId } from '../utils/directoryLinking';
import { avatarSourceFor } from '../utils/idVisibility';
import { maskEmailDisplay, maskPhoneDisplay } from '../utils/inputFormat';
import { THERAPY_ROLE_LABELS, getAssignmentRoleLabel } from '../utils/roleTerminology';
import { useTenant } from '../core/tenant/TenantContext';
import { isAdminRole } from '../core/tenant/models';
import { getChildSessionSummaries, getLatestChildSessionSummary, getTherapySessionSummaryText, listParentSummariesByChild } from '../Api';

export default function MyChildScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { children, parents, urgentMemos, timeChangeProposals, proposeTimeChange, respondToProposal, respondToUrgentMemo, seededSessionSummariesByChild = {} } = useData();
  const { user } = useAuth();
  const tenant = useTenant() || {};
  const childProfileMode = tenant.childProfileMode || { mode: 'family', entityLabel: 'child', collectionLabel: 'children', profileTitle: 'My Child', profileSummaryTitle: 'Family Overview' };
  const featureFlags = tenant.featureFlags || {};
  const entityLabel = childProfileMode.entityLabel || 'child';
  const entityLabelCap = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);
  const possessivePrefix = childProfileMode.mode === 'student' ? 'Your student' : childProfileMode.mode === 'operations' ? 'This profile' : 'Your child';

  const role = (user?.role || '').toString().toLowerCase();
  const isParent = role.includes('parent');
  const linkedParentId = isParent ? (findLinkedParentId(user, parents) || user?.id || null) : null;

  // Only show linked children for parents; keep existing behavior for other roles.
  const baseChildList = (Array.isArray(children) && children.length) ? children : [];
  const childList = useMemo(() => {
    if (!isParent) return baseChildList;
    return linkedParentId ? baseChildList.filter((c) => childHasParent(c, linkedParentId)) : [];
  }, [baseChildList, isParent, linkedParentId]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    if (selectedIndex >= childList.length) setSelectedIndex(0);
  }, [childList.length]);
  useEffect(() => {
    const requestedChildId = route?.params?.childId;
    if (!requestedChildId) return;
    const nextIndex = childList.findIndex((entry) => entry?.id === requestedChildId);
    if (nextIndex >= 0) setSelectedIndex(nextIndex);
    navigation.setParams?.({ childId: undefined });
  }, [childList, navigation, route?.params?.childId]);
  const child = childList[selectedIndex] || { id: 'no-child', name: `No ${childProfileMode.collectionLabel || 'children'} added`, age: '', room: '', avatar: null, carePlan: '', notes: '' };

  // const provided above via single useData call
  const [showProposeModal, setShowProposeModal] = useState(false);
  const [proposeType, setProposeType] = useState('pickup');
  const [useExactDate, setUseExactDate] = useState(false);
  const [exactDate, setExactDate] = useState(new Date());
  const [isPermanent, setIsPermanent] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  function formatISO(iso) {
    try {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleString();
    } catch (e) { return iso; }
  }

  const childProposals = (timeChangeProposals || []).filter((p) => p.childId === child.id);
  const [proposePreset, setProposePreset] = useState('10m_later');
  const [expandedReviewSection, setExpandedReviewSection] = useState(null);
  const [latestApprovedSummary, setLatestApprovedSummary] = useState(null);
  const [approvedSummaryHistory, setApprovedSummaryHistory] = useState([]);
  const [approvedParentSummaries, setApprovedParentSummaries] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [expandedApprovedSummaryId, setExpandedApprovedSummaryId] = useState(null);
  const [selectedParentSection, setSelectedParentSection] = useState('summary');
  const [artifactModalOpen, setArtifactModalOpen] = useState(false);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState('');
  const [artifactTitle, setArtifactTitle] = useState('SessionSummary.txt');
  const [artifactText, setArtifactText] = useState('');
  const childInsights = useChildProgressInsights(child?.id || '', { limit: 20 });

  function getProposalTypeLabel(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'pickup') return 'Pickup';
    if (normalized === 'dropoff') return 'Drop-off';
    if (normalized === 'cancel' || normalized === 'canceled' || normalized === 'cancelled') return 'Cancellation';
    return 'Schedule';
  }

  async function submitProposal(offsetMillis) {
    try {
      let proposedISO;
      if (useExactDate) {
        proposedISO = new Date(exactDate).toISOString();
      } else {
        const base = new Date(child.pickupTimeISO || child.dropoffTimeISO || Date.now());
        proposedISO = new Date(base.getTime() + offsetMillis).toISOString();
      }
      const note = `${proposeType} change via app`; 
      // include permanence in note so it is visible in local proposals when server doesn't persist scope
      const scopeNote = isPermanent ? `${note} (permanent)` : note;
      const created = await proposeTimeChange(child.id, proposeType, proposedISO, scopeNote);
      if (created) {
        Alert.alert('Proposal sent');
        setShowProposeModal(false);
      } else {
        Alert.alert('Failed', 'Could not send proposal');
      }
    } catch (e) {
      console.warn('submitProposal failed', e?.message || e);
      Alert.alert('Failed', 'Could not send proposal');
    }
  }

  function shortName(name, maxLen = 18) {
    if (!name || typeof name !== 'string') return '';
    if (name.length <= maxLen) return name;
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      // single long name — truncate
      return parts[0].slice(0, maxLen - 1) + '…';
    }
    const first = parts[0];
    const last = parts[parts.length - 1];
    return `${first} ${last.charAt(0)}.`;
  }

  const openPhone = (phone) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Unable to place call', 'Your device could not open the phone app.');
    });
  };
  const openEmail = (email) => {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() => {
      Alert.alert('Unable to open email', 'Your device could not open the email app.');
    });
  };

  const dailyReviewSections = useMemo(() => ([
    {
      key: 'daily-recap',
      title: 'Session Summary',
      content: child?.notes || 'No daily recap has been recorded yet.',
    },
    {
      key: 'monthly-goal',
      title: 'Monthly Focus',
      content: child?.monthlyGoal || child?.carePlan || 'No monthly goal has been recorded yet.',
    },
    {
      key: 'success-criteria',
      title: 'Milestones Met',
      content: child?.successCriteria || child?.goalProgress || 'No success criteria have been recorded yet.',
    },
    {
      key: 'programs-worked-on',
      title: 'Programs Covered',
      content: child?.curriculum || child?.programCurriculum || 'No worked-on programs have been recorded yet.',
    },
    {
      key: 'interfering-behavior',
      title: 'Behavior Tracking',
      content: child?.interferingBehaviorLevels || child?.behaviorNotes || 'No interfering behavior levels have been recorded yet.',
    },
  ]), [child]);

  useEffect(() => {
    let disposed = false;

    async function loadLatestSummary() {
      if (!child?.id) {
        if (!disposed) {
          setLatestApprovedSummary(null);
          setApprovedSummaryHistory([]);
          setApprovedParentSummaries([]);
        }
        return;
      }
      const seededItems = Array.isArray(seededSessionSummariesByChild?.[child.id]) ? seededSessionSummariesByChild[child.id] : null;
      if (seededItems) {
        const approvedItems = seededItems
          .filter((item) => String(item?.status || '').trim().toLowerCase() === 'approved')
          .sort((left, right) => {
            const leftStamp = Date.parse(String(left?.approvedAt || left?.updatedAt || left?.generatedAt || ''));
            const rightStamp = Date.parse(String(right?.approvedAt || right?.updatedAt || right?.generatedAt || ''));
            return (Number.isFinite(rightStamp) ? rightStamp : 0) - (Number.isFinite(leftStamp) ? leftStamp : 0);
          });
        if (!disposed) {
          setLatestApprovedSummary(approvedItems[0] || null);
          setApprovedSummaryHistory(approvedItems);
          setApprovedParentSummaries([]);
          setSummaryError('');
          setSummaryLoading(false);
        }
        return;
      }
      setSummaryLoading(true);
      setSummaryError('');
      try {
        const [latestResult, historyResult, parentSummaryResult] = await Promise.all([
          getLatestChildSessionSummary(child.id),
          getChildSessionSummaries(child.id, 12).catch(() => ({ items: [] })),
          listParentSummariesByChild(child.id, 12).catch(() => ({ items: [] })),
        ]);
        if (!disposed) {
          const items = Array.isArray(historyResult?.items) ? historyResult.items : [];
          const approvedItems = items
            .filter((item) => String(item?.status || '').trim().toLowerCase() === 'approved')
            .sort((left, right) => {
              const leftStamp = Date.parse(String(left?.approvedAt || left?.updatedAt || left?.generatedAt || ''));
              const rightStamp = Date.parse(String(right?.approvedAt || right?.updatedAt || right?.generatedAt || ''));
              return (Number.isFinite(rightStamp) ? rightStamp : 0) - (Number.isFinite(leftStamp) ? leftStamp : 0);
            });
          const parentItems = Array.isArray(parentSummaryResult?.items) ? parentSummaryResult.items : [];
          const approvedParentItems = parentItems
            .filter((item) => ['approved', 'sent'].includes(String(item?.status || '').trim().toLowerCase()))
            .sort((left, right) => {
              const leftStamp = Date.parse(String(left?.reviewedAt || left?.updatedAt || left?.createdAt || left?.date || ''));
              const rightStamp = Date.parse(String(right?.reviewedAt || right?.updatedAt || right?.createdAt || right?.date || ''));
              return (Number.isFinite(rightStamp) ? rightStamp : 0) - (Number.isFinite(leftStamp) ? leftStamp : 0);
            });
          setLatestApprovedSummary(latestResult?.item || approvedItems[0] || null);
          setApprovedSummaryHistory(approvedItems);
          setApprovedParentSummaries(approvedParentItems);
        }
      } catch (error) {
        if (!disposed) {
          setLatestApprovedSummary(null);
          setApprovedSummaryHistory([]);
          setApprovedParentSummaries([]);
          setSummaryError(String(error?.message || error || 'Could not load the approved summary.'));
        }
      } finally {
        if (!disposed) setSummaryLoading(false);
      }
    }

    loadLatestSummary();
    return () => {
      disposed = true;
    };
  }, [child?.id, seededSessionSummariesByChild]);

  useEffect(() => {
    setArtifactModalOpen(false);
    setArtifactError('');
    setArtifactText('');
  }, [child?.id]);

  useEffect(() => {
    setSelectedParentSection('summary');
    setExpandedApprovedSummaryId(null);
  }, [child?.id]);

  const latestApprovedSummarySubtitle = useMemo(() => {
    const source = latestApprovedSummary?.approvedAt || latestApprovedSummary?.updatedAt || latestApprovedSummary?.generatedAt || '';
    if (!source) return '';
    try {
      return `Approved ${new Date(source).toLocaleString()}`;
    } catch (_) {
      return '';
    }
  }, [latestApprovedSummary]);

  const recentApprovedSummaries = useMemo(() => approvedSummaryHistory.slice(0, 10), [approvedSummaryHistory]);

  const latestApprovedParentSummary = approvedParentSummaries[0] || null;
  const previousApprovedParentSummaries = useMemo(() => approvedParentSummaries.slice(1), [approvedParentSummaries]);
  const parentQuickActions = useMemo(() => ([
    { key: 'summary', label: 'Latest Summary' },
    { key: 'recent-sessions', label: 'Recent Sessions' },
    { key: 'pending-notifications', label: 'Pending Notifications' },
    { key: 'care-plan', label: 'Care Plan' },
    { key: 'insights', label: 'Insights' },
  ]), []);

  function formatSessionStamp(item) {
    const source = item?.approvedAt || item?.updatedAt || item?.generatedAt || '';
    if (!source) return 'Approved summary';
    try {
      return new Date(source).toLocaleString();
    } catch (_) {
      return 'Approved summary';
    }
  }

  async function openSummaryArtifact(item) {
    const sessionId = String(item?.sessionId || '').trim();
    if (!sessionId) {
      Alert.alert('Artifact unavailable', 'This approved summary does not include a session artifact reference yet.');
      return;
    }
    setArtifactModalOpen(true);
    setArtifactLoading(true);
    setArtifactError('');
    setArtifactText('');
    setArtifactTitle(`SessionSummary.txt • ${child?.name || 'Learner'}`);
    try {
      const result = await getTherapySessionSummaryText(sessionId);
      setArtifactText(String(result?.text || '').trim());
    } catch (error) {
      setArtifactError(String(error?.message || error || 'Could not load the session summary artifact.'));
    } finally {
      setArtifactLoading(false);
    }
  }

  const programDocs = useMemo(() => {
    const docsRaw = child?.programDocs;
    if (!docsRaw) return [];
    if (Array.isArray(docsRaw)) {
      return docsRaw
        .map((d) => {
          if (!d) return null;
          if (typeof d === 'string') return { title: 'Program document', url: d };
          const title = d.title || d.name || 'Program document';
          const url = d.url || d.href || '';
          if (!url) return null;
          return { title: String(title), url: String(url) };
        })
        .filter(Boolean);
    }
    if (typeof docsRaw === 'string') return [{ title: 'Program document', url: docsRaw }];
    return [];
  }, [child]);

  const openDoc = async (url) => {
    const u = String(url || '').trim();
    if (!u) return;
    try {
      await Linking.openURL(u);
    } catch (e) {
      Alert.alert('Could not open document', 'Please try again later.');
    }
  };

  const printDoc = (url) => {
    const u = String(url || '').trim();
    if (!u) return;
    if (Platform.OS !== 'web') {
      // On iOS/Android, opening the document lets users use the OS print/share flows.
      openDoc(u);
      return;
    }
    try {
      // Best-effort: open in a new tab/window; users can print from the browser.
      // Some browsers block programmatic print for cross-origin documents.
      window.open(u, '_blank', 'noopener,noreferrer');
    } catch (e) {
      // ignore
    }
  };

  const toggleParentSection = (key) => {
    setSelectedParentSection((current) => (current === key ? 'summary' : key));
  };

  const summaryContent = summaryLoading ? (
    <View style={styles.summaryLoadingWrap}>
      <ActivityIndicator size="small" color="#2563eb" />
    </View>
  ) : summaryError ? (
    <Text style={styles.summaryErrorText}>{summaryError}</Text>
  ) : latestApprovedSummary?.summary || latestApprovedParentSummary ? (
    <>
      {latestApprovedSummary?.summary ? (
        <LatestSummaryCard
          summary={latestApprovedSummary}
          subtitle={latestApprovedSummarySubtitle}
          metricsTwoByTwo
          onOpenArtifact={() => openSummaryArtifact(latestApprovedSummary).catch(() => {})}
          artifactDisabled={!String(latestApprovedSummary?.sessionId || '').trim()}
        />
      ) : null}

      {latestApprovedParentSummary ? (
        <View style={styles.summaryHistoryCard}>
          <Text style={styles.summaryHistoryTitle}>Parent-Safe ABA Updates</Text>
          <Text style={styles.summaryHistorySubtitle}>BCBA-approved behavior progress updates are summarized here without internal clinical detail.</Text>
          <View style={styles.parentSummaryCard}>
            <Text style={styles.parentSummaryStamp}>{formatSessionStamp(latestApprovedParentSummary)}</Text>
            {latestApprovedParentSummary?.highLevelProgress ? <Text style={styles.parentSummaryBody}>{latestApprovedParentSummary.highLevelProgress}</Text> : null}
            {latestApprovedParentSummary?.strengthsObserved ? <Text style={styles.parentSummaryDetail}>Strengths: {latestApprovedParentSummary.strengthsObserved}</Text> : null}
            {latestApprovedParentSummary?.focusAreas ? <Text style={styles.parentSummaryDetail}>Focus areas: {latestApprovedParentSummary.focusAreas}</Text> : null}
            {latestApprovedParentSummary?.homeCarryoverTip ? <Text style={styles.parentSummaryDetail}>Carryover tip: {latestApprovedParentSummary.homeCarryoverTip}</Text> : null}
          </View>
          {previousApprovedParentSummaries.map((item) => (
            <View key={item.id || item.sessionDataSheetId} style={styles.parentSummaryHistoryEntry}>
              <Text style={styles.parentSummaryHistoryStamp}>{formatSessionStamp(item)}</Text>
              <Text style={styles.parentSummaryHistoryText} numberOfLines={3}>{item?.highLevelProgress || item?.focusAreas || 'Parent-safe ABA update available.'}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {isParent ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Meeting with BCBA</Text>
          {((child.upcoming || []).filter((u) => u.type === 'parent-aba')).length ? (
            (child.upcoming || []).filter((u) => u.type === 'parent-aba').map((u) => (
              <View key={u.id} style={{ marginBottom: 8 }}>
                <Text style={styles.sectionText}>• {u.when} — {u.title}</Text>
                {u.organizer ? (
                  <Text style={[styles.sectionText, { marginTop: 4 }]}>Organizer: {u.organizer.name} • {maskPhoneDisplay(u.organizer.phone)} • {maskEmailDisplay(u.organizer.email)}</Text>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={styles.sectionText}>No meeting scheduled yet.</Text>
          )}
        </View>
      ) : null}
    </>
  ) : (
    <View style={styles.reviewAccordionList}>
      {dailyReviewSections.map((section) => {
        const isExpanded = expandedReviewSection === section.key;
        return (
          <TouchableOpacity
            key={section.key}
            style={styles.reviewAccordionCard}
            activeOpacity={0.9}
            onPress={() => setExpandedReviewSection(isExpanded ? null : section.key)}
          >
            <View style={styles.reviewAccordionHeader}>
              <Text style={styles.reviewAccordionTitle}>{section.title}</Text>
              <MaterialIcons name={isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={28} color="#667085" />
            </View>
            {isExpanded ? (
              <Text style={styles.reviewAccordionContent}>{section.content}</Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const recentSessionsContent = summaryLoading ? (
    <View style={styles.summaryLoadingWrap}>
      <ActivityIndicator size="small" color="#2563eb" />
    </View>
  ) : summaryError ? (
    <Text style={styles.summaryErrorText}>{summaryError}</Text>
  ) : (
    <View style={styles.summaryHistoryCard}>
      <Text style={styles.summaryHistoryTitle}>Recent Approved Sessions</Text>
      <Text style={styles.summaryHistorySubtitle}>Review the last 10 approved session summaries for this learner here.</Text>
      {recentApprovedSummaries.length ? recentApprovedSummaries.map((item) => {
        const itemKey = String(item?.id || item?.sessionId || `${item?.approvedAt || ''}-${item?.generatedAt || ''}`);
        const isExpanded = expandedApprovedSummaryId === itemKey;
        const previewText = item?.summary?.dailyRecap?.therapistNarrative || item?.summary?.dailyRecap?.summary || item?.summary?.overview || 'No recap note recorded.';
        return (
          <TouchableOpacity
            key={itemKey}
            style={styles.summaryAccordionEntry}
            activeOpacity={0.9}
            onPress={() => setExpandedApprovedSummaryId(isExpanded ? null : itemKey)}
          >
            <View style={styles.summaryAccordionHeader}>
              <View style={styles.summaryAccordionTitleWrap}>
                <Text style={styles.summaryAccordionTitle}>{formatSessionStamp(item)}</Text>
                <Text style={styles.summaryAccordionPreview} numberOfLines={isExpanded ? 0 : 2}>{previewText}</Text>
              </View>
              <MaterialIcons name={isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={28} color="#667085" />
            </View>
            {isExpanded ? (
              <View style={styles.summaryAccordionBody}>
                <Text style={styles.summaryAccordionBodyText}>{previewText}</Text>
                {!String(item?.sessionId || '').trim() ? null : (
                  <TouchableOpacity style={styles.summaryArtifactLink} onPress={() => openSummaryArtifact(item).catch(() => {})}>
                    <Text style={styles.summaryArtifactLinkText}>Open session artifact</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
          </TouchableOpacity>
        );
      }) : <Text style={styles.sectionText}>No approved sessions are available yet.</Text>}
    </View>
  );

  const pendingNotificationsContent = (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Pending Notifications</Text>
      {(() => {
        const memoRequests = (urgentMemos || []).filter((m) => m.childId === child.id && m.type === 'time_update' && (!m.status || m.status === 'pending'));
        const proposalRequests = (timeChangeProposals || []).filter((p) => p.childId === child.id);
        const combined = [
          ...proposalRequests.map((p) => ({ ...p, _source: 'proposal', status: p.status || 'pending' })),
          ...memoRequests.map((m) => ({ id: m.id, type: m.updateType, proposedISO: m.proposedISO, note: m.note, proposerName: m.proposerId, _source: 'memo', status: m.status || 'pending' })),
        ];
        if (!combined.length) return <Text style={styles.sectionText}>No pending notifications.</Text>;
        return combined.map((p) => (
          <View key={p.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
            <Text style={{ fontWeight: '700' }}>{getProposalTypeLabel(p.type)} notification</Text>
            <Text style={{ color: '#374151' }}>Requested: {formatISO(p.proposedISO)}</Text>
            <Text style={{ color: '#6b7280', fontSize: 12 }}>{p.note || ''}</Text>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>By: {p.proposerName || p.proposerId}</Text>
            {user && isAdminRole(user.role) ? (
              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                {p._source === 'proposal' ? (
                  <>
                    <TouchableOpacity onPress={async () => {
                      const res = await respondToProposal(p.id, 'accept');
                      if (res?.ok) Alert.alert('Accepted', 'The time change request was accepted.');
                      else Alert.alert('Accept failed', String(res?.error || 'Could not update the time change request.'));
                    }} style={{ marginRight: 8, padding: 8, backgroundColor: '#10B981', borderRadius: 8 }}>
                      <Text style={{ color: '#fff' }}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={async () => {
                      const res = await respondToProposal(p.id, 'reject');
                      if (res?.ok) Alert.alert('Rejected', 'The time change request was rejected.');
                      else Alert.alert('Reject failed', String(res?.error || 'Could not update the time change request.'));
                    }} style={{ padding: 8, backgroundColor: '#ef4444', borderRadius: 8 }}>
                      <Text style={{ color: '#fff' }}>Reject</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity onPress={async () => { const ok = await respondToUrgentMemo(p.id, 'accepted'); if (ok) Alert.alert('Accepted'); }} style={{ marginRight: 8, padding: 8, backgroundColor: '#10B981', borderRadius: 8 }}>
                      <Text style={{ color: '#fff' }}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={async () => { const ok = await respondToUrgentMemo(p.id, 'denied'); if (ok) Alert.alert('Denied'); }} style={{ padding: 8, backgroundColor: '#ef4444', borderRadius: 8 }}>
                      <Text style={{ color: '#fff' }}>Deny</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ) : (
              <Text style={{ marginTop: 8, color: '#6b7280' }}>Waiting for admin response</Text>
            )}
          </View>
        ));
      })()}
    </View>
  );

  const carePlanContent = (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Program</Text>
      <Text style={styles.sectionText}>
        {child?.curriculum || child?.programCurriculum || 'No curriculum details available yet.'}
      </Text>

      <View style={{ height: 10 }} />
      <Text style={[styles.sectionTitle, { marginBottom: 6 }]}>Care Plan</Text>
      <Text style={styles.sectionText}>
        {child?.carePlan || "Sam's goals: fine motor, communication prompts, and independent dressing."}
      </Text>

      {featureFlags.programDocuments !== false ? (
        <>
          <View style={{ height: 10 }} />
          <Text style={[styles.sectionTitle, { marginBottom: 6 }]}>Curriculum Documents</Text>
          {(programDocs || []).length ? (
            (programDocs || []).map((d) => (
              <View key={d.url} style={styles.docRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700' }} numberOfLines={1}>{d.title}</Text>
                  <Text style={{ color: '#6b7280', fontSize: 12 }} numberOfLines={1}>{d.url}</Text>
                </View>
                <TouchableOpacity onPress={() => openDoc(d.url)} style={styles.docBtn} accessibilityLabel={`Download ${d.title}`}>
                  <MaterialIcons name="file-download" size={18} color="#2563eb" />
                  <Text style={styles.docBtnText}>Download</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => printDoc(d.url)} style={styles.docBtn} accessibilityLabel={`Print ${d.title}`}>
                  <MaterialIcons name="print" size={18} color="#2563eb" />
                  <Text style={styles.docBtnText}>Print</Text>
                </TouchableOpacity>
              </View>
            ))
          ) : (
            <Text style={styles.sectionText}>No program documents available.</Text>
          )}
        </>
      ) : null}
    </View>
  );

  const insightsContent = (
    <>
      <View style={styles.insightsHero}>
        <Text style={styles.insightsEyebrow}>Progress Insights</Text>
        <Text style={styles.insightsTitle}>{child?.name || 'Child progress'}</Text>
        <Text style={styles.sectionText}>Approved session summaries are translated into simple progress, behavior, and participation trends for families and care teams.</Text>
      </View>

      {childInsights.loading ? (
        <View style={styles.summaryHistoryCard}>
          <Text style={styles.sectionText}>Loading progress insights...</Text>
        </View>
      ) : null}

      {!childInsights.loading && childInsights.error ? (
        <EmptyInsightsState title="Could not load insights" message={childInsights.error} />
      ) : null}

      {!childInsights.loading && !childInsights.error && (!childInsights.data || !childInsights.data.stats || !childInsights.data.stats.sessions) ? (
        <EmptyInsightsState />
      ) : null}

      {!childInsights.loading && !childInsights.error && childInsights.data?.stats?.sessions ? (
        <>
          <View style={styles.insightsStatsRow}>
            <InsightStatCard label="Sessions" value={childInsights.data.stats.sessions} hint="Approved session records in range." />
            <InsightStatCard label="Approved summaries" value={childInsights.data.stats.approvedSummaries} hint="Therapist-approved progress outputs." accent="#16a34a" />
            <InsightStatCard label="Average mood" value={childInsights.data.stats.averageMood == null ? '—' : childInsights.data.stats.averageMood} hint="Average mood score across approved sessions." accent="#f59e0b" />
            <InsightStatCard label="Behavior events" value={childInsights.data.stats.behaviorEventsCount} hint="Count of summarized behavior events." accent="#dc2626" />
            <InsightStatCard label="Milestones met" value={childInsights.data.stats.successCriteriaCount} hint="Tracked success criteria across approved sessions." />
            <InsightStatCard label="Programs worked" value={childInsights.data.stats.programsWorkedOnCount} hint="Programs or goals touched in the selected range." accent="#7c3aed" />
          </View>

          <TrendMiniChart title="Mood over time" items={childInsights.data?.trends?.mood || []} color="#0ea5e9" />
          <TrendMiniChart title="Behavior frequency" items={childInsights.data?.trends?.behaviorFrequency || []} color="#dc2626" />
          <TrendMiniChart title="Independence trend" items={childInsights.data?.trends?.independence || []} color="#16a34a" />
          <TrendMiniChart title="Progress trend" items={childInsights.data?.trends?.progressLevel || []} color="#7c3aed" />

          <BehaviorTrendList items={childInsights.data?.latestSummary?.interferingBehaviors || []} />
          <LatestSummaryCard
            summary={childInsights.data?.latestSummary}
            subtitle={childInsights.data?.latestSummary?.approvedAt ? `Approved ${new Date(childInsights.data.latestSummary.approvedAt).toLocaleString()}` : ''}
          />
        </>
      ) : null}
    </>
  );

  return (
    <ScreenWrapper bannerShowBack={false} style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
      {/* Developer action moved to DevRoleSwitcher */}

      {childList.length > 1 ? (
        <View style={styles.linkedChildrenWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.linkedChildrenTrack} pagingEnabled={false}>
            {childList.map((c, i) => (
              <TouchableOpacity key={c.id || i} onPress={() => setSelectedIndex(i)} style={[styles.linkedChildCard, selectedIndex === i ? styles.linkedChildCardSelected : null]} activeOpacity={0.88}>
                <Image source={avatarSourceFor(c)} style={styles.linkedChildAvatar} />
                <Text style={styles.linkedChildName} numberOfLines={1}>{shortName(c.name, 12) || 'Child'}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.card}>
        <Image source={avatarSourceFor(child)} style={styles.avatar} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.name}>{shortName(child.name, 20)}</Text>
          {(child.age || child.room) ? (
            <Text style={styles.meta}>{[child.age, child.room].filter(Boolean).join(' • ')}</Text>
          ) : null}
        </View>
      </View>

      {/* Propose modal */}
      {showProposeModal && (
        <Modal transparent visible animationType="fade">
          <TouchableWithoutFeedback onPress={() => setShowProposeModal(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' }}>
              <TouchableWithoutFeedback>
                <View style={{ width: '90%', backgroundColor: '#fff', padding: 12, borderRadius: 8 }}>
                  <Text style={{ fontWeight: '700', marginBottom: 8 }}>Propose {proposeType === 'pickup' ? 'Pickup' : 'Drop-off'} Time</Text>
                  <Text style={{ marginBottom: 8 }}>Choose a quick offset from the currently scheduled time.</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                    <TouchableOpacity onPress={() => submitProposal(10 * 60 * 1000)} style={{ padding: 8, backgroundColor: '#e5e7eb', borderRadius: 8 }}><Text>+10m</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => submitProposal(30 * 60 * 1000)} style={{ padding: 8, backgroundColor: '#e5e7eb', borderRadius: 8 }}><Text>+30m</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => submitProposal(60 * 60 * 1000)} style={{ padding: 8, backgroundColor: '#e5e7eb', borderRadius: 8 }}><Text>+1h</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => submitProposal(-15 * 60 * 1000)} style={{ padding: 8, backgroundColor: '#e5e7eb', borderRadius: 8 }}><Text>-15m</Text></TouchableOpacity>
                  </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text>Permanent change</Text>
                      <ImageToggle value={isPermanent} onValueChange={(v) => { setIsPermanent(v); if (v) { setUseExactDate(false); } }} accessibilityLabel="Permanent change" />
                    </View>
                    <View style={{ marginBottom: 8 }}>
                      <TouchableOpacity onPress={() => { setUseExactDate(!useExactDate); if (Platform.OS === 'android' && !showPicker && !useExactDate) setShowPicker(true); }} style={{ padding: 8, backgroundColor: useExactDate ? '#c7f9cc' : '#e5e7eb', borderRadius: 8 }}>
                        <Text>{useExactDate ? 'Using exact date/time' : 'Choose exact date/time'}</Text>
                      </TouchableOpacity>
                      {useExactDate && (
                        <View style={{ marginTop: 8 }}>
                          <Text style={{ marginBottom: 6 }}>Selected: {new Date(exactDate).toLocaleString()}</Text>
                          {showPicker && (
                            <DateTimePicker
                              value={exactDate}
                              mode="datetime"
                              display={Platform.OS === 'android' ? 'default' : 'inline'}
                              onChange={(e, d) => {
                                if (d) setExactDate(d);
                                if (Platform.OS === 'android') setShowPicker(false);
                              }}
                            />
                          )}
                          {!showPicker && Platform.OS === 'ios' ? (
                            <DateTimePicker value={exactDate} mode="datetime" display="inline" onChange={(e, d) => d && setExactDate(d)} />
                          ) : null}
                        </View>
                      )}
                    </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <TouchableOpacity onPress={() => setShowProposeModal(false)} style={{ marginLeft: 8, padding: 8 }}><Text>Cancel</Text></TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}

      <View>
        <View>
          <View style={styles.scheduleHeaderRow}>
            {isParent ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickLinksTrack}
              >
                {parentQuickActions.map((item, index) => {
                  const isActive = selectedParentSection === item.key;
                  return (
                    <TouchableOpacity
                      key={item.key}
                      style={[
                        styles.reportsLinkButton,
                        index > 0 ? styles.secondaryLinkButton : null,
                        isActive ? styles.reportsLinkButtonActive : null,
                      ]}
                      onPress={() => toggleParentSection(item.key)}
                    >
                      <Text style={[styles.reportsLinkButtonText, isActive ? styles.reportsLinkButtonTextActive : null]}>{item.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : (
              <>
                <Text style={styles.scheduleGroupTitle}>Daily Review</Text>
                <View style={styles.headerActionsRow}>
                  {child?.id ? (
                    <TouchableOpacity style={styles.reportsLinkButton} onPress={() => navigation.navigate('ChildProgressInsights', { childId: child.id })}>
                      <Text style={styles.reportsLinkButtonText}>Progress Insights</Text>
                    </TouchableOpacity>
                  ) : null}
                  {child?.id && !isParent ? (
                    <TouchableOpacity style={[styles.reportsLinkButton, styles.secondaryLinkButton]} onPress={() => navigation.navigate('Reports', { childId: child.id })}>
                      <Text style={styles.reportsLinkButtonText}>Open Reports</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </>
            )}
          </View>
        </View>

        {isParent ? (
          <>
            {selectedParentSection === 'summary' ? summaryContent : null}
            {selectedParentSection === 'recent-sessions' ? recentSessionsContent : null}
            {selectedParentSection === 'pending-notifications' ? pendingNotificationsContent : null}
            {selectedParentSection === 'care-plan' ? carePlanContent : null}
            {selectedParentSection === 'insights' ? insightsContent : null}
          </>
        ) : (
          <>
            {summaryContent}
            {pendingNotificationsContent}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Meeting with BCBA</Text>
              {((child.upcoming || []).filter((u) => u.type === 'parent-aba')).length ? (
                (child.upcoming || []).filter((u) => u.type === 'parent-aba').map((u) => (
                  <View key={u.id} style={{ marginBottom: 8 }}>
                    <Text style={styles.sectionText}>• {u.when} — {u.title}</Text>
                    {u.organizer ? (
                      <Text style={[styles.sectionText, { marginTop: 4 }]}>Organizer: {u.organizer.name} • {maskPhoneDisplay(u.organizer.phone)} • {maskEmailDisplay(u.organizer.email)}</Text>
                    ) : null}
                  </View>
                ))
              ) : (
                <Text style={styles.sectionText}>No meeting scheduled yet.</Text>
              )}
            </View>
            {carePlanContent}
          </>
        )}
      </View>

      <Modal transparent visible={artifactModalOpen} animationType="fade" onRequestClose={() => setArtifactModalOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setArtifactModalOpen(false)}>
          <View style={styles.artifactModalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.artifactModalCard}>
                <Text style={styles.artifactModalTitle}>{artifactTitle}</Text>
                {artifactLoading ? <ActivityIndicator style={styles.artifactLoading} size="small" color="#2563eb" /> : null}
                {artifactError ? <Text style={styles.summaryErrorText}>{artifactError}</Text> : null}
                {!artifactLoading && !artifactError ? (
                  <ScrollView style={styles.artifactTextWrap} contentContainerStyle={styles.artifactTextContent}>
                    <Text style={styles.artifactText}>{artifactText || 'No session summary artifact is available yet.'}</Text>
                  </ScrollView>
                ) : null}
                <View style={styles.artifactActionsRow}>
                  <TouchableOpacity style={styles.artifactCloseButton} onPress={() => setArtifactModalOpen(false)}>
                    <Text style={styles.artifactCloseButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 8 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#eee' },
  name: { fontSize: 18, fontWeight: '700' },
  meta: { color: '#6b7280', marginTop: 4 },
  section: { marginTop: 12, backgroundColor: '#fff', padding: 12, borderRadius: 8 },
  sectionCompact: { marginTop: 12, backgroundColor: '#fff', padding: 12, borderRadius: 12 },
  sectionTitle: { fontWeight: '700', marginBottom: 6 },
  sectionText: { color: '#374151' },
  peopleCardGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginTop: 4 },
  personCard: { width: '50%', paddingHorizontal: 4, marginBottom: 8, alignItems: 'center' },
  personCardAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#eee', marginBottom: 8 },
  personCardName: { fontSize: 13, fontWeight: '700', color: '#111827', textAlign: 'center' },
  docRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  docBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff', marginLeft: 8 },
  docBtnText: { marginLeft: 6, color: '#2563eb', fontWeight: '700' },
  row: { flexDirection: 'row', marginTop: 12 },
  therapistBlock: { flex: 1, backgroundColor: '#fff', padding: 10, borderRadius: 8 },
  therapistTitle: { fontWeight: '700', marginBottom: 8 },
  therapistInner: { flexDirection: 'row', alignItems: 'center' },
  therapistAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#eee' },
  therapistName: { fontWeight: '700' },
  therapistRole: { color: '#6b7280', fontSize: 12 },
  contactButton: { paddingVertical: 6 },
  contactText: { color: '#2563eb', fontSize: 13 },
  linkedChildrenWrap: { marginTop: 12 },
  linkedChildrenTrack: { paddingRight: 8 },
  linkedChildCard: { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, marginRight: 10, backgroundColor: '#fff', borderRadius: 16, width: 104, borderWidth: 1, borderColor: '#e5e7eb' },
  linkedChildCardSelected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  linkedChildAvatar: { width: 56, height: 56, borderRadius: 28, marginBottom: 8, backgroundColor: '#eee' },
  linkedChildName: { fontSize: 12, textAlign: 'center', fontWeight: '700', color: '#111827' },
  amIconRow: { flexDirection: 'row', marginTop: 8, justifyContent: 'center' },
  iconTouch: { marginHorizontal: 12 },
  demoButton: { backgroundColor: '#2563eb', padding: 10, borderRadius: 8, alignItems: 'center', marginBottom: 8 },
  careTeamWrap: { marginTop: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12 },
  careTeamTitle: { textAlign: 'center', fontWeight: '800', fontSize: 16, color: '#111827' },
  scheduleWrap: { marginTop: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12 },
  scheduleHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActionsRow: { flexDirection: 'row', alignItems: 'center' },
  quickLinksTrack: { paddingRight: 8 },
  scheduleGroupTitle: { textAlign: 'center', fontWeight: '800', fontSize: 16, color: '#111827' },
  reportsLinkButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#dbeafe' },
  reportsLinkButtonActive: { backgroundColor: '#2563eb' },
  secondaryLinkButton: { marginLeft: 8 },
  reportsLinkButtonText: { color: '#1d4ed8', fontWeight: '800', fontSize: 12 },
  reportsLinkButtonTextActive: { color: '#ffffff' },
  summaryLoadingWrap: { paddingVertical: 24, alignItems: 'center', justifyContent: 'center' },
  summaryErrorText: { color: '#b91c1c', paddingVertical: 12 },
  summaryHistoryCard: { marginTop: 12, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', padding: 14 },
  summaryHistoryTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  summaryHistorySubtitle: { marginTop: 4, color: '#64748b', lineHeight: 20 },
  summaryAccordionEntry: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 12 },
  summaryAccordionHeader: { flexDirection: 'row', alignItems: 'center' },
  summaryAccordionTitleWrap: { flex: 1, paddingRight: 12 },
  summaryAccordionTitle: { fontWeight: '800', color: '#111827' },
  summaryAccordionPreview: { marginTop: 4, color: '#475569', lineHeight: 20 },
  summaryAccordionBody: { marginTop: 12, borderRadius: 14, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', padding: 12 },
  summaryAccordionBodyText: { color: '#334155', lineHeight: 20 },
  summaryArtifactLink: { marginTop: 12, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#dbeafe' },
  summaryArtifactLinkText: { color: '#1d4ed8', fontWeight: '800', fontSize: 12 },
  parentSummaryCard: { marginTop: 12, borderRadius: 14, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#dbeafe', padding: 14 },
  parentSummaryStamp: { color: '#1d4ed8', fontWeight: '800' },
  parentSummaryBody: { marginTop: 8, color: '#0f172a', lineHeight: 22, fontWeight: '700' },
  parentSummaryDetail: { marginTop: 8, color: '#475569', lineHeight: 20 },
  parentSummaryHistoryEntry: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 12 },
  parentSummaryHistoryStamp: { color: '#111827', fontWeight: '700' },
  parentSummaryHistoryText: { marginTop: 4, color: '#475569', lineHeight: 20 },
  insightsHero: { marginTop: 12, borderRadius: 22, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', padding: 18 },
  insightsEyebrow: { color: '#1d4ed8', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' },
  insightsTitle: { marginTop: 6, fontSize: 24, fontWeight: '800', color: '#0f172a' },
  insightsStatsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginVertical: 12 },
  artifactModalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.42)', justifyContent: 'center', padding: 20 },
  artifactModalCard: { maxHeight: '80%', borderRadius: 18, backgroundColor: '#ffffff', padding: 18 },
  artifactModalTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  artifactLoading: { marginTop: 16 },
  artifactTextWrap: { marginTop: 12, maxHeight: 420, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, backgroundColor: '#f8fafc' },
  artifactTextContent: { padding: 12 },
  artifactText: { color: '#334155', lineHeight: 20, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  artifactActionsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  artifactCloseButton: { borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 10, paddingHorizontal: 14 },
  artifactCloseButtonText: { color: '#ffffff', fontWeight: '800' },
  reviewAccordionList: { marginTop: 12 },
  reviewAccordionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  reviewAccordionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewAccordionTitle: { fontSize: 18, fontWeight: '500', color: '#111827', flex: 1, paddingRight: 12 },
  reviewAccordionContent: { marginTop: 14, color: '#475569', lineHeight: 20, borderWidth: 1, borderColor: '#616b7e', borderRadius: 12, backgroundColor: '#f8fafc', padding: 12 },
});
