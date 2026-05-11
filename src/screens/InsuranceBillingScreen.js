import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import AppDropdown from '../components/AppDropdown';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { useTenant } from '../core/tenant/TenantContext';
import { isAdminRole, isBcbaRole, normalizeUserRole, USER_ROLES } from '../core/tenant/models';
import { childHasParent, findLinkedParentId } from '../utils/directoryLinking';
import * as Api from '../Api';

function Block({ title, children, style }) {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function normalizeStatus(value, fallback = 'pending') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
}

function summarizeAuthorization(children = []) {
  return (Array.isArray(children) ? children : []).reduce((summary, child) => {
    const insurance = child?.insurance && typeof child.insurance === 'object' ? child.insurance : {};
    const approvedHours = Number(insurance.approvedHours || 0);
    const remainingHours = Number(insurance.remainingHours || 0);
    const status = normalizeStatus(insurance.authorizationStatus || child?.insuranceStatus, 'pending review');
    summary.total += 1;
    summary.approvedHours += Number.isFinite(approvedHours) ? approvedHours : 0;
    summary.remainingHours += Number.isFinite(remainingHours) ? remainingHours : 0;
    if (status.includes('approved') || status.includes('active')) summary.approved += 1;
    else if (status.includes('expired')) summary.expired += 1;
    else summary.pending += 1;
    const expirationDate = Date.parse(String(insurance.expirationDate || insurance.effectiveDate || ''));
    if (Number.isFinite(expirationDate) && expirationDate <= Date.now() + (1000 * 60 * 60 * 24 * 30)) {
      summary.expiringSoon += 1;
    }
    return summary;
  }, { total: 0, approvedHours: 0, remainingHours: 0, approved: 0, pending: 0, expired: 0, expiringSoon: 0 });
}

function summarizeVerification(children = []) {
  return (Array.isArray(children) ? children : []).reduce((summary, child) => {
    const insurance = child?.insurance && typeof child.insurance === 'object' ? child.insurance : {};
    const timesheetStatus = normalizeStatus(insurance.timesheetStatus, 'pending verification');
    const parentSignatureStatus = normalizeStatus(insurance.parentSignatureStatus, 'pending');
    const sessionStatus = normalizeStatus(insurance.sessionStatus, 'pending verification');
    summary.total += 1;
    if (timesheetStatus.includes('verified')) summary.timesheetsVerified += 1;
    if (parentSignatureStatus.includes('received') || parentSignatureStatus.includes('verified') || parentSignatureStatus.includes('signed')) summary.signaturesReceived += 1;
    if (sessionStatus.includes('verified') || sessionStatus.includes('approved')) summary.sessionsVerified += 1;
    if (timesheetStatus.includes('pending') || parentSignatureStatus.includes('pending') || sessionStatus.includes('pending')) summary.pending += 1;
    return summary;
  }, { total: 0, timesheetsVerified: 0, signaturesReceived: 0, sessionsVerified: 0, pending: 0 });
}

export default function InsuranceBillingScreen() {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const tenant = useTenant() || {};
  const {
    children = [],
    parents = [],
    setChildren,
    seededOrgSettings = {},
  } = useData();
  const role = normalizeUserRole(user?.role);
  const isBcba = isBcbaRole(user?.role);
  const isAdmin = isAdminRole(user?.role);
  const isParent = role === USER_ROLES.PARENT;
  const [busy, setBusy] = useState(false);
  const [selectedCampusId, setSelectedCampusId] = useState('');
  const [selectedScope, setSelectedScope] = useState('all');
  const [orgSettings, setOrgSettings] = useState({});

  const linkedParentId = useMemo(() => {
    if (!isParent) return null;
    return findLinkedParentId(user, parents) || user?.id || null;
  }, [isParent, parents, user]);

  const linkedChild = useMemo(() => {
    if (!isParent || !linkedParentId) return null;
    return (Array.isArray(children) ? children : []).find((child) => childHasParent(child, linkedParentId)) || null;
  }, [children, isParent, linkedParentId]);

  const campusOptions = useMemo(() => {
    const campuses = Array.isArray(tenant?.campuses) ? tenant.campuses : [];
    return campuses.map((campus) => ({ value: String(campus?.id || '').trim(), label: campus?.name || 'Campus' })).filter((item) => item.value);
  }, [tenant]);
  const currentCampusId = String(tenant?.currentCampus?.id || user?.campusId || '').trim();
  const effectiveCampusId = isParent ? '' : (isAdmin ? selectedCampusId : currentCampusId);
  const campusScopedChildren = useMemo(() => {
    if (isParent) return [];
    if (!effectiveCampusId) return Array.isArray(children) ? children : [];
    return (Array.isArray(children) ? children : []).filter((child) => String(child?.campusId || '').trim() === effectiveCampusId);
  }, [children, effectiveCampusId, isParent]);
  const roomOptions = useMemo(() => Array.from(new Set(campusScopedChildren.map((child) => String(child?.room || '').trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right)), [campusScopedChildren]);
  const scopeOptions = useMemo(() => {
    const roomItems = roomOptions.map((room) => ({ value: `room:${room}`, label: `Room: ${room}` }));
    const studentItems = campusScopedChildren
      .map((child) => ({ value: `student:${String(child?.id || '').trim()}`, label: child?.name || 'Learner' }))
      .filter((item) => item.value !== 'student:')
      .sort((left, right) => left.label.localeCompare(right.label));
    return [{ value: 'all', label: 'All students' }, ...roomItems, ...studentItems];
  }, [campusScopedChildren, roomOptions]);
  const selectedScopeOption = useMemo(() => scopeOptions.find((item) => item.value === selectedScope) || scopeOptions[0] || { value: 'all', label: 'All students' }, [scopeOptions, selectedScope]);
  const scopedChildren = useMemo(() => {
    if (isParent) return linkedChild ? [linkedChild] : [];
    if (selectedScope === 'all') return campusScopedChildren;
    if (selectedScope.startsWith('room:')) {
      const room = selectedScope.slice(5);
      return campusScopedChildren.filter((child) => String(child?.room || '').trim() === room);
    }
    if (selectedScope.startsWith('student:')) {
      const childId = selectedScope.slice(8);
      return campusScopedChildren.filter((child) => String(child?.id || '').trim() === childId);
    }
    return campusScopedChildren;
  }, [campusScopedChildren, isParent, linkedChild, selectedScope]);
  const selectedLearner = useMemo(() => {
    if (isParent) return linkedChild;
    if (!selectedScope.startsWith('student:')) return null;
    return scopedChildren[0] || null;
  }, [isParent, linkedChild, scopedChildren, selectedScope]);

  const insurance = useMemo(() => {
    const childInsuranceSource = isParent ? linkedChild : selectedLearner;
    const childInsurance = childInsuranceSource?.insurance && typeof childInsuranceSource.insurance === 'object' ? childInsuranceSource.insurance : {};
    return {
      ...(isParent ? (user?.insurance || {}) : {}),
      ...childInsurance,
    };
  }, [isParent, linkedChild, selectedLearner, user]);

  const childName = useMemo(() => {
    if (!isParent && selectedScope === 'all') return `${scopedChildren.length} student${scopedChildren.length === 1 ? '' : 's'}`;
    if (!isParent && selectedScope.startsWith('room:')) return `${selectedScope.slice(5)} room`;
    const targetChild = isParent ? linkedChild : selectedLearner;
    if (targetChild?.name) return String(targetChild.name);
    const firstName = String(targetChild?.firstName || '').trim();
    const lastName = String(targetChild?.lastName || '').trim();
    return `${firstName} ${lastName}`.trim() || 'Your child';
  }, [isParent, linkedChild, scopedChildren.length, selectedLearner, selectedScope]);

  const billingConfig = useMemo(() => {
    return orgSettings?.billing && typeof orgSettings.billing === 'object' ? orgSettings.billing : {};
  }, [orgSettings]);

  const visibleContactOptions = useMemo(() => {
    const options = [];
    const email = String(billingConfig.contactEmail || '').trim();
    const phone = String(billingConfig.contactPhone || '').trim();
    if (billingConfig.showContactEmail !== false && email) {
      options.push({ type: 'email', label: email, url: `mailto:${email}` });
    }
    if (billingConfig.showContactPhone !== false && phone) {
      const digits = phone.replace(/[^\d+]/g, '');
      if (digits.length >= 7) options.push({ type: 'phone', label: phone, url: `tel:${digits}` });
    }
    return options;
  }, [billingConfig]);

  useEffect(() => {
    if (isParent || !isAdmin) return;
    if (!selectedCampusId && (currentCampusId || campusOptions[0]?.value)) {
      setSelectedCampusId(currentCampusId || campusOptions[0]?.value || '');
      return;
    }
    if (selectedCampusId && !campusOptions.some((item) => item.value === selectedCampusId)) {
      setSelectedCampusId(currentCampusId || campusOptions[0]?.value || '');
    }
  }, [campusOptions, currentCampusId, isAdmin, isParent, selectedCampusId]);

  useEffect(() => {
    if (isParent) return;
    if (!scopeOptions.some((item) => item.value === selectedScope)) {
      setSelectedScope(scopeOptions[0]?.value || 'all');
    }
  }, [isParent, scopeOptions, selectedScope]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (seededOrgSettings && Object.keys(seededOrgSettings).length) {
        if (mounted) setOrgSettings(seededOrgSettings);
        return;
      }
      try {
        const result = await Api.getOrgSettings();
        if (!mounted) return;
        setOrgSettings(result?.item && typeof result.item === 'object' ? result.item : {});
      } catch (_) {
        if (mounted) setOrgSettings({});
      }
    })();
    return () => {
      mounted = false;
    };
  }, [seededOrgSettings]);

  function openEmailAddress(value) {
    const match = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? `mailto:${match[0]}` : '';
  }

  function openPhoneNumber(value) {
    const digits = String(value || '').replace(/[^\d+]/g, '');
    return digits.length >= 7 ? `tel:${digits}` : '';
  }

  function openChatsInbox() {
    const parentNavigation = navigation.getParent?.();
    if (parentNavigation?.navigate) {
      parentNavigation.navigate('Chats', { screen: 'ChatsList' });
      return true;
    }
    try {
      navigation.navigate('Chats', { screen: 'ChatsList' });
      return true;
    } catch (_) {
      Alert.alert('Messages unavailable', 'We could not open the Messages workspace from this screen.');
      return false;
    }
  }

  function openParentBilling() {
    const paymentPortalUrl = String(billingConfig.paymentPortalUrl || '').trim();
    if (paymentPortalUrl) {
      Linking.openURL(paymentPortalUrl).catch(() => {
        Alert.alert('Billing portal unavailable', 'We could not open the payment portal on this device.');
      });
      return;
    }
    const emailUrl = openEmailAddress(insurance.billingContact || insurance.contact || '');
    const phoneUrl = openPhoneNumber(insurance.billingContact || insurance.contact || '');
    const target = emailUrl || phoneUrl;
    if (target) {
      Linking.openURL(target).catch(() => {
        Alert.alert('Billing contact unavailable', 'We could not open the billing contact on this device.');
      });
      return;
    }
    Alert.alert('Billing portal unavailable', 'No organization billing portal has been configured yet.');
  }

  function openParentContact() {
    if (!visibleContactOptions.length) {
      Alert.alert('Contact unavailable', 'No organization billing contact has been configured yet.');
      return;
    }
    if (visibleContactOptions.length === 1) {
      Linking.openURL(visibleContactOptions[0].url).catch(() => {
        Alert.alert('Contact unavailable', 'We could not open the selected billing contact on this device.');
      });
      return;
    }
    Alert.alert(
      'Contact billing',
      'Choose how you want to contact billing.',
      [
        ...visibleContactOptions.map((option) => ({
          text: option.type === 'phone' ? `Call ${option.label}` : `Email ${option.label}`,
          onPress: () => {
            Linking.openURL(option.url).catch(() => {
              Alert.alert('Contact unavailable', 'We could not open the selected billing contact on this device.');
            });
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function persistLearnerInsurance(nextInsurance, successMessage) {
    if (!selectedLearner?.id) return;
    const nextChild = {
      ...selectedLearner,
      insurance: nextInsurance,
      insuranceStatus: nextInsurance.authorizationStatus || selectedLearner?.insuranceStatus || '',
    };
    try {
      setBusy(true);
      await Api.mergeDirectory({ children: [nextChild] });
      setChildren((current) => (current || []).map((child) => (child?.id === nextChild.id ? { ...child, ...nextChild } : child)));
      Alert.alert('Billing updated', successMessage);
    } catch (error) {
      Alert.alert('Update failed', String(error?.message || error || 'Could not update billing details.'));
    } finally {
      setBusy(false);
    }
  }

  async function approveAuthorization() {
    const nextInsurance = {
      ...(insurance || {}),
      authorizationStatus: 'approved',
    };
    await persistLearnerInsurance(nextInsurance, `${childName} authorization was marked approved.`);
  }

  async function approveVerification() {
    const nextInsurance = {
      ...(insurance || {}),
      timesheetStatus: 'verified',
      parentSignatureStatus: 'received',
      sessionStatus: 'verified',
    };
    await persistLearnerInsurance(nextInsurance, `${childName} verification was marked complete.`);
  }

  const useCompactContent = !isParent && Platform.OS !== 'web' && width < 900;
  const authorizationSummary = useMemo(() => summarizeAuthorization(scopedChildren), [scopedChildren]);
  const verificationSummary = useMemo(() => summarizeVerification(scopedChildren), [scopedChildren]);
  const showStudentActions = !isParent && !isBcba && Boolean(selectedLearner?.id);
  const selectedCampusLabel = useMemo(() => campusOptions.find((option) => option.value === effectiveCampusId)?.label || tenant?.currentCampus?.name || 'Current campus', [campusOptions, effectiveCampusId, tenant]);

  return (
    <ScreenWrapper
      bannerLeft={null}
      bannerRight={null}
      bannerTitleLeft={null}
      mobileHeaderBelow={null}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={[styles.content, useCompactContent ? styles.contentCompact : null]} showsVerticalScrollIndicator={false}>
        {isParent ? (
          <Block title="Digital Insurance Card">
            <View style={styles.digitalCard}>
              <Text style={styles.digitalCardName}>{childName}</Text>
              <Text style={styles.digitalCardPlan}>{insurance.planName || insurance.provider || 'Insurance plan on file'}</Text>
              <View style={styles.digitalCardGrid}>
                <View style={styles.digitalCardCell}>
                  <Text style={styles.digitalCardLabel}>Member ID</Text>
                  <Text style={styles.digitalCardValue}>{insurance.memberId || 'Not available'}</Text>
                </View>
                <View style={styles.digitalCardCell}>
                  <Text style={styles.digitalCardLabel}>Group</Text>
                  <Text style={styles.digitalCardValue}>{insurance.groupNumber || insurance.groupId || 'Not available'}</Text>
                </View>
                <View style={styles.digitalCardCell}>
                  <Text style={styles.digitalCardLabel}>Authorization</Text>
                  <Text style={styles.digitalCardValue}>{insurance.authorizationStatus || 'On file'}</Text>
                </View>
                <View style={styles.digitalCardCell}>
                  <Text style={styles.digitalCardLabel}>Effective</Text>
                  <Text style={styles.digitalCardValue}>{insurance.expirationDate || insurance.effectiveDate || 'Not available'}</Text>
                </View>
              </View>
            </View>
            <View style={styles.parentActionRow}>
              <TouchableOpacity style={styles.primaryButton} onPress={openParentBilling}>
                <Text style={styles.primaryButtonText}>Payment Portal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={openParentContact}>
                <Text style={styles.secondaryButtonText}>Contact</Text>
              </TouchableOpacity>
            </View>
            {visibleContactOptions.length ? (
              <View style={styles.parentContactList}>
                {visibleContactOptions.map((option) => (
                  <Text key={`${option.type}-${option.label}`} style={styles.parentContactText}>
                    {option.type === 'phone' ? 'Phone' : 'Email'}: <Text style={styles.rowValue}>{option.label}</Text>
                  </Text>
                ))}
              </View>
            ) : null}
          </Block>
        ) : (
          <>
            <View style={styles.filterPanel}>
              <View style={[styles.filterRow, isAdmin ? styles.filterRowAdmin : null]}>
                {isAdmin ? (
                  <AppDropdown
                    accessibilityLabel="Select campus"
                    containerStyle={styles.centeredFilterWrap}
                    minMenuWidth={220}
                    onSelect={setSelectedCampusId}
                    options={campusOptions}
                    placeholder="Campus"
                    selectedValue={selectedCampusId}
                    textStyle={styles.filterDropdownValue}
                    value={selectedCampusLabel}
                    width={220}
                  />
                ) : null}
                <AppDropdown
                  accessibilityLabel="Filter by campus room or student"
                  containerStyle={styles.centeredFilterWrap}
                  minMenuWidth={260}
                  onSelect={setSelectedScope}
                  options={scopeOptions}
                  placeholder="Scope"
                  selectedValue={selectedScopeOption.value}
                  textStyle={styles.filterDropdownValue}
                  value={selectedScopeOption.label}
                  width={260}
                />
              </View>
              <Text style={styles.filterHintText}>{selectedScope === 'all' ? `Showing all students for ${selectedCampusLabel}.` : selectedScope.startsWith('room:') ? `Showing students assigned to ${selectedScope.slice(5)} at ${selectedCampusLabel}.` : `Showing the billing record for ${childName} at ${selectedCampusLabel}.`}</Text>
            </View>

            {!scopedChildren.length ? <Text style={styles.emptyText}>No students are available for the selected campus filter.</Text> : null}

            <View style={[styles.splitRow, width < 900 ? styles.splitRowStacked : null]}>
              <Block title="Authorizations" style={styles.splitCard}>
                {selectedLearner ? (
                  <>
                    <Text style={styles.rowText}>Hours approved: <Text style={styles.rowValue}>{insurance.approvedHours || 'N/A'}</Text></Text>
                    <Text style={styles.rowText}>Hours remaining: <Text style={styles.rowValue}>{insurance.remainingHours || 'N/A'}</Text></Text>
                    <Text style={styles.rowText}>Expiration date: <Text style={styles.rowValue}>{insurance.expirationDate || 'N/A'}</Text></Text>
                    <Text style={styles.rowText}>{isBcba ? `Reviewing persisted authorization status for ${childName}.` : `Update the selected learner authorization record for ${childName}.`}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.rowText}>Students in scope: <Text style={styles.rowValue}>{authorizationSummary.total || 0}</Text></Text>
                    <Text style={styles.rowText}>Authorizations approved: <Text style={styles.rowValue}>{authorizationSummary.approved}</Text></Text>
                    <Text style={styles.rowText}>Pending review: <Text style={styles.rowValue}>{authorizationSummary.pending}</Text></Text>
                    <Text style={styles.rowText}>Expiring within 30 days: <Text style={styles.rowValue}>{authorizationSummary.expiringSoon}</Text></Text>
                    <Text style={styles.rowText}>Hours remaining across scope: <Text style={styles.rowValue}>{authorizationSummary.remainingHours}</Text></Text>
                  </>
                )}
                {showStudentActions ? <TouchableOpacity style={[styles.secondaryButton, styles.splitCardBottomButton, busy ? styles.secondaryButtonDisabled : null]} disabled={busy || !selectedLearner?.id} onPress={approveAuthorization}><Text style={[styles.secondaryButtonText, busy ? styles.secondaryButtonTextDisabled : null]}>{busy ? 'Saving...' : 'Approve Authorization'}</Text></TouchableOpacity> : null}
              </Block>

              <Block title="Session verification" style={styles.splitCard}>
                {selectedLearner ? (
                  <>
                    <Text style={styles.rowText}>Timesheets: <Text style={styles.rowValue}>{insurance.timesheetStatus || 'Pending verification'}</Text></Text>
                    <Text style={styles.rowText}>Parent signatures: <Text style={styles.rowValue}>{insurance.parentSignatureStatus || 'No signature on file'}</Text></Text>
                    <Text style={styles.rowText}>Session status: <Text style={styles.rowValue}>{insurance.sessionStatus || 'Pending verification'}</Text></Text>
                    <Text style={styles.rowText}>{isBcba ? `Reviewing persisted verification status for ${childName}.` : `Approve timesheet, signature, and session verification for ${childName}.`}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.rowText}>Students in scope: <Text style={styles.rowValue}>{verificationSummary.total || 0}</Text></Text>
                    <Text style={styles.rowText}>Timesheets verified: <Text style={styles.rowValue}>{verificationSummary.timesheetsVerified}</Text></Text>
                    <Text style={styles.rowText}>Parent signatures received: <Text style={styles.rowValue}>{verificationSummary.signaturesReceived}</Text></Text>
                    <Text style={styles.rowText}>Sessions verified: <Text style={styles.rowValue}>{verificationSummary.sessionsVerified}</Text></Text>
                    <Text style={styles.rowText}>Pending verification items: <Text style={styles.rowValue}>{verificationSummary.pending}</Text></Text>
                  </>
                )}
                {showStudentActions ? <TouchableOpacity style={[styles.primaryButton, styles.splitCardBottomButton, busy ? styles.primaryButtonDisabled : null]} disabled={busy || !selectedLearner?.id} onPress={approveVerification}><Text style={styles.primaryButtonText}>{busy ? 'Saving...' : 'Approve Verification'}</Text></TouchableOpacity> : null}
              </Block>
            </View>
          </>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  contentCompact: { padding: 8 },
  errorText: { color: '#b91c1c', marginTop: 12 },
  filterPanel: { marginTop: 12, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16, alignItems: 'center' },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', width: '100%' },
  filterRowAdmin: { justifyContent: 'center' },
  centeredFilterWrap: { minWidth: 200, maxWidth: 280 },
  filterDropdownValue: { flex: 1, color: '#0f172a', fontWeight: '700', fontSize: 15, textAlign: 'center' },
  filterHintText: { marginTop: 10, color: '#64748b', textAlign: 'center', lineHeight: 20 },
  emptyText: { marginTop: 14, color: '#64748b', textAlign: 'center' },
  splitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'stretch', marginTop: 12, gap: 12 },
  splitRowStacked: { flexDirection: 'column' },
  card: { marginTop: 12, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 12 },
  splitCard: { flex: 1, marginTop: 0 },
  splitCardBottomButton: { marginTop: 'auto' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  rowText: { color: '#475569', lineHeight: 20, marginBottom: 8 },
  rowValue: { fontWeight: '800' },
  digitalCard: { borderRadius: 18, backgroundColor: '#1e3a8a', padding: 18 },
  digitalCardName: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  digitalCardPlan: { marginTop: 6, color: '#dbeafe', fontSize: 15, fontWeight: '700' },
  digitalCardGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 18, justifyContent: 'space-between' },
  digitalCardCell: { width: '48%', marginBottom: 14 },
  digitalCardLabel: { color: '#bfdbfe', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  digitalCardValue: { marginTop: 4, color: '#ffffff', fontSize: 15, fontWeight: '700' },
  parentActionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 12 },
  parentContactList: { marginTop: 10 },
  parentContactText: { color: '#475569', lineHeight: 20 },
  primaryButton: { marginTop: 10, alignSelf: 'flex-start', borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14 },
  primaryButtonDisabled: { opacity: 0.55 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  secondaryButton: { marginTop: 10, marginRight: 10, alignSelf: 'flex-start', borderRadius: 12, backgroundColor: '#e2e8f0', paddingVertical: 12, paddingHorizontal: 14 },
  secondaryButtonText: { color: '#0f172a', fontWeight: '800' },
  secondaryButtonDisabled: { opacity: 0.6 },
  secondaryButtonTextDisabled: { color: '#475569' },
});
