import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { USER_ROLES, normalizeUserRole } from '../core/tenant/models';

const PRESET_ITEMS = ['Diapers', 'Lunch', 'Change of clothes', 'Medication', 'Other'];

function findRelevantChildren(role, userId, children) {
  const allChildren = Array.isArray(children) ? children : [];
  if (!userId) return [];
  if (role === USER_ROLES.THERAPIST) {
    return allChildren.filter((child) => {
      const assigned = [child?.amTherapist, child?.pmTherapist, child?.bcaTherapist];
      return assigned.some((entry) => {
        if (!entry) return false;
        if (typeof entry === 'string') return entry === userId;
        return entry?.id === userId;
      });
    });
  }
  return [];
}

export default function TherapistItemsNeededScreen({ route }) {
  const { user } = useAuth();
  const { children = [], sendAdminMemo, activeSeedPreset = '', seededItemsNeededByChild = {} } = useData();
  const role = normalizeUserRole(user?.role);
  const relevantChildren = useMemo(() => findRelevantChildren(role, user?.id, children), [children, role, user?.id]);
  const requestedChildId = String(route?.params?.childId || '').trim();
  const [selectedChildId, setSelectedChildId] = useState(requestedChildId || '');
  const [selectedItems, setSelectedItems] = useState([]);
  const [otherText, setOtherText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!relevantChildren.length) {
      setSelectedChildId('');
      return;
    }
    const exists = relevantChildren.some((child) => child?.id === selectedChildId);
    if (!exists) setSelectedChildId(requestedChildId || relevantChildren[0]?.id || '');
  }, [relevantChildren, requestedChildId, selectedChildId]);

  const selectedChild = useMemo(
    () => relevantChildren.find((child) => child?.id === selectedChildId) || relevantChildren[0] || null,
    [relevantChildren, selectedChildId]
  );
  const recentRequests = useMemo(() => {
    if (activeSeedPreset !== 'screenshot' || !selectedChild?.id) return [];
    return Array.isArray(seededItemsNeededByChild?.[selectedChild.id]) ? seededItemsNeededByChild[selectedChild.id] : [];
  }, [activeSeedPreset, seededItemsNeededByChild, selectedChild?.id]);

  const toggleItem = (item) => {
    setSelectedItems((current) => (
      current.includes(item)
        ? current.filter((entry) => entry !== item)
        : [...current, item]
    ));
  };

  const submit = async () => {
    if (!selectedChild?.id) {
      Alert.alert('Select a child', 'Choose a child before sending an items-needed request.');
      return;
    }
    if (!selectedItems.length) {
      Alert.alert('Select an item', 'Choose at least one needed item.');
      return;
    }
    const needsOther = selectedItems.includes('Other');
    if (needsOther && !String(otherText || '').trim()) {
      Alert.alert('Add the other item', 'Enter the custom item needed before sending.');
      return;
    }

    const itemLabels = selectedItems.map((item) => (item === 'Other' ? `Other: ${String(otherText).trim()}` : item));
    setSaving(true);
    try {
      await sendAdminMemo({
        childId: selectedChild.id,
        subject: `Items needed for ${selectedChild.name || 'child'}`,
        body: `Requested items: ${itemLabels.join(', ')}`,
      });
      setSelectedItems([]);
      setOtherText('');
      Alert.alert('Sent', 'The items-needed request was sent.');
    } catch (e) {
      Alert.alert('Could not send', String(e?.message || e || 'Please try again later.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenWrapper bannerTitle="Items Needed" style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.subtitle}>Request items from parents to support their child's needs.</Text>

          <Text style={styles.sectionLabel}>Child</Text>
          <View style={styles.childRow}>
            {relevantChildren.map((child) => {
              const active = child?.id === selectedChild?.id;
              return (
                <TouchableOpacity
                  key={child.id}
                  onPress={() => setSelectedChildId(child.id)}
                  style={[styles.childChip, active ? styles.childChipActive : null]}
                  accessibilityLabel={`Select ${child.name || 'child'}`}
                >
                  <Text style={[styles.childChipText, active ? styles.childChipTextActive : null]}>{child.name || 'Child'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>Presets</Text>
          <View style={styles.itemsGrid}>
            {PRESET_ITEMS.map((item) => {
              const active = selectedItems.includes(item);
              return (
                <TouchableOpacity
                  key={item}
                  onPress={() => toggleItem(item)}
                  style={[styles.itemChip, active ? styles.itemChipActive : null]}
                  accessibilityLabel={`Toggle ${item}`}
                >
                  <Text style={[styles.itemChipText, active ? styles.itemChipTextActive : null]}>{item}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {selectedItems.includes('Other') ? (
            <View style={{ marginTop: 14 }}>
              <Text style={styles.sectionLabel}>Other item</Text>
              <TextInput
                value={otherText}
                onChangeText={setOtherText}
                placeholder="Enter the needed item"
                style={styles.input}
              />
            </View>
          ) : null}

          <TouchableOpacity onPress={submit} style={[styles.primaryBtn, saving ? styles.primaryBtnDisabled : null]} disabled={saving}>
            <Text style={styles.primaryBtnText}>{saving ? 'Sending...' : 'Send request'}</Text>
          </TouchableOpacity>

          {recentRequests.length ? (
            <View style={styles.historySection}>
              <Text style={styles.sectionLabel}>Recent requests</Text>
              {recentRequests.map((item) => (
                <View key={item.id} style={styles.historyItem}>
                  <Text style={styles.historyTitle}>{item.item || 'Requested item'}</Text>
                  <Text style={styles.historyMeta}>{item.category || 'General'} • {item.status || 'requested'}</Text>
                  <Text style={styles.historyMeta}>Requested by {item.requestedByName || 'Staff'}{item.dueDate ? ` • Due ${item.dueDate}` : ''}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6f8' },
  content: { padding: 16, paddingBottom: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  subtitle: { marginTop: 6, color: '#64748b', lineHeight: 20 },
  sectionLabel: { marginTop: 16, marginBottom: 8, fontSize: 12, fontWeight: '800', color: '#475569', textTransform: 'uppercase' },
  childRow: { flexDirection: 'row', flexWrap: 'wrap' },
  childChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    marginRight: 8,
    marginBottom: 8,
  },
  childChipActive: { backgroundColor: '#dbeafe', borderColor: '#2563eb' },
  childChipText: { color: '#0f172a', fontWeight: '600' },
  childChipTextActive: { color: '#1d4ed8' },
  itemsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  itemChip: {
    width: '48%',
    marginRight: '2%',
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  itemChipActive: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  itemChipText: { color: '#0f172a', fontWeight: '700', textAlign: 'center' },
  itemChipTextActive: { color: '#fff' },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  historySection: { marginTop: 18 },
  historyItem: { marginTop: 10, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, backgroundColor: '#f8fafc', padding: 12 },
  historyTitle: { color: '#0f172a', fontWeight: '800' },
  historyMeta: { marginTop: 4, color: '#64748b' },
});