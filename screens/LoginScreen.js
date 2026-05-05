import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, ActivityIndicator, TouchableOpacity, Modal, Platform, Image, KeyboardAvoidingView, ScrollView, TouchableWithoutFeedback, Keyboard, useWindowDimensions } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { MaterialIcons } from '@expo/vector-icons';
import SignUpScreen from './SignUpScreen';
import ForgotPasswordScreen from './ForgotPasswordScreen';
import { useAuth } from '../src/AuthContext';
import { logger } from '../src/utils/logger';
import { reportErrorToSentry, formatSupportDetails } from '../src/utils/reportError';
import { getAuthInitError, getFirebaseAppInitError } from '../src/firebase';
import { isInviteAccessCode } from '../src/utils/passwordPolicy';
import { storeApprovalAccessIntent } from '../src/utils/approvalAccessIntent';
const faceIdIconImage = require('../assets/icons/faceID.png');
const loginLogoImage = require('../assets/titlelogo.png');

function AuthButtonImage({ source, style, imageStyle }) {
  return <Image source={source} style={[styles.authButtonImage, style, imageStyle]} resizeMode="contain" />;
}

function LoginToast({ toast, onClose, hostStyle }) {
  if (!toast?.visible) return null;

  const tone = toast.tone || 'error';
  const config = tone === 'success'
    ? { card: styles.toastSuccess, icon: 'check-circle-outline', iconColor: '#166534' }
    : tone === 'info'
      ? { card: styles.toastInfo, icon: 'info-outline', iconColor: '#1d4ed8' }
      : { card: styles.toastError, icon: 'error-outline', iconColor: '#b91c1c' };

  return (
    <View pointerEvents="box-none" style={[styles.toastHost, hostStyle]}>
      <View style={[styles.toastCard, config.card]}>
        <MaterialIcons name={config.icon} size={20} color={config.iconColor} style={styles.toastIcon} />
        <View style={styles.toastCopy}>
          {toast.title ? <Text style={styles.toastTitle}>{toast.title}</Text> : null}
          {toast.message ? <Text style={styles.toastMessage}>{toast.message}</Text> : null}
        </View>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss login message" style={styles.toastDismiss}>
          <MaterialIcons name="close" size={18} color="#475569" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const isMobilePlatform = Platform.OS !== 'web';

export default function LoginScreen({ navigation, suppressAutoRedirect = false }) {
  const { height: windowHeight } = useWindowDimensions();
  const toastTopOffset = Platform.OS === 'web'
    ? 48
    : Math.max(72, Math.round(windowHeight * 0.14));
  const passwordInputRef = useRef(null);
  const isExplicitWebLoginRoute = useMemo(() => {
    if (Platform.OS !== 'web') return false;
    try {
      return String(globalThis?.location?.pathname || '').trim().toLowerCase() === '/login';
    } catch (_) {
      return false;
    }
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Use biometrics');
  const [hasBiometricAuthStored, setHasBiometricAuthStored] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [toast, setToast] = useState({ visible: false, title: '', message: '', tone: 'error' });
  const auth = useAuth();
  const toastTimerRef = useRef(null);
  const approvalLinkStartedRef = useRef(false);

  const fieldWidthStyle = useMemo(() => ({ width: '100%', maxWidth: 360 }), []);

  function dismissToast() {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast((current) => ({ ...current, visible: false }));
  }

  function showToast(payload) {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }

    const next = typeof payload === 'string' ? { message: payload } : (payload || {});
    setToast({
      visible: true,
      title: String(next.title || '').trim(),
      message: String(next.message || '').trim(),
      tone: next.tone || 'error',
    });

    toastTimerRef.current = setTimeout(() => {
      setToast((current) => ({ ...current, visible: false }));
      toastTimerRef.current = null;
    }, next.durationMs || 4200);
  }

  async function finishLoginNavigation(options = {}) {
    try {
      const gate = await auth.refreshMfaState();
      const requiresPasswordSetup = Boolean(options?.passwordSetupRequired || auth?.passwordSetupRequired);
      navigation.replace(requiresPasswordSetup ? 'CreatePassword' : (gate?.needsMfa ? 'TwoFactor' : 'Main'));
    } catch (e) {
      logger.warn('auth', 'Post-login navigation failed', { code: e?.code, message: e?.message || String(e) });
      reportErrorToSentry(e, { area: 'auth', action: 'post_login_navigation', platform: Platform.OS });
      showToast({
        title: 'Signed in, but setup failed',
        message: e?.message || 'Please close and reopen the app, then try again.',
      });
    }
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (approvalLinkStartedRef.current) return;
    if (auth.loading || auth.token) return;

    let token = '';
    try {
      token = String(new URLSearchParams(globalThis?.location?.search || '').get('token') || '').trim();
    } catch (_) {
      token = '';
    }
    if (!token) return;

    approvalLinkStartedRef.current = true;
    setBusy(true);

    (async () => {
      try {
        const res = await auth.loginWithApprovalToken(token);
        if (res?.redirectIntent) {
          // Persist the post-password destination so CreatePassword can route
          // directly into Admin -> Staff Management after the limited session ends.
          storeApprovalAccessIntent(res.redirectIntent);
        }
        try {
          const url = new URL(globalThis?.location?.href || '');
          url.searchParams.delete('token');
          globalThis?.history?.replaceState?.({}, '', `${url.pathname}${url.search}${url.hash}`);
        } catch (_) {
          // ignore URL cleanup failures
        }
        await finishLoginNavigation({ passwordSetupRequired: Boolean(res?.user?.passwordSetupRequired) });
      } catch (error) {
        showToast({
          title: 'Approval link failed',
          message: String(error?.message || error || 'Please use the newest email or sign in with your one-time access code.'),
        });
      } finally {
        setBusy(false);
      }
    })();
  }, [auth, navigation]);

  async function doLogin(){
    const cleanedEmail = String(email || '').trim();
    const cleanedPassword = String(password || '');
    if (!cleanedEmail) {
      showToast({ title: 'Missing email', message: 'Please enter your email.', tone: 'info' });
      return;
    }
    if (!cleanedPassword) {
      showToast({ title: 'Missing password', message: 'Please enter your password.', tone: 'info' });
      return;
    }

    setBusy(true);
    try{
      logger.debug('auth', 'Login submit', { hasEmail: !!cleanedEmail });
      let res;
      try {
        res = await auth.login(cleanedEmail, cleanedPassword);
      } catch (loginError) {
        const code = String(loginError?.code || '');
        const message = String(loginError?.message || '');
        const canTryInviteCode = isInviteAccessCode(cleanedPassword)
          && (code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials' || /invalid email or password|invalid credential/i.test(message));
        if (!canTryInviteCode) throw loginError;
        res = await auth.loginWithInviteCode(cleanedEmail, cleanedPassword);
      }
      const requiresPasswordSetup = Boolean(res?.user?.passwordSetupRequired);
      try {
        await SecureStore.setItemAsync('bb_bio_enabled', '1');
        await SecureStore.setItemAsync('bb_bio_user', JSON.stringify(res?.user || auth?.user || {}));
        setHasBiometricAuthStored(true);
      } catch (_) {}
      await finishLoginNavigation({ passwordSetupRequired: requiresPasswordSetup });
    } catch (e) {
      const code = e?.code ? String(e.code) : '';
      const msg = e?.message || String(e) || 'Please check your credentials and try again.';
      const fbAppErr = getFirebaseAppInitError();
      const fbAuthErr = getAuthInitError();

      logger.warn('auth', 'Login failed', { code, message: msg });

      const eventId = reportErrorToSentry(e, {
        area: 'auth',
        action: 'login',
        errorCode: code,
        firebaseAppInitError: fbAppErr ? String(fbAppErr?.message || fbAppErr) : '',
        firebaseAuthInitError: fbAuthErr ? String(fbAuthErr?.message || fbAuthErr) : '',
      });

      showToast({ title: 'Login failed', message: `${msg}${formatSupportDetails({ code, eventId })}` });
    } finally {
      setBusy(false);
    }
  }

  async function doBiometricUnlock() {
    setBiometricBusy(true);
    try {
      const storedEnabled = await SecureStore.getItemAsync('bb_bio_enabled');
      const storedUser = await SecureStore.getItemAsync('bb_bio_user');
      if (!storedEnabled || !storedUser) {
        showToast({ title: 'Biometric sign-in', message: 'No saved sign-in found. Please sign in with email and password first.', tone: 'info' });
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock CommunityBridge',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      if (result?.success) {
        if (!auth?.token) {
          showToast({ title: 'Biometric unlock', message: 'Please sign in with email and password.' });
          return;
        }
        await finishLoginNavigation();
        return;
      }

      // user_cancel / system_cancel are expected; don't throw noisy alerts
      const err = result?.error ? String(result.error) : '';
      if (err && err !== 'user_cancel' && err !== 'system_cancel' && err !== 'app_cancel') {
        showToast({ title: 'Biometric unlock failed', message: 'Please sign in with email and password.' });
      }
    } catch (e) {
      showToast({ title: 'Biometric unlock failed', message: e?.message || 'Please sign in with email and password.' });
    } finally {
      setBiometricBusy(false);
    }
  }

  // If already authenticated (e.g. dev auto-login), redirect to Home
  // This effect must be declared before any early returns to preserve
  // the order of Hooks between renders.
  useEffect(() => {
    if (suppressAutoRedirect || isExplicitWebLoginRoute) return;
    if (auth.loading) return;
    if (!auth.token) return;
    navigation.replace(auth.passwordSetupRequired ? 'CreatePassword' : (auth.needsMfa ? 'TwoFactor' : 'Main'));
  }, [auth.loading, auth.token, auth.needsMfa, auth.passwordSetupRequired, isExplicitWebLoginRoute, suppressAutoRedirect]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (auth.loading) return;

      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();

        let label = 'Use biometrics';
        try {
          const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
          if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) label = 'Use Face ID';
          else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) label = 'Use Touch ID';
        } catch (e) {
          // ignore; default label
        }

        if (mounted) {
          setBiometricAvailable(Boolean(hasHardware && enrolled));
          setBiometricLabel(label);
        }
      } catch (e) {
        if (mounted) setBiometricAvailable(false);
      }
    })();

    return () => { mounted = false; };
  }, [auth.loading]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const storedEnabled = await SecureStore.getItemAsync('bb_bio_enabled');
        const storedUser = await SecureStore.getItemAsync('bb_bio_user');
        if (mounted) setHasBiometricAuthStored(!!storedEnabled && !!storedUser);
      } catch (e) {
        if (mounted) setHasBiometricAuthStored(false);
      }
    })();
    return () => { mounted = false; };
  }, [auth.loading, showSignUp]);

  // Keep the mobile sign-in stack closer to screen center while preserving web spacing.
  const brandSectionMinHeight = Platform.OS === 'web'
    ? Math.max(240, Math.round(windowHeight * 0.34))
    : Math.max(176, Math.round(windowHeight * 0.2));
  const OuterWrapper = Platform.OS === 'web' ? View : TouchableWithoutFeedback;
  const outerWrapperProps = Platform.OS === 'web' ? {} : { onPress: Keyboard.dismiss, accessible: false };

  if (auth.loading) return (
    <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator size="large" />
    </View>
  );

  return (
    <View style={styles.screen}>
      <LoginToast toast={toast} onClose={dismissToast} hostStyle={{ top: toastTopOffset }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <OuterWrapper {...outerWrapperProps}>
          <ScrollView
            contentContainerStyle={[
              styles.scrollContainer,
              Platform.OS === 'web' ? styles.scrollContainerWeb : styles.scrollContainerMobile,
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View style={[styles.brandSection, { minHeight: brandSectionMinHeight }]}>
              <Image
                source={loginLogoImage}
                accessibilityLabel="CommunityBridge"
                style={[styles.loginLogo, { height: Math.min(320, Math.round(brandSectionMinHeight * 0.95)) }]}
              />
            </View>
            <View style={styles.formCard}>
              <View style={fieldWidthStyle}>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  style={styles.input}
                  placeholder="Email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus?.()}
                  blurOnSubmit={false}
                />
              </View>

              <View style={[fieldWidthStyle, styles.passwordFieldWrap]}>
                <TextInput
                  ref={passwordInputRef}
                  value={password}
                  onChangeText={setPassword}
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Password"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={doLogin}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  style={styles.peekIconBtn}
                  disabled={busy}
                >
                  <MaterialIcons
                    name={showPassword ? 'visibility-off' : 'visibility'}
                    size={20}
                    color="#2563eb"
                  />
                </TouchableOpacity>
              </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              onPress={doLogin}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              style={[styles.primaryPushBtn, busy ? { opacity: 0.7 } : null]}
              disabled={busy}
              activeOpacity={0.9}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryPushBtnText}>Sign In</Text>
              )}
            </TouchableOpacity>

            {biometricAvailable ? (
              <TouchableOpacity
                onPress={doBiometricUnlock}
                accessibilityRole="button"
                accessibilityLabel={biometricLabel}
                style={[styles.iconPushBtn, isMobilePlatform ? styles.mobileIconPushBtn : null, (biometricBusy || busy) ? { opacity: 0.7 } : null]}
                disabled={biometricBusy || busy}
              >
                {String(biometricLabel).toLowerCase().includes('face') ? (
                  <AuthButtonImage source={faceIdIconImage} imageStyle={styles.mobileAuthIconImage} />
                ) : (
                  <MaterialIcons name="fingerprint" size={22} color="#2563eb" />
                )}
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.linksRow}>
            <TouchableOpacity
              onPress={() => setShowSignUp(true)}
              accessibilityRole="button"
              disabled={busy}
            >
              <Text style={styles.linkText}>First-Time Here?</Text>
            </TouchableOpacity>

            <Text style={styles.linkSeparator} accessibilityElementsHidden accessibilityIgnoresInvertColors>
              /
            </Text>

            <TouchableOpacity
              onPress={() => {
                setShowForgotPassword(true);
              }}
              accessibilityRole="button"
              disabled={busy}
            >
              <Text style={styles.linkText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <Modal visible={showSignUp} animationType="slide" onRequestClose={() => setShowSignUp(false)}>
            <SignUpScreen
              onDone={(result) => {
                setShowSignUp(false);
                if (result && result.authed) {
                  if (result.needsMfa) {
                    navigation.replace('TwoFactor', {
                      email: result.email || '',
                      origin: result.fromSignup ? 'signup' : 'login',
                    });
                    return;
                  }

                  auth.refreshMfaState()
                    .then((gate) => navigation.replace(gate?.needsMfa ? 'TwoFactor' : 'Main'))
                    .catch(() => navigation.replace('Main'));
                }
              }}
              onCancel={() => setShowSignUp(false)}
            />
          </Modal>

          <Modal visible={showForgotPassword} animationType="slide" onRequestClose={() => setShowForgotPassword(false)}>
            <ForgotPasswordScreen
              onDone={() => setShowForgotPassword(false)}
              onCancel={() => setShowForgotPassword(false)}
            />
          </Modal>

          {/* Google sign-in at the bottom of the form */}
          <View style={styles.secondaryActions}>
          </View>
              </View>
            </ScrollView>
          </OuterWrapper>
        </KeyboardAvoidingView>
      </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  toastHost: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 1000,
    alignItems: 'center',
  },
  toastCard: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  toastError: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  toastInfo: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  toastSuccess: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  toastIcon: { marginTop: 1, marginRight: 10 },
  toastCopy: { flex: 1 },
  toastTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  toastMessage: { marginTop: 2, fontSize: 13, lineHeight: 18, color: '#334155' },
  toastDismiss: { marginLeft: 10, padding: 2 },
  scrollContainer: { flexGrow: 1, padding: 20, alignItems: 'center' },
  scrollContainerWeb: { justifyContent: 'flex-start' },
  scrollContainerMobile: { justifyContent: 'center', paddingTop: 32, paddingBottom: 32 },
  brandSection: { width: '100%', maxWidth: 420, alignItems: 'center', justifyContent: 'center' },
  loginLogo: { width: '100%', maxWidth: 640, resizeMode: 'contain' },
  formCard: { width: '100%', maxWidth: 420, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 20 },
  input: { borderWidth: 1, borderColor: '#ccc', paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12, borderRadius: 10, backgroundColor: '#fff' },
  registerWrap: { marginTop: 12, alignItems: 'center' },
  registerText: { color: '#2563eb', fontWeight: '600' },
  passwordFieldWrap: { position: 'relative' },
  passwordInput: { paddingRight: 42 },
  peekIconBtn: { position: 'absolute', right: 10, top: '50%', marginTop: -25, width: 28, height: 40, alignItems: 'center', justifyContent: 'center' },
  showPasswordRow: { width: '100%', maxWidth: 360, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', alignSelf: 'center', marginTop: -2 },
  blankRow: { height: 12 },
  actionsRow: { width: '100%', maxWidth: 420, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  primaryPushBtn: { backgroundColor: '#2563eb', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, minWidth: 176, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  primaryPushBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  iconPushBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  mobileIconPushBtn: { borderWidth: 0, borderColor: 'transparent', backgroundColor: 'transparent' },
  linksRow: { marginTop: 12, width: '100%', maxWidth: 360, flexDirection: 'row', justifyContent: 'center', alignSelf: 'center', alignItems: 'center' },
  linkText: { color: '#2563eb', fontWeight: '700' },
  linkSeparator: { marginHorizontal: 10, color: '#6b7280', fontWeight: '700' },
  secondaryActions: { marginTop: 10, alignItems: 'center' },
  authButtonImage: { width: '100%', height: '100%' },
  authIconImage: { width: 24, height: 24 },
  mobileAuthIconImage: { width: 42, height: 42 },
});
