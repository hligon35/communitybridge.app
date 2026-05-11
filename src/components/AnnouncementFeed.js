import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ANNOUNCEMENT_DELETE_STORAGE_PREFIX = 'announcement_feed_deleted_v1';

function formatAnnouncementStamp(value) {
  const parsed = value ? new Date(value) : null;
  if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) return 'Recently posted';
  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getAnnouncementImage(item) {
  const candidates = [item?.image, item?.imageUrl, item?.mediaUrl, item?.attachmentUrl];
  const match = candidates.find((value) => typeof value === 'string' && value.trim());
  return match ? String(match).trim() : '';
}

export function normalizeAnnouncements(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => String(item?.type || '').trim().toLowerCase() === 'admin_memo')
    .sort((left, right) => new Date(right?.createdAt || right?.date || 0).getTime() - new Date(left?.createdAt || left?.date || 0).getTime())
    .map((item) => ({
      id: String(item?.id || `${item?.subject || item?.title || 'announcement'}-${item?.createdAt || item?.date || ''}`),
      title: String(item?.subject || item?.title || 'Announcement').trim() || 'Announcement',
      body: String(item?.body || item?.note || '').trim(),
      author: String(item?.proposerName || item?.authorName || item?.createdByName || 'Office Announcement').trim() || 'Office Announcement',
      stamp: formatAnnouncementStamp(item?.createdAt || item?.date),
      image: getAnnouncementImage(item),
    }));
}

export default function AnnouncementFeed({ items = [], emptyLabel = 'No announcements at the moment', variant = 'header', headerTapMode = 'screen', storageScopeKey = 'default' }) {
  const [selectedImage, setSelectedImage] = useState('');
  const [dismissedCount, setDismissedCount] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [deletedIds, setDeletedIds] = useState({});
  const navigation = useNavigation();
  const deletionStorageKey = `${ANNOUNCEMENT_DELETE_STORAGE_PREFIX}:${String(storageScopeKey || 'default').trim() || 'default'}`;
  const announcements = useMemo(() => normalizeAnnouncements(items), [items]);
  const visibleAnnouncements = useMemo(() => announcements.filter((item) => !deletedIds?.[item.id]), [announcements, deletedIds]);
  const remainingAnnouncements = headerTapMode === 'overlay' ? visibleAnnouncements : visibleAnnouncements.slice(dismissedCount);
  const topAnnouncement = remainingAnnouncements[0] || null;
  const hasMoreToReview = remainingAnnouncements.length > 1;

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(deletionStorageKey)
      .then((value) => {
        if (cancelled) return;
        const parsed = value ? JSON.parse(value) : {};
        setDeletedIds(parsed && typeof parsed === 'object' ? parsed : {});
      })
      .catch(() => {
        if (!cancelled) setDeletedIds({});
      });
    return () => {
      cancelled = true;
    };
  }, [deletionStorageKey]);

  async function persistDeleted(next) {
    setDeletedIds(next);
    try {
      await AsyncStorage.setItem(deletionStorageKey, JSON.stringify(next));
    } catch (_) {
      // best effort local persistence
    }
  }

  async function deleteAnnouncement(id) {
    if (!id) return;
    const next = { ...(deletedIds || {}), [id]: new Date().toISOString() };
    await persistDeleted(next);
  }

  if (!announcements.length || (variant === 'header' && !topAnnouncement)) {
    return (
      <View style={styles.emptyBanner}>
        <MaterialIcons name="campaign" size={16} color="#64748b" />
        <Text style={styles.emptyBannerText}>{emptyLabel}</Text>
      </View>
    );
  }

  if (variant === 'feed') {
    return (
      <>
        <View style={styles.feedWrap}>
          {announcements.map((item) => (
            <View key={item.id} style={styles.postCard}>
              <View style={styles.postHeader}>
                <View style={styles.postAvatar}>
                  <MaterialIcons name="campaign" size={18} color="#1d4ed8" />
                </View>
                <View style={styles.postHeaderText}>
                  <Text style={styles.postAuthor}>{item.author}</Text>
                  <Text style={styles.postStamp}>{item.stamp}</Text>
                </View>
              </View>
              <Text style={styles.postTitle}>{item.title}</Text>
              {item.body ? <Text style={styles.postBody}>{item.body}</Text> : null}
              {item.image ? (
                <TouchableOpacity activeOpacity={0.9} onPress={() => setSelectedImage(item.image)}>
                  <Image source={{ uri: item.image }} style={styles.postImage} resizeMode="cover" />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
        <Modal visible={!!selectedImage} transparent animationType="fade" onRequestClose={() => setSelectedImage('')}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedImage('')}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              {selectedImage ? <Image source={{ uri: selectedImage }} style={styles.modalImage} resizeMode="contain" /> : null}
            </Pressable>
          </Pressable>
        </Modal>
      </>
    );
  }

  return (
    <>
      <View style={styles.feedWrap}>
        <TouchableOpacity
          activeOpacity={headerTapMode === 'overlay' || hasMoreToReview ? 0.92 : 1}
          onPress={() => {
            if (headerTapMode === 'overlay') {
              setOverlayOpen(true);
              return;
            }
            if (hasMoreToReview) navigation.navigate('AnnouncementFeedScreen');
          }}
        >
          <View key={topAnnouncement.id} style={styles.postCard}>
            <View style={styles.postHeader}>
              <View style={styles.postAvatar}>
                <MaterialIcons name="campaign" size={18} color="#1d4ed8" />
              </View>
              <View style={styles.postHeaderText}>
                <Text style={styles.postAuthor}>{topAnnouncement.author}</Text>
                <Text style={styles.postStamp}>{topAnnouncement.stamp}</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (headerTapMode === 'overlay') {
                    deleteAnnouncement(topAnnouncement.id).catch(() => {});
                    return;
                  }
                  setDismissedCount((value) => value + 1);
                }}
                accessibilityLabel="Close announcement"
                style={styles.closeButton}
              >
                <MaterialIcons name="close" size={18} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text style={styles.postTitle}>{topAnnouncement.title}</Text>
            {topAnnouncement.body ? <Text style={styles.postBody}>{topAnnouncement.body}</Text> : null}
            {headerTapMode === 'overlay' ? <Text style={styles.moreLabel}>Tap to review unread announcements.</Text> : hasMoreToReview ? <Text style={styles.moreLabel}>Tap to see {remainingAnnouncements.length - 1} more announcement{remainingAnnouncements.length - 1 === 1 ? '' : 's'}.</Text> : null}
            {topAnnouncement.image ? (
              <TouchableOpacity activeOpacity={0.9} onPress={() => setSelectedImage(topAnnouncement.image)}>
                <Image source={{ uri: topAnnouncement.image }} style={styles.postImage} resizeMode="cover" />
              </TouchableOpacity>
            ) : null}
          </View>
        </TouchableOpacity>
      </View>
      <Modal visible={!!selectedImage} transparent animationType="fade" onRequestClose={() => setSelectedImage('')}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedImage('')}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            {selectedImage ? <Image source={{ uri: selectedImage }} style={styles.modalImage} resizeMode="contain" /> : null}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={overlayOpen} transparent animationType="fade" onRequestClose={() => setOverlayOpen(false)}>
        <Pressable style={styles.overlayBackdrop} onPress={() => setOverlayOpen(false)}>
          <Pressable style={styles.overlayCard} onPress={() => {}}>
            <View style={styles.overlayHeader}>
              <Text style={styles.overlayTitle}>Unread Announcements</Text>
              <TouchableOpacity onPress={() => setOverlayOpen(false)} style={styles.overlayCloseButton} accessibilityLabel="Close unread announcements">
                <MaterialIcons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.overlayList} contentContainerStyle={styles.overlayListContent} showsVerticalScrollIndicator={false}>
              {visibleAnnouncements.length ? visibleAnnouncements.map((item) => (
                <View key={item.id} style={styles.overlayItemCard}>
                  <View style={styles.overlayItemHeader}>
                    <View style={styles.overlayItemHeaderText}>
                      <Text style={styles.overlayItemAuthor}>{item.author}</Text>
                      <Text style={styles.overlayItemStamp}>{item.stamp}</Text>
                    </View>
                    <TouchableOpacity onPress={() => deleteAnnouncement(item.id).catch(() => {})} style={styles.overlayDeleteButton} accessibilityLabel={`Delete ${item.title}`}>
                      <MaterialIcons name="delete-outline" size={20} color="#b91c1c" />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.overlayItemTitle}>{item.title}</Text>
                  {item.body ? <Text style={styles.overlayItemBody}>{item.body}</Text> : null}
                </View>
              )) : <Text style={styles.overlayEmptyText}>No unread announcements.</Text>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  emptyBanner: {
    marginBottom: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dbe2ea',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyBannerText: { marginLeft: 8, color: '#64748b', fontWeight: '700' },
  feedWrap: { marginBottom: 14 },
  postCard: {
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbe2ea',
    backgroundColor: '#ffffff',
    padding: 14,
  },
  postHeader: { flexDirection: 'row', alignItems: 'center' },
  postAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postHeaderText: { marginLeft: 10, flex: 1 },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  postAuthor: { color: '#0f172a', fontWeight: '800' },
  postStamp: { color: '#64748b', fontSize: 12, marginTop: 2 },
  postTitle: { marginTop: 12, color: '#0f172a', fontWeight: '800', fontSize: 15 },
  postBody: { marginTop: 8, color: '#334155', lineHeight: 20 },
  moreLabel: { marginTop: 10, color: '#1d4ed8', fontWeight: '700' },
  postImage: { marginTop: 12, width: '100%', height: 180, borderRadius: 14, backgroundColor: '#e2e8f0' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    width: '100%',
    maxWidth: 780,
    maxHeight: '82%',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#020617',
  },
  modalImage: { width: '100%', height: 520, backgroundColor: '#020617' },
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.46)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  overlayCard: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '78%',
    borderRadius: 20,
    backgroundColor: '#ffffff',
    padding: 16,
  },
  overlayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overlayTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  overlayCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  overlayList: { marginTop: 14 },
  overlayListContent: { paddingBottom: 6 },
  overlayItemCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    padding: 12,
    marginBottom: 10,
  },
  overlayItemHeader: { flexDirection: 'row', alignItems: 'center' },
  overlayItemHeaderText: { flex: 1, paddingRight: 12 },
  overlayItemAuthor: { color: '#0f172a', fontWeight: '800' },
  overlayItemStamp: { marginTop: 2, color: '#64748b', fontSize: 12 },
  overlayDeleteButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  overlayItemTitle: { marginTop: 10, color: '#0f172a', fontWeight: '800', fontSize: 15 },
  overlayItemBody: { marginTop: 8, color: '#334155', lineHeight: 20 },
  overlayEmptyText: { color: '#64748b', textAlign: 'center', paddingVertical: 20 },
});
