import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Image, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenWrapper } from '../components/ScreenWrapper';
import AddressAutocompleteField from '../components/AddressAutocompleteField';
import { useAuth } from '../AuthContext';
import * as Api from '../Api';
import * as ImagePicker from 'expo-image-picker';
import { avatarSourceFor } from '../utils/idVisibility';
import { formatAddressInput } from '../utils/addressInput';
import { formatPhoneInput } from '../utils/inputFormat';

const IMAGE_PICKER_MEDIA_TYPES = ImagePicker.MediaTypeOptions?.Images ?? ImagePicker.MediaType?.Images;

function passwordPolicy(pw) {
  const v = String(pw || '');
  const hasMinLen = v.length >= 8;
  const hasUpper = /[A-Z]/.test(v);
  const hasSpecial = /[^A-Za-z0-9]/.test(v);
  const score = [hasMinLen, hasUpper, hasSpecial].filter(Boolean).length;
  return { hasMinLen, hasUpper, hasSpecial, score };
}

export default function EditProfileScreen({ navigation }) {
  const { user, setAuth } = useAuth();

  const initial = useMemo(() => {
    return {
      name: String(user?.name || ''),
      email: String(user?.email || ''),
      avatar: String(user?.avatar || ''),
      phone: formatPhoneInput(user?.phone),
      address: String(user?.address || ''),
    };
  }, [user]);

  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [avatar, setAvatar] = useState(initial.avatar);
  const [phone, setPhone] = useState(initial.phone);
  const [address, setAddress] = useState(initial.address);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  async function onChangeAvatar() {
    if (saving || uploadingAvatar) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm || perm.status !== 'granted') {
        Alert.alert('Photos permission', 'Please allow photo library access to change your avatar.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: IMAGE_PICKER_MEDIA_TYPES,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (!result || result.canceled) return;
      const asset = Array.isArray(result.assets) ? result.assets[0] : null;
      const uri = asset?.uri ? String(asset.uri) : '';
      if (!uri) {
        Alert.alert('Avatar', 'Could not read the selected image.');
        return;
      }

      const nameFromPicker = asset?.fileName ? String(asset.fileName) : `avatar_${Date.now()}.jpg`;
      const mimeType = asset?.mimeType ? String(asset.mimeType) : 'image/jpeg';

      const formData = new FormData();
      formData.append('file', { uri, name: nameFromPicker, type: mimeType });

      setUploadingAvatar(true);
      const uploadRes = await Api.uploadMedia(formData);
      const url = uploadRes?.url ? String(uploadRes.url) : '';
      if (!url) throw new Error('Upload failed');
      setAvatar(url);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Could not upload avatar.';
      Alert.alert('Avatar upload failed', msg);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function onSave() {
    if (saving || uploadingAvatar) return;

    const nextName = String(name || '').trim();
    const nextEmail = String(email || '').trim();
    const nextAvatar = String(avatar || '').trim();
    const nextPhone = String(phone || '').trim();
    const nextAddress = String(address || '').trim();

    if (!nextName) return Alert.alert('Missing name', 'Display name is required.');
    if (!nextEmail) return Alert.alert('Missing email', 'Email is required.');

    const wantsPasswordChange = String(password || '').length > 0 || String(passwordConfirm || '').length > 0;
    if (wantsPasswordChange) {
      const pol = passwordPolicy(password);
      if (!pol.hasMinLen) return Alert.alert('Password', 'Password must be at least 8 characters.');
      if (!pol.hasUpper) return Alert.alert('Password', 'Password must include at least 1 capital letter.');
      if (!pol.hasSpecial) return Alert.alert('Password', 'Password must include at least 1 special character.');
      if (password !== passwordConfirm) return Alert.alert('Password', 'Passwords do not match.');
    }

    const payload = {};
    if (nextName !== String(user?.name || '')) payload.name = nextName;
    if (nextEmail.toLowerCase() !== String(user?.email || '').toLowerCase()) payload.email = nextEmail;
    if (nextAvatar !== String(user?.avatar || '')) payload.avatar = nextAvatar;
    if (nextPhone !== String(user?.phone || '')) payload.phone = nextPhone;
    if (nextAddress !== String(user?.address || '')) payload.address = nextAddress;
    if (wantsPasswordChange) payload.password = password;

    if (!Object.keys(payload).length) {
      navigation.goBack();
      return;
    }

    try {
      setSaving(true);
      const res = await Api.updateMe(payload);
      if (!res || !res.token || !res.user) throw new Error('Invalid update response');
      await setAuth({ token: res.token, user: res.user });
      Alert.alert('Saved', 'Your profile was updated.');
      navigation.goBack();
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Could not update profile.';
      Alert.alert('Update failed', msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenWrapper bannerShowBack={false} style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Edit Profile</Text>

          <Text style={styles.label}>Profile photo</Text>
          <View style={styles.avatarRow}>
            <Image
              source={avatarSourceFor({ avatar: avatar || user?.avatar || user?.photoURL })}
              style={styles.avatar}
            />
            <TouchableOpacity
              style={[styles.avatarBtn, (saving || uploadingAvatar) ? { opacity: 0.7 } : null]}
              onPress={onChangeAvatar}
              disabled={saving || uploadingAvatar}
            >
              {uploadingAvatar ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <ActivityIndicator size="small" color="#2563eb" />
                  <Text style={[styles.avatarBtnText, { marginLeft: 8 }]}>Uploading…</Text>
                </View>
              ) : (
                <Text style={styles.avatarBtnText}>Change photo</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Display name</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Your name" />

          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            placeholder="name@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>Phone</Text>
          <TextInput
            value={phone}
            onChangeText={(v) => setPhone(formatPhoneInput(v))}
            style={styles.input}
            placeholder="555-123-4567"
            autoCapitalize="none"
            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'phone-pad'}
          />

          <Text style={styles.label}>Address</Text>
          <AddressAutocompleteField value={address} onChangeText={(v) => setAddress(formatAddressInput(v))} placeholder="Address" maxLength={300} />

          <View style={{ height: 12 }} />

          <Text style={styles.subTitle}>Change password</Text>
          <Text style={styles.hint}>Leave blank to keep your current password.</Text>

          <Text style={styles.label}>New password</Text>
          <TextInput value={password} onChangeText={setPassword} style={styles.input} secureTextEntry placeholder="••••••" />

          {String(password || '').length > 0 ? (() => {
            const pol = passwordPolicy(password);
            const barColor = pol.score <= 1 ? '#ef4444' : pol.score === 2 ? '#F59E0B' : '#10B981';
            const barWidth = pol.score === 0 ? '10%' : pol.score === 1 ? '35%' : pol.score === 2 ? '70%' : '100%';
            return (
              <View style={{ marginTop: 8 }}>
                <View style={styles.pwBarTrack}>
                  <View style={[styles.pwBarFill, { width: barWidth, backgroundColor: barColor }]} />
                </View>

                <View style={{ marginTop: 10 }}>
                  <View style={styles.pwRuleRow}>
                    <MaterialIcons name={pol.hasMinLen ? 'check-circle' : 'cancel'} size={18} color={pol.hasMinLen ? '#10B981' : '#ef4444'} />
                    <Text style={styles.pwRuleText}>8+ characters</Text>
                  </View>
                  <View style={styles.pwRuleRow}>
                    <MaterialIcons name={pol.hasUpper ? 'check-circle' : 'cancel'} size={18} color={pol.hasUpper ? '#10B981' : '#ef4444'} />
                    <Text style={styles.pwRuleText}>1 capital letter</Text>
                  </View>
                  <View style={styles.pwRuleRow}>
                    <MaterialIcons name={pol.hasSpecial ? 'check-circle' : 'cancel'} size={18} color={pol.hasSpecial ? '#10B981' : '#ef4444'} />
                    <Text style={styles.pwRuleText}>1 special character</Text>
                  </View>
                </View>
              </View>
            );
          })() : null}

          <Text style={styles.label}>Confirm new password</Text>
          <TextInput value={passwordConfirm} onChangeText={setPasswordConfirm} style={styles.input} secureTextEntry placeholder="••••••" />

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()} disabled={saving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, saving ? { opacity: 0.7 } : null]} onPress={onSave} disabled={saving}>
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  body: { padding: 16 },
  title: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 12 },
  subTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginTop: 10 },
  hint: { marginTop: 6, color: '#6b7280' },
  label: { marginTop: 12, marginBottom: 6, fontSize: 12, fontWeight: '800', color: '#111827' },
  input: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#fff' },
  avatarRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#eee', marginRight: 12 },
  avatarBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  avatarBtnText: { color: '#2563eb', fontWeight: '800' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 12, marginRight: 8 },
  cancelText: { color: '#2563eb', fontWeight: '800' },
  saveBtn: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  saveText: { color: '#fff', fontWeight: '800' },
  pwBarTrack: { width: '100%', height: 8, borderRadius: 4, backgroundColor: '#e5e7eb', overflow: 'hidden' },
  pwBarFill: { height: 8, borderRadius: 4 },
  pwRuleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  pwRuleText: { marginLeft: 8, color: '#374151', fontWeight: '700' },
});
