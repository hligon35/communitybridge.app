import { Platform } from 'react-native';
import { logger } from './utils/logger';
import { getAuthInstance, getAuthInitError, getFirebaseConfigDebugInfo, probeFirebaseAuthNetwork, probeFirebasePasswordSignIn, createFirebaseUserWithPasswordViaRest, db, storage, functions } from './firebase';
import { BASE_URL } from './config';
import { DEFAULT_AVATAR_TOKEN } from './utils/idVisibility';
import { isAdminRole } from './core/tenant/models';

import {
  signInWithCustomToken,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  getIdToken,
  deleteUser,
} from 'firebase/auth';

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { httpsCallable } from 'firebase/functions';

import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import {
  enqueueOfflineWrite as _enqueueOfflineWrite,
  registerOfflineDispatcher as _registerOfflineDispatcher,
  flushOfflineQueue as _flushOfflineQueue,
  getOfflineQueueSize as _getOfflineQueueSize,
} from './utils/offlineQueue';
import {
  getBehaviorTarget as getBehaviorTargetRecord,
  getSessionDataSheet as getSessionDataSheetRecord,
  getSessionDataSheetBySession as getSessionDataSheetBySessionRecord,
  listAbcObservationsBySheet as listAbcObservationsBySheetRecords,
  listBehaviorEventsBySheet as listBehaviorEventsBySheetRecords,
  listBehaviorTargetsByBcba as listBehaviorTargetsByBcbaRecords,
  listBehaviorTargetsByChild as listBehaviorTargetsByChildRecords,
  listDurationTimersBySheet as listDurationTimersBySheetRecords,
  listIntervalSamplesBySheet as listIntervalSamplesBySheetRecords,
  listIoaChecksByTarget as listIoaChecksByTargetRecords,
  listLatencyRecordsBySheet as listLatencyRecordsBySheetRecords,
  listParentSummariesByChild as listParentSummariesByChildRecords,
  listPhaseChangesByTarget as listPhaseChangesByTargetRecords,
  listSessionDataSheetsForBcba as listSessionDataSheetsForBcbaRecords,
  listSessionDataSheetsForTherapist as listSessionDataSheetsForTherapistRecords,
  listSkillTrialsBySheet as listSkillTrialsBySheetRecords,
  listSupervisionChecksByChild as listSupervisionChecksByChildRecords,
  listTargetReviewsByTarget as listTargetReviewsByTargetRecords,
  saveAbcObservation as saveAbcObservationRecord,
  saveBehaviorEvent as saveBehaviorEventRecord,
  saveBehaviorTarget as saveBehaviorTargetRecord,
  saveDurationTimer as saveDurationTimerRecord,
  saveIntervalSample as saveIntervalSampleRecord,
  saveIoaCheck as saveIoaCheckRecord,
  saveLatencyRecord as saveLatencyRecordRecord,
  saveParentSummary as saveParentSummaryRecord,
  savePhaseChange as savePhaseChangeRecord,
  saveSessionDataSheet as saveSessionDataSheetRecord,
  saveSkillTrial as saveSkillTrialRecord,
  saveSupervisionCheck as saveSupervisionCheckRecord,
  saveTargetReview as saveTargetReviewRecord,
} from './features/aba/services/abaFirestore';

function _wrapWithOfflineFallback(kind, impl) {
  // Register the underlying impl as the dispatcher so flushOfflineQueue can
  // re-issue the original mutation when connectivity returns. The wrapper
  // returned from this helper preserves the impl's success contract; on a
  // network failure it enqueues and throws an error tagged `queued: true`
  // so callers that opt in can present an optimistic "Saved locally" state.
  _registerOfflineDispatcher(kind, (args) => impl(...(Array.isArray(args) ? args : [args])));
  return async function offlineFallbackWrapped(...callArgs) {
    try {
      return await impl(...callArgs);
    } catch (e) {
      if (isLikelyNetworkError(e)) {
        try { await _enqueueOfflineWrite(kind, callArgs); } catch (_) { /* ignore */ }
        const queuedErr = new Error('Saved locally; will sync when connection returns.');
        queuedErr.code = 'BB_QUEUED_OFFLINE';
        queuedErr.queued = true;
        queuedErr.kind = kind;
        throw queuedErr;
      }
      throw e;
    }
  };
}

export const flushOfflineQueue = _flushOfflineQueue;
export const getOfflineQueueSize = _getOfflineQueueSize;

const DEFAULT_API_TIMEOUT_MS = 15000;
const MEDIA_FETCH_TIMEOUT_MS = 45000;

function normalizeEmailInput(email) {
  try {
    if (email == null) return '';
    return String(email).trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

function isoFromMaybeTimestamp(v) {
  try {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (v instanceof Date) return v.toISOString();
    if (typeof v.toDate === 'function') return v.toDate().toISOString(); // Firestore Timestamp
  } catch (_) {
    // ignore
  }
  return null;
}

function requireUser() {
  const a = getAuthInstance();
  const u = a?.currentUser;
  if (!u) {
    const err = new Error('Not authenticated');
    err.code = 'BB_NOT_AUTHENTICATED';
    throw err;
  }
  return u;
}

async function getUserIdToken(user, options = {}) {
  const u = user || requireUser();
  const forceRefresh = Boolean(options && options.forceRefresh);
  if (typeof u?.getIdToken === 'function') return u.getIdToken(forceRefresh);
  return getIdToken(u, forceRefresh);
}

function requireAuth() {
  const a = getAuthInstance();
  if (a) return a;

  const initErr = getAuthInitError();
  const msg = initErr?.message
    ? `Firebase Auth is not initialized: ${initErr.message}`
    : 'Firebase Auth is not initialized.';

  const err = new Error(msg);
  err.code = 'BB_AUTH_INIT_FAILED';
  err.cause = initErr || null;
  throw err;
}

export const API_BASE_URL = '';

async function callFirebaseFunction(name, payload) {
  if (!functions) {
    const err = new Error('Firebase Functions is not initialized.');
    err.code = 'BB_FUNCTIONS_INIT_FAILED';
    throw err;
  }
  const fn = httpsCallable(functions, name);
  const result = await fn(payload || {});
  return result?.data || null;
}

async function callPublicLookupApi(pathname, { method = 'GET', query = null, body = null } = {}) {
  const apiBase = String(BASE_URL || API_BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('API base URL is not configured.');
    err.code = 'BB_API_BASE_URL_REQUIRED';
    throw err;
  }

  const url = new URL(`${apiBase}${pathname}`);
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      const normalized = String(value ?? '').trim();
      if (normalized) url.searchParams.set(key, normalized);
    });
  }

  const resp = await fetchWithTimeout(url.toString(), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const err = new Error(String(json?.error || json?.message || 'Lookup request failed.'));
    err.code = `BB_LOOKUP_API_${resp.status || 0}`;
    err.httpStatus = resp.status;
    throw err;
  }
  return json || null;
}

async function callPublicFirebaseSignupApi(payload) {
  return callPublicLookupApi('/api/public/firebase-signup', {
    method: 'POST',
    body: payload || {},
  });
}

async function callLookupWithFallback(firebaseCall, fallbackCall, timeoutMs = 2500) {
  try {
    return await Promise.race([
      firebaseCall(),
      new Promise((_, reject) => {
        const err = new Error(`Lookup timed out after ${timeoutMs}ms.`);
        err.code = 'BB_LOOKUP_TIMEOUT';
        setTimeout(() => reject(err), timeoutMs);
      }),
    ]);
  } catch (_) {
    return fallbackCall();
  }
}

function isLikelyNetworkError(e) {
  try {
    const msg = String(e?.message || e || '').toLowerCase();
    const name = String(e?.name || '').toLowerCase();

    // Browser fetch failures often show as TypeError("Failed to fetch") or
    // messages that include ERR_CONNECTION_REFUSED.
    if (name === 'typeerror' && msg.includes('fetch')) return true;
    if (msg.includes('failed to fetch')) return true;
    if (msg.includes('fetch failed')) return true;
    if (msg.includes('networkerror')) return true;
    if (msg.includes('network request failed')) return true;
    if (msg.includes('err_connection_refused')) return true;
    if (msg.includes('econnrefused')) return true;
    if (msg.includes('connection refused')) return true;
    if (msg.includes('load failed')) return true;
  } catch (_) {
    // ignore
  }
  return false;
}

function shouldFallbackFromWriteApi({ resp, json, error }) {
  const status = Number(resp?.status || error?.httpStatus || 0);
  const message = String(json?.error || json?.message || error?.message || '').toLowerCase();
  if (status === 404) return true;
  if (status === 401 || status === 403) return true;
  if (message.includes('invalid token') || message.includes('missing auth token') || message.includes('user not found')) return true;
  return false;
}

function shouldFallbackFromReadApi({ resp, json, error }) {
  const status = Number(resp?.status || error?.httpStatus || 0);
  const message = String(json?.error || json?.message || error?.message || '').toLowerCase();
  if (status === 404) return true;
  if (message.includes('not found')) return true;
  return false;
}

function normalizeRecipientIds(input) {
  if (!Array.isArray(input)) return [];
  const ids = [];
  input.forEach((item) => {
    if (!item) return;
    const id = typeof item === 'object' ? item.id : item;
    const normalized = String(id || '').trim();
    if (normalized) ids.push(normalized);
  });
  return Array.from(new Set(ids));
}

async function fetchWithTimeout(resource, init = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  const hasAbortController = typeof AbortController === 'function';
  if (!hasAbortController || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetch(resource, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch (_) {
      // ignore
    }
  }, timeoutMs);

  try {
    return await fetch(resource, {
      ...init,
      signal: init?.signal || controller.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error(`Request timed out after ${timeoutMs}ms.`);
      err.code = 'BB_REQUEST_TIMEOUT';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = typeof fn === 'function' ? fn : null;
}

const DEV_SWITCH_EMAIL = 'dev@communitybridge.app';

function defaultProfileRoleForEmail(email) {
  const normalizedEmail = normalizeEmailInput(email);
  return normalizedEmail === DEV_SWITCH_EMAIL ? 'admin' : 'parent';
}

export function setAuthToken(_) {
  // Compatibility no-op: Firebase Auth manages tokens internally.
}

export async function listOrganizations() {
  return callLookupWithFallback(
    () => callFirebaseFunction('listOrganizationsPublic'),
    () => callPublicLookupApi('/api/public/organizations')
  );
}

export async function listPrograms(organizationId) {
  return callLookupWithFallback(
    () => callFirebaseFunction('listProgramsPublic', { organizationId }),
    () => callPublicLookupApi('/api/public/programs', {
      query: { organizationId },
    })
  );
}

export async function listCampuses({ organizationId, programId }) {
  return callLookupWithFallback(
    () => callFirebaseFunction('listCampusesPublic', { organizationId, programId }),
    () => callPublicLookupApi('/api/public/campuses', {
      query: { organizationId, programId },
    })
  );
}

export async function resolveEnrollmentContext(payload) {
  return callLookupWithFallback(
    () => callFirebaseFunction('resolveEnrollmentContextPublic', payload),
    () => callPublicLookupApi('/api/public/enrollment-context', {
      method: 'POST',
      body: payload || {},
    })
  );
}

function normalizePersonName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function doesChildParentMatchName(child, normalizedName) {
  if (!normalizedName) return false;
  const parentEntries = Array.isArray(child?.parents) ? child.parents : [];
  return parentEntries.some((entry) => {
    if (!entry) return false;
    if (typeof entry === 'string') return normalizePersonName(entry) === normalizedName;
    return normalizePersonName(entry?.name || `${entry?.firstName || ''} ${entry?.lastName || ''}`) === normalizedName;
  });
}

async function findEnrollmentContextByCode(enrollmentCode) {
  const cleanedCode = String(enrollmentCode || '').trim().toUpperCase();
  if (!cleanedCode) {
    const err = new Error('Enrollment code is required.');
    err.code = 'BB_ENROLLMENT_CONTEXT_REQUIRED';
    throw err;
  }
  try {
    return await resolveEnrollmentContext({ enrollmentCode: cleanedCode });
  } catch (error) {
    const err = new Error('We could not verify your enrollment details right now. Please try again in a moment.');
    err.code = error?.code || 'BB_ENROLLMENT_LOOKUP_FAILED';
    throw err;
  }
}

async function linkParentSignupChildren({ uid, parentName, email, enrollmentContext }) {
  if (!db || !uid || !enrollmentContext?.organization?.id || !enrollmentContext?.program?.id || !enrollmentContext?.campus?.id) return;
  const normalizedName = normalizePersonName(parentName);
  const parentRef = doc(db, 'parents', uid);
  const childrenQuery = query(
    collection(db, 'children'),
    where('organizationId', '==', String(enrollmentContext.organization.id)),
    where('programId', '==', String(enrollmentContext.program.id)),
    where('campusId', '==', String(enrollmentContext.campus.id)),
    limit(100)
  );
  const childrenSnap = await getDocs(childrenQuery).catch(() => null);
  const matchingChildren = (childrenSnap?.docs || [])
    .map((snap) => ({ id: snap.id, ...(snap.data() || {}) }))
    .filter((child) => doesChildParentMatchName(child, normalizedName));
  if (!matchingChildren.length) {
    const err = new Error('We could not match that parent name to any children for this enrollment code.');
    err.code = 'BB_PARENT_CHILD_MATCH_REQUIRED';
    throw err;
  }

  const parentIds = [uid];
  await setDoc(
    parentRef,
    {
      id: uid,
      uid,
      name: parentName,
      email,
      organizationId: String(enrollmentContext.organization.id),
      organizationName: String(enrollmentContext.organization.name || ''),
      programId: String(enrollmentContext.program.id),
      programName: String(enrollmentContext.program.name || ''),
      campusId: String(enrollmentContext.campus.id),
      campusName: String(enrollmentContext.campus.name || ''),
      childIds: matchingChildren.map((child) => String(child.id)),
      familyId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await Promise.all(matchingChildren.map((child) => {
    const existingParentIds = Array.isArray(child?.parentIds) ? child.parentIds.map((value) => String(value || '')).filter(Boolean) : [];
    const nextParentIds = Array.from(new Set([...existingParentIds, uid]));
    const existingParents = Array.isArray(child?.parents) ? child.parents : [];
    const hasParentEntry = existingParents.some((entry) => String(entry?.id || entry || '').trim() === uid);
    const nextParents = hasParentEntry
      ? existingParents
      : [...existingParents, { id: uid, name: parentName, email }];
    return setDoc(
      doc(db, 'children', child.id),
      {
        parentIds: nextParentIds,
        parents: nextParents,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }));

  await setDoc(
    doc(db, 'directoryLinks', uid),
    {
      role: 'parent',
      parentId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

async function getUserProfile(uid) {
  if (!db) {
    const err = new Error('Firebase is not initialized (missing Firestore instance).');
    err.code = 'BB_FIREBASE_INIT_FAILED';
    throw err;
  }
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  const mfaIsTimestamp = Boolean(data.mfaVerifiedAt && typeof data.mfaVerifiedAt.toDate === 'function');
  return {
    id: uid,
    ...data,
    createdAt: isoFromMaybeTimestamp(data.createdAt) || data.createdAt || null,
    updatedAt: isoFromMaybeTimestamp(data.updatedAt) || data.updatedAt || null,
    mfaVerifiedAt: isoFromMaybeTimestamp(data.mfaVerifiedAt) || data.mfaVerifiedAt || null,
    mfaVerifiedAtIsTimestamp: mfaIsTimestamp,
  };
}

async function upsertUserProfile(uid, fields) {
  if (!db) {
    const err = new Error('Firebase is not initialized (missing Firestore instance).');
    err.code = 'BB_FIREBASE_INIT_FAILED';
    throw err;
  }
  const now = serverTimestamp();
  await setDoc(
    doc(db, 'users', uid),
    {
      ...fields,
      id: uid,
      updatedAt: now,
      ...(fields?.createdAt ? {} : { createdAt: now }),
    },
    { merge: true }
  );
  return getUserProfile(uid);
}

export async function login(email, password) {
  const e = normalizeEmailInput(email);
  const a = requireAuth();
  let cred;
  try {
    cred = await signInWithEmailAndPassword(a, e, String(password || ''));
  } catch (error) {
    const code = String(error?.code || '');
    if (code === 'auth/network-request-failed' || isLikelyNetworkError(error)) {
      const configInfo = getFirebaseConfigDebugInfo();
      logger.warn('auth', 'Firebase auth network failure diagnostics: config', configInfo);
      try {
        const probe = await probeFirebaseAuthNetwork();
        logger.warn('auth', 'Firebase auth network failure diagnostics: probe', probe);
        error.firebaseNetworkProbe = probe;
      } catch (probeError) {
        logger.warn('auth', 'Firebase auth network failure diagnostics: probe failed', {
          message: String(probeError?.message || probeError || ''),
        });
      }

      try {
        const credentialProbe = await probeFirebasePasswordSignIn(e, String(password || ''));
        logger.warn('auth', 'Firebase auth network failure diagnostics: passwordProbe', credentialProbe);
        error.firebasePasswordProbe = credentialProbe;

        if (!credentialProbe.ok && credentialProbe.errorMessage === 'INVALID_LOGIN_CREDENTIALS') {
          const invalidCredsError = new Error('Invalid email or password.');
          invalidCredsError.code = 'auth/invalid-credential';
          invalidCredsError.firebasePasswordProbe = credentialProbe;
          throw invalidCredsError;
        }
      } catch (probeError) {
        if (probeError?.code === 'auth/invalid-credential') throw probeError;
        logger.warn('auth', 'Firebase auth network failure diagnostics: passwordProbe failed', {
          message: String(probeError?.message || probeError || ''),
        });
      }
    }
    throw error;
  }
  const token = await getIdToken(cred.user, true);
  const profile = (await getUserProfile(cred.user.uid)) || (await upsertUserProfile(cred.user.uid, {
    name: cred.user.displayName || '',
    email: e,
    role: defaultProfileRoleForEmail(e),
  }));
  return { token, user: profile };
}

export async function loginWithInviteCode(email, accessCode) {
  const a = requireAuth();
  const e = normalizeEmailInput(email);
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Invite-code login requires the API server.');
    err.code = 'BB_INVITE_LOGIN_API_REQUIRED';
    throw err;
  }

  const resp = await fetchWithTimeout(`${apiBase}/api/auth/invite-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, accessCode: String(accessCode || '').trim() }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true || !json.customToken) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not sign in with access code.'));
    err.httpStatus = resp.status;
    throw err;
  }

  // The first login still uses Firebase for session state; the server verifies the one-time code.
  const credential = await signInWithCustomToken(a, String(json.customToken));
  const token = await getIdToken(credential.user, true);
  const profile = (await getUserProfile(credential.user.uid)) || json.user || null;
  return { token, user: profile, invite: json.invite || null };
}

export async function loginWithApprovalToken(token) {
  const a = requireAuth();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Approval-link login requires the API server.');
    err.code = 'BB_APPROVAL_LOGIN_API_REQUIRED';
    throw err;
  }

  const resp = await fetchWithTimeout(`${apiBase}/api/auth/approval-link-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: String(token || '').trim() }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true || !json.customToken) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not sign in with approval link.'));
    err.httpStatus = resp.status;
    throw err;
  }

  const credential = await signInWithCustomToken(a, String(json.customToken));
  const authToken = await getIdToken(credential.user, true);
  const profile = (await getUserProfile(credential.user.uid)) || json.user || null;
  return {
    token: authToken,
    user: profile,
    invite: json.invite || null,
    redirectIntent: String(json.redirectIntent || '').trim(),
  };
}

export async function signup(payload) {
  const a = requireAuth();
  const name = String(payload?.name || '').trim();
  const firstName = String(payload?.firstName || '').trim();
  const lastName = String(payload?.lastName || '').trim();
  const email = normalizeEmailInput(payload?.email);
  const password = String(payload?.password || '');
  const role = String(payload?.role || 'parent');
  const organizationId = String(payload?.organizationId || '').trim();
  const programId = String(payload?.programId || '').trim();
  const campusId = String(payload?.campusId || '').trim();
  const enrollmentCode = String(payload?.enrollmentCode || '').trim();

  if (isAdminRole(role)) {
    const err = new Error('Elevated roles must be provisioned by an existing administrator.');
    err.code = 'BB_ELEVATED_ROLE_REQUIRES_ADMIN';
    throw err;
  }

  let enrollmentContext = null;
  if (enrollmentCode) {
    if (organizationId || programId || campusId) {
      try {
        enrollmentContext = await resolveEnrollmentContext({ organizationId, programId, campusId, enrollmentCode });
      } catch (error) {
        const err = new Error('We could not verify your enrollment details right now. Please try again in a moment.');
        err.code = error?.code || 'BB_ENROLLMENT_LOOKUP_FAILED';
        throw err;
      }
    } else {
      enrollmentContext = await findEnrollmentContextByCode(enrollmentCode);
    }
    if (!enrollmentContext?.organization?.id || !enrollmentContext?.program?.id || !enrollmentContext?.campus?.id) {
      const err = new Error('The enrollment code did not match an active organization enrollment.');
      err.code = 'BB_INVALID_ENROLLMENT_CODE';
      throw err;
    }
  }

  let cred;
  try {
    cred = await createUserWithEmailAndPassword(a, email, password);
  } catch (error) {
    const code = String(error?.code || '');
    if (code === 'auth/network-request-failed' || isLikelyNetworkError(error)) {
      const configInfo = getFirebaseConfigDebugInfo();
      logger.warn('auth', 'Firebase signup network failure diagnostics: config', configInfo);
      try {
        const probe = await probeFirebaseAuthNetwork();
        logger.warn('auth', 'Firebase signup network failure diagnostics: probe', probe);
        error.firebaseNetworkProbe = probe;
      } catch (probeError) {
        logger.warn('auth', 'Firebase signup network failure diagnostics: probe failed', {
          message: String(probeError?.message || probeError || ''),
        });
      }

      try {
        const serverSignup = await callPublicFirebaseSignupApi({
          name,
          firstName,
          lastName,
          email,
          password,
          role,
          organizationId: enrollmentContext?.organization?.id || organizationId || '',
          organizationName: enrollmentContext?.organization?.name || '',
          programId: enrollmentContext?.program?.id || programId || '',
          programName: enrollmentContext?.program?.name || '',
          campusId: enrollmentContext?.campus?.id || campusId || '',
          campusName: enrollmentContext?.campus?.name || '',
          enrollmentCode: enrollmentContext?.campus?.enrollmentCode || enrollmentCode || '',
        });
        logger.warn('auth', 'Firebase signup network failure diagnostics: serverSignup', {
          ok: Boolean(serverSignup?.ok),
          uid: String(serverSignup?.uid || ''),
        });

        try {
          cred = await signInWithEmailAndPassword(a, email, password);
        } catch (signInError) {
          logger.warn('auth', 'Firebase signup server fallback created account but SDK sign-in failed', {
            code: String(signInError?.code || ''),
            message: String(signInError?.message || signInError || ''),
          });
          const recoveryError = new Error('Your account was created, but the app could not finish signing you in. Please log in with the email and password you just created.');
          recoveryError.code = 'BB_SIGNUP_CREATED_LOGIN_REQUIRED';
          recoveryError.serverSignup = serverSignup;
          throw recoveryError;
        }
      } catch (serverSignupError) {
        if (serverSignupError?.code === 'BB_SIGNUP_CREATED_LOGIN_REQUIRED') throw serverSignupError;

        const status = Number(serverSignupError?.httpStatus || 0);
        if (status === 409) {
          try {
            cred = await signInWithEmailAndPassword(a, email, password);
          } catch (signInError) {
            const signInCode = String(signInError?.code || '');
            if (signInCode === 'auth/network-request-failed' || isLikelyNetworkError(signInError)) {
              const existsError = new Error('An account already exists for this email address. Try logging in or resetting your password.');
              existsError.code = 'auth/email-already-in-use';
              existsError.cause = signInError;
              throw existsError;
            }
            if (signInCode === 'auth/invalid-credential' || signInCode === 'auth/invalid-login-credentials' || signInCode === 'auth/wrong-password') {
              const existsError = new Error('An account already exists for this email address. Try logging in or resetting your password.');
              existsError.code = 'auth/email-already-in-use';
              throw existsError;
            }
            throw signInError;
          }
        }

        logger.warn('auth', 'Firebase signup network failure diagnostics: serverSignup failed', {
          code: String(serverSignupError?.code || ''),
          status,
          message: String(serverSignupError?.message || serverSignupError || ''),
        });
      }

      if (cred) {
        // The server fallback created the auth user/profile; continue with the normal post-auth path.
      } else try {
        const signupProbe = await createFirebaseUserWithPasswordViaRest(email, password);
        logger.warn('auth', 'Firebase signup network failure diagnostics: signupProbe', signupProbe);
        error.firebaseSignupProbe = signupProbe;

        if (signupProbe.ok) {
          try {
            cred = await signInWithEmailAndPassword(a, email, password);
          } catch (signInError) {
            logger.warn('auth', 'Firebase signup REST fallback created account but SDK sign-in failed', {
              code: String(signInError?.code || ''),
              message: String(signInError?.message || signInError || ''),
            });
            const recoveryError = new Error('Your account was created, but the app could not finish signing you in. Please log in with the email and password you just created.');
            recoveryError.code = 'BB_SIGNUP_CREATED_LOGIN_REQUIRED';
            recoveryError.firebaseSignupProbe = signupProbe;
            throw recoveryError;
          }
        } else if (signupProbe.errorMessage === 'EMAIL_EXISTS') {
          try {
            cred = await signInWithEmailAndPassword(a, email, password);
          } catch (signInError) {
            const signInCode = String(signInError?.code || '');
            if (signInCode === 'auth/invalid-credential' || signInCode === 'auth/invalid-login-credentials' || signInCode === 'auth/wrong-password') {
              const existsError = new Error('An account already exists for this email address. Try logging in or resetting your password.');
              existsError.code = 'auth/email-already-in-use';
              existsError.firebaseSignupProbe = signupProbe;
              throw existsError;
            }
            throw signInError;
          }
        }
      } catch (recoveryError) {
        if (recoveryError?.code) throw recoveryError;
        logger.warn('auth', 'Firebase signup network failure diagnostics: signupProbe failed', {
          message: String(recoveryError?.message || recoveryError || ''),
        });
      }
    }

    if (!cred) throw error;
  }
  try {
    if (name) await updateProfile(cred.user, { displayName: name });
  } catch (_) {
    // ignore
  }

  const profile = await upsertUserProfile(cred.user.uid, {
    name,
    firstName,
    lastName,
    email,
    role,
    organizationId: enrollmentContext?.organization?.id || organizationId || '',
    organizationName: enrollmentContext?.organization?.name || '',
    programId: enrollmentContext?.program?.id || programId || '',
    programName: enrollmentContext?.program?.name || '',
    campusId: enrollmentContext?.campus?.id || campusId || '',
    campusName: enrollmentContext?.campus?.name || '',
    enrollmentCode: enrollmentContext?.campus?.enrollmentCode || enrollmentCode || '',
    avatar: DEFAULT_AVATAR_TOKEN,
    active: true,
  });
  const token = await getIdToken(cred.user, true);

  const roleLower = String(role || '').toLowerCase();
  if (roleLower.includes('parent')) {
    try {
      await linkParentSignupChildren({
        uid: cred.user.uid,
        parentName: name || profile?.name || '',
        email: email || profile?.email || '',
        enrollmentContext,
      });
    } catch (linkError) {
      try { await deleteDoc(doc(db, 'users', cred.user.uid)); } catch (_) {}
      try { await deleteDoc(doc(db, 'parents', cred.user.uid)); } catch (_) {}
      try { await deleteDoc(doc(db, 'directoryLinks', cred.user.uid)); } catch (_) {}
      try { await deleteUser(cred.user); } catch (_) {}
      throw linkError;
    }
  }

  return { token, user: profile };
}

export async function verify2fa(_) {
  const u = requireUser();
  const code = (typeof _ === 'string') ? _ : String(_?.code || '').trim();
  if (!code) {
    const err = new Error('Missing verification code.');
    err.code = 'BB_MFA_CODE_REQUIRED';
    throw err;
  }

  // Preferred: call the API server so org policies/IAM can't block browser preflight.
  // This is also the recommended path for mobile to keep behavior consistent.
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  const tryApi = async ({ forceRefresh } = {}) => {
    const token = await u.getIdToken(!!forceRefresh);
    const resp = await fetchWithTimeout(`${apiBase}/api/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code }),
    });

    const json = await resp.json().catch(() => null);
    return { resp, json };
  };

  try {
    let { resp, json } = await tryApi({ forceRefresh: false });

    // Token may be stale; retry once on auth failures.
    if (resp.status === 401) {
      ({ resp, json } = await tryApi({ forceRefresh: true }));
    }

    if (resp.status === 404) {
      const err = new Error('MFA API endpoint not found.');
      err.code = 'BB_MFA_API_NOT_FOUND';
      throw err;
    }

    if (!resp.ok || !json || json.ok !== true) {
      const msg = String(json?.error || json?.message || resp.statusText || 'Verification failed.');
      const err = new Error(msg);
      err.code = String(json?.code || 'BB_MFA_VERIFY_FAILED');
      err.httpStatus = resp.status;
      throw err;
    }
  } catch (e) {
    // Only fall back if the API endpoint is missing/unreachable (older deployments).
    const shouldFallback = !!functions && (
      e?.code === 'BB_MFA_API_NOT_FOUND' ||
      isLikelyNetworkError(e)
    );

    if (!shouldFallback) throw e;

    try {
      const fn = httpsCallable(functions, 'mfaVerifyCode');
      await fn({ code });
    } catch (err2) {
      const msg = String(err2?.message || err2 || '');
      if (/\b403\b|forbidden|does not have permission/i.test(msg)) {
        const err = new Error(
          'Two-step verification is blocked because the Cloud Function is not invokable from this client (HTTP 403).\n\n' +
          'This usually means invoker/IAM is restricted by org policy. Use the /api/mfa endpoints (recommended), or adjust Cloud Function invoker policy to an allowed principal.'
        );
        err.code = 'BB_MFA_FUNCTION_FORBIDDEN';
        throw err;
      }
      throw err2;
    }
  }

  // Best-effort token refresh only. Firestore MFA rules key off users/{uid}.mfaVerifiedAt,
  // so a transient securetoken failure should not block the user from completing verify.
  try {
    const a = getAuthInstance();
    await a?.currentUser?.getIdToken(true);
  } catch (e) {
    try { console.warn('[Api.verify2fa] token refresh failed after verify; continuing with cached session', e?.message || e); } catch (_) {}
  }

  const profile = await me().catch(() => null);
  return { ok: true, user: profile || null };
}

export async function resend2fa(_) {
  const u = requireUser();
  const method = String(_?.method || _?.channel || _?.type || 'email').trim().toLowerCase();
  const phone = _?.phone != null ? String(_?.phone).trim() : '';

  // Preferred: call the API server so org policies/IAM can't block browser preflight.
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  const tryApi = async ({ forceRefresh } = {}) => {
    const token = await u.getIdToken(!!forceRefresh);
    const resp = await fetchWithTimeout(`${apiBase}/api/mfa/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ method: method === 'sms' ? 'sms' : 'email', ...(phone ? { phone } : {}) }),
    });

    const json = await resp.json().catch(() => null);
    return { resp, json };
  };

  try {
    let { resp, json } = await tryApi({ forceRefresh: false });

    // Token may be stale; retry once on auth failures.
    if (resp.status === 401) {
      ({ resp, json } = await tryApi({ forceRefresh: true }));
    }

    if (resp.status === 404) {
      const err = new Error('MFA API endpoint not found.');
      err.code = 'BB_MFA_API_NOT_FOUND';
      throw err;
    }

    if (!resp.ok || !json || json.ok !== true) {
      const msg = String(json?.error || json?.message || resp.statusText || 'Could not send code.');
      const err = new Error(msg);
      err.code = String(json?.code || 'BB_MFA_SEND_FAILED');
      err.httpStatus = resp.status;
      throw err;
    }

    return { ok: true, ...(json || {}) };
  } catch (e) {
    // Only fall back if the API endpoint is missing/unreachable (older deployments).
    const shouldFallback = !!functions && (
      e?.code === 'BB_MFA_API_NOT_FOUND' ||
      isLikelyNetworkError(e)
    );

    if (!shouldFallback) throw e;

    const fn = httpsCallable(functions, 'mfaSendCode');
    let resp;
    try {
      resp = await fn({ method: method === 'sms' ? 'sms' : 'email', ...(phone ? { phone } : {}) });
    } catch (err2) {
      const msg = String(err2?.message || err2 || '');
      if (/\b403\b|forbidden|does not have permission/i.test(msg)) {
        const err = new Error(
          'Could not send verification code because the Cloud Function is not invokable from this client (HTTP 403).\n\n' +
          'This usually means invoker/IAM is restricted by org policy. Use the /api/mfa endpoints (recommended), or adjust Cloud Function invoker policy to an allowed principal.'
        );
        err.code = 'BB_MFA_FUNCTION_FORBIDDEN';
        throw err;
      }
      throw err2;
    }
    return { ok: true, ...(resp?.data || {}) };
  }
}

export async function requestPasswordReset(email) {
  const a = requireAuth();
  const e = normalizeEmailInput(email);
  await sendPasswordResetEmail(a, e);
  return { ok: true };
}

export async function resetPassword(_) {
  // Firebase uses the email reset link flow; this legacy "resetCode" flow isn't supported.
  const err = new Error('Password reset must be completed via the email link.');
  err.code = 'BB_PASSWORD_RESET_LINK_REQUIRED';
  throw err;
}

export async function completeInvitePasswordSetup(newPassword) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Invite password setup requires the API server.');
    err.code = 'BB_INVITE_SETUP_API_REQUIRED';
    throw err;
  }

  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/auth/complete-invite-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ newPassword: String(newPassword || '') }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not complete password setup.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, user: json.user || null };
}

export async function me() {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (apiBase) {
    try {
      const idToken = await u.getIdToken(true);
      const resp = await fetchWithTimeout(`${apiBase}/api/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      const json = await resp.json().catch(() => null);
      if (resp.ok && json?.ok === true && json?.user) return json.user;
      if (!shouldFallbackFromReadApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load account profile.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromReadApi({ error: e })) throw e;
    }
  }

  const profile = await getUserProfile(u.uid);
  return profile;
}

export async function updateMe(payload) {
  const u = requireUser();
  const next = { ...(payload || {}) };

  // Keep Firebase Auth profile loosely in sync for displayName/photoURL.
  try {
    const update = {};
    if (next.name != null) update.displayName = String(next.name);
    if (next.avatar != null && String(next.avatar) !== DEFAULT_AVATAR_TOKEN) update.photoURL = String(next.avatar);
    if (Object.keys(update).length) await updateProfile(u, update);
  } catch (_) {
    // ignore
  }

  const profile = await upsertUserProfile(u.uid, next);
  let token = '';
  try {
    token = await u.getIdToken(false);
  } catch (_) {
    // keep update successful even if token refresh is temporarily unavailable
  }
  return { ok: true, token, user: profile };
}

export async function listManagedUsers() {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Admin user management requires the API server.');
    err.code = 'BB_ADMIN_USERS_API_REQUIRED';
    throw err;
  }

  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/admin/users`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load managed users.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, items: Array.isArray(json.items) ? json.items : [] };
}

export async function updateManagedUser(userId, payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Admin user management requires the API server.');
    err.code = 'BB_ADMIN_USERS_API_REQUIRED';
    throw err;
  }

  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/admin/users/${encodeURIComponent(String(userId || ''))}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not update user.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, user: json.user || null };
}

export async function sendManagedUserInvite(payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Admin user invitations require the API server.');
    err.code = 'BB_ADMIN_USERS_API_REQUIRED';
    throw err;
  }

  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/admin/users/invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not send invite.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, user: json.user || null, invite: json.invite || null };
}

export async function resendManagedUserInvite(userId) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Admin user invitations require the API server.');
    err.code = 'BB_ADMIN_USERS_API_REQUIRED';
    throw err;
  }

  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/admin/users/${encodeURIComponent(String(userId || ''))}/invite-resend`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not resend invite.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, user: json.user || null, invite: json.invite || null };
}

export async function deleteManagedUser(userId) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Admin user management requires the API server.');
    err.code = 'BB_ADMIN_USERS_API_REQUIRED';
    throw err;
  }

  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/admin/users/${encodeURIComponent(String(userId || ''))}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not delete user.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true };
}

async function getPostComments(postId, max = 50) {
  const commentsRef = collection(db, 'posts', String(postId), 'comments');
  const q = query(commentsRef, orderBy('createdAt', 'desc'), limit(max));
  const snap = await getDocs(q);

  const all = snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      ...data,
      createdAt: isoFromMaybeTimestamp(data.createdAt) || new Date().toISOString(),
    };
  });

  // Build a reply tree using parentId.
  const byId = new Map(all.map((c) => [String(c.id), { ...c, replies: [] }]));
  const roots = [];
  all.forEach((c) => {
    const id = String(c.id);
    const node = byId.get(id);
    const parentId = c.parentId ? String(c.parentId) : '';
    if (parentId && byId.has(parentId)) {
      byId.get(parentId).replies.push(node);
    } else {
      roots.push(node);
    }
  });

  // Return oldest-first for UI.
  roots.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  roots.forEach((r) => (r.replies || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));

  return roots;
}

function requireBoardApiBase() {
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Board activity requires the API server.');
    err.code = 'BB_BOARD_API_REQUIRED';
    throw err;
  }
  return apiBase;
}

export async function getPosts() {
  const u = requireUser();
  const apiBase = requireBoardApiBase();
  const idToken = await getUserIdToken(u);
  const resp = await fetchWithTimeout(`${apiBase}/api/board`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load posts.'));
    err.httpStatus = resp.status;
    throw err;
  }
  if (!Array.isArray(json)) return [];
  return json.map((item) => ({
    ...item,
    createdAt: isoFromMaybeTimestamp(item?.createdAt) || new Date().toISOString(),
    likes: typeof item?.likes === 'number' ? item.likes : (Number(item?.likes) || 0),
    shares: typeof item?.shares === 'number' ? item.shares : (Number(item?.shares) || 0),
    comments: Array.isArray(item?.comments) ? item.comments : [],
  }));
}

export async function createPost(payload) {
  const u = requireUser();
  const profile = await getUserProfile(u.uid);

  const body = String(payload?.body || payload?.text || '').trim();
  const title = payload?.title != null ? String(payload.title) : '';
  const image = payload?.image != null ? String(payload.image) : null;

  const author = {
    id: u.uid,
    name: profile?.name || u.displayName || 'User',
    avatar: profile?.avatar || u.photoURL || null,
  };

  const apiBase = requireBoardApiBase();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/board`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ title, body, image }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not create post.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return {
    ...json,
    author: json.author || author,
    comments: Array.isArray(json.comments) ? json.comments : [],
    likes: typeof json.likes === 'number' ? json.likes : (Number(json.likes) || 0),
    shares: typeof json.shares === 'number' ? json.shares : (Number(json.shares) || 0),
    createdAt: isoFromMaybeTimestamp(json.createdAt) || new Date().toISOString(),
  };
}

export async function likePost(postId) {
  const u = requireUser();
  const apiBase = requireBoardApiBase();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/board/like`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ postId }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not update post likes.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { id: String(postId), likes: typeof json.likes === 'number' ? json.likes : (Number(json.likes) || 0), shares: typeof json.shares === 'number' ? json.shares : (Number(json.shares) || 0) };
}

export async function commentPost(postId, comment) {
  const u = requireUser();
  const profile = await getUserProfile(u.uid);

  const author = {
    id: u.uid,
    name: profile?.name || u.displayName || 'User',
    avatar: profile?.avatar || u.photoURL || null,
    email: profile?.email || u.email || null,
  };

  const body = (typeof comment === 'string') ? comment : (comment?.body || comment?.text || comment?.comment || '');
  const parentId = comment?.parentId != null ? String(comment.parentId) : null;

  const apiBase = requireBoardApiBase();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/board/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ postId, comment: { body: String(body || '').trim(), parentId } }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not create comment.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return {
    ...json,
    author: json.author || author,
    parentId,
    reactions: json?.reactions && typeof json.reactions === 'object' ? json.reactions : {},
    userReactions: json?.userReactions && typeof json.userReactions === 'object' ? json.userReactions : {},
    replies: Array.isArray(json?.replies) ? json.replies : undefined,
    createdAt: isoFromMaybeTimestamp(json?.createdAt) || new Date().toISOString(),
  };
}

export async function reactComment(postId, commentId, emoji) {
  const u = requireUser();
  const normalizedEmoji = (emoji && typeof emoji === 'object') ? (emoji.emoji || emoji.reaction || emoji.value) : emoji;
  const value = String(normalizedEmoji || '').trim();
  if (!value) return { ok: false };

  const apiBase = requireBoardApiBase();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/board/comments/react`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ postId, commentId, emoji: value }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not update comment reaction.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ...json, ok: true };
}

function extractFirstFileFromFormData(formData) {
  try {
    const parts = formData?._parts;
    if (!Array.isArray(parts)) return null;
    for (const p of parts) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const [key, value] = p;
      if (key === 'file' && value && typeof value === 'object' && value.uri) return value;
    }
  } catch (_) {
    // ignore
  }
  return null;
}

export async function uploadMedia(formData) {
  const u = requireUser();
  const file = extractFirstFileFromFormData(formData);
  if (!file?.uri) throw new Error('Missing file');

  let blob;
  try {
    const response = await fetchWithTimeout(file.uri, {}, MEDIA_FETCH_TIMEOUT_MS);
    blob = await response.blob();
  } catch (e) {
    throw new Error(`Unable to prepare file upload: ${e?.message || e}`);
  }

  const name = String(file.name || '').trim() || `upload-${Date.now()}`;
  const contentType = String(file.type || 'application/octet-stream');
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '_');

  const path = `uploads/${u.uid}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);
  try {
    await uploadBytes(storageRef, blob, { contentType });
    const url = await getDownloadURL(storageRef);
    return { ok: true, url, path };
  } finally {
    try { blob?.close?.(); } catch (_) {}
  }
}

export async function signS3(_) {
  return { ok: false, skipped: true };
}

export async function getLinkPreview(url) {
  // Optional enhancement via Cloud Function; fall back to null if not deployed.
  try {
    const fn = httpsCallable(functions, 'linkPreview');
    const res = await fn({ url: String(url || '') });
    return res?.data || null;
  } catch (_) {
    return null;
  }
}

export async function deleteMyAccount(payload) {
  const user = requireUser();
  const uid = String(user.uid || '').trim();
  if (!uid) {
    const err = new Error('Not authenticated');
    err.code = 'BB_NOT_AUTHENTICATED';
    throw err;
  }

  if (payload?.confirm !== true) {
    const err = new Error('Confirmation required');
    err.code = 'BB_CONFIRM_REQUIRED';
    throw err;
  }

  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Account deletion is unavailable because the API server is not configured.');
    err.code = 'BB_API_BASE_URL_REQUIRED';
    throw err;
  }

  const idToken = await user.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/account/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ confirm: true }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || json?.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not delete account.'));
    err.httpStatus = resp.status;
    throw err;
  }

  await user.reload().catch(() => {});
  return { ok: true };
}

export async function getUrgentMemos() {
  const u = requireUser();
  const role = (await getUserProfile(u.uid))?.role || 'parent';
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');

  if (apiBase) {
    try {
      const idToken = await getUserIdToken(u);
      const resp = await fetchWithTimeout(`${apiBase}/api/urgent-memos`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      const json = await resp.json().catch(() => null);
      if (resp.ok && Array.isArray(json)) return json;
      if (!shouldFallbackFromReadApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load urgent memos.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromReadApi({ error: e })) throw e;
    }
  }

  const memosRef = collection(db, 'urgentMemos');
  // Note: This assumes memos are tagged by audienceRole. If you want per-user targeting,
  // add recipient IDs and query by array-contains.
  const q = query(memosRef, orderBy('createdAt', 'desc'), limit(100));
  const snap = await getDocs(q);

  return snap.docs
    .map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        ...data,
        createdAt: isoFromMaybeTimestamp(data.createdAt) || new Date().toISOString(),
      };
    })
    .filter((m) => {
      const audience = (m.audienceRole || '').toString().toLowerCase();
      if (!audience) return true;
      return audience === String(role || '').toLowerCase() || audience === 'all';
    });
}

export async function health() {
  return { ok: true, backend: 'firebase', platform: Platform.OS };
}

export async function ackUrgentMemo(memoIds) {
  const u = requireUser();
  const ids = Array.isArray(memoIds) ? memoIds : [memoIds];
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (apiBase) {
    try {
      const idToken = await u.getIdToken(true);
      const resp = await fetchWithTimeout(`${apiBase}/api/urgent-memos/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ memoIds: ids.filter(Boolean).map(String) }),
      });
      const json = await resp.json().catch(() => null);
      if (resp.ok && json?.ok !== false) return json || { ok: true };
      if (!shouldFallbackFromWriteApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not acknowledge urgent memos.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromWriteApi({ error: e })) throw e;
    }
  }

  const batch = writeBatch(db);
  ids.filter(Boolean).forEach((id) => {
    batch.set(doc(db, 'urgentMemos', String(id), 'reads', u.uid), { readAt: serverTimestamp() }, { merge: true });
  });
  await batch.commit();
  return { ok: true };
}

export async function sendUrgentMemo(memo) {
  const u = requireUser();
  const clean = { ...(memo || {}) };
  const id = clean.id ? String(clean.id) : null;
  delete clean.id;

  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (apiBase) {
    const requestBody = id ? { id, ...clean } : clean;
    const tryApi = async ({ forceRefresh } = {}) => {
      const idToken = await u.getIdToken(!!forceRefresh);
      const resp = await fetchWithTimeout(`${apiBase}/api/urgent-memos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(requestBody),
      });
      const json = await resp.json().catch(() => null);
      return { resp, json };
    };

    try {
      let { resp, json } = await tryApi({ forceRefresh: false });
      if (resp.status === 401) {
        ({ resp, json } = await tryApi({ forceRefresh: true }));
      }
      if (resp.ok && json) return json;
      if (!shouldFallbackFromWriteApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not send urgent memo.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromWriteApi({ error: e })) throw e;
    }
  }

  if (id) {
    await setDoc(doc(db, 'urgentMemos', id), {
      ...clean,
      recipientIds: normalizeRecipientIds(clean.recipients),
      updatedAt: serverTimestamp(),
      createdAt: clean.createdAt ? clean.createdAt : serverTimestamp(),
    }, { merge: true });
    const snap = await getDoc(doc(db, 'urgentMemos', id));
    const data = snap.data() || {};
    return { id, ...data, createdAt: isoFromMaybeTimestamp(data.createdAt) || new Date().toISOString() };
  }

  const refDoc = await addDoc(collection(db, 'urgentMemos'), { ...clean, recipientIds: normalizeRecipientIds(clean.recipients), createdAt: serverTimestamp() });
  return { id: refDoc.id, ...clean, createdAt: new Date().toISOString() };
}

export async function respondUrgentMemo(memoId, action) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (apiBase) {
    try {
      const idToken = await u.getIdToken(true);
      const resp = await fetchWithTimeout(`${apiBase}/api/urgent-memos/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ memoId, action }),
      });
      const json = await resp.json().catch(() => null);
      if (resp.ok && json?.ok !== false) return json || { ok: true };
      if (!shouldFallbackFromWriteApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not update urgent memo.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromWriteApi({ error: e })) throw e;
    }
  }

  await updateDoc(doc(db, 'urgentMemos', String(memoId)), { status: String(action || ''), respondedAt: serverTimestamp() });
  return { ok: true };
}

async function findUserUidByEmail(email) {
  const e = normalizeEmailInput(email);
  if (!e) return null;
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('email', '==', e), limit(1));
  const snap = await getDocs(q);
  if (!snap.docs.length) return null;
  return snap.docs[0].id;
}

async function resolveRecipientUid(recipient) {
  const id = recipient?.id != null ? String(recipient.id) : '';
  const email = normalizeEmailInput(recipient?.email);

  // If id matches a user doc, treat it as uid.
  if (id) {
    const maybe = await getDoc(doc(db, 'users', id)).catch(() => null);
    if (maybe?.exists?.()) return id;
  }

  if (email) {
    const uid = await findUserUidByEmail(email);
    if (uid) return uid;
  }

  // Try resolving directory record to an email.
  if (id) {
    const p = await getDoc(doc(db, 'parents', id)).catch(() => null);
    const t = await getDoc(doc(db, 'therapists', id)).catch(() => null);

    const pEmail = p?.exists?.() ? p.data()?.email : '';
    const tEmail = t?.exists?.() ? t.data()?.email : '';
    const dirEmail = normalizeEmailInput(pEmail || tEmail);

    if (dirEmail) {
      const uid = await findUserUidByEmail(dirEmail);
      if (uid) return uid;
    }
  }

  return null;
}

export async function getMessages() {
  const u = requireUser();
  const profile = await getUserProfile(u.uid);
  const role = String(profile?.role || '').toLowerCase();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');

  if (apiBase) {
    try {
      const idToken = await getUserIdToken(u);
      const resp = await fetchWithTimeout(`${apiBase}/api/messages`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      const json = await resp.json().catch(() => null);
      if (resp.ok && Array.isArray(json)) return json;
      if (!shouldFallbackFromReadApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load messages.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromReadApi({ error: e })) throw e;
    }
  }

  const messagesRef = collection(db, 'messages');

  const queries = [];
  queries.push(query(messagesRef, where('participantUids', 'array-contains', u.uid), orderBy('createdAt', 'desc'), limit(300)));

  // Admin inbox: messages addressed to the admin role (for legacy "admin-1" recipients)
  if (isAdminRole(role)) {
    queries.push(query(messagesRef, where('toRoles', 'array-contains', 'admin'), orderBy('createdAt', 'desc'), limit(300)));
  }

  const snaps = await Promise.all(queries.map((qq) => getDocs(qq).catch(() => null)));
  const seen = new Set();
  const out = [];

  snaps.forEach((snap) => {
    if (!snap) return;
    snap.docs.forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      const data = d.data() || {};
      out.push({
        id: d.id,
        ...data,
        createdAt: isoFromMaybeTimestamp(data.createdAt) || new Date().toISOString(),
      });
    });
  });

  out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return out;
}

export async function sendMessage(payload) {
  const u = requireUser();
  const profile = await getUserProfile(u.uid);

  const threadId = payload?.threadId != null ? String(payload.threadId) : `t-${Date.now()}`;
  const body = String(payload?.body || '').trim();

  const to = Array.isArray(payload?.to) ? payload.to : [];

  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (apiBase) {
    const requestBody = {
      threadId,
      body,
      to,
    };
    const tryApi = async ({ forceRefresh } = {}) => {
      const idToken = await u.getIdToken(!!forceRefresh);
      const resp = await fetchWithTimeout(`${apiBase}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(requestBody),
      });
      const json = await resp.json().catch(() => null);
      return { resp, json };
    };

    try {
      let { resp, json } = await tryApi({ forceRefresh: false });
      if (resp.status === 401) {
        ({ resp, json } = await tryApi({ forceRefresh: true }));
      }
      if (resp.ok && json) return json;
      if (!shouldFallbackFromWriteApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not send message.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromWriteApi({ error: e })) throw e;
    }
  }

  const toRoles = [];
  const participantUids = new Set([u.uid]);

  for (const r of to) {
    const rid = r?.id != null ? String(r.id) : '';
    if (rid.startsWith('admin-')) {
      toRoles.push('admin');
      continue;
    }
    const uid = await resolveRecipientUid(r);
    if (uid) participantUids.add(uid);
  }

  const msg = {
    threadId,
    body,
    sender: {
      id: u.uid,
      name: profile?.name || u.displayName || 'User',
      avatar: profile?.avatar || u.photoURL || null,
    },
    to,
    toRoles: Array.from(new Set(toRoles)),
    participantUids: Array.from(participantUids),
    createdAt: serverTimestamp(),
  };

  const refDoc = await addDoc(collection(db, 'messages'), msg);

  return {
    id: refDoc.id,
    ...msg,
    createdAt: new Date().toISOString(),
  };
}

export async function pingArrival(payload) {
  const u = requireUser();
  const clean = { ...(payload || {}) };

  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (apiBase) {
    const tryApi = async ({ forceRefresh } = {}) => {
      const idToken = await u.getIdToken(!!forceRefresh);
      const resp = await fetchWithTimeout(`${apiBase}/api/arrival/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(clean),
      });
      const json = await resp.json().catch(() => null);
      return { resp, json };
    };

    try {
      let { resp, json } = await tryApi({ forceRefresh: false });
      if (resp.status === 401) {
        ({ resp, json } = await tryApi({ forceRefresh: true }));
      }
      if (resp.ok && json?.ok !== false) return json || { ok: true, via: 'api' };
      if (!shouldFallbackFromWriteApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not ping arrival.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromWriteApi({ error: e })) throw e;
    }
  }

  await addDoc(collection(db, 'arrivalPings'), {
    ...clean,
    createdAt: serverTimestamp(),
  });
  return { ok: true };
}

export async function proposeTimeChange(payload) {
  const u = requireUser();
  const clean = { ...(payload || {}) };

  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (apiBase) {
    try {
      const idToken = await u.getIdToken(true);
      const resp = await fetchWithTimeout(`${apiBase}/api/children/propose-time-change`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(clean),
      });
      const json = await resp.json().catch(() => null);
      if (resp.ok && json) return json;
      if (!shouldFallbackFromWriteApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not propose time change.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromWriteApi({ error: e })) throw e;
    }
  }

  const toWrite = {
    ...clean,
    proposerUid: u.uid,
    status: clean.status || 'pending',
    createdAt: serverTimestamp(),
  };

  const refDoc = await addDoc(collection(db, 'timeChangeProposals'), toWrite);
  return { id: refDoc.id, ...toWrite, createdAt: new Date().toISOString() };
}

export async function getTimeChangeProposals() {
  const u = requireUser();
  const role = String((await getUserProfile(u.uid))?.role || 'parent').toLowerCase();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');

  if (apiBase) {
    try {
      const idToken = await getUserIdToken(u);
      const resp = await fetchWithTimeout(`${apiBase}/api/children/time-change-proposals`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      const json = await resp.json().catch(() => null);
      if (resp.ok && Array.isArray(json)) return json;
      if (!shouldFallbackFromReadApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load time change proposals.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromReadApi({ error: e })) throw e;
    }
  }

  const col = collection(db, 'timeChangeProposals');
  const q = isAdminRole(role)
    ? query(col, orderBy('createdAt', 'desc'), limit(200))
    : query(col, where('proposerUid', '==', u.uid), orderBy('createdAt', 'desc'), limit(200));

  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data() || {};
    return { id: d.id, ...data, createdAt: isoFromMaybeTimestamp(data.createdAt) || new Date().toISOString() };
  });
}

function indexDirectoryRecord(rec) {
  const out = { ...(rec || {}) };
  if (out.email) out.emailNormalized = normalizeEmailInput(out.email);
  return out;
}

function indexChildRecord(child) {
  const out = { ...(child || {}) };
  // parentIds for query filtering
  const parents = Array.isArray(out.parents) ? out.parents : [];
  out.parentIds = parents.map((p) => (p && typeof p === 'object' ? p.id : p)).filter(Boolean).map(String);

  out.amTherapistId = out.amTherapist?.id || out.amTherapistId || null;
  out.pmTherapistId = out.pmTherapist?.id || out.pmTherapistId || null;
  out.bcaTherapistId = out.bcaTherapist?.id || out.bcaTherapistId || null;

  const assigned = out.assignedABA || out.assigned_ABA || out.assigned || [];
  out.assignedABA = Array.isArray(assigned) ? assigned.filter(Boolean).map(String) : [];

  return out;
}

function buildDirectoryRecordId(prefix) {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${String(prefix || 'record').trim() || 'record'}-${stamp}-${random}`;
}

export async function getDirectory() {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (apiBase) {
    try {
      const idToken = await getUserIdToken(u);
      const resp = await fetchWithTimeout(`${apiBase}/api/directory`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      const json = await resp.json().catch(() => null);
      if (resp.ok && json?.ok === true) return json;
      if (!shouldFallbackFromReadApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load directory.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromReadApi({ error: e })) throw e;
    }
  }

  const [childrenSnap, parentsSnap, therapistsSnap] = await Promise.all([
    getDocs(collection(db, 'children')),
    getDocs(collection(db, 'parents')),
    getDocs(collection(db, 'therapists')),
  ]);

  const children = childrenSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const parents = parentsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const therapists = therapistsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  return { ok: true, children, parents, therapists, aba: {} };
}

export async function getDirectoryMe() {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (apiBase) {
    try {
      const idToken = await getUserIdToken(u);
      const resp = await fetchWithTimeout(`${apiBase}/api/directory/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      const json = await resp.json().catch(() => null);
      if (resp.ok && json?.ok === true) return json;
      if (!shouldFallbackFromReadApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load directory.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromReadApi({ error: e })) throw e;
    }
  }

  const profile = await getUserProfile(u.uid);

  const linkSnap = await getDoc(doc(db, 'directoryLinks', u.uid)).catch(() => null);
  if (!linkSnap?.exists?.()) return null;
  const link = linkSnap.data() || {};

  const role = String(link?.role || profile?.role || '').toLowerCase();

  // Parent / Therapist scoped directory (secure-by-default): requires an explicit directory link.
  if (role.includes('parent')) {
    const parentId = link?.parentId != null ? String(link.parentId) : '';
    if (!parentId) return null;

    const pDoc = await getDoc(doc(db, 'parents', parentId)).catch(() => null);
    const meParent = pDoc?.exists?.() ? ({ id: pDoc.id, ...(pDoc.data() || {}) }) : null;
    if (!meParent?.id) return null;

    const familyId = meParent.familyId || null;
    const parentsSnap = familyId
      ? await getDocs(query(collection(db, 'parents'), where('familyId', '==', familyId), limit(50))).catch(() => null)
      : null;

    const childrenSnap = await getDocs(query(collection(db, 'children'), where('parentIds', 'array-contains', String(meParent.id)), limit(100))).catch(() => null);

    const parents = parentsSnap ? parentsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })) : [meParent];
    const children = childrenSnap ? childrenSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })) : [];

    // Resolve therapists referenced by children.
    const therapistIds = new Set();
    children.forEach((c) => {
      if (c.amTherapistId) therapistIds.add(String(c.amTherapistId));
      if (c.pmTherapistId) therapistIds.add(String(c.pmTherapistId));
      if (c.bcaTherapistId) therapistIds.add(String(c.bcaTherapistId));
      (Array.isArray(c.assignedABA) ? c.assignedABA : []).forEach((id) => therapistIds.add(String(id)));
    });

    const therapists = await Promise.all(
      Array.from(therapistIds).map(async (id) => {
        const s = await getDoc(doc(db, 'therapists', id)).catch(() => null);
        return s?.exists?.() ? ({ id: s.id, ...(s.data() || {}) }) : null;
      })
    );

    return { ok: true, children, parents, therapists: therapists.filter(Boolean), aba: {} };
  }

  if (role.includes('therapist')) {
    const therapistId = link?.therapistId != null ? String(link.therapistId) : '';
    if (!therapistId) return null;

    const tDoc = await getDoc(doc(db, 'therapists', therapistId)).catch(() => null);
    const meTherapist = tDoc?.exists?.() ? ({ id: tDoc.id, ...(tDoc.data() || {}) }) : null;
    if (!meTherapist?.id) return null;

    // Children assigned to therapist.
    const childrenSnap = await getDocs(query(collection(db, 'children'), where('assignedABA', 'array-contains', String(meTherapist.id)), limit(150))).catch(() => null);
    const children = childrenSnap ? childrenSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })) : [];

    const parentIds = new Set();
    children.forEach((c) => (Array.isArray(c.parentIds) ? c.parentIds : []).forEach((pid) => parentIds.add(String(pid))));

    const parents = await Promise.all(
      Array.from(parentIds).map(async (id) => {
        const s = await getDoc(doc(db, 'parents', id)).catch(() => null);
        return s?.exists?.() ? ({ id: s.id, ...(s.data() || {}) }) : null;
      })
    );

    return { ok: true, children, parents: parents.filter(Boolean), therapists: [meTherapist], aba: {} };
  }

  // Admins should call getDirectory()
  return null;
}

export async function mergeDirectory(payload) {
  requireUser();
  const batch = writeBatch(db);

  const parents = Array.isArray(payload?.parents) ? payload.parents : [];
  const therapists = Array.isArray(payload?.therapists) ? payload.therapists : [];
  const children = Array.isArray(payload?.children) ? payload.children : [];

  parents.forEach((p) => {
    if (!p?.id) return;
    const id = String(p.id);
    const rec = indexDirectoryRecord(p);
    batch.set(doc(db, 'parents', id), rec, { merge: true });
  });

  therapists.forEach((t) => {
    if (!t?.id) return;
    const id = String(t.id);
    const rec = indexDirectoryRecord(t);
    batch.set(doc(db, 'therapists', id), rec, { merge: true });
  });

  children.forEach((c) => {
    if (!c?.id) return;
    const id = String(c.id);
    const rec = indexChildRecord(c);
    batch.set(doc(db, 'children', id), rec, { merge: true });
  });

  // Mark directory as seeded.
  batch.set(doc(db, 'meta', 'directory'), { seededAt: serverTimestamp() }, { merge: true });

  await batch.commit();
  return { ok: true };
}

export async function enrollLearner(payload) {
  requireUser();

  const normalizedGuardians = (Array.isArray(payload?.guardians) ? payload.guardians : [])
    .map((entry) => {
      const name = String(entry?.name || '').trim();
      const email = normalizeEmailInput(entry?.email || '');
      const phone = String(entry?.phone || '').trim();
      const relationship = String(entry?.relationship || '').trim().toLowerCase();
      if (!name && !email && !phone) return null;
      return {
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(relationship ? { relationship } : {}),
      };
    })
    .filter(Boolean);
  const primaryGuardian = normalizedGuardians.find((entry) => entry?.name) || normalizedGuardians[0] || null;

  const learnerName = String(payload?.name || payload?.learnerName || '').trim();
  const parentName = String(payload?.parentName || payload?.guardianName || primaryGuardian?.name || '').trim();
  const parentEmail = normalizeEmailInput(payload?.parentEmail || payload?.guardianEmail || primaryGuardian?.email || '');
  const parentPhone = String(payload?.parentPhone || payload?.guardianPhone || primaryGuardian?.phone || '').trim();
  const room = String(payload?.room || '').trim();
  const age = String(payload?.age || '').trim();
  const session = String(payload?.session || '').trim().toUpperCase();
  const organizationId = String(payload?.organizationId || '').trim();
  const programId = String(payload?.programId || payload?.branchId || '').trim();
  const campusId = String(payload?.campusId || '').trim();
  const enrollmentCode = String(payload?.enrollmentCode || '').trim().toUpperCase();

  if (!learnerName) {
    const err = new Error('Learner name is required.');
    err.code = 'BB_LEARNER_NAME_REQUIRED';
    throw err;
  }
  if (!parentName) {
    const err = new Error('Parent or guardian name is required.');
    err.code = 'BB_PARENT_NAME_REQUIRED';
    throw err;
  }
  if (!enrollmentCode) {
    const err = new Error('Enrollment code is required.');
    err.code = 'BB_ENROLLMENT_CODE_REQUIRED';
    throw err;
  }

  const enrollmentContext = await resolveEnrollmentContext({
    organizationId,
    programId,
    campusId,
    enrollmentCode,
  });
  if (!enrollmentContext?.organization?.id || !enrollmentContext?.program?.id || !enrollmentContext?.campus?.id) {
    const err = new Error('The enrollment code did not resolve to an active organization, program, and campus.');
    err.code = 'BB_INVALID_ENROLLMENT_CODE';
    throw err;
  }

  const now = new Date().toISOString();
  const child = indexChildRecord({
    id: String(payload?.id || '').trim() || buildDirectoryRecordId('child'),
    name: learnerName,
    age,
    room,
    session: session === 'PM' ? 'PM' : session === 'AM' ? 'AM' : '',
    organizationId: String(enrollmentContext.organization.id),
    organizationName: String(enrollmentContext.organization.name || ''),
    programId: String(enrollmentContext.program.id),
    programName: String(enrollmentContext.program.name || ''),
    campusId: String(enrollmentContext.campus.id),
    campusName: String(enrollmentContext.campus.name || ''),
    enrollmentCode,
    active: true,
    parents: normalizedGuardians.length ? normalizedGuardians : [{
      name: parentName,
      ...(parentEmail ? { email: parentEmail } : {}),
      ...(parentPhone ? { phone: parentPhone } : {}),
    }],
    createdAt: now,
    updatedAt: now,
  });

  await mergeDirectory({ children: [child] });
  return { ok: true, child, enrollmentContext };
}

export async function getStaffWorkspace(facultyId) {
  requireUser();
  const normalizedId = String(facultyId || '').trim();
  if (!normalizedId) return { ok: true, item: null };
  const snap = await getDoc(doc(db, 'staffWorkspaces', normalizedId)).catch(() => null);
  if (!snap?.exists?.()) return { ok: true, item: null };
  const data = snap.data() || {};
  return {
    ok: true,
    item: {
      id: snap.id,
      ...data,
      createdAt: isoFromMaybeTimestamp(data.createdAt),
      updatedAt: isoFromMaybeTimestamp(data.updatedAt),
    },
  };
}

export async function listStaffWorkspaces(facultyIds = []) {
  requireUser();
  const ids = Array.from(new Set((Array.isArray(facultyIds) ? facultyIds : []).map((value) => String(value || '').trim()).filter(Boolean)));
  if (!ids.length) return { ok: true, items: [] };
  const docs = await Promise.all(ids.map((id) => getDoc(doc(db, 'staffWorkspaces', id)).catch(() => null)));
  return {
    ok: true,
    items: docs
      .filter((entry) => entry?.exists?.())
      .map((entry) => {
        const data = entry.data() || {};
        return {
          id: entry.id,
          ...data,
          createdAt: isoFromMaybeTimestamp(data.createdAt),
          updatedAt: isoFromMaybeTimestamp(data.updatedAt),
        };
      }),
  };
}

export async function updateStaffWorkspace(facultyId, payload) {
  requireUser();
  const normalizedId = String(facultyId || '').trim();
  if (!normalizedId) throw new Error('Faculty id is required.');
  const current = payload && typeof payload === 'object' ? payload : {};
  const toWrite = {
    credentials: current.credentials && typeof current.credentials === 'object' ? current.credentials : {},
    availability: current.availability && typeof current.availability === 'object' ? current.availability : {},
    documents: Array.isArray(current.documents) ? current.documents : [],
    updatedAt: serverTimestamp(),
    createdAt: current.createdAt || serverTimestamp(),
  };
  await setDoc(doc(db, 'staffWorkspaces', normalizedId), toWrite, { merge: true });
  return {
    ok: true,
    item: {
      ...toWrite,
      id: normalizedId,
      createdAt: current.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function createExportJob(payload) {
  const user = requireUser();
  const clean = payload && typeof payload === 'object' ? payload : {};
  const toWrite = {
    title: String(clean.title || 'Export Job').trim() || 'Export Job',
    category: String(clean.category || 'reports').trim() || 'reports',
    format: String(clean.format || 'csv').trim() || 'csv',
    scope: String(clean.scope || 'office').trim() || 'office',
    status: 'queued',
    summary: String(clean.summary || '').trim(),
    recordsCount: Number.isFinite(Number(clean.recordsCount)) ? Math.max(0, Math.floor(Number(clean.recordsCount))) : 0,
    requesterUid: String(user.uid || '').trim(),
    artifactName: String(clean.artifactName || '').trim(),
    artifactUrl: String(clean.artifactUrl || '').trim(),
    artifactPath: String(clean.artifactPath || '').trim(),
    artifactMimeType: String(clean.artifactMimeType || '').trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    generatedAt: serverTimestamp(),
  };
  const refDoc = await addDoc(collection(db, 'exportJobs'), toWrite);
  return {
    ok: true,
    item: {
      id: refDoc.id,
      ...toWrite,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function updateExportJob(jobId, payload) {
  requireUser();
  const normalizedId = String(jobId || '').trim();
  if (!normalizedId) throw new Error('Export job id is required.');
  const clean = payload && typeof payload === 'object' ? payload : {};
  const next = {
    updatedAt: serverTimestamp(),
  };
  ['status', 'summary', 'artifactName', 'artifactUrl', 'artifactPath', 'artifactMimeType'].forEach((key) => {
    if (clean[key] != null) next[key] = String(clean[key]).trim();
  });
  if (clean.recordsCount != null) {
    next.recordsCount = Number.isFinite(Number(clean.recordsCount)) ? Math.max(0, Math.floor(Number(clean.recordsCount))) : 0;
  }
  if (clean.generatedAt != null) {
    next.generatedAt = clean.generatedAt === 'serverTimestamp' ? serverTimestamp() : clean.generatedAt;
  }
  await setDoc(doc(db, 'exportJobs', normalizedId), next, { merge: true });
  return { ok: true, id: normalizedId };
}

export async function listExportJobs(limitCount = 20) {
  const user = requireUser();
  const safeLimit = Number.isFinite(Number(limitCount)) ? Math.max(1, Math.min(100, Math.floor(Number(limitCount)))) : 20;
  const snap = await getDocs(query(collection(db, 'exportJobs'), where('requesterUid', '==', String(user.uid || '').trim()), orderBy('createdAt', 'desc'), limit(safeLimit))).catch(() => null);
  const items = snap ? snap.docs.map((entry) => {
    const data = entry.data() || {};
    return {
      id: entry.id,
      ...data,
      createdAt: isoFromMaybeTimestamp(data.createdAt),
      updatedAt: isoFromMaybeTimestamp(data.updatedAt),
      generatedAt: isoFromMaybeTimestamp(data.generatedAt),
    };
  }) : [];
  return { ok: true, items };
}

export async function getProgramWorkspace(programId) {
  requireUser();
  const normalizedId = String(programId || '').trim();
  if (!normalizedId) return { ok: true, item: null };
  const snap = await getDoc(doc(db, 'programEditorWorkspaces', normalizedId)).catch(() => null);
  if (!snap?.exists?.()) return { ok: true, item: null };
  const data = snap.data() || {};
  return {
    ok: true,
    item: {
      id: snap.id,
      ...data,
      createdAt: isoFromMaybeTimestamp(data.createdAt),
      updatedAt: isoFromMaybeTimestamp(data.updatedAt),
    },
  };
}

export async function updateProgramWorkspace(programId, payload) {
  requireUser();
  const normalizedId = String(programId || '').trim();
  if (!normalizedId) throw new Error('Program id is required.');
  const clean = payload && typeof payload === 'object' ? payload : {};
  const next = {
    organizationId: String(clean.organizationId || '').trim(),
    targetName: String(clean.targetName || '').trim(),
    promptHierarchy: String(clean.promptHierarchy || '').trim(),
    masteryCriteria: String(clean.masteryCriteria || '').trim(),
    generalizationPlan: String(clean.generalizationPlan || '').trim(),
    reviewedAt: clean.reviewedAt || null,
    updatedAt: serverTimestamp(),
    createdAt: clean.createdAt || serverTimestamp(),
  };
  await setDoc(doc(db, 'programEditorWorkspaces', normalizedId), next, { merge: true });
  return {
    ok: true,
    item: {
      id: normalizedId,
      ...next,
      reviewedAt: next.reviewedAt || null,
      createdAt: clean.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

export const saveBehaviorTarget = _wrapWithOfflineFallback('saveBehaviorTarget', async function saveBehaviorTargetImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveBehaviorTargetRecord(payload, existing) };
});

export async function getBehaviorTarget(targetId) {
  requireUser();
  return { ok: true, item: await getBehaviorTargetRecord(targetId) };
}

export async function listBehaviorTargetsByChild(childId, max = 100) {
  requireUser();
  return { ok: true, items: await listBehaviorTargetsByChildRecords(childId, max) };
}

export async function listBehaviorTargetsByBcba(bcbaId, max = 100) {
  requireUser();
  return { ok: true, items: await listBehaviorTargetsByBcbaRecords(bcbaId, max) };
}

export const saveSessionDataSheet = _wrapWithOfflineFallback('saveSessionDataSheet', async function saveSessionDataSheetImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveSessionDataSheetRecord(payload, existing) };
});

export async function getSessionDataSheet(sheetId) {
  requireUser();
  return { ok: true, item: await getSessionDataSheetRecord(sheetId) };
}

export async function getSessionDataSheetBySession(sessionId) {
  requireUser();
  return { ok: true, item: await getSessionDataSheetBySessionRecord(sessionId) };
}

export async function listSessionDataSheetsForTherapist(therapistId, max = 100) {
  requireUser();
  return { ok: true, items: await listSessionDataSheetsForTherapistRecords(therapistId, max) };
}

export async function listSessionDataSheetsForBcba(bcbaId, max = 100) {
  requireUser();
  return { ok: true, items: await listSessionDataSheetsForBcbaRecords(bcbaId, max) };
}

export const saveBehaviorEvent = _wrapWithOfflineFallback('saveBehaviorEvent', async function saveBehaviorEventImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveBehaviorEventRecord(payload, existing) };
});

export async function listBehaviorEventsBySheet(sessionDataSheetId, max = 500) {
  requireUser();
  return { ok: true, items: await listBehaviorEventsBySheetRecords(sessionDataSheetId, max) };
}

export const saveAbcObservation = _wrapWithOfflineFallback('saveAbcObservation', async function saveAbcObservationImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveAbcObservationRecord(payload, existing) };
});

export async function listAbcObservationsBySheet(sessionDataSheetId, max = 250) {
  requireUser();
  return { ok: true, items: await listAbcObservationsBySheetRecords(sessionDataSheetId, max) };
}

export const saveSkillTrial = _wrapWithOfflineFallback('saveSkillTrial', async function saveSkillTrialImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveSkillTrialRecord(payload, existing) };
});

export async function listSkillTrialsBySheet(sessionDataSheetId, max = 1000) {
  requireUser();
  return { ok: true, items: await listSkillTrialsBySheetRecords(sessionDataSheetId, max) };
}

export const saveIntervalSample = _wrapWithOfflineFallback('saveIntervalSample', async function saveIntervalSampleImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveIntervalSampleRecord(payload, existing) };
});

export async function listIntervalSamplesBySheet(sessionDataSheetId, max = 1000) {
  requireUser();
  return { ok: true, items: await listIntervalSamplesBySheetRecords(sessionDataSheetId, max) };
}

export const saveDurationTimer = _wrapWithOfflineFallback('saveDurationTimer', async function saveDurationTimerImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveDurationTimerRecord(payload, existing) };
});

export async function listDurationTimersBySheet(sessionDataSheetId, max = 1000) {
  requireUser();
  return { ok: true, items: await listDurationTimersBySheetRecords(sessionDataSheetId, max) };
}

export const saveLatencyRecord = _wrapWithOfflineFallback('saveLatencyRecord', async function saveLatencyRecordImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveLatencyRecordRecord(payload, existing) };
});

export async function listLatencyRecordsBySheet(sessionDataSheetId, max = 1000) {
  requireUser();
  return { ok: true, items: await listLatencyRecordsBySheetRecords(sessionDataSheetId, max) };
}

export const saveTargetReview = _wrapWithOfflineFallback('saveTargetReview', async function saveTargetReviewImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveTargetReviewRecord(payload, existing) };
});

export async function listTargetReviewsByTarget(targetId, max = 100) {
  requireUser();
  return { ok: true, items: await listTargetReviewsByTargetRecords(targetId, max) };
}

export const saveSupervisionCheck = _wrapWithOfflineFallback('saveSupervisionCheck', async function saveSupervisionCheckImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveSupervisionCheckRecord(payload, existing) };
});

export async function listSupervisionChecksByChild(childId, max = 100) {
  requireUser();
  return { ok: true, items: await listSupervisionChecksByChildRecords(childId, max) };
}

export const saveIoaCheck = _wrapWithOfflineFallback('saveIoaCheck', async function saveIoaCheckImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveIoaCheckRecord(payload, existing) };
});

export async function listIoaChecksByTarget(targetId, max = 100) {
  requireUser();
  return { ok: true, items: await listIoaChecksByTargetRecords(targetId, max) };
}

export const savePhaseChange = _wrapWithOfflineFallback('savePhaseChange', async function savePhaseChangeImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await savePhaseChangeRecord(payload, existing) };
});

export async function listPhaseChangesByTarget(targetId, max = 100) {
  requireUser();
  return { ok: true, items: await listPhaseChangesByTargetRecords(targetId, max) };
}

export const saveParentSummary = _wrapWithOfflineFallback('saveParentSummary', async function saveParentSummaryImpl(payload, existing = null) {
  requireUser();
  return { ok: true, item: await saveParentSummaryRecord(payload, existing) };
});

export async function listParentSummariesByChild(childId, max = 100) {
  requireUser();
  return { ok: true, items: await listParentSummariesByChildRecords(childId, max) };
}

export async function getOrgSettings() {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Organization settings require the API server.');
    err.code = 'BB_ORG_SETTINGS_API_REQUIRED';
    throw err;
  }
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/org-settings`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load organization settings.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || null };
}

export async function updateOrgSettings(payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Organization settings require the API server.');
    err.code = 'BB_ORG_SETTINGS_API_REQUIRED';
    throw err;
  }
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/org-settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not save organization settings.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || null };
}

export async function getAttendanceForDate(date) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Attendance requires the API server.');
    err.code = 'BB_ATTENDANCE_API_REQUIRED';
    throw err;
  }
  const dateKey = String(date || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/children/attendance?date=${encodeURIComponent(dateKey)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load attendance.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, dateKey: json.dateKey || dateKey, items: Array.isArray(json.items) ? json.items : [] };
}

export async function _saveAttendanceImpl(payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Attendance requires the API server.');
    err.code = 'BB_ATTENDANCE_API_REQUIRED';
    throw err;
  }
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/children/attendance`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not save attendance.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, dateKey: json.dateKey || '', saved: Number(json.saved) || 0 };
}
export const saveAttendance = _wrapWithOfflineFallback('saveAttendance', _saveAttendanceImpl);

export async function getAttendanceHistory(childId, limit = 365) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Attendance history requires the API server.');
    err.code = 'BB_ATTENDANCE_API_REQUIRED';
    throw err;
  }
  const resolvedChildId = String(childId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/children/${encodeURIComponent(resolvedChildId)}/attendance?limit=${encodeURIComponent(String(limit))}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load attendance history.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, childId: json.childId || resolvedChildId, items: Array.isArray(json.items) ? json.items : [] };
}

export async function getMoodHistory(childId, limit = 60) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Mood tracking requires the API server.');
    err.code = 'BB_MOOD_API_REQUIRED';
    throw err;
  }
  const resolvedChildId = String(childId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/children/${encodeURIComponent(resolvedChildId)}/mood?limit=${encodeURIComponent(String(limit))}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load mood history.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, childId: json.childId || resolvedChildId, items: Array.isArray(json.items) ? json.items : [] };
}

export async function _saveMoodEntryImpl(childId, payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Mood tracking requires the API server.');
    err.code = 'BB_MOOD_API_REQUIRED';
    throw err;
  }
  const resolvedChildId = String(childId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/children/${encodeURIComponent(resolvedChildId)}/mood`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not save mood entry.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || null };
}
export const saveMoodEntry = _wrapWithOfflineFallback('saveMoodEntry', _saveMoodEntryImpl);

export async function updateChildSchedule(childId, payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Schedule updates require the API server.');
    err.code = 'BB_SCHEDULE_API_REQUIRED';
    throw err;
  }
  const resolvedChildId = String(childId || '').trim();
  if (!resolvedChildId) {
    const err = new Error('childId is required.');
    err.code = 'BB_SCHEDULE_BAD_INPUT';
    throw err;
  }
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/children/${encodeURIComponent(resolvedChildId)}/schedule`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not update child schedule.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || null };
}

export async function startTherapySession(payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/therapy-sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not start therapy session.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || null };
}

export async function getActiveTherapySession(childId) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedChildId = String(childId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/therapy-sessions/active?childId=${encodeURIComponent(resolvedChildId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load active therapy session.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || null };
}

export async function _appendTherapySessionEventImpl(sessionId, payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedSessionId = String(sessionId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/therapy-sessions/${encodeURIComponent(resolvedSessionId)}/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not append session event.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || null };
}
export const appendTherapySessionEvent = _wrapWithOfflineFallback('appendTherapySessionEvent', _appendTherapySessionEventImpl);

export async function _appendTherapySessionEventsBulkImpl(sessionId, events) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedSessionId = String(sessionId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/therapy-sessions/${encodeURIComponent(resolvedSessionId)}/events/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ events: Array.isArray(events) ? events : [] }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not append session events.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, items: Array.isArray(json.items) ? json.items : [] };
}
export const appendTherapySessionEventsBulk = _wrapWithOfflineFallback('appendTherapySessionEventsBulk', _appendTherapySessionEventsBulkImpl);

export async function requestTherapyEventChange({ sessionId, eventId, action, reason, proposed } = {}) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy event change requests require the API server.');
    err.code = 'BB_THERAPY_EVENT_CHANGE_API_REQUIRED';
    throw err;
  }
  const sid = String(sessionId || '').trim();
  const eid = String(eventId || '').trim();
  if (!sid || !eid) {
    const err = new Error('sessionId and eventId are required.');
    err.code = 'BB_THERAPY_EVENT_CHANGE_BAD_INPUT';
    throw err;
  }
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(
    `${apiBase}/api/therapy-sessions/${encodeURIComponent(sid)}/events/${encodeURIComponent(eid)}/change-request`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ action, reason, proposed }),
    }
  );
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not submit change request.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, requestId: json.requestId || null, status: json.status || 'pending' };
}

export async function getTherapySessionEvents(sessionId, limit = 40) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedSessionId = String(sessionId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/therapy-sessions/${encodeURIComponent(resolvedSessionId)}/events?limit=${encodeURIComponent(String(limit))}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load therapy session events.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, sessionId: json.sessionId || resolvedSessionId, items: Array.isArray(json.items) ? json.items : [] };
}

export async function endTherapySession(sessionId, payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedSessionId = String(sessionId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/therapy-sessions/${encodeURIComponent(resolvedSessionId)}/end`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not end therapy session.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || null, summary: json.summary || null };
}

export async function generateTherapySessionSummary(sessionId) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedSessionId = String(sessionId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/therapy-sessions/${encodeURIComponent(resolvedSessionId)}/generate-summary`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not generate therapy session summary.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.summary || null };
}

export async function getTherapySessionSummary(sessionId) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedSessionId = String(sessionId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/therapy-sessions/${encodeURIComponent(resolvedSessionId)}/summary`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load therapy session summary.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || null };
}

export async function updateTherapySessionSummary(sessionId, payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedSessionId = String(sessionId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/therapy-sessions/${encodeURIComponent(resolvedSessionId)}/summary`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not save therapy session summary.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || null };
}

export async function approveTherapySessionSummary(sessionId, payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedSessionId = String(sessionId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/therapy-sessions/${encodeURIComponent(resolvedSessionId)}/summary/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not approve therapy session summary.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || null };
}

export async function getChildSessionSummaries(childId, limit = 20) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedChildId = String(childId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/children/${encodeURIComponent(resolvedChildId)}/session-summaries?limit=${encodeURIComponent(String(limit))}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load child session summaries.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, childId: json.childId || resolvedChildId, items: Array.isArray(json.items) ? json.items : [] };
}

export async function getLatestChildSessionSummary(childId) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedChildId = String(childId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/children/${encodeURIComponent(resolvedChildId)}/session-summaries/latest`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load latest child session summary.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, childId: json.childId || resolvedChildId, item: json.item || null };
}

export async function getTherapySessionSummaryText(sessionId) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedSessionId = String(sessionId || '').trim();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/therapy-sessions/${encodeURIComponent(resolvedSessionId)}/artifacts/session-summary.txt`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(text || resp.statusText || 'Could not load session summary text.');
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, text: await resp.text() };
}

export async function getChildProgressInsights(childId, options = {}) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const resolvedChildId = String(childId || '').trim();
  const limit = Math.max(1, Math.min(Number(options?.limit || 20) || 20, 100));
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/children/${encodeURIComponent(resolvedChildId)}/progress-insights?limit=${encodeURIComponent(String(limit))}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load child progress insights.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return json;
}

export async function getTherapistDocumentationInsights(options = {}) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const query = new URLSearchParams();
  if (options?.limit != null) query.set('limit', String(options.limit));
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/insights/therapist-documentation${query.toString() ? `?${query.toString()}` : ''}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load therapist documentation insights.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return json;
}

export async function getOrganizationInsights(options = {}) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Therapy sessions require the API server.');
    err.code = 'BB_THERAPY_SESSION_API_REQUIRED';
    throw err;
  }
  const query = new URLSearchParams();
  if (options?.limit != null) query.set('limit', String(options.limit));
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/insights/organization${query.toString() ? `?${query.toString()}` : ''}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load organization insights.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return json;
}

export async function getPermissionsConfig() {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Permissions configuration requires the API server.');
    err.code = 'BB_PERMISSIONS_API_REQUIRED';
    throw err;
  }

  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/permissions-config`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load permissions configuration.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || {} };
}

export async function updatePermissionsConfig(payload) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Permissions configuration requires the API server.');
    err.code = 'BB_PERMISSIONS_API_REQUIRED';
    throw err;
  }

  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/permissions-config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not save permissions configuration.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, item: json.item || {} };
}

export async function getAuditLogs(limit = 25) {
  const u = requireUser();
  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) {
    const err = new Error('Audit log review requires the API server.');
    err.code = 'BB_AUDIT_LOGS_API_REQUIRED';
    throw err;
  }

  const idToken = await u.getIdToken(true);
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Math.floor(Number(limit)))) : 25;
  const resp = await fetchWithTimeout(`${apiBase}/api/audit-logs?limit=${encodeURIComponent(String(safeLimit))}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json || json.ok !== true) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not load audit logs.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { ok: true, items: Array.isArray(json.items) ? json.items : [] };
}

export async function respondTimeChange(proposalId, action) {
  requireUser();
  await updateDoc(doc(db, 'timeChangeProposals', String(proposalId)), { status: String(action || ''), respondedAt: serverTimestamp() });
  return { ok: true };
}

export async function sharePost(postId) {
  const u = requireUser();
  const apiBase = requireBoardApiBase();
  const idToken = await u.getIdToken(true);
  const resp = await fetchWithTimeout(`${apiBase}/api/board/share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ postId }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json) {
    const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not update post shares.'));
    err.httpStatus = resp.status;
    throw err;
  }
  return { id: String(postId), likes: typeof json.likes === 'number' ? json.likes : (Number(json.likes) || 0), shares: typeof json.shares === 'number' ? json.shares : (Number(json.shares) || 0), ok: true };
}

export async function registerPushToken(payload) {
  const u = requireUser();
  const token = String(payload?.token || '').trim();
  if (!token) return { ok: false };

  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  const requestBody = {
    token,
    userId: u.uid,
    platform: payload?.platform || Platform.OS,
    enabled: payload?.enabled !== false,
    preferences: payload?.preferences || {},
  };

  if (apiBase) {
    const tryApi = async ({ forceRefresh } = {}) => {
      const idToken = await u.getIdToken(!!forceRefresh);
      const resp = await fetchWithTimeout(`${apiBase}/api/push/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(requestBody),
      });
      const json = await resp.json().catch(() => null);
      return { resp, json };
    };

    const shouldFallbackFromPushApi = ({ resp, json, error }) => {
      const status = Number(resp?.status || error?.httpStatus || 0);
      const message = String(json?.error || json?.message || error?.message || '').toLowerCase();
      if (status === 404) return true;
      if (status === 401 || status === 403) return true;
      if (message.includes('invalid token') || message.includes('missing auth token') || message.includes('user not found')) return true;
      return false;
    };

    try {
      let { resp, json } = await tryApi({ forceRefresh: false });
      if (resp.status === 401) {
        ({ resp, json } = await tryApi({ forceRefresh: true }));
      }
      if (resp.ok && json?.ok !== false) return { ok: true, via: 'api' };
      if (!shouldFallbackFromPushApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not register push token.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromPushApi({ error: e })) throw e;
    }
  }

  await setDoc(
    doc(db, 'pushTokens', token),
    {
      token,
      userUid: u.uid,
      platform: payload?.platform || Platform.OS,
      enabled: payload?.enabled !== false,
      preferences: payload?.preferences || {},
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
  return { ok: true, via: 'firestore' };
}

export async function unregisterPushToken(payload) {
  const u = requireUser();
  const token = String(payload?.token || '').trim();
  if (!token) return { ok: false };

  const apiBase = String(BASE_URL || '').replace(/\/$/, '');
  if (apiBase) {
    const tryApi = async ({ forceRefresh } = {}) => {
      const idToken = await u.getIdToken(!!forceRefresh);
      const resp = await fetchWithTimeout(`${apiBase}/api/push/unregister`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ token }),
      });
      const json = await resp.json().catch(() => null);
      return { resp, json };
    };

    const shouldFallbackFromPushApi = ({ resp, json, error }) => {
      const status = Number(resp?.status || error?.httpStatus || 0);
      const message = String(json?.error || json?.message || error?.message || '').toLowerCase();
      if (status === 404) return true;
      if (status === 401 || status === 403) return true;
      if (message.includes('invalid token') || message.includes('missing auth token') || message.includes('user not found')) return true;
      return false;
    };

    try {
      let { resp, json } = await tryApi({ forceRefresh: false });
      if (resp.status === 401) {
        ({ resp, json } = await tryApi({ forceRefresh: true }));
      }
      if (resp.ok && json?.ok !== false) return { ok: true, via: 'api' };
      if (!shouldFallbackFromPushApi({ resp, json }) && !isLikelyNetworkError({ message: resp.statusText })) {
        const err = new Error(String(json?.error || json?.message || resp.statusText || 'Could not unregister push token.'));
        err.httpStatus = resp.status;
        throw err;
      }
    } catch (e) {
      if (!isLikelyNetworkError(e) && !shouldFallbackFromPushApi({ error: e })) throw e;
    }
  }

  await setDoc(
    doc(db, 'pushTokens', token),
    {
      token,
      userUid: u.uid,
      enabled: false,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return { ok: true, via: 'firestore' };
}

// Backwards-compatible wrappers used by some components
export async function sendMessageApi(payload) {
  return sendMessage(payload);
}

export async function createUrgentMemoApi(payload) {
  return sendUrgentMemo(payload);
}

export async function ackUrgentMemoApi(id) {
  return ackUrgentMemo(Array.isArray(id) ? id : [id]);
}

export default {
  setAuthToken,
  login,
  loginWithInviteCode,
  loginWithApprovalToken,
  signup,
  verify2fa,
  resend2fa,
  requestPasswordReset,
  resetPassword,
  completeInvitePasswordSetup,
  me,
  updateMe,
  listManagedUsers,
  sendManagedUserInvite,
  updateManagedUser,
  resendManagedUserInvite,
  deleteManagedUser,
  getPosts,
  createPost,
  likePost,
  commentPost,
  reactComment,
  uploadMedia,
  signS3,
  getLinkPreview,
  deleteMyAccount,
  getUrgentMemos,
  health,
  ackUrgentMemo,
  sendUrgentMemo,
  respondUrgentMemo,
  getMessages,
  sendMessage,
  pingArrival,
  proposeTimeChange,
  getTimeChangeProposals,
  getDirectory,
  getDirectoryMe,
  mergeDirectory,
  updateChildSchedule,
  getStaffWorkspace,
  listStaffWorkspaces,
  updateStaffWorkspace,
  createExportJob,
  updateExportJob,
  listExportJobs,
  getProgramWorkspace,
  updateProgramWorkspace,
  saveBehaviorTarget,
  getBehaviorTarget,
  listBehaviorTargetsByChild,
  listBehaviorTargetsByBcba,
  saveSessionDataSheet,
  getSessionDataSheet,
  getSessionDataSheetBySession,
  listSessionDataSheetsForTherapist,
  listSessionDataSheetsForBcba,
  saveBehaviorEvent,
  listBehaviorEventsBySheet,
  saveAbcObservation,
  listAbcObservationsBySheet,
  saveSkillTrial,
  listSkillTrialsBySheet,
  saveIntervalSample,
  listIntervalSamplesBySheet,
  saveDurationTimer,
  listDurationTimersBySheet,
  saveLatencyRecord,
  listLatencyRecordsBySheet,
  saveTargetReview,
  listTargetReviewsByTarget,
  saveSupervisionCheck,
  listSupervisionChecksByChild,
  saveIoaCheck,
  listIoaChecksByTarget,
  savePhaseChange,
  listPhaseChangesByTarget,
  saveParentSummary,
  listParentSummariesByChild,
  getOrgSettings,
  updateOrgSettings,
  getAttendanceForDate,
  saveAttendance,
  getAttendanceHistory,
  getMoodHistory,
  saveMoodEntry,
  startTherapySession,
  getActiveTherapySession,
  appendTherapySessionEvent,
  appendTherapySessionEventsBulk,
  requestTherapyEventChange,
  getTherapySessionEvents,
  endTherapySession,
  generateTherapySessionSummary,
  getTherapySessionSummary,
  updateTherapySessionSummary,
  approveTherapySessionSummary,
  getChildSessionSummaries,
  getLatestChildSessionSummary,
  getTherapySessionSummaryText,
  getChildProgressInsights,
  getTherapistDocumentationInsights,
  getOrganizationInsights,
  getPermissionsConfig,
  updatePermissionsConfig,
  getAuditLogs,
  respondTimeChange,
  sharePost,
  registerPushToken,
  unregisterPushToken,
  // legacy
  sendMessageApi,
  createUrgentMemoApi,
  ackUrgentMemoApi,
};
