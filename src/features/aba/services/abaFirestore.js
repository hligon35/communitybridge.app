import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import ABA_COLLECTIONS from '../constants/abaCollections';
import {
  buildAbcObservationDoc,
  buildBehaviorEventDoc,
  buildBehaviorTargetDoc,
  buildDurationTimerDoc,
  buildIntervalSampleDoc,
  buildIoaCheckDoc,
  buildLatencyRecordDoc,
  buildParentSummaryDoc,
  buildPhaseChangeDoc,
  buildSessionDataSheetDoc,
  buildSkillTrialDoc,
  buildSupervisionCheckDoc,
  buildTargetReviewDoc,
} from '../models/abaSchemas';

function mapStoredDoc(snapshot) {
  if (!snapshot?.exists?.()) return null;
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    ...data,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function toIso(value) {
  try {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  } catch (_) {
    return null;
  }
  return null;
}

function ensureDb() {
  if (db) return db;
  const error = new Error('Firestore is not initialized.');
  error.code = 'BB_FIREBASE_INIT_FAILED';
  throw error;
}

async function saveDocument(collectionName, docId, payload) {
  ensureDb();
  const now = new Date().toISOString();
  if (docId) {
    await setDoc(doc(db, collectionName, docId), {
      ...payload,
      updatedAt: serverTimestamp(),
      createdAt: payload.createdAt || serverTimestamp(),
    }, { merge: true });
    return { id: docId, ...payload, createdAt: payload.createdAt || now, updatedAt: now };
  }
  const ref = await addDoc(collection(db, collectionName), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, ...payload, createdAt: now, updatedAt: now };
}

async function getDocument(collectionName, docId) {
  ensureDb();
  const snap = await getDoc(doc(db, collectionName, String(docId || '').trim()));
  return mapStoredDoc(snap);
}

async function listByField(collectionName, fieldName, value, max = 100) {
  ensureDb();
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return [];
  const snap = await getDocs(query(collection(db, collectionName), where(fieldName, '==', normalizedValue), limit(max)));
  return snap.docs.map((item) => mapStoredDoc(item)).filter(Boolean).sort((left, right) => {
    const leftStamp = Date.parse(String(left?.updatedAt || left?.createdAt || ''));
    const rightStamp = Date.parse(String(right?.updatedAt || right?.createdAt || ''));
    return (Number.isFinite(rightStamp) ? rightStamp : 0) - (Number.isFinite(leftStamp) ? leftStamp : 0);
  });
}

export async function saveBehaviorTarget(input, existing = null) {
  const next = buildBehaviorTargetDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.behaviorTargets, next.id, next);
}

export async function getBehaviorTarget(targetId) {
  return getDocument(ABA_COLLECTIONS.behaviorTargets, targetId);
}

export async function listBehaviorTargetsByChild(childId, max = 100) {
  return listByField(ABA_COLLECTIONS.behaviorTargets, 'childId', childId, max);
}

export async function listBehaviorTargetsByBcba(bcbaId, max = 100) {
  return listByField(ABA_COLLECTIONS.behaviorTargets, 'bcbaId', bcbaId, max);
}

export async function saveSessionDataSheet(input, existing = null) {
  const next = buildSessionDataSheetDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.sessionDataSheets, next.id, next);
}

export async function getSessionDataSheet(sheetId) {
  return getDocument(ABA_COLLECTIONS.sessionDataSheets, sheetId);
}

export async function getSessionDataSheetBySession(sessionId) {
  const items = await listByField(ABA_COLLECTIONS.sessionDataSheets, 'sessionId', sessionId, 10);
  return items[0] || null;
}

export async function listSessionDataSheetsForTherapist(therapistId, max = 100) {
  return listByField(ABA_COLLECTIONS.sessionDataSheets, 'therapistId', therapistId, max);
}

export async function listSessionDataSheetsForBcba(bcbaId, max = 100) {
  return listByField(ABA_COLLECTIONS.sessionDataSheets, 'bcbaId', bcbaId, max);
}

export async function saveBehaviorEvent(input, existing = null) {
  const next = buildBehaviorEventDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.behaviorEvents, next.id, next);
}

export async function listBehaviorEventsBySheet(sessionDataSheetId, max = 500) {
  return listByField(ABA_COLLECTIONS.behaviorEvents, 'sessionDataSheetId', sessionDataSheetId, max);
}

export async function saveAbcObservation(input, existing = null) {
  const next = buildAbcObservationDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.abcObservations, next.id, next);
}

export async function listAbcObservationsBySheet(sessionDataSheetId, max = 250) {
  return listByField(ABA_COLLECTIONS.abcObservations, 'sessionDataSheetId', sessionDataSheetId, max);
}

export async function saveSkillTrial(input, existing = null) {
  const next = buildSkillTrialDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.skillTrials, next.id, next);
}

export async function listSkillTrialsBySheet(sessionDataSheetId, max = 1000) {
  return listByField(ABA_COLLECTIONS.skillTrials, 'sessionDataSheetId', sessionDataSheetId, max);
}

export async function saveIntervalSample(input, existing = null) {
  const next = buildIntervalSampleDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.intervalSamples, next.id, next);
}

export async function listIntervalSamplesBySheet(sessionDataSheetId, max = 1000) {
  return listByField(ABA_COLLECTIONS.intervalSamples, 'sessionDataSheetId', sessionDataSheetId, max);
}

export async function saveDurationTimer(input, existing = null) {
  const next = buildDurationTimerDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.durationTimers, next.id, next);
}

export async function listDurationTimersBySheet(sessionDataSheetId, max = 1000) {
  return listByField(ABA_COLLECTIONS.durationTimers, 'sessionDataSheetId', sessionDataSheetId, max);
}

export async function saveLatencyRecord(input, existing = null) {
  const next = buildLatencyRecordDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.latencyRecords, next.id, next);
}

export async function listLatencyRecordsBySheet(sessionDataSheetId, max = 1000) {
  return listByField(ABA_COLLECTIONS.latencyRecords, 'sessionDataSheetId', sessionDataSheetId, max);
}

export async function saveTargetReview(input, existing = null) {
  const next = buildTargetReviewDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.targetReviews, next.id, next);
}

export async function listTargetReviewsByTarget(targetId, max = 100) {
  return listByField(ABA_COLLECTIONS.targetReviews, 'targetId', targetId, max);
}

export async function saveSupervisionCheck(input, existing = null) {
  const next = buildSupervisionCheckDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.supervisionChecks, next.id, next);
}

export async function listSupervisionChecksByChild(childId, max = 100) {
  return listByField(ABA_COLLECTIONS.supervisionChecks, 'childId', childId, max);
}

export async function saveIoaCheck(input, existing = null) {
  const next = buildIoaCheckDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.ioaChecks, next.id, next);
}

export async function listIoaChecksByTarget(targetId, max = 100) {
  return listByField(ABA_COLLECTIONS.ioaChecks, 'targetId', targetId, max);
}

export async function savePhaseChange(input, existing = null) {
  const next = buildPhaseChangeDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.phaseChanges, next.id, next);
}

export async function listPhaseChangesByTarget(targetId, max = 100) {
  return listByField(ABA_COLLECTIONS.phaseChanges, 'targetId', targetId, max);
}

export async function saveParentSummary(input, existing = null) {
  const next = buildParentSummaryDoc(input, existing || {});
  return saveDocument(ABA_COLLECTIONS.parentSummaries, next.id, next);
}

export async function listParentSummariesByChild(childId, max = 100) {
  return listByField(ABA_COLLECTIONS.parentSummaries, 'childId', childId, max);
}