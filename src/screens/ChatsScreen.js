import React, { useLayoutEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, Alert, Platform, ToastAndroid, Animated, RefreshControl } from 'react-native';
import { useData } from '../DataContext';
import { useAuth } from '../AuthContext';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { MaterialIcons } from '@expo/vector-icons';
import AppIconButton from '../components/AppIconButton';
import { logPress } from '../utils/logger';
import { HelpButton } from '../components/TopButtons';
import { buildVisibleThreads } from '../utils/chatThreads';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function MessageRow({ item, user, navigation, archiveThread, deleteThread }) {
  const swipeableRef = useRef(null);
  const last = item.last || {};
  const isUnread = !!item.isUnread;
  const avatarUri = String(item?.participant?.avatar || item?.participant?.photoURL || '').trim();
  const avatarLabel = String(item?.title || item?.participant?.name || 'C').trim();

  const showToast = (msg) => {
    if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
    else Alert.alert(msg);
  };

  const handleOpen = (direction) => {
    // NOTE: direction indicates which side opened. Map actions to match labels:
    // when left actions are opened -> perform Archive; when right opened -> perform Delete.
    if (direction === 'left') {
      // left actions opened
      archiveThread(item.id);
      showToast('Archived');
    } else {
      // right actions opened
      deleteThread(item.id);
      showToast('Deleted');
    }
    try { swipeableRef.current?.close(); } catch (e) {}
  };

  const renderLeftActions = (progress) => {
    const opacity = (progress && progress.interpolate) ? progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) : (progress || 1);
    return (
      <Animated.View style={{ backgroundColor: '#2563eb', justifyContent: 'center', alignItems: 'center', width: 120, opacity }}>
        <TouchableOpacity onPress={() => { archiveThread(item.id); showToast('Archived'); try { swipeableRef.current?.close(); } catch (e) {} }} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Archive</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderRightActions = (progress) => {
    const opacity = (progress && progress.interpolate) ? progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) : (progress || 1);
    return (
      <Animated.View style={{ backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', width: 120, opacity }}>
        <TouchableOpacity onPress={() => { deleteThread(item.id); showToast('Deleted'); try { swipeableRef.current?.close(); } catch (e) {} }} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Delete</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <Swipeable ref={swipeableRef} renderLeftActions={renderLeftActions} renderRightActions={renderRightActions} onSwipeableOpen={handleOpen}>
      <TouchableOpacity style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center', backgroundColor: isUnread ? '#f8fbff' : '#fff' }} onPress={() => navigation.navigate('ChatThread', { threadId: item.id, threadIds: item.threadIds, activeThreadId: item.activeThreadId })}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#f3f4f6', marginRight: 12 }} />
        ) : (
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <Text style={{ fontWeight: '700' }}>{avatarLabel.slice(0,1)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text numberOfLines={1} style={{ color: '#0f172a', flex: 1, paddingRight: 8, fontWeight: isUnread ? '800' : '700' }}>{item.title}</Text>
            <Text style={{ color: isUnread ? '#2563eb' : '#6b7280', fontSize: 12, fontWeight: isUnread ? '700' : '500' }}>{timeAgo(last.createdAt)}</Text>
          </View>
          <Text numberOfLines={1} style={{ marginTop: 4, color: '#374151', fontWeight: isUnread ? '700' : '400' }}>{last.body}</Text>
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
}

import { ScreenWrapper, CenteredContainer, WebColumns, WebStickySection, WebSurface } from '../components/ScreenWrapper';

export default function ChatsScreen({ navigation }) {
  const { messages, fetchAndSync, clearMessages, archiveThread, deleteThread, archivedThreads, threadReads = {} } = useData();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [dateFilterDays, setDateFilterDays] = useState(null); // null => no filter
  const isWeb = Platform.OS === 'web';

  const startNewMessage = () => {
    logPress('Chats:NewMessage');
    navigation.navigate('NewThread');
  };

  // Ensure the native stack header buttons are reset (Fast Refresh can preserve prior setOptions).
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: Platform.OS === 'web' ? undefined : () => <HelpButton />,
      headerRight: Platform.OS === 'web' ? () => null : () => (
        <TouchableOpacity
          onPress={startNewMessage}
          accessibilityLabel="Start a new chat"
          style={{ marginRight: 12, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eff6ff' }}
        >
          <MaterialIcons name="add" size={22} color="#1d4ed8" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const unarchivedList = buildVisibleThreads(messages, threadReads, user, archivedThreads);
  const displayList = ((dateFilterDays && Number(dateFilterDays) > 0)
    ? (unarchivedList || []).filter((t) => {
        const iso = t?.last?.createdAt;
        if (!iso) return true;
        const ts = new Date(iso).getTime();
        if (!Number.isFinite(ts)) return true;
        const cutoff = Date.now() - (Number(dateFilterDays) * 24 * 60 * 60 * 1000);
        return ts >= cutoff;
      })
    : unarchivedList);
  const unreadCount = displayList.filter((item) => item?.isUnread).length;

  async function onRefresh() {
    try {
      setRefreshing(true);
      await fetchAndSync({ force: true });
    } catch (e) {
      Alert.alert('Refresh failed', String(e?.message || e || 'Could not refresh conversations.'));
    } finally {
      setRefreshing(false);
    }
  }

  function HeaderIconButton({ name, onPress, accessibilityLabel, active }) {
    return (
      <AppIconButton
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        name={name}
        active={active}
        size={36}
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      />
    );
  }

  const openDateFilter = () => {
    logPress('Chats:OpenDateFilter');
    Alert.alert(
      'Filter by date',
      'Show conversations from the last…',
      [
        { text: '3 days', onPress: () => { logPress('Chats:DateFilter', { days: 3 }); setDateFilterDays(3); } },
        { text: '7 days', onPress: () => { logPress('Chats:DateFilter', { days: 7 }); setDateFilterDays(7); } },
        { text: '30 days', onPress: () => { logPress('Chats:DateFilter', { days: 30 }); setDateFilterDays(30); } },
        { text: 'Off', onPress: () => { logPress('Chats:DateFilter', { days: null }); setDateFilterDays(null); } },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  return (
    <ScreenWrapper
      bannerShowBack={false}
      bannerLeft={(
        <HeaderIconButton
          name="filter-list"
          active={!!dateFilterDays}
          accessibilityLabel={dateFilterDays ? `Filter: last ${dateFilterDays} days` : 'Filter: off'}
          onPress={openDateFilter}
        />
      )}
      bannerRight={(
        <HeaderIconButton
          name="add"
          accessibilityLabel="New message"
          onPress={startNewMessage}
        />
      )}
    >
      <CenteredContainer contentStyle={isWeb ? { maxWidth: 1120 } : null}>
        {isWeb ? (
          <WebColumns
            left={(
              <WebStickySection>
                <WebSurface>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a' }}>Inbox</Text>
                  <Text style={{ marginTop: 6, color: '#64748b' }}>Unread messages stay pinned to the top so follow-up work is obvious.</Text>
                  <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: '#eef2f7' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 }}>
                      <Text style={{ color: '#475569', fontWeight: '600' }}>Unread</Text>
                      <Text style={{ color: '#0f172a', fontWeight: '800' }}>{unreadCount}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#eef2f7' }}>
                      <Text style={{ color: '#475569', fontWeight: '600' }}>Visible threads</Text>
                      <Text style={{ color: '#0f172a', fontWeight: '800' }}>{displayList.length}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#eef2f7' }}>
                      <Text style={{ color: '#475569', fontWeight: '600' }}>Archived</Text>
                      <Text style={{ color: '#0f172a', fontWeight: '800' }}>{(archivedThreads || []).length}</Text>
                    </View>
                  </View>
                </WebSurface>
              </WebStickySection>
            )}
            main={(
              <WebSurface style={{ padding: 0, overflow: 'hidden' }}>
                <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#eef2f7' }}>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: '#0f172a' }}>Messages</Text>
                  <Text style={{ marginTop: 4, color: '#64748b' }}>{dateFilterDays ? `Showing threads active in the last ${dateFilterDays} days.` : 'Recent conversations across your organization.'}</Text>
                </View>
                <FlatList
                  style={{ width: '100%' }}
                  data={displayList}
                  keyExtractor={(i) => `${i.id}`}
                  renderItem={({ item }) => (
                    <MessageRow item={item} user={user} navigation={navigation} archiveThread={archiveThread} deleteThread={deleteThread} />
                  )}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                  ListEmptyComponent={(
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <Text style={{ color: '#6b7280' }}>
                        {dateFilterDays ? `No conversations in last ${dateFilterDays} days.` : 'No conversations yet.'}
                      </Text>
                    </View>
                  )}
                />
              </WebSurface>
            )}
            right={(
              <WebStickySection>
                <WebSurface compact>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a' }}>Workflow</Text>
                  <Text style={{ marginTop: 10, color: '#475569', lineHeight: 20 }}>Use the filter button to narrow the inbox, and archive threads once the follow-up is complete.</Text>
                  <TouchableOpacity onPress={startNewMessage} style={{ marginTop: 14, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#dbeafe' }}>
                    <Text style={{ color: '#1d4ed8', fontWeight: '800' }}>Start a new message</Text>
                  </TouchableOpacity>
                </WebSurface>
              </WebStickySection>
            )}
          />
        ) : (
          <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' }}>
            {/* Dev buttons moved to DevRoleSwitcher */}
            <FlatList
              style={{ width: '100%' }}
              data={displayList}
              keyExtractor={(i) => `${i.id}`}
              renderItem={({ item }) => (
                <MessageRow item={item} user={user} navigation={navigation} archiveThread={archiveThread} deleteThread={deleteThread} />
              )}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            />
            {(!displayList || displayList.length === 0) && (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={{ color: '#6b7280' }}>
                  {dateFilterDays ? `No conversations in last ${dateFilterDays} days.` : 'No conversations yet.'}
                </Text>
              </View>
            )}
          </View>
        )}
      </CenteredContainer>
    </ScreenWrapper>
  );
}
