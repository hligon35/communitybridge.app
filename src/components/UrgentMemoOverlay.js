import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Button, ScrollView, TouchableOpacity, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import * as Api from '../Api';

export default function UrgentMemoOverlay() {
  const { user, needsMfa, refreshMfaState } = useAuth();
  const data = useData();
  const urgentMemos = Array.isArray(data?.urgentMemos) ? data.urgentMemos : [];
  const [memos, setMemos] = useState([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user || needsMfa) return;
      try {
        let list = urgentMemos;
        // Show user-facing urgent memos and announcements immediately after login.
        list = list.filter((m) => {
          const t = (m && m.type) ? String(m.type).toLowerCase() : 'urgent_memo';
          return t === 'urgent_memo' || t === 'admin_memo' || (!m.type && (m.title || m.body));
        });
        list = list.sort((left, right) => new Date(right?.createdAt || right?.date || 0).getTime() - new Date(left?.createdAt || left?.date || 0).getTime());
        setMemos(list);
        const seenKey = `urgentSeen_${user.id}`;
        const seenRaw = await AsyncStorage.getItem(seenKey);
        let seen = [];
        if (seenRaw) {
          try {
            const parsed = JSON.parse(seenRaw);
            if (Array.isArray(parsed)) seen = parsed;
            else console.warn('UrgentMemoOverlay: seen key parsed but not array', parsed);
          } catch (e) {
            console.warn('UrgentMemoOverlay: failed to parse seenKey', e.message);
            seen = [];
          }
        }
        if (!Array.isArray(seen)) seen = [];
        // Defensive: ensure IDs exist before includes check
        const unseen = list.filter((m) => { try { return !seen.includes(m?.id); } catch (e) { return true; } });
        if (unseen.length) setVisible(true);
      } catch (e) {
        console.warn('urgent memos overlay failed', e.message);
        try {
          const msg = String(e?.message || e || '').toLowerCase();
          if (msg.includes('missing or insufficient permissions') && typeof refreshMfaState === 'function') {
            await refreshMfaState();
          }
        } catch (_) {
          // ignore
        }
      }
    })();
    return () => {};
  }, [user, needsMfa, urgentMemos]);

  async function handleContinue() {
    try {
      const ids = memos.map((m) => m.id);
      await Api.ackUrgentMemo(ids);
      if (user) {
        const seenKey = `urgentSeen_${user.id}`;
        await AsyncStorage.setItem(seenKey, JSON.stringify(ids));
      }
    } catch (e) {
      console.warn('ack failed', e.message);
    } finally {
      setVisible(false);
    }
  }

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center' }}>
          <TouchableWithoutFeedback onPress={() => setVisible(false)}>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          </TouchableWithoutFeedback>
          <View style={{ margin: 20, backgroundColor: 'white', borderRadius: 8, padding: 16, maxHeight: '80%' }}>
            <Text style={{ fontSize: 18, fontWeight: '600' }}>Urgent Memos</Text>
            <ScrollView style={{ marginTop: 12 }}>
              {memos.map((m) => (
                <View key={m.id} style={{ marginBottom: 12 }}>
                  <Text style={{ fontWeight: '700' }}>{m.subject || m.title}</Text>
                  <Text>{m.body || m.note}</Text>
                  <Text style={{ fontSize: 12, color: '#666' }}>{m.date || m.createdAt}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={{ marginTop: 12 }}>
              <Button title="Continue" onPress={handleContinue} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Dev floating button removed per request */}
    </>
  );
}

const styles = StyleSheet.create({
  // debug button removed
});
