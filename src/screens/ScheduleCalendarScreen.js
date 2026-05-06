import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import AppDropdown from '../components/AppDropdown';
import AppIconButton from '../components/AppIconButton';
import TimeField from '../components/TimeField';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import Api from '../Api';
import { USER_ROLES, isBcbaRole, isOfficeAdminRole, normalizeUserRole } from '../core/tenant/models';
import { THERAPY_ROLE_LABELS } from '../utils/roleTerminology';
import { childHasParent, findLinkedParentId } from '../utils/directoryLinking';
const { isChildLinkedToTherapist } = require('../features/sessionTracking/utils/dashboardSessionTarget');

function todayStamp(hours = 9, minutes = 0) {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function sameDay(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function buildCalendarDays(selectedDate) {
  const baseDate = selectedDate instanceof Date && Number.isFinite(selectedDate.getTime()) ? selectedDate : new Date();
  const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1, 12, 0, 0, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const next = new Date(gridStart);
    next.setDate(gridStart.getDate() + index);
    return next;
  });
}

function buildSessionCards(children) {
  return (Array.isArray(children) ? children : [])
    .filter((child) => child?.id)
    .map((child) => {
      const start = child?.dropoffTimeISO ? new Date(child.dropoffTimeISO) : todayStamp(9, 0);
      const end = child?.pickupTimeISO ? new Date(child.pickupTimeISO) : todayStamp(10, 0);
      const sessionLabel = String(child?.session || (start.getHours() >= 12 ? 'PM' : 'AM')).toUpperCase() === 'PM' ? 'PM' : 'AM';
      const sessionStaff = sessionLabel === 'PM' ? child?.pmTherapist : child?.amTherapist;
      const fallbackStaff = Array.isArray(child?.assignedABA) && child.assignedABA.length
        ? child.assignedABA[0]
        : Array.isArray(child?.assigned_ABA) && child.assigned_ABA.length
          ? child.assigned_ABA[0]
          : child?.bcaTherapist;
      const resolvedStaff = sessionStaff || fallbackStaff;
      const staffLabel = typeof resolvedStaff === 'object'
        ? resolvedStaff?.name || resolvedStaff?.email || 'Unassigned'
        : String(resolvedStaff || 'Unassigned');
      return {
        id: child.id,
        student: child?.name || 'Learner',
        staff: staffLabel,
        location: String(child?.room || 'Room TBD'),
        start,
        end,
        status: String(child?.scheduleStatus || child?.status || 'scheduled').toLowerCase(),
      };
    })
    .filter((session) => session.start instanceof Date && Number.isFinite(session.start.getTime()) && session.end instanceof Date && Number.isFinite(session.end.getTime()))
    .sort((left, right) => left.start.getTime() - right.start.getTime());
}

export default function ScheduleCalendarScreen() {
  const { user } = useAuth();
  const { children = [], parents = [], therapists = [], setChildren, fetchAndSync } = useData();
  const { width } = useWindowDimensions();
  const route = useRoute();

  useFocusEffect(
    React.useCallback(() => {
      fetchAndSync?.({ force: true }).catch(() => {});
    }, [fetchAndSync])
  );
  const role = normalizeUserRole(user?.role);
  const isBcba = isBcbaRole(user?.role);
  const isTherapist = role === USER_ROLES.THERAPIST;
  const isParent = role === USER_ROLES.PARENT;
  const isOffice = isOfficeAdminRole(user?.role);
  const canManageSchedule = isBcba || isOffice;
  const requestedChildId = route?.params?.childId ? String(route.params.childId) : '';
  const requestedEditorMode = route?.params?.editorMode === 'assignment' || route?.params?.editorMode === 'session'
    ? route.params.editorMode
    : '';
  const [viewMode, setViewMode] = useState('day');
  const [focusMode, setFocusMode] = useState('staff');
  const [editorMode, setEditorMode] = useState('');
  const [selectedChildId, setSelectedChildId] = useState('');
  const [draftSession, setDraftSession] = useState('AM');
  const [draftRoom, setDraftRoom] = useState('');
  const [draftStart, setDraftStart] = useState('09:00');
  const [draftEnd, setDraftEnd] = useState('10:00');
  const [draftAssignedStaffId, setDraftAssignedStaffId] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayStamp(9, 0));
  const [mobileFilterCarouselLocked, setMobileFilterCarouselLocked] = useState(false);
  const linkedParentId = isParent ? (findLinkedParentId(user, parents) || user?.id || null) : null;
  const isWideLayout = width >= 980;

  const filteredChildren = useMemo(() => {
    if (!isTherapist) return children;
    const therapistId = user?.id;
    const normalizedName = String(user?.name || user?.displayName || user?.email || '').trim().toLowerCase();
    return (children || []).filter((child) => {
      if (isChildLinkedToTherapist(child, therapistId)) return true;
      const assignments = [child?.amTherapist, child?.pmTherapist, child?.bcaTherapist]
        .map((entry) => (typeof entry === 'string' ? entry : entry?.name || entry?.email || ''))
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
      return normalizedName ? assignments.includes(normalizedName) : false;
    });
  }, [children, isTherapist, user?.displayName, user?.email, user?.id, user?.name]);

  const parentChildren = useMemo(() => {
    if (!isParent) return [];
    if (!linkedParentId) return [];
    return (Array.isArray(children) ? children : []).filter((child) => childHasParent(child, linkedParentId));
  }, [children, isParent, linkedParentId]);

  const visibleChildren = isParent ? parentChildren : filteredChildren;

  const sessions = useMemo(() => buildSessionCards(visibleChildren), [visibleChildren]);
  const visibleSessions = useMemo(() => sessions.filter((session) => sameDay(session.start, selectedDate)), [selectedDate, sessions]);
  const selectedChild = useMemo(() => (visibleChildren || []).find((child) => child?.id === selectedChildId) || visibleChildren[0] || null, [selectedChildId, visibleChildren]);
  const selectedChildApproval = useMemo(() => {
    return selectedChild?.scheduleApproval && typeof selectedChild.scheduleApproval === 'object' ? selectedChild.scheduleApproval : null;
  }, [selectedChild]);
  const abaTechOptions = useMemo(() => (therapists || []).filter((staff) => {
    const normalizedRole = String(staff?.role || '').toLowerCase();
    return staff?.id && !normalizedRole.includes('admin') && !normalizedRole.includes('bcba');
  }), [therapists]);
  const grouped = useMemo(() => {
    const groups = new Map();
    visibleSessions.forEach((session) => {
      const key = isTherapist
        ? viewMode.toUpperCase()
        : (isParent ? 'Upcoming sessions' : (focusMode === 'student' ? session.student : focusMode === 'room' ? session.location : session.staff));
      const next = groups.get(key) || [];
      next.push(session);
      groups.set(key, next);
    });
    return Array.from(groups.entries()).map(([key, value]) => ({ key, value }));
  }, [focusMode, isParent, isTherapist, viewMode, visibleSessions]);

  const calendarDays = useMemo(() => buildCalendarDays(selectedDate), [selectedDate]);
  const monthLabel = useMemo(() => selectedDate.toLocaleDateString([], { month: 'long', year: 'numeric' }), [selectedDate]);

  useEffect(() => {
    if (!selectedChildId && visibleChildren[0]?.id) {
      setSelectedChildId(visibleChildren[0].id);
    }
    if (selectedChildId && !visibleChildren.some((child) => child?.id === selectedChildId)) {
      setSelectedChildId(visibleChildren[0]?.id || '');
    }
  }, [selectedChildId, visibleChildren]);

  useEffect(() => {
    if (!requestedChildId) return;
    if (!visibleChildren.some((child) => child?.id === requestedChildId)) return;
    setSelectedChildId(requestedChildId);
  }, [requestedChildId, visibleChildren]);

  useEffect(() => {
    if (!requestedEditorMode || !canManageSchedule || isParent || isTherapist) return;
    setEditorMode(requestedEditorMode);
  }, [canManageSchedule, isParent, isTherapist, requestedEditorMode]);

  useEffect(() => {
    if (!selectedChild) return;
    const startDate = selectedChild?.dropoffTimeISO ? new Date(selectedChild.dropoffTimeISO) : todayStamp(9, 0);
    const endDate = selectedChild?.pickupTimeISO ? new Date(selectedChild.pickupTimeISO) : todayStamp(10, 0);
    const assignedId = typeof selectedChild?.amTherapist === 'object' && draftSession === 'AM'
      ? selectedChild.amTherapist.id
      : typeof selectedChild?.pmTherapist === 'object' && draftSession === 'PM'
        ? selectedChild.pmTherapist.id
        : Array.isArray(selectedChild?.assignedABA) && selectedChild.assignedABA.length
          ? String(selectedChild.assignedABA[0])
          : '';
    setDraftSession(String(selectedChild?.session || 'AM').toUpperCase() === 'PM' ? 'PM' : 'AM');
    setDraftRoom(String(selectedChild?.room || ''));
    setDraftStart(`${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`);
    setDraftEnd(`${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`);
    setDraftAssignedStaffId(assignedId || '');
    setSelectedDate(startDate);
  }, [selectedChild]);

  function parseDraftTime(value, fallbackDate) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    const base = fallbackDate instanceof Date && Number.isFinite(fallbackDate.getTime()) ? new Date(fallbackDate) : new Date(selectedDate);
    if (!match) return base;
    const hours = Math.max(0, Math.min(23, Number(match[1])));
    const minutes = Math.max(0, Math.min(59, Number(match[2])));
    base.setHours(hours, minutes, 0, 0);
    return base;
  }

  function mergeChildUpdate(updatedChild, fallbackUpdater) {
    if (updatedChild) {
      setChildren((current) => (current || []).map((child) => (child?.id === updatedChild.id ? { ...child, ...updatedChild } : child)));
      return;
    }
    setChildren((current) => (current || []).map((child) => {
      if (child?.id !== selectedChild?.id) return child;
      return typeof fallbackUpdater === 'function' ? fallbackUpdater(child) : child;
    }));
  }

  function shiftCalendarMonth(delta) {
    setSelectedDate((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1, current.getHours(), current.getMinutes(), 0, 0));
  }

  async function saveSessionDraft() {
    if (!selectedChild?.id) {
      Alert.alert('Select a learner', 'Choose a learner before saving the session.');
      return;
    }
    const nextStart = parseDraftTime(draftStart, selectedDate);
    const nextEnd = parseDraftTime(draftEnd, selectedDate);
    const scheduleApproval = {
      status: 'pending',
      submittedAt: new Date().toISOString(),
      submittedById: String(user?.id || '').trim() || null,
      submittedByName: String(user?.name || user?.displayName || user?.email || '').trim() || 'Staff',
      approvedAt: null,
      approvedById: null,
      approvedByName: null,
    };
    setSaving(true);
    try {
      const result = await Api.updateChildSchedule(selectedChild.id, {
        session: draftSession,
        room: String(draftRoom || '').trim() || selectedChild?.room || 'Room TBD',
        dropoffTimeISO: nextStart.toISOString(),
        pickupTimeISO: nextEnd.toISOString(),
        scheduleApproval,
      });
      if (result?.item) {
        mergeChildUpdate(result.item);
      } else {
        await fetchAndSync?.({ force: true });
      }
      setEditorMode('');
      Alert.alert('Session saved', `${selectedChild?.name || 'Learner'} now has an updated ${draftSession} session pending office approval.`);
    } catch (error) {
      Alert.alert('Session not saved', String(error?.message || error || 'We could not save this session update.'));
    } finally {
      setSaving(false);
    }
  }

  async function saveAssignmentDraft() {
    if (!selectedChild?.id) {
      Alert.alert('Select a learner', 'Choose a learner before assigning an ABA tech.');
      return;
    }
    if (!draftAssignedStaffId) {
      Alert.alert('Select staff', 'Choose an ABA tech before saving the assignment.');
      return;
    }
    const assignedStaff = abaTechOptions.find((staff) => staff?.id === draftAssignedStaffId);
    if (!assignedStaff) {
      Alert.alert('Select staff', 'The selected ABA tech is no longer available.');
      return;
    }
    const existingAssigned = Array.isArray(selectedChild?.assignedABA) ? selectedChild.assignedABA : Array.isArray(selectedChild?.assigned_ABA) ? selectedChild.assigned_ABA : [];
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
    setSaving(true);
    try {
      const result = await Api.updateChildSchedule(selectedChild.id, {
        session: draftSession,
        assignedABA: assignedIds,
        assigned_ABA: assignedIds,
        amTherapist: draftSession === 'AM' ? assignedStaff : undefined,
        pmTherapist: draftSession === 'PM' ? assignedStaff : undefined,
        scheduleApproval,
      });
      if (result?.item) {
        mergeChildUpdate(result.item);
      } else {
        await fetchAndSync?.({ force: true });
      }
      setEditorMode('');
      Alert.alert('ABA tech assigned', `${assignedStaff.name || 'Selected staff'} was assigned to ${selectedChild?.name || 'the learner'} for the ${draftSession} session pending office approval.`);
    } catch (error) {
      Alert.alert('Assignment not saved', String(error?.message || error || 'We could not save this assignment.'));
    } finally {
      setSaving(false);
    }
  }

  async function approveScheduleChanges() {
    if (!selectedChild?.id) {
      Alert.alert('Select a learner', 'Choose a learner before approving schedule changes.');
      return;
    }
    setSaving(true);
    try {
      const currentApproval = selectedChildApproval && typeof selectedChildApproval === 'object' ? selectedChildApproval : {};
      const result = await Api.updateChildSchedule(selectedChild.id, {
        scheduleApproval: {
          ...currentApproval,
          status: 'approved',
          submittedAt: currentApproval.submittedAt || new Date().toISOString(),
          submittedById: currentApproval.submittedById || null,
          submittedByName: currentApproval.submittedByName || null,
          approvedAt: new Date().toISOString(),
          approvedById: String(user?.id || '').trim() || null,
          approvedByName: String(user?.name || user?.displayName || user?.email || '').trim() || 'Office',
        },
      });
      if (result?.item) {
        mergeChildUpdate(result.item);
      } else {
        await fetchAndSync?.({ force: true });
      }
      Alert.alert('Changes approved', `${selectedChild?.name || 'Learner'} schedule changes were approved.`);
    } catch (error) {
      Alert.alert('Approval failed', String(error?.message || error || 'We could not approve these schedule changes.'));
    } finally {
      setSaving(false);
    }
  }

  function openSessionEditor(session) {
    if (!session?.id) return;
    setSelectedChildId(session.id);
    if (session.start instanceof Date && Number.isFinite(session.start.getTime())) {
      setSelectedDate(session.start);
    }
    setEditorMode('session');
  }

  function action(title, message) {
    Alert.alert(title, message);
  }

  const focusModeOptions = useMemo(() => ([
    { value: 'staff', label: 'Staff view' },
    { value: 'student', label: 'Student view' },
    { value: 'room', label: 'Room view' },
  ]), []);
  const activeFocusModeLabel = focusModeOptions.find((option) => option.value === focusMode)?.label || 'Staff view';
  const headerFocusMode = !isTherapist && !isParent ? (
    <AppDropdown
      accessibilityLabel="Schedule focus mode"
      minMenuWidth={136}
      onOpenChange={setMobileFilterCarouselLocked}
      onSelect={setFocusMode}
      options={focusModeOptions}
      placeholder="View"
      selectedValue={focusMode}
      textStyle={styles.headerModeButtonText}
      value={activeFocusModeLabel}
      width={136}
    />
  ) : null;
  const headerActions = !isTherapist && !isParent ? (
    <View style={styles.headerActionRow}>
      {canManageSchedule ? (
        <TouchableOpacity
          accessibilityLabel="Assign ABA Tech"
          style={styles.headerAssignmentButton}
          onPress={() => setEditorMode('assignment')}
        >
          <MaterialIcons name="add" size={18} color="#1d4ed8" />
          <Text style={styles.headerAssignmentButtonText}>ABA</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        accessibilityLabel="Add session"
        style={styles.headerActionButton}
        onPress={() => setEditorMode('session')}
      >
        <MaterialIcons name="add" size={22} color="#ffffff" />
        <Text style={styles.headerActionButtonText}>Session</Text>
      </TouchableOpacity>
    </View>
  ) : null;
  const useMobileHeaderFilters = !isTherapist && !isParent && width < 900;
  const mobileHeaderFilters = useMobileHeaderFilters ? <View style={styles.mobileHeaderFilterRow}>{headerFocusMode}</View> : null;

  return (
    <ScreenWrapper
      style={styles.screen}
      bannerLeft={useMobileHeaderFilters ? null : headerFocusMode}
      bannerRight={headerActions}
      mobileHeaderBelow={mobileHeaderFilters}
      mobileHeaderBelowScrollEnabled={!mobileFilterCarouselLocked}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.scheduleWorkspace, isWideLayout ? styles.scheduleWorkspaceWide : null]}>
          <View style={[styles.calendarCard, isWideLayout ? styles.calendarCardWide : null]}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity style={styles.calendarNavButton} onPress={() => shiftCalendarMonth(-1)}>
                <MaterialIcons name="chevron-left" size={18} color="#0f172a" />
              </TouchableOpacity>
              <Text style={styles.calendarMonth}>{monthLabel}</Text>
              <TouchableOpacity style={styles.calendarNavButton} onPress={() => shiftCalendarMonth(1)}>
                <MaterialIcons name="chevron-right" size={18} color="#0f172a" />
              </TouchableOpacity>
            </View>
            <View style={styles.calendarWeekHeader}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <Text key={`${label}-${index}`} style={styles.calendarWeekday}>{label}</Text>)}
            </View>
            <View style={styles.calendarGrid}>
              {calendarDays.map((date) => {
                const inMonth = date.getMonth() === selectedDate.getMonth();
                const active = sameDay(date, selectedDate);
                const hasSessions = sessions.some((session) => sameDay(session.start, date));
                return (
                  <TouchableOpacity key={date.toISOString()} style={[styles.calendarDay, !inMonth ? styles.calendarDayMuted : null, active ? styles.calendarDayActive : null]} onPress={() => setSelectedDate(date)}>
                    <Text style={[styles.calendarDayText, active ? styles.calendarDayTextActive : null, !inMonth ? styles.calendarDayTextMuted : null]}>{date.getDate()}</Text>
                    {hasSessions ? <View style={[styles.calendarDot, active ? styles.calendarDotActive : null]} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.calendarFooter}>
              <Text style={styles.calendarFooterText}>{selectedDate.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
              <Text style={styles.calendarFooterText}>{visibleSessions.length} scheduled item{visibleSessions.length === 1 ? '' : 's'}</Text>
            </View>
          </View>

          <View style={[styles.sessionsPane, isWideLayout ? styles.sessionsPaneWide : null]}>
        {!isTherapist && !isParent && selectedChildApproval ? (
          <View style={styles.approvalCard}>
            <Text style={styles.groupTitle}>Schedule Approval</Text>
            <Text style={styles.groupSubtitle}>Status: {String(selectedChildApproval.status || 'pending').toUpperCase()}</Text>
            {selectedChildApproval.submittedByName ? <Text style={styles.approvalMeta}>Submitted by {selectedChildApproval.submittedByName}{selectedChildApproval.submittedAt ? ` on ${new Date(selectedChildApproval.submittedAt).toLocaleString()}` : ''}</Text> : null}
            {selectedChildApproval.approvedByName ? <Text style={styles.approvalMeta}>Approved by {selectedChildApproval.approvedByName}{selectedChildApproval.approvedAt ? ` on ${new Date(selectedChildApproval.approvedAt).toLocaleString()}` : ''}</Text> : null}
          </View>
        ) : null}

        {editorMode ? (
          <View style={styles.editorCard}>
            <Text style={styles.groupTitle}>{editorMode === 'session' ? 'Add Session' : 'Assign ABA Tech'}</Text>
            <Text style={styles.groupSubtitle}>{editorMode === 'session' ? 'Choose a learner, set the session window, and save it to the selected calendar date.' : 'Choose a learner and assign an ABA tech to the AM or PM session.'}</Text>

            <Text style={styles.fieldLabel}>Learner</Text>
            <View style={styles.chipRow}>
              {visibleChildren.map((child) => (
                <TouchableOpacity key={child.id} style={[styles.chip, selectedChildId === child.id ? styles.chipActive : null]} onPress={() => setSelectedChildId(child.id)}>
                  <Text style={[styles.chipText, selectedChildId === child.id ? styles.chipTextActive : null]}>{child.name || 'Learner'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Session</Text>
            <View style={styles.chipRow}>
              {['AM', 'PM'].map((sessionKey) => (
                <TouchableOpacity key={sessionKey} style={[styles.chip, draftSession === sessionKey ? styles.chipActive : null]} onPress={() => setDraftSession(sessionKey)}>
                  <Text style={[styles.chipText, draftSession === sessionKey ? styles.chipTextActive : null]}>{sessionKey}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {editorMode === 'session' ? (
              <>
                <View style={styles.fieldRow}>
                  <View style={styles.fieldHalf}>
                    <Text style={styles.fieldLabel}>Start time</Text>
                    <TimeField value={draftStart} onChangeText={setDraftStart} placeholder="09:00" inputStyle={styles.input} accessibilityLabel="Session start time" />
                  </View>
                  <View style={styles.fieldHalf}>
                    <Text style={styles.fieldLabel}>End time</Text>
                    <TimeField value={draftEnd} onChangeText={setDraftEnd} placeholder="10:00" inputStyle={styles.input} accessibilityLabel="Session end time" />
                  </View>
                </View>
                <Text style={styles.fieldLabel}>Room</Text>
                <TextInput value={draftRoom} onChangeText={setDraftRoom} placeholder="Room 4" style={styles.input} />
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>ABA Tech</Text>
                <View style={styles.chipRow}>
                  {abaTechOptions.map((staff) => (
                    <TouchableOpacity key={staff.id} style={[styles.chip, draftAssignedStaffId === staff.id ? styles.chipActive : null]} onPress={() => setDraftAssignedStaffId(staff.id)}>
                      <Text style={[styles.chipText, draftAssignedStaffId === staff.id ? styles.chipTextActive : null]}>{staff.name || staff.email || 'Staff'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.primaryButton, saving ? styles.buttonDisabled : null]} onPress={editorMode === 'session' ? saveSessionDraft : saveAssignmentDraft} disabled={saving}>
                <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : editorMode === 'session' ? 'Save Session' : 'Save Assignment'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryButton, saving ? styles.buttonDisabled : null]} onPress={() => setEditorMode('')} disabled={saving}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {grouped.map((group) => (
          <View key={group.key} style={styles.groupCard}>
            <Text style={styles.groupTitle}>{isTherapist ? 'Assigned sessions' : group.key}</Text>
            <Text style={styles.groupSubtitle}>{viewMode.toUpperCase()} view • {group.value.length} session{group.value.length === 1 ? '' : 's'}</Text>
            {group.value.map((session) => (
              <View key={session.id} style={styles.sessionCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sessionTitle}>{session.student}</Text>
                  <Text style={styles.sessionMeta}>{isParent ? `${THERAPY_ROLE_LABELS.therapist}: ${session.staff}` : `Staff: ${session.staff}`}</Text>
                  <Text style={styles.sessionMeta}>Location: {session.location}</Text>
                  <Text style={styles.sessionMeta}>Time: {session.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {session.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                </View>
                <View style={styles.sessionCardActions}>
                  {isOffice ? (
                    <AppIconButton
                      accessibilityLabel={`Edit session for ${session.student}`}
                      name="edit"
                      iconSize={18}
                      size={36}
                      style={styles.sessionIconButton}
                      onPress={() => openSessionEditor(session)}
                    />
                  ) : null}
                  <View style={[styles.statusPill, session.status === 'canceled' ? styles.statusCanceled : session.status === 'completed' ? styles.statusCompleted : styles.statusScheduled]}>
                    <Text style={[styles.statusText, session.status === 'canceled' ? styles.statusTextCanceled : session.status === 'completed' ? styles.statusTextCompleted : styles.statusTextScheduled]}>{session.status.toUpperCase()}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        ))}
        {!grouped.length ? <View style={styles.groupCard}><Text style={styles.groupTitle}>{isParent ? 'Family calendar' : 'Assigned sessions'}</Text><Text style={styles.groupSubtitle}>{visibleChildren.length ? `No sessions are scheduled for ${selectedDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}.` : isParent ? 'No upcoming sessions are linked to your family account right now.' : `No sessions are assigned to your ${THERAPY_ROLE_LABELS.therapist.toLowerCase()} profile right now.`}</Text></View> : null}
          </View>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  chip: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f1f5f9', marginRight: 8, marginBottom: 8 },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { color: '#0f172a', fontWeight: '700' },
  chipTextActive: { color: '#ffffff' },
  headerModeButtonText: { flex: 1, marginRight: 6, color: '#0f172a', fontWeight: '700' },
  mobileHeaderFilterRow: { flexDirection: 'row', alignItems: 'center' },
  headerActionRow: { flexDirection: 'row', alignItems: 'center' },
  headerAssignmentButton: { height: 40, borderRadius: 20, backgroundColor: '#eff6ff', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  headerAssignmentButtonText: { color: '#1d4ed8', fontWeight: '800', marginLeft: 6 },
  headerActionButton: { height: 40, borderRadius: 20, backgroundColor: '#2563eb', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  headerActionButtonText: { color: '#ffffff', fontWeight: '800', marginLeft: 6 },
  scheduleWorkspace: { marginTop: 12 },
  scheduleWorkspaceWide: { flexDirection: 'row', alignItems: 'flex-start' },
  calendarCard: { borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16, marginBottom: 12 },
  calendarCardWide: { width: 320, marginRight: 16, marginBottom: 0 },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarNavButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  calendarMonth: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  calendarWeekHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 },
  calendarWeekday: { flex: 1, textAlign: 'center', color: '#64748b', fontWeight: '700', fontSize: 12 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarDay: { width: '14.285%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 14, marginBottom: 4 },
  calendarDayMuted: { opacity: 0.45 },
  calendarDayActive: { backgroundColor: '#2563eb' },
  calendarDayText: { color: '#0f172a', fontWeight: '700' },
  calendarDayTextActive: { color: '#ffffff' },
  calendarDayTextMuted: { color: '#94a3b8' },
  calendarDot: { marginTop: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: '#2563eb' },
  calendarDotActive: { backgroundColor: '#ffffff' },
  calendarFooter: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  calendarFooterText: { color: '#475569', fontWeight: '700', marginBottom: 4 },
  sessionsPane: { flex: 1 },
  sessionsPaneWide: { flex: 1 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  actionRowCentered: { justifyContent: 'center' },
  primaryButton: { borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  buttonDisabled: { opacity: 0.65 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  secondaryButton: { borderRadius: 12, backgroundColor: '#e2e8f0', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  secondaryButtonDisabled: { opacity: 0.6 },
  secondaryButtonTextDisabled: { color: '#475569' },
  secondaryButtonText: { color: '#0f172a', fontWeight: '800' },
  groupCard: { marginTop: 12, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  editorCard: { marginTop: 12, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#bfdbfe', padding: 16 },
  approvalCard: { marginTop: 12, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#dbeafe', padding: 16 },
  groupTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  groupSubtitle: { marginTop: 4, color: '#64748b' },
  approvalMeta: { marginTop: 6, color: '#475569' },
  fieldLabel: { marginTop: 12, marginBottom: 8, color: '#0f172a', fontWeight: '700' },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between' },
  fieldHalf: { width: '48%' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', color: '#0f172a' },
  sessionCard: { marginTop: 12, borderRadius: 16, backgroundColor: '#f8fafc', padding: 14, flexDirection: 'row', alignItems: 'center' },
  sessionCardActions: { marginLeft: 12, alignItems: 'flex-end' },
  sessionIconButton: { marginBottom: 10 },
  sessionTitle: { fontWeight: '800', color: '#0f172a' },
  sessionMeta: { marginTop: 4, color: '#475569' },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statusScheduled: { backgroundColor: '#dbeafe' },
  statusCompleted: { backgroundColor: '#dcfce7' },
  statusCanceled: { backgroundColor: '#fee2e2' },
  statusText: { fontWeight: '800', fontSize: 11 },
  statusTextScheduled: { color: '#1d4ed8' },
  statusTextCompleted: { color: '#166534' },
  statusTextCanceled: { color: '#b91c1c' },
});
