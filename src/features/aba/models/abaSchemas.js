export const ABA_TARGET_TYPES = Object.freeze(['behavior_reduction', 'skill_acquisition']);
export const ABA_TARGET_STATUSES = Object.freeze(['draft', 'active', 'mastered', 'on_hold', 'discontinued']);
export const ABA_MEASUREMENT_TYPES = Object.freeze([
  'frequency',
  'rate',
  'duration',
  'latency',
  'whole_interval',
  'partial_interval',
  'momentary_time_sampling',
  'abc',
  'percent_correct',
  'task_analysis',
]);
export const ABA_SESSION_STATES = Object.freeze(['not_started', 'in_progress', 'paused', 'completed', 'reviewed']);
export const ABA_ATTENDANCE_STATUSES = Object.freeze(['present', 'late', 'partial', 'cancelled', 'no_show']);
export const ABA_SKILL_TRIAL_OUTCOMES = Object.freeze(['correct', 'incorrect', 'no_response', 'prompted_correct', 'prompted_incorrect']);
export const ABA_INTERVAL_TYPES = Object.freeze(['whole_interval', 'partial_interval', 'momentary_time_sampling']);
export const ABA_REVIEW_DECISIONS = Object.freeze([
  'continue',
  'modify_prompting',
  'modify_reinforcement',
  'change_target',
  'move_to_maintenance',
  'discontinue',
  'collect_more_baseline',
]);
export const ABA_PHASE_TYPES = Object.freeze(['baseline', 'intervention', 'generalization', 'maintenance', 'probe', 'discontinued']);
export const ABA_PARENT_SUMMARY_STATUSES = Object.freeze(['draft', 'approved', 'sent']);

function asText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function asNullableText(value) {
  const next = asText(value, '');
  return next || null;
}

function asNumber(value, fallback = null) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value) {
  return asArray(value).map((item) => asText(item, '')).filter(Boolean);
}

function asIso(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'string') {
    const stamp = Date.parse(value);
    return Number.isFinite(stamp) ? new Date(stamp).toISOString() : fallback;
  }
  if (value instanceof Date) {
    const stamp = value.getTime();
    return Number.isFinite(stamp) ? value.toISOString() : fallback;
  }
  try {
    if (typeof value?.toDate === 'function') {
      const date = value.toDate();
      return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
    }
  } catch (_) {
    return fallback;
  }
  return fallback;
}

function asEnum(value, allowed, fallback) {
  const next = asText(value, '').toLowerCase();
  return allowed.includes(next) ? next : fallback;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stripUndefined(input) {
  return Object.entries(input || {}).reduce((accumulator, [key, value]) => {
    if (value !== undefined) accumulator[key] = value;
    return accumulator;
  }, {});
}

function withAuditFields(next, existing = {}) {
  return stripUndefined({
    ...next,
    id: asNullableText(next.id || existing.id),
    createdAt: asIso(next.createdAt || existing.createdAt),
    updatedAt: asIso(next.updatedAt || existing.updatedAt),
  });
}

export function buildBehaviorTargetDoc(input = {}, existing = {}) {
  const next = asObject(input);
  return withAuditFields({
    id: next.id || existing.id || null,
    childId: asText(next.childId ?? existing.childId),
    programId: asNullableText(next.programId ?? existing.programId),
    bcbaId: asText(next.bcbaId ?? existing.bcbaId),
    targetName: asText(next.targetName ?? existing.targetName),
    targetType: asEnum(next.targetType ?? existing.targetType, ABA_TARGET_TYPES, 'skill_acquisition'),
    status: asEnum(next.status ?? existing.status, ABA_TARGET_STATUSES, 'draft'),
    operationalDefinition: asText(next.operationalDefinition ?? existing.operationalDefinition),
    nonExamples: asNullableText(next.nonExamples ?? existing.nonExamples),
    examples: asNullableText(next.examples ?? existing.examples),
    measurementType: asEnum(next.measurementType ?? existing.measurementType, ABA_MEASUREMENT_TYPES, 'frequency'),
    responseClass: asNullableText(next.responseClass ?? existing.responseClass),
    unitLabel: asNullableText(next.unitLabel ?? existing.unitLabel),
    baselineSummary: asNullableText(next.baselineSummary ?? existing.baselineSummary),
    baselineMetric: asNumber(next.baselineMetric ?? existing.baselineMetric),
    masteryCriteria: asText(next.masteryCriteria ?? existing.masteryCriteria),
    reductionGoal: asNullableText(next.reductionGoal ?? existing.reductionGoal),
    acquisitionGoal: asNullableText(next.acquisitionGoal ?? existing.acquisitionGoal),
    promptHierarchy: asNullableText(next.promptHierarchy ?? existing.promptHierarchy),
    antecedentTags: asStringArray(next.antecedentTags ?? existing.antecedentTags),
    consequenceTags: asStringArray(next.consequenceTags ?? existing.consequenceTags),
    settingTags: asStringArray(next.settingTags ?? existing.settingTags),
    functionHypothesis: asNullableText(next.functionHypothesis ?? existing.functionHypothesis),
    graphPreference: asNullableText(next.graphPreference ?? existing.graphPreference),
    visibleToParent: asBoolean(next.visibleToParent ?? existing.visibleToParent, false),
    parentFriendlyLabel: asNullableText(next.parentFriendlyLabel ?? existing.parentFriendlyLabel),
    parentSummaryTemplate: asNullableText(next.parentSummaryTemplate ?? existing.parentSummaryTemplate),
    activeFrom: asIso(next.activeFrom ?? existing.activeFrom),
    activeUntil: asIso(next.activeUntil ?? existing.activeUntil),
    createdBy: asText(next.createdBy ?? existing.createdBy),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildSessionDataSheetDoc(input = {}, existing = {}) {
  const next = asObject(input);
  return withAuditFields({
    id: next.id || existing.id || null,
    sessionId: asText(next.sessionId ?? existing.sessionId),
    childId: asText(next.childId ?? existing.childId),
    therapistId: asText(next.therapistId ?? existing.therapistId),
    bcbaId: asNullableText(next.bcbaId ?? existing.bcbaId),
    date: asText(next.date ?? existing.date),
    sessionBlock: asText(next.sessionBlock ?? existing.sessionBlock),
    startAt: asIso(next.startAt ?? existing.startAt),
    endAt: asIso(next.endAt ?? existing.endAt),
    setting: asText(next.setting ?? existing.setting),
    room: asNullableText(next.room ?? existing.room),
    sessionState: asEnum(next.sessionState ?? existing.sessionState, ABA_SESSION_STATES, 'not_started'),
    attendanceStatus: asEnum(next.attendanceStatus ?? existing.attendanceStatus, ABA_ATTENDANCE_STATUSES, 'present'),
    therapistSessionNotes: asNullableText(next.therapistSessionNotes ?? existing.therapistSessionNotes),
    parentSafeSessionNotes: asNullableText(next.parentSafeSessionNotes ?? existing.parentSafeSessionNotes),
    environmentalNotes: asNullableText(next.environmentalNotes ?? existing.environmentalNotes),
    targetIds: asStringArray(next.targetIds ?? existing.targetIds),
    quickStats: asObject(next.quickStats ?? existing.quickStats),
    completedBy: asNullableText(next.completedBy ?? existing.completedBy),
    completedAt: asIso(next.completedAt ?? existing.completedAt),
    reviewedBy: asNullableText(next.reviewedBy ?? existing.reviewedBy),
    reviewedAt: asIso(next.reviewedAt ?? existing.reviewedAt),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildBehaviorEventDoc(input = {}, existing = {}) {
  const next = asObject(input);
  return withAuditFields({
    id: next.id || existing.id || null,
    sessionDataSheetId: asText(next.sessionDataSheetId ?? existing.sessionDataSheetId),
    sessionId: asText(next.sessionId ?? existing.sessionId),
    childId: asText(next.childId ?? existing.childId),
    targetId: asText(next.targetId ?? existing.targetId),
    observedAt: asIso(next.observedAt ?? existing.observedAt),
    recordedBy: asText(next.recordedBy ?? existing.recordedBy),
    count: asNumber(next.count ?? existing.count, 1),
    intensity: asNullableText(next.intensity ?? existing.intensity),
    magnitudeNote: asNullableText(next.magnitudeNote ?? existing.magnitudeNote),
    locationTag: asNullableText(next.locationTag ?? existing.locationTag),
    settingEventTag: asNullableText(next.settingEventTag ?? existing.settingEventTag),
    promptLevelAtOccurrence: asNullableText(next.promptLevelAtOccurrence ?? existing.promptLevelAtOccurrence),
    note: asNullableText(next.note ?? existing.note),
    isDeleted: asBoolean(next.isDeleted ?? existing.isDeleted, false),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildAbcObservationDoc(input = {}, existing = {}) {
  const next = asObject(input);
  const antecedent = asObject(next.antecedent ?? existing.antecedent);
  const behavior = asObject(next.behavior ?? existing.behavior);
  const consequence = asObject(next.consequence ?? existing.consequence);
  return withAuditFields({
    id: next.id || existing.id || null,
    sessionDataSheetId: asText(next.sessionDataSheetId ?? existing.sessionDataSheetId),
    sessionId: asText(next.sessionId ?? existing.sessionId),
    childId: asText(next.childId ?? existing.childId),
    targetId: asNullableText(next.targetId ?? existing.targetId),
    recordedBy: asText(next.recordedBy ?? existing.recordedBy),
    observedAt: asIso(next.observedAt ?? existing.observedAt),
    antecedent: {
      tag: asNullableText(antecedent.tag),
      narrative: asText(antecedent.narrative),
      peoplePresent: asStringArray(antecedent.peoplePresent),
      location: asNullableText(antecedent.location),
    },
    behavior: {
      topography: asText(behavior.topography),
      intensity: asNullableText(behavior.intensity),
      durationSeconds: asNumber(behavior.durationSeconds),
      count: asNumber(behavior.count),
      safetyRisk: asBoolean(behavior.safetyRisk, false),
    },
    consequence: {
      tag: asNullableText(consequence.tag),
      narrative: asText(consequence.narrative),
      staffResponse: asNullableText(consequence.staffResponse),
    },
    perceivedFunction: asNullableText(next.perceivedFunction ?? existing.perceivedFunction),
    followUpRequired: asBoolean(next.followUpRequired ?? existing.followUpRequired, false),
    note: asNullableText(next.note ?? existing.note),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildSkillTrialDoc(input = {}, existing = {}) {
  const next = asObject(input);
  return withAuditFields({
    id: next.id || existing.id || null,
    sessionDataSheetId: asText(next.sessionDataSheetId ?? existing.sessionDataSheetId),
    sessionId: asText(next.sessionId ?? existing.sessionId),
    childId: asText(next.childId ?? existing.childId),
    targetId: asText(next.targetId ?? existing.targetId),
    recordedBy: asText(next.recordedBy ?? existing.recordedBy),
    trialNumber: asNumber(next.trialNumber ?? existing.trialNumber, 1),
    observedAt: asIso(next.observedAt ?? existing.observedAt),
    antecedentPresented: asNullableText(next.antecedentPresented ?? existing.antecedentPresented),
    learnerResponse: asNullableText(next.learnerResponse ?? existing.learnerResponse),
    outcome: asEnum(next.outcome ?? existing.outcome, ABA_SKILL_TRIAL_OUTCOMES, 'correct'),
    promptLevel: asNullableText(next.promptLevel ?? existing.promptLevel),
    latencyMs: asNumber(next.latencyMs ?? existing.latencyMs),
    reinforcementDelivered: asNullableText(next.reinforcementDelivered ?? existing.reinforcementDelivered),
    errorCorrectionUsed: asNullableText(next.errorCorrectionUsed ?? existing.errorCorrectionUsed),
    note: asNullableText(next.note ?? existing.note),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildIntervalSampleDoc(input = {}, existing = {}) {
  const next = asObject(input);
  return withAuditFields({
    id: next.id || existing.id || null,
    sessionDataSheetId: asText(next.sessionDataSheetId ?? existing.sessionDataSheetId),
    sessionId: asText(next.sessionId ?? existing.sessionId),
    childId: asText(next.childId ?? existing.childId),
    targetId: asText(next.targetId ?? existing.targetId),
    recordedBy: asText(next.recordedBy ?? existing.recordedBy),
    intervalType: asEnum(next.intervalType ?? existing.intervalType, ABA_INTERVAL_TYPES, 'whole_interval'),
    intervalIndex: asNumber(next.intervalIndex ?? existing.intervalIndex, 0),
    intervalStartAt: asIso(next.intervalStartAt ?? existing.intervalStartAt),
    intervalEndAt: asIso(next.intervalEndAt ?? existing.intervalEndAt),
    observed: asBoolean(next.observed ?? existing.observed, false),
    note: asNullableText(next.note ?? existing.note),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildDurationTimerDoc(input = {}, existing = {}) {
  const next = asObject(input);
  return withAuditFields({
    id: next.id || existing.id || null,
    sessionDataSheetId: asText(next.sessionDataSheetId ?? existing.sessionDataSheetId),
    sessionId: asText(next.sessionId ?? existing.sessionId),
    childId: asText(next.childId ?? existing.childId),
    targetId: asText(next.targetId ?? existing.targetId),
    recordedBy: asText(next.recordedBy ?? existing.recordedBy),
    startedAt: asIso(next.startedAt ?? existing.startedAt),
    stoppedAt: asIso(next.stoppedAt ?? existing.stoppedAt),
    durationSeconds: asNumber(next.durationSeconds ?? existing.durationSeconds),
    completed: asBoolean(next.completed ?? existing.completed, false),
    note: asNullableText(next.note ?? existing.note),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildLatencyRecordDoc(input = {}, existing = {}) {
  const next = asObject(input);
  return withAuditFields({
    id: next.id || existing.id || null,
    sessionDataSheetId: asText(next.sessionDataSheetId ?? existing.sessionDataSheetId),
    sessionId: asText(next.sessionId ?? existing.sessionId),
    childId: asText(next.childId ?? existing.childId),
    targetId: asText(next.targetId ?? existing.targetId),
    recordedBy: asText(next.recordedBy ?? existing.recordedBy),
    cueAt: asIso(next.cueAt ?? existing.cueAt),
    responseAt: asIso(next.responseAt ?? existing.responseAt),
    latencyMs: asNumber(next.latencyMs ?? existing.latencyMs),
    cueDescription: asNullableText(next.cueDescription ?? existing.cueDescription),
    responseDescription: asNullableText(next.responseDescription ?? existing.responseDescription),
    completed: asBoolean(next.completed ?? existing.completed, false),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildTargetReviewDoc(input = {}, existing = {}) {
  const next = asObject(input);
  const reviewWindow = asObject(next.reviewWindow ?? existing.reviewWindow);
  return withAuditFields({
    id: next.id || existing.id || null,
    childId: asText(next.childId ?? existing.childId),
    targetId: asText(next.targetId ?? existing.targetId),
    bcbaId: asText(next.bcbaId ?? existing.bcbaId),
    reviewDate: asIso(next.reviewDate ?? existing.reviewDate),
    reviewWindow: {
      startDate: asIso(reviewWindow.startDate),
      endDate: asIso(reviewWindow.endDate),
    },
    trendSummary: asText(next.trendSummary ?? existing.trendSummary),
    dataQualitySummary: asNullableText(next.dataQualitySummary ?? existing.dataQualitySummary),
    interpretation: asText(next.interpretation ?? existing.interpretation),
    decision: asEnum(next.decision ?? existing.decision, ABA_REVIEW_DECISIONS, 'continue'),
    actionItems: asStringArray(next.actionItems ?? existing.actionItems),
    parentSafeSummary: asNullableText(next.parentSafeSummary ?? existing.parentSafeSummary),
    nextReviewDate: asIso(next.nextReviewDate ?? existing.nextReviewDate),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildSupervisionCheckDoc(input = {}, existing = {}) {
  const next = asObject(input);
  return withAuditFields({
    id: next.id || existing.id || null,
    childId: asText(next.childId ?? existing.childId),
    therapistId: asText(next.therapistId ?? existing.therapistId),
    bcbaId: asText(next.bcbaId ?? existing.bcbaId),
    sessionId: asNullableText(next.sessionId ?? existing.sessionId),
    protocolName: asText(next.protocolName ?? existing.protocolName),
    observedAt: asIso(next.observedAt ?? existing.observedAt),
    checklistItems: asArray(next.checklistItems ?? existing.checklistItems),
    totalApplicable: asNumber(next.totalApplicable ?? existing.totalApplicable, 0),
    totalCorrect: asNumber(next.totalCorrect ?? existing.totalCorrect, 0),
    percentIntegrity: asNumber(next.percentIntegrity ?? existing.percentIntegrity, 0),
    coachingNote: asNullableText(next.coachingNote ?? existing.coachingNote),
    followUpRequired: asBoolean(next.followUpRequired ?? existing.followUpRequired, false),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildIoaCheckDoc(input = {}, existing = {}) {
  const next = asObject(input);
  return withAuditFields({
    id: next.id || existing.id || null,
    childId: asText(next.childId ?? existing.childId),
    targetId: asText(next.targetId ?? existing.targetId),
    sessionId: asNullableText(next.sessionId ?? existing.sessionId),
    primaryObserverId: asText(next.primaryObserverId ?? existing.primaryObserverId),
    secondaryObserverId: asText(next.secondaryObserverId ?? existing.secondaryObserverId),
    bcbaId: asNullableText(next.bcbaId ?? existing.bcbaId),
    method: asText(next.method ?? existing.method),
    observedAt: asIso(next.observedAt ?? existing.observedAt),
    primaryValue: asNumber(next.primaryValue ?? existing.primaryValue, 0),
    secondaryValue: asNumber(next.secondaryValue ?? existing.secondaryValue, 0),
    agreementPercent: asNumber(next.agreementPercent ?? existing.agreementPercent, 0),
    note: asNullableText(next.note ?? existing.note),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildPhaseChangeDoc(input = {}, existing = {}) {
  const next = asObject(input);
  return withAuditFields({
    id: next.id || existing.id || null,
    childId: asText(next.childId ?? existing.childId),
    targetId: asText(next.targetId ?? existing.targetId),
    changedBy: asText(next.changedBy ?? existing.changedBy),
    phaseType: asEnum(next.phaseType ?? existing.phaseType, ABA_PHASE_TYPES, 'baseline'),
    effectiveDate: asIso(next.effectiveDate ?? existing.effectiveDate),
    note: asNullableText(next.note ?? existing.note),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}

export function buildParentSummaryDoc(input = {}, existing = {}) {
  const next = asObject(input);
  return withAuditFields({
    id: next.id || existing.id || null,
    childId: asText(next.childId ?? existing.childId),
    sessionId: asText(next.sessionId ?? existing.sessionId),
    sessionDataSheetId: asText(next.sessionDataSheetId ?? existing.sessionDataSheetId),
    authoredBy: asText(next.authoredBy ?? existing.authoredBy),
    reviewedBy: asNullableText(next.reviewedBy ?? existing.reviewedBy),
    date: asText(next.date ?? existing.date),
    strengthsObserved: asNullableText(next.strengthsObserved ?? existing.strengthsObserved),
    focusAreas: asNullableText(next.focusAreas ?? existing.focusAreas),
    highLevelProgress: asNullableText(next.highLevelProgress ?? existing.highLevelProgress),
    homeCarryoverTip: asNullableText(next.homeCarryoverTip ?? existing.homeCarryoverTip),
    sensitiveDetailsExcluded: true,
    status: asEnum(next.status ?? existing.status, ABA_PARENT_SUMMARY_STATUSES, 'draft'),
    createdAt: next.createdAt ?? existing.createdAt ?? null,
    updatedAt: next.updatedAt ?? existing.updatedAt ?? null,
  }, existing);
}