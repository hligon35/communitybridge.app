import React, { useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useData } from '../DataContext';
import { useAuth } from '../AuthContext';
import { USER_ROLES, isAdminRole, isStaffRole, normalizeUserRole } from '../core/tenant/models';
import { useTherapySessionWorkspace } from '../features/sessionTracking/hooks/useTherapySessionWorkspace';
import { THERAPY_ROLE_LABELS } from '../utils/roleTerminology';
import * as Api from '../Api';

export default function TapLogsScreen() {
  const route = useRoute();
  const { childId, sessionPreview } = route.params || {};
  const { user } = useAuth();
  const { children = [], fetchAndSync, activeSeedPreset = '', seededTapEventsByChild = {} } = useData();
  const role = normalizeUserRole(user?.role);
  const isTherapist = role === USER_ROLES.THERAPIST;
  const canManageSession = isAdminRole(user?.role) || isStaffRole(user?.role);
  const child = (children || []).find((entry) => entry.id === childId) || null;
  const preview = Boolean(sessionPreview) || !child;
  const inactivePreview = isTherapist && preview;
  const seededRecentEvents = activeSeedPreset === 'screenshot' && child?.id
    ? (Array.isArray(seededTapEventsByChild?.[child.id]) ? seededTapEventsByChild[child.id] : [])
    : [];
  const workspace = useTherapySessionWorkspace({ child, preview, canManageSession, fetchAndSync, seededRecentEvents });
  const items = inactivePreview ? [] : [...(workspace.recentEvents || [])];

  const [pendingRequest, setPendingRequest] = useState(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const sessionId = workspace?.activeSession?.id || null;

  function openRequest(action, item) {
    if (!sessionId) {
      Alert.alert('No active session', 'Change requests can only be filed against the current session.');
      return;
    }
    if (!item?.feedId) {
      Alert.alert('Cannot request change', 'This event is not yet synced. Try again in a moment.');
      return;
    }
    setReason('');
    setPendingRequest({ action, eventId: item.feedId, label: item.label || 'event' });
  }

  async function submitRequest() {
    if (!pendingRequest || submitting) return;
    setSubmitting(true);
    try {
      await Api.requestTherapyEventChange({
        sessionId,
        eventId: pendingRequest.eventId,
        action: pendingRequest.action,
        reason: reason.trim(),
      });
      setPendingRequest(null);
      setReason('');
      Alert.alert('Request submitted', 'An admin will review your request and follow up.');
    } catch (e) {
      const msg = e?.message || 'Could not submit change request.';
      Alert.alert('Request failed', String(msg));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenWrapper bannerTitle="Tap Logs" style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Tap Logs</Text>
        <Text style={styles.subtitle}>{inactivePreview ? 'Start a sessions to activate' : `Review logged session events. Submit an edit or removal request to route to admin via the audit log; the ${THERAPY_ROLE_LABELS.therapist.toLowerCase()} review screen is also available from the left rail.`}</Text>
        {inactivePreview ? (
          <View style={[styles.card, styles.inactiveCard]}>
            <Text style={styles.inactiveTitle}>Start a sessions to activate</Text>
            <Text style={styles.empty}>No recorded data available.</Text>
          </View>
        ) : null}
        {items.length ? items.map((item) => (
          <View key={item.feedId || `${item.label}-${item.occurredAt}`} style={styles.card}>
            <View style={styles.cardTextWrap}>
              <Text style={styles.cardTitle}>{item.label}</Text>
              <View style={styles.detailActionRow}>
                <Text style={[styles.cardMeta, styles.cardMetaInline]}>{item.detailLabel || item.intensity || 'Logged event'}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.secondaryBtn, styles.secondaryBtnInline]} onPress={() => openRequest('edit', item)}>
                    <Text style={styles.secondaryBtnText}>Request Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.secondaryBtn, styles.secondaryBtnInline]} onPress={() => openRequest('remove', item)}>
                    <Text style={styles.secondaryBtnText}>Request Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.cardMeta}>{item.occurredAt ? new Date(item.occurredAt).toLocaleString() : 'Unknown time'}</Text>
            </View>
          </View>
        )) : (!inactivePreview ? <Text style={styles.empty}>No logged events yet.</Text> : null)}
      </ScrollView>

      <Modal visible={!!pendingRequest} transparent animationType="fade" onRequestClose={() => setPendingRequest(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{pendingRequest?.action === 'remove' ? 'Request removal' : 'Request edit'}</Text>
            <Text style={styles.modalSubtitle} numberOfLines={2}>Event: {pendingRequest?.label || ''}</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Reason (optional, max 1000 chars)"
              multiline
              numberOfLines={4}
              style={styles.modalInput}
              maxLength={1000}
              editable={!submitting}
            />
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => { if (!submitting) setPendingRequest(null); }}
                disabled={submitting}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary, submitting ? styles.modalBtnDisabled : null]}
                onPress={submitRequest}
                disabled={submitting}
              >
                <Text style={styles.modalBtnPrimaryText}>{submitting ? 'Submitting...' : 'Submit'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { marginTop: 8, color: '#64748b', lineHeight: 20 },
  card: { marginTop: 14, borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff', padding: 14 },
  cardTextWrap: { flex: 1 },
  cardTitle: { fontWeight: '800', color: '#0f172a' },
  detailActionRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center' },
  cardMeta: { marginTop: 6, color: '#64748b' },
  cardMetaInline: { marginTop: 0, flex: 1, paddingRight: 12 },
  actions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' },
  secondaryBtn: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#e2e8f0' },
  secondaryBtnInline: { marginTop: 0, marginLeft: 8 },
  secondaryBtnText: { color: '#0f172a', fontWeight: '700' },
  inactiveCard: { opacity: 0.6 },
  inactiveTitle: { fontWeight: '800', color: '#0f172a' },
  empty: { marginTop: 20, color: '#64748b' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 480, backgroundColor: '#fff', borderRadius: 16, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  modalSubtitle: { marginTop: 4, color: '#64748b' },
  modalInput: { marginTop: 12, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 10, color: '#0f172a', minHeight: 100, textAlignVertical: 'top' },
  modalRow: { marginTop: 16, flexDirection: 'row', justifyContent: 'flex-end' },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, marginLeft: 8 },
  modalBtnGhost: { backgroundColor: '#f1f5f9' },
  modalBtnGhostText: { color: '#0f172a', fontWeight: '700' },
  modalBtnPrimary: { backgroundColor: '#2563eb' },
  modalBtnPrimaryText: { color: '#fff', fontWeight: '700' },
  modalBtnDisabled: { opacity: 0.6 },
});