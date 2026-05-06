import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AppDropdown from '../components/AppDropdown';
import { ScreenWrapper } from '../components/ScreenWrapper';
import AppIconButton from '../components/AppIconButton';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { isBcbaRole, isOfficeAdminRole } from '../core/tenant/models';
import { avatarSourceFor } from '../utils/idVisibility';
import { getDisplayRoleLabel } from '../utils/roleTerminology';
import * as Api from '../Api';

function Chip({ label, active, onPress }) {
  return (
    <TouchableOpacity style={[styles.chip, active ? styles.chipActive : null]} onPress={onPress}>
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function FacultyDirectoryScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { therapists = [], children = [], fetchAndSync } = useData();
  const isBcba = isBcbaRole(user?.role);
  const isOffice = isOfficeAdminRole(user?.role);
  const [workspaceMap, setWorkspaceMap] = useState({});
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loadError, setLoadError] = useState('');
  const roleFilterOptions = useMemo(() => ([
    { key: 'all', label: 'All' },
    { key: 'bcba', label: 'BCBA' },
    { key: 'rbt', label: 'RBT / ABA Tech' },
    { key: 'admin', label: 'Admin' },
  ]), []);

  useFocusEffect(
    React.useCallback(() => {
      fetchAndSync?.({ force: true }).catch(() => {});
    }, [fetchAndSync])
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoadError('');
        const response = await Api.listStaffWorkspaces((therapists || []).map((item) => item?.id));
        if (!mounted) return;
        const next = {};
        (response?.items || []).forEach((item) => {
          if (item?.id) next[item.id] = item;
        });
        setWorkspaceMap(next);
      } catch (error) {
        if (mounted) {
          setWorkspaceMap({});
          setLoadError(String(error?.message || error || 'Could not load staff workspace details.'));
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [therapists]);

  const roster = useMemo(() => {
    const caseloadById = new Map();
    (children || []).forEach((child) => {
      [child?.amTherapist, child?.pmTherapist, child?.bcaTherapist].forEach((entry) => {
        const id = typeof entry === 'string' ? entry : entry?.id;
        if (!id) return;
        const next = caseloadById.get(id) || [];
        next.push(child);
        caseloadById.set(id, next);
      });
    });
    const normalized = query.trim().toLowerCase();
    return (therapists || [])
      .map((staff) => {
        const rawRole = String(staff?.role || '').trim();
        return {
          ...staff,
          rawRole,
          displayRole: getDisplayRoleLabel(rawRole || 'Staff') || 'Staff',
          caseload: caseloadById.get(staff?.id) || [],
          workspace: workspaceMap[staff?.id] || {},
        };
      })
      .filter((staff) => {
        const normalizedRole = String(staff?.rawRole || '').toLowerCase();
        if (roleFilter === 'bcba' && !normalizedRole.includes('bcba')) return false;
        if (roleFilter === 'rbt' && normalizedRole.includes('bcba')) return false;
        if (roleFilter === 'admin' && !normalizedRole.includes('admin')) return false;
        if (!normalized) return true;
        return [staff?.name, staff?.displayRole, staff?.email, staff?.phone].filter(Boolean).join(' ').toLowerCase().includes(normalized);
      });
  }, [children, query, roleFilter, therapists, workspaceMap]);

  useEffect(() => {
    if (!roster.length) {
      setSelectedStaffId(null);
      return;
    }
    if (!roster.some((staff) => staff?.id === selectedStaffId)) setSelectedStaffId(roster[0]?.id || null);
  }, [roster, selectedStaffId]);

  const selectedStaff = useMemo(() => roster.find((staff) => staff?.id === selectedStaffId) || null, [roster, selectedStaffId]);
  const availableTabs = ['overview', 'credentials', 'caseload', 'availability', 'documents'];
  const activeRoleFilter = useMemo(() => roleFilterOptions.find((item) => item.key === roleFilter) || roleFilterOptions[0], [roleFilter, roleFilterOptions]);

  function renderTab() {
    if (!selectedStaff) return <Text style={styles.empty}>Select a staff member to view details.</Text>;
    if (activeTab === 'overview') {
      return (
        <>
          <Text style={styles.sectionTitle}>Overview</Text>
          <Text style={styles.detailText}>{selectedStaff.displayRole || 'Staff'} • {selectedStaff.email || 'No email'} • {selectedStaff.phone || 'No phone'}</Text>
          <Text style={styles.detailText}>{selectedStaff.caseload.length} assigned learner{selectedStaff.caseload.length === 1 ? '' : 's'}.</Text>
        </>
      );
    }
    if (activeTab === 'credentials') {
      return (
        <>
          <Text style={styles.sectionTitle}>Credentials & Expiration</Text>
          <Text style={styles.detailText}>Certification expiration: {selectedStaff.workspace?.credentials?.certificationExpiration || 'Not set'}</Text>
          <Text style={styles.detailText}>CPR / First Aid: {selectedStaff.workspace?.credentials?.cprExpiration || 'Not set'}</Text>
          <Text style={styles.detailText}>{isOffice ? 'Office can update credential records from this workspace.' : 'BCBA can review credential records here.'}</Text>
        </>
      );
    }
    if (activeTab === 'caseload') {
      return (
        <>
          <Text style={styles.sectionTitle}>Caseload</Text>
          {selectedStaff.caseload.length ? selectedStaff.caseload.map((child) => <Text key={child.id} style={styles.detailText}>{child.name} • {child.room || 'Room unassigned'}</Text>) : <Text style={styles.detailText}>No learners assigned.</Text>}
        </>
      );
    }
    if (activeTab === 'availability') {
      return (
        <>
          <Text style={styles.sectionTitle}>Availability</Text>
          <Text style={styles.detailText}>{selectedStaff.workspace?.availability || 'Availability has not been entered yet.'}</Text>
        </>
      );
    }
    return (
      <>
        <Text style={styles.sectionTitle}>Documents</Text>
        <Text style={styles.detailText}>{Array.isArray(selectedStaff.workspace?.documents) && selectedStaff.workspace.documents.length ? `${selectedStaff.workspace.documents.length} documents uploaded.` : 'No documents uploaded yet.'}</Text>
      </>
    );
  }

  function showAction(title, message) {
    Alert.alert(title, message);
  }

  return (
    <ScreenWrapper
      style={styles.screen}
      bannerRight={isOffice ? (
        <AppIconButton
          accessibilityLabel="Add staff"
          name="add"
          iconSize={22}
          style={styles.bannerAddButton}
          onPress={() => showAction('Add staff', 'Staff creation stays in the office identity workflow and can be connected here.')}
        />
      ) : null}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
        <View style={styles.filtersCard}>
          <View style={styles.filtersRow}>
            <View style={styles.filterDropdownWrap}>
              <AppDropdown
                minMenuWidth={132}
                onSelect={setRoleFilter}
                options={roleFilterOptions.map((item) => ({ value: item.key, label: item.label }))}
                placeholder="Role"
                selectedValue={roleFilter}
                value={activeRoleFilter.label}
                width={132}
              />
            </View>
            <TextInput value={query} onChangeText={setQuery} placeholder="Search staff" style={[styles.input, styles.filtersSearchInput]} />
          </View>
        </View>

        <View style={styles.layoutRow}>
          <View style={styles.rosterPanel}>
            <Text style={styles.panelTitle}>Staff roster</Text>
            {roster.map((staff) => (
              <TouchableOpacity key={staff.id} style={[styles.rosterRow, staff.id === selectedStaffId ? styles.rosterRowActive : null]} onPress={() => setSelectedStaffId(staff.id)}>
                <Image source={avatarSourceFor(staff)} style={styles.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rosterName}>{staff.name || 'Staff'}</Text>
                  <Text style={styles.rosterMeta}>{staff.displayRole || 'Role not set'}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.detailPanel}>
            {selectedStaff ? (
              <>
                <View style={styles.profileHeader}>
                  <Image source={avatarSourceFor(selectedStaff)} style={styles.profileAvatar} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.profileName}>{selectedStaff.name || 'Staff'}</Text>
                    <Text style={styles.profileMeta}>{selectedStaff.displayRole || 'Role not set'}</Text>
                  </View>
                  {isOffice ? (
                    <View style={styles.profileHeaderActions}>
                      <AppIconButton
                        accessibilityLabel="Update credentials"
                        name="verified-user"
                        iconSize={18}
                        style={styles.profileHeaderIconButton}
                        onPress={() => navigation.navigate('FacultyDetail', { facultyId: selectedStaff.id, initialTab: 'credentials' })}
                      />
                    </View>
                  ) : null}
                </View>
                <View style={styles.chipRow}>
                  {availableTabs.map((tab) => <Chip key={tab} label={tab.charAt(0).toUpperCase() + tab.slice(1)} active={activeTab === tab} onPress={() => setActiveTab(tab)} />)}
                </View>
                <View style={styles.tabContent}>{renderTab()}</View>
                <View style={styles.actionStrip}>
                  {isBcba ? <TouchableOpacity style={styles.primaryButton} onPress={() => showAction('Assign caseload', 'Caseload assignment is staged for BCBA review and assignment controls.')}><Text style={styles.primaryButtonText}>Assign Caseload</Text></TouchableOpacity> : null}
                </View>
              </>
            ) : <Text style={styles.empty}>No staff selected.</Text>}
          </View>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  errorText: { color: '#b91c1c', marginBottom: 12 },
  filtersCard: { marginTop: 14, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  filtersRow: { flexDirection: 'row', alignItems: 'center' },
  filterDropdownWrap: { width: 132, marginRight: 12, zIndex: 2 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff' },
  filtersSearchInput: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  chip: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f1f5f9', marginRight: 8, marginBottom: 8 },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { color: '#0f172a', fontWeight: '700' },
  chipTextActive: { color: '#ffffff' },
  layoutRow: { marginTop: 14, flexDirection: 'row' },
  rosterPanel: { width: '34%', borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 14, marginRight: 12 },
  detailPanel: { flex: 1, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  panelTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  rosterRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 10, marginBottom: 8, backgroundColor: '#f8fafc' },
  rosterRowActive: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#93c5fd' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e2e8f0', marginRight: 10 },
  rosterName: { fontWeight: '800', color: '#0f172a' },
  rosterMeta: { marginTop: 4, color: '#64748b', fontSize: 12 },
  profileHeader: { flexDirection: 'row', alignItems: 'center' },
  profileAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#e2e8f0' },
  profileHeaderActions: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
  profileHeaderIconButton: { marginLeft: 0 },
  bannerAddButton: null,
  profileName: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  profileMeta: { marginTop: 6, color: '#64748b' },
  tabContent: { marginTop: 8, borderRadius: 16, backgroundColor: '#f8fafc', padding: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a', marginBottom: 8, marginTop: 8 },
  detailText: { color: '#475569', lineHeight: 20, marginBottom: 6 },
  actionStrip: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  primaryButton: { borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  secondaryButton: { borderRadius: 12, backgroundColor: '#e2e8f0', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  secondaryButtonText: { color: '#0f172a', fontWeight: '800' },
  empty: { color: '#64748b' },
});
