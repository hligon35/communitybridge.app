import React, { useMemo, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

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

function normalizeAnnouncements(items = []) {
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

export default function AnnouncementFeed({ items = [], emptyLabel = 'No announcements at the moment' }) {
  const [selectedImage, setSelectedImage] = useState('');
  const announcements = useMemo(() => normalizeAnnouncements(items), [items]);

  if (!announcements.length) {
    return (
      <View style={styles.emptyBanner}>
        <MaterialIcons name="campaign" size={16} color="#64748b" />
        <Text style={styles.emptyBannerText}>{emptyLabel}</Text>
      </View>
    );
  }

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
  postAuthor: { color: '#0f172a', fontWeight: '800' },
  postStamp: { color: '#64748b', fontSize: 12, marginTop: 2 },
  postTitle: { marginTop: 12, color: '#0f172a', fontWeight: '800', fontSize: 15 },
  postBody: { marginTop: 8, color: '#334155', lineHeight: 20 },
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
});
