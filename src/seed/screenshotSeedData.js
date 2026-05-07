const { DEFAULT_RESOURCE_URL, SUPPORT_URL, DOWNLOAD_URL } = require('../config/brand');
const raw = require('../../communitybridge_full_workflow_5_day_seed_balanced_aba.json');

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

const organization = raw.organization || {};
const firstProgram = (Array.isArray(raw.programs) ? raw.programs : [])[0] || {};
const firstCampus = (Array.isArray(raw.campuses) ? raw.campuses : [])[0] || {};
const usersRaw = Array.isArray(raw.users) ? raw.users : [];
const parentsRaw = Array.isArray(raw.parents) ? raw.parents : [];
const therapistsRaw = Array.isArray(raw.therapists) ? raw.therapists : [];
const staffRaw = Array.isArray(raw.staff) ? raw.staff : [];
const childrenRaw = Array.isArray(raw.children) ? raw.children : [];
const progressReportsRaw = Array.isArray(raw.progressReports) ? raw.progressReports : [];
const nextSessionsRaw = Array.isArray(raw.nextSessions) ? raw.nextSessions : [];
const moodScoresRaw = Array.isArray(raw.moodScores) ? raw.moodScores : [];
const sessionSummariesRaw = Array.isArray(raw.sessionSummaries) ? raw.sessionSummaries : [];
const timeChangeProposalsRaw = Array.isArray(raw.timeChangeProposals) ? raw.timeChangeProposals : [];
const urgentMemosRaw = Array.isArray(raw.urgentMemos) ? raw.urgentMemos : [];
const exportJobsRaw = Array.isArray(raw.exportJobs) ? raw.exportJobs : [];
const auditLogsRaw = Array.isArray(raw.auditLogs) ? raw.auditLogs : [];
const insurancePlansRaw = Array.isArray(raw.insurancePlans) ? raw.insurancePlans : [];
const authorizationsRaw = Array.isArray(raw.authorizations) ? raw.authorizations : [];
const invoicesRaw = Array.isArray(raw.invoices) ? raw.invoices : [];
const postsRaw = Array.isArray(raw.posts) ? raw.posts : [];
const parentResourcesRaw = Array.isArray(raw.parentResources) ? raw.parentResources : [];
const programDocumentsRaw = Array.isArray(raw.programDocuments) ? raw.programDocuments : [];
const campusDocumentsRaw = Array.isArray(raw.campusDocuments) ? raw.campusDocuments : [];

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

const seededScreenshotMessages = Object.values(raw?.messageThreads || {}).flatMap((threads) => {
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

module.exports = {
  seededScreenshotParents,
  seededScreenshotTherapists: seededScreenshotStaff,
  seededScreenshotChildren,
  seededScreenshotMessages,
  seededScreenshotPosts,
  seededScreenshotUrgentMemos,
  seededScreenshotTimeChangeProposals,
  seededScreenshotSessionSummaries,
  seededScreenshotOrgSettings,
  seededScreenshotExportJobs,
  seededScreenshotAuditLogs,
};
