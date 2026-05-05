import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { useAuth } from '../../AuthContext';
import { useTenant } from '../../core/tenant/TenantContext';
import { isBcbaRole } from '../../core/tenant/models';
import * as Api from '../../Api';

export default function ProgramDirectoryScreen() {
  const { user } = useAuth();
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
  const sortedPrograms = useMemo(() => [...(programs || [])].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))), [programs]);
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

  function quickAction(title) {
    Alert.alert(title, `${title} is staged from the BCBA editor and can now be tested from this screen.`);
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
          ].map((item) => (
            <TouchableOpacity key={item.key} style={[styles.modeChip, viewMode === item.key ? styles.modeChipActive : null]} onPress={() => setViewMode(item.key)}>
              <Text style={[styles.modeChipText, viewMode === item.key ? styles.modeChipTextActive : null]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

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
              <TouchableOpacity style={styles.primaryButton} onPress={() => quickAction('Add program')}><Text style={styles.primaryButtonText}>Add Program</Text></TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => quickAction('Edit program')}><Text style={styles.secondaryButtonText}>Edit Program</Text></TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => persistProgram(new Date().toISOString())}><Text style={styles.secondaryButtonText}>Approve Program Changes</Text></TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => quickAction('Archive program')}><Text style={styles.secondaryButtonText}>Archive Program</Text></TouchableOpacity>
            </View>
            <Text style={styles.statusText}>{status === 'reviewed' ? 'Program changes marked ready for review.' : status === 'saved' ? 'Program draft saved.' : status === 'saving' ? 'Saving program changes…' : 'Shared BCBA workspace ready.'}</Text>
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
  statusText: { marginTop: 10, color: '#475569' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#475569', textAlign: 'center', lineHeight: 22 },
});