import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenWrapper } from '../components/ScreenWrapper';
import AppDropdown from '../components/AppDropdown';
import AppIconButton from '../components/AppIconButton';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { useTenant } from '../core/tenant/TenantContext';
import { isAdminRole, isBcbaRole, isOfficeAdminRole, normalizeUserRole, USER_ROLES } from '../core/tenant/models';
import { avatarSourceFor } from '../utils/idVisibility';
import { THERAPY_ROLE_LABELS, getDisplayRoleLabel } from '../utils/roleTerminology';
import { maskPhoneDisplay } from '../utils/inputFormat';
import { getPhoneAccessProfile, isPhoneViewport as resolvePhoneViewport } from '../utils/mobileRoleAccess';
import * as Api from '../Api';

const GUARDIAN_RELATIONSHIP_OPTIONS = [
  { value: 'mother', label: 'Mother' },
  { value: 'father', label: 'Father' },
  { value: 'guardian', label: 'Guardian' },
];

function createGuardianDraft(overrides = {}) {
  return {
    id: `guardian-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    relationship: 'guardian',
    name: '',
    email: '',
    phone: '',
    ...overrides,
  };
}

function guardianRelationshipLabel(value) {
  return GUARDIAN_RELATIONSHIP_OPTIONS.find((item) => item.value === value)?.label || 'Guardian';
}

function splitStudentName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || 'Student',
    lastName: parts.slice(1).join(' '),
  };
}

function formatMaskedLearnerName(name) {
  const { firstName, lastName } = splitStudentName(name);
  return lastName ? `${firstName} ${lastName.charAt(0).toUpperCase()}.` : firstName;
}

function formatSummaryTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return 'No recent update';
  return new Date(parsed).toLocaleString();
}

function titleCaseWords(value) {
  return String(value || '')
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeArrivalStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'approaching' || raw === 'arrived' || raw === 'exited') return raw;
  return '';
}

function getArrivalStatusMeta(status) {
  if (status === 'arrived') {
    return {
      label: 'Arrived',
      backgroundColor: '#dcfce7',
      borderColor: '#86efac',
      textColor: '#166534',
    };
  }
  if (status === 'approaching') {
    return {
      label: 'Approaching',
      backgroundColor: '#dbeafe',
      borderColor: '#93c5fd',
      textColor: '#1d4ed8',
    };
  }
  if (status === 'exited') {
    return {
      label: 'Left Zone',
      backgroundColor: '#fee2e2',
      borderColor: '#fca5a5',
      textColor: '#b91c1c',
    };
  }
  return null;
}

function getArrivalSortStamp(item) {
  const candidate = item?.lastSeenAt || item?.updatedAt || item?.createdAt || item?.date || '';
  const parsed = Date.parse(String(candidate || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildArrivalStatusByChild(urgentMemos = []) {
  return (Array.isArray(urgentMemos) ? urgentMemos : []).reduce((acc, memo) => {
    if (String(memo?.type || '').trim().toLowerCase() !== 'arrival_alert') return acc;
    const childId = String(memo?.childId || '').trim();
    const arrivalStatus = normalizeArrivalStatus(memo?.arrivalStatus || memo?.status);
    if (!childId || !arrivalStatus) return acc;
    const nextStamp = getArrivalSortStamp(memo);
    const prev = acc[childId];
    if (!prev || nextStamp >= prev.sortStamp) {
      acc[childId] = {
        status: arrivalStatus,
        updatedAt: memo?.lastSeenAt || memo?.updatedAt || memo?.createdAt || memo?.date || '',
        sortStamp: nextStamp,
      };
    }
    return acc;
  }, {});
}

function ArrivalStatusBadge({ status, compact = false }) {
  const meta = getArrivalStatusMeta(status);
  if (!meta) return null;
  return (
    <View
      style={[
        styles.arrivalBadge,
        compact ? styles.arrivalBadgeCompact : null,
        { backgroundColor: meta.backgroundColor, borderColor: meta.borderColor },
      ]}
    >
      <Text style={[styles.arrivalBadgeText, compact ? styles.arrivalBadgeTextCompact : null, { color: meta.textColor }]}>{meta.label}</Text>
    </View>
  );
}

function resolveLatestMoodEntry(child) {
  const latestEntry = child?.latestMoodEntry;
  if (Array.isArray(latestEntry) && latestEntry.length && latestEntry[0] && typeof latestEntry[0] === 'object') return latestEntry[0];
  if (latestEntry && typeof latestEntry === 'object') return latestEntry;
  const fallbackScore = Number(child?.moodScore ?? child?.mood);
  if (!Number.isFinite(fallbackScore)) return null;
  return { score: fallbackScore, recordedAt: null };
}

function resolveMoodSummary(child) {
  const latest = resolveLatestMoodEntry(child);
  const score = Number(latest?.score);
  if (!Number.isFinite(score)) {
    return {
      value: 'No score',
      detail: 'No mood check-ins logged yet.',
      icon: 'sentiment-neutral',
      iconColor: '#94a3b8',
    };
  }
  if (score <= 3) {
    return {
      value: `${score} / 15`,
      detail: latest?.recordedAt ? formatSummaryTimestamp(latest.recordedAt) : 'Most recent mood check-in',
      icon: 'sentiment-very-dissatisfied',
      iconColor: '#dc2626',
    };
  }
  if (score <= 7) {
    return {
      value: `${score} / 15`,
      detail: latest?.recordedAt ? formatSummaryTimestamp(latest.recordedAt) : 'Most recent mood check-in',
      icon: 'sentiment-dissatisfied',
      iconColor: '#f97316',
    };
  }
  if (score <= 10) {
    return {
      value: `${score} / 15`,
      detail: latest?.recordedAt ? formatSummaryTimestamp(latest.recordedAt) : 'Most recent mood check-in',
      icon: 'sentiment-neutral',
      iconColor: '#eab308',
    };
  }
  return {
    value: `${score} / 15`,
    detail: latest?.recordedAt ? formatSummaryTimestamp(latest.recordedAt) : 'Most recent mood check-in',
    icon: 'sentiment-very-satisfied',
    iconColor: '#16a34a',
  };
}

function resolveAttendanceSummary(child) {
  const rawStatus = String(child?.attendanceStatus || child?.scheduleStatus || child?.status || '').trim().toLowerCase();
  const status = rawStatus || (child?.dropoffTimeISO || child?.pickupTimeISO || child?.session ? 'scheduled' : 'not scheduled');
  const sessionLabel = String(child?.session || '').trim();
  const dropoffLabel = child?.dropoffTimeISO ? new Date(child.dropoffTimeISO).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const pickupLabel = child?.pickupTimeISO ? new Date(child.pickupTimeISO).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const timeLabel = dropoffLabel && pickupLabel ? `${dropoffLabel} - ${pickupLabel}` : '';
  const baseDetail = timeLabel || sessionLabel || (status === 'not scheduled' ? 'No session assigned' : 'Current session status');
  const arrivalLabel = String(child?.arrivalStatus || '').trim();
  const detail = arrivalLabel ? `${baseDetail} • Arrival ${titleCaseWords(arrivalLabel)}` : baseDetail;
  return {
    value: titleCaseWords(status),
    detail,
  };
}

function resolvePickupQueueSummary(child, queueItems = []) {
  const latestItem = Array.isArray(queueItems) && queueItems.length ? queueItems[0] : null;
  const status = String(child?.pickupQueueStatus || latestItem?.status || '').trim();
  const pickupPerson = String(child?.pickupPerson || latestItem?.pickupPerson || '').trim();
  const confirmedAt = String(child?.pickupConfirmedAt || latestItem?.confirmedAt || '').trim();
  const queuedAt = String(child?.pickupQueuedAt || latestItem?.queuedAt || '').trim();
  const reason = String(child?.pickupReason || latestItem?.reason || '').trim();
  const verifier = String(child?.pickupVerifiedByName || latestItem?.verifiedByName || '').trim();

  if (!status) {
    return {
      value: 'Not queued',
      detail: 'No pickup queue activity recorded yet.',
    };
  }

  const details = [];
  if (pickupPerson) details.push(pickupPerson);
  if (confirmedAt) {
    details.push(`Confirmed ${formatSummaryTimestamp(confirmedAt)}`);
  } else if (queuedAt) {
    details.push(`Queued ${formatSummaryTimestamp(queuedAt)}`);
  }
  if (verifier) details.push(`Verified by ${verifier}`);
  if (reason) details.push(reason);

  return {
    value: titleCaseWords(status),
    detail: details.join(' • ') || 'Most recent pickup queue update',
  };
}

function normalizeAttendanceStatus(status) {
  const key = String(status || '').trim().toLowerCase();
  if (key === 'present') return { key: 'present', label: 'Present', value: 3, color: '#16a34a' };
  if (key === 'tardy' || key === 'late') return { key: 'tardy', label: 'Tardy', value: 2, color: '#f59e0b' };
  if (key === 'absent') return { key: 'absent', label: 'Absent', value: 1, color: '#dc2626' };
  return { key: 'unknown', label: 'Unknown', value: 1, color: '#94a3b8' };
}

function buildAttendanceTrendItems(items = [], limit = 5) {
  const seenDates = new Set();
  const latestByDay = [];
  const sorted = [...(Array.isArray(items) ? items : [])]
    .map((item) => {
      const rawDate = item?.dateKey || item?.date || item?.recordedAt || item?.createdAt || item?.updatedAt || null;
      const parsed = Date.parse(String(rawDate || ''));
      if (!Number.isFinite(parsed)) return null;
      return { item, parsed };
    })
    .filter(Boolean)
    .sort((left, right) => right.parsed - left.parsed);

  sorted.forEach(({ item, parsed }) => {
    if (latestByDay.length >= limit) return;
    const date = new Date(parsed);
    const dateKey = date.toISOString().slice(0, 10);
    if (seenDates.has(dateKey)) return;
    seenDates.add(dateKey);
    const status = normalizeAttendanceStatus(item?.status);
    latestByDay.push({
      key: dateKey,
      dayLabel: date.toLocaleDateString([], { weekday: 'short' }),
      dateLabel: date.toLocaleDateString([], { month: 'numeric', day: 'numeric' }),
      statusLabel: status.label,
      value: status.value,
      color: status.color,
    });
  });

  return latestByDay.reverse();
}

function TabButton({ label, active, onPress }) {
  return (
    <TouchableOpacity style={[styles.tabButton, active ? styles.tabButtonActive : null]} onPress={onPress}>
      <Text style={[styles.tabButtonText, active ? styles.tabButtonTextActive : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ActionChip({ label, icon, onPress }) {
  return (
    <TouchableOpacity style={styles.actionChipButton} onPress={onPress}>
      <MaterialIcons name={icon} size={16} color="#1d4ed8" />
      <Text style={styles.actionChipButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function InlineFilterDropdown({ label, value, options = [], selectedValue, onSelect, width = 104 }) {
  return (
    <AppDropdown
      buttonStyle={styles.inlineFilterButton}
      containerStyle={[styles.inlineFilterWrap, { width }]}
      height={40}
      iconSize={16}
      minMenuWidth={width}
      onSelect={onSelect}
      options={options}
      placeholder={label}
      placeholderTextStyle={styles.inlineFilterPlaceholder}
      selectedValue={selectedValue}
      textStyle={styles.inlineFilterValue}
      value={value}
      width={width}
    />
  );
}

function normalizeInlineParents(selectedChild, parents) {
  if (!selectedChild) return [];
  const parentEntries = Array.isArray(selectedChild.parents) ? selectedChild.parents : [];
  const parentIds = new Set(parentEntries.map((item) => (item && typeof item === 'object' ? item.id : item)).filter(Boolean));
  const linked = (parents || []).filter((parent) => parentIds.has(parent?.id));
  if (linked.length) return linked;
  return parentEntries.map((entry, index) => {
    if (!entry) return null;
    if (typeof entry === 'string') {
      return { id: `inline-parent-${index}`, name: entry, email: '', phone: '' };
    }
    return {
      id: entry.id || `inline-parent-${index}`,
      name: entry.name || `${entry.firstName || ''} ${entry.lastName || ''}`.trim() || 'Parent/Guardian',
      email: entry.email || '',
      phone: entry.phone || '',
    };
  }).filter(Boolean);
}

export default function StudentDirectoryScreen() {
  const navigation = useNavigation();
  const { width, height } = useWindowDimensions();
  const { user } = useAuth();
  const { children = [], parents = [], therapists = [], urgentMemos = [], fetchAndSync, activeSeedPreset = '', seededAttendanceHistoryByChild = {}, seededPickupQueueByChild = {} } = useData();
  const { currentOrganization, currentProgram, currentCampus } = useTenant() || {};
  const isBcba = isBcbaRole(user?.role);
  const isOffice = isOfficeAdminRole(user?.role);
  const phoneAccessProfile = getPhoneAccessProfile(user?.role);
  const usePhoneSafeDirectory = Platform.OS !== 'web'
    && resolvePhoneViewport(width, height)
    && ['bcba', 'office', 'reception', 'admin'].includes(phoneAccessProfile);
  const canOpenRelatedChats = isAdminRole(user?.role) || isOffice || isBcba;
  const normalizedRole = normalizeUserRole(user?.role);
  const isScopedAdmin = isOffice && normalizedRole !== USER_ROLES.ORG_ADMIN && normalizedRole !== USER_ROLES.SUPER_ADMIN;
  const scopedEnrollmentCode = String(currentCampus?.enrollmentCode || '').trim().toUpperCase();
  const enrollmentCodeLocked = Boolean(isScopedAdmin && scopedEnrollmentCode);
  const [query, setQuery] = useState('');
  const [roomFilter, setRoomFilter] = useState('all');
  const [sortKey, setSortKey] = useState('name');
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollSaving, setEnrollSaving] = useState(false);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [attendanceHistoryLoading, setAttendanceHistoryLoading] = useState(false);
  const [attendanceHistoryError, setAttendanceHistoryError] = useState('');
  const [enrollDraft, setEnrollDraft] = useState({
    name: '',
    enrollmentCode: '',
    room: '',
    guardians: [createGuardianDraft()],
  });

  const visibleTabs = useMemo(() => {
    const base = [
      { key: 'overview', label: 'Overview' },
      { key: 'parents', label: 'Parent Contacts' },
      { key: 'attendance', label: 'Attendance' },
      { key: 'documents', label: 'Documents' },
    ];
    if (isBcba) {
      base.splice(2, 0,
        { key: 'programs', label: 'Clinical Programs' },
        { key: 'bip', label: 'Behavior Plan / BIP' },
        { key: 'iep', label: 'IEP / Goals' },
      );
    }
    return base;
  }, [isBcba]);

  const roomOptions = useMemo(() => ['all', ...Array.from(new Set((children || []).map((child) => child?.room).filter(Boolean)))], [children]);
  const roomChoices = useMemo(() => roomOptions.map((room) => ({ value: room, label: room === 'all' ? 'All Rooms' : room })), [roomOptions]);
  const sortChoices = useMemo(() => ([
    { value: 'name', label: 'Name' },
    { value: 'room', label: 'Room' },
    { value: 'age', label: 'Age' },
  ]), []);
  const roomDropdownValue = roomFilter === 'all' ? '' : (roomChoices.find((option) => option.value === roomFilter)?.label || '');
  const sortDropdownValue = sortKey === 'name' ? '' : (sortChoices.find((option) => option.value === sortKey)?.label || '');
  const useMobileHeaderFilters = width < 900;
  const useRosterCarousel = width < 900;
  const arrivalStatusByChild = useMemo(() => buildArrivalStatusByChild(urgentMemos), [urgentMemos]);

  const filteredChildren = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...(children || [])]
      .map((child) => {
        const arrivalState = arrivalStatusByChild[String(child?.id || '').trim()];
        if (!arrivalState) return child;
        return {
          ...child,
          arrivalStatus: String(child?.arrivalStatus || arrivalState.status || '').trim(),
          latestArrivalAt: child?.latestArrivalAt || arrivalState.updatedAt || '',
        };
      })
      .filter((child) => {
        if (roomFilter !== 'all' && String(child?.room || '') !== roomFilter) return false;
        if (!normalized) return true;
        const haystack = [child?.name, child?.room, child?.carePlan, child?.age].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(normalized);
      })
      .sort((left, right) => {
        if (sortKey === 'room') return String(left?.room || '').localeCompare(String(right?.room || ''));
        if (sortKey === 'age') return Number(left?.age || 0) - Number(right?.age || 0);
        return String(left?.name || '').localeCompare(String(right?.name || ''));
      });
  }, [arrivalStatusByChild, children, query, roomFilter, sortKey]);
  useEffect(() => {
    if (!filteredChildren.length) {
      setSelectedChildId(null);
      return;
    }
    if (!filteredChildren.some((child) => child?.id === selectedChildId)) {
      setSelectedChildId(filteredChildren[0]?.id || null);
    }
  }, [filteredChildren, selectedChildId]);

  useEffect(() => {
    if (!enrollmentCodeLocked) return;
    setEnrollDraft((current) => {
      if (current.enrollmentCode === scopedEnrollmentCode) return current;
      return { ...current, enrollmentCode: scopedEnrollmentCode };
    });
  }, [enrollmentCodeLocked, scopedEnrollmentCode]);

  const selectedChild = useMemo(() => filteredChildren.find((child) => child?.id === selectedChildId) || null, [filteredChildren, selectedChildId]);
  const linkedParents = useMemo(() => normalizeInlineParents(selectedChild, parents), [parents, selectedChild]);
  const careTeam = useMemo(() => {
    if (!selectedChild) return { bcba: null, amTherapist: null, pmTherapist: null };
    const therapistById = new Map((therapists || []).map((staff) => [staff?.id, staff]));
    const resolveStaff = (entry) => {
      if (!entry) return null;
      if (typeof entry === 'object' && entry.id && therapistById.has(entry.id)) return therapistById.get(entry.id);
      if (typeof entry === 'object' && (entry.name || entry.role)) return entry;
      const entryId = typeof entry === 'string' ? entry : entry?.id;
      return therapistById.get(entryId) || null;
    };
    return {
      bcba: resolveStaff(selectedChild?.bcaTherapist),
      amTherapist: resolveStaff(selectedChild?.amTherapist),
      pmTherapist: resolveStaff(selectedChild?.pmTherapist),
    };
  }, [selectedChild, therapists]);
  const attendanceTrendItems = useMemo(() => buildAttendanceTrendItems(attendanceHistory, 5), [attendanceHistory]);
  const phoneAttendanceSummary = useMemo(() => filteredChildren.reduce((summary, child) => {
    const status = String(child?.attendanceStatus || child?.scheduleStatus || child?.status || 'scheduled').trim().toLowerCase();
    summary.total += 1;
    if (status === 'present' || status === 'completed') summary.present += 1;
    else if (status === 'absent' || status === 'canceled') summary.absent += 1;
    else if (status === 'tardy' || status === 'late') summary.tardy += 1;
    else summary.scheduled += 1;
    return summary;
  }, { total: 0, present: 0, absent: 0, tardy: 0, scheduled: 0 }), [filteredChildren]);
  const phoneRoomSummary = useMemo(() => {
    const counts = new Map();
    filteredChildren.forEach((child) => {
      const room = String(child?.room || 'Unassigned').trim() || 'Unassigned';
      counts.set(room, (counts.get(room) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, 6);
  }, [filteredChildren]);
  const phoneMaskedRoster = useMemo(() => filteredChildren.slice(0, 8).map((child) => ({
    id: child?.id || child?.name,
    name: formatMaskedLearnerName(child?.name),
    room: String(child?.room || 'Unassigned').trim() || 'Unassigned',
    attendance: resolveAttendanceSummary(child),
    mood: resolveMoodSummary(child),
  })), [filteredChildren]);

  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'attendance' || !selectedChild?.id) return () => {
      cancelled = true;
    };

    if (activeSeedPreset === 'screenshot') {
      setAttendanceHistoryLoading(false);
      setAttendanceHistoryError('');
      setAttendanceHistory(Array.isArray(seededAttendanceHistoryByChild?.[selectedChild.id]) ? seededAttendanceHistoryByChild[selectedChild.id] : []);
      return () => {
        cancelled = true;
      };
    }

    setAttendanceHistoryLoading(true);
    setAttendanceHistoryError('');
    Api.getAttendanceHistory(selectedChild.id, 10)
      .then((result) => {
        if (cancelled) return;
        setAttendanceHistory(Array.isArray(result?.items) ? result.items : []);
      })
      .catch((error) => {
        if (cancelled) return;
        setAttendanceHistory([]);
        setAttendanceHistoryError(String(error?.message || 'Could not load attendance history.'));
      })
      .finally(() => {
        if (cancelled) return;
        setAttendanceHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSeedPreset, activeTab, seededAttendanceHistoryByChild, selectedChild?.id]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: isOffice
        ? () => (
            <AppIconButton
              accessibilityLabel="Enroll learner"
              name="add"
              iconSize={20}
              size={35}
              style={styles.headerAddButton}
              onPress={() => setEnrollOpen(true)}
            />
          )
        : () => null,
      headerBackVisible: false,
      headerBackTitleVisible: false,
    });
  }, [isOffice, navigation]);

  if (usePhoneSafeDirectory) {
    const aggregateOnly = phoneAccessProfile !== 'bcba';

    return (
      <ScreenWrapper style={styles.container}>
        <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          <View style={[styles.summaryCard, styles.summaryCardFull, { marginBottom: 12 }]}> 
            <Text style={styles.summaryCardLabel}>{aggregateOnly ? 'Phone student access stays aggregate-first.' : 'Phone student access stays masked and summary-first.'}</Text>
            <Text style={styles.summaryCardDetail}>
              {aggregateOnly
                ? 'This phone view keeps learner access limited to room totals, attendance rollups, and operational status summaries.'
                : 'This phone view keeps learner access limited to masked roster summaries, attendance status, and recent mood signals.'}
            </Text>
          </View>

          <View style={styles.summaryCardsRow}>
            <View style={[styles.summaryCard, styles.summaryCardLeft]}>
              <Text style={styles.summaryCardLabel}>Visible learners</Text>
              <Text style={styles.summaryCardValue}>{phoneAttendanceSummary.total}</Text>
              <Text style={styles.summaryCardDetail}>Shown only within this phone-safe scope.</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryCardRight]}>
              <Text style={styles.summaryCardLabel}>Rooms active</Text>
              <Text style={styles.summaryCardValue}>{phoneRoomSummary.length}</Text>
              <Text style={styles.summaryCardDetail}>Current room coverage on phone.</Text>
            </View>
          </View>

          <View style={styles.summaryCardsRow}>
            <View style={[styles.summaryCard, styles.summaryCardLeft]}>
              <Text style={styles.summaryCardLabel}>Present / completed</Text>
              <Text style={styles.summaryCardValue}>{phoneAttendanceSummary.present}</Text>
              <Text style={styles.summaryCardDetail}>Attendance roll-up across the visible mobile roster.</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryCardRight]}>
              <Text style={styles.summaryCardLabel}>Absent / canceled</Text>
              <Text style={styles.summaryCardValue}>{phoneAttendanceSummary.absent}</Text>
              <Text style={styles.summaryCardDetail}>Operational exceptions needing follow-up.</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Room overview</Text>
          {phoneRoomSummary.length ? phoneRoomSummary.map((room) => (
            <View key={room.label} style={styles.assignmentCard}>
              <Text style={styles.assignmentTitle}>{room.label}</Text>
              <Text style={styles.assignmentMeta}>{room.count} learner{room.count === 1 ? '' : 's'} in current scope</Text>
            </View>
          )) : <Text style={styles.detailText}>No learner room assignments are visible right now.</Text>}

          {!aggregateOnly ? (
            <>
              <Text style={styles.sectionTitle}>Masked learner roster</Text>
              {phoneMaskedRoster.length ? phoneMaskedRoster.map((child) => (
                <View key={child.id} style={styles.assignmentCard}>
                  <Text style={styles.assignmentTitle}>{child.name}</Text>
                  <Text style={styles.assignmentMeta}>{child.room} • {child.attendance.value}</Text>
                  <Text style={styles.detailText}>{child.mood.value} • {child.mood.detail}</Text>
                </View>
              )) : <Text style={styles.detailText}>No learners are visible in this mobile summary.</Text>}
            </>
          ) : null}
        </ScrollView>
      </ScreenWrapper>
    );
  }

  function openPhone(phone) {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Unable to place call', 'Your device could not open the phone app.');
    });
  }

  function openEmail(email) {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() => {
      Alert.alert('Unable to open email', 'Your device could not open the email app.');
    });
  }

  function openRelatedChats() {
    const firstParent = (selectedChild?.parents || [])[0];
    const firstTherapist = selectedChild?.amTherapist || selectedChild?.pmTherapist || selectedChild?.bcaTherapist;
    const targetId = firstParent?.id || firstTherapist?.id || null;
    if (!targetId) return;
    navigation.navigate('AdminChatMonitor', { initialUserId: targetId });
  }

  function updateEnrollDraft(key, value) {
    setEnrollDraft((current) => ({ ...current, [key]: value }));
  }

  function updateGuardian(guardianId, key, value) {
    setEnrollDraft((current) => ({
      ...current,
      guardians: (current.guardians || []).map((guardian) => (
        guardian.id === guardianId ? { ...guardian, [key]: value } : guardian
      )),
    }));
  }

  function addGuardian() {
    setEnrollDraft((current) => ({
      ...current,
      guardians: [...(current.guardians || []), createGuardianDraft()],
    }));
  }

  function removeGuardian(guardianId) {
    setEnrollDraft((current) => {
      const nextGuardians = (current.guardians || []).filter((guardian) => guardian.id !== guardianId);
      return {
        ...current,
        guardians: nextGuardians.length ? nextGuardians : [createGuardianDraft()],
      };
    });
  }

  function resetEnrollDraft() {
    setEnrollDraft({
      name: '',
      enrollmentCode: enrollmentCodeLocked ? scopedEnrollmentCode : '',
      room: '',
      guardians: [createGuardianDraft()],
    });
  }

  async function submitEnrollment() {
    setEnrollSaving(true);
    try {
      const guardians = (enrollDraft.guardians || [])
        .map((guardian) => ({
          relationship: String(guardian?.relationship || 'guardian').trim().toLowerCase(),
          name: String(guardian?.name || '').trim(),
          email: String(guardian?.email || '').trim(),
          phone: String(guardian?.phone || '').trim(),
        }))
        .filter((guardian) => guardian.name || guardian.email || guardian.phone);
      const primaryGuardian = guardians.find((guardian) => guardian.name) || guardians[0] || null;
      const result = await Api.enrollLearner({
        ...enrollDraft,
        guardians,
        parentName: primaryGuardian?.name || '',
        parentEmail: primaryGuardian?.email || '',
        parentPhone: primaryGuardian?.phone || '',
        enrollmentCode: enrollmentCodeLocked ? scopedEnrollmentCode : enrollDraft.enrollmentCode,
        organizationId: String(currentOrganization?.id || user?.organizationId || '').trim(),
        programId: String(currentProgram?.id || user?.programId || user?.branchId || '').trim(),
        campusId: String(currentCampus?.id || user?.campusId || '').trim(),
      });
      setSelectedChildId(result?.child?.id || null);
      await fetchAndSync?.({ force: true });
      setEnrollOpen(false);
      resetEnrollDraft();
      Alert.alert(
        'Learner enrolled',
        `${result?.child?.name || 'The learner'} was added to ${result?.enrollmentContext?.campus?.name || 'the selected campus'}. A family can now finish signup with the same enrollment code and the matching parent or guardian name.`
      );
    } catch (error) {
      Alert.alert('Enrollment failed', String(error?.message || error || 'We could not enroll this learner.'));
    } finally {
      setEnrollSaving(false);
    }
  }

  function renderTabContent() {
    if (!selectedChild) return <Text style={styles.empty}>Select a student to view details.</Text>;
    if (activeTab === 'overview') {
      const moodSummary = resolveMoodSummary(selectedChild);
      const attendanceSummary = resolveAttendanceSummary(selectedChild);
      const pickupQueueItems = Array.isArray(seededPickupQueueByChild?.[selectedChild.id]) ? seededPickupQueueByChild[selectedChild.id] : [];
      const pickupQueueSummary = resolvePickupQueueSummary(selectedChild, pickupQueueItems);
      const showPickupQueueCard = activeSeedPreset === 'screenshot' || Boolean(selectedChild?.pickupQueueStatus);
      const nextSession = Array.isArray(selectedChild.upcoming) && selectedChild.upcoming.length ? selectedChild.upcoming[0] : null;
      const hasCareTeam = Boolean(careTeam.bcba || careTeam.amTherapist || careTeam.pmTherapist);
      return (
        <>
          <View style={styles.summaryCardsRow}>
            <View style={[styles.summaryCard, styles.summaryCardLeft]}>
              <Text style={styles.summaryCardLabel}>Current attendance</Text>
              <Text style={styles.summaryCardValue}>{attendanceSummary.value}</Text>
              <Text style={styles.summaryCardDetail}>{attendanceSummary.detail}</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryCardRight]}>
              <View style={styles.summaryCardHeaderRow}>
                <View style={styles.summaryCardTextWrap}>
                  <Text style={styles.summaryCardLabel}>Most recent mood</Text>
                  <Text style={styles.summaryCardValue}>{moodSummary.value}</Text>
                </View>
                <MaterialIcons name={moodSummary.icon} size={34} color={moodSummary.iconColor} />
              </View>
            </View>
          </View>

          {showPickupQueueCard ? (
            <View style={[styles.summaryCard, styles.summaryCardFull]}>
              <Text style={styles.summaryCardLabel}>Pickup queue</Text>
              <Text style={styles.summaryCardValue}>{pickupQueueSummary.value}</Text>
              <Text style={styles.summaryCardDetail}>{pickupQueueSummary.detail}</Text>
            </View>
          ) : null}

          {nextSession ? (
            <View style={styles.upcomingRow}>
              <Text style={styles.upcomingTitle}>{nextSession.title}</Text>
              <Text style={styles.upcomingMeta}>{nextSession.when}</Text>
            </View>
          ) : (
            <Text style={styles.detailText}>No upcoming session scheduled.</Text>
          )}

          <Text style={styles.sectionTitle}>Care plan</Text>
          <Text style={styles.detailText}>{selectedChild.carePlan || 'No overview summary saved yet.'}</Text>

          <Text style={styles.sectionTitle}>Care Team</Text>
          {hasCareTeam ? (
            <>
              <View style={styles.careTeamPyramid}>
                {careTeam.bcba ? (
                  <TouchableOpacity style={[styles.careTeamCard, styles.careTeamCardTop]} onPress={() => navigation.navigate('FacultyDetail', { facultyId: careTeam.bcba.id })}>
                    <Image source={avatarSourceFor(careTeam.bcba)} style={[styles.smallAvatar, styles.careTeamAvatar]} />
                    <View style={styles.careTeamTextWrap}>
                      <Text style={styles.personName}>{careTeam.bcba.name || 'BCBA'}</Text>
                      <Text style={styles.personMeta}>BCBA</Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
                <View style={styles.careTeamBottomRow}>
                  {careTeam.amTherapist ? (
                    <TouchableOpacity style={[styles.careTeamCard, styles.careTeamCardBottom]} onPress={() => navigation.navigate('FacultyDetail', { facultyId: careTeam.amTherapist.id })}>
                      <Image source={avatarSourceFor(careTeam.amTherapist)} style={[styles.smallAvatar, styles.careTeamAvatar]} />
                      <View style={styles.careTeamTextWrap}>
                        <Text style={styles.personName}>{careTeam.amTherapist.name || 'AM Therapist'}</Text>
                        <Text style={styles.personMeta}>AM {THERAPY_ROLE_LABELS.therapist}</Text>
                      </View>
                    </TouchableOpacity>
                  ) : <View style={styles.careTeamPlaceholder} />}
                  {careTeam.pmTherapist ? (
                    <TouchableOpacity style={[styles.careTeamCard, styles.careTeamCardBottom]} onPress={() => navigation.navigate('FacultyDetail', { facultyId: careTeam.pmTherapist.id })}>
                      <Image source={avatarSourceFor(careTeam.pmTherapist)} style={[styles.smallAvatar, styles.careTeamAvatar]} />
                      <View style={styles.careTeamTextWrap}>
                        <Text style={styles.personName}>{careTeam.pmTherapist.name || 'PM Therapist'}</Text>
                        <Text style={styles.personMeta}>PM {THERAPY_ROLE_LABELS.therapist}</Text>
                      </View>
                    </TouchableOpacity>
                  ) : <View style={styles.careTeamPlaceholder} />}
                </View>
              </View>
            </>
          ) : <Text style={styles.detailText}>No BCBA or therapist assigned.</Text>}
          {selectedChild.notes ? (
            <>
              <Text style={styles.sectionTitle}>Notes</Text>
              <Text style={styles.detailText}>{selectedChild.notes}</Text>
            </>
          ) : null}
        </>
      );
    }
    if (activeTab === 'parents') {
      return (
        <>
          <Text style={styles.sectionTitle}>Parent contacts</Text>
          {linkedParents.length ? linkedParents.map((parent) => (
            <TouchableOpacity key={parent.id} style={[styles.personRow, styles.parentRow]} onPress={() => parent.id ? navigation.navigate('ParentDetail', { parentId: parent.id }) : null}>
              <Image source={avatarSourceFor(parent)} style={styles.smallAvatar} />
              <View style={styles.personTextWrap}>
                <Text style={styles.personName}>{parent.name || `${parent.firstName || ''} ${parent.lastName || ''}`.trim() || 'Parent/Guardian'}</Text>
                <Text style={styles.personMeta}>{maskPhoneDisplay(parent.phone) || parent.email || 'No contact info'}</Text>
              </View>
              <View style={styles.personActions}>
                {parent.phone ? <AppIconButton accessibilityLabel="Call parent" name="call" iconSize={16} size={34} style={styles.personActionButton} onPress={() => openPhone(parent.phone)} /> : null}
                {parent.email ? <AppIconButton accessibilityLabel="Email parent" name="email" iconSize={16} size={34} style={styles.personActionButton} onPress={() => openEmail(parent.email)} /> : null}
              </View>
            </TouchableOpacity>
          )) : <Text style={styles.detailText}>No linked parent contacts found.</Text>}
        </>
      );
    }
    if (activeTab === 'programs') {
      return (
        <>
          <Text style={styles.sectionTitle}>Clinical programs</Text>
          <Text style={styles.detailText}>{selectedChild.carePlan || 'No clinical programs have been attached yet.'}</Text>
        </>
      );
    }
    if (activeTab === 'bip') {
      return (
        <>
          <Text style={styles.sectionTitle}>Behavior intervention plan</Text>
          <Text style={styles.detailText}>{selectedChild.behaviorPlan || 'No BIP uploaded yet. Add one from the BCBA workflow.'}</Text>
        </>
      );
    }
    if (activeTab === 'iep') {
      return (
        <>
          <Text style={styles.sectionTitle}>IEP and goals</Text>
          <Text style={styles.detailText}>{selectedChild.goals || 'No goal set has been entered for this student yet.'}</Text>
        </>
      );
    }
    if (activeTab === 'attendance') {
      return (
        <>
          <Text style={styles.sectionTitle}>Attendance</Text>
          <Text style={styles.detailText}>Last 5 recorded attendance days for this student.</Text>
          <View style={styles.attendanceChartCard}>
            {attendanceHistoryLoading ? (
              <Text style={styles.detailText}>Loading attendance trend...</Text>
            ) : attendanceTrendItems.length ? (
              <>
                <View style={styles.attendanceChartRow}>
                  {attendanceTrendItems.map((item) => (
                    <View key={item.key} style={styles.attendanceChartItem}>
                      <View style={styles.attendanceChartTrack}>
                        <View style={[styles.attendanceChartBar, { height: `${Math.max(22, (item.value / 3) * 100)}%`, backgroundColor: item.color }]} />
                      </View>
                      <Text style={styles.attendanceChartDay}>{item.dayLabel}</Text>
                      <Text style={styles.attendanceChartDate}>{item.dateLabel}</Text>
                      <Text style={styles.attendanceChartStatus}>{item.statusLabel}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.attendanceLegendRow}>
                  <View style={styles.attendanceLegendItem}>
                    <View style={[styles.attendanceLegendDot, { backgroundColor: '#16a34a' }]} />
                    <Text style={styles.attendanceLegendText}>Present</Text>
                  </View>
                  <View style={styles.attendanceLegendItem}>
                    <View style={[styles.attendanceLegendDot, { backgroundColor: '#f59e0b' }]} />
                    <Text style={styles.attendanceLegendText}>Tardy</Text>
                  </View>
                  <View style={styles.attendanceLegendItem}>
                    <View style={[styles.attendanceLegendDot, { backgroundColor: '#dc2626' }]} />
                    <Text style={styles.attendanceLegendText}>Absent</Text>
                  </View>
                </View>
              </>
            ) : (
              <Text style={styles.detailText}>{attendanceHistoryError || 'No recent attendance data recorded yet.'}</Text>
            )}
          </View>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('Attendance')}>
            <Text style={styles.secondaryButtonText}>Open Attendance</Text>
          </TouchableOpacity>
        </>
      );
    }
    return (
      <>
        <Text style={styles.sectionTitle}>Documents</Text>
        <Text style={styles.detailText}>{isOffice ? 'Office can upload student records and supporting documentation here.' : 'BCBA can review office-uploaded documentation here.'}</Text>
      </>
    );
  }

  const mobileHeaderFilters = useMobileHeaderFilters ? (
    <View style={styles.mobileHeaderFilterRow}>
      <InlineFilterDropdown
        label="Room"
        value={roomDropdownValue}
        options={roomChoices}
        selectedValue={roomFilter}
        onSelect={setRoomFilter}
        width={92}
      />
      <InlineFilterDropdown
        label="Sort"
        value={sortDropdownValue}
        options={sortChoices}
        selectedValue={sortKey}
        onSelect={setSortKey}
        width={80}
      />
      <TextInput value={query} onChangeText={setQuery} placeholder="Search students" style={[styles.input, styles.mobileHeaderSearchInput]} />
    </View>
  ) : null;

  return (
    <ScreenWrapper style={styles.screen} mobileHeaderBelow={mobileHeaderFilters}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!useMobileHeaderFilters ? (
          <View style={styles.filtersCard}>
            <View style={styles.filtersRow}>
              <InlineFilterDropdown
                label="Room"
                value={roomDropdownValue}
                options={roomChoices}
                selectedValue={roomFilter}
                onSelect={setRoomFilter}
                width={92}
              />
              <InlineFilterDropdown
                label="Sort"
                value={sortDropdownValue}
                options={sortChoices}
                selectedValue={sortKey}
                onSelect={setSortKey}
                width={80}
              />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search students" style={[styles.input, styles.filtersSearchInput]} />
            </View>
          </View>
        ) : null}

        {useRosterCarousel ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rosterCarouselContent}
            style={styles.rosterCarousel}
          >
            {filteredChildren.map((child) => (
              (() => {
                const { firstName, lastName } = splitStudentName(child.name);
                return (
                  <TouchableOpacity
                    key={child.id}
                    style={[styles.rosterCarouselCard, child.id === selectedChildId ? styles.rosterRowActive : null]}
                    onPress={() => setSelectedChildId(child.id)}
                  >
                    <Image source={avatarSourceFor(child)} style={styles.rosterCarouselAvatar} />
                    <View style={styles.rosterCarouselTextWrap}>
                      <Text style={styles.rosterCarouselFirstName} numberOfLines={1}>{firstName}</Text>
                      <Text style={styles.rosterCarouselLastName} numberOfLines={1}>{lastName}</Text>
                      <ArrivalStatusBadge status={child?.arrivalStatus} compact />
                    </View>
                  </TouchableOpacity>
                );
              })()
            ))}
          </ScrollView>
        ) : null}

        <View style={[styles.layoutRow, useRosterCarousel ? styles.layoutRowCompact : null]}>
          {!useRosterCarousel ? (
            <View style={styles.rosterPanel}>
              {filteredChildren.map((child) => (
                <TouchableOpacity key={child.id} style={[styles.rosterRow, child.id === selectedChildId ? styles.rosterRowActive : null]} onPress={() => setSelectedChildId(child.id)}>
                  <Image source={avatarSourceFor(child)} style={styles.avatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rosterName}>{child.name}</Text>
                    <Text style={styles.rosterMeta}>Room {child.room || 'Unassigned'} • Age {child.age || 'N/A'}</Text>
                    <ArrivalStatusBadge status={child?.arrivalStatus} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <View style={[styles.detailPanel, useRosterCarousel ? styles.detailPanelFullWidth : null]}>
            {selectedChild ? (
              <>
                <View style={styles.profileHeader}>
                  <Image source={avatarSourceFor(selectedChild)} style={styles.profileAvatar} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.profileName}>{selectedChild.name}</Text>
                    <Text style={styles.profileMeta}>Room {selectedChild.room || 'Unassigned'} • {selectedChild.session || 'Session unassigned'}</Text>
                    <ArrivalStatusBadge status={selectedChild?.arrivalStatus} />
                  </View>
                  {isOffice ? (
                    <View style={styles.profileHeaderActions}>
                      <AppIconButton
                        accessibilityLabel={`Assign BCBA / ${THERAPY_ROLE_LABELS.therapist}`}
                        name="person-add-alt-1"
                        style={styles.profileHeaderIconButton}
                        onPress={() => navigation.navigate('ScheduleCalendar', { childId: selectedChild.id, editorMode: 'assignment' })}
                      />
                    </View>
                  ) : null}
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipCarouselContent}
                  style={styles.chipCarousel}
                >
                  {visibleTabs.map((tab) => <TabButton key={tab.key} label={tab.label} active={activeTab === tab.key} onPress={() => setActiveTab(tab.key)} />)}
                  <ActionChip label="Reports" icon="query-stats" onPress={() => navigation.navigate('Reports', { childId: selectedChild.id })} />
                  <ActionChip label="Insights" icon="insights" onPress={() => navigation.navigate('ChildProgressInsights', { childId: selectedChild.id })} />
                  {canOpenRelatedChats ? <ActionChip label="Related Chats" icon="forum" onPress={openRelatedChats} /> : null}
                </ScrollView>

                <View style={styles.tabContent}>{renderTabContent()}</View>

                {!isOffice ? (
                  <View style={styles.actionStrip}>
                    <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('ProgramDirectory', { studentId: selectedChild.id, focusMode: 'editor' })}>
                      <Text style={styles.primaryButtonText}>Add Program</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </>
            ) : <Text style={styles.empty}>No student selected.</Text>}
          </View>
        </View>
      </ScrollView>

      <Modal visible={enrollOpen} transparent animationType="fade" onRequestClose={() => !enrollSaving && setEnrollOpen(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}>
          <View style={styles.modalCard}>
            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Enroll Learner</Text>
            <Text style={styles.modalBody}>{enrollmentCodeLocked ? `This learner will be enrolled into ${currentCampus?.name || 'the current campus'} using the assigned campus enrollment code.` : 'Use the campus enrollment code plus the family’s matching guardian name so the learner can be claimed later during parent signup.'}</Text>

            <Text style={styles.fieldLabel}>Learner name</Text>
            <TextInput value={enrollDraft.name} onChangeText={(value) => updateEnrollDraft('name', value)} placeholder="Learner full name" style={styles.input} editable={!enrollSaving} />

            <Text style={styles.fieldLabel}>Guardians</Text>
            {(enrollDraft.guardians || []).map((guardian, index) => (
              <View key={guardian.id} style={styles.guardianCard}>
                <View style={styles.guardianCardHeader}>
                  <Text style={styles.guardianCardTitle}>Guardian {index + 1}</Text>
                  {(enrollDraft.guardians || []).length > 1 ? (
                    <TouchableOpacity onPress={() => removeGuardian(guardian.id)} disabled={enrollSaving} style={styles.guardianRemoveButton}>
                      <Text style={styles.guardianRemoveButtonText}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <Text style={styles.guardianLabel}>Relationship</Text>
                <AppDropdown
                  buttonStyle={styles.dropdownButton}
                  disabled={enrollSaving}
                  onSelect={(optionValue) => updateGuardian(guardian.id, 'relationship', optionValue)}
                  options={GUARDIAN_RELATIONSHIP_OPTIONS}
                  placeholder="Relationship"
                  selectedValue={guardian.relationship}
                  textStyle={styles.dropdownButtonText}
                  value={guardianRelationshipLabel(guardian.relationship)}
                />

                <Text style={styles.guardianLabel}>Full name</Text>
                <TextInput value={guardian.name} onChangeText={(value) => updateGuardian(guardian.id, 'name', value)} placeholder="Guardian full name" style={styles.input} editable={!enrollSaving} />

                <Text style={styles.guardianLabel}>Email</Text>
                <TextInput value={guardian.email} onChangeText={(value) => updateGuardian(guardian.id, 'email', value)} placeholder="Optional" style={styles.input} editable={!enrollSaving} autoCapitalize="none" keyboardType="email-address" />

                <Text style={styles.guardianLabel}>Phone</Text>
                <TextInput value={guardian.phone} onChangeText={(value) => updateGuardian(guardian.id, 'phone', value)} placeholder="Optional" style={styles.input} editable={!enrollSaving} keyboardType="phone-pad" />
              </View>
            ))}
            <TouchableOpacity style={styles.guardianAddButton} onPress={addGuardian} disabled={enrollSaving}>
              <Text style={styles.guardianAddButtonText}>Add Guardian</Text>
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Enrollment code</Text>
            <TextInput value={enrollDraft.enrollmentCode} onChangeText={(value) => updateEnrollDraft('enrollmentCode', String(value || '').toUpperCase())} placeholder="Campus enrollment code" style={[styles.input, enrollmentCodeLocked ? styles.inputLocked : null]} editable={!enrollSaving && !enrollmentCodeLocked} autoCapitalize="characters" autoCorrect={false} />

            <Text style={styles.fieldLabel}>Room</Text>
            <TextInput value={enrollDraft.room} onChangeText={(value) => updateEnrollDraft('room', value)} placeholder="Optional classroom or room" style={styles.input} editable={!enrollSaving} />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setEnrollOpen(false)} disabled={enrollSaving}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={submitEnrollment} disabled={enrollSaving}>
                <Text style={styles.primaryButtonText}>{enrollSaving ? 'Saving...' : 'Enroll Learner'}</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 8 },
  filtersCard: { marginTop: 14, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  filtersHeader: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12 },
  filtersActionButton: { borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 10, paddingHorizontal: 14 },
  filtersActionButtonText: { color: '#fff', fontWeight: '800' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff' },
  inputLocked: { backgroundColor: '#f1f5f9', color: '#475569' },
  filtersRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  mobileHeaderFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', flex: 1 },
  filtersSearchInput: { flex: 1, minWidth: 220 },
  mobileHeaderSearchInput: { flex: 1, minWidth: 0, alignSelf: 'stretch', height: 40, paddingVertical: 8, paddingHorizontal: 12 },
  headerAddButton: { marginLeft: 6 },
  chipCarousel: { marginTop: 12 },
  chipCarouselContent: { paddingRight: 8 },
  tabButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f1f5f9', marginRight: 8, marginBottom: 8 },
  tabButtonActive: { backgroundColor: '#2563eb' },
  tabButtonText: { color: '#0f172a', fontWeight: '700' },
  tabButtonTextActive: { color: '#ffffff' },
  actionChipButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#dbeafe', marginRight: 8, marginBottom: 8 },
  actionChipButtonText: { color: '#1d4ed8', fontWeight: '800' },
  inlineFilterWrap: { zIndex: 20 },
  inlineFilterButton: { borderRadius: 10, paddingHorizontal: 10 },
  inlineFilterValue: { flex: 0, color: '#0f172a', fontWeight: '600', fontSize: 14, marginRight: 4 },
  inlineFilterPlaceholder: { color: '#64748b', fontWeight: '500' },
  layoutRow: { marginTop: 14, flexDirection: 'row' },
  layoutRowCompact: { marginTop: 6 },
  rosterCarousel: { marginTop: 1 },
  rosterCarouselContent: { paddingRight: 4 },
  rosterCarouselCard: {
    width: 96,
    minHeight: 118,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 10,
    marginRight: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  rosterCarouselAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#e2e8f0', marginBottom: 10 },
  rosterCarouselTextWrap: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  rosterPanel: { width: '34%', borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 14, marginRight: 12 },
  detailPanel: { flex: 1, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  detailPanelFullWidth: { width: '100%' },
  rosterRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 10, marginBottom: 8, backgroundColor: '#f8fafc' },
  rosterRowActive: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#93c5fd' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e2e8f0', marginRight: 10 },
  rosterName: { fontWeight: '800', color: '#0f172a' },
  rosterMeta: { marginTop: 4, color: '#64748b', fontSize: 12 },
  rosterCarouselFirstName: { fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  rosterCarouselLastName: { marginTop: 2, color: '#64748b', fontSize: 12, fontWeight: '700', textAlign: 'center', minHeight: 16 },
  arrivalBadge: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  arrivalBadgeCompact: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  arrivalBadgeText: { fontSize: 11, fontWeight: '800' },
  arrivalBadgeTextCompact: { fontSize: 10 },
  personRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  parentRow: { justifyContent: 'space-between' },
  smallAvatar: { width: 46, height: 46, borderRadius: 20, backgroundColor: '#e2e8f0' },
  careTeamAvatar: { marginRight: 10 },
  personTextWrap: { flex: 1, marginLeft: 10 },
  careTeamTextWrap: { flex: 1, alignItems: 'flex-start', justifyContent: 'center' },
  personName: { fontWeight: '800', color: '#0f172a' },
  personMeta: { marginTop: 3, color: '#64748b', fontSize: 12 },
  careTeamPyramid: { marginTop: 8, alignItems: 'center' },
  careTeamBottomRow: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  careTeamCard: { borderRadius: 14, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f8fafc', paddingVertical: 8, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center' },
  careTeamCardTop: { width: '46%', justifyContent: 'flex-start' },
  careTeamCardBottom: { width: '48%', justifyContent: 'flex-start' },
  careTeamPlaceholder: { width: '48%' },
  personActions: { flexDirection: 'row', alignItems: 'center', marginLeft: 10 },
  personActionButton: { marginLeft: 6 },
  upcomingRow: { marginTop: 8 },
  upcomingTitle: { fontWeight: '800', color: '#0f172a' },
  upcomingMeta: { marginTop: 2, color: '#64748b' },
  profileHeader: { flexDirection: 'row', alignItems: 'center' },
  profileAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#e2e8f0' },
  profileHeaderActions: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
  profileHeaderIconButton: { marginLeft: 8 },
  profileName: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  profileMeta: { marginTop: 6, color: '#64748b' },
  tabContent: { marginTop: 8 },
  summaryCardsRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: 6, marginBottom: 2 },
  summaryCard: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff', paddingVertical: 10, paddingHorizontal: 12 },
  summaryCardLeft: { marginRight: 6 },
  summaryCardRight: { marginLeft: 6 },
  summaryCardFull: { marginTop: 12 },
  summaryCardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryCardTextWrap: { flex: 1, paddingRight: 8 },
  summaryCardLabel: { color: '#64748b', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryCardValue: { marginTop: 4, color: '#0f172a', fontSize: 18, fontWeight: '800' },
  summaryCardDetail: { marginTop: 4, color: '#475569', fontSize: 12, lineHeight: 16 },
  attendanceChartCard: { marginBottom: 10, borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff', padding: 14 },
  attendanceChartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  attendanceChartItem: { flex: 1, alignItems: 'center', marginHorizontal: 4 },
  attendanceChartTrack: { width: 26, height: 116, borderRadius: 999, backgroundColor: '#e2e8f0', justifyContent: 'flex-end', overflow: 'hidden' },
  attendanceChartBar: { width: '100%', borderRadius: 999 },
  attendanceChartDay: { marginTop: 10, color: '#0f172a', fontSize: 12, fontWeight: '800' },
  attendanceChartDate: { marginTop: 2, color: '#64748b', fontSize: 11 },
  attendanceChartStatus: { marginTop: 4, color: '#475569', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  attendanceLegendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 },
  attendanceLegendItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 8, marginTop: 4 },
  attendanceLegendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  attendanceLegendText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a', marginBottom: 8, marginTop: 8 },
  detailText: { color: '#475569', lineHeight: 20, marginBottom: 6 },
  actionStrip: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  primaryButton: { borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  secondaryButton: { borderRadius: 12, backgroundColor: '#e2e8f0', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  secondaryButtonText: { color: '#0f172a', fontWeight: '800' },
  empty: { color: '#64748b' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.42)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 520, borderRadius: 20, backgroundColor: '#ffffff', padding: 20 },
  modalScroll: { width: '100%', maxHeight: 620 },
  modalScrollContent: { paddingBottom: 6 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  modalBody: { marginTop: 8, color: '#475569', lineHeight: 20 },
  fieldLabel: { marginTop: 12, color: '#0f172a', fontWeight: '700' },
  guardianCard: { marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#f8fbff', padding: 12 },
  guardianCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  guardianCardTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  guardianRemoveButton: { paddingVertical: 4, paddingHorizontal: 8 },
  guardianRemoveButtonText: { color: '#b91c1c', fontWeight: '700' },
  guardianLabel: { marginTop: 10, marginBottom: 6, color: '#0f172a', fontWeight: '700' },
  guardianAddButton: { alignSelf: 'flex-start', marginTop: 12, borderRadius: 10, backgroundColor: '#dbeafe', paddingVertical: 10, paddingHorizontal: 12 },
  guardianAddButtonText: { color: '#1d4ed8', fontWeight: '800' },
  dropdownButton: { marginTop: 4 },
  dropdownButtonText: { color: '#0f172a', fontWeight: '600' },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 18 },
});
