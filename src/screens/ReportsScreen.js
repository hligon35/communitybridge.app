import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import AppDropdown from '../components/AppDropdown';
import * as DocumentPicker from 'expo-document-picker';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { USER_ROLES, isBcbaRole, normalizeUserRole } from '../core/tenant/models';
import { useBehaviorSystemReports } from '../features/reporting/hooks/useBehaviorSystemReports';
import { childHasParent, findLinkedParentId } from '../utils/directoryLinking';
import { getWorkspaceLabel } from '../utils/roleTerminology';
import { getPhoneAccessProfile, isAggregateOnlyPhoneProfile, isPhoneViewport as resolvePhoneViewport, shouldUsePhoneSafeReports } from '../utils/mobileRoleAccess';
import * as Api from '../Api';
const { isSpecialAccessUser } = require('../utils/authState');
const { filterChildrenForTherapistScope } = require('../features/sessionTracking/utils/dashboardSessionTarget');
const { getEffectiveChatIdentity } = require('../utils/demoIdentity');

function findReportChildren(user, children, parents) {
  const items = Array.isArray(children) ? children : [];
  const role = normalizeUserRole(user?.role);
  const effectiveUser = getEffectiveChatIdentity(user);
  if (role === USER_ROLES.THERAPIST) return filterChildrenForTherapistScope(items, effectiveUser?.id, { allowSpecialAccessFallback: isSpecialAccessUser(user?.email) });
  if (role === USER_ROLES.PARENT) {
    const linkedParentId = findLinkedParentId(user, parents) || user?.id;
    return items.filter((child) => childHasParent(child, linkedParentId));
  }
  return items;
}

function SectionCard({ title, children }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MiniBars({ items = [], color = '#2563eb' }) {
  const max = Math.max(1, ...items.map((item) => Number(item?.value || 0)));
  return (
    <View style={styles.barRow}>
      {items.map((item) => (
        <View key={item.label} style={styles.barItem}>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { backgroundColor: color, height: `${Math.max(10, (Number(item.value || 0) / max) * 100)}%` }]} />
          </View>
          <Text style={styles.barLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function UtilizationMeters({ items = [] }) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const max = Math.max(1, ...normalizedItems.map((item) => Number(item?.value || 0)));

  if (!normalizedItems.length) {
    return <Text style={styles.rowText}>No utilization data is available yet.</Text>;
  }

  return (
    <View>
      {normalizedItems.map((item) => {
        const value = Number(item?.value || 0);
        const percent = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
        const tone = percent >= 85 ? '#16a34a' : percent >= 55 ? '#0284c7' : '#f59e0b';
        return (
          <View key={item.label} style={styles.utilizationRow}>
            <View style={styles.utilizationHeader}>
              <Text style={styles.utilizationLabel}>{item.label}</Text>
              <Text style={styles.utilizationValue}>{value} • {percent}%</Text>
            </View>
            <View style={styles.utilizationTrack}>
              <View style={[styles.utilizationFill, { width: `${Math.max(percent, 8)}%`, backgroundColor: tone }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function HeaderFilterDropdown({ label, value, options = [], selectedValue, onSelect, buttonWidth = 120, onOpenChange }) {
  return (
    <AppDropdown
      containerStyle={styles.headerDropdownWrap}
      minMenuWidth={buttonWidth}
      onOpenChange={onOpenChange}
      onSelect={onSelect}
      options={options}
      placeholder={label}
      selectedValue={selectedValue}
      value={value}
      width={buttonWidth}
    />
  );
}

function HeaderReportFilters({
  roomOptions = [],
  selectedRoom,
  onSelectRoom,
  learners = [],
  selectedChildId,
  onSelectChild,
  onDropdownOpenChange,
}) {
  const hasRoomFilter = roomOptions.length > 1;
  const hasLearnerFilter = learners.length > 0;
  const activeLearner = learners.find((child) => child?.id === selectedChildId) || null;
  const learnerLabel = selectedChildId === 'all' ? 'All learners' : (activeLearner?.name || 'Learner');
  const roomLabel = selectedRoom === 'all' ? 'All rooms' : selectedRoom;
  const roomChoices = roomOptions.map((room) => ({ value: room, label: room === 'all' ? 'All Rooms' : room }));
  const learnerChoices = [
    { value: 'all', label: 'All Learners' },
    ...learners.map((child) => ({ value: child.id, label: child.name })),
  ];

  if (!hasRoomFilter && !hasLearnerFilter) return null;

  return (
    <View style={styles.headerFiltersWrap}>
      {hasRoomFilter ? (
        <HeaderFilterDropdown
          label="Room"
          value={roomLabel}
          onOpenChange={onDropdownOpenChange}
          options={roomChoices}
          selectedValue={selectedRoom}
          onSelect={onSelectRoom}
          buttonWidth={104}
        />
      ) : null}
      {hasLearnerFilter ? (
        <HeaderFilterDropdown
          label="Learner"
          value={learnerLabel}
          onOpenChange={onDropdownOpenChange}
          options={learnerChoices}
          selectedValue={selectedChildId}
          onSelect={onSelectChild}
          buttonWidth={132}
        />
      ) : null}
    </View>
  );
}

function SafeMetricCard({ title, value, detail }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryCardTitle}>{title}</Text>
      <Text style={styles.safeMetricValue}>{value}</Text>
      <Text style={styles.summaryCardValue}>{detail}</Text>
    </View>
  );
}

export default function ReportsScreen({ route }) {
  const { user } = useAuth();
  const workspaceLabel = getWorkspaceLabel(user?.role);
  const { children = [], parents = [], urgentMemos = [], messages = [], activeSeedPreset = '', seededExportJobs = [] } = useData();
  const { width, height } = useWindowDimensions();
  const role = String(user?.role || '').trim().toLowerCase();
  const isBcba = isBcbaRole(user?.role);
  const isParent = role.includes('parent');
  const isWideLayout = width >= 900;
  const isPhoneWorkspace = Platform.OS !== 'web' && resolvePhoneViewport(width, height);
  const isThreeCardLayout = width >= 720;
  const showHeaderFilters = width >= 900;
  const phoneAccessProfile = getPhoneAccessProfile(user?.role);
  const usePhoneSafeReports = isPhoneWorkspace && shouldUsePhoneSafeReports(user?.role);
  const [mobileFilterCarouselLocked, setMobileFilterCarouselLocked] = useState(false);
  const reportChildren = useMemo(() => findReportChildren(user, children, parents), [user, children, parents]);
  const requestedChildId = String(route?.params?.childId || '').trim();
  const [selectedChildId, setSelectedChildId] = useState(requestedChildId || 'all');
  const [selectedRoom, setSelectedRoom] = useState('all');
  const [tab, setTab] = useState(isBcba ? 'clinical' : 'operational');
  const [jobs, setJobs] = useState([]);
  const [jobsError, setJobsError] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const scrollViewRef = useRef(null);
  const roomOptions = useMemo(() => ['all', ...Array.from(new Set(reportChildren.map((child) => String(child?.room || '').trim()).filter(Boolean)))], [reportChildren]);
  const filteredReportChildren = useMemo(() => {
    if (selectedRoom === 'all') return reportChildren;
    return reportChildren.filter((child) => String(child?.room || '').trim() === selectedRoom);
  }, [reportChildren, selectedRoom]);
  const selectedChild = useMemo(() => {
    if (!selectedChildId || selectedChildId === 'all') return null;
    return filteredReportChildren.find((child) => child?.id === selectedChildId) || null;
  }, [filteredReportChildren, selectedChildId]);
  const { loading, childReports, schoolWide, sessionSummariesByChild } = useBehaviorSystemReports({
    selectedChildId: selectedChild?.id || null,
    reportChildIds: filteredReportChildren.map((child) => child.id),
    children: filteredReportChildren,
    urgentMemos,
  });

  useEffect(() => {
    if (selectedRoom !== 'all' && !roomOptions.includes(selectedRoom)) setSelectedRoom('all');
  }, [roomOptions, selectedRoom]);

  useEffect(() => {
    if (selectedChildId === 'all') return;
    if (!filteredReportChildren.some((child) => child?.id === selectedChildId)) setSelectedChildId('all');
  }, [filteredReportChildren, selectedChildId]);

  useEffect(() => {
    if (!requestedChildId) return;
    if (!filteredReportChildren.some((child) => child?.id === requestedChildId)) return;
    if (selectedChildId === requestedChildId) return;
    setSelectedChildId(requestedChildId);
  }, [filteredReportChildren, requestedChildId, selectedChildId]);

  useEffect(() => {
    let mounted = true;
    const loadJobs = async () => {
      if (activeSeedPreset === 'screenshot') {
        if (mounted) setJobsError('');
        if (mounted) setJobs(Array.isArray(seededExportJobs) ? seededExportJobs : []);
        return;
      }
      try {
        const result = await Api.listExportJobs(12);
        if (mounted) setJobsError('');
        if (mounted) setJobs(Array.isArray(result?.items) ? result.items : []);
      } catch (error) {
        if (mounted) setJobs([]);
        if (mounted) setJobsError(String(error?.message || error || 'Could not load recent transfer jobs.'));
      }
    };
    loadJobs();
    return () => {
      mounted = false;
    };
  }, [activeSeedPreset, seededExportJobs]);

  const activeSessionSummaries = useMemo(() => {
    if (selectedChild?.id) return sessionSummariesByChild[selectedChild.id] || [];
    return Object.values(sessionSummariesByChild).flat();
  }, [selectedChild?.id, sessionSummariesByChild]);

  const abcLogs = useMemo(() => activeSessionSummaries.slice(0, 4).map((item, index) => ({
    id: item?.sessionId || `${index}`,
    antecedent: item?.summary?.dailyRecap?.antecedent || 'Routine transition',
    behavior: item?.summary?.dailyRecap?.topBehavior || 'Task refusal',
    consequence: item?.summary?.dailyRecap?.consequence || 'Prompted return to task',
  })), [activeSessionSummaries]);

  const commLogs = useMemo(() => (messages || []).slice(0, 4).map((message, index) => ({
    id: message?.id || `${index}`,
    title: message?.subject || message?.body || 'Message thread',
    when: message?.createdAt ? new Date(message.createdAt).toLocaleString() : 'Recently',
  })), [messages]);

  const transferSummary = useMemo(() => {
    const items = Array.isArray(jobs) ? jobs : [];
    return items.reduce((summary, job) => {
      const status = String(job?.status || '').trim().toLowerCase();
      if (status === 'ready' || status === 'completed') summary.ready += 1;
      else if (status === 'queued' || status === 'pending' || status === 'processing') summary.pending += 1;
      else if (status) summary.other += 1;
      return summary;
    }, { ready: 0, pending: 0, other: 0 });
  }, [jobs]);

  const totalBehaviorSignals = useMemo(() => (childReports.behaviorTrends || []).reduce((sum, item) => sum + Number(item?.value || 0), 0), [childReports.behaviorTrends]);
  const totalProgramSessions = useMemo(() => (childReports.programMastery || []).reduce((sum, item) => sum + Number(item?.sessions || 0), 0), [childReports.programMastery]);

  if (isParent) {
    return (
      <ScreenWrapper>
        <View style={styles.parentBlockedCard}>
          <Text style={styles.parentBlockedEyebrow}>{workspaceLabel}</Text>
          <Text style={styles.parentBlockedTitle}>Reports are not available on the parent path.</Text>
          <Text style={styles.parentBlockedText}>Use Dashboard, Chats, My Child, Calendar, and Billing & Insurance from the parent portal instead.</Text>
        </View>
      </ScreenWrapper>
    );
  }

  if (usePhoneSafeReports) {
    const aggregateOnly = isAggregateOnlyPhoneProfile(user?.role);
    const safeTitle = aggregateOnly ? 'Phone reporting stays aggregate-first.' : 'Phone reporting stays summary-first.';
    const safeBody = aggregateOnly
      ? 'This view keeps queues, utilization, and organization-wide totals on phone without exposing detailed learner report drill-downs.'
      : 'This view keeps mobile reporting limited to masked or roll-up summaries. Use tablet or desktop for detailed chart drill-downs.';

    return (
      <ScreenWrapper style={styles.container}>
        <ScrollView contentContainerStyle={[styles.content, styles.contentWide]} showsVerticalScrollIndicator={false}>
          <View style={styles.safeIntroCard}>
            <Text style={styles.parentBlockedEyebrow}>{workspaceLabel}</Text>
            <Text style={styles.parentBlockedTitle}>{safeTitle}</Text>
            <Text style={styles.parentBlockedText}>{safeBody}</Text>
          </View>

          <View style={[styles.summaryRow, isThreeCardLayout ? styles.summaryRowWide : null]}>
            <SafeMetricCard
              title={aggregateOnly ? 'Active learners' : (phoneAccessProfile === 'bcba' ? 'Reviewed learners' : 'Assigned learners')}
              value={`${reportChildren.length}`}
              detail={aggregateOnly ? 'Visible only as an organization total on phone.' : 'Limited to your mobile-safe reporting scope.'}
            />
            <SafeMetricCard
              title="Session summaries"
              value={`${schoolWide.totalSessions || activeSessionSummaries.length}`}
              detail="Roll-up documentation count across the visible mobile scope."
            />
            <SafeMetricCard
              title={aggregateOnly ? 'Transfer queue' : 'Behavior signals'}
              value={aggregateOnly ? `${transferSummary.pending}` : `${totalBehaviorSignals}`}
              detail={aggregateOnly ? `${transferSummary.ready} ready for handoff` : `${totalProgramSessions} program data points logged`}
            />
          </View>

          {aggregateOnly ? (
            <>
              <SectionCard title="Attendance and utilization overview">
                <Text style={styles.rowText}>Present: {childReports.attendanceSummary.present}</Text>
                <Text style={styles.rowText}>Absent: {childReports.attendanceSummary.absent}</Text>
                <Text style={styles.rowText}>Tardy: {childReports.attendanceSummary.tardy}</Text>
                <Text style={styles.utilizationIntro}>Utilization lanes stay visible on phone because they are aggregate and queue-oriented.</Text>
                <UtilizationMeters items={(schoolWide.parentEngagement || []).map((item) => ({ label: item.label, value: item.value }))} />
              </SectionCard>
              <SectionCard title="Recent transfer jobs">
                {jobsError ? <Text style={styles.rowText}>{jobsError}</Text> : null}
                {jobs.length ? jobs.slice(0, 6).map((job) => <Text key={job.id} style={styles.rowText}>{job.title || 'Transfer'} • {String(job.status || 'ready').toUpperCase()}</Text>) : <Text style={styles.rowText}>No transfer jobs have been created yet.</Text>}
              </SectionCard>
            </>
          ) : (
            <>
              <SectionCard title={phoneAccessProfile === 'bcba' ? 'Clinical trend summary' : 'My trend summary'}>
                <MiniBars items={(childReports.programMastery || []).slice(0, 5).map((item) => ({ label: item.program, value: item.sessions }))} color="#16a34a" />
              </SectionCard>
              <SectionCard title="Behavior trend summary">
                <MiniBars items={(childReports.behaviorTrends || []).slice(0, 5)} color="#dc2626" />
              </SectionCard>
              <SectionCard title="Recent transfer jobs">
                {jobsError ? <Text style={styles.rowText}>{jobsError}</Text> : null}
                {jobs.length ? jobs.slice(0, 4).map((job) => <Text key={job.id} style={styles.rowText}>{job.title || 'Transfer'} • {String(job.status || 'ready').toUpperCase()}</Text>) : <Text style={styles.rowText}>No transfer jobs have been created yet.</Text>}
              </SectionCard>
            </>
          )}
        </ScrollView>
      </ScreenWrapper>
    );
  }

  const headerFilters = showHeaderFilters ? (
    <HeaderReportFilters
      roomOptions={roomOptions}
      selectedRoom={selectedRoom}
      onSelectRoom={setSelectedRoom}
      learners={filteredReportChildren}
      selectedChildId={selectedChildId}
      onSelectChild={setSelectedChildId}
      onDropdownOpenChange={setMobileFilterCarouselLocked}
    />
  ) : null;
  const mobileHeaderFilters = !showHeaderFilters ? (
    <HeaderReportFilters
      roomOptions={roomOptions}
      selectedRoom={selectedRoom}
      onSelectRoom={setSelectedRoom}
      learners={filteredReportChildren}
      selectedChildId={selectedChildId}
      onSelectChild={setSelectedChildId}
      onDropdownOpenChange={setMobileFilterCarouselLocked}
    />
  ) : null;

  async function refreshJobs() {
    try {
      const result = await Api.listExportJobs(12);
      setJobsError('');
      setJobs(Array.isArray(result?.items) ? result.items : []);
    } catch (error) {
      setJobs([]);
      setJobsError(String(error?.message || error || 'Could not load recent transfer jobs.'));
    }
  }

  async function queueTransferJob(format) {
    const normalizedFormat = String(format || 'csv').trim().toLowerCase();
    const result = await Api.createExportJob({
      title: `${normalizedFormat.toUpperCase()} Transfer`,
      category: 'transfer-center',
      format: normalizedFormat,
      scope: isBcba ? 'clinical' : 'office',
      summary: `${normalizedFormat.toUpperCase()} transfer queued from Reports.`,
      recordsCount: reportChildren.length,
    });
    const jobId = result?.item?.id;
    if (jobId) {
      await Api.updateExportJob(jobId, {
        status: 'ready',
        summary: `${normalizedFormat.toUpperCase()} transfer is ready for handoff.`,
        generatedAt: 'serverTimestamp',
      });
    }
  }

  async function handleImportAction() {
    if (transferBusy) return;
    setTransferBusy(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: [
          'application/pdf',
          'text/csv',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/json',
          'text/plain',
        ],
      });

      if (picked?.canceled) return;

      const asset = Array.isArray(picked?.assets) ? picked.assets[0] : null;
      if (!asset?.uri) throw new Error('No file was selected.');

      const created = await Api.createExportJob({
        title: `Import ${asset.name || 'file'}`,
        category: 'transfer-center',
        format: 'import',
        scope: isBcba ? 'clinical' : 'office',
        summary: 'Import file selected and upload started.',
        recordsCount: 1,
        artifactName: String(asset.name || '').trim(),
        artifactMimeType: String(asset.mimeType || 'application/octet-stream').trim(),
      });

      const jobId = created?.item?.id;
      const formData = { _parts: [[
        'file',
        {
          uri: asset.uri,
          name: asset.name || `import-${Date.now()}`,
          type: asset.mimeType || 'application/octet-stream',
        },
      ]] };
      const uploaded = await Api.uploadMedia(formData);

      if (jobId) {
        await Api.updateExportJob(jobId, {
          status: 'completed',
          summary: `Imported ${asset.name || 'file'} into the Transfer Center queue.`,
          artifactName: asset.name || `import-${Date.now()}`,
          artifactUrl: uploaded?.url || '',
          artifactPath: uploaded?.path || '',
          artifactMimeType: asset.mimeType || 'application/octet-stream',
          generatedAt: 'serverTimestamp',
        });
      }

      await refreshJobs();
      Alert.alert('Import complete', `${asset.name || 'File'} was uploaded to the Transfer Center.`);
    } catch (error) {
      Alert.alert('Import failed', String(error?.message || error || 'Unable to import this file.'));
    } finally {
      setTransferBusy(false);
    }
  }

  async function handleTransferAction(format) {
    if (transferBusy) return;
    if (String(format || '').toLowerCase() === 'import') {
      await handleImportAction();
      return;
    }
    setTransferBusy(true);
    try {
      await queueTransferJob(format);
      await refreshJobs();
      Alert.alert('Transfer queued', `${String(format || '').toUpperCase()} transfer is now listed in Recent transfer jobs.`);
    } catch (error) {
      Alert.alert('Transfer failed', String(error?.message || error || 'Unable to queue this transfer.'));
    } finally {
      setTransferBusy(false);
    }
  }

  return (
    <ScreenWrapper
      style={styles.container}
      bannerTitleLeft={headerFilters}
      mobileHeaderBelow={mobileHeaderFilters}
      mobileHeaderBelowScrollEnabled={!mobileFilterCarouselLocked}
    >
      <ScrollView ref={scrollViewRef} contentContainerStyle={[styles.content, !isWideLayout ? styles.contentCompact : null, isWideLayout ? styles.contentWide : null]} showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipCarouselContent} style={styles.chipCarousel}>
          <View style={styles.chipRow}>
            {(isBcba ? ['clinical', 'export'] : ['operational', 'export']).map((key) => (
              <TouchableOpacity key={key} style={[styles.tabButton, tab === key ? styles.tabButtonActive : null]} onPress={() => setTab(key)}>
                <Text style={[styles.tabButtonText, tab === key ? styles.tabButtonTextActive : null]}>{key === 'clinical' ? 'Clinical Reports' : key === 'operational' ? 'Operational Reports' : 'Import/Export Center'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {!showHeaderFilters && reportChildren.length && !filteredReportChildren.length ? (
          <View style={styles.emptyFilterState}>
            <Text style={styles.rowText}>No learners were found for the selected room.</Text>
          </View>
        ) : null}

        {selectedChildId === 'all' ? <Text style={styles.scopeText}>Showing a collective view for {filteredReportChildren.length || reportChildren.length} learner{(filteredReportChildren.length || reportChildren.length) === 1 ? '' : 's'}.</Text> : null}

        {loading ? <View style={styles.loading}><ActivityIndicator color="#2563eb" /></View> : null}

        {tab === 'clinical' ? (
          <>
            <SectionCard title="Skill acquisition graphs">
              <MiniBars items={(childReports.programMastery || []).map((item) => ({ label: item.program, value: item.sessions }))} color="#16a34a" />
            </SectionCard>
            <SectionCard title="Behavior frequency / duration graphs">
              <MiniBars items={childReports.behaviorTrends || []} color="#dc2626" />
            </SectionCard>
            <SectionCard title="ABC logs">
              {abcLogs.length ? abcLogs.map((log) => <Text key={log.id} style={styles.rowText}>A: {log.antecedent} • B: {log.behavior} • C: {log.consequence}</Text>) : <Text style={styles.rowText}>No ABC logs available yet.</Text>}
            </SectionCard>
            <SectionCard title="Parent communication logs">
              {commLogs.length ? commLogs.map((item) => <Text key={item.id} style={styles.rowText}>{item.title} • {item.when}</Text>) : <Text style={styles.rowText}>No communication logs available yet.</Text>}
            </SectionCard>
          </>
        ) : null}

        {tab === 'operational' ? (
          <>
            <View style={[styles.summaryRow, isThreeCardLayout ? styles.summaryRowWide : null]}>
              <View style={[styles.summaryCard, isThreeCardLayout ? styles.summaryCardWide : null]}>
                <Text style={styles.summaryCardTitle}>Attendance</Text>
                <Text style={styles.summaryCardValue}>Present: {childReports.attendanceSummary.present}</Text>
                <Text style={styles.summaryCardValue}>Absent: {childReports.attendanceSummary.absent}</Text>
                <Text style={styles.summaryCardValue}>Tardy: {childReports.attendanceSummary.tardy}</Text>
              </View>
              <View style={[styles.summaryCard, isThreeCardLayout ? styles.summaryCardWide : null]}>
                <Text style={styles.summaryCardTitle}>Staff Hours</Text>
                <Text style={styles.summaryCardValue}>{(schoolWide.parentEngagement || []).length} service channels</Text>
                <Text style={styles.summaryCardValue}>Available for staffing review</Text>
              </View>
              <View style={[styles.summaryCard, isThreeCardLayout ? styles.summaryCardWide : null]}>
                <Text style={styles.summaryCardTitle}>Session Verification</Text>
                <Text style={styles.summaryCardValue}>{schoolWide.totalSessions} summaries logged</Text>
                <Text style={styles.summaryCardValue}>{schoolWide.activeLearners} active learners</Text>
              </View>
            </View>
            <SectionCard title="Utilization">
              <Text style={styles.utilizationIntro}>Compare active service channels side by side with a capacity-style meter so underused and heavily used lanes are obvious at a glance.</Text>
              <UtilizationMeters items={(schoolWide.parentEngagement || []).map((item) => ({ label: item.label, value: item.value }))} />
            </SectionCard>
          </>
        ) : null}

        {tab === 'export' ? (
          <>
            <SectionCard title="Import/Export Center">
              <View style={[styles.transferIntroRow, isWideLayout ? styles.transferIntroRowWide : null]}>
                <Text style={styles.transferIntroText}>Move reports out as handoff-ready files or bring outside files into the workspace queue for review.</Text>
                {transferBusy ? <ActivityIndicator color="#2563eb" /> : null}
              </View>
              <View style={styles.exportRow}>
                {[
                  { label: 'PDF', detail: 'Export packet ready.' },
                  { label: 'CSV', detail: 'Structured export ready.' },
                  { label: 'Excel', detail: 'Workbook handoff ready.' },
                  { label: 'Import', detail: 'Upload and reconcile incoming files.' },
                ].map((format) => <View key={format.label} style={styles.exportCard}><Text style={styles.exportTitle}>{format.label}</Text><Text style={styles.exportText}>{format.detail}</Text><TouchableOpacity style={[styles.transferButton, transferBusy ? styles.transferButtonDisabled : null]} disabled={transferBusy} onPress={() => handleTransferAction(format.label)}><Text style={styles.transferButtonText}>{format.label === 'Import' ? 'Import' : 'Transfer'}</Text></TouchableOpacity></View>)}
              </View>
            </SectionCard>
            <View>
              <SectionCard title="Recent transfer jobs">
              {jobsError ? (
                <View style={styles.errorCard}>
                  <Text style={styles.errorText}>{jobsError}</Text>
                  <TouchableOpacity style={styles.retryButton} onPress={refreshJobs}>
                    <Text style={styles.retryButtonText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {jobs.length ? jobs.map((job) => <View key={job.id} style={styles.jobRow}><View style={styles.jobTextWrap}><Text style={styles.jobTitle}>{job.title || 'Transfer'}</Text><Text style={styles.rowText}>{String(job.format || 'csv').toUpperCase()} • {String(job.status || 'ready').toUpperCase()}</Text></View><Text style={styles.jobMeta}>{job.createdAt ? new Date(job.createdAt).toLocaleString() : 'Recently'}</Text></View>) : <Text style={styles.rowText}>No transfer jobs have been created yet.</Text>}
              </SectionCard>
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  contentCompact: { padding: 8 },
  contentWide: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 24, paddingBottom: 28 },
  parentBlockedCard: { borderRadius: 22, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#bfdbfe', padding: 18, margin: 16 },
  parentBlockedEyebrow: { color: '#1d4ed8', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' },
  parentBlockedTitle: { marginTop: 6, fontSize: 24, fontWeight: '800', color: '#0f172a' },
  parentBlockedText: { marginTop: 8, color: '#475569', lineHeight: 20 },
  headerFiltersWrap: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerDropdownWrap: { minWidth: 0 },
  chipCarousel: { marginTop: 14 },
  chipCarouselContent: { paddingRight: 12 },
  chipRow: { flexDirection: 'row', alignItems: 'center' },
  tabButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f1f5f9', marginRight: 8, marginBottom: 8 },
  tabButtonActive: { backgroundColor: '#2563eb' },
  tabButtonText: { color: '#0f172a', fontWeight: '700' },
  tabButtonTextActive: { color: '#ffffff' },
  filterSection: { marginTop: 10 },
  filterLabel: { marginBottom: 6, color: '#475569', fontWeight: '700' },
  filterChip: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#e2e8f0', marginRight: 8, marginBottom: 8 },
  filterChipActive: { backgroundColor: '#0f172a' },
  filterChipText: { color: '#0f172a', fontWeight: '700' },
  filterChipTextActive: { color: '#ffffff' },
  emptyFilterState: { marginTop: 10, borderRadius: 16, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 14 },
  scopeText: { marginTop: 6, color: '#64748b', fontWeight: '700' },
  loading: { paddingVertical: 20, alignItems: 'center' },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 },
  summaryRowWide: { marginHorizontal: -6, flexWrap: 'nowrap' },
  summaryCard: { width: '100%', borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16, marginBottom: 10 },
  summaryCardWide: { flex: 1, marginHorizontal: 6, minHeight: 144, minWidth: 0 },
  summaryCardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 10 },
  safeMetricValue: { fontSize: 28, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  summaryCardValue: { color: '#475569', lineHeight: 20, marginBottom: 6 },
  card: { marginTop: 12, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  rowText: { color: '#475569', lineHeight: 20, marginBottom: 8 },
  safeIntroCard: { borderRadius: 22, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#bfdbfe', padding: 18, marginTop: 10 },
  utilizationIntro: { color: '#64748b', lineHeight: 20, marginBottom: 14 },
  utilizationRow: { marginBottom: 14 },
  utilizationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  utilizationLabel: { color: '#0f172a', fontWeight: '700', flex: 1, paddingRight: 12 },
  utilizationValue: { color: '#475569', fontWeight: '700' },
  utilizationTrack: { height: 14, borderRadius: 999, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  utilizationFill: { height: '100%', borderRadius: 999, minWidth: 10 },
  barRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  barItem: { flex: 1, alignItems: 'center', marginHorizontal: 4 },
  barTrack: { height: 110, width: 28, borderRadius: 14, backgroundColor: '#e2e8f0', justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 14 },
  barLabel: { marginTop: 8, fontSize: 11, fontWeight: '700', color: '#334155', textAlign: 'center' },
  exportRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  transferIntroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  transferIntroRowWide: { minHeight: 32 },
  transferIntroText: { flex: 1, color: '#475569', lineHeight: 20, paddingRight: 12 },
  exportCard: { width: '48.75%', minHeight: 144, borderRadius: 16, backgroundColor: '#f8fafc', padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0', justifyContent: 'space-between' },
  exportTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  exportText: { marginTop: 6, color: '#64748b' },
  transferButton: { marginTop: 10, alignSelf: 'center', borderRadius: 10, backgroundColor: '#2563eb', paddingVertical: 8, paddingHorizontal: 12 },
  transferButtonDisabled: { opacity: 0.6 },
  transferButtonText: { color: '#ffffff', fontWeight: '800' },
  errorCard: { borderRadius: 12, borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2', padding: 12, marginBottom: 12 },
  errorText: { color: '#991b1b' },
  retryButton: { alignSelf: 'flex-start', marginTop: 8, borderRadius: 999, backgroundColor: '#991b1b', paddingVertical: 8, paddingHorizontal: 12 },
  retryButtonText: { color: '#ffffff', fontWeight: '700' },
  jobRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', padding: 12, marginBottom: 10 },
  jobTextWrap: { flex: 1, paddingRight: 12 },
  jobTitle: { color: '#0f172a', fontWeight: '800', marginBottom: 4 },
  jobMeta: { color: '#64748b', fontSize: 12, textAlign: 'right' },
});
