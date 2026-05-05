import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Platform, Linking, StatusBar, KeyboardAvoidingView, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as Api from '../src/Api';
import { formatSupportDetails, reportErrorToSentry } from '../src/utils/reportError';
import LogoTitle from '../src/components/LogoTitle';
const { SUPPORT_EMAIL } = require('../src/config/brand');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export default function ForgotPasswordScreen({ onDone, onCancel }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const supportEmail = useMemo(() => {
    return SUPPORT_EMAIL;
  }, []);

  async function submitRequest() {
    const e = normalizeEmail(email);
    if (!e) {
      Alert.alert('Missing email', 'Please enter your email address.');
      return;
    }

    setBusy(true);
    try {
      await Api.requestPasswordReset(e);
      // Always show a generic message to avoid account enumeration.
      Alert.alert('Check your email', 'If an account exists for that email, a reset link has been sent.', [
        { text: 'OK', onPress: () => { try { onDone && onDone(); } catch (_) {} } },
      ]);
    } catch (err) {
      const code = String(err?.code || '');
      const eventId = reportErrorToSentry(err, {
        area: 'auth',
        action: 'password-reset',
        errorCode: code,
      });
      Alert.alert('Reset failed', `${err?.message || String(err)}${formatSupportDetails({ code, eventId })}`);
    } finally {
      setBusy(false);
    }
  }

  function openSupportEmail() {
    const url = `mailto:${encodeURIComponent(supportEmail)}?subject=${encodeURIComponent('CommunityBridge Password Reset')}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Contact support', `Please email ${supportEmail} for help resetting your password.`);
    });
  }

  function handleCancel() {
    try { onCancel && onCancel(); } catch (_) {}
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="dark-content" translucent={false} backgroundColor="#ffffff" />
      <KeyboardAvoidingView
        style={styles.keyboardShell}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            Platform.OS === 'web' ? styles.scrollContentWeb : styles.scrollContentMobile,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.headerShell}>
            <View style={styles.headerRow}>
              <LogoTitle width={396} height={126} />
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Forgot Password?</Text>
            </View>

            <Text style={styles.subTitle}>
              Enter your email, if an account exists for that email, you will receive a reset link. Office-managed accounts can also be updated from the admin permissions workspace.
            </Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              style={styles.input}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!busy}
            />

            <TouchableOpacity
              onPress={submitRequest}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.primaryBtn, busy ? { opacity: 0.7 } : null]}
            >
              <Text style={styles.primaryBtnText}>{busy ? 'Sending…' : 'Send reset link'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleCancel}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.cancelBtn, busy ? { opacity: 0.7 } : null]}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <View style={styles.supportSection}>
              <TouchableOpacity onPress={openSupportEmail} accessibilityRole="button" style={styles.supportBtn}>
                <MaterialIcons name="email" size={18} color="#2563eb" />
                <Text style={styles.supportBtnText}>Contact support</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  keyboardShell: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 20, alignItems: 'center' },
  scrollContentWeb: { justifyContent: 'center' },
  scrollContentMobile: { justifyContent: 'center', paddingTop: 32, paddingBottom: 32 },
  headerShell: { width: '100%', maxWidth: 420, paddingHorizontal: 18, paddingVertical: 12 },
  card: { width: '100%', maxWidth: 420, marginTop: 18, padding: 18, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  titleRow: { marginTop: 8 },
  title: { fontSize: 20, fontWeight: '800', color: '#111827' },
  subTitle: { marginTop: 8, fontSize: 13, color: '#6b7280', lineHeight: 20 },
  label: { marginTop: 14, fontSize: 13, fontWeight: '700', color: '#111827' },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: '#111827',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '800' },
  cancelBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  cancelBtnText: { color: '#111827', fontWeight: '700' },
  supportSection: { marginTop: 14 },
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  supportBtnText: { marginLeft: 8, color: '#2563eb', fontWeight: '800' },
  hintText: { marginTop: 8, fontSize: 12, color: '#6b7280' },
});
