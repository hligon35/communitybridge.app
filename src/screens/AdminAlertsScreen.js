import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { isBcbaRole } from '../core/tenant/models';
import * as Api from '../Api';

export default function AdminAlertsScreen() {
  const { user } = useAuth();
  const { therapists = [], activeSeedPreset = '', seededStaffWorkspacesById = {}, seededAuditLogs = [] } = useData();
  const isBcba = isBcbaRole(user?.role);
  const [tab, setTab] = useState('tracker');
  const [staffWorkspaceMap, setStaffWorkspaceMap] = useState({});
  const [auditItems, setAuditItems] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (activeSeedPreset === 'screenshot') {
        setLoadError('');
        setStaffWorkspaceMap(seededStaffWorkspacesById && typeof seededStaffWorkspacesById === 'object' ? seededStaffWorkspacesById : {});
        setAuditItems(Array.isArray(seededAuditLogs) ? seededAuditLogs : []);
        return;
      }
      try {
        setLoadError('');
        const [workspaceResult, auditResult] = await Promise.all([
          Api.listStaffWorkspaces((therapists || []).map((staff) => staff?.id)),
          Api.getAuditLogs(16).catch(() => ({ items: [] })),
        ]);
        if (!mounted) return;
        const next = {};
        (workspaceResult?.items || []).forEach((item) => {
          if (item?.id) next[item.id] = item;
        });
        setStaffWorkspaceMap(next);
        setAuditItems(Array.isArray(auditResult?.items) ? auditResult.items : []);
      } catch (error) {
        if (mounted) {
          setLoadError(String(error?.message || error || 'Could not load compliance data.'));
          setStaffWorkspaceMap({});
          setAuditItems([]);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeSeedPreset, seededAuditLogs, seededStaffWorkspacesById, therapists]);

  const complianceItems = useMemo(() => {
    return (therapists || []).map((staff, index) => {
      const workspace = staffWorkspaceMap[staff?.id] || {};
      const exp = String(workspace?.credentials?.certificationExpiration || '').trim();
      const docs = Array.isArray(workspace?.documents) ? workspace.documents : [];
      const expiresAt = exp ? new Date(exp).getTime() : 0;
      const level = !exp || expiresAt < Date.now() ? 'red' : expiresAt < Date.now() + (1000 * 60 * 60 * 24 * 30) || !docs.length ? 'yellow' : 'green';
      return {
        id: staff?.id || `${index}`,
        name: staff?.name || 'Staff member',
        role: staff?.role || 'Staff',
        expiration: exp || 'Not set',
        documents: docs.length,
        level,
      };
    });
  }, [staffWorkspaceMap, therapists]);

  const selectedStaff = useMemo(() => {
    const match = complianceItems.find((item) => item.id === selectedStaffId);
    return match || complianceItems[0] || null;
  }, [complianceItems, selectedStaffId]);

  useEffect(() => {
    if (!selectedStaffId && complianceItems[0]?.id) {
      setSelectedStaffId(complianceItems[0].id);
      return;
    }
    if (selectedStaffId && !complianceItems.some((item) => item.id === selectedStaffId)) {
      setSelectedStaffId(complianceItems[0]?.id || '');
    }
  }, [complianceItems, selectedStaffId]);

  async function uploadComplianceDocument() {
    if (isBcba || !selectedStaff?.id) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: false, multiple: false, type: '*/*' });
      if (picked?.canceled) return;
      const asset = Array.isArray(picked?.assets) ? picked.assets[0] : null;
      if (!asset?.uri) return;

      setUploading(true);
      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: asset.name || `compliance-document-${Date.now()}`,
        type: asset.mimeType || asset.type || 'application/octet-stream',
      });

      const uploaded = await Api.uploadMedia(formData);
      const existingWorkspace = staffWorkspaceMap[selectedStaff.id] || {};
      const existingDocuments = Array.isArray(existingWorkspace?.documents) ? existingWorkspace.documents : [];
      const nextDocuments = [
        {
          id: `staff-doc-${Date.now()}`,
          title: asset.name || 'Compliance document',
          url: uploaded?.url || '',
          uploadedAt: new Date().toISOString(),
          mimeType: asset.mimeType || asset.type || '',
        },
        ...existingDocuments,
      ].filter((item) => item?.url);

      const result = await Api.updateStaffWorkspace(selectedStaff.id, {
        credentials: existingWorkspace?.credentials || {},
        availability: existingWorkspace?.availability || {},
        documents: nextDocuments,
        createdAt: existingWorkspace?.createdAt,
      });

      setStaffWorkspaceMap((current) => ({
        ...(current || {}),
        [selectedStaff.id]: {
          ...(existingWorkspace || {}),
          ...(result?.item || {}),
          documents: nextDocuments,
        },
      }));
    } catch (error) {
      setLoadError(String(error?.message || error || 'Could not upload the compliance document.'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <ScreenWrapper style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabCarouselContent} style={styles.tabCarousel}>
          <View style={styles.tabRow}>
          {[
            { key: 'tracker', label: 'Credential Tracker' },
            { key: 'alerts', label: 'Expiration Alerts' },
            { key: 'documents', label: 'Document Uploads' },
            { key: 'audit', label: 'Audit Log' },
          ].map((item) => (
            <TouchableOpacity key={item.key} style={[styles.tabButton, tab === item.key ? styles.tabButtonActive : null]} onPress={() => setTab(item.key)}>
              <Text style={[styles.tabButtonText, tab === item.key ? styles.tabButtonTextActive : null]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
          </View>
        </ScrollView>

        {(tab === 'tracker' || tab === 'alerts') ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{tab === 'tracker' ? 'Credential tracker' : 'Expiration alerts'}</Text>
            {complianceItems.map((item) => (
              <TouchableOpacity key={item.id} style={[styles.row, item.id === selectedStaff?.id ? styles.rowSelected : null]} onPress={() => setSelectedStaffId(item.id)} disabled={tab !== 'documents'}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.name} • {item.role}</Text>
                  <Text style={styles.rowText}>Certification: {item.expiration}</Text>
                  <Text style={styles.rowText}>Documents: {item.documents}</Text>
                </View>
                <View style={[styles.levelPill, item.level === 'red' ? styles.levelRed : item.level === 'yellow' ? styles.levelYellow : styles.levelGreen]}>
                  <Text style={[styles.levelText, item.level === 'red' ? styles.levelTextRed : item.level === 'yellow' ? styles.levelTextYellow : styles.levelTextGreen]}>{item.level.toUpperCase()}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {tab === 'documents' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Document uploads</Text>
            <Text style={styles.rowText}>{selectedStaff ? `Selected staff member: ${selectedStaff.name}` : 'Select a staff member to manage compliance documents.'}</Text>
            <Text style={styles.rowText}>{isBcba ? 'BCBA can review uploaded compliance documents here.' : 'Upload a document to the selected staff workspace and store it with the compliance record.'}</Text>
            {!isBcba ? <TouchableOpacity style={[styles.primaryButton, uploading ? styles.primaryButtonDisabled : null]} disabled={uploading || !selectedStaff} onPress={uploadComplianceDocument}><Text style={styles.primaryButtonText}>{uploading ? 'Uploading...' : 'Upload Document'}</Text></TouchableOpacity> : null}
          </View>
        ) : null}

        {tab === 'audit' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Audit log</Text>
            {auditItems.length ? auditItems.slice(0, 12).map((item, index) => <Text key={item?.id || index} style={styles.rowText}>{String(item?.action || 'audit.event')} • {item?.createdAt ? new Date(item.createdAt).toLocaleString() : 'Unknown time'}</Text>) : <Text style={styles.rowText}>No audit activity available yet.</Text>}
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  errorText: { color: '#b91c1c', marginTop: 12 },
  tabCarousel: { marginTop: 14 },
  tabCarouselContent: { paddingRight: 8 },
  tabRow: { flexDirection: 'row' },
  tabButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f1f5f9', marginRight: 8, marginBottom: 8 },
  tabButtonActive: { backgroundColor: '#2563eb' },
  tabButtonText: { color: '#0f172a', fontWeight: '700' },
  tabButtonTextActive: { color: '#ffffff' },
  card: { marginTop: 12, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  rowSelected: { backgroundColor: '#eff6ff' },
  rowTitle: { fontWeight: '800', color: '#0f172a' },
  rowText: { marginTop: 4, color: '#475569', lineHeight: 20 },
  levelPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  levelRed: { backgroundColor: '#fee2e2' },
  levelYellow: { backgroundColor: '#fef3c7' },
  levelGreen: { backgroundColor: '#dcfce7' },
  levelText: { fontWeight: '800', fontSize: 11 },
  levelTextRed: { color: '#b91c1c' },
  levelTextYellow: { color: '#92400e' },
  levelTextGreen: { color: '#166534' },
  primaryButton: { marginTop: 10, alignSelf: 'flex-start', borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14 },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
});
