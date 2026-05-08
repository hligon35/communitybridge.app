import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Linking, Modal, TouchableWithoutFeedback, Alert, Platform, ActivityIndicator } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useData } from '../DataContext';
import { useAuth } from '../AuthContext';
import { ScreenWrapper } from '../components/ScreenWrapper';
import MoodTrackerCard from '../components/MoodTrackerCard';
import ImageToggle from '../components/ImageToggle';
import SessionSummarySnapshot from '../components/SessionSummarySnapshot';
import LatestSummaryCard from '../features/sessionInsights/components/LatestSummaryCard';
import { childHasParent, findLinkedParentId } from '../utils/directoryLinking';
import { avatarSourceFor } from '../utils/idVisibility';
import { maskEmailDisplay, maskPhoneDisplay } from '../utils/inputFormat';
import { THERAPY_ROLE_LABELS, getAssignmentRoleLabel, getDisplayRoleLabel } from '../utils/roleTerminology';
import { useTenant } from '../core/tenant/TenantContext';
import { isAdminRole, isStaffRole } from '../core/tenant/models';
import { getChildSessionSummaries, getLatestChildSessionSummary, getTherapySessionSummaryText, listParentSummariesByChild } from '../Api';

export default function MyChildScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { children, parents, urgentMemos, timeChangeProposals, proposeTimeChange, respondToProposal, respondToUrgentMemo, fetchAndSync, seededSessionSummariesByChild = {} } = useData();
  const { user } = useAuth();
  const tenant = useTenant() || {};
  const childProfileMode = tenant.childProfileMode || { mode: 'family', entityLabel: 'child', collectionLabel: 'children', profileTitle: 'My Child', profileSummaryTitle: 'Family Overview' };
  const featureFlags = tenant.featureFlags || {};
  const entityLabel = childProfileMode.entityLabel || 'child';
  const entityLabelCap = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);
  const possessivePrefix = childProfileMode.mode === 'student' ? 'Your student' : childProfileMode.mode === 'operations' ? 'This profile' : 'Your child';

  const role = (user?.role || '').toString().toLowerCase();
  const isParent = role.includes('parent');
  const canRecordMood = isAdminRole(user?.role) || isStaffRole(user?.role);
  const linkedParentId = isParent ? (findLinkedParentId(user, parents) || null) : null;

  // Only show linked children for parents; keep existing behavior for other roles.
  const baseChildList = (Array.isArray(children) && children.length) ? children : [];
  const childList = isParent
    ? (linkedParentId ? baseChildList.filter((c) => childHasParent(c, linkedParentId)) : [])
    : baseChildList;
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    if (selectedIndex >= childList.length) setSelectedIndex(0);
  }, [childList.length]);
  useEffect(() => {
    const requestedChildId = route?.params?.childId;
    if (!requestedChildId) return;
    const nextIndex = childList.findIndex((entry) => entry?.id === requestedChildId);
    if (nextIndex >= 0 && nextIndex !== selectedIndex) {
      setSelectedIndex(nextIndex);
    }
  }, [childList, route?.params?.childId, selectedIndex]);
  // If there are multiple children, default to showing the second child now
  useEffect(() => {
    if (route?.params?.childId) return;
    if (childList.length > 1 && selectedIndex === 0) setSelectedIndex(1);
  }, [childList.length, route?.params?.childId, selectedIndex]);
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
  const [expandedHistorySessionId, setExpandedHistorySessionId] = useState('');
  const [artifactModalOpen, setArtifactModalOpen] = useState(false);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState('');
  const [artifactTitle, setArtifactTitle] = useState('SessionSummary.txt');
  const [artifactText, setArtifactText] = useState('');

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
    setExpandedHistorySessionId('');
    setArtifactModalOpen(false);
    setArtifactError('');
    setArtifactText('');
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

  const previousApprovedSummaries = useMemo(() => {
    const latestSessionId = String(latestApprovedSummary?.sessionId || '').trim();
    return approvedSummaryHistory.filter((item) => String(item?.sessionId || '').trim() !== latestSessionId);
  }, [approvedSummaryHistory, latestApprovedSummary?.sessionId]);

  const latestApprovedParentSummary = approvedParentSummaries[0] || null;
  const previousApprovedParentSummaries = useMemo(() => approvedParentSummaries.slice(1), [approvedParentSummaries]);

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
    const sessionId = String(item?.sessionId || item?.id || '').trim();
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

  const linkedParents = useMemo(() => {
    if (!Array.isArray(parents) || !child?.id) return [];
    return parents.filter((parent) => childHasParent(child, parent?.id));
  }, [child, parents]);

  const studentTherapistCards = useMemo(() => {
    const raw = [
      child?.bcaTherapist ? { ...child.bcaTherapist, cardKey: `bca-${child.bcaTherapist.id || child.bcaTherapist.name || 'therapist'}` } : null,
      child?.amTherapist ? { ...child.amTherapist, cardKey: `am-${child.amTherapist.id || child.amTherapist.name || 'therapist'}` } : null,
      child?.pmTherapist ? { ...child.pmTherapist, cardKey: `pm-${child.pmTherapist.id || child.pmTherapist.name || 'therapist'}` } : null,
    ].filter(Boolean);

    const unique = [];
    const seen = new Set();
    raw.forEach((item) => {
      const key = String(item?.id || item?.email || item?.name || item?.cardKey || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push(item);
    });
    return unique;
  }, [child]);

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

  return (
    <ScreenWrapper bannerShowBack={false} style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
      {/* Developer action moved to DevRoleSwitcher */}

      <View style={styles.card}>
        <Image source={avatarSourceFor(child)} style={styles.avatar} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.name}>{shortName(child.name, 20)}</Text>
          {(child.age || child.room) ? (
            <Text style={styles.meta}>{[child.age, child.room].filter(Boolean).join(' • ')}</Text>
          ) : null}
        </View>
      </View>

      {childList.length ? (
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

      <View style={styles.scheduleWrap}>
        <View style={styles.scheduleHeaderRow}>
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
        </View>

        {summaryLoading ? (
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
                onOpenInsights={child?.id ? () => navigation.navigate('ChildProgressInsights', { childId: child.id }) : null}
                onOpenArtifact={() => openSummaryArtifact(latestApprovedSummary).catch(() => {})}
                artifactDisabled={!String(latestApprovedSummary?.sessionId || '').trim()}
              />
            ) : null}

            {previousApprovedSummaries.length ? (
              <View style={styles.summaryHistoryCard}>
                <Text style={styles.summaryHistoryTitle}>Recent Approved Sessions</Text>
                <Text style={styles.summaryHistorySubtitle}>Review prior approved session summaries for this learner without leaving the family progress screen.</Text>
                {previousApprovedSummaries.map((item) => {
                  const expanded = expandedHistorySessionId === item.id;
                  return (
                    <View key={item.id || item.sessionId} style={styles.summaryHistoryEntry}>
                      <TouchableOpacity
                        style={styles.summaryHistoryEntryHeader}
                        onPress={() => setExpandedHistorySessionId((current) => (current === item.id ? '' : item.id))}
                      >
                        <View style={styles.summaryHistoryEntryTextWrap}>
                          <Text style={styles.summaryHistoryEntryTitle}>{formatSessionStamp(item)}</Text>
                          <Text style={styles.summaryHistoryEntryPreview} numberOfLines={expanded ? 0 : 2}>
                            {item?.summary?.dailyRecap?.therapistNarrative || 'No recap note recorded.'}
                          </Text>
                        </View>
                        <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={26} color="#334155" />
                      </TouchableOpacity>
                      <View style={styles.summaryHistoryActionsRow}>
                        <TouchableOpacity style={styles.summaryHistoryAction} onPress={() => openSummaryArtifact(item).catch(() => {})}>
                          <Text style={styles.summaryHistoryActionText}>Open SessionSummary.txt</Text>
                        </TouchableOpacity>
                      </View>
                      {expanded ? (
                        <View style={styles.summaryHistoryEntryBody}>
                          <SessionSummarySnapshot
                            summary={item}
                            title="Approved Session Summary"
                            subtitle={formatSessionStamp(item)}
                            emptyText="No approved session summary has been recorded yet."
                          />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
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
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Notifications</Text>
          {(() => {
            const memoRequests = (urgentMemos || []).filter((m) => m.childId === child.id && m.type === 'time_update' && (!m.status || m.status === 'pending'));
            const proposalRequests = (timeChangeProposals || []).filter((p) => p.childId === child.id);
            const combined = [
              ...proposalRequests.map((p) => ({ ...p, _source: 'proposal', status: p.status || 'pending' })),
              ...memoRequests.map((m) => ({ id: m.id, type: m.updateType, proposedISO: m.proposedISO, note: m.note, proposerName: m.proposerId, _source: 'memo', status: m.status || 'pending' }))
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Program</Text>
          <Text style={styles.sectionText}>
            {child?.curriculum || child?.programCurriculum || child?.carePlan || 'No curriculum details available yet.'}
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

        <MoodTrackerCard
          childId={child?.id}
          latestEntry={child?.latestMoodEntry}
          editable={canRecordMood}
          onRecorded={() => fetchAndSync({ force: true })}
        />
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

      {/* Care team */}
      <View style={styles.careTeamWrap}>
        <Text style={styles.careTeamTitle}>{childProfileMode.mode === 'student' ? 'Support Team' : 'Care Team'}</Text>

        {childProfileMode.mode === 'student' ? (
          <>
            <View style={styles.sectionCompact}>
              <Text style={styles.sectionTitle}>Parents</Text>
              {linkedParents.length ? (
                <View style={styles.peopleCardGrid}>
                  {linkedParents.map((parent, index) => (
                    <View key={parent?.id || `parent-${index}`} style={styles.personCard}>
                      <Image source={avatarSourceFor(parent)} style={styles.personCardAvatar} />
                      <Text style={styles.personCardName} numberOfLines={2}>{shortName(parent?.name, 18) || 'Parent'}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.sectionText}>No parents linked yet.</Text>
              )}
            </View>

            <View style={styles.sectionCompact}>
              <Text style={styles.sectionTitle}>{THERAPY_ROLE_LABELS.therapists}</Text>
              {studentTherapistCards.length ? (
                <View style={styles.peopleCardGrid}>
                  {studentTherapistCards.map((therapist, index) => (
                    <View key={therapist?.cardKey || therapist?.id || `therapist-${index}`} style={styles.personCard}>
                      <Image source={avatarSourceFor(therapist)} style={styles.personCardAvatar} />
                      <Text style={styles.personCardName} numberOfLines={2}>{shortName(therapist?.name, 18) || THERAPY_ROLE_LABELS.therapist}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.sectionText}>{`No ${THERAPY_ROLE_LABELS.therapists.toLowerCase()} assigned yet.`}</Text>
              )}
            </View>
          </>
        ) : (
          <>
            <View style={[styles.card, { marginTop: 8, alignItems: 'center' }]}>
              {child.bcaTherapist ? (
                <>
                  <Image source={avatarSourceFor(child.bcaTherapist)} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#eee' }} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.name}>{shortName(child.bcaTherapist.name, 20)}</Text>
                    <Text style={styles.meta}>{getDisplayRoleLabel(child.bcaTherapist.role)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <TouchableOpacity onPress={() => openPhone(child.bcaTherapist.phone)} style={{ paddingVertical: 6 }} accessibilityLabel="Call BCBA">
                      <MaterialIcons name="call" size={20} color="#2563eb" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => openEmail(child.bcaTherapist.email)} style={{ paddingVertical: 6 }} accessibilityLabel="Email BCBA">
                      <MaterialIcons name="email" size={20} color="#2563eb" />
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.name}>BCBA</Text>
                  <Text style={styles.meta}>No BCBA assigned.</Text>
                </View>
              )}
            </View>

            <View style={[styles.row, { marginTop: 12 }]}> 
              <View style={[styles.therapistBlock, { marginRight: 8 }]}>
                <Text style={styles.therapistTitle}>{THERAPY_ROLE_LABELS.amTherapist}</Text>
                {child.amTherapist ? (
                  <View style={styles.therapistInner}>
                    <Image source={avatarSourceFor(child.amTherapist)} style={styles.therapistAvatar} />
                    <View style={{ flex: 1, marginLeft: 8, alignItems: 'center' }}>
                      <Text style={styles.therapistName}>{shortName(child.amTherapist.name, 18)}</Text>
                      <Text style={styles.therapistRole}>{getDisplayRoleLabel(child.amTherapist.role)}</Text>
                      <View style={styles.amIconRow}>
                        <TouchableOpacity onPress={() => openPhone(child.amTherapist.phone)} style={styles.iconTouch} accessibilityLabel={`Call ${THERAPY_ROLE_LABELS.amTherapist}`}>
                          <MaterialIcons name="call" size={22} color="#2563eb" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => openEmail(child.amTherapist.email)} style={styles.iconTouch} accessibilityLabel={`Email ${THERAPY_ROLE_LABELS.amTherapist}`}>
                          <MaterialIcons name="email" size={22} color="#2563eb" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.sectionText}>{`No ${THERAPY_ROLE_LABELS.amTherapist.toLowerCase()} assigned.`}</Text>
                )}
              </View>

              <View style={[styles.therapistBlock, { marginLeft: 8 }]}>
                <Text style={styles.therapistTitle}>{THERAPY_ROLE_LABELS.pmTherapist}</Text>
                {child.pmTherapist ? (
                  <View style={styles.therapistInner}>
                    <Image source={avatarSourceFor(child.pmTherapist)} style={styles.therapistAvatar} />
                    <View style={{ flex: 1, marginLeft: 8, alignItems: 'center' }}>
                      <Text style={styles.therapistName}>{shortName(child.pmTherapist.name, 18)}</Text>
                      <Text style={styles.therapistRole}>{getDisplayRoleLabel(child.pmTherapist.role)}</Text>
                      <View style={styles.amIconRow}>
                        <TouchableOpacity onPress={() => openPhone(child.pmTherapist.phone)} style={styles.iconTouch} accessibilityLabel={`Call ${THERAPY_ROLE_LABELS.pmTherapist}`}>
                          <MaterialIcons name="call" size={22} color="#2563eb" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => openEmail(child.pmTherapist.email)} style={styles.iconTouch} accessibilityLabel={`Email ${THERAPY_ROLE_LABELS.pmTherapist}`}>
                          <MaterialIcons name="email" size={22} color="#2563eb" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.sectionText}>{`No ${THERAPY_ROLE_LABELS.pmTherapist.toLowerCase()} assigned.`}</Text>
                )}
              </View>
            </View>
          </>
        )}

        <View style={[styles.card, { marginTop: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>{childProfileMode.mode === 'student' ? 'Learning Plan' : childProfileMode.mode === 'operations' ? 'Program Plan' : 'Care Plan'}</Text>
            <Text style={styles.sectionText}>{child.carePlan || "Sam's goals: fine motor, communication prompts, and independent dressing."}</Text>
          </View>
        </View>
      </View>

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
  scheduleGroupTitle: { textAlign: 'center', fontWeight: '800', fontSize: 16, color: '#111827' },
  reportsLinkButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#dbeafe' },
  secondaryLinkButton: { marginLeft: 8 },
  reportsLinkButtonText: { color: '#1d4ed8', fontWeight: '800', fontSize: 12 },
  summaryLoadingWrap: { paddingVertical: 24, alignItems: 'center', justifyContent: 'center' },
  summaryErrorText: { color: '#b91c1c', paddingVertical: 12 },
  summaryHistoryCard: { marginTop: 12, backgroundColor: '#ffffff', borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', padding: 14 },
  summaryHistoryTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  summaryHistorySubtitle: { marginTop: 4, color: '#64748b', lineHeight: 20 },
  parentSummaryCard: { marginTop: 12, borderRadius: 14, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#dbeafe', padding: 14 },
  parentSummaryStamp: { color: '#1d4ed8', fontWeight: '800' },
  parentSummaryBody: { marginTop: 8, color: '#0f172a', lineHeight: 22, fontWeight: '700' },
  parentSummaryDetail: { marginTop: 8, color: '#475569', lineHeight: 20 },
  parentSummaryHistoryEntry: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 12 },
  parentSummaryHistoryStamp: { color: '#111827', fontWeight: '700' },
  parentSummaryHistoryText: { marginTop: 4, color: '#475569', lineHeight: 20 },
  summaryHistoryEntry: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 12 },
  summaryHistoryEntryHeader: { flexDirection: 'row', alignItems: 'center' },
  summaryHistoryEntryTextWrap: { flex: 1, paddingRight: 12 },
  summaryHistoryEntryTitle: { fontWeight: '800', color: '#111827' },
  summaryHistoryEntryPreview: { marginTop: 4, color: '#475569', lineHeight: 20 },
  summaryHistoryActionsRow: { flexDirection: 'row', marginTop: 10 },
  summaryHistoryAction: { borderRadius: 10, backgroundColor: '#eff6ff', paddingVertical: 10, paddingHorizontal: 12 },
  summaryHistoryActionText: { color: '#1d4ed8', fontWeight: '800' },
  summaryHistoryEntryBody: { marginTop: 10 },
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
  reviewAccordionList: { marginTop: 8 },
  reviewAccordionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 20,
    marginBottom: 14,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  reviewAccordionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewAccordionTitle: { fontSize: 18, fontWeight: '500', color: '#111827', flex: 1, paddingRight: 12 },
  reviewAccordionContent: { marginTop: 14, color: '#475569', lineHeight: 20 },
});
