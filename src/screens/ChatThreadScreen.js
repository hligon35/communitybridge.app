import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, Button, RefreshControl, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard, Platform, Alert, TouchableOpacity } from 'react-native';
// removed SafeAreaView usage to avoid shifting content down
import { useData } from '../DataContext';
import { useAuth } from '../AuthContext';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { canViewThread, getConversationParticipant, getUserParticipantTokens, isMessageFromUser } from '../utils/chatThreads';
import { MaterialIcons } from '@expo/vector-icons';
import { HelpButton } from '../components/TopButtons';

export default function ChatThreadScreen({ route, navigation }) {
  const { threadId, threadIds: routeThreadIds, activeThreadId, isNew, to: initialTo, conversationTitle, initialDraft } = route.params || {};
  const { messages, sendMessage, markThreadRead, chatBlockedUserIds = [] } = useData();
  const [text, setText] = useState(String(initialDraft || ''));
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const headerHeight = useHeaderHeight ? useHeaderHeight() : 0;
  const insets = useSafeAreaInsets();
  const userTokens = useMemo(() => getUserParticipantTokens(user), [user]);
  const effectiveThreadIds = useMemo(() => {
    const raw = Array.isArray(routeThreadIds) && routeThreadIds.length ? routeThreadIds : [activeThreadId || threadId];
    return Array.from(new Set(raw.map((value) => String(value || '').trim()).filter(Boolean)));
  }, [activeThreadId, routeThreadIds, threadId]);
  const sendThreadId = useMemo(() => String(activeThreadId || effectiveThreadIds[0] || threadId || '').trim(), [activeThreadId, effectiveThreadIds, threadId]);

  const threadMessages = useMemo(() => messages
    .filter((m) => {
      const messageThreadId = String(m?.threadId || m?.id || '').trim();
      if (!messageThreadId) return false;
      return effectiveThreadIds.includes(messageThreadId);
    })
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), [effectiveThreadIds, messages]);

  const derivedConversationTitle = useMemo(() => {
    const explicitTitle = String(conversationTitle || '').trim();
    if (explicitTitle) return explicitTitle;

    const latestMessage = threadMessages[threadMessages.length - 1] || null;
    const participant = latestMessage ? getConversationParticipant(latestMessage, user) : null;
    const participantName = String(participant?.name || participant?.fullName || participant?.email || '').trim();
    if (participantName) return participantName;

    const initialRecipient = Array.isArray(initialTo) && initialTo.length ? initialTo[0] : null;
    const initialName = String(initialRecipient?.name || initialRecipient?.email || '').trim();
    if (initialName) return initialName;

    return 'Conversation';
  }, [conversationTitle, initialTo, threadMessages, user]);

  const replyTargets = useMemo(() => {
    if (Array.isArray(initialTo) && initialTo.length) {
      return initialTo
        .filter(Boolean)
        .map((target) => ({
          id: target?.id,
          uid: target?.uid,
          name: target?.name,
          email: target?.email,
          avatar: target?.avatar,
        }))
        .filter((target) => target.id || target.uid || target.name || target.email);
    }

    const latestMessage = threadMessages[threadMessages.length - 1] || null;
    const participant = latestMessage ? getConversationParticipant(latestMessage, user) : null;
    if (!participant) return [];

    return [{
      id: participant?.id,
      uid: participant?.uid,
      name: participant?.name || participant?.fullName,
      email: participant?.email,
      avatar: participant?.avatar,
    }].filter((target) => target.id || target.uid || target.name || target.email);
  }, [initialTo, threadMessages, user]);

  useEffect(() => {
    if (!threadId || !threadMessages.length || !userTokens.length) return;
    const latestIncoming = [...threadMessages]
      .reverse()
      .find((message) => !isMessageFromUser(message, user));
    if (!latestIncoming?.createdAt) return;
    markThreadRead(threadId, latestIncoming.createdAt);
  }, [markThreadRead, threadId, threadMessages, user, userTokens.length]);

  // authorization: only participants or admin may view the thread
  const isParticipant = useMemo(() => {
    if (isNew) return true;
    return canViewThread(threadMessages, user);
  }, [threadMessages, user, isNew]);

  const isChatBlocked = useMemo(() => {
    return userTokens.some((token) => (chatBlockedUserIds || []).some((id) => String(id).trim().toLowerCase() === token));
  }, [chatBlockedUserIds, userTokens]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: derivedConversationTitle,
      headerLeft: Platform.OS === 'web' ? undefined : () => (
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          style={{
            marginLeft: 6,
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: '#f1f5f9',
            borderWidth: 1,
            borderColor: '#e2e8f0',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#0f172a',
            shadowOpacity: 0.06,
            shadowOffset: { width: 0, height: 1 },
            shadowRadius: 2,
            elevation: 1,
          }}
        >
          <MaterialIcons name="chevron-left" size={24} color="#111827" />
        </TouchableOpacity>
      ),
      headerRight: Platform.OS === 'web' ? () => null : () => <HelpButton />,
    });
    if (route.params?.conversationTitle !== derivedConversationTitle) {
      navigation.setParams({ conversationTitle: derivedConversationTitle });
    }
  }, [derivedConversationTitle, navigation, route.params?.conversationTitle]);

  async function handleSend() {
    if (!text.trim()) return;
    if (!isParticipant) return; // prevent sending if not authorized
    if (isChatBlocked) {
      Alert.alert('Messaging blocked', 'An administrator has disabled your ability to send messages.');
      return;
    }
    try {
      await sendMessage({ threadId: sendThreadId, body: text, to: replyTargets.length ? replyTargets : undefined });
      setText('');
      Keyboard.dismiss();
    } catch (e) {
      Alert.alert('Unable to send', e?.message || 'Could not send message.');
    }
  }
  if (!isParticipant) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <Text style={{ fontWeight: '700', marginBottom: 8 }}>Not authorized</Text>
        <Text style={{ color: '#6b7280', textAlign: 'center' }}>You are not a participant in this conversation.</Text>
      </View>
    );
  }

  async function onRefresh() {
    try { setRefreshing(true); /* trigger data refresh if available */ } catch (e) {} finally { setRefreshing(false); }
  }

  const OuterWrapper = Platform.OS === 'web' ? View : TouchableWithoutFeedback;
  const outerWrapperProps = Platform.OS === 'web' ? {} : { onPress: Keyboard.dismiss, accessible: false };

  return (
    <ScreenWrapper style={{ flex: 1, backgroundColor: '#fff' }} bottomSpacerHeight={0}>
      <OuterWrapper {...outerWrapperProps}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight + Math.max(insets.top, 0) : 0}
        >
          <FlatList
            data={threadMessages}
            keyExtractor={(i) => i.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 104 }}
            renderItem={({ item }) => {
              const isMine = isMessageFromUser(item, user);
              return (
                <View style={{ paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', justifyContent: isMine ? 'flex-end' : 'flex-start' }}>
                  {!isMine && (
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                      <Text style={{ fontWeight: '700' }}>{(item.sender?.name || '?').slice(0,1)}</Text>
                    </View>
                  )}
                  <View style={{ maxWidth: '78%' }}>
                    {!isMine && <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{item.sender?.name}</Text>}
                    <View style={{ backgroundColor: isMine ? '#2563eb' : '#f3f4f6', padding: 10, borderRadius: 10 }}>
                      <Text style={{ color: isMine ? '#fff' : '#111' }}>{item.body}</Text>
                    </View>
                    <Text style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>{new Date(item.createdAt).toLocaleString()}</Text>
                  </View>
                  {isMine && (
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#e0f2fe', alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
                      <Text style={{ fontWeight: '700' }}>{(item.sender?.name || '?').slice(0,1)}</Text>
                    </View>
                  )}
                </View>
              );
            }}
          />

          <View style={{ paddingTop: 8, paddingHorizontal: 8, paddingBottom: Math.max(insets.bottom, 8), borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#fff' }}>
            {isChatBlocked ? (
              <Text style={{ color: '#b91c1c', fontWeight: '600', marginBottom: 8 }}>
                Messaging has been disabled for this account by an administrator.
              </Text>
            ) : (!replyTargets.length && !threadMessages.length) ? (
              <Text style={{ color: '#92400e', fontWeight: '600', marginBottom: 8 }}>
                Waiting for conversation details before you can reply.
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row' }}>
            <TextInput
              value={text}
              onChangeText={(value) => setText(String(value || '').slice(0, 5000))}
              placeholder="Message"
              style={{ flex: 1, padding: 8, borderWidth: 1, borderColor: '#ddd', marginRight: 8, backgroundColor: isChatBlocked ? '#f8fafc' : '#fff', color: isChatBlocked ? '#94a3b8' : '#111827' }}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              editable={!isChatBlocked && (!!threadMessages.length || !!replyTargets.length)}
              maxLength={5000}
            />
            <Button title="Send" onPress={handleSend} disabled={isChatBlocked || (!threadMessages.length && !replyTargets.length)} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </OuterWrapper>
    </ScreenWrapper>
  );
}
