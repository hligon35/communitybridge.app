import React, { useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Image, Linking, Alert, Platform, ScrollView, useWindowDimensions } from 'react-native';
import { useData } from '../DataContext';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../AuthContext';
// header provided by ScreenWrapper
import { ScreenWrapper } from '../components/ScreenWrapper';
import AppIconButton from '../components/AppIconButton';
import { avatarSourceFor } from '../utils/idVisibility';
import { getPhoneAccessProfile, isPhoneViewport as resolvePhoneViewport } from '../utils/mobileRoleAccess';

function formatMaskedParentName(parent) {
  const rawName = String(parent?.firstName ? `${parent.firstName} ${parent.lastName || ''}` : parent?.name || '').trim();
  const parts = rawName.split(/\s+/).filter(Boolean);
  const firstName = parts[0] || 'Family';
  const lastName = parts.slice(1).join(' ');
  return lastName ? `${firstName} ${lastName.charAt(0).toUpperCase()}.` : firstName;
}

export default function ParentDirectoryScreen() {
  const { user } = useAuth();
  const { parents = [], children = [] } = useData();
  const navigation = useNavigation();
  const { width, height } = useWindowDimensions();
  const phoneAccessProfile = getPhoneAccessProfile(user?.role);

  const parentSummaries = useMemo(() => (parents || []).map((parent) => {
    const linkedChildren = (children || []).filter((child) => (child.parents || []).some((entry) => {
      const id = entry && typeof entry === 'object' ? entry.id : entry;
      return id === parent.id;
    }));
    return {
      id: parent.id,
      name: formatMaskedParentName(parent),
      childCount: linkedChildren.length,
      children: linkedChildren.slice(0, 3).map((child) => String(child?.name || '').trim()).filter(Boolean),
    };
  }), [children, parents]);

  const phoneFamilySummary = useMemo(() => parentSummaries.reduce((summary, parent) => {
    summary.total += 1;
    if (parent.childCount >= 2) summary.multiChild += 1;
    else summary.singleChild += 1;
    return summary;
  }, { total: 0, singleChild: 0, multiChild: 0 }), [parentSummaries]);

  if (Platform.OS !== 'web' && resolvePhoneViewport(width, height)) {
    if (['office', 'reception', 'admin'].includes(phoneAccessProfile)) {
      return (
        <ScreenWrapper style={styles.container}>
          <ScrollView contentContainerStyle={styles.phoneContent} showsVerticalScrollIndicator={false}>
            <View style={styles.phoneCard}>
              <Text style={styles.phoneCardTitle}>Phone family access stays summary-only.</Text>
              <Text style={styles.phoneCardBody}>This phone view keeps family access limited to masked names, linked learner counts, and roster summaries without contact actions or profile drill-down.</Text>
            </View>

            <View style={styles.phoneMetricRow}>
              <View style={[styles.phoneMetricCard, styles.phoneMetricCardLeft]}>
                <Text style={styles.phoneMetricLabel}>Visible families</Text>
                <Text style={styles.phoneMetricValue}>{phoneFamilySummary.total}</Text>
                <Text style={styles.phoneMetricDetail}>Current phone-safe roster scope.</Text>
              </View>
              <View style={[styles.phoneMetricCard, styles.phoneMetricCardRight]}>
                <Text style={styles.phoneMetricLabel}>Multi-child homes</Text>
                <Text style={styles.phoneMetricValue}>{phoneFamilySummary.multiChild}</Text>
                <Text style={styles.phoneMetricDetail}>{phoneFamilySummary.singleChild} single-child homes</Text>
              </View>
            </View>

            <Text style={styles.phoneSectionTitle}>Family summary</Text>
            {parentSummaries.length ? parentSummaries.slice(0, 10).map((parent) => (
              <View key={parent.id} style={styles.phoneListCard}>
                <Text style={styles.phoneListTitle}>{parent.name}</Text>
                <Text style={styles.phoneListMeta}>{parent.childCount} linked learner{parent.childCount === 1 ? '' : 's'}</Text>
                <Text style={styles.phoneListDetail}>{parent.children.length ? parent.children.join(' • ') : 'No linked learners visible in this scope.'}</Text>
              </View>
            )) : <Text style={styles.emptyText}>No families are visible right now.</Text>}
          </ScrollView>
        </ScreenWrapper>
      );
    }
  }

  const openPhone = (phone) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Unable to place call', 'Your device could not open the phone app.');
    });
  };

  const openEmail = (email) => {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() => {
      Alert.alert('Unable to open email', 'Your device could not open the email app.');
    });
  };

  const renderItem = ({ item }) => (
    <View style={styles.row}>
      <TouchableOpacity
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
        onPress={() => {
          console.log('Parent row pressed', item && item.id);
          // Prefer push to ensure a new screen is pushed on this stack; fallback to navigate
          try {
            if (navigation && navigation.push) navigation.push('ParentDetail', { parentId: item.id });
            else navigation.navigate('ParentDetail', { parentId: item.id });
          } catch (e) {
            console.warn('navigate to ParentDetail failed', e);
            try { navigation.navigate('ParentDetail', { parentId: item.id }); } catch (e2) { console.warn(e2); }
          }
        }}
      >
        <Image source={avatarSourceFor(item)} style={styles.avatar} />
        <View style={styles.info}>
          <Text style={styles.name}>{item.firstName ? `${item.firstName} ${item.lastName}` : item.name}</Text>
          {/* show children assigned to this parent, stacked */}
          {((children || []).filter((c) => (c.parents || []).some((p) => (p && ((p.id && p.id === item.id) || p === item.id || (p.id === item.id))))).map((c) => (
            <Text key={c.id} numberOfLines={1} style={styles.meta}>{c.name}</Text>
          )))}
        </View>
      </TouchableOpacity>
      <View style={styles.actions}>
        <AppIconButton accessibilityLabel="Call parent" name="call" iconSize={18} size={36} onPress={() => openPhone(item.phone)} style={styles.iconBtn} />
        <AppIconButton accessibilityLabel="Email parent" name="email" iconSize={18} size={36} onPress={() => openEmail(item.email)} style={styles.iconBtn} />
      </View>
    </View>
  );

  return (
    <ScreenWrapper style={styles.container}>
      <FlatList
        data={parents || []}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        ListEmptyComponent={<View style={styles.empty}><Text style={{ color: '#666' }}>No parents available</Text></View>}
        contentContainerStyle={{ padding: 12 }}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  phoneContent: { padding: 16 },
  phoneCard: { borderRadius: 18, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff', padding: 16, marginBottom: 12 },
  phoneCardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  phoneCardBody: { marginTop: 8, color: '#64748b', lineHeight: 20 },
  phoneMetricRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  phoneMetricCard: { borderRadius: 18, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff', padding: 16, width: '48.5%' },
  phoneMetricCardLeft: {},
  phoneMetricCardRight: {},
  phoneMetricLabel: { color: '#64748b', fontWeight: '700' },
  phoneMetricValue: { marginTop: 8, fontSize: 26, fontWeight: '800', color: '#0f172a' },
  phoneMetricDetail: { marginTop: 6, color: '#64748b', lineHeight: 18 },
  phoneSectionTitle: { marginTop: 8, marginBottom: 10, fontSize: 16, fontWeight: '800', color: '#0f172a' },
  phoneListCard: { borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff', padding: 14, marginBottom: 10 },
  phoneListTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  phoneListMeta: { marginTop: 4, color: '#334155', fontWeight: '700' },
  phoneListDetail: { marginTop: 6, color: '#64748b', lineHeight: 18 },
  emptyText: { color: '#64748b' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  avatar: { width: 56, height: 56, borderRadius: 28, marginRight: 12, backgroundColor: '#ddd' },
  info: { flex: 1 },
  name: { fontWeight: '700', fontSize: 16 },
  meta: { color: '#6b7280', marginTop: 4 },
  empty: { padding: 24, alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  iconTouch: { paddingHorizontal: 8 },
  iconBtn: { marginHorizontal: 6 },
});
