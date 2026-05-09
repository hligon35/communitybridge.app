import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import AppDropdown from '../components/AppDropdown';
import { ScreenWrapper } from '../components/ScreenWrapper';
import AppIconButton from '../components/AppIconButton';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { isBcbaRole, isOfficeAdminRole } from '../core/tenant/models';
import { avatarSourceFor, formatIdForDisplay } from '../utils/idVisibility';
import { maskEmailDisplay, maskPhoneDisplay } from '../utils/inputFormat';
import { getDisplayRoleLabel } from '../utils/roleTerminology';
import { getPhoneAccessProfile, isPhoneViewport as resolvePhoneViewport } from '../utils/mobileRoleAccess';
import DateField from '../components/DateField';
import * as Api from '../Api';

function splitStaffName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || 'Staff',
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

function InlineFilterDropdown({ label, value, options = [], selectedValue, onSelect, width = 132 }) {
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

export default function FacultyDirectoryScreen() {
  const navigation = useNavigation();
  const { width, height } = useWindowDimensions();
  const { user } = useAuth();
  const { therapists = [], children = [], fetchAndSync, sendAdminMemo } = useData();
  const isBcba = isBcbaRole(user?.role);
  const isOffice = isOfficeAdminRole(user?.role);
  const phoneAccessProfile = getPhoneAccessProfile(user?.role);
  const usePhoneSafeDirectory = Platform.OS !== 'web'
    && resolvePhoneViewport(width, height)
    && ['bcba', 'office', 'reception', 'admin'].includes(phoneAccessProfile);
  const [workspaceMap, setWorkspaceMap] = useState({});
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loadError, setLoadError] = useState('');
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [showMemoModal, setShowMemoModal] = useState(false);
  const [memoSubject, setMemoSubject] = useState('');
  const [memoBody, setMemoBody] = useState('');
  const [credentials, setCredentials] = useState({
    certification: '',
    certificationExpiration: '',
    cprExpiration: '',
    backgroundCheckDate: '',
    tbTestDate: '',
  });
  const [availability, setAvailability] = useState({
    weekdays: '',
    notes: '',
  });
  const [documents, setDocuments] = useState([]);
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
  const useMobileHeaderFilters = width < 900;
  const useRosterCarousel = width < 900;
  const roleChoices = useMemo(() => roleFilterOptions.map((item) => ({ value: item.key, label: item.label })), [roleFilterOptions]);
  const canEditWorkspace = isOffice || String(user?.uid || user?.id || '') === String(selectedStaff?.id || '');

  useEffect(() => {
    const workspace = selectedStaff?.workspace || {};
    setCredentials({
      certification: String(workspace?.credentials?.certification || ''),
      certificationExpiration: String(workspace?.credentials?.certificationExpiration || ''),
      cprExpiration: String(workspace?.credentials?.cprExpiration || ''),
      backgroundCheckDate: String(workspace?.credentials?.backgroundCheckDate || ''),
      tbTestDate: String(workspace?.credentials?.tbTestDate || ''),
    });
    setAvailability({
      weekdays: String(workspace?.availability?.weekdays || ''),
      notes: String(workspace?.availability?.notes || workspace?.availability || ''),
    });
    setDocuments(Array.isArray(workspace?.documents) ? workspace.documents : []);
  }, [selectedStaff]);

  const summaryCards = useMemo(() => {
    if (!selectedStaff) return null;
    const documentsCount = documents.length;
    const certificationExpiration = credentials.certificationExpiration || 'Not set';
    return {
      caseloadValue: selectedStaff.caseload.length,
      caseloadDetail: `${selectedStaff.caseload.length === 1 ? 'Assigned learner' : 'Assigned learners'}`,
      docsValue: documentsCount,
      docsDetail: `${documentsCount === 1 ? 'Uploaded document' : 'Uploaded documents'}`,
      credentialValue: certificationExpiration,
      credentialDetail: 'Certification expiration',
      availabilityValue: availability.weekdays || availability.notes ? 'Entered' : 'Pending',
      availabilityDetail: availability.notes || availability.weekdays || 'Availability has not been entered yet.',
    };
  }, [availability.notes, availability.weekdays, credentials.certificationExpiration, documents.length, selectedStaff]);

  const complianceStatus = useMemo(() => {
    if (!selectedStaff) return { label: 'Needs Review', color: '#f59e0b', bg: '#fef3c7' };
    const missingCritical = !selectedStaff?.email || !selectedStaff?.phone || !credentials.certificationExpiration;
    if (missingCritical) return { label: 'Expired Credentials', color: '#dc2626', bg: '#fee2e2' };
    if (!documents.length) return { label: 'Review Documents', color: '#f59e0b', bg: '#fef3c7' };
    return { label: 'Compliant', color: '#16a34a', bg: '#dcfce7' };
  }, [credentials.certificationExpiration, documents.length, selectedStaff]);
  const phoneRoleSummary = useMemo(() => roster.reduce((summary, staff) => {
    const normalizedRole = String(staff?.rawRole || '').toLowerCase();
    if (normalizedRole.includes('bcba')) summary.bcba += 1;
    else if (normalizedRole.includes('admin') || normalizedRole.includes('office') || normalizedRole.includes('reception')) summary.admin += 1;
    else summary.rbt += 1;
    return summary;
  }, { bcba: 0, rbt: 0, admin: 0 }), [roster]);
  const phoneComplianceSummary = useMemo(() => roster.reduce((summary, staff) => {
    const workspace = staff?.workspace || {};
    const hasCertification = Boolean(String(workspace?.credentials?.certificationExpiration || '').trim());
    const hasDocuments = Array.isArray(workspace?.documents) && workspace.documents.length > 0;
    if (hasCertification && hasDocuments) summary.ready += 1;
    else summary.review += 1;
    return summary;
  }, { ready: 0, review: 0 }), [roster]);

  if (usePhoneSafeDirectory) {
    return (
      <ScreenWrapper style={styles.container}>
        <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          <View style={[styles.summaryCard, styles.summaryCardLeft, { width: '100%', marginBottom: 12 }]}> 
            <Text style={styles.summaryCardLabel}>Phone staff access stays roster-safe.</Text>
            <Text style={styles.summaryCardDetail}>This phone view keeps staff access limited to roster, role, caseload, and credential-status summaries without exposing direct contact actions.</Text>
          </View>

          <View style={styles.summaryCardsRow}>
            <View style={[styles.summaryCard, styles.summaryCardLeft]}>
              <Text style={styles.summaryCardLabel}>Visible staff</Text>
              <Text style={styles.summaryCardValue}>{roster.length}</Text>
              <Text style={styles.summaryCardDetail}>Current roster in phone-safe scope.</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryCardRight]}>
              <Text style={styles.summaryCardLabel}>Credential ready</Text>
              <Text style={styles.summaryCardValue}>{phoneComplianceSummary.ready}</Text>
              <Text style={styles.summaryCardDetail}>{phoneComplianceSummary.review} need review</Text>
            </View>
          </View>

          <View style={styles.summaryCardsRow}>
            <View style={[styles.summaryCard, styles.summaryCardLeft]}>
              <Text style={styles.summaryCardLabel}>BCBA</Text>
              <Text style={styles.summaryCardValue}>{phoneRoleSummary.bcba}</Text>
              <Text style={styles.summaryCardDetail}>Clinical oversight staff in view.</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryCardRight]}>
              <Text style={styles.summaryCardLabel}>RBT / ABA</Text>
              <Text style={styles.summaryCardValue}>{phoneRoleSummary.rbt}</Text>
              <Text style={styles.summaryCardDetail}>Direct service staff in view.</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Roster summary</Text>
          {roster.length ? roster.slice(0, 8).map((staff) => {
            const workspace = staff?.workspace || {};
            const hasCertification = Boolean(String(workspace?.credentials?.certificationExpiration || '').trim());
            const hasDocuments = Array.isArray(workspace?.documents) && workspace.documents.length > 0;
            const rosterStatus = hasCertification && hasDocuments ? 'Compliant' : 'Needs review';
            return (
              <View key={staff.id} style={styles.assignmentCard}>
                <Text style={styles.assignmentTitle}>{staff.name || 'Staff'}</Text>
                <Text style={styles.assignmentMeta}>{staff.displayRole || 'Staff'} • {staff.caseload.length} learner{staff.caseload.length === 1 ? '' : 's'}</Text>
                <Text style={styles.detailText}>{rosterStatus} • {hasDocuments ? 'Documents on file' : 'Documents missing'}</Text>
              </View>
            );
          }) : <Text style={styles.detailText}>No staff records are visible right now.</Text>}
        </ScrollView>
      </ScreenWrapper>
    );
  }

  function renderTabContent() {
    if (!selectedStaff) return <Text style={styles.empty}>Select a staff member to view details.</Text>;
    if (activeTab === 'overview') {
      return (
        <>
          <View style={styles.summaryCardsRow}>
            <View style={[styles.summaryCard, styles.summaryCardLeft]}>
              <Text style={styles.summaryCardLabel}>Assigned learners</Text>
              <Text style={styles.summaryCardValue}>{summaryCards?.caseloadValue ?? 0}</Text>
              <Text style={styles.summaryCardDetail}>{summaryCards?.caseloadDetail || 'Assigned learners'}</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryCardRight]}>
              <Text style={styles.summaryCardLabel}>Documents</Text>
              <Text style={styles.summaryCardValue}>{summaryCards?.docsValue ?? 0}</Text>
              <Text style={styles.summaryCardDetail}>{summaryCards?.docsDetail || 'Uploaded documents'}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Staff profile</Text>
          <Text style={styles.detailText}>{selectedStaff.displayRole || 'Staff'} • {maskEmailDisplay(selectedStaff.email) || 'No email on file'} • {maskPhoneDisplay(selectedStaff.phone) || 'No phone on file'}</Text>
          <Text style={styles.detailText}>Staff ID: {formatIdForDisplay(selectedStaff.id, { allow: true })}</Text>

          <Text style={styles.sectionTitle}>Availability</Text>
          <Text style={styles.detailText}>{summaryCards?.availabilityDetail || 'Availability has not been entered yet.'}</Text>

          <Text style={styles.sectionTitle}>Credential status</Text>
          <Text style={styles.detailText}>Certification expiration: {summaryCards?.credentialValue || 'Not set'}</Text>

          <Text style={styles.sectionTitle}>Current caseload</Text>
          {selectedStaff.caseload.length ? selectedStaff.caseload.map((child) => (
            <View key={child.id} style={styles.assignmentCard}>
              <Text style={styles.assignmentTitle}>{child.name}</Text>
              <Text style={styles.assignmentMeta}>Room {child.room || 'Unassigned'} • {child.session || 'Session unassigned'}</Text>
            </View>
          )) : <Text style={styles.detailText}>No learners assigned.</Text>}
        </>
      );
    }
    if (activeTab === 'credentials') {
      return (
        <>
          <Text style={styles.sectionTitle}>Credentials & Expiration</Text>
          <TextInput value={credentials.certification} onChangeText={(value) => setCredentials((current) => ({ ...current, certification: String(value || '').slice(0, 120) }))} editable={canEditWorkspace} placeholder="RBT / BCBA certification" style={styles.input} maxLength={120} />
          <DateField value={credentials.certificationExpiration} onChangeText={(value) => setCredentials((current) => ({ ...current, certificationExpiration: value }))} editable={canEditWorkspace} placeholder="Certification expiration (YYYY-MM-DD)" inputStyle={styles.input} accessibilityLabel="Certification expiration" />
          <DateField value={credentials.cprExpiration} onChangeText={(value) => setCredentials((current) => ({ ...current, cprExpiration: value }))} editable={canEditWorkspace} placeholder="CPR / First Aid expiration (YYYY-MM-DD)" inputStyle={styles.input} accessibilityLabel="CPR expiration" />
          <DateField value={credentials.backgroundCheckDate} onChangeText={(value) => setCredentials((current) => ({ ...current, backgroundCheckDate: value }))} editable={canEditWorkspace} placeholder="Background check date (YYYY-MM-DD)" inputStyle={styles.input} accessibilityLabel="Background check date" />
          <DateField value={credentials.tbTestDate} onChangeText={(value) => setCredentials((current) => ({ ...current, tbTestDate: value }))} editable={canEditWorkspace} placeholder="TB test date (YYYY-MM-DD)" inputStyle={styles.input} accessibilityLabel="TB test date" />
          {canEditWorkspace ? (
            <TouchableOpacity style={styles.primaryButton} onPress={() => persistWorkspace({ credentials })} disabled={workspaceSaving}>
              <Text style={styles.primaryButtonText}>{workspaceSaving ? 'Saving...' : 'Save Credentials'}</Text>
            </TouchableOpacity>
          ) : <Text style={styles.detailText}>BCBA can review credential records here.</Text>}
        </>
      );
    }
    if (activeTab === 'caseload') {
      return (
        <>
          <Text style={styles.sectionTitle}>Caseload</Text>
          {selectedStaff.caseload.length ? selectedStaff.caseload.map((child) => (
            <View key={child.id} style={styles.assignmentCard}>
              <Text style={styles.assignmentTitle}>{child.name}</Text>
              <Text style={styles.assignmentMeta}>Room {child.room || 'Unassigned'} • {child.session || 'Session unassigned'}</Text>
            </View>
          )) : <Text style={styles.detailText}>No learners assigned.</Text>}
        </>
      );
    }
    if (activeTab === 'availability') {
      return (
        <>
          <Text style={styles.sectionTitle}>Availability</Text>
          <TextInput value={availability.weekdays} onChangeText={(value) => setAvailability((current) => ({ ...current, weekdays: String(value || '').slice(0, 120) }))} editable={canEditWorkspace} placeholder="Weekdays / shift coverage" style={styles.input} maxLength={120} />
          <TextInput value={availability.notes} onChangeText={(value) => setAvailability((current) => ({ ...current, notes: String(value || '').slice(0, 2000) }))} editable={canEditWorkspace} placeholder="Availability notes" multiline style={[styles.input, styles.multilineInput]} maxLength={2000} />
          {canEditWorkspace ? (
            <TouchableOpacity style={styles.primaryButton} onPress={() => persistWorkspace({ availability })} disabled={workspaceSaving}>
              <Text style={styles.primaryButtonText}>{workspaceSaving ? 'Saving...' : 'Save Availability'}</Text>
            </TouchableOpacity>
          ) : null}
        </>
      );
    }
    return (
      <>
        <Text style={styles.sectionTitle}>Documents</Text>
        <View style={styles.documentHeader}>
          <Text style={styles.detailText}>{documents.length ? `${documents.length} documents uploaded.` : 'No documents uploaded yet.'}</Text>
          {canEditWorkspace ? (
            <TouchableOpacity style={styles.secondaryActionButton} onPress={uploadDocument} disabled={workspaceSaving}>
              <Text style={styles.secondaryActionButtonText}>{workspaceSaving ? 'Working...' : 'Upload'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {documents.length ? documents.map((item) => (
          <View key={item.id || item.url} style={styles.documentRow}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => openDocument(item.url)}>
              <Text style={styles.documentTitle}>{item.title || 'Document'}</Text>
              <Text style={styles.documentMeta}>{item.uploadedAt ? new Date(item.uploadedAt).toLocaleString() : 'Recently added'}</Text>
            </TouchableOpacity>
            {canEditWorkspace ? (
              <TouchableOpacity onPress={() => removeDocument(item.id)} style={styles.removeButton}>
                <Text style={styles.removeButtonText}>Remove</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )) : null}
      </>
    );
  }

  function showAction(title, message) {
    Alert.alert(title, message);
  }

  function isIsoDateInput(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return true;
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  }

  function getWorkspaceValidationError(nextCredentials, nextAvailability) {
    if (String(nextCredentials?.certification || '').trim().length > 120) return 'Certification must be 120 characters or fewer.';
    if (!isIsoDateInput(nextCredentials?.certificationExpiration)) return 'Certification expiration must use YYYY-MM-DD.';
    if (!isIsoDateInput(nextCredentials?.cprExpiration)) return 'CPR expiration must use YYYY-MM-DD.';
    if (!isIsoDateInput(nextCredentials?.backgroundCheckDate)) return 'Background check date must use YYYY-MM-DD.';
    if (!isIsoDateInput(nextCredentials?.tbTestDate)) return 'TB test date must use YYYY-MM-DD.';
    if (String(nextAvailability?.weekdays || '').trim().length > 120) return 'Weekday coverage must be 120 characters or fewer.';
    if (String(nextAvailability?.notes || '').trim().length > 2000) return 'Availability notes must be 2000 characters or fewer.';
    return '';
  }

  function getMemoValidationError(subject, body) {
    const trimmedSubject = String(subject || '').trim();
    const trimmedBody = String(body || '').trim();
    if (!trimmedSubject && !trimmedBody) return 'Add a subject or message body before sending.';
    if (trimmedSubject.length > 120) return 'Memo subject must be 120 characters or fewer.';
    if (trimmedBody.length > 5000) return 'Memo body must be 5000 characters or fewer.';
    return '';
  }

  async function persistWorkspace(next = {}) {
    if (!selectedStaff?.id) return;
    const nextCredentials = next.credentials || credentials;
    const nextAvailability = next.availability || availability;
    const nextDocuments = next.documents || documents;
    const validationError = getWorkspaceValidationError(nextCredentials, nextAvailability);
    if (validationError) {
      Alert.alert('Invalid input', validationError);
      return;
    }
    try {
      setWorkspaceSaving(true);
      const result = await Api.updateStaffWorkspace(selectedStaff.id, {
        credentials: nextCredentials,
        availability: nextAvailability,
        documents: nextDocuments,
      });
      const item = result?.item || {};
      setWorkspaceMap((current) => ({
        ...current,
        [selectedStaff.id]: {
          ...(current[selectedStaff.id] || {}),
          ...item,
          credentials: nextCredentials,
          availability: nextAvailability,
          documents: nextDocuments,
        },
      }));
    } catch (error) {
      Alert.alert('Save failed', String(error?.message || error || 'Could not save staff workspace.'));
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function uploadDocument() {
    if (!canEditWorkspace || !selectedStaff?.id) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: false, multiple: false, type: '*/*' });
      if (picked?.canceled) return;
      const asset = Array.isArray(picked?.assets) ? picked.assets[0] : null;
      if (!asset?.uri) return;
      setWorkspaceSaving(true);
      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: asset.name || `staff-document-${Date.now()}`,
        type: asset.mimeType || asset.type || 'application/octet-stream',
      });
      const uploaded = await Api.uploadMedia(formData);
      const nextDocuments = [
        {
          id: `staff-doc-${Date.now()}`,
          title: asset.name || 'Document',
          url: uploaded?.url || '',
          uploadedAt: new Date().toISOString(),
          mimeType: asset.mimeType || asset.type || '',
        },
        ...documents,
      ].filter((item) => item?.url);
      setDocuments(nextDocuments);
      await persistWorkspace({ documents: nextDocuments });
    } catch (error) {
      Alert.alert('Upload failed', String(error?.message || error || 'Could not upload document.'));
      setWorkspaceSaving(false);
    }
  }

  function removeDocument(documentId) {
    if (!canEditWorkspace) return;
    const nextDocuments = documents.filter((item) => item?.id !== documentId);
    setDocuments(nextDocuments);
    persistWorkspace({ documents: nextDocuments });
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

  function openDocument(url) {
    const normalized = String(url || '').trim();
    if (!normalized) return;
    Linking.openURL(normalized).catch(() => {
      Alert.alert('Unable to open document', 'Your device could not open this document.');
    });
  }

  const mobileHeaderFilters = useMobileHeaderFilters ? (
    <View style={styles.mobileHeaderFilterRow}>
      <InlineFilterDropdown
        label="Role"
        value={activeRoleFilter.label}
        options={roleChoices}
        selectedValue={roleFilter}
        onSelect={setRoleFilter}
        width={132}
      />
      <TextInput value={query} onChangeText={setQuery} placeholder="Search staff" style={[styles.input, styles.mobileHeaderSearchInput]} />
    </View>
  ) : null;

  return (
    <ScreenWrapper
      style={styles.screen}
      mobileHeaderBelow={mobileHeaderFilters}
      bannerRight={null}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
        {!useMobileHeaderFilters ? (
          <View style={styles.filtersCard}>
            <View style={styles.filtersRow}>
              <InlineFilterDropdown
                label="Role"
                value={activeRoleFilter.label}
                options={roleChoices}
                selectedValue={roleFilter}
                onSelect={setRoleFilter}
                width={132}
              />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search staff" style={[styles.input, styles.filtersSearchInput]} />
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
            {roster.map((staff) => {
              const { firstName, lastName } = splitStaffName(staff.name);
              return (
                <TouchableOpacity
                  key={staff.id}
                  style={[styles.rosterCarouselCard, staff.id === selectedStaffId ? styles.rosterRowActive : null]}
                  onPress={() => setSelectedStaffId(staff.id)}
                >
                  <Image source={avatarSourceFor(staff)} style={styles.rosterCarouselAvatar} />
                  <View style={styles.rosterCarouselTextWrap}>
                    <Text style={styles.rosterCarouselFirstName} numberOfLines={1}>{firstName}</Text>
                    <Text style={styles.rosterCarouselLastName} numberOfLines={1}>{lastName || staff.displayRole}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        <View style={[styles.layoutRow, useRosterCarousel ? styles.layoutRowCompact : null]}>
          {!useRosterCarousel ? (
            <View style={styles.rosterPanel}>
              {roster.map((staff) => (
                <TouchableOpacity key={staff.id} style={[styles.rosterRow, staff.id === selectedStaffId ? styles.rosterRowActive : null]} onPress={() => setSelectedStaffId(staff.id)}>
                  <Image source={avatarSourceFor(staff)} style={styles.avatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rosterName}>{staff.name || 'Staff'}</Text>
                    <Text style={styles.rosterMeta}>{staff.displayRole || 'Role not set'} • {staff.caseload.length} learner{staff.caseload.length === 1 ? '' : 's'}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <View style={[styles.detailPanel, useRosterCarousel ? styles.detailPanelFullWidth : null]}>
            {selectedStaff ? (
              <>
                <View style={styles.profileHeader}>
                  <Image source={avatarSourceFor(selectedStaff)} style={styles.profileAvatar} />
                  <View style={styles.profileHeaderTextWrap}>
                    <Text style={styles.profileName}>{selectedStaff.name || 'Staff'}</Text>
                    <Text style={styles.profileMeta}>{selectedStaff.displayRole || 'Role not set'} • {formatIdForDisplay(selectedStaff.id, { allow: true })}</Text>
                  </View>
                  <View style={[styles.statusPill, styles.statusPillTopRight, { backgroundColor: complianceStatus.bg }]}>
                    <Text style={[styles.statusPillText, { color: complianceStatus.color }]}>{String(complianceStatus.label || '').split(' ').join('\n')}</Text>
                  </View>
                  <View style={styles.profileHeaderActions}>
                    <AppIconButton accessibilityLabel="Send alert to staff" name="notifications-active" iconSize={18} style={styles.profileHeaderIconButton} onPress={() => setShowMemoModal(true)} />
                    {selectedStaff.phone ? (
                      <AppIconButton accessibilityLabel="Call staff" name="call" iconSize={18} style={styles.profileHeaderIconButton} onPress={() => openPhone(selectedStaff.phone)} />
                    ) : null}
                    {selectedStaff.email ? (
                      <AppIconButton accessibilityLabel="Email staff" name="email" iconSize={18} style={styles.profileHeaderIconButton} onPress={() => openEmail(selectedStaff.email)} />
                    ) : null}
                  </View>
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipCarouselContent}
                  style={styles.chipCarousel}
                >
                  {availableTabs.map((tab) => <TabButton key={tab} label={tab.charAt(0).toUpperCase() + tab.slice(1)} active={activeTab === tab} onPress={() => setActiveTab(tab)} />)}
                </ScrollView>

                <View style={styles.tabContent}>{renderTabContent()}</View>
                <View style={styles.actionStrip}>
                  {isBcba ? <TouchableOpacity style={styles.primaryButton} onPress={() => showAction('Assign caseload', 'Caseload assignment is staged for BCBA review and assignment controls.')}><Text style={styles.primaryButtonText}>Assign Caseload</Text></TouchableOpacity> : null}
                  {isOffice ? <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('UserMonitor', { initialUserId: selectedStaff.id })}><Text style={styles.secondaryButtonText}>Manage Staff</Text></TouchableOpacity> : null}
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowMemoModal(true)}><Text style={styles.secondaryButtonText}>Urgent Memo</Text></TouchableOpacity>
                </View>
              </>
            ) : <Text style={styles.empty}>No staff selected.</Text>}
          </View>
        </View>
      </ScrollView>

      {showMemoModal && selectedStaff ? (
        <Modal transparent visible animationType="fade">
          <TouchableWithoutFeedback onPress={() => setShowMemoModal(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>Send Urgent Memo</Text>
                  <TextInput placeholder="Subject" value={memoSubject} onChangeText={(value) => setMemoSubject(String(value || '').slice(0, 120))} style={styles.modalInput} maxLength={120} />
                  <TextInput placeholder="Message" value={memoBody} onChangeText={(value) => setMemoBody(String(value || '').slice(0, 5000))} multiline style={[styles.modalInput, styles.modalMessageInput]} maxLength={5000} />
                  <View style={styles.modalActions}>
                    <TouchableOpacity onPress={() => setShowMemoModal(false)} style={styles.modalCancelButton}><Text style={styles.modalCancelButtonText}>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity onPress={async () => {
                      try {
                        const memoError = getMemoValidationError(memoSubject, memoBody);
                        if (memoError) {
                          Alert.alert('Invalid memo', memoError);
                          return;
                        }
                        await sendAdminMemo({ recipients: [{ id: selectedStaff.id }], subject: String(memoSubject || `Message about ${selectedStaff.name || 'staff'}`).trim(), body: String(memoBody || '').trim() });
                        Alert.alert('Sent', 'Urgent memo sent');
                        setShowMemoModal(false);
                        setMemoSubject('');
                        setMemoBody('');
                      } catch (error) {
                        Alert.alert('Failed', 'Could not send memo');
                      }
                    }} style={styles.modalSendButton}><Text style={styles.modalSendButtonText}>Send</Text></TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      ) : null}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 8 },
  errorText: { color: '#b91c1c', marginBottom: 12 },
  filtersCard: { marginTop: 14, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  filtersRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff' },
  filtersSearchInput: { flex: 1, minWidth: 220 },
  mobileHeaderFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', flex: 1 },
  mobileHeaderSearchInput: { flex: 1, minWidth: 0, alignSelf: 'stretch', height: 40, paddingVertical: 8, paddingHorizontal: 12 },
  chipCarousel: { marginTop: 4 },
  chipCarouselContent: { paddingRight: 8 },
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
  rosterCarouselFirstName: { fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  rosterCarouselLastName: { marginTop: 2, color: '#64748b', fontSize: 12, fontWeight: '700', textAlign: 'center', minHeight: 16 },
  rosterPanel: { width: '34%', borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 14, marginRight: 12 },
  detailPanel: { flex: 1, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  detailPanelFullWidth: { width: '100%' },
  rosterRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 10, marginBottom: 8, backgroundColor: '#f8fafc' },
  rosterRowActive: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#93c5fd' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e2e8f0', marginRight: 10 },
  rosterName: { fontWeight: '800', color: '#0f172a' },
  rosterMeta: { marginTop: 4, color: '#64748b', fontSize: 12 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', position: 'relative' },
  profileAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#e2e8f0' },
  profileHeaderTextWrap: { flex: 1, marginLeft: 4, paddingRight: 16 },
  profileHeaderActions: { flexDirection: 'row', alignItems: 'center', marginLeft: 2 },
  profileHeaderIconButton: { marginLeft: 2, top: -24, right: -6 },
  bannerAddButton: null,
  profileName: { fontSize: 18, fontWeight: '800', color: '#0f172a', paddingRight: 4 },
  profileMeta: { marginTop: 4, color: '#64748b', paddingRight: 4 },
  profileMetaSecondary: { marginTop: 4, color: '#475569', fontSize: 10, fontWeight: '700' },
  statusPill: { marginTop: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, alignSelf: 'flex-start' },
  statusPillTopRight: { position: 'absolute', top: 0, right: 22, marginTop: 38, minWidth: 56, alignItems: 'center' },
  statusPillText: { fontWeight: '800', fontSize: 10, textAlign: 'center', lineHeight: 12 },
  tabContent: { marginTop: 8 },
  summaryCardsRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: 6, marginBottom: 2 },
  summaryCard: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff', paddingVertical: 10, paddingHorizontal: 12 },
  summaryCardLeft: { marginRight: 6 },
  summaryCardRight: { marginLeft: 6 },
  summaryCardLabel: { color: '#64748b', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryCardValue: { marginTop: 4, color: '#0f172a', fontSize: 18, fontWeight: '800' },
  summaryCardDetail: { marginTop: 4, color: '#475569', fontSize: 12, lineHeight: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a', marginBottom: 8, marginTop: 8 },
  detailText: { color: '#475569', lineHeight: 20, marginBottom: 6 },
  assignmentCard: { marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f8fafc', padding: 12 },
  assignmentTitle: { fontWeight: '800', color: '#0f172a' },
  assignmentMeta: { marginTop: 4, color: '#64748b', fontSize: 12 },
  actionStrip: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  primaryButton: { borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  secondaryButton: { borderRadius: 12, backgroundColor: '#e2e8f0', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  secondaryButtonText: { color: '#0f172a', fontWeight: '800' },
  multilineInput: { minHeight: 86, textAlignVertical: 'top' },
  documentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  secondaryActionButton: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryActionButtonText: { color: '#334155', fontWeight: '700' },
  documentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  documentTitle: { fontWeight: '700', color: '#0f172a' },
  documentMeta: { marginTop: 4, color: '#64748b' },
  removeButton: { paddingVertical: 8, paddingHorizontal: 10 },
  removeButtonText: { color: '#dc2626', fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 520, backgroundColor: '#fff', padding: 12, borderRadius: 12 },
  modalTitle: { fontWeight: '700', marginBottom: 8, color: '#0f172a' },
  modalInput: { borderWidth: 1, borderColor: '#e5e7eb', padding: 8, borderRadius: 8, marginBottom: 8 },
  modalMessageInput: { height: 120, textAlignVertical: 'top', marginBottom: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  modalCancelButton: { marginRight: 8, padding: 8 },
  modalCancelButtonText: { color: '#0f172a' },
  modalSendButton: { padding: 8, backgroundColor: '#2563eb', borderRadius: 8 },
  modalSendButtonText: { color: '#fff', fontWeight: '700' },
  empty: { color: '#64748b' },
});
