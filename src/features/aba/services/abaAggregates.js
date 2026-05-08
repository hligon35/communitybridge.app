function groupByDate(items = [], dateGetter) {
  return items.reduce((accumulator, item) => {
    const raw = typeof dateGetter === 'function' ? dateGetter(item) : null;
    const stamp = raw ? Date.parse(String(raw)) : NaN;
    if (!Number.isFinite(stamp)) return accumulator;
    const key = new Date(stamp).toISOString().slice(0, 10);
    const bucket = accumulator.get(key) || [];
    bucket.push(item);
    accumulator.set(key, bucket);
    return accumulator;
  }, new Map());
}

export function calculateIoaPercentage(primaryValue, secondaryValue) {
  const left = Number(primaryValue);
  const right = Number(secondaryValue);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
  const max = Math.max(Math.abs(left), Math.abs(right), 0);
  if (!max) return 100;
  const min = Math.min(Math.abs(left), Math.abs(right));
  return Number(((min / max) * 100).toFixed(1));
}

export function calculateIntegrityPercentage(totalCorrect, totalApplicable) {
  const correct = Number(totalCorrect);
  const applicable = Number(totalApplicable);
  if (!Number.isFinite(correct) || !Number.isFinite(applicable) || applicable <= 0) return 0;
  return Number(((correct / applicable) * 100).toFixed(1));
}

export function evaluateMasteryStatus(target, metrics = {}) {
  const measurementType = String(target?.measurementType || '').trim().toLowerCase();
  const percentCorrect = Number(metrics.percentCorrect);
  const baselineMetric = Number(target?.baselineMetric);
  if (measurementType === 'percent_correct' && Number.isFinite(percentCorrect) && percentCorrect >= 80) {
    return 'mastered';
  }
  if (measurementType === 'behavior_reduction' && Number.isFinite(baselineMetric) && Number(metrics.averageCount) <= baselineMetric * 0.25) {
    return 'mastered';
  }
  return String(target?.status || 'active').trim().toLowerCase() || 'active';
}

export function buildFrequencySeries(events = []) {
  return Array.from(groupByDate(events, (item) => item?.observedAt).entries()).map(([date, items]) => ({
    date,
    value: items.reduce((total, item) => total + (Number(item?.count) || 0), 0),
  })).sort((left, right) => left.date.localeCompare(right.date));
}

export function buildDurationSeries(timers = []) {
  return Array.from(groupByDate(timers, (item) => item?.startedAt || item?.createdAt).entries()).map(([date, items]) => ({
    date,
    value: items.reduce((total, item) => total + (Number(item?.durationSeconds) || 0), 0),
  })).sort((left, right) => left.date.localeCompare(right.date));
}

export function buildLatencySeries(records = []) {
  return Array.from(groupByDate(records, (item) => item?.cueAt || item?.createdAt).entries()).map(([date, items]) => ({
    date,
    value: Number((items.reduce((total, item) => total + (Number(item?.latencyMs) || 0), 0) / Math.max(items.length, 1)).toFixed(1)),
  })).sort((left, right) => left.date.localeCompare(right.date));
}

export function buildIntervalPercentageSeries(samples = []) {
  return Array.from(groupByDate(samples, (item) => item?.intervalStartAt || item?.createdAt).entries()).map(([date, items]) => {
    const observedCount = items.filter((item) => item?.observed).length;
    return {
      date,
      value: Number(((observedCount / Math.max(items.length, 1)) * 100).toFixed(1)),
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
}

export function buildPercentCorrectSeries(trials = []) {
  return Array.from(groupByDate(trials, (item) => item?.observedAt || item?.createdAt).entries()).map(([date, items]) => {
    const correct = items.filter((item) => ['correct', 'prompted_correct'].includes(String(item?.outcome || '').trim().toLowerCase())).length;
    return {
      date,
      value: Number(((correct / Math.max(items.length, 1)) * 100).toFixed(1)),
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
}

export function buildTaskAnalysisSeries(trials = []) {
  return buildPercentCorrectSeries(trials);
}

export function generateIntervalWindows({ startAt, endAt, intervalMinutes = 5, intervalType = 'whole_interval' } = {}) {
  const startStamp = Date.parse(String(startAt || ''));
  const endStamp = Date.parse(String(endAt || ''));
  const intervalMs = Math.max(1, Number(intervalMinutes) || 5) * 60 * 1000;
  if (!Number.isFinite(startStamp) || !Number.isFinite(endStamp) || endStamp <= startStamp) return [];
  const windows = [];
  let cursor = startStamp;
  let index = 0;
  while (cursor < endStamp) {
    const stop = Math.min(cursor + intervalMs, endStamp);
    windows.push({
      intervalIndex: index,
      intervalType,
      intervalStartAt: new Date(cursor).toISOString(),
      intervalEndAt: new Date(stop).toISOString(),
    });
    index += 1;
    cursor = stop;
  }
  return windows;
}

export function computeAbaQuickStats({ behaviorEvents = [], skillTrials = [], durationTimers = [], abcObservations = [], intervalSamples = [], latencyRecords = [] } = {}) {
  const totalEventCount = behaviorEvents.reduce((total, item) => total + (Number(item?.count) || 0), 0);
  const completedDurations = durationTimers.filter((item) => item?.completed);
  const totalDurationSeconds = completedDurations.reduce((total, item) => total + (Number(item?.durationSeconds) || 0), 0);
  const correctTrials = skillTrials.filter((item) => ['correct', 'prompted_correct'].includes(String(item?.outcome || '').trim().toLowerCase())).length;
  const completedLatencyRecords = latencyRecords.filter((item) => item?.completed && Number.isFinite(Number(item?.latencyMs)));
  const observedIntervals = intervalSamples.filter((item) => item?.observed);
  return {
    behaviorEventCount: totalEventCount,
    behaviorEventEntries: behaviorEvents.length,
    skillTrialCount: skillTrials.length,
    percentCorrect: skillTrials.length ? Number(((correctTrials / skillTrials.length) * 100).toFixed(1)) : 0,
    totalDurationSeconds,
    averageDurationSeconds: completedDurations.length ? Number((totalDurationSeconds / completedDurations.length).toFixed(1)) : 0,
    abcObservationCount: abcObservations.length,
    intervalSampleCount: intervalSamples.length,
    observedIntervalCount: observedIntervals.length,
    intervalObservedPercentage: intervalSamples.length ? Number(((observedIntervals.length / intervalSamples.length) * 100).toFixed(1)) : 0,
    latencyRecordCount: latencyRecords.length,
    averageLatencyMs: completedLatencyRecords.length
      ? Number((completedLatencyRecords.reduce((total, item) => total + (Number(item?.latencyMs) || 0), 0) / completedLatencyRecords.length).toFixed(1))
      : 0,
  };
}

export function buildParentSafeSummaryDraft({ childName = 'Learner', sheet = null, trials = [], events = [], targetsById = {} } = {}) {
  const quickStats = sheet?.quickStats || computeAbaQuickStats({ behaviorEvents: events, skillTrials: trials });
  const targetLabels = Array.from(new Set((sheet?.targetIds || []).map((targetId) => {
    const target = targetsById?.[targetId];
    return String(target?.parentFriendlyLabel || target?.targetName || '').trim();
  }).filter(Boolean)));
  const focusAreas = targetLabels.length ? `Worked on ${targetLabels.slice(0, 3).join(', ')}.` : `Worked on targeted ABA programs for ${childName}.`;
  const strengthsObserved = quickStats.percentCorrect >= 80
    ? `${childName} showed strong responding during teaching opportunities today.`
    : `${childName} stayed engaged with structured therapy activities today.`;
  const highLevelProgress = quickStats.skillTrialCount
    ? `${quickStats.skillTrialCount} teaching trial${quickStats.skillTrialCount === 1 ? '' : 's'} were recorded with ${quickStats.percentCorrect}% correct responding.`
    : 'Clinical data was collected during the session.';
  return {
    strengthsObserved,
    focusAreas,
    highLevelProgress,
    homeCarryoverTip: 'Keep routines clear, brief, and positively reinforced at home.',
    sensitiveDetailsExcluded: true,
  };
}