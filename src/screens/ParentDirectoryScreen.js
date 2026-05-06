import React from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Image, Linking, Alert } from 'react-native';
import { useData } from '../DataContext';
import { useNavigation } from '@react-navigation/native';
// header provided by ScreenWrapper
import { ScreenWrapper } from '../components/ScreenWrapper';
import { MaterialIcons } from '@expo/vector-icons';
import AppIconButton from '../components/AppIconButton';
import { avatarSourceFor } from '../utils/idVisibility';

export default function ParentDirectoryScreen() {
  const { parents = [], children = [] } = useData();
  const navigation = useNavigation();

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
