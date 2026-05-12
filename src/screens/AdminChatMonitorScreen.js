import React, { useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import Api from '../Api';
import { isBcbaRole, isOfficeAdminRole } from '../core/tenant/models';
import { THERAPY_ROLE_LABELS } from '../utils/roleTerminology';
import AppIconButton from '../components/AppIconButton';
import { HelpButton } from '../components/TopButtons';
import { getUserParticipantTokens } from '../utils/chatThreads';

const IMAGE_PICKER_MEDIA_TYPES = ImagePicker.MediaTypeOptions?.Images ?? ImagePicker.MediaType?.Images;

function formatActivityTimestamp(value) {
  const parsed = value ? new Date(value) : null;
  if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) return 'Recently updated';
  return parsed.toLocaleString();
}

function getStaffActivityMeta(item) {
  const type = String(item?.type || '').trim().toLowerCase();
  const actor = String(item?.staffName || item?.proposerName || item?.title || 'Staff').trim();
  if (type === 'clock_event') {
    const status = String(item?.clockStatus || '').trim().toLowerCase() === 'out' ? 'Clocked out' : 'Clocked in';
    return {
      title: `${actor} · ${status}`,
      body: item?.body || `${actor} ${status.toLowerCase()}.`,
      stamp: formatActivityTimestamp(item?.eventAt || item?.createdAt),
    };
  }
  return {
    title: item?.title || actor,
    body: item?.body || 'Operational activity recorded.',
    stamp: formatActivityTimestamp(item?.createdAt),
  };
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function participantTokenMatches(left, right) {
  const normalizedLeft = normalizeToken(left);
  const normalizedRight = normalizeToken(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function addParticipantTokens(set, participant) {
  [participant?.id, participant?.uid, participant?.name, participant?.email]
    .map(normalizeToken)
    .filter(Boolean)
    .forEach((value) => set.add(value));
}

function isParticipantMatch(participant, userTokens = []) {
  const participantTokens = new Set();
  addParticipantTokens(participantTokens, participant);
  const values = Array.from(participantTokens);
  return (userTokens || []).some((token) => values.some((participantToken) => participantTokenMatches(token, participantToken)));
}

function getMessageParticipants(message) {
  return [message?.sender, ...(Array.isArray(message?.to) ? message.to : [])]
    .filter((participant) => participant && typeof participant === 'object');
}

function isMessageInvolvingUser(message, userTokens = []) {
  if (!Array.isArray(userTokens) || !userTokens.length) return false;
  return getMessageParticipants(message).some((participant) => isParticipantMatch(participant, userTokens));
}

function getDirectConversationLabel(message, userTokens = []) {
  const otherParticipants = getMessageParticipants(message)
    .filter((participant) => !isParticipantMatch(participant, userTokens))
    .map((participant) => getParticipantLabel(participant))
    .filter(Boolean);
  if (otherParticipants.length) return Array.from(new Set(otherParticipants)).join(', ');
  return getParticipantLabel(message?.sender) || 'Conversation';
}

function getMonitoredConversationLabel(message) {
  const senderLabel = getParticipantLabel(message?.sender);
  const recipients = (Array.isArray(message?.to) ? message.to : [])
    .map((participant) => getParticipantLabel(participant))
    .filter(Boolean);
  const recipientLabel = Array.from(new Set(recipients)).join(', ');
  if (senderLabel && recipientLabel) return `${senderLabel} to ${recipientLabel}`;
  return recipientLabel || senderLabel || 'Conversation';
}

function buildThreads(messages = [], options = {}) {
  const { userTokens = [], mode = 'monitor' } = options;
  const map = new Map();
  (messages || []).forEach((message, index) => {
    const key = message?.threadId || message?.id || `thread-${index}`;
    const existing = map.get(key) || { id: key, last: message, count: 0, recipientLabel: '', previewText: '' };
    existing.last = message;
    existing.count += 1;
    existing.recipientLabel = mode === 'inbox'
      ? getDirectConversationLabel(message, userTokens)
      : getMonitoredConversationLabel(message);
    existing.previewText = getPreviewText(message);
    map.set(key, existing);
  });
  return Array.from(map.values()).sort((left, right) => new Date(right?.last?.createdAt || 0).getTime() - new Date(left?.last?.createdAt || 0).getTime());
}

function getParticipantLabel(participant) {
  return String(participant?.name || participant?.fullName || participant?.email || participant?.id || '').trim();
}

function getPreviewText(message) {
  return String(message?.subject || message?.body || 'No recent message.').trim();
}

function buildThreadMessages(messages = [], threadId) {
  return (messages || [])
    .filter((message) => String(message?.threadId || message?.id || '') === String(threadId || ''))
    .sort((left, right) => new Date(left?.createdAt || 0).getTime() - new Date(right?.createdAt || 0).getTime());
}

export default function AdminChatMonitorScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { messages = [], parents = [], therapists = [], urgentMemos = [], sendAdminMemo, deleteThread } = useData();
  const isBcba = isBcbaRole(user?.role);
  const isOffice = isOfficeAdminRole(user?.role);
  const [tab, setTab] = useState('inbox');
  const [query, setQuery] = useState('');
  const [announcementAudience, setAnnouncementAudience] = useState('staff');
  const [announcementSubject, setAnnouncementSubject] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [announcementImage, setAnnouncementImage] = useState('');
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const [selectedInboxThreadId, setSelectedInboxThreadId] = useState('');
  const userTokens = useMemo(() => getUserParticipantTokens(user), [user]);

  const openNewStaffChat = () => {
    navigation.navigate('Chats', { screen: 'NewThread' });
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <HelpButton />,
      headerRight: () => (
        <TouchableOpacity
          onPress={openNewStaffChat}
          accessibilityLabel="Start a new staff chat"
          style={{ marginRight: 12, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eff6ff' }}
        >
          <MaterialIcons name="add" size={22} color="#1d4ed8" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const inboxMessages = useMemo(() => (Array.isArray(messages) ? messages : []).filter((message) => isMessageInvolvingUser(message, userTokens)), [messages, userTokens]);
  const monitoredMessages = useMemo(() => (Array.isArray(messages) ? messages : []).filter((message) => !isMessageInvolvingUser(message, userTokens)), [messages, userTokens]);
  const inboxThreads = useMemo(() => buildThreads(inboxMessages, { userTokens, mode: 'inbox' }), [inboxMessages, userTokens]);
  const monitoredThreads = useMemo(() => buildThreads(monitoredMessages, { mode: 'monitor' }), [monitoredMessages]);
  const filteredInboxThreads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return inboxThreads;
    return inboxThreads.filter((thread) => JSON.stringify(thread.last || {}).toLowerCase().includes(normalized));
  }, [inboxThreads, query]);
  const filteredMonitoredThreads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return monitoredThreads;
    return monitoredThreads.filter((thread) => JSON.stringify(thread.last || {}).toLowerCase().includes(normalized));
  }, [monitoredThreads, query]);
  const selectedInboxThread = useMemo(() => inboxThreads.find((thread) => thread.id === selectedInboxThreadId) || null, [selectedInboxThreadId, inboxThreads]);
  const selectedInboxMessages = useMemo(() => buildThreadMessages(inboxMessages, selectedInboxThreadId), [inboxMessages, selectedInboxThreadId]);
  const attachments = useMemo(() => [
    { id: 'pdf', label: 'PDFs', count: Math.max(1, filteredMonitoredThreads.length) },
    { id: 'notes', label: 'Notes', count: Math.max(1, therapists.length) },
    { id: 'reports', label: 'Reports', count: Math.max(1, parents.length) },
  ], [filteredMonitoredThreads.length, parents.length, therapists.length]);
  const recentAnnouncements = useMemo(() => {
    return (Array.isArray(urgentMemos) ? urgentMemos : [])
      .filter((item) => String(item?.type || '').toLowerCase() === 'admin_memo')
      .slice(0, 5);
  }, [urgentMemos]);
  const staffActivity = useMemo(() => {
    return (Array.isArray(urgentMemos) ? urgentMemos : [])
      .filter((item) => ['clock_event', 'quick_note', 'incident_log', 'unexpected_data'].includes(String(item?.type || '').trim().toLowerCase()))
      .sort((left, right) => new Date(right?.eventAt || right?.createdAt || 0).getTime() - new Date(left?.eventAt || left?.createdAt || 0).getTime())
      .slice(0, 20);
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
        image: announcementImage || null,
      });
      if (created?.id) {
        setAnnouncementSubject('');
        setAnnouncementBody('');
        setAnnouncementImage('');
      }
    } finally {
      setSendingAnnouncement(false);
    }
  }

  async function pickAnnouncementImage() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission?.status !== 'granted') {
        Alert.alert('Permission required', 'Allow photo library access to attach an announcement image.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: IMAGE_PICKER_MEDIA_TYPES, quality: 0.72 });
      if (result?.canceled) return;
      const asset = result?.assets?.[0];
      const uri = String(asset?.uri || '').trim();
      if (!uri) return;
      const fileName = uri.split('/').pop() || `announcement-${Date.now()}.jpg`;
      const mimeType = String(asset?.mimeType || '').trim() || 'image/jpeg';
      const formData = new FormData();
      formData.append('file', { uri, name: fileName, type: mimeType });
      const uploaded = await Api.uploadMedia(formData);
      const nextUrl = String(uploaded?.url || '').trim();
      if (!nextUrl) throw new Error('The image upload did not return a URL.');
      setAnnouncementImage(nextUrl);
    } catch (error) {
      Alert.alert('Upload failed', String(error?.message || error || 'The image could not be uploaded.'));
    }
  }

  function openInboxThread(threadId) {
    setSelectedInboxThreadId(String(threadId || ''));
  }

  function closeInboxThread() {
    setSelectedInboxThreadId('');
  }

  function confirmDeleteInboxThread(threadId) {
    const key = String(threadId || '').trim();
    if (!key || typeof deleteThread !== 'function') return;
    Alert.alert(
      'Delete thread',
      'Remove this conversation from the inbox?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteThread(key);
            if (selectedInboxThreadId === key) setSelectedInboxThreadId('');
          },
        },
      ]
    );
  }

  return (
    <ScreenWrapper
      style={styles.container}
      bannerRight={(
        <AppIconButton
          onPress={openNewStaffChat}
          accessibilityLabel="Start a new staff chat"
          name="add"
          size={36}
        />
      )}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipCarouselContent} style={styles.chipCarousel}>
          <View style={styles.tabRow}>
            {[
              { key: 'inbox', label: 'Inbox' },
              { key: 'activity', label: 'Staff Activity' },
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
            {selectedInboxThread ? (
              <>
                <View style={styles.inboxThreadHeader}>
                  <View style={styles.inboxThreadActionRow}>
                    <TouchableOpacity style={styles.inboxBackButton} onPress={closeInboxThread} accessibilityLabel="Back to conversation list">
                      <MaterialIcons name="arrow-back" size={18} color="#1d4ed8" />
                      <Text style={styles.inboxBackText}>Inbox</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteThreadButton} onPress={() => confirmDeleteInboxThread(selectedInboxThread.id)} accessibilityLabel="Delete inbox thread">
                      <MaterialIcons name="delete-outline" size={18} color="#b91c1c" />
                      <Text style={styles.deleteThreadText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.inboxThreadHeaderText}>
                      <Text style={styles.cardTitle}>{selectedInboxThread.recipientLabel || 'Conversation'}</Text>
                      <Text style={styles.rowText}>{selectedInboxThread.previewText || 'No recent message.'}</Text>
                    <Text style={styles.rowText}>{selectedInboxThread.count} message{selectedInboxThread.count === 1 ? '' : 's'}</Text>
                  </View>
                </View>
                {selectedInboxMessages.length ? selectedInboxMessages.map((message, index) => {
                  const isMine = String(message?.sender?.id || '') === String(user?.id || '');
                  return (
                    <View key={String(message?.id || `${selectedInboxThread.id}-${index}`)} style={[styles.chatMessageRow, isMine ? styles.chatMessageRowMine : null]}>
                      <View style={[styles.chatMessageBubble, isMine ? styles.chatMessageBubbleMine : styles.chatMessageBubbleOther]}>
                        {!isMine ? <Text style={styles.chatMessageSender}>{message?.sender?.name || 'Unknown sender'}</Text> : null}
                        <Text style={[styles.chatMessageBody, isMine ? styles.chatMessageBodyMine : null]}>{message?.body || message?.subject || 'No message body provided.'}</Text>
                        <Text style={styles.chatMessageStamp}>{formatActivityTimestamp(message?.createdAt)}</Text>
                      </View>
                    </View>
                  );
                }) : <Text style={styles.rowText}>No messages are available for this thread.</Text>}
              </>
            ) : (
              <>
                <Text style={styles.cardTitle}>Inbox</Text>
                {filteredInboxThreads.length ? filteredInboxThreads.slice(0, 8).map((thread) => (
                  <View key={thread.id} style={styles.threadRowInline}>
                    <TouchableOpacity style={styles.threadRowContent} onPress={() => openInboxThread(thread.id)}>
                      <Text style={styles.threadTitle}>{thread.recipientLabel || 'Conversation'}</Text>
                      <Text style={styles.rowText}>{thread.previewText || 'No recent message.'}</Text>
                      <Text style={styles.rowText}>{thread.count} message{thread.count === 1 ? '' : 's'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.threadDeleteIconButton} onPress={() => confirmDeleteInboxThread(thread.id)} accessibilityLabel="Delete inbox thread">
                      <MaterialIcons name="delete-outline" size={18} color="#b91c1c" />
                    </TouchableOpacity>
                  </View>
                )) : <Text style={styles.rowText}>No direct inbox conversations are available.</Text>}
              </>
            )}
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
                {announcementImage ? <Image source={{ uri: announcementImage }} style={styles.announcementImagePreview} resizeMode="cover" /> : null}
                <View style={styles.announcementActionRow}>
                  <TouchableOpacity style={styles.secondaryActionButton} onPress={pickAnnouncementImage} disabled={sendingAnnouncement}>
                    <Text style={styles.secondaryActionText}>{announcementImage ? 'Replace image' : 'Add image'}</Text>
                  </TouchableOpacity>
                  {announcementImage ? (
                    <TouchableOpacity style={styles.secondaryActionButton} onPress={() => setAnnouncementImage('')} disabled={sendingAnnouncement}>
                      <Text style={styles.secondaryActionText}>Remove image</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
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

        {tab === 'activity' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Staff activity</Text>
            <Text style={styles.rowText}>Clock-ins, clock-outs, and quick operational logs land here for office review without changing the underlying staff workflow.</Text>
            {staffActivity.length ? staffActivity.map((item) => {
              const meta = getStaffActivityMeta(item);
              return (
                <View key={item.id} style={styles.threadRow}>
                  <Text style={styles.threadTitle}>{meta.title}</Text>
                  <Text style={styles.rowText}>{meta.body}</Text>
                  <Text style={styles.activityStamp}>{meta.stamp}</Text>
                </View>
              );
            }) : <Text style={styles.rowText}>No staff activity has been recorded yet.</Text>}
          </View>
        ) : null}

        {tab === 'threads' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Conversation threads</Text>
            <Text style={styles.rowText}>Monitor conversations between other users here. Your direct messages stay in Inbox.</Text>
            {filteredMonitoredThreads.length ? filteredMonitoredThreads.map((thread) => (
              <TouchableOpacity key={thread.id} style={styles.threadRow} onPress={() => navigation.navigate('ChatThread', { threadId: thread.id, conversationTitle: thread.recipientLabel || 'Conversation' })}>
                <Text style={styles.threadTitle}>{thread.recipientLabel || 'Conversation'}</Text>
                <Text style={styles.rowText}>{thread.previewText || 'No recent message.'}</Text>
                <Text style={styles.rowText}>{thread.last?.createdAt ? new Date(thread.last.createdAt).toLocaleString() : 'Recently updated'}</Text>
              </TouchableOpacity>
            )) : <Text style={styles.rowText}>No monitored conversation threads are available.</Text>}
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
  announcementImagePreview: { marginTop: 12, width: '100%', height: 132, borderRadius: 14, backgroundColor: '#e2e8f0' },
  announcementActionRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 4 },
  secondaryActionButton: { marginRight: 10, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#eff6ff' },
  secondaryActionText: { color: '#1d4ed8', fontWeight: '700' },
  broadcastHistoryWrap: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 12 },
  broadcastHistoryRow: { marginBottom: 10 },
  sectionLabel: { fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  threadRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  threadTitle: { fontWeight: '800', color: '#0f172a' },
  inboxThreadHeader: { marginBottom: 4 },
  inboxThreadActionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  inboxBackButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#eff6ff' },
  inboxBackText: { marginLeft: 6, color: '#1d4ed8', fontWeight: '800' },
  deleteThreadButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#fee2e2' },
  deleteThreadText: { marginLeft: 6, color: '#b91c1c', fontWeight: '800' },
  inboxThreadHeaderText: { marginBottom: 6 },
  threadRowInline: { flexDirection: 'row', alignItems: 'flex-start', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingVertical: 10 },
  threadRowContent: { flex: 1, paddingRight: 8 },
  threadDeleteIconButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  chatMessageRow: { paddingVertical: 6, flexDirection: 'row', justifyContent: 'flex-start' },
  chatMessageRowMine: { justifyContent: 'flex-end' },
  chatMessageBubble: { maxWidth: '82%', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  chatMessageBubbleOther: { backgroundColor: '#f3f4f6' },
  chatMessageBubbleMine: { backgroundColor: '#dbeafe' },
  chatMessageSender: { marginBottom: 4, fontSize: 12, fontWeight: '700', color: '#475569' },
  chatMessageBody: { color: '#111827', lineHeight: 20 },
  chatMessageBodyMine: { color: '#0f172a' },
  chatMessageStamp: { marginTop: 6, fontSize: 11, color: '#94a3b8' },
  activityStamp: { color: '#94a3b8', fontSize: 12 },
  attachmentsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  attachmentCard: { width: '32%', borderRadius: 16, backgroundColor: '#f8fafc', padding: 14 },
});