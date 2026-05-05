import React from 'react';
import { View, Text, ScrollView, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { MaterialIcons } from '@expo/vector-icons';
// header provided by ScreenWrapper
const { SUPPORT_EMAIL, SUPPORT_URL, ACCOUNT_DELETE_URL } = require('../config/brand');

export default function HelpScreen() {
  return (
    <ScreenWrapper hideBanner style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <Text style={styles.sectionTitle}>Arrival Detection</Text>
        <Text style={styles.paragraph}>
          Arrival Detection helps the center know when you're approaching for pickup. It uses your device's location to
          detect when you're nearby. This feature requires you to grant location permissions in your device settings.
        </Text>

        <Text style={styles.sectionTitle}>Push Notifications</Text>
        <Text style={styles.paragraph}>
          Use the Push Notifications settings to control which notifications you receive for chats, comments,
          and reminders. If notifications are disabled in your device, enable them from Settings → Apps → CommunityBridge → Notifications.
        </Text>

        <Text style={styles.sectionTitle}>Chats</Text>
        <Text style={styles.paragraph}>
          The Chats area contains private messages between you and staff or other parents. Use the Messages screen to
          view threads and reply. If you don't see a new message, try pulling down to refresh the list.
        </Text>

        <Text style={styles.sectionTitle}>My Child</Text>
        <Text style={styles.paragraph}>
          The My Child screen shows your child's profile, assigned ABA Techs, care plan, and notes. Tap the avatar to
          view more details or to load demo data.
        </Text>

        <Text style={styles.sectionTitle}>Account & Support</Text>
        <Text style={styles.paragraph}>
          To sign out, open Profile Settings and use the Logout action there. For account issues or to request help, tap the button below to email support or open the support page. Account deletion is also available from Profile Settings and the web delete-account page.
        </Text>

        <TouchableOpacity style={styles.contact} onPress={() => Linking.openURL(`mailto:${encodeURIComponent(SUPPORT_EMAIL)}?subject=${encodeURIComponent('CommunityBridge Support')}`) }>
          <MaterialIcons name="email" size={20} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.contactText}>Email Support</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.contact, styles.secondaryAction]} onPress={() => Linking.openURL(SUPPORT_URL)}>
          <MaterialIcons name="open-in-new" size={20} color="#1d4ed8" style={{ marginRight: 8 }} />
          <Text style={styles.secondaryActionText}>Open Support Page</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.contact, styles.secondaryAction]} onPress={() => Linking.openURL(ACCOUNT_DELETE_URL)}>
          <MaterialIcons name="delete-outline" size={20} color="#1d4ed8" style={{ marginRight: 8 }} />
          <Text style={styles.secondaryActionText}>Open Delete Account Page</Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 18, paddingTop: 12 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  sectionTitle: { marginTop: 12, fontSize: 16, fontWeight: '700' },
  paragraph: { marginTop: 6, color: '#374151', lineHeight: 20 },
  contact: { marginTop: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: '#2563eb', padding: 10, borderRadius: 8, alignSelf: 'flex-start' },
  contactText: { color: '#fff', fontWeight: '700' },
  secondaryAction: { backgroundColor: '#eff6ff' },
  secondaryActionText: { color: '#1d4ed8', fontWeight: '700' }
});
