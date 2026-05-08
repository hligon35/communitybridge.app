import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute } from '@react-navigation/native';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { useAuth } from '../../AuthContext';
import { useData } from '../../DataContext';
import { useTenant } from '../../core/tenant/TenantContext';
import { isBcbaRole } from '../../core/tenant/models';
import * as Api from '../../Api';

export default function ProgramDirectoryScreen({ navigation }) {
  const { user } = useAuth();
  const route = useRoute();
  const { children = [] } = useData();
  const tenant = useTenant() || {};
  const { programs = [], currentOrganization, currentProgramId, setSelectedProgramId, featureFlags = {} } = tenant;
  const enabled = featureFlags.programDirectory !== false;
  const isBcba = isBcbaRole(user?.role);
  const [viewMode, setViewMode] = useState('library');
  const [draftTarget, setDraftTarget] = useState('');
  const [draftPromptHierarchy, setDraftPromptHierarchy] = useState('Least-to-most prompting');
  const [draftMasteryCriteria, setDraftMasteryCriteria] = useState('80% across 3 consecutive sessions');
  const [draftGeneralizationPlan, setDraftGeneralizationPlan] = useState('Practice across settings, people, and materials.');
  const [status, setStatus] = useState('idle');
  const [loadError, setLoadError] = useState('');
  const [selectedChildId, setSelectedChildId] = useState('');
  const [targetItems, setTargetItems] = useState([]);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [targetName, setTargetName] = useState('');
  const [targetType, setTargetType] = useState('skill_acquisition');
  const [measurementType, setMeasurementType] = useState('frequency');
  const [targetStatus, setTargetStatus] = useState('active');
  const [operationalDefinition, setOperationalDefinition] = useState('');
  const [masteryCriteria, setMasteryCriteria] = useState('80% across 3 consecutive sessions');
  const [visibleToParent, setVisibleToParent] = useState(false);
  const [parentFriendlyLabel, setParentFriendlyLabel] = useState('');
  const [parentSummaryTemplate, setParentSummaryTemplate] = useState('');
  const requestedChildId = String(route?.params?.childId || route?.params?.studentId || '').trim();
  const focusMode = String(route?.params?.focusMode || '').trim().toLowerCase();
  const sortedPrograms = useMemo(() => [...(programs || [])].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))), [programs]);
  const sortedChildren = useMemo(() => [...(Array.isArray(children) ? children : [])].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))), [children]);
  const selectedChild = sortedChildren.find((child) => child?.id === selectedChildId) || sortedChildren[0] || null;
  const selectedTarget = targetItems.find((item) => item?.id === selectedTargetId) || null;
  const editorDraftKey = `program_editor_draft_${String(currentOrganization?.id || 'org')}_${String(currentProgramId || 'default')}`;
  const skillTemplates = useMemo(() => sortedPrograms.filter((program) => !String(program?.type || '').toLowerCase().includes('behavior')).slice(0, 6), [sortedPrograms]);
  const behaviorTemplates = useMemo(() => sortedPrograms.filter((program) => String(program?.type || '').toLowerCase().includes('behavior')).slice(0, 6), [sortedPrograms]);
  const learnerPrograms = useMemo(() => sortedPrograms.map((program, index) => ({
    id: String(program?.id || index),
    name: program?.name || 'Program',
    mastery: index % 2 === 0 ? 'Emerging' : 'Maintaining',
    status: program?.id === currentProgramId ? 'Active' : index % 3 === 0 ? 'Review' : 'Running',
    updatedAt: program?.updatedAt || program?.createdAt || 'Recently updated',
  })), [currentProgramId, sortedPrograms]);

  useEffect(() => {
    if (requestedChildId && sortedChildren.some((child) => child?.id === requestedChildId)) {
      setSelectedChildId(requestedChildId);
    } else if (!selectedChildId && sortedChildren[0]?.id) {
      setSelectedChildId(sortedChildren[0].id);
    }
  }, [requestedChildId, selectedChildId, sortedChildren]);

  useEffect(() => {
    if (focusMode === 'editor') setViewMode('target-builder');
    if (focusMode === 'clinical') setViewMode('clinical-review');
  }, [focusMode]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoadError('');
        const shared = currentProgramId ? await Api.getProgramWorkspace(currentProgramId).catch(() => null) : null;
        if (shared?.item && mounted) {
          setDraftTarget(String(shared.item.targetName || ''));
          setDraftPromptHierarchy(String(shared.item.promptHierarchy || 'Least-to-most prompting'));
          setDraftMasteryCriteria(String(shared.item.masteryCriteria || '80% across 3 consecutive sessions'));
          setDraftGeneralizationPlan(String(shared.item.generalizationPlan || 'Practice across settings, people, and materials.'));
          return;
        }
        const raw = await AsyncStorage.getItem(editorDraftKey);
        if (!mounted || !raw) return;
        const parsed = JSON.parse(raw);
        setDraftTarget(String(parsed?.draftTarget || ''));
        setDraftPromptHierarchy(String(parsed?.draftPromptHierarchy || 'Least-to-most prompting'));
        setDraftMasteryCriteria(String(parsed?.draftMasteryCriteria || '80% across 3 consecutive sessions'));
        setDraftGeneralizationPlan(String(parsed?.draftGeneralizationPlan || 'Practice across settings, people, and materials.'));
      } catch (error) {
        setLoadError(String(error?.message || error || 'Could not load saved program editor state.'));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [editorDraftKey, currentProgramId]);

  useEffect(() => {
    let disposed = false;
    async function loadBehaviorTargets() {
      if (!selectedChildId) {
        if (!disposed) {
          setTargetItems([]);
          setSelectedTargetId('');
        }
        return;
      }
      try {
        const result = await Api.listBehaviorTargetsByChild(selectedChildId, 100);
        if (disposed) return;
        const items = Array.isArray(result?.items) ? result.items : [];
        setTargetItems(items);
        setSelectedTargetId((current) => current || items[0]?.id || '');
      } catch (error) {
        if (!disposed) {
          setTargetItems([]);
          setSelectedTargetId('');
          setLoadError(String(error?.message || error || 'Could not load behavior targets.'));
        }
      }
    }
    loadBehaviorTargets();
    return () => {
      disposed = true;
    };
  }, [selectedChildId]);

  useEffect(() => {
    if (!selectedTarget) {
      setTargetName('');
      setTargetType('skill_acquisition');
      setMeasurementType('frequency');
      setTargetStatus('active');
      setOperationalDefinition('');
      setMasteryCriteria('80% across 3 consecutive sessions');
      setVisibleToParent(false);
      setParentFriendlyLabel('');
      setParentSummaryTemplate('');
      return;
    }
    setTargetName(String(selectedTarget.targetName || ''));
    setTargetType(String(selectedTarget.targetType || 'skill_acquisition'));
    setMeasurementType(String(selectedTarget.measurementType || 'frequency'));
    setTargetStatus(String(selectedTarget.status || 'active'));
    setOperationalDefinition(String(selectedTarget.operationalDefinition || ''));
    setMasteryCriteria(String(selectedTarget.masteryCriteria || ''));
    setVisibleToParent(Boolean(selectedTarget.visibleToParent));
    setParentFriendlyLabel(String(selectedTarget.parentFriendlyLabel || ''));
    setParentSummaryTemplate(String(selectedTarget.parentSummaryTemplate || ''));
  }, [selectedTarget]);

  useEffect(() => {
    AsyncStorage.setItem(editorDraftKey, JSON.stringify({ draftTarget, draftPromptHierarchy, draftMasteryCriteria, draftGeneralizationPlan })).catch(() => {});
  }, [draftGeneralizationPlan, draftMasteryCriteria, draftPromptHierarchy, draftTarget, editorDraftKey]);

  async function persistProgram(reviewedAt = null) {
    if (!currentProgramId) {
      Alert.alert('No program selected', 'Select a program before saving changes.');
      return;
    }
    if (!String(draftTarget || '').trim()) {
      Alert.alert('Target required', 'Enter a target before saving program changes.');
      return;
    }
    if (!String(draftPromptHierarchy || '').trim()) {
      Alert.alert('Prompt hierarchy required', 'Enter a prompt hierarchy before saving program changes.');
      return;
    }
    if (!String(draftMasteryCriteria || '').trim()) {
      Alert.alert('Mastery criteria required', 'Enter mastery criteria before saving program changes.');
      return;
    }
    if (!String(draftGeneralizationPlan || '').trim()) {
      Alert.alert('Generalization plan required', 'Enter a generalization plan before saving program changes.');
      return;
    }
    try {
      setStatus('saving');
      await Api.updateProgramWorkspace(currentProgramId, {
        organizationId: currentOrganization?.id,
        targetName: draftTarget,
        promptHierarchy: draftPromptHierarchy,
        masteryCriteria: draftMasteryCriteria,
        generalizationPlan: draftGeneralizationPlan,
        reviewedAt,
      });
      setStatus(reviewedAt ? 'reviewed' : 'saved');
    } catch (error) {
      setStatus('error');
      Alert.alert('Save failed', String(error?.message || error || 'Could not save the program editor.'));
    }
  }

  async function persistBehaviorTarget() {
    if (!selectedChild?.id) {
      Alert.alert('Select a learner', 'Choose a learner before saving a behavior target.');
      return;
    }
    if (!String(targetName || '').trim()) {
      Alert.alert('Target required', 'Enter a target name before saving.');
      return;
    }
    if (!String(operationalDefinition || '').trim()) {
      Alert.alert('Operational definition required', 'Add an operational definition before saving.');
      return;
    }
    if (!String(masteryCriteria || '').trim()) {
      Alert.alert('Mastery criteria required', 'Add mastery criteria before saving.');
      return;
    }
    try {
      setStatus('saving-target');
      const result = await Api.saveBehaviorTarget({
        id: selectedTarget?.id || null,
        childId: selectedChild.id,
        programId: currentProgramId || null,
        bcbaId: String(user?.id || '').trim(),
        targetName,
        targetType,
        status: targetStatus,
        operationalDefinition,
        measurementType,
        masteryCriteria,
        visibleToParent,
        parentFriendlyLabel,
        parentSummaryTemplate,
        activeFrom: new Date().toISOString(),
        createdBy: String(user?.id || '').trim(),
      }, selectedTarget || null);
      const saved = result?.item || null;
      if (saved) {
        setTargetItems((current) => {
          const exists = current.some((item) => item.id === saved.id);
          const next = exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...current];
          return next.sort((left, right) => String(left?.targetName || '').localeCompare(String(right?.targetName || '')));
        });
        setSelectedTargetId(saved.id);
      }
      setStatus('saved-target');
    } catch (error) {
      setStatus('error');
      Alert.alert('Save failed', String(error?.message || error || 'Could not save this behavior target.'));
    }
  }

  if (!enabled) {
    return (
      <ScreenWrapper style={styles.screen}>
        <View style={styles.emptyWrap}><Text style={styles.emptyText}>Programs & Goals is not enabled for this organization.</Text></View>
      </ScreenWrapper>
    );
  }

  if (!isBcba) {
    return (
      <ScreenWrapper style={styles.screen}>
        <View style={styles.emptyWrap}><Text style={styles.emptyText}>Office sees nothing here. Programs & Goals is reserved for BCBA workflow only.</Text></View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.modeRow}>
          {[
            { key: 'library', label: 'Program Library' },
            { key: 'learner', label: 'Student Program List' },
            { key: 'editor', label: 'Program Editor' },
            { key: 'target-builder', label: 'Target Builder' },
            { key: 'clinical-review', label: 'Clinical Review' },
          ].map((item) => (
            <TouchableOpacity key={item.key} style={[styles.modeChip, viewMode === item.key ? styles.modeChipActive : null]} onPress={() => setViewMode(item.key)}>
              <Text style={[styles.modeChipText, viewMode === item.key ? styles.modeChipTextActive : null]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {(viewMode === 'target-builder' || viewMode === 'clinical-review') ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Assigned learners</Text>
            <View style={styles.modeRow}>
              {sortedChildren.map((child) => (
                <TouchableOpacity key={child.id} style={[styles.modeChip, selectedChild?.id === child.id ? styles.modeChipActive : null]} onPress={() => setSelectedChildId(child.id)}>
                  <Text style={[styles.modeChipText, selectedChild?.id === child.id ? styles.modeChipTextActive : null]}>{child.name || 'Learner'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {viewMode === 'library' ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Skill acquisition templates</Text>
              {(skillTemplates.length ? skillTemplates : sortedPrograms).map((program) => (
                <TouchableOpacity key={program.id} style={styles.listRow} onPress={() => setSelectedProgramId?.(program.id)}>
                  <Text style={styles.listTitle}>{program.name || 'Program'}</Text>
                  <Text style={styles.listMeta}>{String(program.type || 'Skill acquisition').replaceAll('_', ' ')}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Behavior reduction templates</Text>
              {(behaviorTemplates.length ? behaviorTemplates : sortedPrograms).map((program) => (
                <TouchableOpacity key={`${program.id}-behavior`} style={styles.listRow} onPress={() => setSelectedProgramId?.(program.id)}>
                  <Text style={styles.listTitle}>{program.name || 'Program'}</Text>
                  <Text style={styles.listMeta}>{String(program.type || 'Behavior reduction').replaceAll('_', ' ')}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        {viewMode === 'learner' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Student program list</Text>
            {learnerPrograms.map((program) => (
              <View key={program.id} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>{program.name}</Text>
                  <Text style={styles.listMeta}>{program.status} • {program.mastery} • Last updated {program.updatedAt}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {viewMode === 'editor' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Program editor</Text>
            <Text style={styles.listMeta}>Targets, prompt hierarchy, mastery criteria, and generalization planning are all editable here.</Text>
            {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
            <TextInput value={draftTarget} onChangeText={(value) => setDraftTarget(String(value || '').slice(0, 160))} placeholder="Targets" style={styles.input} maxLength={160} />
            <TextInput value={draftPromptHierarchy} onChangeText={(value) => setDraftPromptHierarchy(String(value || '').slice(0, 160))} placeholder="Prompt hierarchy" style={styles.input} maxLength={160} />
            <TextInput value={draftMasteryCriteria} onChangeText={(value) => setDraftMasteryCriteria(String(value || '').slice(0, 160))} placeholder="Mastery criteria" style={styles.input} maxLength={160} />
            <TextInput value={draftGeneralizationPlan} onChangeText={(value) => setDraftGeneralizationPlan(String(value || '').slice(0, 2000))} placeholder="Generalization plan" multiline style={[styles.input, styles.multiline]} maxLength={2000} />
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.primaryButton} onPress={() => persistProgram(null)}><Text style={styles.primaryButtonText}>Save Program Draft</Text></TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => persistProgram(new Date().toISOString())}><Text style={styles.secondaryButtonText}>Approve Program Changes</Text></TouchableOpacity>
            </View>
            <Text style={styles.statusText}>{status === 'reviewed' ? 'Program changes marked ready for review.' : status === 'saved' ? 'Program draft saved.' : status === 'saving' ? 'Saving program changes…' : 'Shared BCBA workspace ready.'}</Text>
          </View>
        ) : null}

        {viewMode === 'target-builder' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Behavior target builder</Text>
            <Text style={styles.listMeta}>Create and update structured ABA targets for the selected learner without exposing internal clinical detail to parents.</Text>
            <View style={styles.modeRow}>
              {targetItems.map((item) => (
                <TouchableOpacity key={item.id} style={[styles.modeChip, selectedTarget?.id === item.id ? styles.modeChipActive : null]} onPress={() => setSelectedTargetId(item.id)}>
                  <Text style={[styles.modeChipText, selectedTarget?.id === item.id ? styles.modeChipTextActive : null]}>{item.targetName || 'Target'}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setSelectedTargetId('')}><Text style={styles.secondaryButtonText}>New Target</Text></TouchableOpacity>
            </View>
            <TextInput value={targetName} onChangeText={setTargetName} placeholder="Target name" style={styles.input} />
            <View style={styles.modeRow}>
              {[
                { value: 'skill_acquisition', label: 'Skill Acquisition' },
                { value: 'behavior_reduction', label: 'Behavior Reduction' },
              ].map((item) => (
                <TouchableOpacity key={item.value} style={[styles.modeChip, targetType === item.value ? styles.modeChipActive : null]} onPress={() => setTargetType(item.value)}>
                  <Text style={[styles.modeChipText, targetType === item.value ? styles.modeChipTextActive : null]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modeRow}>
              {['frequency', 'duration', 'abc', 'percent_correct', 'task_analysis', 'latency', 'whole_interval', 'partial_interval', 'momentary_time_sampling', 'rate'].map((item) => (
                <TouchableOpacity key={item} style={[styles.modeChip, measurementType === item ? styles.modeChipActive : null]} onPress={() => setMeasurementType(item)}>
                  <Text style={[styles.modeChipText, measurementType === item ? styles.modeChipTextActive : null]}>{item.replaceAll('_', ' ')}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput value={operationalDefinition} onChangeText={setOperationalDefinition} placeholder="Operational definition" multiline style={[styles.input, styles.multiline]} />
            <TextInput value={masteryCriteria} onChangeText={setMasteryCriteria} placeholder="Mastery criteria" style={styles.input} />
            <View style={styles.modeRow}>
              {['draft', 'active', 'on_hold', 'mastered', 'discontinued'].map((item) => (
                <TouchableOpacity key={item} style={[styles.modeChip, targetStatus === item ? styles.modeChipActive : null]} onPress={() => setTargetStatus(item)}>
                  <Text style={[styles.modeChipText, targetStatus === item ? styles.modeChipTextActive : null]}>{item.replaceAll('_', ' ')}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Visible to parent</Text>
              <Switch value={visibleToParent} onValueChange={setVisibleToParent} />
            </View>
            <TextInput value={parentFriendlyLabel} onChangeText={setParentFriendlyLabel} placeholder="Parent-friendly label" style={styles.input} />
            <TextInput value={parentSummaryTemplate} onChangeText={setParentSummaryTemplate} placeholder="Parent summary template" multiline style={[styles.input, styles.multiline]} />
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.primaryButton} onPress={() => persistBehaviorTarget()}><Text style={styles.primaryButtonText}>Save Behavior Target</Text></TouchableOpacity>
              {selectedChild?.id ? <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('LearnerClinicalProfile', { childId: selectedChild.id })}><Text style={styles.secondaryButtonText}>Open Clinical Profile</Text></TouchableOpacity> : null}
            </View>
            <Text style={styles.statusText}>{status === 'saved-target' ? 'Behavior target saved.' : status === 'saving-target' ? 'Saving behavior target…' : 'BCBA target builder ready.'}</Text>
          </View>
        ) : null}

        {viewMode === 'clinical-review' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Clinical review workflows</Text>
            <Text style={styles.listMeta}>Open the learner clinical profile for trends and decisions, or jump into the BCBA session review queue.</Text>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('BcbaSessionReviewQueue')}><Text style={styles.primaryButtonText}>Open Review Queue</Text></TouchableOpacity>
              {selectedChild?.id ? <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('LearnerClinicalProfile', { childId: selectedChild.id })}><Text style={styles.secondaryButtonText}>Open Learner Profile</Text></TouchableOpacity> : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16 },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  modeChip: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f1f5f9', marginRight: 8, marginBottom: 8 },
  modeChipActive: { backgroundColor: '#2563eb' },
  modeChipText: { color: '#0f172a', fontWeight: '700' },
  modeChipTextActive: { color: '#ffffff' },
  card: { marginTop: 12, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb', padding: 16 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  listRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  listTitle: { fontWeight: '800', color: '#0f172a' },
  listMeta: { marginTop: 4, color: '#64748b', lineHeight: 20 },
  errorText: { color: '#b91c1c', marginBottom: 8 },
  input: { marginTop: 12, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff' },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  primaryButton: { borderRadius: 12, backgroundColor: '#2563eb', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  secondaryButton: { borderRadius: 12, backgroundColor: '#e2e8f0', paddingVertical: 12, paddingHorizontal: 14, marginRight: 10, marginBottom: 10 },
  secondaryButtonText: { color: '#0f172a', fontWeight: '800' },
  switchRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { color: '#0f172a', fontWeight: '700' },
  statusText: { marginTop: 10, color: '#475569' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#475569', textAlign: 'center', lineHeight: 22 },
});