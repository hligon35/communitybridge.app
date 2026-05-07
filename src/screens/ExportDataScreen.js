import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform, Linking } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { useData } from '../DataContext';
// header provided by ScreenWrapper
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../AuthContext';
import { getWorkspaceLabel } from '../utils/roleTerminology';
import * as Api from '../Api';

function toCSV(rows) {
  if (!rows || !rows.length) return '';
  const keys = Object.keys(rows[0]);
  const header = keys.join(',');
  const lines = rows.map(r => keys.map(k => (`"${String(r[k] ?? '')}"`)).join(','));
  return [header, ...lines].join('\n');
}

export default function ExportDataScreen(){
  const navigation = useNavigation();
  const { user } = useAuth();
  const workspaceLabel = getWorkspaceLabel(user?.role);
  const { messages = [], children = [], therapists = [], parents = [], urgentMemos = [] } = useData();
  const [selectedCategory, setSelectedCategory] = useState('reports');
  const [selectedFormat, setSelectedFormat] = useState('csv');
  const [jobs, setJobs] = useState([]);
  const [jobsError, setJobsError] = useState('');
  const [busy, setBusy] = useState(false);
  const formatCards = useMemo(() => ([
    { key: 'pdf', label: 'PDF', icon: 'picture-as-pdf', type: 'format' },
    { key: 'csv', label: 'CSV', icon: 'table-chart', type: 'format' },
    { key: 'excel', label: 'Excel', icon: 'grid-on', type: 'format' },
    { key: 'import', label: 'Import', icon: 'file-upload', type: 'navigate' },
  ]), []);

  const recordCount = useMemo(() => selectedCategory === 'billing' ? children.length : messages.length + children.length, [children.length, messages.length, selectedCategory]);

  async function loadJobs() {
    try {
      const result = await Api.listExportJobs(12);
      setJobsError('');
      setJobs(Array.isArray(result?.items) ? result.items : []);
    } catch (error) {
      setJobs([]);
      setJobsError(String(error?.message || error || 'Could not load recent export jobs.'));
    }
  }

  useEffect(() => {
    loadJobs();
  }, []);

  function openArtifact(url) {
    if (!url) return;
    Linking.openURL(url).catch(() => {
      Alert.alert('Unable to open export', 'Your device could not open this export file.');
    });
  }

  function buildRows() {
    if (selectedCategory === 'billing') {
      return children.map((child) => ({
        learner: child?.name || 'Learner',
        attendanceStatus: child?.attendanceStatus || 'pending',
        insuranceStatus: child?.insuranceStatus || 'pending verification',
        assignedStaff: [child?.amTherapist?.name, child?.pmTherapist?.name, child?.bcaTherapist?.name].filter(Boolean).join(' | '),
      }));
    }
    if (selectedCategory === 'compliance') {
      return therapists.map((staff) => ({
        staff: staff?.name || staff?.email || 'Staff',
        role: staff?.role || 'staff',
        email: staff?.email || '',
        phone: staff?.phone || '',
        urgentMemos: urgentMemos.filter((memo) => (memo?.recipientIds || []).includes(staff?.id)).length,
      }));
    }
    return messages.slice(0, 200).map((message) => ({
      thread: message?.threadId || message?.id || 'thread',
      sender: message?.sender?.name || message?.sender?.id || 'Unknown',
      recipients: Array.isArray(message?.to) ? message.to.map((item) => item?.name || item?.id).filter(Boolean).join(' | ') : '',
      createdAt: message?.createdAt || '',
    }));
  }

  function getExportContent(rows) {
    if (selectedFormat === 'excel') {
      return {
        fileExtension: 'csv',
        mimeType: 'text/csv',
        body: toCSV(rows),
      };
    }
    if (selectedFormat === 'pdf') {
      const summaryLines = rows.map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value ?? ''}`).join('\n')).join('\n\n');
      return {
        fileExtension: 'html',
        mimeType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8" /><title>CommunityBridge Export</title><style>body{font-family:Georgia,serif;padding:24px;color:#0f172a;}h1{font-size:24px;}pre{white-space:pre-wrap;font-family:Georgia,serif;line-height:1.5;}</style></head><body><h1>${selectedCategory} export</h1><p>Generated ${new Date().toLocaleString()}</p><pre>${summaryLines.replace(/[<>&]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[character]))}</pre></body></html>`,
      };
    }
    return {
      fileExtension: 'csv',
      mimeType: 'text/csv',
      body: toCSV(rows),
    };
  }

  async function createArtifactFile(fileName, body, mimeType) {
    if (Platform.OS === 'web') {
      const blob = new Blob([body], { type: mimeType });
      const uri = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = uri;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return { uri, cleanup: () => URL.revokeObjectURL(uri) };
    }

    const baseDir = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}exports`;
    await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true }).catch(() => {});
    const fileUri = `${baseDir}/${fileName}`;
    await FileSystem.writeAsStringAsync(fileUri, body, { encoding: FileSystem.EncodingType.UTF8 });
    return { uri: fileUri, cleanup: async () => {} };
  }

  async function doExport(){
    try {
      setBusy(true);
      const title = selectedCategory === 'billing' ? 'Billing Export' : selectedCategory === 'compliance' ? 'Compliance Export' : 'Operational Report Export';
      const rows = buildRows();
      const content = getExportContent(rows);
      const fileName = `${selectedCategory}-${Date.now()}.${content.fileExtension}`;
      const job = await Api.createExportJob({
        title,
        category: selectedCategory,
        format: selectedFormat,
        scope: 'office',
        recordsCount: rows.length || recordCount,
        summary: `${title} queued from Export Center.`,
      });
      const artifact = await createArtifactFile(fileName, content.body, content.mimeType);
      try {
        const formData = new FormData();
        formData.append('file', {
          uri: artifact.uri,
          name: fileName,
          type: content.mimeType,
        });
        const uploaded = await Api.uploadMedia(formData);
        await Api.updateExportJob(job?.item?.id, {
          status: 'completed',
          summary: `${title} generated successfully.`,
          artifactName: fileName,
          artifactMimeType: content.mimeType,
          artifactUrl: uploaded?.url || '',
          artifactPath: uploaded?.path || '',
          generatedAt: 'serverTimestamp',
          recordsCount: rows.length || recordCount,
        });
      } catch (e) {
        await Api.updateExportJob(job?.item?.id, {
          status: 'failed',
          summary: String(e?.message || e || 'Export generation failed.'),
        }).catch(() => {});
        throw e;
      } finally {
        await artifact.cleanup?.();
      }
      await loadJobs();
      Alert.alert('Export ready', `${title} was generated and added to recent export jobs.`);
    } catch (e) {
      Alert.alert('Export failed', String(e?.message || e || 'Could not queue export.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenWrapper style={styles.container}>
      <View style={styles.body}>
        <Text style={styles.title}>Export Center</Text>
        <Text style={styles.p}>Prepare office-facing data exports for reports, billing handoff, and compliance review.</Text>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Available export targets</Text>
          <Text style={styles.infoBody}>Queue PDF, CSV, and Excel-style export jobs for reports, billing handoff, and compliance review from this workspace.</Text>
        </View>

        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Messages</Text>
            <Text style={styles.metricValue}>{messages.length}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Students</Text>
            <Text style={styles.metricValue}>{children.length}</Text>
          </View>
        </View>

        <View style={styles.selectorRow}>
          {[
            { key: 'reports', label: 'Reports' },
            { key: 'billing', label: 'Billing' },
            { key: 'compliance', label: 'Compliance' },
          ].map((item) => (
            <TouchableOpacity key={item.key} style={[styles.selectorChip, selectedCategory === item.key ? styles.selectorChipActive : null]} onPress={() => setSelectedCategory(item.key)}>
              <Text style={[styles.selectorChipText, selectedCategory === item.key ? styles.selectorChipTextActive : null]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.quickActionGrid}>
          {formatCards.map((item) => {
            const isSelected = item.type === 'format' && selectedFormat === item.key;
            const onPress = item.type === 'navigate'
              ? () => navigation.navigate('ImportCenter')
              : () => setSelectedFormat(item.key);
            return (
              <TouchableOpacity key={item.key} style={[styles.quickActionCard, isSelected ? styles.quickActionCardActive : null]} onPress={onPress}>
                <MaterialIcons name={item.icon} size={22} color={isSelected ? '#ffffff' : '#2563eb'} />
                <Text style={[styles.quickActionLabel, isSelected ? styles.quickActionLabelActive : null]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={[styles.exportBtn, busy ? styles.exportBtnDisabled : null]} onPress={doExport} disabled={busy}><Text style={styles.exportText}>{busy ? 'Queueing...' : 'Queue Export Job'}</Text></TouchableOpacity>

        <View style={styles.jobsCard}>
          <Text style={styles.infoTitle}>Recent Export Jobs</Text>
          {jobsError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{jobsError}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={loadJobs}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {jobs.length ? jobs.map((job) => (
            <View key={job.id} style={styles.jobRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.jobTitle}>{job.title || 'Export Job'}</Text>
                <Text style={styles.jobMeta}>{String(job.category || 'reports').toUpperCase()} • {String(job.format || 'csv').toUpperCase()} • {job.recordsCount || 0} records</Text>
                <Text style={styles.jobMeta}>{job.createdAt ? new Date(job.createdAt).toLocaleString() : 'Recently created'}</Text>
              </View>
              <View style={styles.jobActions}>
                <View style={[styles.jobStatusPill, job.status === 'failed' ? styles.jobStatusPillFailed : null]}>
                  <Text style={[styles.jobStatusText, job.status === 'failed' ? styles.jobStatusTextFailed : null]}>{String(job.status || 'ready').toUpperCase()}</Text>
                </View>
                {job.artifactUrl ? (
                  <TouchableOpacity style={styles.downloadBtn} onPress={() => openArtifact(job.artifactUrl)}>
                    <Text style={styles.downloadBtnText}>Open</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )) : <Text style={styles.infoBody}>No export jobs have been queued yet.</Text>}
        </View>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryText}>Back to {workspaceLabel}</Text>
        </TouchableOpacity>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { padding: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 8 },
  p: { color: '#374151', lineHeight: 20 },
  infoCard: { marginTop: 16, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#eff6ff' },
  infoTitle: { color: '#1d4ed8', fontWeight: '800', marginBottom: 4 },
  infoBody: { color: '#1e3a8a', lineHeight: 20 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  metricCard: { width: '48%', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  metricLabel: { color: '#64748b', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  metricValue: { marginTop: 6, color: '#0f172a', fontSize: 24, fontWeight: '800' },
  selectorRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  selectorChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#f1f5f9', marginRight: 8, marginBottom: 8 },
  selectorChipActive: { backgroundColor: '#2563eb' },
  selectorChipText: { color: '#0f172a', fontWeight: '700' },
  selectorChipTextActive: { color: '#fff' },
  quickActionGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 },
  quickActionCard: { width: '48%', minHeight: 110, borderRadius: 14, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#ffffff', paddingVertical: 16, paddingHorizontal: 14, marginBottom: 10, justifyContent: 'center' },
  quickActionCardActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  quickActionLabel: { marginTop: 10, color: '#0f172a', fontWeight: '800', fontSize: 15 },
  quickActionLabelActive: { color: '#ffffff' },
  exportBtn: { marginTop: 16, backgroundColor: '#0066FF', padding: 12, borderRadius: 8, alignItems: 'center' },
  exportBtnDisabled: { opacity: 0.55 },
  exportText: { color: '#fff', fontWeight: '700' },
  jobsCard: { marginTop: 16, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  errorCard: { marginTop: 10, marginBottom: 4, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  errorText: { color: '#991b1b', lineHeight: 18 },
  retryBtn: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#991b1b' },
  retryText: { color: '#fff', fontWeight: '700' },
  jobRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  jobTitle: { color: '#0f172a', fontWeight: '800' },
  jobMeta: { color: '#64748b', marginTop: 4 },
  jobActions: { alignItems: 'flex-end' },
  jobStatusPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#dcfce7' },
  jobStatusText: { color: '#16a34a', fontWeight: '800', fontSize: 12 },
  jobStatusPillFailed: { backgroundColor: '#fee2e2' },
  jobStatusTextFailed: { color: '#dc2626' },
  downloadBtn: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1' },
  downloadBtnText: { color: '#334155', fontWeight: '700' },
  secondaryBtn: { marginTop: 10, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center' },
  secondaryText: { color: '#334155', fontWeight: '700' },
});