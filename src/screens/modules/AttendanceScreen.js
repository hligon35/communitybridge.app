import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { useAuth } from '../../AuthContext';
import * as Api from '../../Api';
import { useTenant } from '../../core/tenant/TenantContext';
import { useData } from '../../DataContext';
import { isAdminRole, isStaffRole } from '../../core/tenant/models';
import { logPress } from '../../utils/logger';
import moduleStyles from './ModuleStyles';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AttendanceScreen() {
  const tenant = useTenant() || {};
  const { user } = useAuth();
  const { children = [], activeSeedPreset = '', seededAttendanceByDate = {}, seededAttendanceHistoryByChild = {} } = useData() || {};
  const { labels = {}, currentProgram, currentCampus, featureFlags = {} } = tenant;
  const enabled = featureFlags.attendanceModule !== false;

  const [marks, setMarks] = useState({});
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [historyItems, setHistoryItems] = useState([]);
  const [loadingToday, setLoadingToday] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dateKey = todayKey();
  const canWrite = isAdminRole(user?.role) || isStaffRole(user?.role);
  const isSeededDemo = activeSeedPreset === 'screenshot';
  const effectiveDateKey = useMemo(() => {
    if (!isSeededDemo) return dateKey;
    const seededKeys = Object.keys(seededAttendanceByDate || {}).sort();
    if (!seededKeys.length) return dateKey;
    return Array.isArray(seededAttendanceByDate?.[dateKey]) && seededAttendanceByDate[dateKey].length
      ? dateKey
      : seededKeys[seededKeys.length - 1];
  }, [dateKey, isSeededDemo, seededAttendanceByDate]);

  const roster = useMemo(() => {
    if (!Array.isArray(children)) return [];
    return children.filter((child) => {
      if (currentProgram?.id && child?.programId && child.programId !== currentProgram.id) return false;
      if (currentCampus?.id && child?.campusId && child.campusId !== currentCampus.id) return false;
      return true;
    });
  }, [children, currentCampus?.id, currentProgram?.id]);

  useEffect(() => {
    if (!roster.length) {
      setSelectedChildId(null);
      return;
    }
    const stillExists = roster.some((child) => child?.id === selectedChildId);
    if (!stillExists) setSelectedChildId(roster[0]?.id || null);
  }, [roster, selectedChildId]);

  useEffect(() => {
    if (!enabled) return undefined;
    let mounted = true;
    if (isSeededDemo) {
      const nextMarks = {};
      (Array.isArray(seededAttendanceByDate?.[effectiveDateKey]) ? seededAttendanceByDate[effectiveDateKey] : []).forEach((entry) => {
        if (entry?.childId && entry?.status) nextMarks[entry.childId] = entry.status;
      });
      setMarks(nextMarks);
      setError('');
      setLoadingToday(false);
      return () => { mounted = false; };
    }
    (async () => {
      setLoadingToday(true);
      setError('');
      try {
        const result = await Api.getAttendanceForDate(dateKey);
        if (!mounted) return;
        const nextMarks = {};
        (Array.isArray(result?.items) ? result.items : []).forEach((entry) => {
          if (entry?.childId && entry?.status) nextMarks[entry.childId] = entry.status;
        });
        setMarks(nextMarks);
      } catch (e) {
        if (mounted) setError(String(e?.message || e || 'Could not load attendance.'));
      } finally {
        if (mounted) setLoadingToday(false);
      }
    })();
    return () => { mounted = false; };
  }, [dateKey, effectiveDateKey, enabled, isSeededDemo, seededAttendanceByDate]);

  useEffect(() => {
    if (!enabled || !selectedChildId) {
      setHistoryItems([]);
      return undefined;
    }
    let mounted = true;
    if (isSeededDemo) {
      setHistoryItems(Array.isArray(seededAttendanceHistoryByChild?.[selectedChildId]) ? seededAttendanceHistoryByChild[selectedChildId] : []);
      setHistoryLoading(false);
      return () => { mounted = false; };
    }
    (async () => {
      setHistoryLoading(true);
      try {
        const result = await Api.getAttendanceHistory(selectedChildId, 365);
        if (mounted) setHistoryItems(Array.isArray(result?.items) ? result.items : []);
      } catch (e) {
        if (mounted) setHistoryItems([]);
      } finally {
        if (mounted) setHistoryLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [enabled, isSeededDemo, seededAttendanceHistoryByChild, selectedChildId]);

  function setMark(childId, status) {
    logPress('Attendance:Mark', { childId, status });
    setMarks((prev) => ({ ...prev, [childId]: status }));
    setSelectedChildId(childId);
  }

  const counts = useMemo(() => {
    const out = { present: 0, absent: 0, tardy: 0, unmarked: 0 };
    roster.forEach((c) => {
      const m = marks[c.id];
      if (m === 'present') out.present += 1;
      else if (m === 'absent') out.absent += 1;
      else if (m === 'tardy') out.tardy += 1;
      else out.unmarked += 1;
    });
    return out;
  }, [roster, marks]);

  async function submit() {
    logPress('Attendance:Submit', { dateKey, counts });
    if (!canWrite) {
      Alert.alert('Read only', 'Your role can view attendance but cannot save updates.');
      return;
    }
    const entries = roster
      .map((child) => ({ childId: child?.id, status: marks[child?.id] }))
      .filter((entry) => entry.childId && entry.status);
    if (!entries.length) {
      Alert.alert('Nothing to save', 'Mark at least one student before saving attendance.');
      return;
    }
    if (isSeededDemo) {
      if (selectedChildId && marks[selectedChildId]) {
        setHistoryItems((current) => {
          const nextEntry = {
            id: `demo-attendance-${selectedChildId}-${effectiveDateKey}`,
            childId: selectedChildId,
            recordedFor: effectiveDateKey,
            dateKey: effectiveDateKey,
            status: marks[selectedChildId],
            note: 'Updated in Demo View',
          };
          return [nextEntry, ...(Array.isArray(current) ? current.filter((item) => String(item?.dateKey || item?.recordedFor || '') !== effectiveDateKey) : [])];
        });
      }
      Alert.alert('Attendance saved', `Demo View updated for ${effectiveDateKey}.\nPresent: ${counts.present}\nAbsent: ${counts.absent}\nTardy: ${counts.tardy}\nUnmarked: ${counts.unmarked}`);
      return;
    }
    setSaving(true);
    try {
      await Api.saveAttendance({ date: dateKey, entries });
      if (selectedChildId) {
        const result = await Api.getAttendanceHistory(selectedChildId, 365);
        setHistoryItems(Array.isArray(result?.items) ? result.items : []);
      }
      Alert.alert('Attendance saved', `Present: ${counts.present}\nAbsent: ${counts.absent}\nTardy: ${counts.tardy}\nUnmarked: ${counts.unmarked}`);
    } catch (e) {
      Alert.alert('Save failed', String(e?.message || e || 'Could not save attendance.'));
    } finally {
      setSaving(false);
    }
  }

  if (!enabled) {
    return (
      <ScreenWrapper>
        <ScrollView contentContainerStyle={moduleStyles.content}>
          <View style={moduleStyles.empty}>
            <Text style={moduleStyles.emptyText}>Attendance is not enabled for this program.</Text>
          </View>
        </ScrollView>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={moduleStyles.content} keyboardShouldPersistTaps="handled">
        <View style={moduleStyles.header}>
          <Text style={moduleStyles.title}>Attendance</Text>
          <Text style={moduleStyles.subtitle}>Daily roster for {labels.myClass || 'My Class'} • {effectiveDateKey}</Text>
          <View style={moduleStyles.contextRow}>
            {currentProgram?.name ? (
              <View style={moduleStyles.contextChip}><Text style={moduleStyles.contextChipText}>{currentProgram.name}</Text></View>
            ) : null}
            {currentCampus?.name ? (
              <View style={moduleStyles.contextChip}><Text style={moduleStyles.contextChipText}>{currentCampus.name}</Text></View>
            ) : null}
            <View style={[moduleStyles.contextChip, { backgroundColor: '#dcfce7' }]}>
              <Text style={[moduleStyles.contextChipText, { color: '#166534' }]}>Present {counts.present}</Text>
            </View>
            <View style={[moduleStyles.contextChip, { backgroundColor: '#fee2e2' }]}>
              <Text style={[moduleStyles.contextChipText, { color: '#991b1b' }]}>Absent {counts.absent}</Text>
            </View>
            <View style={[moduleStyles.contextChip, { backgroundColor: '#fef3c7' }]}>
              <Text style={[moduleStyles.contextChipText, { color: '#92400e' }]}>Tardy {counts.tardy}</Text>
            </View>
          </View>
        </View>

        {error ? (
          <View style={moduleStyles.empty}>
            <Text style={moduleStyles.emptyText}>{error}</Text>
          </View>
        ) : null}

        {loadingToday ? (
          <View style={moduleStyles.empty}>
            <ActivityIndicator color="#2563eb" />
            <Text style={[moduleStyles.emptyText, { marginTop: 8 }]}>Loading attendance…</Text>
          </View>
        ) : null}

        {roster.length === 0 ? (
          <View style={moduleStyles.empty}>
            <Text style={moduleStyles.emptyText}>No students on the roster yet.</Text>
          </View>
        ) : (
          roster.map((c) => {
            const status = marks[c.id];
            const isSelected = selectedChildId === c.id;
            return (
              <TouchableOpacity key={c.id} onPress={() => setSelectedChildId(c.id)} style={[moduleStyles.card, isSelected ? { borderColor: '#2563eb' } : null]} accessibilityLabel={`Select ${c.name || 'student'} attendance history`}>
                <View style={[moduleStyles.cardRow, { justifyContent: 'space-between' }]}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={moduleStyles.cardTitle}>{c.name || c.firstName || 'Student'}</Text>
                    <Text style={moduleStyles.cardMeta}>{c.age ? `Age ${c.age}` : '—'}</Text>
                    {isSelected ? <Text style={[moduleStyles.cardMeta, { color: '#2563eb', marginTop: 6 }]}>Showing full attendance history below</Text> : null}
                  </View>
                  <View style={{ flexDirection: 'row' }}>
                    {[
                      { key: 'present', label: 'P', color: '#16a34a' },
                      { key: 'tardy', label: 'T', color: '#d97706' },
                      { key: 'absent', label: 'A', color: '#dc2626' },
                    ].map((opt) => (
                      <TouchableOpacity
                        key={opt.key}
                        onPress={() => setMark(c.id, opt.key)}
                        style={{
                          minWidth: 36,
                          paddingVertical: 6,
                          paddingHorizontal: 8,
                          borderRadius: 8,
                          marginLeft: 6,
                          backgroundColor: status === opt.key ? opt.color : '#f1f5f9',
                        }}
                        accessibilityLabel={`Mark ${opt.key} for ${c.name || 'student'}`}
                      >
                        <Text style={{ color: status === opt.key ? '#fff' : '#0f172a', textAlign: 'center', fontWeight: '800' }}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        {selectedChildId ? (
          <View style={moduleStyles.card}>
            <Text style={moduleStyles.cardTitle}>Attendance History</Text>
            <Text style={moduleStyles.cardMeta}>Full history for {(roster.find((child) => child?.id === selectedChildId)?.name) || 'selected child'}</Text>
            {historyLoading ? (
              <View style={{ marginTop: 12 }}>
                <ActivityIndicator color="#2563eb" />
              </View>
            ) : historyItems.length ? (
              historyItems.map((entry) => (
                <View key={entry.id || `${entry.childId}-${entry.recordedFor}`} style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0' }}>
                  <Text style={moduleStyles.cardTitle}>{entry.recordedFor}</Text>
                  <Text style={moduleStyles.cardMeta}>Status: {entry.status}</Text>
                  {entry.note ? <Text style={moduleStyles.cardMeta}>{entry.note}</Text> : null}
                </View>
              ))
            ) : (
              <Text style={[moduleStyles.cardMeta, { marginTop: 12 }]}>No attendance history has been recorded for this child yet.</Text>
            )}
          </View>
        ) : null}

        <TouchableOpacity onPress={submit} style={[moduleStyles.primaryBtn, saving ? { opacity: 0.7 } : null]} accessibilityLabel="Save attendance" disabled={saving}>
          <Text style={moduleStyles.primaryBtnText}>{saving ? 'Saving attendance...' : 'Save attendance'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenWrapper>
  );
}
