import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenWrapper } from '../components/ScreenWrapper';
import TenantSwitcher from '../components/TenantSwitcher';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { useTenant } from '../core/tenant/TenantContext';
import { USER_ROLES, normalizeUserRole } from '../core/tenant/models';
import { avatarSourceFor } from '../utils/idVisibility';
import { THERAPY_ROLE_LABELS } from '../utils/roleTerminology';
import useIsTabletLayout from '../hooks/useIsTabletLayout';
const { logPress } = require('../utils/logger');
const { isSpecialAccessUser } = require('../utils/authState');
const { getEffectiveChatIdentity } = require('../utils/demoIdentity');
const { isChildLinkedToTherapist, resolveSelectedDashboardChild, resolveTherapyWorkspaceTarget } = require('../features/sessionTracking/utils/dashboardSessionTarget');
const { DEFAULT_RESOURCE_URL } = require('../config/brand');

const moodGoodIcon = require('../../assets/icons/good.png');
const moodModerateIcon = require('../../assets/icons/moderate.png');
const moodBadIcon = require('../../assets/icons/bad.png');
const defaultSonIcon = require('../../assets/icons/defaultSon.png');
const defaultDaughterIcon = require('../../assets/icons/defaultDaughter.png');
const nextSessionIcon = require('../../assets/icons/nextSession.png');
const progressReportIcon = require('../../assets/icons/progressReport.png');
const itemsNeededIcon = require('../../assets/icons/itemsNeeded.png');
const careTeamIcon = require('../../assets/icons/careTeam.png');
const insuranceBillingIcon = require('../../assets/icons/insuranceBilling.png');
const parentResourcesIcon = require('../../assets/icons/parentResources.png');

function formatSessionLabel(dateValue) {
  if (!dateValue) return 'No session scheduled';
  const ts = Date.parse(String(dateValue));
  if (!Number.isFinite(ts)) return 'No session scheduled';
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getNextTherapistSession(children) {
  const now = new Date();
  const candidates = (Array.isArray(children) ? children : []).flatMap((child) => {
    const base = child?.dropoffTimeISO ? new Date(child.dropoffTimeISO) : null;
    if (!base || Number.isNaN(base.getTime())) return [];
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), base.getHours(), base.getMinutes());
    const scheduledAt = today.getTime() >= now.getTime()
      ? today
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, base.getHours(), base.getMinutes());
    return [{
      childId: child?.id || null,
      childName: child?.name || 'Child',
      session: child?.session || 'Session',
      scheduledAt,
    }];
  });
  candidates.sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());
  return candidates[0] || null;
}

function findRelevantChildren(role, userId, children, options = {}) {
  const allChildren = Array.isArray(children) ? children : [];
  const allowSpecialAccessFallback = options && options.allowSpecialAccessFallback === true;
  if (!userId) return [];
  if (role === 'therapist') {
    const linkedChildren = allChildren.filter((child) => isChildLinkedToTherapist(child, userId));
    if (linkedChildren.length || !allowSpecialAccessFallback) return linkedChildren;
    return allChildren;
  }
  return allChildren.filter((child) => Array.isArray(child?.parents) && child.parents.some((parent) => parent?.id === userId));
}

function childCarouselImageFor(child, index) {
  const hints = [
    child?.gender,
    child?.sex,
    child?.pronouns,
    child?.relation,
    child?.relationship,
    child?.label,
    child?.name,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase())
    .join(' ');

  if (/(girl|female|daughter|she|her)/.test(hints)) return defaultDaughterIcon;
  if (/(boy|male|son|he|him)/.test(hints)) return defaultSonIcon;
  return index % 2 === 0 ? defaultSonIcon : defaultDaughterIcon;
}

export default function RoleDashboardScreen({ navigation }) {
  const { user } = useAuth();
  const { children = [], urgentMemos = [], directoryLoading = false, directoryError = '', fetchAndSync, activeSeedPreset = '', seededItemsNeededByChild = {} } = useData();
  const tenant = useTenant();
  const isTabletLayout = useIsTabletLayout();
  const role = normalizeUserRole(user?.role || USER_ROLES.PARENT);
  const effectiveUser = useMemo(() => getEffectiveChatIdentity(user), [user]);
  const allowSpecialAccessFallback = isSpecialAccessUser(user?.email);
  const isTherapist = role === USER_ROLES.THERAPIST;
  const labels = tenant?.labels || {};
  const dashboardPreset = tenant?.dashboardPreset || {};
  const childProfileMode = tenant?.childProfileMode || {};
  const relevantChildren = useMemo(
    () => findRelevantChildren(role, effectiveUser?.id, children, { allowSpecialAccessFallback }),
    [children, role, effectiveUser?.id, allowSpecialAccessFallback]
  );
  const [selectedChildId, setSelectedChildId] = useState(null);

  useEffect(() => {
    if (!relevantChildren.length) {
      setSelectedChildId(null);
      return;
    }
    const stillExists = relevantChildren.some((child) => child?.id === selectedChildId);
    if (!stillExists) {
      setSelectedChildId(relevantChildren[0]?.id || null);
    }
  }, [isTherapist, relevantChildren, selectedChildId]);

  const selectedChild = useMemo(() => {
    return resolveSelectedDashboardChild(relevantChildren, selectedChildId);
  }, [relevantChildren, selectedChildId]);
  const activeChildren = useMemo(() => {
    if (isTherapist) return relevantChildren;
    return selectedChild ? [selectedChild] : [];
  }, [isTherapist, relevantChildren, selectedChild]);

  const firstRelevantChild = relevantChildren[0] || null;
  const sessionTargetChild = selectedChild || firstRelevantChild;
  const nextTherapistSession = useMemo(() => getNextTherapistSession(relevantChildren), [relevantChildren]);

  function openSessionCard(sessionAction) {
    logPress('Dashboard:SessionCard', {
      sessionAction,
      hasTargetChild: !!sessionTargetChild,
      targetChildId: sessionTargetChild?.id || null,
      role,
    });
    const { routeName, params } = resolveTherapyWorkspaceTarget(sessionAction, sessionTargetChild?.id || null, true);
    navigation.navigate(routeName, params);
  }

  const careTeamCount = useMemo(() => {
    if (isTherapist) return Math.max(1, activeChildren.length);
    const teamIds = new Set();
    activeChildren.forEach((child) => {
      [child?.amTherapist, child?.pmTherapist, child?.bcaTherapist].forEach((entry) => {
        if (!entry) return;
        if (typeof entry === 'string') teamIds.add(entry);
        else if (entry?.id) teamIds.add(entry.id);
      });
    });
    return teamIds.size;
  }, [activeChildren, isTherapist]);

  const nextSession = useMemo(() => {
    const timestamps = [];
    activeChildren.forEach((child) => {
      [child?.dropoffTimeISO, child?.pickupTimeISO].forEach((value) => {
        const ts = Date.parse(String(value || ''));
        if (Number.isFinite(ts) && ts >= Date.now()) timestamps.push(ts);
      });
    });
    timestamps.sort((left, right) => left - right);
    return timestamps.length ? formatSessionLabel(timestamps[0]) : 'No session scheduled';
  }, [activeChildren]);

  const pendingItems = useMemo(() => {
    if (activeSeedPreset === 'screenshot') {
      if (isTherapist) {
        return Object.values(seededItemsNeededByChild || {})
          .flat()
          .filter((item) => {
            const status = String(item?.status || '').trim().toLowerCase();
            return status === 'requested' || status === 'overdue';
          }).length;
      }
      if (!selectedChild?.id) return 0;
      return (Array.isArray(seededItemsNeededByChild?.[selectedChild.id]) ? seededItemsNeededByChild[selectedChild.id] : []).filter((item) => {
        const status = String(item?.status || '').trim().toLowerCase();
        return status === 'requested' || status === 'overdue';
      }).length;
    }
    if (isTherapist) {
      return (urgentMemos || []).filter((memo) => !memo?.status || memo.status === 'pending').length;
    }
    if (!selectedChild?.id) return 0;
    return (urgentMemos || []).filter((memo) => memo?.childId === selectedChild.id && (!memo?.status || memo.status === 'pending')).length;
  }, [activeSeedPreset, isTherapist, seededItemsNeededByChild, selectedChild?.id, urgentMemos]);

  const moodSummary = useMemo(() => {
    const scores = activeChildren
      .map((child) => Number(child?.moodScore ?? child?.mood))
      .filter((value) => Number.isFinite(value));

    if (!scores.length) {
      return {
        value: 'Not logged',
        hint: 'No mood check-ins logged yet.',
        imageSource: moodGoodIcon,
      };
    }

    const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    if (average <= 5) {
      return {
        value: `${Math.round(average)} / 15`,
        hint: 'Mood check-in is trending low.',
        imageSource: moodBadIcon,
      };
    }
    if (average <= 10) {
      return {
        value: `${Math.round(average)} / 15`,
        hint: 'Mood check-in is steady.',
        imageSource: moodModerateIcon,
      };
    }
    return {
      value: `${Math.round(average)} / 15`,
      hint: 'Mood check-in is trending positive.',
      imageSource: moodGoodIcon,
    };
  }, [activeChildren]);

  const cardDefinitions = {
    'next-session': {
      key: 'next-session',
      title: 'Next Session',
      value: isTherapist ? (nextTherapistSession?.childName || nextSession) : nextSession,
      hint: isTherapist
        ? (nextTherapistSession ? `${formatSessionLabel(nextTherapistSession.scheduledAt)} • ${nextTherapistSession.session}` : 'Based on your assigned learners.')
        : 'Based on your family schedule.',
      imageSource: nextSessionIcon,
      onPress: isTherapist
        ? (() => navigation.navigate('ScheduleCalendar', { therapistSchedule: true }))
        : () => navigation.navigate('ScheduleCalendar', { childId: selectedChild?.id || null }),
    },
    'mood-score': {
      key: 'mood-score',
      title: 'Mood Score',
      value: moodSummary.value,
      hint: moodSummary.hint,
      imageSource: moodSummary.imageSource,
    },
    'progress-report': {
      key: 'progress-report',
      title: isTherapist ? 'Assigned Children' : 'Progress Report',
      value: isTherapist ? `${relevantChildren.length}` : (selectedChild?.name || 'View child'),
      hint: isTherapist ? 'Children currently linked to your schedule.' : 'Children linked to your account.',
      imageSource: progressReportIcon,
      onPress: isTherapist
        ? (firstRelevantChild ? () => navigation.navigate('ChildDetail', { childId: firstRelevantChild.id }) : undefined)
        : () => navigation.getParent()?.navigate('MyChild', { childId: selectedChild?.id || null }),
    },
    'session-tracker': {
      key: 'session-tracker',
      title: 'Tap Tracker',
      value: sessionTargetChild?.name || 'Open tracker',
      hint: sessionTargetChild ? 'Launch the live session tracker for the selected learner.' : 'Assign a learner to open the live tracker.',
      icon: 'touch-app',
      onPress: () => openSessionCard('track'),
    },
    'summary-review': {
      key: 'summary-review',
      title: 'Session Report',
      value: sessionTargetChild?.name || 'Review draft',
      hint: sessionTargetChild ? `Open the ${THERAPY_ROLE_LABELS.therapist.toLowerCase()} summary review panel for the selected learner.` : 'Assign a learner to review a draft summary.',
      icon: 'fact-check',
      onPress: () => openSessionCard('summary'),
    },
    'items-needed': {
      key: 'items-needed',
      title: 'Items Needed',
      value: pendingItems ? `${pendingItems} pending` : 'None right now',
      hint: 'Check with your center for updates.',
      imageSource: itemsNeededIcon,
      onPress: isTherapist
        ? () => navigation.navigate('TherapistItemsNeeded', { childId: firstRelevantChild?.id || null })
        : undefined,
    },
    'care-team': {
      key: 'care-team',
      title: labels.careTeam || 'My Care Team',
      value: careTeamCount ? `${careTeamCount} members` : 'No team assigned',
      hint: isTherapist ? 'Your assigned caseload.' : `${THERAPY_ROLE_LABELS.therapists} connected to your family.`,
      imageSource: careTeamIcon,
      onPress: () => (isTherapist
        ? navigation.getParent()?.navigate('MyClass')
        : navigation.navigate('CareTeam', { childId: selectedChild?.id || null })),
    },
    billing: {
      key: 'billing',
      title: 'Billing & Insurance',
      value: 'View plan & payments',
      hint: 'See your insurance card, make a payment, or contact billing.',
      imageSource: insuranceBillingIcon,
      onPress: () => navigation.navigate('InsuranceBilling'),
    },
    resources: {
      key: 'resources',
      title: labels.resources || 'Parent Resources',
      value: isTherapist ? (labels.resourcesValueStaff || 'Staff resources') : (labels.resourcesValueFamily || 'Help & support'),
      hint: 'Open guidance, support, and reference details.',
      imageSource: parentResourcesIcon,
      onPress: () => {
        const url = DEFAULT_RESOURCE_URL;
        if (Platform.OS === 'web') {
          Linking.openURL(url).catch(() => {
            Alert.alert('Unable to open resource', 'Your device could not open the resource link.');
          });
        } else {
          WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => {
            Alert.alert('Unable to open resource', 'Your device could not open the resource link.');
          }));
        }
      },
    },
  };
  const activePreset = isTherapist ? dashboardPreset.staff : dashboardPreset.family;
  const presetKeys = Array.isArray(activePreset) && activePreset.length
    ? activePreset
    : ['next-session', 'mood-score', 'progress-report', 'items-needed', 'care-team', 'billing', 'resources'];
  const orderedPresetKeys = isTherapist
    ? ['session-tracker', 'summary-review', 'next-session', 'items-needed', ...presetKeys.filter((key) => !['session-tracker', 'summary-review', 'reports', 'next-session', 'items-needed'].includes(key))]
    : presetKeys;
  const featureFlags = tenant?.featureFlags || {};
  const cardFlagGates = {
    billing: () => featureFlags.programBilling !== false,
  };
  const dashboardCards = orderedPresetKeys
    .map((key) => cardDefinitions[key])
    .filter((card) => {
      if (!card) return false;
      if (!isTherapist && card.key === 'reports') return false;
      if (isTherapist && (card.key === 'progress-report' || card.key === 'mood-score' || card.key === 'care-team' || card.key === 'resources' || card.key === 'reports')) return false;
      const gate = cardFlagGates[card.key];
      return gate ? gate() : true;
    });

  function startDashboardSession() {
    if (!selectedChild?.id) return;
    navigation.navigate('TapTracker', {
      childId: selectedChild.id,
      autoStartSession: true,
      sessionType: new Date().getHours() < 12 ? 'AM' : 'PM',
    });
  }

  const retryDirectoryLoad = () => {
    fetchAndSync?.({ force: true })?.catch?.(() => {});
  };

  return (
    <ScreenWrapper bannerShowBack={false} hideBanner={isTabletLayout} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, isTherapist ? styles.heroTherapist : null]}>
          {isTherapist ? (
            <>
              {directoryLoading ? (
                <View style={styles.statusPanel}>
                  <MaterialIcons name="hourglass-top" size={18} color="#2563eb" />
                  <Text style={styles.statusText}>Loading assigned children...</Text>
                </View>
              ) : directoryError ? (
                <View style={styles.statusPanel}>
                  <MaterialIcons name="error-outline" size={18} color="#dc2626" />
                  <Text style={styles.statusText}>{directoryError}</Text>
                  <TouchableOpacity style={styles.retryButton} onPress={retryDirectoryLoad} activeOpacity={0.88}>
                    <Text style={styles.retryButtonText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : relevantChildren.length ? (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.familyCarouselTrack}>
                    {relevantChildren.map((child, index) => (
                      <TouchableOpacity
                        key={child?.id || `${child?.name || 'child'}-${index}`}
                        style={[styles.familyCard, child?.id === selectedChildId ? styles.familyCardSelected : null]}
                        activeOpacity={0.88}
                        onPress={() => setSelectedChildId(child?.id || null)}
                      >
                        <Image source={avatarSourceFor(child) || childCarouselImageFor(child, index)} style={styles.familyCardImage} resizeMode="cover" />
                        <Text style={styles.familyCardName} numberOfLines={1}>{child?.name || 'Child'}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <View style={styles.sessionLaunchArea}>
                    <TouchableOpacity style={[styles.startSessionButton, !selectedChild ? styles.startSessionButtonDisabled : null]} onPress={startDashboardSession} disabled={!selectedChild}>
                      <Text style={styles.startSessionButtonText}>Start Session</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <View style={styles.statusPanel}>
                  <MaterialIcons name="groups-2" size={18} color="#64748b" />
                  <Text style={styles.statusText}>{`No assigned children are linked to this ${THERAPY_ROLE_LABELS.therapist.toLowerCase()} yet.`}</Text>
                </View>
              )}
            </>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.familyCarouselTrack}>
                {relevantChildren.map((child, index) => {
                  const isSelected = child?.id === selectedChild?.id;
                  return (
                    <TouchableOpacity
                      key={child?.id || `${child?.name || 'child'}-${index}`}
                      style={[styles.familyCard, isSelected ? styles.familyCardSelected : null]}
                      activeOpacity={0.88}
                      onPress={() => setSelectedChildId(child?.id || null)}
                    >
                      <Image source={avatarSourceFor(child) || childCarouselImageFor(child, index)} style={styles.familyCardImage} resizeMode="cover" />
                      <Text style={styles.familyCardName} numberOfLines={1}>{child?.name || 'Child'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>

        <TenantSwitcher />

        {!isTherapist ? <View style={[styles.grid, isTherapist ? styles.gridTherapist : null]}>
          {dashboardCards.map((card) => {
            const cardContent = (
              <>
                <View style={styles.cardIconRow}>
                  {card.imageSource ? (
                    <Image source={card.imageSource} style={styles.cardImageIcon} resizeMode="contain" />
                  ) : (
                    <MaterialIcons name={card.icon} size={24} color="#2563eb" />
                  )}
                </View>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <Text style={styles.cardValue}>{card.value}</Text>
              </>
            );

            return card.onPress ? (
              <TouchableOpacity key={card.key} style={[styles.card, isTherapist ? styles.cardTherapist : null, card.fullWidth ? styles.cardFullWidth : null]} onPress={card.onPress} activeOpacity={0.88}>
                {cardContent}
              </TouchableOpacity>
            ) : (
              <View key={card.key} style={[styles.card, isTherapist ? styles.cardTherapist : null, card.fullWidth ? styles.cardFullWidth : null]}>
                {cardContent}
              </View>
            );
          })}
        </View> : null}
      </ScrollView>

    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: Platform.OS === 'web' ? 32 : 16 },
  hero: { padding: 18, borderRadius: 18, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  heroTherapist: { padding: 0, borderRadius: 0, backgroundColor: 'transparent', borderWidth: 0 },
  heroTitle: { marginTop: 8, fontSize: 24, fontWeight: '800', color: '#0f172a' },
  statusPanel: { marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#dbeafe', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  statusText: { flexShrink: 1, color: '#334155', lineHeight: 18 },
  retryButton: { marginLeft: 'auto', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#2563eb' },
  retryButtonText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  familyCarouselTrack: { paddingRight: 8, paddingTop: 12 },
  familyCard: {
    width: 108,
    marginRight: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  familyCardSelected: { borderColor: '#93c5fd', backgroundColor: '#eff6ff' },
  familyCardImage: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#e2e8f0' },
  familyCardName: { marginTop: 8, fontSize: 13, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  sessionLaunchArea: { marginTop: 18, minHeight: 240, borderRadius: 28, backgroundColor: '#e8f5e9', alignItems: 'center', justifyContent: 'center' },
  startSessionButton: { width: '52%', minHeight: 120, borderRadius: 28, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  startSessionButtonDisabled: { backgroundColor: '#166534' },
  startSessionButtonText: { color: '#ffffff', fontWeight: '800', fontSize: 28 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 16 },
  gridTherapist: { justifyContent: 'space-between' },
  card: { width: '31.5%', paddingVertical: 12, paddingHorizontal: 10, marginBottom: 10, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0' },
  cardTherapist: { width: '48%' },
  cardFullWidth: { width: '100%' },
  cardIconRow: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eff6ff' },
  cardImageIcon: { width: 30, height: 30 },
  cardTitle: { marginTop: 8, fontSize: 13, fontWeight: '800', color: '#0f172a', lineHeight: 16 },
  cardValue: { marginTop: 4, fontSize: 11, fontWeight: '600', color: '#475569', lineHeight: 14 },
});