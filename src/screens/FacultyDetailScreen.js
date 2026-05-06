import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, Linking, TouchableOpacity, Modal, TouchableWithoutFeedback, TextInput, Alert, Platform, ActivityIndicator } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useData } from '../DataContext';
import { useAuth } from '../AuthContext';
import { MaterialIcons } from '@expo/vector-icons';
// header provided by ScreenWrapper
import { ScreenWrapper } from '../components/ScreenWrapper';
import { avatarSourceFor, formatIdForDisplay } from '../utils/idVisibility';
import { maskEmailDisplay, maskPhoneDisplay } from '../utils/inputFormat';
import * as Api from '../Api';
import { isAdminRole } from '../core/tenant/models';
import { getDisplayRoleLabel } from '../utils/roleTerminology';
import DateField from '../components/DateField';

function AssignedChildrenList({ facultyId }) {
  const { children = [] } = useData();
  const navigation = useNavigation();
  // Accept facultyId as either id string or object; handle therapist references that might be objects or plain ids.
  const assigned = (children || []).filter((c) => {
    const tests = [c.amTherapist, c.pmTherapist, c.bcaTherapist];
    return tests.some((t) => {
      if (!t) return false;
      // if t is an object with id
      if (typeof t === 'object' && t.id) return t.id === facultyId || t.id === (facultyId && facultyId.id);
      // if t is a raw id string
      if (typeof t === 'string') return t === facultyId || t === (facultyId && facultyId.id);
      return false;
    });
  });
  if (!assigned.length) return <Text style={{ color: '#6b7280' }}>No assigned children</Text>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8 }}>
      {assigned.map((c) => (
        <TouchableOpacity key={c.id} style={styles.childTile} onPress={() => { try { navigation.push('ChildDetail', { childId: c.id }); } catch (e) { navigation.navigate('ChildDetail', { childId: c.id }); } }}>
          <Image source={avatarSourceFor(c)} style={styles.childAvatarSmall} />
          <Text numberOfLines={1} style={styles.childTileName}>{c.name}</Text>
          <Text numberOfLines={1} style={{ color: '#6b7280', marginTop: 4 }}>{c.age}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export default function FacultyDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { facultyId, initialTab } = route.params || {};
  const { therapists = [], children = [], sendAdminMemo, sendMessage, messages = [] } = useData();
  const { user } = useAuth();

  const [showMemoModal, setShowMemoModal] = useState(false);
  const [memoSubject, setMemoSubject] = useState('');
  const [memoBody, setMemoBody] = useState('');
  const [selectedTab, setSelectedTab] = useState('overview');
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
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
  const isWeb = Platform.OS === 'web';

  const all = [...(therapists || [])];
  const faculty = all.find((f) => f.id === facultyId) || null;

  

  const getDisplayName = (f) => {
    if (!f) return 'Staff';
    if (f.name && !f.name.toLowerCase().startsWith('therapist')) return f.name;
    if (f.firstName || f.lastName) return `${f.firstName || ''} ${f.lastName || ''}`.trim();
    // fallback to role if name is not present
    return getDisplayRoleLabel(f.role || f.name || 'Staff');
  };

  // assigned children preview (same matching logic as AssignedChildrenList)
  const assignedChildren = (children || []).filter((c) => {
    const tests = [c.amTherapist, c.pmTherapist, c.bcaTherapist];
    return tests.some((t) => {
      if (!t) return false;
      if (typeof t === 'object' && t.id) return t.id === facultyId || t.id === (facultyId && facultyId.id);
      if (typeof t === 'string') return t === facultyId || t === (facultyId && facultyId.id);
      return false;
    });
  });
  const canEditWorkspace = isAdminRole(user?.role) || String(user?.uid || user?.id || '') === String(facultyId || '');
  const complianceStatus = useMemo(() => {
    const missingCritical = !faculty?.email || !faculty?.phone || !credentials.certificationExpiration;
    if (missingCritical) return { label: 'Needs Attention', color: '#dc2626', bg: '#fee2e2' };
    if (!documents.length) return { label: 'Review Documents', color: '#f59e0b', bg: '#fef3c7' };
    return { label: 'Compliant', color: '#16a34a', bg: '#dcfce7' };
  }, [credentials.certificationExpiration, documents.length, faculty?.email, faculty?.phone]);

  if (!faculty) return (<View style={styles.empty}><Text style={{ color: '#666' }}>Faculty not found</Text></View>);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        setWorkspaceLoading(true);
        setWorkspaceError('');
        const result = await Api.getStaffWorkspace(faculty.id);
        if (disposed) return;
        const item = result?.item && typeof result.item === 'object' ? result.item : {};
        setCredentials({
          certification: String(item?.credentials?.certification || ''),
          certificationExpiration: String(item?.credentials?.certificationExpiration || ''),
          cprExpiration: String(item?.credentials?.cprExpiration || ''),
          backgroundCheckDate: String(item?.credentials?.backgroundCheckDate || ''),
          tbTestDate: String(item?.credentials?.tbTestDate || ''),
        });
        setAvailability({
          weekdays: String(item?.availability?.weekdays || ''),
          notes: String(item?.availability?.notes || ''),
        });
        setDocuments(Array.isArray(item?.documents) ? item.documents : []);
      } catch (error) {
        if (!disposed) {
          setWorkspaceError(String(error?.message || error || 'Could not load staff workspace.'));
          setCredentials({ certification: '', certificationExpiration: '', cprExpiration: '', backgroundCheckDate: '', tbTestDate: '' });
          setAvailability({ weekdays: '', notes: '' });
          setDocuments([]);
        }
      } finally {
        if (!disposed) setWorkspaceLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [faculty.id]);

  useEffect(() => {
    const nextTab = String(initialTab || '').trim().toLowerCase();
    if (!nextTab) return;
    const allowedTabs = ['overview', 'credentials', 'caseload', 'availability', 'documents'];
    if (allowedTabs.includes(nextTab)) {
      setSelectedTab(nextTab);
    }
  }, [initialTab]);

  const openPhone = (p) => {
    if (!p) return;
    Linking.openURL(`tel:${p}`).catch(() => {
      Alert.alert('Unable to place call', 'Your device could not open the phone app.');
    });
  };

  const openEmail = (e) => {
    if (!e) return;
    Linking.openURL(`mailto:${e}`).catch(() => {
      Alert.alert('Unable to open email', 'Your device could not open the email app.');
    });
  };

  const openDocument = (url) => {
    const normalized = String(url || '').trim();
    if (!normalized) return;
    Linking.openURL(normalized).catch(() => {
      Alert.alert('Unable to open document', 'Your device could not open this document.');
    });
  };

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
    const nextCredentials = next.credentials || credentials;
    const nextAvailability = next.availability || availability;
    const validationError = getWorkspaceValidationError(nextCredentials, nextAvailability);
    if (validationError) {
      Alert.alert('Invalid input', validationError);
      return;
    }
    try {
      setWorkspaceSaving(true);
      await Api.updateStaffWorkspace(faculty.id, {
        credentials: nextCredentials,
        availability: nextAvailability,
        documents: next.documents || documents,
      });
    } catch (e) {
      Alert.alert('Save failed', String(e?.message || e || 'Could not save staff workspace.'));
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function uploadDocument() {
    if (!canEditWorkspace) return;
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
      await Api.updateStaffWorkspace(faculty.id, { credentials, availability, documents: nextDocuments });
    } catch (e) {
      Alert.alert('Upload failed', String(e?.message || e || 'Could not upload document.'));
    } finally {
      setWorkspaceSaving(false);
    }
  }

  function removeDocument(documentId) {
    if (!canEditWorkspace) return;
    const nextDocuments = documents.filter((item) => item?.id !== documentId);
    setDocuments(nextDocuments);
    persistWorkspace({ documents: nextDocuments });
  }

  return (
    <ScreenWrapper bannerTitle="Faculty Profile" style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }} style={{ flex: 1 }}>

      <View style={styles.header}>
        <Image source={avatarSourceFor(faculty)} style={styles.avatar} />
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={styles.name}>{getDisplayName(faculty)}</Text>
          <Text style={styles.role}>{getDisplayRoleLabel(faculty.role || 'Staff')}</Text>
          <Text style={styles.meta}>{formatIdForDisplay(faculty.id)}</Text>
          <View style={[styles.statusPill, { backgroundColor: complianceStatus.bg }]}>
            <Text style={[styles.statusPillText, { color: complianceStatus.color }]}>{complianceStatus.label}</Text>
          </View>
        </View>
        <View style={styles.headerActionsRight}>
          {faculty.phone ? (
            <TouchableOpacity activeOpacity={0.85} style={styles.profileIconBtn} onPress={() => openPhone(faculty.phone)}>
              <MaterialIcons name="call" size={18} color="#2563eb" />
            </TouchableOpacity>
          ) : null}
          {faculty.email ? (
            <TouchableOpacity activeOpacity={0.85} style={styles.profileIconBtn} onPress={() => openEmail(faculty.email)}>
              <MaterialIcons name="email" size={18} color="#2563eb" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.iconActionsRowFaculty}>
        <View style={styles.iconColFaculty}>
          <TouchableOpacity style={styles.iconButtonFaculty} onPress={async () => {
            try {
              const adminId = user?.id || (user?.name || 'admin');
              const threadMatch = (messages || []).find(m => {
                const senderId = m.sender?.id || m.sender?.name;
                const toIds = (m.to || []).map(t => t.id || t.name).filter(Boolean);
                const participants = new Set([String(senderId), ...toIds.map(String)]);
                return participants.has(String(adminId)) && participants.has(String(faculty.id));
              });
              if (threadMatch && (threadMatch.threadId || threadMatch.threadId === 0)) {
                navigation.navigate('ChatThread', { threadId: threadMatch.threadId });
              } else if (threadMatch && threadMatch.id) {
                navigation.navigate('ChatThread', { threadId: threadMatch.id });
              } else {
                const newThreadId = `t-${Date.now()}`;
                navigation.navigate('ChatThread', { threadId: newThreadId });
              }
            } catch (e) { console.warn('open chat failed', e); }
          }}>
            <MaterialIcons name="chat" size={20} color={isWeb ? '#fff' : '#2563eb'} />
          </TouchableOpacity>
          <Text style={styles.iconLabelFaculty}>Chat</Text>
        </View>

        <View style={styles.iconColFaculty}>
          <TouchableOpacity style={styles.iconButtonFaculty} onPress={() => setShowMemoModal(true)}>
            <MaterialIcons name="notification-important" size={20} color={isWeb ? '#fff' : '#2563eb'} />
          </TouchableOpacity>
          <Text style={styles.iconLabelFaculty}>Urgent Memo</Text>
        </View>

        <View style={styles.iconColFaculty}>
          <TouchableOpacity style={styles.iconButtonFaculty} onPress={() => navigation.navigate('UserMonitor', { initialUserId: faculty.id })}>
            <MaterialIcons name="manage-account" size={20} color={isWeb ? '#fff' : '#2563eb'} />
          </TouchableOpacity>
          <Text style={styles.iconLabelFaculty}>Manage</Text>
        </View>

        <View style={styles.iconColFaculty}>
          <TouchableOpacity style={styles.iconButtonFaculty} onPress={() => { try { navigation.push('Chats'); } catch (e) { navigation.navigate('Chats'); } }}>
            <MaterialIcons name="event" size={20} color={isWeb ? '#fff' : '#2563eb'} />
          </TouchableOpacity>
          <Text style={styles.iconLabelFaculty}>Meeting</Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'credentials', label: 'Credentials' },
          { key: 'caseload', label: 'Caseload' },
          { key: 'availability', label: 'Availability' },
          { key: 'documents', label: 'Documents' },
        ].map((tab) => (
          <TouchableOpacity key={tab.key} style={[styles.tabChip, selectedTab === tab.key ? styles.tabChipActive : null]} onPress={() => setSelectedTab(tab.key)}>
            <Text style={[styles.tabChipText, selectedTab === tab.key ? styles.tabChipTextActive : null]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {workspaceLoading ? <View style={styles.loadingWrap}><ActivityIndicator color="#2563eb" /></View> : null}
      {!workspaceLoading && workspaceError ? <Text style={styles.errorText}>{workspaceError}</Text> : null}

      {!workspaceLoading && selectedTab === 'overview' ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Profile Overview</Text>
          <Text style={styles.detailLine}>Assigned learners: {assignedChildren.length}</Text>
          <Text style={styles.detailLine}>Phone: {maskPhoneDisplay(faculty.phone) || 'Not on file'}</Text>
          <Text style={styles.detailLine}>Email: {maskEmailDisplay(faculty.email) || 'Not on file'}</Text>
          <Text style={styles.detailLine}>Certification expiration: {credentials.certificationExpiration || 'Not recorded'}</Text>
        </View>
      ) : null}

      {!workspaceLoading && selectedTab === 'credentials' ? (
        <View style={styles.sectionCard}>
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
          ) : null}
        </View>
      ) : null}

      {!workspaceLoading && selectedTab === 'caseload' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Assigned Children</Text>
          <AssignedChildrenList facultyId={faculty.id} />
        </View>
      ) : null}

      {!workspaceLoading && selectedTab === 'availability' ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Availability</Text>
          <TextInput value={availability.weekdays} onChangeText={(value) => setAvailability((current) => ({ ...current, weekdays: String(value || '').slice(0, 120) }))} editable={canEditWorkspace} placeholder="Weekdays / shift coverage" style={styles.input} maxLength={120} />
          <TextInput value={availability.notes} onChangeText={(value) => setAvailability((current) => ({ ...current, notes: String(value || '').slice(0, 2000) }))} editable={canEditWorkspace} placeholder="Availability notes" multiline style={[styles.input, styles.multilineInput]} maxLength={2000} />
          {canEditWorkspace ? (
            <TouchableOpacity style={styles.primaryButton} onPress={() => persistWorkspace({ availability })} disabled={workspaceSaving}>
              <Text style={styles.primaryButtonText}>{workspaceSaving ? 'Saving...' : 'Save Availability'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {!workspaceLoading && selectedTab === 'documents' ? (
        <View style={styles.sectionCard}>
          <View style={styles.documentHeader}>
            <Text style={styles.sectionTitle}>Documents</Text>
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
                  <MaterialIcons name="delete-outline" size={18} color="#dc2626" />
                </TouchableOpacity>
              ) : null}
            </View>
          )) : <Text style={styles.detailLine}>No documents uploaded yet.</Text>}
        </View>
      ) : null}

      <View style={{ height: 32 }} />
      </ScrollView>
      {/* Urgent admin memo modal */}
      {showMemoModal && (
        <Modal transparent visible animationType="fade">
          <TouchableWithoutFeedback onPress={() => setShowMemoModal(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' }}>
              <TouchableWithoutFeedback>
                <View style={{ width: '90%', backgroundColor: '#fff', padding: 12, borderRadius: 8 }}>
                  <Text style={{ fontWeight: '700', marginBottom: 8 }}>Send Urgent Memo</Text>
                  <TextInput placeholder="Subject" value={memoSubject} onChangeText={(value) => setMemoSubject(String(value || '').slice(0, 120))} style={{ borderWidth: 1, borderColor: '#e5e7eb', padding: 8, borderRadius: 8, marginBottom: 8 }} maxLength={120} />
                  <TextInput placeholder="Message" value={memoBody} onChangeText={(value) => setMemoBody(String(value || '').slice(0, 5000))} multiline style={{ borderWidth: 1, borderColor: '#e5e7eb', padding: 8, borderRadius: 8, height: 120, marginBottom: 12 }} maxLength={5000} />
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <TouchableOpacity onPress={() => setShowMemoModal(false)} style={{ marginRight: 8, padding: 8 }}><Text>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity onPress={async () => {
                      try {
                        const memoError = getMemoValidationError(memoSubject, memoBody);
                        if (memoError) {
                          Alert.alert('Invalid memo', memoError);
                          return;
                        }
                        await sendAdminMemo({ recipients: [{ id: faculty.id }], subject: String(memoSubject || `Message about ${faculty.name || 'staff'}`).trim(), body: String(memoBody || '').trim() });
                        Alert.alert('Sent', 'Urgent memo sent');
                        setShowMemoModal(false);
                        setMemoSubject(''); setMemoBody('');
                      } catch (e) { console.warn(e); Alert.alert('Failed', 'Could not send memo'); }
                    }} style={{ padding: 8, backgroundColor: '#2563eb', borderRadius: 8 }}><Text style={{ color: '#fff' }}>Send</Text></TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}
      
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#eee' },
  name: { fontSize: 20, fontWeight: '700' },
  role: { color: '#6b7280', marginTop: 4 },
  meta: { color: '#374151', marginTop: 6, fontSize: 13, fontWeight: '700', backgroundColor: '#f3f4f6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  statusPill: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, alignSelf: 'flex-start' },
  statusPillText: { fontWeight: '800', fontSize: 12 },
  headerActionsRight: { alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  profileIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
    backgroundColor: 'transparent',
    ...Platform.select({
      web: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e6e7ea',
        backgroundColor: '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 1.5,
        elevation: 2,
      },
      default: null,
    }),
  },
  section: { marginTop: 12 },
  sectionCard: { marginTop: 14, borderRadius: 14, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff', padding: 14 },
  sectionTitle: { fontWeight: '700', marginBottom: 6 },
  detailLine: { color: '#475569', marginTop: 6 },
  link: { color: '#0066FF', marginTop: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingWrap: { paddingVertical: 20, alignItems: 'center' },
  errorText: { color: '#b91c1c', marginBottom: 12 },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  tabChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#f1f5f9', marginRight: 8, marginBottom: 8 },
  tabChipActive: { backgroundColor: '#2563eb' },
  tabChipText: { color: '#0f172a', fontWeight: '700' },
  tabChipTextActive: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', marginTop: 10 },
  multilineInput: { minHeight: 86, textAlignVertical: 'top' },
  primaryButton: { marginTop: 12, backgroundColor: '#2563eb', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '800' },
  documentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  secondaryActionButton: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryActionButtonText: { color: '#334155', fontWeight: '700' },
  documentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  documentTitle: { fontWeight: '700', color: '#0f172a' },
  documentMeta: { marginTop: 4, color: '#64748b' },
  removeButton: { padding: 8 },
  childTile: { width: 96, padding: 8, marginRight: 8, alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#eef2f7' },
  childAvatarSmall: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#eee' },
  childTileName: { marginTop: 6, fontSize: 12, fontWeight: '700' },
  iconActionsRowFaculty: { flexDirection: 'row', marginTop: 12, justifyContent: 'space-between', alignItems: 'center' },
  iconColFaculty: { alignItems: 'center', flex: 1 },
  iconButtonFaculty: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    ...Platform.select({
      web: { borderRadius: 22, backgroundColor: '#2563eb' },
      default: null,
    }),
  },
  iconLabelFaculty: { marginTop: 6, fontWeight: '700', fontSize: 12 },
});
