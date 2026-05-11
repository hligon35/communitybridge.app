import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenWrapper } from '../components/ScreenWrapper';
import AppDropdown from '../components/AppDropdown';
import AppIconButton from '../components/AppIconButton';
import DateField from '../components/DateField';
import SessionSummarySnapshot from '../components/SessionSummarySnapshot';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { useTenant } from '../core/tenant/TenantContext';
import { isAdminRole, isBcbaRole, isOfficeAdminRole, normalizeUserRole, USER_ROLES } from '../core/tenant/models';
import { avatarSourceFor } from '../utils/idVisibility';
import { THERAPY_ROLE_LABELS, getDisplayRoleLabel } from '../utils/roleTerminology';
import { maskPhoneDisplay } from '../utils/inputFormat';
import { getPhoneAccessProfile, isPhoneViewport as resolvePhoneViewport } from '../utils/mobileRoleAccess';
import { buildVisibleThreads } from '../utils/chatThreads';
import useChildProgressInsights from '../features/sessionInsights/hooks/useChildProgressInsights';
import InsightStatCard from '../features/sessionInsights/components/InsightStatCard';
import TrendMiniChart from '../features/sessionInsights/components/TrendMiniChart';
import EmptyInsightsState from '../features/sessionInsights/components/EmptyInsightsState';
import LatestSummaryCard from '../features/sessionInsights/components/LatestSummaryCard';
import BehaviorTrendList from '../features/sessionInsights/components/BehaviorTrendList';
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

function getAttendanceStatusIcon(status) {
  const normalized = normalizeAttendanceStatus(status);
  if (normalized.key === 'present') return { ...normalized, icon: 'check-circle' };
  if (normalized.key === 'tardy') return { ...normalized, icon: 'check-circle' };
  if (normalized.key === 'absent') return { ...normalized, icon: 'cancel' };
  return { ...normalized, icon: 'help' };
}

function getDateTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getAttendanceTimestamp(item) {
  return getDateTimestamp(item?.recordedAt || item?.checkInAt || item?.dateKey || item?.recordedFor || item?.date || item?.createdAt || item?.updatedAt || '');
}

function getSummaryTimestamp(item) {
  return getDateTimestamp(item?.approvedAt || item?.updatedAt || item?.generatedAt || item?.createdAt || '');
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map((value) => Number(value));
  const parsed = new Date(year, Math.max(0, (month || 1) - 1), 1);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString([], { month: 'long', year: 'numeric' }) : 'Select month';
}

function buildMonthOptions(items = [], getTimestamp) {
  const seen = new Set();
  return [...items]
    .map((item) => getTimestamp(item))
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => right - left)
    .reduce((options, timestamp) => {
      const monthKey = getMonthKey(new Date(timestamp));
      if (seen.has(monthKey)) return options;
      seen.add(monthKey);
      options.push({ value: monthKey, label: formatMonthLabel(monthKey) });
      return options;
    }, []);
}

function startOfWeek(date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() - next.getDay());
  next.setHours(0, 0, 0, 0);
  return next;
}

function buildWeeklyAttendanceCards(items = [], monthKey) {
  const filtered = [...items]
    .map((item) => {
      const timestamp = getAttendanceTimestamp(item);
      if (!Number.isFinite(timestamp)) return null;
      const date = new Date(timestamp);
      if (getMonthKey(date) !== monthKey) return null;
      return { item, date, timestamp };
    })
    .filter(Boolean)
    .sort((left, right) => left.timestamp - right.timestamp);

  const weekMap = new Map();
  filtered.forEach(({ item, date, timestamp }) => {
    const weekStart = startOfWeek(date);
    const weekKey = weekStart.toISOString().slice(0, 10);
    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, { weekKey, weekStart, days: [] });
    }
    weekMap.get(weekKey).days.push({
      id: String(item?.id || `${weekKey}-${timestamp}`),
      date,
      status: getAttendanceStatusIcon(item?.status),
      note: String(item?.note || '').trim(),
      checkInAt: String(item?.checkInAt || '').trim(),
      checkOutAt: String(item?.checkOutAt || '').trim(),
    });
  });

  return Array.from(weekMap.values())
    .sort((left, right) => left.weekStart.getTime() - right.weekStart.getTime())
    .map((week) => ({
      ...week,
      title: `Week of ${week.weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
    }));
}

function formatAttendanceTimeRange(item) {
  const start = item?.checkInAt ? new Date(item.checkInAt) : null;
  const end = item?.checkOutAt ? new Date(item.checkOutAt) : null;
  if (start && Number.isFinite(start.getTime()) && end && Number.isFinite(end.getTime())) {
    return `${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (start && Number.isFinite(start.getTime())) return `Checked in ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return '';
}

function formatSessionStamp(item) {
  const timestamp = getSummaryTimestamp(item);
  if (!Number.isFinite(timestamp)) return 'Approved summary';
  return new Date(timestamp).toLocaleString();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildStudentMentionMatchers(child) {
  const fullName = String(child?.name || '').trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ');
  const tokens = [fullName, firstName, lastName]
    .map((value) => String(value || '').trim())
    .filter((value, index, array) => value && array.indexOf(value) === index);
  return tokens.map((token) => new RegExp(`\\b${escapeRegExp(token)}(?:'s)?\\b`, 'i'));
}

function messageRefersToStudent(message, child, matchers) {
  const childId = String(child?.id || '').trim();
  if (!message || !childId) return false;
  const directIds = [message?.childId, message?.studentId, message?.learnerId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (directIds.includes(childId)) return true;

  const haystack = [
    message?.subject,
    message?.title,
    message?.body,
    message?.note,
    message?.text,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');

  return matchers.some((matcher) => matcher.test(haystack));
}

function formatChatStamp(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return 'Recently updated';
  return new Date(timestamp).toLocaleString();
}

function resolveAssignedStaffId(child, sessionKey) {
  if (!child) return '';
  if (sessionKey === 'PM' && child?.pmTherapist) {
    return typeof child.pmTherapist === 'object' ? String(child.pmTherapist.id || '') : String(child.pmTherapist || '');
  }
  if (sessionKey === 'AM' && child?.amTherapist) {
    return typeof child.amTherapist === 'object' ? String(child.amTherapist.id || '') : String(child.amTherapist || '');
  }
  if (Array.isArray(child?.assignedABA) && child.assignedABA.length) return String(child.assignedABA[0] || '');
  if (Array.isArray(child?.assigned_ABA) && child.assigned_ABA.length) return String(child.assigned_ABA[0] || '');
  return '';
}

function toIsoDateString(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveChildScheduleDate(child) {
  const candidates = [child?.dropoffTimeISO, child?.pickupTimeISO, child?.date, child?.scheduledDate];
  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (Number.isFinite(parsed.getTime())) return toIsoDateString(parsed);
  }
  return '';
}

function resolveChildSessionKey(child) {
  return String(child?.session || '').trim().toUpperCase() === 'PM' ? 'PM' : 'AM';
}

function resolveAssignedStaffIdsForSession(child, sessionKey) {
  const ids = new Set();
  const preferred = sessionKey === 'PM' ? child?.pmTherapist : child?.amTherapist;
  const fallbackEntries = [
    ...(Array.isArray(child?.assignedABA) ? child.assignedABA : []),
    ...(Array.isArray(child?.assigned_ABA) ? child.assigned_ABA : []),
  ];
  [preferred, ...fallbackEntries].forEach((entry) => {
    const id = typeof entry === 'object' ? entry?.id : entry;
    const normalized = String(id || '').trim();
    if (normalized) ids.add(normalized);
  });
  return ids;
}

function TabButton({ label, active, onPress }) {
  return (
    <TouchableOpacity style={[styles.tabButton, active ? styles.tabButtonActive : null]} onPress={onPress}>
      <Text style={[styles.tabButtonText, active ? styles.tabButtonTextActive : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ActionChip({ label, icon, onPress, active = false }) {
  return (
    <TouchableOpacity style={[styles.actionChipButton, active ? styles.actionChipButtonActive : null]} onPress={onPress}>
      <MaterialIcons name={icon} size={16} color={active ? '#ffffff' : '#1d4ed8'} />
      <Text style={[styles.actionChipButtonText, active ? styles.actionChipButtonTextActive : null]}>{label}</Text>
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
  const { children = [], parents = [], therapists = [], urgentMemos = [], messages = [], fetchAndSync, activeSeedPreset = '', seededAttendanceHistoryByChild = {}, seededPickupQueueByChild = {}, seededSessionSummariesByChild = {} } = useData();
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
  const [assignAbaOpen, setAssignAbaOpen] = useState(false);
  const [assignAbaSaving, setAssignAbaSaving] = useState(false);
  const [assignAbaDate, setAssignAbaDate] = useState('');
  const [assignAbaSession, setAssignAbaSession] = useState('AM');
  const [assignAbaStaffId, setAssignAbaStaffId] = useState('');
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollSaving, setEnrollSaving] = useState(false);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [attendanceHistoryLoading, setAttendanceHistoryLoading] = useState(false);
  const [attendanceHistoryError, setAttendanceHistoryError] = useState('');
  const [selectedAttendanceMonth, setSelectedAttendanceMonth] = useState('');
  const [reportsItems, setReportsItems] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [selectedReportsMonth, setSelectedReportsMonth] = useState('');
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

  useEffect(() => {
    if (!selectedChild || assignAbaOpen) return;
    const nextSession = String(selectedChild?.session || 'AM').trim().toUpperCase() === 'PM' ? 'PM' : 'AM';
    const nextDate = resolveChildScheduleDate(selectedChild) || toIsoDateString(new Date());
    setAssignAbaDate(nextDate);
    setAssignAbaSession(nextSession);
    setAssignAbaStaffId(resolveAssignedStaffId(selectedChild, nextSession));
  }, [assignAbaOpen, selectedChild]);

  const selectedChild = useMemo(() => filteredChildren.find((child) => child?.id === selectedChildId) || null, [filteredChildren, selectedChildId]);
  const abaTechOptions = useMemo(() => (therapists || [])
    .filter((staff) => {
      const normalizedStaffRole = String(staff?.role || '').trim().toLowerCase();
      return staff?.id && !normalizedStaffRole.includes('admin') && !normalizedStaffRole.includes('bcba');
    })
    .map((staff) => ({ value: String(staff.id), label: staff.name || staff.displayName || staff.email || 'ABA Tech', staff })), [therapists]);
  const availableAssignAbaOptions = useMemo(() => {
    const selectedDate = String(assignAbaDate || '').trim();
    const selectedSession = String(assignAbaSession || 'AM').trim().toUpperCase() === 'PM' ? 'PM' : 'AM';
    if (!selectedDate) return abaTechOptions;

    const scheduledStaffIds = new Set();
    const blockedStaffIds = new Set();
    (Array.isArray(children) ? children : []).forEach((child) => {
      const childDate = resolveChildScheduleDate(child);
      if (!childDate || childDate !== selectedDate) return;

      resolveAssignedStaffIdsForSession(child, 'AM').forEach((id) => scheduledStaffIds.add(id));
      resolveAssignedStaffIdsForSession(child, 'PM').forEach((id) => scheduledStaffIds.add(id));

      if (resolveChildSessionKey(child) !== selectedSession) return;
      if (String(child?.id || '') === String(selectedChild?.id || '')) return;
      resolveAssignedStaffIdsForSession(child, selectedSession).forEach((id) => blockedStaffIds.add(id));
    });

    return abaTechOptions.filter((option) => {
      const optionId = String(option.value || '').trim();
      return scheduledStaffIds.has(optionId) && !blockedStaffIds.has(optionId);
    });
  }, [abaTechOptions, assignAbaDate, assignAbaSession, children, selectedChild]);
  const selectedAssignAbaStaff = useMemo(() => {
    return availableAssignAbaOptions.find((option) => option.value === assignAbaStaffId)?.staff
      || abaTechOptions.find((option) => option.value === assignAbaStaffId)?.staff
      || null;
  }, [abaTechOptions, assignAbaStaffId, availableAssignAbaOptions]);
  const sessionChoices = useMemo(() => ([
    { value: 'AM', label: 'AM' },
    { value: 'PM', label: 'PM' },
  ]), []);
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
  const attendanceMonthOptions = useMemo(() => buildMonthOptions(attendanceHistory, getAttendanceTimestamp), [attendanceHistory]);
  const weeklyAttendanceCards = useMemo(() => buildWeeklyAttendanceCards(attendanceHistory, selectedAttendanceMonth), [attendanceHistory, selectedAttendanceMonth]);
  const reportsMonthOptions = useMemo(() => buildMonthOptions(reportsItems, getSummaryTimestamp), [reportsItems]);
  const scopedReports = useMemo(() => {
    return [...reportsItems]
      .filter((item) => {
        const timestamp = getSummaryTimestamp(item);
        if (!Number.isFinite(timestamp)) return false;
        return getMonthKey(new Date(timestamp)) === selectedReportsMonth;
      })
      .sort((left, right) => getSummaryTimestamp(right) - getSummaryTimestamp(left));
  }, [reportsItems, selectedReportsMonth]);
  const relatedChatThreads = useMemo(() => {
    if (!selectedChild) return [];
    const matchers = buildStudentMentionMatchers(selectedChild);
    const visibleThreads = buildVisibleThreads(messages, {}, user, []);
    return visibleThreads
      .map((thread) => {
        const threadMessages = (Array.isArray(messages) ? messages : [])
          .filter((message) => String(message?.threadId || message?.id || '') === String(thread?.id || ''))
          .filter((message) => messageRefersToStudent(message, selectedChild, matchers))
          .sort((left, right) => new Date(left?.createdAt || 0) - new Date(right?.createdAt || 0));
        if (!threadMessages.length) return null;
        const lastMessage = threadMessages[threadMessages.length - 1] || thread?.last || null;
        return {
          ...thread,
          last: lastMessage,
          messages: threadMessages,
        };
      })
      .filter(Boolean)
      .sort((left, right) => new Date(right?.last?.createdAt || 0) - new Date(left?.last?.createdAt || 0));
  }, [messages, selectedChild, user]);
  const childInsights = useChildProgressInsights(selectedChild?.id || '', { limit: 20 });
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
    Api.getAttendanceHistory(selectedChild.id, 365)
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

  useEffect(() => {
    if (!attendanceMonthOptions.length) {
      setSelectedAttendanceMonth('');
      return;
    }
    if (attendanceMonthOptions.some((option) => option.value === selectedAttendanceMonth)) return;
    setSelectedAttendanceMonth(attendanceMonthOptions[0].value);
  }, [attendanceMonthOptions, selectedAttendanceMonth]);

  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'reports' || !selectedChild?.id) return () => {
      cancelled = true;
    };

    if (activeSeedPreset === 'screenshot') {
      const seededItems = Array.isArray(seededSessionSummariesByChild?.[selectedChild.id]) ? seededSessionSummariesByChild[selectedChild.id] : [];
      setReportsItems(seededItems.filter((item) => String(item?.status || '').trim().toLowerCase() === 'approved'));
      setReportsLoading(false);
      setReportsError('');
      return () => {
        cancelled = true;
      };
    }

    setReportsLoading(true);
    setReportsError('');
    Api.getChildSessionSummaries(selectedChild.id, 40)
      .then((result) => {
        if (cancelled) return;
        const approved = (Array.isArray(result?.items) ? result.items : []).filter((item) => String(item?.status || '').trim().toLowerCase() === 'approved');
        setReportsItems(approved);
      })
      .catch((error) => {
        if (cancelled) return;
        setReportsItems([]);
        setReportsError(String(error?.message || error || 'Could not load scoped reports.'));
      })
      .finally(() => {
        if (!cancelled) setReportsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSeedPreset, activeTab, seededSessionSummariesByChild, selectedChild?.id]);

  useEffect(() => {
    if (!reportsMonthOptions.length) {
      setSelectedReportsMonth('');
      return;
    }
    if (reportsMonthOptions.some((option) => option.value === selectedReportsMonth)) return;
    setSelectedReportsMonth(reportsMonthOptions[0].value);
  }, [reportsMonthOptions, selectedReportsMonth]);

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
    setActiveTab('relatedChats');
  }

  function openAssignAbaModal() {
    if (!selectedChild?.id) {
      Alert.alert('Select a student', 'Choose a student before assigning an ABA tech.');
      return;
    }
    const nextSession = String(selectedChild?.session || 'AM').trim().toUpperCase() === 'PM' ? 'PM' : 'AM';
    const nextDate = resolveChildScheduleDate(selectedChild) || toIsoDateString(new Date());
    setAssignAbaDate(nextDate);
    setAssignAbaSession(nextSession);
    setAssignAbaStaffId(resolveAssignedStaffId(selectedChild, nextSession));
    setAssignAbaOpen(true);
  }

  function closeAssignAbaModal() {
    if (assignAbaSaving) return;
    setAssignAbaOpen(false);
  }

  async function performAssignAbaSave() {
    if (!selectedChild?.id) return;
    const assignedStaff = availableAssignAbaOptions.find((option) => option.value === assignAbaStaffId)?.staff || null;
    if (!assignedStaff?.id) {
      Alert.alert('Select ABA tech', 'Choose an ABA tech before saving the assignment.');
      return;
    }
    const existingAssigned = Array.isArray(selectedChild?.assignedABA)
      ? selectedChild.assignedABA
      : Array.isArray(selectedChild?.assigned_ABA)
        ? selectedChild.assigned_ABA
        : [];
    const assignedIds = Array.from(new Set([...existingAssigned.map((item) => String(item)), String(assignedStaff.id)]));
    const scheduleApproval = {
      status: 'pending',
      submittedAt: new Date().toISOString(),
      submittedById: String(user?.id || '').trim() || null,
      submittedByName: String(user?.name || user?.displayName || user?.email || '').trim() || 'Staff',
      approvedAt: null,
      approvedById: null,
      approvedByName: null,
    };
    setAssignAbaSaving(true);
    try {
      await Api.updateChildSchedule(selectedChild.id, {
        session: assignAbaSession,
        assignedABA: assignedIds,
        assigned_ABA: assignedIds,
        amTherapist: assignAbaSession === 'AM' ? assignedStaff : undefined,
        pmTherapist: assignAbaSession === 'PM' ? assignedStaff : undefined,
        scheduleApproval,
      });
      await fetchAndSync?.({ force: true });
      setAssignAbaOpen(false);
      Alert.alert('ABA tech assigned', `${assignedStaff.name || 'Selected staff'} was assigned to ${selectedChild?.name || 'the student'} for the ${assignAbaSession} session pending office approval.`);
    } catch (error) {
      Alert.alert(error?.httpStatus === 409 ? 'Scheduling conflict' : 'Assignment not saved', String(error?.message || error || 'We could not save this assignment.'));
    } finally {
      setAssignAbaSaving(false);
    }
  }

  function confirmAssignAbaSave() {
    if (!selectedChild?.id) {
      Alert.alert('Select a student', 'Choose a student before assigning an ABA tech.');
      return;
    }
    if (!assignAbaStaffId) {
      Alert.alert('Select ABA tech', 'Choose an ABA tech before saving the assignment.');
      return;
    }
    const assignedStaff = availableAssignAbaOptions.find((option) => option.value === assignAbaStaffId)?.staff || null;
    if (!assignedStaff?.id) {
      Alert.alert('Select ABA tech', 'The selected ABA tech is no longer available.');
      return;
    }
    Alert.alert(
      'Confirm student schedule change',
      `Assign ${assignedStaff.name || 'this ABA tech'} to ${selectedChild?.name || 'this student'} for the ${assignAbaSession} session? This change will be saved as pending office approval.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: () => { void performAssignAbaSave(); } },
      ]
    );
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
          <Text style={styles.detailText}>Weekly attendance for the selected month.</Text>
          <View style={styles.sectionDropdownWrap}>
            <AppDropdown
              containerStyle={styles.sectionDropdownContainer}
              buttonStyle={styles.sectionDropdownButton}
              minMenuWidth={220}
              onSelect={setSelectedAttendanceMonth}
              options={attendanceMonthOptions}
              placeholder="Select month"
              selectedValue={selectedAttendanceMonth}
              textStyle={styles.sectionDropdownText}
              value={attendanceMonthOptions.find((option) => option.value === selectedAttendanceMonth)?.label || ''}
              width={220}
            />
          </View>
          <View style={styles.scopedCardsWrap}>
            {attendanceHistoryLoading ? (
              <View style={styles.attendanceChartCard}><Text style={styles.detailText}>Loading attendance history...</Text></View>
            ) : weeklyAttendanceCards.length ? (
              weeklyAttendanceCards.map((week) => (
                <View key={week.weekKey} style={styles.attendanceChartCard}>
                  <Text style={styles.weekCardTitle}>{week.title}</Text>
                  <View style={styles.attendanceIconRow}>
                    {week.days.map((item) => (
                      <View key={item.id} style={styles.attendanceIconItem}>
                        <MaterialIcons name={item.status.icon} size={28} color={item.status.color} />
                        <Text style={styles.attendanceChartDay}>{item.date.toLocaleDateString([], { weekday: 'short' })}</Text>
                        <Text style={styles.attendanceChartDate}>{item.date.toLocaleDateString([], { month: 'numeric', day: 'numeric' })}</Text>
                        <Text style={styles.attendanceChartStatus}>{item.status.label}</Text>
                        {formatAttendanceTimeRange(item) ? <Text style={styles.attendanceChartMeta}>{formatAttendanceTimeRange(item)}</Text> : null}
                        {item.note ? <Text style={styles.attendanceChartMeta}>{item.note}</Text> : null}
                      </View>
                    ))}
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.attendanceChartCard}>
                <Text style={styles.detailText}>{attendanceHistoryError || 'No attendance records were found for this month.'}</Text>
              </View>
            )}
          </View>
        </>
      );
    }
    if (activeTab === 'reports') {
      return (
        <>
          <Text style={styles.sectionTitle}>Reports</Text>
          <Text style={styles.detailText}>Approved session summaries for the selected month.</Text>
          <View style={styles.sectionDropdownWrap}>
            <AppDropdown
              containerStyle={styles.sectionDropdownContainer}
              buttonStyle={styles.sectionDropdownButton}
              minMenuWidth={220}
              onSelect={setSelectedReportsMonth}
              options={reportsMonthOptions}
              placeholder="Select month"
              selectedValue={selectedReportsMonth}
              textStyle={styles.sectionDropdownText}
              value={reportsMonthOptions.find((option) => option.value === selectedReportsMonth)?.label || ''}
              width={220}
            />
          </View>
          <View style={styles.scopedCardsWrap}>
            {reportsLoading ? (
              <View style={styles.attendanceChartCard}><Text style={styles.detailText}>Loading scoped reports...</Text></View>
            ) : scopedReports.length ? (
              scopedReports.map((item, index) => (
                <SessionSummarySnapshot
                  key={String(item?.sessionId || item?.id || `report-${index}`)}
                  summary={item}
                  title="Approved Session Summary"
                  subtitle={formatSessionStamp(item)}
                  emptyText="No approved session summary has been recorded yet."
                  metricsTwoByTwo
                />
              ))
            ) : (
              <View style={styles.attendanceChartCard}>
                <Text style={styles.detailText}>{reportsError || 'No approved session summaries were found for this month.'}</Text>
              </View>
            )}
          </View>
        </>
      );
    }
    if (activeTab === 'insights') {
      return (
        <>
          <View style={styles.insightsHero}>
            <Text style={styles.insightsEyebrow}>Progress Insights</Text>
            <Text style={styles.insightsTitle}>{selectedChild?.name || 'Student progress'}</Text>
            <Text style={styles.detailText}>Approved session summaries are translated into simple progress, behavior, and participation trends for families and care teams.</Text>
          </View>

          {childInsights.loading ? (
            <View style={styles.attendanceChartCard}>
              <Text style={styles.detailText}>Loading progress insights...</Text>
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
    }
    if (activeTab === 'relatedChats') {
      return (
        <>
          <Text style={styles.sectionTitle}>Related Chats</Text>
          <Text style={styles.detailText}>Read-only threads that mention or reference the selected student.</Text>
          <View style={styles.scopedCardsWrap}>
            {relatedChatThreads.length ? relatedChatThreads.map((thread) => (
              <View key={thread.id} style={styles.chatThreadCard}>
                <View style={styles.chatThreadHeader}>
                  <View style={styles.chatThreadHeaderText}>
                    <Text style={styles.chatThreadTitle}>{thread.title || 'Conversation'}</Text>
                    <Text style={styles.chatThreadMeta}>{formatChatStamp(thread.last?.createdAt)}</Text>
                  </View>
                  <View style={styles.chatThreadCountBadge}>
                    <Text style={styles.chatThreadCountText}>{thread.messages.length}</Text>
                  </View>
                </View>
                {thread.messages.map((message, index) => {
                  const isMine = String(message?.sender?.id || '') === String(user?.id || '');
                  return (
                    <View key={String(message?.id || `${thread.id}-${index}`)} style={[styles.chatBubbleRow, isMine ? styles.chatBubbleRowMine : null]}>
                      <View style={[styles.chatBubble, isMine ? styles.chatBubbleMine : styles.chatBubbleOther]}>
                        <Text style={styles.chatSender}>{message?.sender?.name || 'Unknown sender'}</Text>
                        <Text style={[styles.chatBody, isMine ? styles.chatBodyMine : null]}>{message?.body || message?.text || ''}</Text>
                        <Text style={styles.chatStamp}>{formatChatStamp(message?.createdAt)}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )) : (
              <View style={styles.attendanceChartCard}>
                <Text style={styles.detailText}>No visible chat threads currently reference this student.</Text>
              </View>
            )}
          </View>
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
                        onPress={openAssignAbaModal}
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
                  <ActionChip label="Reports" icon="query-stats" onPress={() => setActiveTab('reports')} active={activeTab === 'reports'} />
                  <ActionChip label="Insights" icon="insights" onPress={() => setActiveTab('insights')} active={activeTab === 'insights'} />
                  {canOpenRelatedChats ? <ActionChip label="Related Chats" icon="forum" onPress={openRelatedChats} active={activeTab === 'relatedChats'} /> : null}
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

      <Modal visible={assignAbaOpen} transparent animationType="fade" onRequestClose={closeAssignAbaModal}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Assign ABA Tech</Text>
            <Text style={styles.modalBody}>Update the student session and assign the ABA tech in one step. Saving will submit the schedule change for office approval.</Text>

            <Text style={styles.fieldLabel}>Date</Text>
            <DateField
              value={assignAbaDate}
              onChangeText={setAssignAbaDate}
              placeholder="Select date"
              style={styles.assignmentDateWrap}
              inputStyle={styles.input}
              accessibilityLabel="Assignment date"
            />

            <View style={styles.assignmentTopRow}>
              <View style={styles.assignmentStudentColumn}>
                <Text style={styles.fieldLabel}>Student</Text>
                <View style={styles.assignmentStudentPill}>
                  <Text style={styles.assignmentStudentPillText}>{selectedChild?.name || 'No student selected'}</Text>
                </View>
              </View>

              <View style={styles.assignmentSessionColumn}>
                <Text style={styles.fieldLabel}>Session</Text>
                <AppDropdown
                  buttonStyle={styles.dropdownButton}
                  containerStyle={styles.assignmentSessionDropdownWrap}
                  disabled={assignAbaSaving}
                  minMenuWidth={110}
                  onSelect={setAssignAbaSession}
                  options={sessionChoices}
                  placeholder="Session"
                  selectedValue={assignAbaSession}
                  textStyle={styles.dropdownButtonText}
                  value={assignAbaSession}
                  width={110}
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>ABA Tech</Text>
            <AppDropdown
              buttonStyle={styles.dropdownButton}
              disabled={assignAbaSaving}
              onSelect={setAssignAbaStaffId}
              options={availableAssignAbaOptions.map((option) => ({ value: option.value, label: option.label }))}
              placeholder="Select ABA tech"
              selectedValue={assignAbaStaffId}
              textStyle={styles.dropdownButtonText}
              value={selectedAssignAbaStaff?.name || selectedAssignAbaStaff?.displayName || selectedAssignAbaStaff?.email || ''}
            />
            {!availableAssignAbaOptions.length ? <Text style={styles.assignmentHelperText}>No ABA techs are scheduled for this date and still open for the selected session.</Text> : null}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={closeAssignAbaModal} disabled={assignAbaSaving}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButton, assignAbaSaving ? styles.buttonDisabled : null]} onPress={confirmAssignAbaSave} disabled={assignAbaSaving}>
                <Text style={styles.primaryButtonText}>{assignAbaSaving ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
  actionChipButtonActive: { backgroundColor: '#2563eb' },
  actionChipButtonTextActive: { color: '#ffffff' },
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
  insightsHero: { borderRadius: 22, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', padding: 18, marginBottom: 12 },
  insightsEyebrow: { color: '#1d4ed8', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' },
  insightsTitle: { marginTop: 6, fontSize: 24, fontWeight: '800', color: '#0f172a' },
  insightsStatsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 12 },
  sectionDropdownWrap: { alignItems: 'center', marginBottom: 12 },
  sectionDropdownContainer: { alignItems: 'center' },
  sectionDropdownButton: { backgroundColor: '#ffffff' },
  sectionDropdownText: { textAlign: 'center', fontWeight: '700' },
  scopedCardsWrap: { gap: 10 },
  attendanceChartCard: { marginBottom: 10, borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff', padding: 14 },
  weekCardTitle: { color: '#0f172a', fontSize: 15, fontWeight: '800', marginBottom: 12 },
  attendanceIconRow: { flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between' },
  attendanceIconItem: { flex: 1, alignItems: 'center', marginHorizontal: 4, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', paddingVertical: 12, paddingHorizontal: 6 },
  attendanceChartDay: { marginTop: 10, color: '#0f172a', fontSize: 12, fontWeight: '800' },
  attendanceChartDate: { marginTop: 2, color: '#64748b', fontSize: 11 },
  attendanceChartStatus: { marginTop: 4, color: '#475569', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  attendanceChartMeta: { marginTop: 4, color: '#64748b', fontSize: 10, textAlign: 'center' },
  chatThreadCard: { borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff', padding: 14 },
  chatThreadHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  chatThreadHeaderText: { flex: 1, paddingRight: 10 },
  chatThreadTitle: { color: '#0f172a', fontWeight: '800', fontSize: 15 },
  chatThreadMeta: { marginTop: 4, color: '#64748b', fontSize: 12 },
  chatThreadCountBadge: { minWidth: 32, height: 32, borderRadius: 16, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  chatThreadCountText: { color: '#1d4ed8', fontWeight: '800' },
  chatBubbleRow: { flexDirection: 'row', justifyContent: 'flex-start', marginTop: 8 },
  chatBubbleRowMine: { justifyContent: 'flex-end' },
  chatBubble: { maxWidth: '82%', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  chatBubbleOther: { backgroundColor: '#f3f4f6' },
  chatBubbleMine: { backgroundColor: '#dbeafe' },
  chatSender: { color: '#475569', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  chatBody: { color: '#111827', lineHeight: 20 },
  chatBodyMine: { color: '#0f172a' },
  chatStamp: { marginTop: 6, color: '#64748b', fontSize: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a', marginBottom: 8, marginTop: 8 },
  detailText: { color: '#475569', lineHeight: 20, marginBottom: 6 },
  actionStrip: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  primaryButton: { borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  secondaryButton: { borderRadius: 12, backgroundColor: '#e2e8f0', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  secondaryButtonText: { color: '#0f172a', fontWeight: '800' },
  buttonDisabled: { opacity: 0.6 },
  empty: { color: '#64748b' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.42)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 520, borderRadius: 20, backgroundColor: '#ffffff', padding: 20 },
  modalScroll: { width: '100%', maxHeight: 620 },
  modalScrollContent: { paddingBottom: 6 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  modalBody: { marginTop: 8, color: '#475569', lineHeight: 20 },
  fieldLabel: { marginTop: 12, color: '#0f172a', fontWeight: '700' },
  assignmentDateWrap: { marginTop: 8 },
  assignmentTopRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 },
  assignmentStudentColumn: { flex: 1, marginRight: 12 },
  assignmentSessionColumn: { width: 110 },
  assignmentSessionDropdownWrap: { width: 110 },
  assignmentStudentPill: { marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#eff6ff', paddingVertical: 12, paddingHorizontal: 14 },
  assignmentStudentPillText: { color: '#1e3a8a', fontWeight: '800' },
  assignmentHelperText: { marginTop: 8, color: '#b45309', lineHeight: 18 },
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
