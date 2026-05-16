const { DEFAULT_RESOURCE_URL, SUPPORT_URL, DOWNLOAD_URL } = require('../config/brand');
const raw = require('../../communitybridge_full_workflow_complete_coverage_seed.json');

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

function normalizeLookup(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeIso(value, fallback) {
  const input = value || fallback;
  if (!input) return '';
  const date = new Date(String(input));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function buildAvatar(seed, supplied, size) {
  const value = String(supplied || '').trim();
  if (value) return value;
  return `https://i.pravatar.cc/${size}?u=${encodeURIComponent(String(seed || 'screenshot'))}`;
}

function normalizeRoleName(role, fallback) {
  const value = String(role || fallback || '').trim();
  return value || fallback || '';
}

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getEntryChildId(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return String(entry.childId || entry.learnerId || entry.studentId || entry.clientId || '').trim();
}

function getEntryTimestamp(entry, fields) {
  const keys = Array.isArray(fields) ? fields : [];
  for (const key of keys) {
    const iso = normalizeIso(entry?.[key], '');
    if (iso) return iso;
  }
  return '';
}

function pickLatestByChild(items, timestampFields) {
  const next = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const childId = getEntryChildId(item);
    if (!childId) return;
    const current = next.get(childId);
    const currentTs = Date.parse(getEntryTimestamp(current, timestampFields));
    const itemTs = Date.parse(getEntryTimestamp(item, timestampFields));
    if (!current || (Number.isFinite(itemTs) && (!Number.isFinite(currentTs) || itemTs >= currentTs))) {
      next.set(childId, item);
    }
  });
  return next;
}

function pushToChildMap(map, childId, value) {
  if (!childId) return;
  if (!map.has(childId)) map.set(childId, []);
  map.get(childId).push(value);
}

function dedupeByKey(items, keySelector) {
  const next = new Map();
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const key = keySelector(item, index);
    if (!key || next.has(key)) return;
    next.set(key, item);
  });
  return Array.from(next.values());
}

function toShortDateLabel(value) {
  const iso = normalizeIso(value, '');
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString([], { weekday: 'short' });
  } catch (_) {
    return '—';
  }
}

function titleCaseWords(value) {
  return String(value || '')
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

const DEMO_CHILD_ID_SET = new Set(['child-001', 'child-002']);
const DEMO_PARENT_ID_SET = new Set(['par-001', 'par-dev-001']);
const DEMO_THERAPIST_ID_SET = new Set(['bcba-001', 'aba-101', 'aba-102', 'aba-103', 'aba-104']);
const DEMO_STAFF_ID_SET = new Set(['staff-001', 'office-001']);
const DEMO_USER_ID_SET = new Set([
  'user-parent-review',
  'user-parent-dev-switch',
  'user-therapist-review',
  'user-bcba-review',
  'user-office-review',
  'user-admin-review',
]);
const DEMO_THREAD_PARTICIPANT_ID_SET = new Set([
  'par-001',
  'par-dev-001',
  'aba-101',
  'aba-102',
  'aba-103',
  'aba-104',
  'bcba-001',
  'office-001',
  'staff-001',
  'user-parent-review',
  'user-parent-dev-switch',
  'user-therapist-review',
  'user-bcba-review',
  'user-office-review',
  'user-admin-review',
]);

const DEMO_USER_OVERRIDES = Object.freeze({
  'user-parent-review': { name: 'Cheyanne Cook', email: 'cheyanne2448@gmail.com', role: 'parent' },
  'user-parent-dev-switch': { name: 'Harold Ligon', email: 'hligon35@gmail.com', role: 'parent' },
  'user-therapist-review': { name: 'CommunityBridge ABA', email: 'aba@communitybridge.app', role: 'therapist' },
  'user-bcba-review': { name: 'CommunityBridge BCBA', email: 'bcba@communitybridge.app', role: 'bcba' },
  'user-office-review': { name: 'CommunityBridge Office', email: 'office@communitybridge.app', role: 'office' },
  'user-admin-review': { name: 'CommunityBridge Admin', email: 'admin@communitybridge.app', role: 'admin' },
});

const DEMO_PARENT_OVERRIDES = Object.freeze({
  'par-001': { name: 'Cheyanne Cook', email: 'cheyanne2448@gmail.com' },
  'par-dev-001': { name: 'Harold Ligon', email: 'hligon35@gmail.com' },
});

const DEMO_THERAPIST_OVERRIDES = Object.freeze({
  'bcba-001': { name: 'CommunityBridge BCBA', email: 'bcba@communitybridge.app', role: 'bcba', title: 'Supervising Clinician' },
  'aba-101': { name: 'CommunityBridge ABA', email: 'aba@communitybridge.app', role: 'therapist', title: 'ABA Therapist', supervisedBy: 'bcba-001' },
  'aba-102': { name: 'CommunityBridge ABA Tech 2', email: 'abatech2@communitybridge.app', role: 'therapist', title: 'ABA Therapist', supervisedBy: 'bcba-001' },
  'aba-103': { name: 'CommunityBridge ABA Tech 3', email: 'abatech3@communitybridge.app', role: 'therapist', title: 'ABA Therapist', supervisedBy: 'bcba-001' },
  'aba-104': { name: 'CommunityBridge ABA Tech 4', email: 'abatech4@communitybridge.app', role: 'therapist', title: 'ABA Therapist', supervisedBy: 'bcba-001' },
});

const DEMO_CHILD_THERAPIST_ASSIGNMENTS = Object.freeze({
  'child-001': Object.freeze({ assignedABA: ['aba-101', 'aba-102'], amTherapist: 'aba-101', pmTherapist: 'aba-102' }),
  'child-002': Object.freeze({ assignedABA: ['aba-103', 'aba-104'], amTherapist: 'aba-103', pmTherapist: 'aba-104' }),
});

const DEMO_THERAPIST_ID_REMAPPINGS = Object.freeze({
  'aba-101': 'aba-101',
  'aba-106': 'aba-102',
  'aba-102': 'aba-103',
  'aba-107': 'aba-104',
});

const DEMO_STAFF_OVERRIDES = Object.freeze({
  'staff-001': { name: 'CommunityBridge Admin', email: 'admin@communitybridge.app', role: 'Admin', title: 'Center Administrator' },
  'office-001': { name: 'CommunityBridge Office', email: 'office@communitybridge.app', role: 'Office', title: 'Operations Director' },
});

function applyDemoOverride(entity, overrides) {
  if (!entity || typeof entity !== 'object') return entity;
  const id = String(entity.id || '').trim();
  const override = overrides[id] || null;
  return override ? { ...entity, ...override } : entity;
}

function isDemoChildId(value) {
  return DEMO_CHILD_ID_SET.has(String(value || '').trim());
}

function remapDemoTherapistId(value) {
  const id = String(value || '').trim();
  if (!id) return 'aba-101';
  if (id === 'bcba-001') return id;
  if (DEMO_THERAPIST_ID_REMAPPINGS[id]) return DEMO_THERAPIST_ID_REMAPPINGS[id];
  if (id.startsWith('aba-')) return 'aba-101';
  return id;
}

function filterByDemoChild(items) {
  return (Array.isArray(items) ? items : []).filter((item) => isDemoChildId(getEntryChildId(item)));
}

function filterDemoThreads(threadGroups) {
  return Object.fromEntries(
    Object.entries(threadGroups && typeof threadGroups === 'object' ? threadGroups : {})
      .map(([role, threads]) => [
        role,
        (Array.isArray(threads) ? threads : []).filter((thread) => {
          const participants = Array.isArray(thread?.participants)
            ? thread.participants.map((id) => String(id || '').trim()).filter(Boolean)
            : [];
          return participants.length > 0 && participants.every((participantId) => DEMO_THREAD_PARTICIPANT_ID_SET.has(participantId));
        }),
      ])
      .filter(([, threads]) => threads.length > 0)
  );
}

function normalizeDemoChild(child) {
  const explicitParents = Array.isArray(child?.parents) ? child.parents : [];
  const childId = String(child?.id || '').trim();
  const therapistAssignment = DEMO_CHILD_THERAPIST_ASSIGNMENTS[childId] || DEMO_CHILD_THERAPIST_ASSIGNMENTS['child-001'];
  return {
    ...child,
    parents: explicitParents
      .filter((entry) => DEMO_PARENT_ID_SET.has(String(entry?.id || '').trim()))
      .map((entry) => applyDemoOverride(entry, DEMO_PARENT_OVERRIDES)),
    assignedABA: [...therapistAssignment.assignedABA],
    assigned_ABA: [...therapistAssignment.assignedABA],
    amTherapist: therapistAssignment.amTherapist,
    pmTherapist: therapistAssignment.pmTherapist,
    bcaTherapist: 'bcba-001',
    bcbaId: 'bcba-001',
  };
}

const organization = raw.organization || {};
const firstProgram = (Array.isArray(raw.programs) ? raw.programs : [])[0] || {};
const firstCampus = (Array.isArray(raw.campuses) ? raw.campuses : [])[0] || {};
const usersRaw = (Array.isArray(raw.users) ? raw.users : [])
  .filter((user) => DEMO_USER_ID_SET.has(String(user?.id || '').trim()))
  .map((user) => applyDemoOverride(user, DEMO_USER_OVERRIDES));
const parentsRaw = (Array.isArray(raw.parents) ? raw.parents : [])
  .filter((parent) => DEMO_PARENT_ID_SET.has(String(parent?.id || '').trim()))
  .map((parent) => applyDemoOverride(parent, DEMO_PARENT_OVERRIDES));
const therapistsRaw = (Array.isArray(raw.therapists) ? raw.therapists : [])
  .filter((therapist) => DEMO_THERAPIST_ID_SET.has(String(therapist?.id || '').trim()))
  .map((therapist) => applyDemoOverride(therapist, DEMO_THERAPIST_OVERRIDES));
const staffRaw = (Array.isArray(raw.staff) ? raw.staff : [])
  .filter((staff) => DEMO_STAFF_ID_SET.has(String(staff?.id || '').trim()))
  .map((staff) => applyDemoOverride(staff, DEMO_STAFF_OVERRIDES));
const childrenRaw = (Array.isArray(raw.children) ? raw.children : [])
  .filter((child) => isDemoChildId(child?.id))
  .map((child) => normalizeDemoChild(child));
const progressReportsRaw = filterByDemoChild(raw.progressReports).map((entry) => ({
  ...entry,
  therapistId: remapDemoTherapistId(entry?.therapistId),
}));
const nextSessionsRaw = filterByDemoChild(raw.nextSessions).map((entry) => ({
  ...entry,
  therapistId: remapDemoTherapistId(entry?.therapistId),
}));
const moodScoresRaw = filterByDemoChild(raw.moodScores);
const sessionSummariesRaw = filterByDemoChild(raw.sessionSummaries).map((entry) => ({
  ...entry,
  therapistId: remapDemoTherapistId(entry?.therapistId),
}));
const activeSessionStatesRaw = filterByDemoChild(raw.activeSessionStates).map((entry) => ({
  ...entry,
  therapistId: remapDemoTherapistId(entry?.therapistId),
}));
const timeChangeProposalsRaw = filterByDemoChild(raw.timeChangeProposals);
const urgentMemosRaw = (Array.isArray(raw.urgentMemos) ? raw.urgentMemos : []).filter((memo) => {
  const childId = getEntryChildId(memo);
  return !childId || isDemoChildId(childId);
});
const exportJobsRaw = Array.isArray(raw.exportJobs) ? raw.exportJobs : [];
const auditLogsRaw = Array.isArray(raw.auditLogs) ? raw.auditLogs : [];
const dashboardMetricsRaw = {
  ...(raw.dashboardMetrics && typeof raw.dashboardMetrics === 'object' ? raw.dashboardMetrics : {}),
  sessionsToday: 2,
  cancellationsToday: 0,
  incidentsToday: 0,
  overdueDocumentation: 0,
  authorizationRiskCount: 0,
};
const insurancePlansRaw = filterByDemoChild(raw.insurancePlans);
const authorizationsRaw = filterByDemoChild(raw.authorizations);
const invoicesRaw = filterByDemoChild(raw.invoices);
const postsRaw = (Array.isArray(raw.posts) ? raw.posts : []).filter((item) => {
  const childId = getEntryChildId(item);
  if (childId) return isDemoChildId(childId);
  const authorId = String(item?.authorId || item?.therapistId || item?.createdBy || '').trim();
  return !authorId || DEMO_THREAD_PARTICIPANT_ID_SET.has(authorId);
});
const parentResourcesRaw = Array.isArray(raw.parentResources) ? raw.parentResources : [];
const programDocumentsRaw = Array.isArray(raw.programDocuments) ? raw.programDocuments : [];
const campusDocumentsRaw = Array.isArray(raw.campusDocuments) ? raw.campusDocuments : [];
const itemsNeededRaw = filterByDemoChild(raw.itemsNeeded);
const attendanceRaw = filterByDemoChild(raw.attendance);
const arrivalPingsRaw = filterByDemoChild(raw.arrivalPings);
const pickupQueueRaw = filterByDemoChild(raw.pickupQueue);
const tapEventsRaw = filterByDemoChild(raw.tapEvents);
const skillAcquisitionDataRaw = filterByDemoChild(raw.skillAcquisitionData);
const behaviorTrackingDataRaw = filterByDemoChild(raw.behaviorTrackingData);
const messageThreadsRaw = filterDemoThreads(raw.messageThreads);

const usersById = new Map(usersRaw.map((user) => [String(user?.id || ''), user]));
const usersByEmail = new Map(usersRaw.map((user) => [normalizeLookup(user?.email), user]).filter(([key]) => key));
const usersByName = new Map(usersRaw.map((user) => [normalizeLookup(user?.name), user]).filter(([key]) => key));

function findLinkedUser(entity) {
  if (!entity || typeof entity !== 'object') return null;
  const explicitId = String(entity.userId || entity.id || '').trim();
  const emailKey = normalizeLookup(entity.email);
  const nameKey = normalizeLookup(entity.name);
  if (explicitId && usersById.has(explicitId)) return usersById.get(explicitId) || null;
  if (emailKey && usersByEmail.has(emailKey)) return usersByEmail.get(emailKey) || null;
  if (nameKey && usersByName.has(nameKey)) return usersByName.get(nameKey) || null;
  return null;
}

function buildDirectoryEntity(entity, options = {}) {
  const linkedUser = findLinkedUser(entity);
  const id = String(entity?.id || linkedUser?.id || '').trim();
  const userId = String(entity?.userId || linkedUser?.id || '').trim();
  const fullName = String(entity?.name || linkedUser?.name || '').trim();
  const { firstName, lastName } = splitName(fullName);
  return {
    id,
    userId,
    firstName,
    lastName,
    name: fullName,
    role: normalizeRoleName(entity?.role || linkedUser?.role, options.fallbackRole || ''),
    title: String(entity?.title || '').trim(),
    phone: String(entity?.phone || '').trim(),
    email: String(entity?.email || linkedUser?.email || '').trim(),
    avatar: buildAvatar(id || userId || fullName, entity?.avatar, options.avatarSize || 80),
    supervisedBy: String(entity?.supervisedBy || '').trim(),
    organizationId: String(organization?.id || '').trim(),
    organizationName: String(organization?.name || '').trim(),
    programIds: firstProgram?.id ? [String(firstProgram.id)] : [],
    campusIds: firstCampus?.id ? [String(firstCampus.id)] : [],
  };
}

const seededScreenshotParents = parentsRaw.map((parent) => ({
  ...buildDirectoryEntity(parent, { fallbackRole: 'parent', avatarSize: 100 }),
  childIds: Array.isArray(parent?.childIds) ? parent.childIds.map((id) => String(id)) : [],
}));

const therapistEntities = therapistsRaw.map((therapist) => buildDirectoryEntity(therapist, { fallbackRole: 'therapist', avatarSize: 80 }));
const staffEntities = staffRaw.map((staff) => buildDirectoryEntity(staff, { fallbackRole: 'staff', avatarSize: 80 }));
const reviewUserEntities = usersRaw
  .filter((user) => normalizeRoleName(user?.role, '').toLowerCase() !== 'parent')
  .map((user) => buildDirectoryEntity(user, { fallbackRole: 'staff', avatarSize: 80 }));

const seededScreenshotStaff = dedupeByKey(
  [...therapistEntities, ...staffEntities, ...reviewUserEntities],
  (entry) => String(entry?.id || entry?.userId || entry?.email || entry?.name || '').trim().toLowerCase()
);

const complianceDocumentTemplates = dedupeByKey(
  [...programDocumentsRaw, ...campusDocumentsRaw],
  (entry, index) => String(entry?.id || entry?.url || `compliance-doc-${index + 1}`).trim().toLowerCase()
).map((entry, index) => ({
  id: String(entry?.id || `compliance-doc-${index + 1}`),
  title: String(entry?.title || 'Compliance document').trim(),
  url: String(entry?.url || DEFAULT_RESOURCE_URL).trim(),
  uploadedAt: normalizeIso(entry?.updatedAt, entry?.createdAt || '') || '',
  mimeType: String(entry?.mimeType || 'application/pdf').trim(),
}));

const seededScreenshotStaffWorkspacesById = seededScreenshotStaff.reduce((accumulator, staff, index) => {
  const expirationPool = ['2026-05-12', '2026-05-28', '2026-06-18', '2026-07-22'];
  const expiration = expirationPool[index % expirationPool.length];
  const docs = complianceDocumentTemplates.length
    ? [
        complianceDocumentTemplates[index % complianceDocumentTemplates.length],
        complianceDocumentTemplates[(index + 1) % complianceDocumentTemplates.length],
      ].map((item, docIndex) => ({
        ...clone(item),
        id: `${staff.id}-doc-${docIndex + 1}`,
      }))
    : [];

  accumulator[staff.id] = {
    id: staff.id,
    credentials: {
      certificationExpiration: `${expiration}T17:00:00`,
      certificationType: String(staff?.role || 'staff').trim(),
      lastReviewedAt: normalizeIso('2026-04-25T09:00:00', '') || '',
    },
    availability: {
      status: index % 2 === 0 ? 'assigned' : 'available',
    },
    documents: docs,
    updatedAt: normalizeIso('2026-05-01T08:00:00', '') || '',
    createdAt: normalizeIso('2026-04-20T08:00:00', '') || '',
  };
  return accumulator;
}, {});

const peopleByAnyId = new Map();
function registerPerson(entity) {
  if (!entity) return;
  [entity.id, entity.userId, entity.email].forEach((value) => {
    const key = normalizeLookup(value);
    if (key && !peopleByAnyId.has(key)) peopleByAnyId.set(key, entity);
  });
  const nameKey = normalizeLookup(entity.name);
  if (nameKey && !peopleByAnyId.has(nameKey)) peopleByAnyId.set(nameKey, entity);
}
seededScreenshotParents.forEach(registerPerson);
seededScreenshotStaff.forEach(registerPerson);

function toParticipant(idOrEntity) {
  if (idOrEntity && typeof idOrEntity === 'object') {
    const existing = peopleByAnyId.get(normalizeLookup(idOrEntity.id || idOrEntity.userId || idOrEntity.email || idOrEntity.name));
    if (existing) return { id: existing.id, name: existing.name, email: existing.email || '', role: existing.role || '', avatar: existing.avatar || null };
  }
  const key = normalizeLookup(typeof idOrEntity === 'object' ? (idOrEntity?.id || idOrEntity?.userId || idOrEntity?.email || idOrEntity?.name) : idOrEntity);
  const entity = peopleByAnyId.get(key);
  if (entity) return { id: entity.id, name: entity.name, email: entity.email || '', role: entity.role || '', avatar: entity.avatar || null };
  const user = usersById.get(String(idOrEntity || '').trim()) || usersByEmail.get(key) || usersByName.get(key);
  if (user) {
    return {
      id: String(user?.id || '').trim(),
      name: String(user?.name || '').trim(),
      email: String(user?.email || '').trim(),
      role: normalizeRoleName(user?.role, ''),
      avatar: buildAvatar(user?.id || user?.email || user?.name, '', 80),
    };
  }
  return {
    id: String(idOrEntity || '').trim(),
    name: String(idOrEntity || '').trim(),
    email: '',
    role: '',
    avatar: null,
  };
}

const latestProgressByChildId = pickLatestByChild(progressReportsRaw, ['date', 'createdAt', 'updatedAt']);
const latestInsurancePlanByChildId = pickLatestByChild(insurancePlansRaw, ['updatedAt', 'createdAt', 'effectiveDate']);
const latestAuthorizationByChildId = pickLatestByChild(authorizationsRaw, ['updatedAt', 'createdAt', 'expirationDate']);
const latestInvoiceByChildId = pickLatestByChild(invoicesRaw, ['updatedAt', 'createdAt', 'dueDate']);
const latestAttendanceByChildId = pickLatestByChild(attendanceRaw, ['checkInAt', 'date', 'createdAt', 'updatedAt']);
const latestArrivalByChildId = pickLatestByChild(arrivalPingsRaw, ['createdAt', 'updatedAt']);
const latestPickupQueueByChildId = pickLatestByChild(pickupQueueRaw, ['confirmedAt', 'queuedAt', 'createdAt', 'updatedAt']);

const latestMoodByChildId = new Map();
moodScoresRaw.forEach((entry) => {
  const childId = getEntryChildId(entry);
  const scores = Array.isArray(entry?.scores) ? entry.scores : [];
  const latestScore = scores.reduce((best, score) => {
    const bestTs = Date.parse(String(best?.date || ''));
    const scoreTs = Date.parse(String(score?.date || ''));
    if (!best) return score;
    if (Number.isFinite(scoreTs) && (!Number.isFinite(bestTs) || scoreTs >= bestTs)) return score;
    return best;
  }, null);
  if (childId && latestScore) latestMoodByChildId.set(childId, latestScore);
});

const seededScreenshotMoodHistoryByChild = moodScoresRaw.reduce((accumulator, entry, entryIndex) => {
  const childId = getEntryChildId(entry);
  if (!childId) return accumulator;
  const scores = Array.isArray(entry?.scores) ? entry.scores : [];
  accumulator[childId] = scores
    .map((score, scoreIndex) => ({
      id: String(score?.id || `${childId}-mood-${entryIndex + 1}-${scoreIndex + 1}`),
      childId,
      score: toNumber(score?.score, 0),
      recordedAt: normalizeIso(`${score?.date || ''}T12:00:00`, score?.date) || '',
      createdAt: normalizeIso(`${score?.date || ''}T12:00:00`, score?.date) || '',
    }))
    .filter((item) => item.recordedAt);
  return accumulator;
}, {});

const seededScreenshotAttendanceHistoryByChild = attendanceRaw.reduce((accumulator, item, index) => {
  const childId = getEntryChildId(item);
  if (!childId) return accumulator;
  if (!accumulator[childId]) accumulator[childId] = [];
  const recordedFor = String(item?.date || item?.recordedFor || '').trim();
  const checkInAt = normalizeIso(item?.checkInAt, recordedFor ? `${recordedFor}T09:00:00` : '');
  const checkOutAt = normalizeIso(item?.checkOutAt, recordedFor ? `${recordedFor}T15:00:00` : '');
  accumulator[childId].push({
    id: String(item?.id || `${childId}-attendance-${index + 1}`),
    childId,
    sessionId: String(item?.sessionId || '').trim(),
    recordedFor,
    recordedAt: checkInAt || normalizeIso(recordedFor, '') || '',
    dateKey: recordedFor,
    status: String(item?.status || '').trim().toLowerCase(),
    note: String(item?.note || '').trim(),
    checkInAt,
    checkOutAt,
    checkedInBy: String(item?.checkedInBy || '').trim(),
  });
  return accumulator;
}, {});

const seededScreenshotAttendanceByDate = attendanceRaw.reduce((accumulator, item, index) => {
  const dateKey = String(item?.date || item?.recordedFor || '').trim();
  if (!dateKey) return accumulator;
  if (!accumulator[dateKey]) accumulator[dateKey] = [];
  accumulator[dateKey].push({
    id: String(item?.id || `attendance-${index + 1}`),
    childId: getEntryChildId(item),
    sessionId: String(item?.sessionId || '').trim(),
    dateKey,
    recordedFor: dateKey,
    status: String(item?.status || '').trim().toLowerCase(),
    note: String(item?.note || '').trim(),
    checkInAt: normalizeIso(item?.checkInAt, ''),
    checkOutAt: normalizeIso(item?.checkOutAt, ''),
    checkedInBy: String(item?.checkedInBy || '').trim(),
  });
  return accumulator;
}, {});

const seededScreenshotArrivalPingsByChild = arrivalPingsRaw.reduce((accumulator, item, index) => {
  const childId = getEntryChildId(item);
  if (!childId) return accumulator;
  if (!accumulator[childId]) accumulator[childId] = [];
  accumulator[childId].push({
    id: String(item?.id || `${childId}-arrival-${index + 1}`),
    childId,
    parentId: String(item?.parentId || '').trim(),
    campusId: String(item?.campusId || '').trim(),
    distanceMeters: toNumber(item?.distanceMeters, null),
    method: String(item?.method || '').trim(),
    status: String(item?.status || '').trim(),
    createdAt: normalizeIso(item?.createdAt, '') || '',
  });
  return accumulator;
}, {});

const seededScreenshotPickupQueueByChild = pickupQueueRaw.reduce((accumulator, item, index) => {
  const childId = getEntryChildId(item);
  if (!childId) return accumulator;
  if (!accumulator[childId]) accumulator[childId] = [];
  const verifier = toParticipant(item?.verifiedBy || '');
  accumulator[childId].push({
    id: String(item?.id || `${childId}-pickup-${index + 1}`),
    childId,
    parentId: String(item?.parentId || '').trim(),
    pickupPerson: String(item?.pickupPerson || '').trim(),
    status: String(item?.status || '').trim(),
    arrivalPingId: String(item?.arrivalPingId || '').trim(),
    queuedAt: normalizeIso(item?.queuedAt, '') || '',
    confirmedAt: normalizeIso(item?.confirmedAt, '') || '',
    verifiedBy: String(item?.verifiedBy || '').trim(),
    verifiedByName: verifier?.name || '',
    reason: String(item?.reason || '').trim(),
  });
  return accumulator;
}, {});

Object.keys(seededScreenshotPickupQueueByChild).forEach((childId) => {
  seededScreenshotPickupQueueByChild[childId] = seededScreenshotPickupQueueByChild[childId]
    .sort((left, right) => {
      const leftTs = Date.parse(String(left?.confirmedAt || left?.queuedAt || ''));
      const rightTs = Date.parse(String(right?.confirmedAt || right?.queuedAt || ''));
      if (!Number.isFinite(leftTs) && !Number.isFinite(rightTs)) return 0;
      if (!Number.isFinite(leftTs)) return 1;
      if (!Number.isFinite(rightTs)) return -1;
      return rightTs - leftTs;
    });
});

const seededScreenshotTapEventsByChild = tapEventsRaw.reduce((accumulator, item, index) => {
  const childId = getEntryChildId(item);
  if (!childId) return accumulator;
  if (!accumulator[childId]) accumulator[childId] = [];
  accumulator[childId].push({
    feedId: String(item?.id || `${childId}-tap-${index + 1}`),
    sessionId: String(item?.sessionId || '').trim(),
    label: String(item?.label || item?.eventType || 'Tap event').trim(),
    detailLabel: String(item?.notes || item?.eventType || '').trim() || (item?.value != null ? `Count ${item.value}` : null),
    occurredAt: normalizeIso(item?.createdAt, '') || '',
    status: 'synced',
    eventType: String(item?.eventType || '').trim(),
    value: toNumber(item?.value, null),
  });
  return accumulator;
}, {});

Object.keys(seededScreenshotTapEventsByChild).forEach((childId) => {
  seededScreenshotTapEventsByChild[childId] = seededScreenshotTapEventsByChild[childId]
    .sort((left, right) => Date.parse(String(right?.occurredAt || '')) - Date.parse(String(left?.occurredAt || '')))
    .slice(0, 12);
});

const seededScreenshotItemsNeededByChild = itemsNeededRaw.reduce((accumulator, item, index) => {
  const childId = getEntryChildId(item);
  if (!childId) return accumulator;
  if (!accumulator[childId]) accumulator[childId] = [];
  const requester = toParticipant(item?.requestedBy || '');
  const parent = toParticipant(item?.parentId || '');
  accumulator[childId].push({
    id: String(item?.id || `${childId}-needed-${index + 1}`),
    childId,
    parentId: String(item?.parentId || '').trim(),
    parentName: parent?.name || '',
    category: String(item?.category || '').trim(),
    item: String(item?.item || '').trim(),
    status: String(item?.status || '').trim(),
    requestedBy: String(item?.requestedBy || '').trim(),
    requestedByName: requester?.name || '',
    requestedAt: normalizeIso(item?.requestedAt, '') || '',
    dueDate: String(item?.dueDate || '').trim(),
    resolvedAt: normalizeIso(item?.resolvedAt, '') || '',
  });
  return accumulator;
}, {});

const seededScreenshotSkillAcquisitionByChild = skillAcquisitionDataRaw.reduce((accumulator, item, index) => {
  const childId = getEntryChildId(item);
  if (!childId) return accumulator;
  if (!accumulator[childId]) accumulator[childId] = [];
  accumulator[childId].push({
    id: String(item?.id || `${childId}-skill-${index + 1}`),
    childId,
    goalId: String(item?.goalId || '').trim(),
    date: String(item?.date || '').trim(),
    trials: toNumber(item?.trials, 0),
    correct: toNumber(item?.correct, 0),
    prompted: toNumber(item?.prompted, 0),
    incorrect: toNumber(item?.incorrect, 0),
    masteryPercent: toNumber(item?.masteryPercent, 0),
    promptLevel: String(item?.promptLevel || '').trim(),
  });
  return accumulator;
}, {});

const seededScreenshotBehaviorTrackingByChild = behaviorTrackingDataRaw.reduce((accumulator, item, index) => {
  const childId = getEntryChildId(item);
  if (!childId) return accumulator;
  if (!accumulator[childId]) accumulator[childId] = [];
  accumulator[childId].push({
    id: String(item?.id || `${childId}-behavior-${index + 1}`),
    childId,
    date: String(item?.date || '').trim(),
    behavior: String(item?.behavior || '').trim(),
    frequency: toNumber(item?.frequency, 0),
    durationMinutes: toNumber(item?.durationMinutes, 0),
    intensity: String(item?.intensity || '').trim(),
    antecedent: String(item?.antecedent || '').trim(),
    consequence: String(item?.consequence || '').trim(),
    replacementBehavior: String(item?.replacementBehavior || '').trim(),
    response: String(item?.response || '').trim(),
  });
  return accumulator;
}, {});

const seededScreenshotDashboardMetrics = (() => {
  const attendanceTrend = Array.isArray(dashboardMetricsRaw?.attendanceTrend)
    ? dashboardMetricsRaw.attendanceTrend.map((item) => ({
        label: toShortDateLabel(item?.date),
        value: toNumber(item?.present, 0) || 0,
      }))
    : [];

  const behaviorTrend = Array.from(
    behaviorTrackingDataRaw.reduce((accumulator, item) => {
      const label = String(item?.behavior || '').trim();
      if (!label) return accumulator;
      const current = accumulator.get(label) || 0;
      accumulator.set(label, current + (toNumber(item?.frequency, 0) || 0));
      return accumulator;
    }, new Map()).entries()
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([label, value]) => ({ label: titleCaseWords(label), value }));

  return {
    sessionsToday: toNumber(dashboardMetricsRaw?.sessionsToday, 0) || 0,
    cancellationsToday: toNumber(dashboardMetricsRaw?.cancellationsToday, 0) || 0,
    incidentsToday: toNumber(dashboardMetricsRaw?.incidentsToday, 0) || 0,
    overdueDocumentation: toNumber(dashboardMetricsRaw?.overdueDocumentation, 0) || 0,
    authorizationRiskCount: toNumber(dashboardMetricsRaw?.authorizationRiskCount, 0) || 0,
    unreadUrgentMemoCount: toNumber(dashboardMetricsRaw?.unreadUrgentMemoCount, 0) || 0,
    exportFailureCount: toNumber(dashboardMetricsRaw?.exportFailureCount, 0) || 0,
    attendanceTrend,
    behaviorTrend,
  };
})();

const nextSessionByChildId = new Map();
nextSessionsRaw.forEach((session, index) => {
  const childId = getEntryChildId(session);
  if (!childId) return;
  const whenISO = normalizeIso(`${session?.date || ''}T${session?.time || '00:00'}:00`, session?.date);
  const current = nextSessionByChildId.get(childId);
  const currentTs = Date.parse(String(current?.whenISO || ''));
  const sessionTs = Date.parse(String(whenISO || ''));
  if (!current || (Number.isFinite(sessionTs) && (!Number.isFinite(currentTs) || sessionTs <= currentTs))) {
    nextSessionByChildId.set(childId, {
      id: String(session?.id || `${childId}-next-${index + 1}`),
      whenISO,
      title: String(session?.type || 'Next Session').trim() || 'Next Session',
      therapistId: String(session?.therapistId || '').trim(),
      time: String(session?.time || '').trim(),
      date: String(session?.date || '').trim(),
    });
  }
});

const latestSessionSummaryByChildId = pickLatestByChild(sessionSummariesRaw, ['generatedAt', 'approvedAt', 'updatedAt']);
const parentLinksByChildId = new Map();
seededScreenshotParents.forEach((parent) => {
  (Array.isArray(parent.childIds) ? parent.childIds : []).forEach((childId) => {
    pushToChildMap(parentLinksByChildId, String(childId), {
      id: parent.id,
      firstName: parent.firstName,
      lastName: parent.lastName,
      name: parent.name,
      avatar: parent.avatar,
      phone: parent.phone,
      email: parent.email,
    });
  });
});

const programDocsByChildId = new Map();
childrenRaw.forEach((child) => {
  const childId = String(child?.id || '').trim();
  if (!childId) return;
  const childDocs = Array.isArray(child?.programDocs) ? child.programDocs : [];
  const mergedDocs = [
    ...childDocs,
    ...programDocumentsRaw.filter((doc) => getEntryChildId(doc) === childId),
    ...campusDocumentsRaw,
  ];
  if (mergedDocs.length) {
    programDocsByChildId.set(childId, mergedDocs.map((doc, index) => ({
      id: String(doc?.id || `${childId}-doc-${index + 1}`),
      title: String(doc?.title || 'Document').trim(),
      url: String(doc?.url || DOWNLOAD_URL).trim(),
      type: String(doc?.type || 'pdf').trim(),
    })));
  }
});

function buildInsuranceSnapshot(child) {
  const childId = String(child?.id || '').trim();
  const plan = latestInsurancePlanByChildId.get(childId) || null;
  const authorization = latestAuthorizationByChildId.get(childId) || null;
  const invoice = latestInvoiceByChildId.get(childId) || null;
  return {
    planName: String(plan?.planName || plan?.provider || plan?.name || '').trim(),
    provider: String(plan?.provider || plan?.planName || plan?.name || '').trim(),
    memberId: String(plan?.memberId || plan?.subscriberId || '').trim(),
    groupNumber: String(plan?.groupNumber || plan?.groupId || '').trim(),
    groupId: String(plan?.groupId || plan?.groupNumber || '').trim(),
    subscriberName: String(plan?.subscriberName || child?.name || '').trim(),
    relationToSubscriber: String(plan?.relationToSubscriber || 'Self').trim(),
    effectiveDate: String(plan?.effectiveDate || '').trim(),
    expirationDate: String(authorization?.expirationDate || plan?.expirationDate || '').trim(),
    authorizationStatus: String(child?.insuranceStatus || authorization?.status || authorization?.authorizationStatus || 'pending review').trim(),
    approvedHours: toNumber(authorization?.approvedHours || authorization?.hoursApproved, null),
    remainingHours: toNumber(authorization?.remainingHours || authorization?.hoursRemaining, null),
    billingContact: String(plan?.billingContact || organization?.supportEmail || 'billing@communitybridge.app').trim(),
    contact: String(plan?.billingContact || organization?.supportEmail || 'billing@communitybridge.app').trim(),
    invoiceStatus: String(invoice?.status || '').trim(),
    amountDue: toNumber(invoice?.amountDue || invoice?.balance || invoice?.amount, 0),
    dueDate: String(invoice?.dueDate || '').trim(),
    timesheetStatus: String(invoice?.timesheetStatus || 'pending verification').trim(),
    parentSignatureStatus: String(invoice?.parentSignatureStatus || 'no signature on file').trim(),
    sessionStatus: String(invoice?.sessionStatus || 'pending verification').trim(),
  };
}

const seededScreenshotChildren = childrenRaw.map((child) => {
  const childId = String(child?.id || '').trim();
  const { firstName, lastName } = splitName(child?.name);
  const latestProgress = latestProgressByChildId.get(childId);
  const latestMood = latestMoodByChildId.get(childId);
  const latestAttendance = latestAttendanceByChildId.get(childId);
  const latestArrival = latestArrivalByChildId.get(childId);
  const latestPickupQueue = latestPickupQueueByChildId.get(childId);
  const nextSession = nextSessionByChildId.get(childId);
  const latestSummary = latestSessionSummaryByChildId.get(childId);
  const explicitParents = Array.isArray(child?.parents) ? child.parents.filter(Boolean) : [];
  const resolvedParents = explicitParents.length
    ? explicitParents.map((entry) => {
        const parent = toParticipant(entry?.id || entry?.email || entry?.name);
        return {
          id: parent.id,
          name: parent.name,
          avatar: parent.avatar,
          phone: String(entry?.phone || '').trim(),
          email: String(entry?.email || parent.email || '').trim(),
        };
      })
    : (parentLinksByChildId.get(childId) || []);
  const assignedABA = Array.isArray(child?.assignedABA)
    ? child.assignedABA.map((id) => String(id))
    : Array.isArray(child?.assigned_ABA)
      ? child.assigned_ABA.map((id) => String(id))
      : [];
  return {
    id: childId,
    organizationId: String(organization?.id || ''),
    organizationName: String(organization?.name || ''),
    programId: String(firstProgram?.id || ''),
    programName: String(firstProgram?.name || ''),
    campusId: String(firstCampus?.id || ''),
    campusName: String(firstCampus?.name || ''),
    enrollmentCode: String(firstCampus?.enrollmentCode || ''),
    firstName,
    lastName,
    name: String(child?.name || '').trim(),
    age: String(child?.age || '').trim(),
    room: String(child?.room || '').trim(),
    avatar: buildAvatar(childId, child?.avatar, 120),
    parents: resolvedParents,
    assignedABA,
    assigned_ABA: assignedABA,
    amTherapist: String(child?.amTherapist || '').trim(),
    pmTherapist: String(child?.pmTherapist || '').trim(),
    bcaTherapist: String(child?.bcaTherapist || child?.bcbaId || '').trim(),
    session: String(child?.session || '').trim(),
    dropoffTimeISO: normalizeIso(child?.dropoffTimeISO, ''),
    pickupTimeISO: normalizeIso(child?.pickupTimeISO, ''),
    notes: String(child?.notes || latestProgress?.summary || latestSummary?.summary?.dailyRecap?.therapistNarrative || '').trim(),
    carePlan: String(child?.carePlan || '').trim(),
    goalProgress: String(latestProgress?.summary || '').trim(),
    monthlyGoal: String(child?.monthlyGoal || latestSummary?.summary?.monthlyGoal?.description || '').trim(),
    successCriteria: String(child?.successCriteria || '').trim(),
    successCriteriaMet: Array.isArray(latestSummary?.summary?.successCriteriaMet) ? clone(latestSummary.summary.successCriteriaMet) : [],
    curriculum: String(child?.curriculum || '').trim(),
    programCurriculum: String(child?.curriculum || '').trim(),
    programsWorkedOn: Array.isArray(latestSummary?.summary?.programsWorkedOn) ? clone(latestSummary.summary.programsWorkedOn) : [],
    behaviorNotes: String(child?.behaviorNotes || '').trim(),
    attendanceStatus: String(child?.attendanceStatus || latestAttendance?.status || '').trim(),
    attendanceRecordedAt: normalizeIso(latestAttendance?.checkInAt, latestAttendance?.date || '') || '',
    arrivalStatus: String(child?.arrivalStatus || latestArrival?.status || '').trim(),
    arrivalMethod: String(latestArrival?.method || '').trim(),
    arrivalDistanceMeters: toNumber(latestArrival?.distanceMeters, null),
    latestArrivalAt: normalizeIso(latestArrival?.createdAt, '') || '',
    pickupQueueStatus: String(child?.pickupQueueStatus || latestPickupQueue?.status || '').trim(),
    pickupPerson: String(child?.pickupPerson || latestPickupQueue?.pickupPerson || '').trim(),
    pickupQueuedAt: normalizeIso(latestPickupQueue?.queuedAt, '') || '',
    pickupConfirmedAt: normalizeIso(latestPickupQueue?.confirmedAt, '') || '',
    pickupVerifiedBy: String(latestPickupQueue?.verifiedBy || '').trim(),
    pickupVerifiedByName: toParticipant(latestPickupQueue?.verifiedBy || '')?.name || '',
    pickupReason: String(child?.pickupReason || latestPickupQueue?.reason || '').trim(),
    insuranceStatus: String(child?.insuranceStatus || '').trim(),
    insurance: buildInsuranceSnapshot(child),
    programDocs: programDocsByChildId.get(childId) || parentResourcesRaw.map((resource, index) => ({
      id: String(resource?.id || `${childId}-resource-${index + 1}`),
      title: String(resource?.title || 'Resource').trim(),
      url: String(resource?.url || DEFAULT_RESOURCE_URL).trim(),
      type: 'link',
    })),
    moodScore: child?.moodScore != null ? toNumber(child.moodScore, null) : toNumber(latestMood?.score, null),
    mood: child?.mood != null ? toNumber(child.mood, null) : toNumber(latestMood?.score, null),
    nextSessionISO: nextSession?.whenISO || '',
    upcoming: nextSession ? [nextSession] : [],
  };
});

const seededScreenshotMessages = Object.values(messageThreadsRaw).flatMap((threads) => {
  if (!Array.isArray(threads)) return [];
  return threads.flatMap((thread, threadIndex) => {
    const participants = Array.isArray(thread?.participants) ? thread.participants.map((id) => String(id)) : [];
    const messages = Array.isArray(thread?.messages) ? thread.messages : [];
    return messages.map((message, index) => {
      const senderId = String(message?.from || '').trim();
      return {
        id: `${String(thread?.threadId || `thread-${threadIndex + 1}`)}-${index + 1}`,
        threadId: String(thread?.threadId || `thread-${threadIndex + 1}`),
        body: String(message?.text || message?.body || '').trim(),
        sender: toParticipant(senderId),
        to: participants.filter((participantId) => participantId !== senderId).map((participantId) => toParticipant(participantId)),
        createdAt: normalizeIso(message?.time, new Date().toISOString()) || new Date().toISOString(),
      };
    });
  });
});

const seededScreenshotUrgentMemos = urgentMemosRaw.map((memo, index) => ({
  id: String(memo?.id || `memo-${index + 1}`),
  type: String(memo?.type || 'admin_memo').trim(),
  title: String(memo?.title || memo?.subject || '').trim(),
  subject: String(memo?.title || memo?.subject || '').trim(),
  body: String(memo?.message || memo?.body || memo?.note || '').trim(),
  message: String(memo?.message || memo?.body || memo?.note || '').trim(),
  note: String(memo?.note || memo?.message || '').trim(),
  childId: getEntryChildId(memo),
  updateType: String(memo?.updateType || '').trim(),
  proposedISO: String(memo?.proposedISO || '').trim(),
  priority: String(memo?.priority || 'normal').trim(),
  recipients: [...seededScreenshotParents, ...seededScreenshotStaff].map((entry) => ({ id: entry.id, name: entry.name })),
  recipientIds: [...seededScreenshotParents, ...seededScreenshotStaff].map((entry) => entry.id),
  proposerId: String(memo?.proposerId || memo?.createdBy || '').trim(),
  status: String(memo?.status || 'pending').trim(),
  time: normalizeIso(memo?.time, memo?.createdAt || new Date().toISOString()) || new Date().toISOString(),
  createdAt: normalizeIso(memo?.createdAt, memo?.time || new Date().toISOString()) || new Date().toISOString(),
}));

const seededScreenshotPosts = (postsRaw.length ? postsRaw : progressReportsRaw).map((item, index) => {
  const childId = getEntryChildId(item);
  const child = seededScreenshotChildren.find((entry) => entry.id === childId) || null;
  const author = toParticipant(item?.authorId || item?.therapistId || item?.createdBy || '');
  return {
    id: String(item?.id || `${childId || 'post'}-${index + 1}`),
    title: String(item?.title || (child?.name ? `${child.name} Update` : 'Progress Update')).trim(),
    body: String(item?.body || item?.summary || item?.content || '').trim(),
    author,
    createdAt: normalizeIso(item?.createdAt, item?.date || new Date().toISOString()) || new Date().toISOString(),
    likes: toNumber(item?.likes, 0),
    shares: toNumber(item?.shares, 0),
    comments: Array.isArray(item?.comments) ? clone(item.comments) : [],
  };
});

const seededScreenshotTimeChangeProposals = timeChangeProposalsRaw.map((proposal, index) => ({
  id: String(proposal?.id || `proposal-${index + 1}`),
  childId: getEntryChildId(proposal),
  type: String(proposal?.type || '').trim(),
  proposedISO: String(proposal?.proposedISO || '').trim(),
  note: String(proposal?.note || '').trim(),
  proposerId: String(proposal?.proposerId || '').trim(),
  scope: String(proposal?.scope || 'temporary').trim(),
  status: String(proposal?.status || 'pending').trim(),
  createdAt: normalizeIso(proposal?.createdAt, new Date().toISOString()) || new Date().toISOString(),
}));

const seededScreenshotSessionSummaries = sessionSummariesRaw
  .map((item, index) => ({
    id: String(item?.id || `summary-${index + 1}`),
    sessionId: String(item?.sessionId || `${getEntryChildId(item) || 'child'}-session-${index + 1}`),
    childId: getEntryChildId(item),
    therapistId: String(item?.therapistId || '').trim(),
    status: String(item?.status || 'draft').trim(),
    generatedAt: normalizeIso(item?.generatedAt, item?.approvedAt || new Date().toISOString()) || new Date().toISOString(),
    approvedAt: normalizeIso(item?.approvedAt, item?.generatedAt || '') || '',
    updatedAt: normalizeIso(item?.updatedAt, item?.approvedAt || item?.generatedAt || new Date().toISOString()) || new Date().toISOString(),
    summary: item?.summary && typeof item.summary === 'object' ? clone(item.summary) : {},
    summaryText: String(item?.summary?.dailyRecap?.therapistNarrative || '').trim(),
  }))
  .filter((item) => item.childId);

const seededScreenshotOrgSettings = {
  id: String(raw?.orgSettings?.id || organization?.id || 'org-demo-001').trim(),
  name: String(raw?.orgSettings?.appName || organization?.name || 'CommunityBridge Therapy Center').trim(),
  supportEmail: String(raw?.orgSettings?.supportEmail || organization?.supportEmail || 'support@communitybridge.app').trim(),
  privacyUrl: String(raw?.orgSettings?.privacyUrl || '').trim(),
  termsUrl: String(raw?.orgSettings?.termsUrl || '').trim(),
  billing: {
    paymentPortalUrl: String(raw?.orgSettings?.website || organization?.website || SUPPORT_URL).trim(),
    contactEmail: String(raw?.orgSettings?.supportEmail || organization?.supportEmail || 'billing@communitybridge.app').trim(),
    contactPhone: String(organization?.supportPhone || '(317) 555-6000').trim(),
    showContactEmail: true,
    showContactPhone: true,
  },
};

const seededScreenshotExportJobs = exportJobsRaw.map((job, index) => ({
  id: String(job?.id || `export-${index + 1}`),
  title: String(job?.title || 'Export Job').trim(),
  category: String(job?.category || 'reports').trim(),
  format: String(job?.format || 'csv').trim(),
  status: String(job?.status || 'queued').trim(),
  recordsCount: toNumber(job?.recordsCount, 0),
  artifactUrl: String(job?.artifactUrl || '').trim(),
  summary: String(job?.summary || '').trim(),
  createdAt: normalizeIso(job?.createdAt, new Date().toISOString()) || new Date().toISOString(),
}));

const seededScreenshotAuditLogs = auditLogsRaw.map((item, index) => ({
  id: String(item?.id || `audit-${index + 1}`),
  action: String(item?.action || 'audit.event').trim(),
  summary: String(item?.summary || '').trim(),
  createdAt: normalizeIso(item?.createdAt, new Date().toISOString()) || new Date().toISOString(),
}));

const seededScreenshotTherapistDocumentationInsights = (() => {
  const childNameById = new Map(seededScreenshotChildren.map((child) => [child.id, child.name || 'Learner']));
  const items = activeSessionStatesRaw
    .map((item, index) => {
      const childId = getEntryChildId(item);
      const status = String(item?.status || '').trim().toLowerCase();
      const dateSource = item?.submittedAt || item?.pausedAt || item?.startedAt || '';
      return {
        id: String(item?.id || `doc-state-${index + 1}`),
        sessionId: String(item?.sessionId || '').trim(),
        childId,
        childName: childNameById.get(childId) || 'Learner',
        status,
        statusLabel: titleCaseWords(status || 'needs review'),
        sessionDateLabel: toShortDateLabel(dateSource),
      };
    })
    .filter((item) => item.childId);

  const approvedCount = items.filter((item) => item.status === 'approved').length;
  const generatedCount = sessionSummariesRaw.length || items.filter((item) => ['submitted', 'approved', 'rejected'].includes(item.status)).length;

  return {
    stats: {
      sessionsEnded: items.length,
      summariesGenerated: generatedCount,
      summariesApproved: approvedCount,
      overdueSummaries: toNumber(dashboardMetricsRaw?.overdueDocumentation, 0) || items.filter((item) => ['active', 'paused'].includes(item.status)).length,
    },
    items,
  };
})();

const seededScreenshotOrganizationInsights = (() => {
  const childById = new Map(seededScreenshotChildren.map((child) => [child.id, child]));
  const summaries = seededScreenshotSessionSummaries;
  const approvedSummaries = summaries.filter((item) => String(item?.status || '').trim().toLowerCase() === 'approved');
  const sessionsByCampus = new Map();
  const sessionsByProgram = new Map();

  summaries.forEach((summary) => {
    const child = childById.get(String(summary?.childId || '').trim());
    if (!child) return;

    const campusKey = String(child?.campusId || child?.campusName || '').trim() || 'campus-unknown';
    const programKey = String(child?.programId || child?.programName || '').trim() || 'program-unknown';
    const normalizedStatus = String(summary?.status || '').trim().toLowerCase();
    const normalizedSummary = summary?.summary && typeof summary.summary === 'object' ? summary.summary : {};
    const moodValue = toNumber(normalizedSummary?.moodScore?.selectedValue, null);
    const behaviorEvents = Array.isArray(normalizedSummary?.interferingBehaviors)
      ? normalizedSummary.interferingBehaviors.reduce((sum, item) => sum + (toNumber(item?.frequency, 0) || 0), 0)
      : 0;

    const nextCampus = sessionsByCampus.get(campusKey) || {
      id: campusKey,
      name: String(child?.campusName || 'Campus').trim(),
      sessions: 0,
      approvedSummaries: 0,
      moodValues: [],
      behaviorEvents: 0,
    };
    nextCampus.sessions += 1;
    if (normalizedStatus === 'approved') nextCampus.approvedSummaries += 1;
    if (Number.isFinite(moodValue)) nextCampus.moodValues.push(moodValue);
    nextCampus.behaviorEvents += behaviorEvents;
    sessionsByCampus.set(campusKey, nextCampus);

    const nextProgram = sessionsByProgram.get(programKey) || {
      id: programKey,
      title: String(child?.programName || 'Program').trim(),
      childIds: new Set(),
      approvedSummaries: 0,
      sessions: 0,
    };
    nextProgram.sessions += 1;
    nextProgram.childIds.add(child.id);
    if (normalizedStatus === 'approved') nextProgram.approvedSummaries += 1;
    sessionsByProgram.set(programKey, nextProgram);
  });

  return {
    stats: {
      activeChildren: seededScreenshotChildren.filter((child) => !child?.inactive).length,
      sessions: summaries.length,
      approvedSummaries: approvedSummaries.length,
      activeCampuses: sessionsByCampus.size,
    },
    campuses: Array.from(sessionsByCampus.values()).map((item) => ({
      id: item.id,
      name: item.name,
      sessions: item.sessions,
      approvedSummaries: item.approvedSummaries,
      averageMood: item.moodValues.length ? Math.round((item.moodValues.reduce((sum, value) => sum + value, 0) / item.moodValues.length) * 10) / 10 : null,
      behaviorEvents: item.behaviorEvents,
      approvalRateLabel: item.sessions ? `${Math.round((item.approvedSummaries / item.sessions) * 100)}%` : '0%',
    })),
    programs: Array.from(sessionsByProgram.values()).map((item) => ({
      id: item.id,
      title: item.title,
      statusLabel: `${item.approvedSummaries}/${item.sessions} approved • ${item.childIds.size} learners`,
    })),
  };
})();

module.exports = {
  seededScreenshotParents,
  seededScreenshotTherapists: seededScreenshotStaff,
  seededScreenshotStaffWorkspacesById,
  seededScreenshotChildren,
  seededScreenshotMoodHistoryByChild,
  seededScreenshotAttendanceByDate,
  seededScreenshotAttendanceHistoryByChild,
  seededScreenshotArrivalPingsByChild,
  seededScreenshotPickupQueueByChild,
  seededScreenshotTapEventsByChild,
  seededScreenshotItemsNeededByChild,
  seededScreenshotSkillAcquisitionByChild,
  seededScreenshotBehaviorTrackingByChild,
  seededScreenshotDashboardMetrics,
  seededScreenshotTherapistDocumentationInsights,
  seededScreenshotOrganizationInsights,
  seededScreenshotMessages,
  seededScreenshotPosts,
  seededScreenshotUrgentMemos,
  seededScreenshotTimeChangeProposals,
  seededScreenshotSessionSummaries,
  seededScreenshotOrgSettings,
  seededScreenshotExportJobs,
  seededScreenshotAuditLogs,
};
