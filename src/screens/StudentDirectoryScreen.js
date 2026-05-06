import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenWrapper } from '../components/ScreenWrapper';
import AppDropdown from '../components/AppDropdown';
import AppIconButton from '../components/AppIconButton';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { useTenant } from '../core/tenant/TenantContext';
import { isBcbaRole, isOfficeAdminRole, normalizeUserRole, USER_ROLES } from '../core/tenant/models';
import { avatarSourceFor } from '../utils/idVisibility';
import { THERAPY_ROLE_LABELS } from '../utils/roleTerminology';
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

function TabButton({ label, active, onPress }) {
  return (
    <TouchableOpacity style={[styles.tabButton, active ? styles.tabButtonActive : null]} onPress={onPress}>
      <Text style={[styles.tabButtonText, active ? styles.tabButtonTextActive : null]}>{label}</Text>
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
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const { children = [], parents = [], therapists = [], fetchAndSync } = useData();
  const { currentOrganization, currentProgram, currentCampus } = useTenant() || {};
  const isBcba = isBcbaRole(user?.role);
  const isOffice = isOfficeAdminRole(user?.role);
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

  const filteredChildren = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...(children || [])]
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
  }, [children, query, roomFilter, sortKey]);

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
  const assignedStaff = useMemo(() => {
    if (!selectedChild) return [];
    const ids = [selectedChild?.amTherapist, selectedChild?.pmTherapist, selectedChild?.bcaTherapist].map((entry) => typeof entry === 'string' ? entry : entry?.id).filter(Boolean);
    return (therapists || []).filter((staff) => ids.includes(staff?.id));
  }, [selectedChild, therapists]);

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

  function openAction(title, message) {
    Alert.alert(title, message);
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
      return (
        <>
          <Text style={styles.sectionTitle}>Student profile</Text>
          <Text style={styles.detailText}>Room {selectedChild.room || 'Unassigned'} • Age {selectedChild.age || 'N/A'} • Session {selectedChild.session || 'Unscheduled'}</Text>
          <Text style={styles.detailText}>{selectedChild.carePlan || 'No overview summary saved yet.'}</Text>
          <Text style={styles.sectionTitle}>Assigned staff</Text>
          {(assignedStaff || []).length ? assignedStaff.map((staff) => <Text key={staff.id} style={styles.detailText}>{staff.name} • {staff.role || 'Staff'}</Text>) : <Text style={styles.detailText}>No BCBA or therapist assigned.</Text>}
        </>
      );
    }
    if (activeTab === 'parents') {
      return (
        <>
          <Text style={styles.sectionTitle}>Parent contacts</Text>
          {linkedParents.length ? linkedParents.map((parent) => (
            <Text key={parent.id} style={styles.detailText}>{parent.name || `${parent.firstName || ''} ${parent.lastName || ''}`.trim()} • {parent.phone || parent.email || 'No contact info'}</Text>
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
          <Text style={styles.detailText}>Recent attendance tracking lives in the scheduling and attendance modules for this student.</Text>
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
        <TouchableOpacity style={styles.secondaryButton} onPress={() => openAction('Documents', 'Document upload routing can be connected to the existing admin document flows next.')}>
          <Text style={styles.secondaryButtonText}>{isOffice ? 'Upload Document' : 'View Documents'}</Text>
        </TouchableOpacity>
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
                  </View>
                  {isOffice ? (
                    <View style={styles.profileHeaderActions}>
                      <AppIconButton
                        accessibilityLabel="Edit student info"
                        name="edit"
                        style={styles.profileHeaderIconButton}
                        onPress={() => openAction('Edit student info', 'Student editing can continue through the student profile workspace.')}
                      />
                      <AppIconButton
                        accessibilityLabel={`Assign BCBA / ${THERAPY_ROLE_LABELS.therapist}`}
                        name="person-add-alt-1"
                        style={styles.profileHeaderIconButton}
                        onPress={() => navigation.navigate('ScheduleCalendar', { childId: selectedChild.id, editorMode: 'assignment' })}
                      />
                    </View>
                  ) : null}
                </View>

                <View style={styles.chipRow}>
                  {visibleTabs.map((tab) => <TabButton key={tab.key} label={tab.label} active={activeTab === tab.key} onPress={() => setActiveTab(tab.key)} />)}
                </View>

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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  chipRowSingleLine: { flexDirection: 'row', flexWrap: 'nowrap', marginTop: 12, paddingRight: 8 },
  tabButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f1f5f9', marginRight: 8, marginBottom: 8 },
  tabButtonActive: { backgroundColor: '#2563eb' },
  tabButtonText: { color: '#0f172a', fontWeight: '700' },
  tabButtonTextActive: { color: '#ffffff' },
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
  profileHeader: { flexDirection: 'row', alignItems: 'center' },
  profileAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#e2e8f0' },
  profileHeaderActions: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
  profileHeaderIconButton: { marginLeft: 8 },
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
