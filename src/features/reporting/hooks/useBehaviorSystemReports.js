import { useEffect, useMemo, useState } from 'react';
import { getAttendanceHistory, getChildSessionSummaries, getMoodHistory } from '../../../Api';
import { useData } from '../../../DataContext';
import {
  buildAttendanceSummary,
  buildBehaviorHeatmap,
  buildBehaviorTrendSeries,
  buildMoodTrendSeries,
  buildMonthlySummary,
  buildProgramMasteryTable,
  buildReinforcerEffectiveness,
  buildSchoolWideAnalytics,
} from '../services/reportingEngine';

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeDayKey(value) {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function ensureSyntheticSummary(summaryMap, childId, dayKey) {
  const existing = summaryMap.get(dayKey);
  if (existing) return existing;
  const iso = `${dayKey}T12:00:00.000Z`;
  const next = {
    id: `seeded-report-${childId}-${dayKey}`,
    childId,
    status: 'approved',
    approvedAt: iso,
    generatedAt: iso,
    createdAt: iso,
    summary: {
      dailyRecap: {
        therapistNarrative: 'Demo View synthesized reporting activity.',
      },
      monthlyGoal: {
        description: '',
      },
      successCriteriaMet: [],
      programsWorkedOn: [],
      interferingBehaviors: [],
    },
  };
  summaryMap.set(dayKey, next);
  return next;
}

function buildSeededReportSummaries({ childId, sessionSummaries = [], skillItems = [], behaviorItems = [] }) {
  const summaryMap = new Map();
  (Array.isArray(sessionSummaries) ? sessionSummaries : []).forEach((item, index) => {
    const cloned = cloneValue(item);
    const dayKey = normalizeDayKey(item?.approvedAt || item?.generatedAt || item?.createdAt || item?.sessionDate) || `existing-${index + 1}`;
    if (!cloned.summary || typeof cloned.summary !== 'object') cloned.summary = {};
    if (!cloned.summary.dailyRecap || typeof cloned.summary.dailyRecap !== 'object') cloned.summary.dailyRecap = { therapistNarrative: '' };
    if (!Array.isArray(cloned.summary.successCriteriaMet)) cloned.summary.successCriteriaMet = [];
    if (!Array.isArray(cloned.summary.programsWorkedOn)) cloned.summary.programsWorkedOn = [];
    if (!Array.isArray(cloned.summary.interferingBehaviors)) cloned.summary.interferingBehaviors = [];
    summaryMap.set(dayKey, cloned);
  });

  (Array.isArray(skillItems) ? skillItems : []).forEach((item) => {
    const dayKey = normalizeDayKey(item?.date || item?.recordedAt);
    if (!dayKey) return;
    const target = ensureSyntheticSummary(summaryMap, childId, dayKey);
    const programLabel = String(item?.goalId || '').trim() ? `Goal ${String(item.goalId).trim()}` : 'Skill acquisition';
    if (!target.summary.programsWorkedOn.includes(programLabel)) target.summary.programsWorkedOn.push(programLabel);
    const masteryText = `${Number(item?.correct || 0)}/${Number(item?.trials || 0)} correct • ${Number(item?.masteryPercent || 0)}% mastery`;
    if (!target.summary.successCriteriaMet.includes(masteryText)) target.summary.successCriteriaMet.push(masteryText);
    if (!String(target.summary.dailyRecap?.therapistNarrative || '').trim()) {
      target.summary.dailyRecap.therapistNarrative = 'Demo View synthesized reporting activity.';
    }
  });

  (Array.isArray(behaviorItems) ? behaviorItems : []).forEach((item) => {
    const dayKey = normalizeDayKey(item?.date || item?.recordedAt);
    if (!dayKey) return;
    const target = ensureSyntheticSummary(summaryMap, childId, dayKey);
    target.summary.interferingBehaviors.push({
      behavior: String(item?.behavior || 'Behavior event').trim(),
      frequency: Number(item?.frequency || 0),
      intensity: String(item?.intensity || 'low').trim(),
    });
    if (!String(target.summary.dailyRecap?.therapistNarrative || '').trim() || String(target.summary.dailyRecap.therapistNarrative).includes('Demo View synthesized')) {
      target.summary.dailyRecap.therapistNarrative = String(item?.response || item?.replacementBehavior || 'Behavior tracking activity was recorded.').trim();
    }
  });

  return Array.from(summaryMap.values()).sort((left, right) => {
    const leftTs = Date.parse(String(left?.approvedAt || left?.generatedAt || left?.createdAt || ''));
    const rightTs = Date.parse(String(right?.approvedAt || right?.generatedAt || right?.createdAt || ''));
    return rightTs - leftTs;
  });
}

export function useBehaviorSystemReports({ selectedChildId, reportChildIds = [], children = [], urgentMemos = [] }) {
  const {
    activeSeedPreset = '',
    seededSessionSummariesByChild = {},
    seededMoodHistoryByChild = {},
    seededAttendanceHistoryByChild = {},
    seededSkillAcquisitionByChild = {},
    seededBehaviorTrackingByChild = {},
  } = useData();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionSummariesByChild, setSessionSummariesByChild] = useState({});
  const [moodHistoryByChild, setMoodHistoryByChild] = useState({});
  const [attendanceHistoryByChild, setAttendanceHistoryByChild] = useState({});

  useEffect(() => {
    let disposed = false;
    async function load() {
      const childIds = Array.from(new Set([selectedChildId, ...(Array.isArray(reportChildIds) ? reportChildIds : [])].filter(Boolean).map(String)));
      if (!childIds.length) {
        if (!disposed) {
          setSessionSummariesByChild({});
          setMoodHistoryByChild({});
          setAttendanceHistoryByChild({});
        }
        return;
      }
      if (activeSeedPreset === 'screenshot') {
        const nextSummariesByChild = Object.fromEntries(childIds.map((childId) => ([
          childId,
          buildSeededReportSummaries({
            childId,
            sessionSummaries: seededSessionSummariesByChild?.[childId],
            skillItems: seededSkillAcquisitionByChild?.[childId],
            behaviorItems: seededBehaviorTrackingByChild?.[childId],
          }),
        ])));
        if (!disposed) {
          setLoading(false);
          setError('');
          setSessionSummariesByChild(nextSummariesByChild);
          setMoodHistoryByChild(Object.fromEntries(childIds.map((childId) => [childId, Array.isArray(seededMoodHistoryByChild?.[childId]) ? cloneValue(seededMoodHistoryByChild[childId]) : []])));
          setAttendanceHistoryByChild(Object.fromEntries(childIds.map((childId) => [childId, Array.isArray(seededAttendanceHistoryByChild?.[childId]) ? cloneValue(seededAttendanceHistoryByChild[childId]) : []])));
        }
        return;
      }
      setLoading(true);
      setError('');
      try {
        const summaryPairs = await Promise.all(childIds.map(async (childId) => {
          const result = await getChildSessionSummaries(childId, 24).catch(() => ({ items: [] }));
          return [childId, Array.isArray(result?.items) ? result.items : []];
        }));
        const nextSummariesByChild = Object.fromEntries(summaryPairs);
        const moodPairs = await Promise.all(childIds.map(async (childId) => {
          const result = await getMoodHistory(childId, 60).catch(() => ({ items: [] }));
          return [childId, Array.isArray(result?.items) ? result.items : []];
        }));
        const attendancePairs = await Promise.all(childIds.map(async (childId) => {
          const result = await getAttendanceHistory(childId, 365).catch(() => ({ items: [] }));
          return [childId, Array.isArray(result?.items) ? result.items : []];
        }));
        if (disposed) return;
        setSessionSummariesByChild(nextSummariesByChild);
        setMoodHistoryByChild(Object.fromEntries(moodPairs));
        setAttendanceHistoryByChild(Object.fromEntries(attendancePairs));
      } catch (e) {
        if (!disposed) setError(String(e?.message || e || 'Could not load reporting data.'));
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    load();
    return () => {
      disposed = true;
    };
  }, [
    activeSeedPreset,
    selectedChildId,
    JSON.stringify(reportChildIds),
    seededSessionSummariesByChild,
    seededMoodHistoryByChild,
    seededAttendanceHistoryByChild,
    seededSkillAcquisitionByChild,
    seededBehaviorTrackingByChild,
  ]);

  const selectedSessionSummaries = useMemo(() => {
    if (selectedChildId) return sessionSummariesByChild[selectedChildId] || [];
    return Object.values(sessionSummariesByChild).flat();
  }, [selectedChildId, sessionSummariesByChild]);

  const selectedMoodHistory = useMemo(() => {
    if (selectedChildId) return moodHistoryByChild[selectedChildId] || [];
    return Object.values(moodHistoryByChild).flat();
  }, [moodHistoryByChild, selectedChildId]);

  const selectedAttendanceHistory = useMemo(() => {
    if (selectedChildId) return attendanceHistoryByChild[selectedChildId] || [];
    return Object.values(attendanceHistoryByChild).flat();
  }, [attendanceHistoryByChild, selectedChildId]);

  const childReports = useMemo(() => ({
    behaviorTrends: buildBehaviorTrendSeries(selectedSessionSummaries),
    moodTrends: buildMoodTrendSeries(selectedMoodHistory),
    programMastery: buildProgramMasteryTable(selectedSessionSummaries),
    reinforcerEffectiveness: buildReinforcerEffectiveness(selectedSessionSummaries),
    monthlySummary: buildMonthlySummary(selectedSessionSummaries),
    attendanceSummary: buildAttendanceSummary(selectedAttendanceHistory),
    behaviorHeatmap: buildBehaviorHeatmap(selectedSessionSummaries),
  }), [selectedAttendanceHistory, selectedMoodHistory, selectedSessionSummaries]);

  const schoolWide = useMemo(() => buildSchoolWideAnalytics({ summariesByChild: sessionSummariesByChild, children, urgentMemos }), [sessionSummariesByChild, children, urgentMemos]);

  return {
    loading,
    error,
    childReports,
    schoolWide,
    sessionSummariesByChild,
  };
}