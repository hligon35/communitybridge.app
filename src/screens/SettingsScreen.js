import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Image, Alert, ScrollView, Platform, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import * as Updates from 'expo-updates';
import { useAuth } from '../AuthContext';
import { BASE_URL } from '../config';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenWrapper } from '../components/ScreenWrapper';
import ImageToggle from '../components/ImageToggle';
import TenantSwitcher from '../components/TenantSwitcher';
import { avatarSourceFor } from '../utils/idVisibility';
import { registerForExpoPushTokenAsync } from '../utils/pushNotifications';
import * as Api from '../Api';
import { SETTINGS_KEYS, readBooleanSetting, writeBooleanSetting } from '../utils/appSettings';
import { formatPhoneInput } from '../utils/inputFormat';
import { isAdminRole, normalizeUserRole, USER_ROLES } from '../core/tenant/models';
import useIsTabletLayout from '../hooks/useIsTabletLayout';

const editIconImage = require('../../assets/icons/edit.png');
const deleteAccountIcon = require('../../assets/icons/deleteAccount.png');

const ARRIVAL_KEY = SETTINGS_KEYS.arrivalEnabled;
const PUSH_KEY = 'settings_push_enabled_v1';
const PUSH_CHATS_KEY = 'settings_push_chats_v1';
const PUSH_TIMELINE_POSTS_KEY = 'settings_push_timeline_posts_v1';
const PUSH_MENTIONS_POSTS_KEY = 'settings_push_mentions_posts_v1';
const PUSH_TAGS_POSTS_KEY = 'settings_push_tags_posts_v1';
const PUSH_UPDATES_KEY = 'settings_push_updates_v1';
const SHOW_EMAIL_KEY = SETTINGS_KEYS.showEmail;
const SHOW_PHONE_KEY = SETTINGS_KEYS.showPhone;

function passwordPolicy(pw) {
  const value = String(pw || '');
  const hasMinLen = value.length >= 8;
  const hasUpper = /[A-Z]/.test(value);
  const hasSpecial = /[^A-Za-z0-9]/.test(value);
  const score = [hasMinLen, hasUpper, hasSpecial].filter(Boolean).length;
  return { hasMinLen, hasUpper, hasSpecial, score };
}

export default function SettingsScreen({ navigation }) {
  const { user, logout, setRole, setAuth, refreshMfaState } = useAuth();
  const isWeb = Platform.OS === 'web';
  const isTabletLayout = useIsTabletLayout();
  const isParentSettings = normalizeUserRole(user?.role) === USER_ROLES.PARENT;
  const isParentMobileSettings = !isWeb && !isTabletLayout && normalizeUserRole(user?.role) === USER_ROLES.PARENT;

  React.useLayoutEffect(() => {
    if (!isParentMobileSettings) {
      navigation.setOptions({
        headerLeft: undefined,
      });
      return;
    }

    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => logout?.()}
          accessibilityRole="button"
          accessibilityLabel="Logout"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{
            marginLeft: 8,
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fef2f2',
          }}
        >
          <MaterialIcons name="logout" size={20} color="#b91c1c" />
        </TouchableOpacity>
      ),
    });
  }, [isParentMobileSettings, logout, navigation]);

  const openEditProfile = React.useCallback(() => {
    if (isParentSettings) {
      openParentEditModal();
      return;
    }

    const parentNavigation = navigation?.getParent?.();
    const state = navigation?.getState?.();
    const routeNames = Array.isArray(state?.routeNames) ? state.routeNames : [];

    if (routeNames.includes('EditProfile')) {
      navigation.navigate('EditProfile');
      return;
    }

    if (parentNavigation?.navigate) {
      parentNavigation.navigate('Settings', { screen: 'EditProfile' });
      return;
    }

    navigation.navigate('Settings', { screen: 'EditProfile' });
  }, [isParentSettings, navigation, openParentEditModal]);

  function isValidEmail(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  }

  async function saveParentContactDetails() {
    const nextEmail = String(parentEditEmail || '').trim().toLowerCase();
    const nextPhone = formatPhoneInput(parentEditPhone);
    const currentEmail = String(user?.email || '').trim().toLowerCase();
    const currentPhone = formatPhoneInput(user?.phone);
    const nextPassword = String(parentEditPassword || '');
    const nextPasswordConfirm = String(parentEditPasswordConfirm || '');
    const wantsPasswordChange = nextPassword.length > 0 || nextPasswordConfirm.length > 0;

    if (!nextEmail || !isValidEmail(nextEmail)) {
      Alert.alert('Invalid email', 'Enter a valid email address.');
      return;
    }

    if (!nextPhone) {
      Alert.alert('Phone required', 'Enter a phone number.');
      return;
    }

    if (wantsPasswordChange) {
      const policy = passwordPolicy(nextPassword);
      if (!policy.hasMinLen) {
        Alert.alert('Password', 'Password must be at least 8 characters.');
        return;
      }
      if (!policy.hasUpper) {
        Alert.alert('Password', 'Password must include at least 1 capital letter.');
        return;
      }
      if (!policy.hasSpecial) {
        Alert.alert('Password', 'Password must include at least 1 special character.');
        return;
      }
      if (nextPassword !== nextPasswordConfirm) {
        Alert.alert('Password', 'Passwords do not match.');
        return;
      }
    }

    const payload = {};
    if (nextEmail !== currentEmail) payload.email = nextEmail;
    if (nextPhone !== currentPhone) payload.phone = nextPhone;
    if (wantsPasswordChange) payload.password = nextPassword;

    if (!Object.keys(payload).length) {
      setParentEditModalOpen(false);
      return;
    }

    let method = 'email';
    let phone = '';
    let reason = 'password';
    if (payload.phone) {
      method = 'sms';
      phone = nextPhone;
      reason = 'phone';
    } else if (payload.email) {
      reason = 'email';
    }

    beginParentSensitiveAction({ payload, method, phone, reason }).catch(() => {});
  }

  const [arrivalEnabled, setArrivalEnabled] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushChats, setPushChats] = useState(true);
  const [pushTimelinePosts, setPushTimelinePosts] = useState(true);
  const [pushMentionsPosts, setPushMentionsPosts] = useState(true);
  const [pushTagsPosts, setPushTagsPosts] = useState(true);
  const [pushUpdates, setPushUpdates] = useState(true);
  const [showEmail, setShowEmail] = useState(true);
  const [showPhone, setShowPhone] = useState(true);
  const [parentEditModalOpen, setParentEditModalOpen] = useState(false);
  const [parentEditEmail, setParentEditEmail] = useState(String(user?.email || ''));
  const [parentEditPhone, setParentEditPhone] = useState(formatPhoneInput(user?.phone));
  const [parentEditPassword, setParentEditPassword] = useState('');
  const [parentEditPasswordConfirm, setParentEditPasswordConfirm] = useState('');
  const [parentEditSaving, setParentEditSaving] = useState(false);
  const [parentSensitiveAction, setParentSensitiveAction] = useState('');
  const [parentPendingSensitivePayload, setParentPendingSensitivePayload] = useState(null);
  const [parentTwoFactorMethod, setParentTwoFactorMethod] = useState('email');
  const [parentTwoFactorPhone, setParentTwoFactorPhone] = useState('');
  const [parentTwoFactorReason, setParentTwoFactorReason] = useState('');
  const [parentTwoFactorModalOpen, setParentTwoFactorModalOpen] = useState(false);
  const [parentTwoFactorCode, setParentTwoFactorCode] = useState('');
  const [parentTwoFactorSending, setParentTwoFactorSending] = useState(false);
  const [parentTwoFactorBusy, setParentTwoFactorBusy] = useState(false);
  const [parentTwoFactorStatus, setParentTwoFactorStatus] = useState('');
  const [parentTwoFactorError, setParentTwoFactorError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);

  // Debounced push preference sync to backend (efficient + consistent).
  const pushSyncTimerRef = useRef(null);
  const pushSyncLastPayloadRef = useRef('');

  // header buttons are provided globally by the navigator

  // not using safe-area insets here to avoid shifting content down

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const a = await readBooleanSetting(ARRIVAL_KEY, false);
        const p = await AsyncStorage.getItem(PUSH_KEY);
        const pc = await AsyncStorage.getItem(PUSH_CHATS_KEY);
        const pt = await AsyncStorage.getItem(PUSH_TIMELINE_POSTS_KEY);
        const pmp = await AsyncStorage.getItem(PUSH_MENTIONS_POSTS_KEY);
        const ptg = await AsyncStorage.getItem(PUSH_TAGS_POSTS_KEY);
        const pu = await AsyncStorage.getItem(PUSH_UPDATES_KEY);
        if (!mounted) return;
        setArrivalEnabled(!!a);
        if (p !== null) setPushEnabled(p === '1');
        if (pc !== null) setPushChats(pc === '1');
        if (pt !== null) setPushTimelinePosts(pt === '1');
        if (pmp !== null) setPushMentionsPosts(pmp === '1');
        if (ptg !== null) setPushTagsPosts(ptg === '1');
        if (pu !== null) setPushUpdates(pu === '1');
        const se = await AsyncStorage.getItem(SHOW_EMAIL_KEY);
        const sp = await AsyncStorage.getItem(SHOW_PHONE_KEY);
        if (se !== null) setShowEmail(se === '1');
        if (sp !== null) setShowPhone(sp === '1');
      } catch (e) {
        // ignore
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    writeBooleanSetting(ARRIVAL_KEY, arrivalEnabled).catch(() => {});
  }, [arrivalEnabled]);

  useEffect(() => {
    AsyncStorage.setItem(PUSH_KEY, pushEnabled ? '1' : '0').catch(() => {});
  }, [pushEnabled]);

  useEffect(() => {
    AsyncStorage.setItem(PUSH_CHATS_KEY, pushChats ? '1' : '0').catch(() => {});
  }, [pushChats]);
  useEffect(() => {
    AsyncStorage.setItem(PUSH_TIMELINE_POSTS_KEY, pushTimelinePosts ? '1' : '0').catch(() => {});
  }, [pushTimelinePosts]);
  useEffect(() => {
    AsyncStorage.setItem(PUSH_MENTIONS_POSTS_KEY, pushMentionsPosts ? '1' : '0').catch(() => {});
  }, [pushMentionsPosts]);
  useEffect(() => {
    AsyncStorage.setItem(PUSH_TAGS_POSTS_KEY, pushTagsPosts ? '1' : '0').catch(() => {});
  }, [pushTagsPosts]);
  useEffect(() => {
    AsyncStorage.setItem(PUSH_UPDATES_KEY, pushUpdates ? '1' : '0').catch(() => {});
  }, [pushUpdates]);

  function buildPushPreferences() {
    return {
      chats: !!pushChats,
      timelinePosts: !!pushTimelinePosts,
      mentionsPosts: !!pushMentionsPosts,
      tagsPosts: !!pushTagsPosts,
      updates: !!pushUpdates,
    };
  }

  useEffect(() => {
    if (!pushEnabled) return;

    // Debounce backend sync so rapid toggles don't spam requests.
    if (pushSyncTimerRef.current) {
      clearTimeout(pushSyncTimerRef.current);
      pushSyncTimerRef.current = null;
    }

    pushSyncTimerRef.current = setTimeout(async () => {
      try {
        const token = await AsyncStorage.getItem('push_expo_token_v1');
        if (!token) return;

        const payload = {
          token,
          platform: Platform.OS,
          userId: user?.id,
          enabled: true,
          preferences: buildPushPreferences(),
        };
        const payloadKey = JSON.stringify(payload);
        if (payloadKey === pushSyncLastPayloadRef.current) return;

        await Api.registerPushToken(payload);
        pushSyncLastPayloadRef.current = payloadKey;
      } catch (e) {
        console.warn('push preferences sync failed', e?.message || e);
      }
    }, 450);

    return () => {
      if (pushSyncTimerRef.current) {
        clearTimeout(pushSyncTimerRef.current);
        pushSyncTimerRef.current = null;
      }
    };
  }, [
    pushEnabled,
    pushChats,
    pushTimelinePosts,
    pushMentionsPosts,
    pushTagsPosts,
    pushUpdates,
    user?.id,
  ]);

  useEffect(() => {
    writeBooleanSetting(SHOW_EMAIL_KEY, showEmail).catch(() => {});
  }, [showEmail]);

  useEffect(() => {
    writeBooleanSetting(SHOW_PHONE_KEY, showPhone).catch(() => {});
  }, [showPhone]);

  const openParentEditModal = React.useCallback(() => {
    setParentEditEmail(String(user?.email || ''));
    setParentEditPhone(formatPhoneInput(user?.phone));
    setParentEditPassword('');
    setParentEditPasswordConfirm('');
    setParentEditModalOpen(true);
  }, [user?.email, user?.phone]);

  const closeParentTwoFactorModal = React.useCallback(() => {
    setParentTwoFactorModalOpen(false);
    setParentSensitiveAction('');
    setParentPendingSensitivePayload(null);
    setParentTwoFactorMethod('email');
    setParentTwoFactorPhone('');
    setParentTwoFactorReason('');
    setParentTwoFactorCode('');
    setParentTwoFactorStatus('');
    setParentTwoFactorError('');
  }, []);

  const applyParentProfileUpdate = React.useCallback(async (payload) => {
    try {
      setParentEditSaving(true);
      const result = await Api.updateMe(payload || {});
      const nextUser = {
        ...(user || {}),
        ...(payload || {}),
        ...(result?.user || {}),
      };
      await setAuth({ token: result?.token, user: nextUser });
      setParentEditModalOpen(false);
      setParentEditPassword('');
      setParentEditPasswordConfirm('');
      Alert.alert('Profile updated', 'Your account details were updated.');
    } catch (error) {
      Alert.alert('Update failed', String(error?.message || error || 'Could not update your profile.'));
    } finally {
      setParentEditSaving(false);
    }
  }, [setAuth, user]);

  const requestParentTwoFactorCode = React.useCallback(async ({ manual = true, method, phone } = {}) => {
    if (!isParentSettings) return;
    const nextMethod = String(method || parentTwoFactorMethod || 'email').toLowerCase() === 'sms' ? 'sms' : 'email';
    const nextPhone = String(phone || parentTwoFactorPhone || '');
    setParentTwoFactorError('');
    if (!manual) setParentTwoFactorStatus('Sending verification code...');
    setParentTwoFactorSending(true);
    try {
      const result = await Api.resend2fa({ method: nextMethod, ...(nextMethod === 'sms' && nextPhone ? { phone: nextPhone } : {}) });
      const destination = String(result?.challenge?.to || user?.email || '').trim();
      setParentTwoFactorStatus(destination ? `Code sent to ${destination}.` : 'Verification code sent.');
    } catch (error) {
      const message = String(error?.message || error || 'Could not send a verification code.');
      setParentTwoFactorError(message);
      if (manual) Alert.alert('Could not send code', message);
    } finally {
      setParentTwoFactorSending(false);
    }
  }, [isParentSettings, parentTwoFactorMethod, parentTwoFactorPhone, user?.email]);

  const beginParentSensitiveAction = React.useCallback(async ({ payload, method, phone, reason } = {}) => {
    if (!isParentSettings) return;
    setParentSensitiveAction('profile-update');
    setParentPendingSensitivePayload(payload || null);
    setParentTwoFactorMethod(String(method || 'email').toLowerCase() === 'sms' ? 'sms' : 'email');
    setParentTwoFactorPhone(String(phone || ''));
    setParentTwoFactorReason(String(reason || ''));
    setParentTwoFactorCode('');
    setParentTwoFactorError('');
    setParentTwoFactorStatus('');
    setParentTwoFactorModalOpen(true);
    await requestParentTwoFactorCode({ manual: false, method, phone });
  }, [isParentSettings, requestParentTwoFactorCode]);

  const verifyParentSensitiveAction = React.useCallback(async () => {
    const code = String(parentTwoFactorCode || '').trim();
    if (!code) {
      Alert.alert('Missing code', 'Enter the verification code.');
      return;
    }

    try {
      setParentTwoFactorBusy(true);
      setParentTwoFactorError('');
      await Api.verify2fa({ code });
      await refreshMfaState?.();
      const payload = parentPendingSensitivePayload;
      closeParentTwoFactorModal();
      await applyParentProfileUpdate(payload);
    } catch (error) {
      const message = String(error?.message || error || 'Verification failed.');
      setParentTwoFactorError(message);
      Alert.alert('Verification failed', message);
    } finally {
      setParentTwoFactorBusy(false);
    }
  }, [applyParentProfileUpdate, closeParentTwoFactorModal, parentPendingSensitivePayload, parentTwoFactorCode, refreshMfaState]);

  const toggleArrival = () => {
    const next = !arrivalEnabled;
    if (next) {
      Alert.alert(
        'Enable Arrival Detection',
        'Arrival detection requires location permission. Please grant location access in your device settings for full functionality.',
        [{ text: 'OK', onPress: () => setArrivalEnabled(true) }]
      );
      return;
    }
    setArrivalEnabled(false);
  };

  const togglePush = async () => {
    const next = !pushEnabled;
    if (next) {
      try {
        const result = await registerForExpoPushTokenAsync();
        if (!result.ok) {
          const msg = result.reason === 'permission-denied'
            ? 'Notification permission was not granted. Enable notifications in iOS Settings for CommunityBridge, then try again.'
            : (result.reason === 'not-device'
              ? 'Push notifications require a physical device (not a simulator).'
              : (result.message || 'Could not enable push notifications.'));
          Alert.alert('Push Notifications', msg);
          return;
        }

        const token = result.token;
        await AsyncStorage.setItem('push_expo_token_v1', token).catch(() => {});

        // Send token + preferences to backend (if supported).
        const payload = {
          token,
          platform: Platform.OS,
          userId: user?.id,
          enabled: true,
          preferences: buildPushPreferences(),
        };
        await Api.registerPushToken(payload);
        pushSyncLastPayloadRef.current = JSON.stringify(payload);

        setPushEnabled(true);
      } catch (e) {
        Alert.alert('Push Notifications', e?.message || 'Could not enable push notifications.');
      }
      return;
    }

    // Disable
    setPushEnabled(false);
    pushSyncLastPayloadRef.current = '';
    if (pushSyncTimerRef.current) {
      clearTimeout(pushSyncTimerRef.current);
      pushSyncTimerRef.current = null;
    }
    try {
      const token = await AsyncStorage.getItem('push_expo_token_v1');
      if (token) {
        await Api.unregisterPushToken({ token, platform: Platform.OS, userId: user?.id });
      }
    } catch (e) {
      Alert.alert('Push Notifications', e?.message || 'Push notifications were turned off locally, but the server could not be updated yet.');
    }
  };

  async function confirmAndDeleteAccount() {
    if (!user?.id) {
      Alert.alert('Not signed in', 'Please sign in first.');
      return;
    }

    Alert.alert(
      'Delete account',
      'This will permanently delete your account and sign you out. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Final confirmation',
              'Are you sure you want to delete your CommunityBridge account?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete my account',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      setDeleteBusy(true);
                      await Api.deleteMyAccount({ confirm: true });
                      Alert.alert('Account deleted', 'Your account has been deleted.');
                      await logout();
                    } catch (e) {
                      const msg = e?.message || 'Account deletion failed.';
                      Alert.alert('Delete failed', msg);
                    } finally {
                      setDeleteBusy(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }

  async function checkForOtaUpdate() {
    if (Platform.OS === 'web') {
      Alert.alert('Not supported', 'EAS Update is not supported on web.');
      return;
    }
    if (!Updates.isEnabled) {
      Alert.alert(
        'Updates disabled',
        'This build does not have expo-updates enabled, or you are running a dev session. Install an EAS-built binary to receive OTA updates.'
      );
      return;
    }

    try {
      setUpdateBusy(true);
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        Alert.alert('Up to date', 'No update is available for this channel/runtime version.');
        return;
      }

      await Updates.fetchUpdateAsync();
      Alert.alert(
        'Update downloaded',
        'Restart the app to apply it now.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Restart now', onPress: () => Updates.reloadAsync().catch(() => {}) },
        ]
      );
    } catch (error) {
      Alert.alert('Update check failed', error?.message || String(error));
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <ScreenWrapper bannerShowBack={false} style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1, width: '100%' }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 28, paddingHorizontal: 16 }} bounces={true} alwaysBounceVertical={true} showsVerticalScrollIndicator={false}>
        {isWeb ? (
          <View style={{ width: '100%', maxWidth: 980, marginTop: 8, marginBottom: 12, backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#e5e7eb', padding: 18, shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: '#0f172a' }}>Profile Settings</Text>
            </View>
            <Text style={{ marginTop: 6, color: '#64748b' }}>Manage privacy, notifications, arrival detection, and update status from one desktop-friendly view.</Text>
            <View style={{ flexDirection: 'row', marginTop: 16 }}>
              {[
                { label: 'Arrival', value: arrivalEnabled ? 'On' : 'Off' },
                { label: 'Push', value: pushEnabled ? 'On' : 'Off' },
                { label: 'Email visible', value: showEmail ? 'Yes' : 'No' },
                { label: 'Phone visible', value: showPhone ? 'Yes' : 'No' },
              ].map((item, index) => (
                <View key={item.label} style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', marginRight: index === 3 ? 0 : 12 }}>
                  <Text style={{ color: '#64748b', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{item.label}</Text>
                  <Text style={{ marginTop: 8, fontSize: 22, fontWeight: '800', color: '#0f172a' }}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <View style={{ width: '100%', maxWidth: isWeb ? 980 : 720, borderRadius: 14, backgroundColor: '#fff', padding: 20, elevation: 3, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, marginTop: 8 }}>
        <TouchableOpacity
          onPress={openEditProfile}
          accessibilityLabel="Edit Profile"
          style={{
            position: 'absolute',
            right: 12,
            top: 12,
            width: isWeb ? 40 : 32,
            height: isWeb ? 40 : 32,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: isWeb ? 10 : 0,
            borderWidth: isWeb ? 1 : 0,
            borderColor: '#e6eef8',
            backgroundColor: isWeb ? '#f1f5f9' : 'transparent',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: isWeb ? 0.08 : 0,
            shadowRadius: isWeb ? 2 : 0,
            elevation: isWeb ? 2 : 0,
          }}
        >
          <Image source={editIconImage} style={{ width: 20, height: 20, resizeMode: 'contain' }} />
        </TouchableOpacity>

        {!isWeb && !isParentMobileSettings ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, paddingRight: 56 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: '#0f172a' }}>Profile Settings</Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image
            source={avatarSourceFor(user)}
            style={{ width: 84, height: 84, borderRadius: 42, marginRight: 16 }}
          />
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>{user?.name || 'Guest User'}</Text>
            <Text style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>{user?.email || 'Not signed in'}</Text>
            <Text style={{ fontSize: 14, color: '#374151', marginTop: 8 }}>{user?.phone || 'Phone: —'}</Text>
            <Text style={{ fontSize: 14, color: '#374151', marginTop: 4 }}>{user?.address || 'Address: —'}</Text>
          </View>
        </View>

        {/* Arrival Detection Section */}
        <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: '#eef2f7', paddingTop: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 8 }}>Arrival Detection</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: '600' }}>Use location for arrival detection</Text>
              <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Automatically detect within close range to help with smoother pick-ups.</Text>
            </View>
            <ImageToggle value={arrivalEnabled} onValueChange={toggleArrival} accessibilityLabel="Arrival detection" />
          </View>
        </View>

        {/* Profile Privacy */}
        <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: '#eef2f7', paddingTop: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 8 }}>Profile Privacy</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={{ fontSize: 14 }}>Show Email in profile</Text>
              <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Allow others to see your email in the user info modal.</Text>
            </View>
            <ImageToggle value={showEmail} onValueChange={setShowEmail} accessibilityLabel="Show email in profile" />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={{ fontSize: 14 }}>Show Phone in profile</Text>
              <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Allow others to see your phone number in the user info modal.</Text>
            </View>
            <ImageToggle value={showPhone} onValueChange={setShowPhone} accessibilityLabel="Show phone in profile" />
          </View>
        </View>

        {/* Push Notifications - moved to be immediately under Arrival Detection (subsections alphabetical) */}
        <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: '#eef2f7', paddingTop: 16 }}>
          {/* Master Push Toggle */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '700' }}>Push Notifications</Text>
              <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Enable or disable chat alerts, urgent memos, schedule changes, cancellations, and arrival alerts.</Text>
            </View>
            <ImageToggle value={pushEnabled} onValueChange={togglePush} accessibilityLabel="Push notifications" />
          </View>

          {!isParentSettings ? (
            <View style={{ marginTop: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f3f4f6' }}>
              <Text style={{ fontSize: 14, fontWeight: '700', marginBottom: 6 }}>Chats</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontSize: 14 }}>Receive chat messages</Text>
                  <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Get notified when someone sends you a chat message.</Text>
                </View>
                <ImageToggle value={pushChats} onValueChange={setPushChats} disabled={!pushEnabled} accessibilityLabel="Receive chat messages" />
              </View>
            </View>
          ) : null}

          {/* Updates & Reminders */}
          <View style={{ marginTop: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f3f4f6' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', marginBottom: 6 }}>Updates & Reminders</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ fontSize: 14 }}>Updates & reminders</Text>
                <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Urgent memos, schedule changes or cancellations, arrival detection alerts, and other low-priority notices.</Text>
              </View>
              <ImageToggle value={pushUpdates} onValueChange={setPushUpdates} disabled={!pushEnabled} accessibilityLabel="Updates and reminders" />
            </View>
          </View>
        </View>
        </View>

        {/* Organization */}
        <View style={{ width: '100%', maxWidth: isWeb ? 980 : 720, marginTop: 12 }}>
          <TenantSwitcher />
        </View>

        {isParentSettings ? (
          <View style={{ width: '100%', maxWidth: isWeb ? 980 : 720, marginTop: 12, borderTopWidth: 1, borderTopColor: '#eef2f7', paddingTop: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 8 }}>App Updates</Text>
            <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Check whether a newer app update is available for this build.</Text>
            <TouchableOpacity
              onPress={checkForOtaUpdate}
              disabled={updateBusy}
              style={{ alignSelf: 'flex-start', borderRadius: 12, backgroundColor: '#e2e8f0', paddingVertical: 10, paddingHorizontal: 14, opacity: updateBusy ? 0.7 : 1 }}
            >
              <Text style={{ color: '#0f172a', fontWeight: '700' }}>{updateBusy ? 'Checking for updates...' : 'Check for updates'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Account */}
        <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: '#eef2f7', paddingTop: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 8, alignSelf: 'center' }}>Account</Text>
          <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
            Permanently delete your account.
          </Text>
          <TouchableOpacity
            onPress={confirmAndDeleteAccount}
            disabled={deleteBusy}
            style={{ alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingVertical: 4 }}
            activeOpacity={0.7}
          >
            <Image source={deleteAccountIcon} style={{ width: 48, height: 48, resizeMode: 'contain', marginBottom: 6, opacity: deleteBusy ? 0.5 : 1 }} />
            <Text style={{ color: '#b91c1c', fontWeight: '700', textAlign: 'center' }}>{deleteBusy ? 'Deleting…' : 'Delete Account'}</Text>
          </TouchableOpacity>
        </View>
        {/* Dev role switcher moved to DevRoleSwitcher (floating) */}
      </ScrollView>

      <Modal transparent visible={parentEditModalOpen} animationType="fade" onRequestClose={() => !parentEditSaving && setParentEditModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.42)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxWidth: 420 }}>
            <View style={{ width: '100%', borderRadius: 22, backgroundColor: '#ffffff', padding: 18 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#111827' }}>Edit Contact Info</Text>
              <Text style={{ marginTop: 6, color: '#64748b', lineHeight: 20 }}>Update your email address or phone number. These changes are saved to your profile and sign-in record.</Text>

              <Text style={{ marginTop: 14, marginBottom: 6, fontSize: 12, fontWeight: '800', color: '#111827' }}>Email</Text>
              <TextInput
                value={parentEditEmail}
                onChangeText={setParentEditEmail}
                placeholder="name@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!parentEditSaving}
                style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#fff' }}
              />

              <Text style={{ marginTop: 12, marginBottom: 6, fontSize: 12, fontWeight: '800', color: '#111827' }}>Phone</Text>
              <TextInput
                value={parentEditPhone}
                onChangeText={(value) => setParentEditPhone(formatPhoneInput(value))}
                placeholder="555-123-4567"
                autoCapitalize="none"
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'phone-pad'}
                editable={!parentEditSaving}
                style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#fff' }}
              />

              <Text style={{ marginTop: 16, fontSize: 16, fontWeight: '800', color: '#111827' }}>Change password</Text>
              <Text style={{ marginTop: 6, color: '#64748b', lineHeight: 20 }}>Leave blank to keep your current password.</Text>

              <Text style={{ marginTop: 12, marginBottom: 6, fontSize: 12, fontWeight: '800', color: '#111827' }}>New password</Text>
              <TextInput
                value={parentEditPassword}
                onChangeText={setParentEditPassword}
                placeholder="••••••"
                autoCapitalize="none"
                secureTextEntry
                editable={!parentEditSaving}
                style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#fff' }}
              />

              {String(parentEditPassword || '').length > 0 ? (() => {
                const policy = passwordPolicy(parentEditPassword);
                const barColor = policy.score <= 1 ? '#ef4444' : policy.score === 2 ? '#F59E0B' : '#10B981';
                const barWidth = policy.score === 0 ? '10%' : policy.score === 1 ? '35%' : policy.score === 2 ? '70%' : '100%';
                return (
                  <View style={{ marginTop: 8 }}>
                    <View style={{ width: '100%', height: 8, borderRadius: 4, backgroundColor: '#e5e7eb', overflow: 'hidden' }}>
                      <View style={{ height: 8, borderRadius: 4, width: barWidth, backgroundColor: barColor }} />
                    </View>

                    <View style={{ marginTop: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                        <MaterialIcons name={policy.hasMinLen ? 'check-circle' : 'cancel'} size={18} color={policy.hasMinLen ? '#10B981' : '#ef4444'} />
                        <Text style={{ marginLeft: 8, color: '#374151', fontWeight: '700' }}>8+ characters</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                        <MaterialIcons name={policy.hasUpper ? 'check-circle' : 'cancel'} size={18} color={policy.hasUpper ? '#10B981' : '#ef4444'} />
                        <Text style={{ marginLeft: 8, color: '#374151', fontWeight: '700' }}>1 capital letter</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                        <MaterialIcons name={policy.hasSpecial ? 'check-circle' : 'cancel'} size={18} color={policy.hasSpecial ? '#10B981' : '#ef4444'} />
                        <Text style={{ marginLeft: 8, color: '#374151', fontWeight: '700' }}>1 special character</Text>
                      </View>
                    </View>

                    <Text style={{ marginTop: 12, marginBottom: 6, fontSize: 12, fontWeight: '800', color: '#111827' }}>Confirm new password</Text>
                    <TextInput
                      value={parentEditPasswordConfirm}
                      onChangeText={setParentEditPasswordConfirm}
                      placeholder="••••••"
                      autoCapitalize="none"
                      secureTextEntry
                      editable={!parentEditSaving}
                      style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#fff' }}
                    />
                  </View>
                );
              })() : null}

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 18 }}>
                {parentEditSaving ? <ActivityIndicator size="small" color="#2563eb" style={{ marginRight: 12 }} /> : null}
                <TouchableOpacity onPress={() => setParentEditModalOpen(false)} disabled={parentEditSaving} style={{ paddingVertical: 10, paddingHorizontal: 12, marginRight: 8 }}>
                  <Text style={{ color: '#475569', fontWeight: '700' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveParentContactDetails} disabled={parentEditSaving} style={{ borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 10, paddingHorizontal: 14, opacity: parentEditSaving ? 0.7 : 1 }}>
                  <Text style={{ color: '#ffffff', fontWeight: '800' }}>{parentEditSaving ? 'Saving…' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal transparent visible={parentTwoFactorModalOpen} animationType="fade" onRequestClose={() => !parentTwoFactorBusy && !parentTwoFactorSending && closeParentTwoFactorModal()}>
        <View style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.42)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxWidth: 420 }}>
            <View style={{ width: '100%', borderRadius: 22, backgroundColor: '#ffffff', padding: 18 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#111827' }}>Two-step verification</Text>
              <Text style={{ marginTop: 6, color: '#64748b', lineHeight: 20 }}>
                {parentTwoFactorReason === 'phone'
                  ? 'Enter the verification code sent by text to continue updating your phone number.'
                  : parentTwoFactorReason === 'email'
                    ? 'Enter the verification code sent by email to continue updating your email address.'
                    : 'Enter the verification code sent by email to continue updating your password.'}
              </Text>

              {parentTwoFactorStatus ? <Text style={{ marginTop: 10, color: '#0f766e', lineHeight: 20 }}>{parentTwoFactorStatus}</Text> : null}
              {parentTwoFactorError ? <Text style={{ marginTop: 10, color: '#b91c1c', lineHeight: 20 }}>{parentTwoFactorError}</Text> : null}

              <Text style={{ marginTop: 14, marginBottom: 6, fontSize: 12, fontWeight: '800', color: '#111827' }}>Verification code</Text>
              <TextInput
                value={parentTwoFactorCode}
                onChangeText={setParentTwoFactorCode}
                placeholder="123456"
                keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'numeric'}
                autoCapitalize="none"
                editable={!parentTwoFactorBusy}
                style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#fff' }}
              />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
                <TouchableOpacity onPress={() => requestParentTwoFactorCode({ manual: true }).catch(() => {})} disabled={parentTwoFactorSending || parentTwoFactorBusy} style={{ paddingVertical: 10, paddingHorizontal: 12 }}>
                  <Text style={{ color: '#2563eb', fontWeight: '700' }}>{parentTwoFactorSending ? 'Sending…' : 'Resend code'}</Text>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {parentTwoFactorBusy ? <ActivityIndicator size="small" color="#2563eb" style={{ marginRight: 12 }} /> : null}
                  <TouchableOpacity onPress={closeParentTwoFactorModal} disabled={parentTwoFactorBusy || parentTwoFactorSending} style={{ paddingVertical: 10, paddingHorizontal: 12, marginRight: 8 }}>
                    <Text style={{ color: '#475569', fontWeight: '700' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={verifyParentSensitiveAction} disabled={parentTwoFactorBusy || parentTwoFactorSending} style={{ borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 10, paddingHorizontal: 14, opacity: parentTwoFactorBusy || parentTwoFactorSending ? 0.7 : 1 }}>
                    <Text style={{ color: '#ffffff', fontWeight: '800' }}>{parentTwoFactorBusy ? 'Verifying…' : 'Verify'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </ScreenWrapper>
  );
}
