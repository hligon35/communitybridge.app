import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Api from './Api';
import { getAuthInstance, getAuthInitError } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { navigationRef, resetToLogin, resetToTwoFactor } from './navigationRef';
import { logger, setDebugContext } from './utils/logger';
import { reportErrorToSentry } from './utils/reportError';
import { normalizeRoleOverride, isDevSwitcherUser, isSpecialAccessUser, isReservedSuperAdminEmail, applyReservedUserOverrides, getMfaFreshnessWindowMs } from './utils/authState';
import { configureNotificationHandling, syncLoggedInDevicePushRegistration, unregisterLoggedInDevicePushRegistration } from './utils/pushNotifications';
import { getDemoRoleIdentity } from './utils/demoIdentity';

function getRootWorkspaceForRole(role) {
  const normalized = normalizeRoleOverride(role);
  return normalized === 'admin' || normalized === 'bcba' || normalized === 'office' ? 'Controls' : 'Home';
}

function navigateToRoleWorkspace(role) {
  try {
    if (!navigationRef?.isReady?.()) return;
    navigationRef.navigate('Main', { screen: getRootWorkspaceForRole(role) });
  } catch (_) {
    // ignore navigation sync errors during role changes
  }
}

const AuthContext = createContext(null);
const MFA_VERIFIED_CACHE_KEY = 'bb_mfa_verified_at_cache_v1';
const DEV_ROLE_OVERRIDE_KEY = 'bb_dev_role_override_v1';
const DEV_ROLE_BEHAVIOR_KEY = 'bb_dev_role_behavior_v1';

function normalizeDevRoleBehavior(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'parent' || normalized === 'admin' || normalized === 'office') return normalized;
  return 'remember';
}

function resolveDevRoleOverride(overrideRole, behavior) {
  const normalizedBehavior = normalizeDevRoleBehavior(behavior);
  if (normalizedBehavior === 'parent' || normalizedBehavior === 'admin' || normalizedBehavior === 'office') return normalizedBehavior;
  return normalizeRoleOverride(overrideRole);
}

function readWebDevSessionBootstrap() {
  if (!__DEV__) return null;
  try {
    const href = String(globalThis?.location?.href || '');
    if (!href) return null;
    const url = new URL(href);
    if (url.searchParams.get('devSession') !== '1') return null;
    const requestedRole = normalizeRoleOverride(url.searchParams.get('role')) || 'admin';
    const identityByRole = {
      parent: { id: 'par-001', name: 'Alicia Cook' },
      therapist: { id: 'aba-101', name: 'Jordan Ellis' },
      bcba: { id: 'bcba-001', name: 'Dr. Marissa Bennett' },
      office: { id: 'office-001', name: 'CommunityBridge Office' },
      admin: { id: 'user-admin-001', name: 'Jordan Admin' },
    };
    const identity = identityByRole[requestedRole] || identityByRole.admin;
    return {
      token: 'dev-web-screenshot-session',
      user: {
        id: identity.id,
        name: identity.name,
        email: 'appreview@communitybridge.app',
        role: requestedRole,
      },
      role: requestedRole,
    };
  } catch (_) {
    return null;
  }
}

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const webDevSessionBootstrap = useMemo(() => readWebDevSessionBootstrap(), []);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [devRoleOverride, setDevRoleOverride] = useState('');
  const [devRoleBehavior, setDevRoleBehavior] = useState('remember');

  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaVerified, setMfaVerified] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);

  const mfaRequiredRef = useRef(false);
  // Mutex: coalesce concurrent refreshMfaState() calls so callers share a single token-refresh + profile-read pass.
  const inFlightRefreshRef = useRef(null);
  useEffect(() => {
    configureNotificationHandling();
  }, []);

  useEffect(() => {
    mfaRequiredRef.current = Boolean(mfaRequired);
  }, [mfaRequired]);

  function markMfaRequired() {
    if (mfaRequiredRef.current) {
      try { console.info('[auth] markMfaRequired: already gated, skipping'); } catch (_) {}
      return;
    }
    try { console.info('[auth] markMfaRequired: gating UI and resetting to TwoFactor'); } catch (_) {}
    // Firestore rules for key collections (posts, urgentMemos, etc.) only deny reads
    // with "Missing or insufficient permissions" when orgSettings/main.mfaEnabled == true
    // and the user isn't verified. Treat that as a reliable signal to gate the UI.
    setMfaRequired(true);
    setMfaVerified(false);
    resetToTwoFactor();
  }

  function isMfaFresh(profile) {
    try {
      // Firestore security rules require mfaVerifiedAt to be a Timestamp.
      // If older data stored it as a string, treat it as not verified.
      if (profile && profile.mfaVerifiedAtIsTimestamp === false) return false;
      const iso = profile?.mfaVerifiedAt;
      if (!iso) return false;
      const ts = Date.parse(String(iso));
      if (!Number.isFinite(ts)) return false;
      return Date.now() - ts < getMfaFreshnessWindowMs(profile);
    } catch (_) {
      return false;
    }
  }

  async function readCachedMfaVerifiedAt() {
    try {
      const raw = await AsyncStorage.getItem(MFA_VERIFIED_CACHE_KEY);
      return raw ? String(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function writeCachedMfaVerifiedAt(value) {
    try {
      if (!value) {
        await AsyncStorage.removeItem(MFA_VERIFIED_CACHE_KEY);
        return;
      }
      await AsyncStorage.setItem(MFA_VERIFIED_CACHE_KEY, String(value));
    } catch (_) {
      // ignore cache failures
    }
  }

  async function clearCachedMfaVerifiedAt() {
    try {
      await AsyncStorage.removeItem(MFA_VERIFIED_CACHE_KEY);
    } catch (_) {
      // ignore cache failures
    }
  }

  async function readDevRoleOverride() {
    try {
      return normalizeRoleOverride(await AsyncStorage.getItem(DEV_ROLE_OVERRIDE_KEY));
    } catch (_) {
      return '';
    }
  }

  async function writeDevRoleOverride(role) {
    try {
      const normalized = normalizeRoleOverride(role);
      if (!normalized) {
        await AsyncStorage.removeItem(DEV_ROLE_OVERRIDE_KEY);
        return '';
      }
      await AsyncStorage.setItem(DEV_ROLE_OVERRIDE_KEY, normalized);
      return normalized;
    } catch (_) {
      return '';
    }
  }

  async function readDevRoleBehavior() {
    try {
      return normalizeDevRoleBehavior(await AsyncStorage.getItem(DEV_ROLE_BEHAVIOR_KEY));
    } catch (_) {
      return 'remember';
    }
  }

  async function writeDevRoleBehavior(behavior) {
    try {
      const normalized = normalizeDevRoleBehavior(behavior);
      await AsyncStorage.setItem(DEV_ROLE_BEHAVIOR_KEY, normalized);
      return normalized;
    } catch (_) {
      return 'remember';
    }
  }

  function applyDevRoleOverride(nextUser, overrideRole, behavior = 'remember') {
    if (!nextUser) return nextUser;
    if (!isSpecialAccessUser(nextUser.email)) return nextUser;
    const normalized = resolveDevRoleOverride(overrideRole, behavior);
    if (!normalized) return nextUser;
    const roleIdentity = getDemoRoleIdentity(normalized, nextUser) || nextUser;
    return {
      ...nextUser,
      id: roleIdentity?.id || nextUser.id,
      name: roleIdentity?.name || nextUser.name,
      devBaseRole: nextUser.role,
      role: normalized,
    };
  }

  async function refreshMfaState() {
    if (inFlightRefreshRef.current) return inFlightRefreshRef.current;
    const promise = _refreshMfaStateImpl().finally(() => {
      if (inFlightRefreshRef.current === promise) inFlightRefreshRef.current = null;
    });
    inFlightRefreshRef.current = promise;
    return promise;
  }

  async function _refreshMfaStateImpl() {
    const a = getAuthInstance();
    const fbUser = a?.currentUser || null;
    if (!fbUser) {
      setMfaRequired(false);
      setMfaVerified(false);
      return { required: false, verified: false, needsMfa: false };
    }

    setMfaLoading(true);
    try {
      // Prefer a forced refresh, but do not fail the MFA flow if securetoken is temporarily
      // unreachable. Firestore rules key off mfaVerifiedAt on the user document.
      try {
        const t = await fbUser.getIdToken(true);
        setToken(String(t || ''));
      } catch (e) {
        try { console.warn('[auth] refreshMfaState: forced token refresh failed; using cached token', e?.message || e); } catch (_) {}
        try {
          const fallbackToken = await fbUser.getIdToken(false);
          setToken(String(fallbackToken || ''));
        } catch (_) {}
      }

      const readProfileWithRetry = async () => {
        let lastProfile = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          // Give the verify endpoint's Firestore write a brief moment to become visible.
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
          }
          const profile = await Api.me().catch((e) => {
            try { console.warn('[auth] refreshMfaState: me() failed', e?.code, e?.message); } catch (_) {}
            return null;
          });
          lastProfile = profile;
          if (!mfaRequiredRef.current || isMfaFresh(profile)) return profile;
        }
        return lastProfile;
      };

      const profile = await readProfileWithRetry();
      if (profile) setUser(profile);
      if (isMfaFresh(profile)) {
        await writeCachedMfaVerifiedAt(profile?.mfaVerifiedAt);
      }

      const org = await Api.getOrgSettings().catch((e) => { try { console.warn('[auth] refreshMfaState: getOrgSettings() failed', e?.code, e?.message); } catch (_) {} return null; });
      // If we've already inferred MFA is required from permission-denied errors,
      // don't accidentally clear the gate due to a transient orgSettings read failure.
      const required = Boolean(org?.item?.mfaEnabled) || Boolean(mfaRequiredRef.current);
      let verified = !required || isMfaFresh(profile);
      if (!verified && required && !profile) {
        const cachedMfaVerifiedAt = await readCachedMfaVerifiedAt();
        verified = isMfaFresh({ mfaVerifiedAt: cachedMfaVerifiedAt, mfaVerifiedAtIsTimestamp: true });
      }
      try { console.info('[auth] refreshMfaState result', { required, verified, hasProfile: !!profile, mfaVerifiedAt: profile?.mfaVerifiedAt }); } catch (_) {}
      setMfaRequired(required);
      setMfaVerified(verified);
      return { required, verified, needsMfa: required && !verified };
    } finally {
      setMfaLoading(false);
    }
  }

  // Note: Firestore "permission-denied" is commonly caused by security rules (e.g. MFA gates)
  // and is not the same thing as an invalid/expired login. Treat it as a gate to resolve,
  // not a reason to sign the user out.
  useEffect(() => {
    Api.setUnauthorizedHandler(async (info) => {
      try {
        logger.warn('auth', 'Unauthorized handler invoked', info);
      } catch (_) {}

      // First, try to refresh MFA gate state. This will allow AppNavigator to push the
      // user to TwoFactor when org MFA is enabled, without a disruptive sign-out.
      try {
        await refreshMfaState();
      } catch (_) {}

      // If this was a true HTTP 401 (e.g. from a REST endpoint), sign out.
      // Today the handler is also invoked for Firestore permission errors; do not force
      // logout for those.
      const method = info?.method ? String(info.method).toUpperCase() : '';
      if (method === 'FIRESTORE') return;
      if (Number(info?.status) === 401) {
        logout().catch(() => {});
      }
    });
    return () => Api.setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (webDevSessionBootstrap) {
      setAuthError(null);
      setToken(webDevSessionBootstrap.token);
      setDevRoleOverride(webDevSessionBootstrap.role);
      setUser(applyDevRoleOverride(webDevSessionBootstrap.user, webDevSessionBootstrap.role));
      setMfaRequired(false);
      setMfaVerified(true);
      setLoading(false);
      return undefined;
    }

    const a = getAuthInstance();
    if (!a) {
      const initErr = getAuthInitError();
      try {
        reportErrorToSentry(initErr || new Error('Firebase Auth failed to initialize.'), {
          area: 'firebase',
          action: 'auth_init',
          hasAuthInstance: false,
        });
      } catch (_) {}
      setAuthError(initErr || new Error('Firebase Auth failed to initialize.'));
      setToken(null);
      setUser(null);
      setLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(a, async (fbUser) => {
      setLoading(true);
      setAuthError(null);
      try {
        if (!fbUser) {
          setToken(null);
          setUser(null);
          setDevRoleOverride('');
          setMfaRequired(false);
          setMfaVerified(false);
          return;
        }

        // Always treat a Firebase user as authenticated, even if downstream Firestore
        // reads are temporarily blocked by security rules (e.g. MFA gate).
        const t = await fbUser.getIdToken();
        setToken(String(t || ''));

        // Load user profile document (role, etc.). If it fails (permission-denied),
        // keep a minimal user so the app doesn't bounce to Login.
        let profile = null;
        let profileErrorCode = null;
        try {
          profile = await Api.me();
        } catch (e) {
          setAuthError(e);
          profileErrorCode = String(e?.code || '').toLowerCase();
          profile = null;
        }

        const profileForState = applyReservedUserOverrides(profile || {
          id: fbUser.uid,
          name: fbUser.displayName || '',
          email: fbUser.email || '',
          role: isReservedSuperAdminEmail(fbUser.email) ? 'superAdmin' : (isSpecialAccessUser(fbUser.email) ? 'admin' : 'parent'),
        });
        const storedOverride = isSpecialAccessUser(fbUser.email) ? await readDevRoleOverride() : '';
        const storedBehavior = isSpecialAccessUser(fbUser.email) ? await readDevRoleBehavior() : 'remember';
        setDevRoleOverride(storedOverride);
        setDevRoleBehavior(storedBehavior);
        setUser(applyDevRoleOverride(profileForState, storedOverride, storedBehavior));

        // If the profile read was blocked by security rules, this is almost certainly
        // the MFA gate. Mark required immediately so the UI never briefly flashes Main.
        const isPermDenied = !!profileErrorCode && profileErrorCode.includes('permission-denied');
        if (isPermDenied) {
          try { console.info('[auth] profile read permission-denied on sign-in → gating MFA'); } catch (_) {}
          setMfaRequired(true);
          setMfaVerified(false);
          // Best-effort navigate; stack may not be ready yet, resetToTwoFactor retries.
          try { resetToTwoFactor(); } catch (_) {}
        }

        // Compute MFA gate (based on orgSettings + profile.mfaVerifiedAt).
        // If profile cannot be read, treat verification as false when required.
        let required = isPermDenied; // start with the inferred gate
        try {
          const org = await Api.getOrgSettings().catch(() => null);
          required = Boolean(org?.item?.mfaEnabled) || required;
        } catch (e) {
          // If org settings can't be loaded, keep the existing values.
          setAuthError(e);
          return;
        }

        if (isMfaFresh(profile)) {
          await writeCachedMfaVerifiedAt(profile?.mfaVerifiedAt);
        }

        let verified = !required || (profile ? isMfaFresh(profile) : false);
        if (!verified && required && !isPermDenied && !profile) {
          const cachedMfaVerifiedAt = await readCachedMfaVerifiedAt();
          verified = isMfaFresh({ mfaVerifiedAt: cachedMfaVerifiedAt, mfaVerifiedAtIsTimestamp: true });
        }
        setMfaRequired(required);
        setMfaVerified(verified);
      } finally {
        setLoading(false);
      }
    });
    return () => {
      try { unsub && unsub(); } catch (_) {}
    };
  }, [webDevSessionBootstrap]);

  useEffect(() => {
    try {
      setDebugContext({
        userId: user?.id,
        role: user?.role,
        hasToken: !!token,
      });
    } catch (_) {}
  }, [user, token]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (loading || !token || !user?.id) return;
      try {
        await syncLoggedInDevicePushRegistration({ userId: user.id });
      } catch (e) {
        if (!cancelled) {
          try {
            logger.warn('auth', 'push sync failed', { message: e?.message || String(e), userId: user.id });
          } catch (_) {}
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, token, user?.id]);

  async function login(email, password) {
    const res = await Api.login(email, password);
    // onAuthStateChanged will refresh token/user; still return the API response for screens.
    return res;
  }

  async function loginWithInviteCode(email, accessCode) {
    const res = await Api.loginWithInviteCode(email, accessCode);
    return res;
  }

  async function loginWithApprovalToken(token) {
    const res = await Api.loginWithApprovalToken(token);
    return res;
  }

  async function completeInvitePasswordSetup(newPassword) {
    const result = await Api.completeInvitePasswordSetup(newPassword);
    setUser((current) => {
      const nextUser = {
        ...(current || {}),
        ...(result?.user || {}),
        passwordSetupRequired: false,
      };
      return applyDevRoleOverride(nextUser, devRoleOverride);
    });
    return result;
  }

  async function logout() {
    const a = getAuthInstance();
    const currentUserId = String(user?.id || '').trim();
    let signedOut = false;
    setLoading(true);
    try {
      if (a) {
        await signOut(a);
        signedOut = true;
      }
    } catch (e) {
      // If signOut fails, do NOT clear local auth state. Otherwise we briefly show Login
      // and then bounce back when Firebase still considers the user signed in.
      try {
        logger.warn('auth', 'signOut failed; keeping session', {
          message: e?.message || String(e),
          code: e?.code,
        });
      } catch (_) {}
      setAuthError(e);
      setLoading(false);
    }

    if (!signedOut && a?.currentUser) return;

    await unregisterLoggedInDevicePushRegistration({ userId: currentUserId }).catch(() => {});

    await clearCachedMfaVerifiedAt();

    resetToLogin();
  }

  async function setAuth(_) {
    const a = getAuthInstance();
    const fbUser = a?.currentUser || null;
    if (!fbUser) {
      const err = new Error('No active Firebase session. Please sign in normally.');
      err.code = 'BB_SET_AUTH_UNSUPPORTED';
      throw err;
    }

    const nextToken = String(_?.token || '') || await fbUser.getIdToken(false).catch(() => '');
    const nextUser = applyReservedUserOverrides(_?.user || await Api.me().catch(() => null) || {
      id: fbUser.uid,
      name: fbUser.displayName || '',
      email: fbUser.email || '',
      role: isReservedSuperAdminEmail(fbUser.email) ? 'superAdmin' : (isSpecialAccessUser(fbUser.email) ? 'admin' : 'parent'),
    });
    const override = isSpecialAccessUser(nextUser?.email) ? await readDevRoleOverride() : '';
    const behavior = isSpecialAccessUser(nextUser?.email) ? await readDevRoleBehavior() : 'remember';
    setDevRoleOverride(override);
    setDevRoleBehavior(behavior);
    setToken(nextToken);
    setUser(applyDevRoleOverride(nextUser, override, behavior));
    return { token: nextToken, user: nextUser };
  }

  async function setRole(nextRole) {
    // Allow role override in any build for the controlled special-access
    // accounts; for everyone else, restrict to __DEV__ builds.
    if (!__DEV__ && !isSpecialAccessUser(user?.email)) return;
    const normalized = normalizeRoleOverride(nextRole);
    if (!normalized) return;
    if (!isSpecialAccessUser(user?.email)) return;

    setDevRoleOverride(normalized);
    await writeDevRoleOverride(normalized);
    setUser((current) => {
      if (!current) return current;
      return {
        ...current,
        devBaseRole: current.devBaseRole || current.role,
        role: normalized,
      };
    });
    navigateToRoleWorkspace(normalized);
  }

  async function setDevStartupBehavior(nextBehavior) {
    if (!__DEV__ && !isSpecialAccessUser(user?.email)) return;
    if (!isSpecialAccessUser(user?.email)) return;

    const normalizedBehavior = normalizeDevRoleBehavior(nextBehavior);
    setDevRoleBehavior(normalizedBehavior);
    await writeDevRoleBehavior(normalizedBehavior);

    if (normalizedBehavior === 'remember') {
      const currentRole = normalizeRoleOverride(user?.role);
      if (currentRole) {
        setDevRoleOverride(currentRole);
        await writeDevRoleOverride(currentRole);
      }
      return;
    }

    setDevRoleOverride(normalizedBehavior);
    await writeDevRoleOverride(normalizedBehavior);
    setUser((current) => {
      if (!current) return current;
      return {
        ...current,
        devBaseRole: current.devBaseRole || current.role,
        role: normalizedBehavior,
      };
    });
    navigateToRoleWorkspace(normalizedBehavior);
  }

  const valueWithMfa = useMemo(
    () => {
      // Master 2FA bypass for the controlled dev account so we can navigate
      // hierarchy/paths without going through the org-level MFA gate.
      const isDevBypass = isSpecialAccessUser(user?.email);
      return ({
        token,
        user,
        loading,
        login,
        loginWithInviteCode,
        loginWithApprovalToken,
        completeInvitePasswordSetup,
        logout,
        setAuth,
        setRole,
        devRoleBehavior,
        setDevStartupBehavior,
        authError,
        passwordSetupRequired: Boolean(user?.passwordSetupRequired),
        mfaRequired: isDevBypass ? false : mfaRequired,
        mfaVerified: isDevBypass ? true : mfaVerified,
        mfaLoading,
        needsMfa: isDevBypass ? false : Boolean(mfaRequired && !mfaVerified),
        markMfaRequired,
        refreshMfaState,
      });
    },
    [token, user, loading, authError, mfaRequired, mfaVerified, mfaLoading, devRoleOverride, devRoleBehavior]
  );

  return <AuthContext.Provider value={valueWithMfa}>{children}</AuthContext.Provider>;
}

export default AuthContext;
