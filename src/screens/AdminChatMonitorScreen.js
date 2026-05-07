import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { isBcbaRole, isOfficeAdminRole } from '../core/tenant/models';
import { THERAPY_ROLE_LABELS } from '../utils/roleTerminology';

function buildThreads(messages = []) {
  const map = new Map();
  (messages || []).forEach((message, index) => {
    const key = message?.threadId || message?.id || `thread-${index}`;
    const existing = map.get(key) || { id: key, last: message, count: 0 };
    existing.last = message;
    existing.count += 1;
    map.set(key, existing);
  });
  return Array.from(map.values());
}

export default function AdminChatMonitorScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { messages = [], parents = [], therapists = [], urgentMemos = [], sendAdminMemo } = useData();
  const isBcba = isBcbaRole(user?.role);
  const isOffice = isOfficeAdminRole(user?.role);
  const [tab, setTab] = useState('inbox');
  const [query, setQuery] = useState('');
  const [announcementAudience, setAnnouncementAudience] = useState('staff');
  const [announcementSubject, setAnnouncementSubject] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);

  const threads = useMemo(() => buildThreads(messages), [messages]);
  const filteredThreads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return threads;
    return threads.filter((thread) => JSON.stringify(thread.last || {}).toLowerCase().includes(normalized));
  }, [query, threads]);
  const attachments = useMemo(() => [
    { id: 'pdf', label: 'PDFs', count: Math.max(1, filteredThreads.length) },
    { id: 'notes', label: 'Notes', count: Math.max(1, therapists.length) },
    { id: 'reports', label: 'Reports', count: Math.max(1, parents.length) },
  ], [filteredThreads.length, parents.length, therapists.length]);
  const recentAnnouncements = useMemo(() => {
    return (Array.isArray(urgentMemos) ? urgentMemos : [])
      .filter((item) => String(item?.type || '').toLowerCase() === 'admin_memo')
      .slice(0, 5);
  }, [urgentMemos]);

  const announcementRecipients = useMemo(() => {
    if (announcementAudience === 'parents') {
      return (parents || []).map((entry) => ({ id: entry?.id, role: 'parent', name: entry?.name || `${entry?.firstName || ''} ${entry?.lastName || ''}`.trim() })).filter((entry) => entry.id);
    }
    if (announcementAudience === 'all') {
      return [
        ...(therapists || []).map((entry) => ({ id: entry?.id, role: 'therapist', name: entry?.name || 'Staff' })),
        ...(parents || []).map((entry) => ({ id: entry?.id, role: 'parent', name: entry?.name || `${entry?.firstName || ''} ${entry?.lastName || ''}`.trim() })),
      ].filter((entry) => entry.id);
    }
    return (therapists || []).map((entry) => ({ id: entry?.id, role: 'therapist', name: entry?.name || 'Staff' })).filter((entry) => entry.id);
  }, [announcementAudience, parents, therapists]);

  async function submitAnnouncement() {
    try {
      if (!isOffice || typeof sendAdminMemo !== 'function') return;
      const trimmedSubject = String(announcementSubject || '').trim();
      const trimmedBody = String(announcementBody || '').trim();
      if (!trimmedSubject && !trimmedBody) return;
      if (!announcementRecipients.length) return;

      setSendingAnnouncement(true);
      const created = await sendAdminMemo({
        recipients: announcementRecipients,
        subject: trimmedSubject,
        body: trimmedBody,
      });
      if (created?.id) {
        setAnnouncementSubject('');
        setAnnouncementBody('');
      }
    } finally {
      setSendingAnnouncement(false);
    }
  }

  return (
    <ScreenWrapper style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipCarouselContent} style={styles.chipCarousel}>
          <View style={styles.tabRow}>
            {[
              { key: 'inbox', label: 'Inbox' },
              { key: 'broadcast', label: 'Broadcast Center' },
              { key: 'threads', label: 'Conversation Threads' },
              { key: 'attachments', label: 'Attachments' },
            ].map((item) => (
              <TouchableOpacity key={item.key} style={[styles.tabButton, tab === item.key ? styles.tabButtonActive : null]} onPress={() => setTab(item.key)}>
                <Text style={[styles.tabButtonText, tab === item.key ? styles.tabButtonTextActive : null]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={styles.searchCard}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search threads or messages" style={styles.input} />
        </View>

        {tab === 'inbox' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Inbox</Text>
            {filteredThreads.length ? filteredThreads.slice(0, 8).map((thread) => <Text key={thread.id} style={styles.rowText}>{thread.last?.body || thread.last?.subject || 'Thread'} • {thread.count} message{thread.count === 1 ? '' : 's'}</Text>) : <Text style={styles.rowText}>No communication threads available.</Text>}
          </View>
        ) : null}

        {tab === 'broadcast' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Broadcast center</Text>
            <Text style={styles.rowText}>{isOffice ? 'Compose and send an announcement to staff, parents, or both from this workspace.' : 'BCBA can review broadcast activity but office retains announcement control.'}</Text>
            {isOffice ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipCarouselContent} style={styles.audienceCarousel}>
                  <View style={styles.audienceRow}>
                    {[
                      { key: 'staff', label: 'Staff' },
                      { key: 'parents', label: 'Parents' },
                      { key: 'all', label: 'Everyone' },
                    ].map((item) => {
                      const active = announcementAudience === item.key;
                      return (
                        <TouchableOpacity key={item.key} style={[styles.audienceChip, active ? styles.audienceChipActive : null]} onPress={() => setAnnouncementAudience(item.key)}>
                          <Text style={[styles.audienceChipText, active ? styles.audienceChipTextActive : null]}>{item.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
                <TextInput value={announcementSubject} onChangeText={setAnnouncementSubject} placeholder="Announcement subject" style={styles.input} />
                <TextInput value={announcementBody} onChangeText={setAnnouncementBody} placeholder="Write the announcement" multiline style={[styles.input, styles.multilineInput]} />
                <Text style={styles.rowText}>Recipients: {announcementRecipients.length}</Text>
                <TouchableOpacity style={[styles.primaryButton, sendingAnnouncement ? styles.primaryButtonDisabled : null]} disabled={sendingAnnouncement || !announcementRecipients.length || (!announcementSubject.trim() && !announcementBody.trim())} onPress={submitAnnouncement}><Text style={styles.primaryButtonText}>{sendingAnnouncement ? 'Sending...' : 'Send Announcement'}</Text></TouchableOpacity>
              </>
            ) : null}
            {recentAnnouncements.length ? (
              <View style={styles.broadcastHistoryWrap}>
                <Text style={styles.sectionLabel}>Recent announcements</Text>
                {recentAnnouncements.map((item) => (
                  <View key={item.id} style={styles.broadcastHistoryRow}>
                    <Text style={styles.threadTitle}>{item.subject || item.title || 'Announcement'}</Text>
                    <Text style={styles.rowText}>{item.body || item.note || 'No announcement body provided.'}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {tab === 'threads' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Conversation threads</Text>
            {filteredThreads.length ? filteredThreads.map((thread) => (
              <TouchableOpacity key={thread.id} style={styles.threadRow} onPress={() => navigation.navigate('ChatThread', { threadId: thread.id })}>
                <Text style={styles.threadTitle}>{thread.last?.subject || thread.last?.body || 'Thread'}</Text>
                <Text style={styles.rowText}>{thread.last?.createdAt ? new Date(thread.last.createdAt).toLocaleString() : 'Recently updated'}</Text>
              </TouchableOpacity>
            )) : <Text style={styles.rowText}>No conversation threads available.</Text>}
          </View>
        ) : null}

        {tab === 'attachments' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Attachments</Text>
            <View style={styles.attachmentsRow}>
              {attachments.map((item) => (
                <View key={item.id} style={styles.attachmentCard}>
                  <Text style={styles.threadTitle}>{item.label}</Text>
                  <Text style={styles.rowText}>{item.count} item{item.count === 1 ? '' : 's'} available.</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  chipCarousel: { marginTop: 14 },
  chipCarouselContent: { paddingRight: 8 },
  tabRow: { flexDirection: 'row' },
  tabButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f1f5f9', marginRight: 8, marginBottom: 8 },
  tabButtonActive: { backgroundColor: '#2563eb' },
  tabButtonText: { color: '#0f172a', fontWeight: '700' },
  tabButtonTextActive: { color: '#ffffff' },
  searchCard: { marginTop: 10, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff' },
  card: { marginTop: 12, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  audienceCarousel: { marginBottom: 10 },
  audienceRow: { flexDirection: 'row' },
  audienceChip: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#eff6ff', marginRight: 8, marginBottom: 8 },
  audienceChipActive: { backgroundColor: '#2563eb' },
  audienceChipText: { color: '#1d4ed8', fontWeight: '700' },
  audienceChipTextActive: { color: '#ffffff' },
  rowText: { color: '#475569', lineHeight: 20, marginBottom: 8 },
  primaryButton: { marginTop: 10, alignSelf: 'flex-start', borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14 },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  multilineInput: { minHeight: 110, textAlignVertical: 'top' },
  broadcastHistoryWrap: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 12 },
  broadcastHistoryRow: { marginBottom: 10 },
  sectionLabel: { fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  threadRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  threadTitle: { fontWeight: '800', color: '#0f172a' },
  attachmentsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  attachmentCard: { width: '32%', borderRadius: 16, backgroundColor: '#f8fafc', padding: 14 },
});