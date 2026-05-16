import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { isBcbaRole, normalizeUserRole, USER_ROLES } from '../core/tenant/models';
import { getDisplayRoleLabel } from '../utils/roleTerminology';

const { isChildLinkedToTherapist } = require('../features/sessionTracking/utils/dashboardSessionTarget');

function getPreferredUserName(user) {
  const firstName = String(user?.firstName || '').trim();
  if (firstName) return firstName;
  const fullName = String(user?.name || user?.displayName || '').trim();
  if (fullName) return fullName.split(/\s+/).filter(Boolean)[0] || 'User';
  const email = String(user?.email || '').trim();
  if (email) return email.split('@')[0] || 'User';
  return 'User';
}

function formatShiftDay(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return 'No upcoming shift scheduled';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return value.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatShiftTimeRange(startAt, endAt) {
  if (!(startAt instanceof Date) || !Number.isFinite(startAt.getTime())) return '';
  const startLabel = startAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (!(endAt instanceof Date) || !Number.isFinite(endAt.getTime())) return startLabel;
  const endLabel = endAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${startLabel} - ${endLabel}`;
}

function buildUpcomingOccurrence(timeValue, now = new Date()) {
  const parsed = timeValue ? new Date(timeValue) : null;
  if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) return null;
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parsed.getHours(), parsed.getMinutes(), 0, 0);
  if (candidate.getTime() >= now.getTime()) return candidate;
  const tomorrow = new Date(candidate);
  tomorrow.setDate(candidate.getDate() + 1);
  return tomorrow;
}

function resolveCurrentUserShiftFromProfile(user) {
  const startValue = user?.nextShiftStart || user?.nextShiftStartAt || user?.shiftStart || user?.shiftStartAt || user?.shiftStartISO || '';
  const endValue = user?.nextShiftEnd || user?.nextShiftEndAt || user?.shiftEnd || user?.shiftEndAt || user?.shiftEndISO || '';
  const startAt = startValue ? new Date(startValue) : null;
  const endAt = endValue ? new Date(endValue) : null;
  if (!(startAt instanceof Date) || !Number.isFinite(startAt.getTime())) return null;
  return {
    dayLabel: formatShiftDay(startAt),
    timeLabel: formatShiftTimeRange(startAt, endAt),
    hint: 'Based on your current account schedule.',
  };
}

function isChildAssignedToPhoneStaffSchedule(child, user, isBcba) {
  const userId = String(user?.id || '').trim();
  const normalizedName = String(user?.name || user?.displayName || user?.email || '').trim().toLowerCase();
  const entries = [
    child?.amTherapist,
    child?.pmTherapist,
    child?.bcaTherapist,
    ...(Array.isArray(child?.assignedABA) ? child.assignedABA : []),
    ...(Array.isArray(child?.assigned_ABA) ? child.assigned_ABA : []),
  ];

  if (!isBcba && isChildLinkedToTherapist(child, userId)) return true;

  return entries.some((entry) => {
    if (!entry) return false;
    if (typeof entry === 'string') {
      const value = String(entry).trim();
      return value === userId || (normalizedName && value.toLowerCase() === normalizedName);
    }
    if (entry?.id && String(entry.id).trim() === userId) return true;
    const value = String(entry?.name || entry?.email || '').trim().toLowerCase();
    return Boolean(normalizedName && value && value === normalizedName);
  });
}

function resolveChildAssignedShift(role, user, children) {
  const normalizedRole = normalizeUserRole(role);
  const isTherapist = normalizedRole === USER_ROLES.THERAPIST;
  const isBcba = isBcbaRole(normalizedRole);
  if (!isTherapist && !isBcba) return null;

  const now = new Date();
  const candidates = (Array.isArray(children) ? children : [])
    .filter((child) => child?.id)
    .filter((child) => isChildAssignedToPhoneStaffSchedule(child, user, isBcba))
    .map((child) => {
      const startAt = buildUpcomingOccurrence(child?.dropoffTimeISO, now);
      if (!(startAt instanceof Date) || !Number.isFinite(startAt.getTime())) return null;
      let endAt = buildUpcomingOccurrence(child?.pickupTimeISO, now);
      if (!(endAt instanceof Date) || !Number.isFinite(endAt?.getTime?.())) {
        endAt = new Date(startAt.getTime() + (60 * 60 * 1000));
      }
      if (endAt.getTime() <= startAt.getTime()) {
        endAt = new Date(startAt.getTime() + (60 * 60 * 1000));
      }
      const sessionLabel = String(child?.session || (startAt.getHours() >= 12 ? 'PM' : 'AM')).trim().toUpperCase() === 'PM' ? 'PM shift' : 'AM shift';
      return {
        startAt,
        endAt,
        sessionLabel,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());

  const nextShift = candidates[0] || null;
  if (!nextShift) return null;
  return {
    dayLabel: formatShiftDay(nextShift.startAt),
    timeLabel: `${formatShiftTimeRange(nextShift.startAt, nextShift.endAt)}${nextShift.sessionLabel ? ` · ${nextShift.sessionLabel}` : ''}`,
  };
}

export default function MobileRoleWelcomeShiftCard({ user, role, children = [] }) {
  const welcomeName = useMemo(() => getPreferredUserName(user), [user]);
  const roleLabel = useMemo(() => getDisplayRoleLabel(role) || 'User', [role]);
  const nextShift = useMemo(() => {
    return resolveCurrentUserShiftFromProfile(user) || resolveChildAssignedShift(role, user, children) || null;
  }, [children, role, user]);

  return (
    <View style={styles.wrap}>
      <View style={styles.heroCard}>
        <Text style={styles.welcomeText}>{`Welcome, ${welcomeName}.`}</Text>
        <Text style={styles.roleText}>{roleLabel}</Text>
      </View>

      <View style={styles.shiftCard}>
        <Text style={styles.sectionTitle}>Next Scheduled Shift</Text>
        {nextShift ? (
          <>
            <Text style={styles.shiftDay}>{nextShift.dayLabel}</Text>
            <Text style={styles.shiftTime}>{nextShift.timeLabel}</Text>
          </>
        ) : (
          <>
            <Text style={styles.shiftDay}>No upcoming shift scheduled</Text>
            <Text style={styles.shiftHint}>When a personal shift is available for this account, it will appear here.</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: 16,
  },
  heroCard: {
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 20,
    backgroundColor: '#0f172a',
  },
  welcomeText: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },
  roleText: {
    marginTop: 8,
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  shiftCard: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  sectionTitle: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  shiftDay: {
    marginTop: 10,
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '800',
  },
  shiftTime: {
    marginTop: 6,
    color: '#1d4ed8',
    fontSize: 16,
    fontWeight: '700',
  },
  shiftHint: {
    marginTop: 10,
    color: '#64748b',
    fontSize: 14,
    lineHeight: 20,
  },
});