import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useData } from '../DataContext';
import { useAuth } from '../AuthContext';
import { avatarSourceFor } from '../utils/idVisibility';
import { USER_ROLES, isAdminRole, isStaffRole, normalizeUserRole } from '../core/tenant/models';
import TherapySessionPanel from '../features/sessionTracking/components/TherapySessionPanel';
import { useTherapySessionWorkspace } from '../features/sessionTracking/hooks/useTherapySessionWorkspace';
const { PREVIEW_CHILD } = require('../features/sessionTracking/utils/previewWorkspace');

export default function TapTrackerScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { childId, sessionPreview, autoStartSession, sessionType } = route.params || {};
  const { children = [], fetchAndSync, activeSeedPreset = '', seededTapEventsByChild = {} } = useData();
  const role = normalizeUserRole(user?.role);
  const isTherapist = role === USER_ROLES.THERAPIST;
  const canManageSession = isAdminRole(user?.role) || isStaffRole(user?.role);
  const child = (children || []).find((entry) => entry.id === childId) || null;
  const preview = Boolean(sessionPreview) || !child;
  const inactivePreview = isTherapist && preview;
  const displayChild = child || PREVIEW_CHILD;
  const seededRecentEvents = activeSeedPreset === 'screenshot' && child?.id
    ? (Array.isArray(seededTapEventsByChild?.[child.id]) ? seededTapEventsByChild[child.id] : [])
    : [];
  const workspace = useTherapySessionWorkspace({ child, preview, canManageSession, fetchAndSync, seededRecentEvents });
  const [paused, setPaused] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  const subtitle = useMemo(() => {
    if (inactivePreview) return 'Start a sessions to activate';
    if (preview) return 'Interactive preview';
    return [displayChild.age, displayChild.room].filter(Boolean).join(' • ');
  }, [displayChild.age, displayChild.room, inactivePreview, preview]);

  useEffect(() => {
    if (!autoStartSession || workspace.activeSession || workspace.loadingSession || workspace.savingSession) return;
    workspace.handleStartSession(sessionType || 'AM').catch?.(() => {});
  }, [autoStartSession, sessionType, workspace]);

  useEffect(() => {
    if (!workspace.activeSession || paused) return undefined;
    const startedAt = Date.parse(String(workspace.activeSession.startedAt || workspace.activeSession.createdAt || new Date().toISOString()));
    const tick = () => setSessionSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [paused, workspace.activeSession]);

  const sessionTimerLabel = useMemo(() => {
    const hours = Math.floor(sessionSeconds / 3600);
    const minutes = Math.floor((sessionSeconds % 3600) / 60);
    const seconds = sessionSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [sessionSeconds]);

  function confirmEndSession() {
    Alert.alert('End session?', 'This will stop the timer and open the session report for review.', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes',
        onPress: () => {
          workspace.handleEndSession().then((result) => {
            navigation.navigate('SummaryReview', {
              childId: child?.id || null,
              sessionPreview: preview,
              draftSummary: result?.draftSummary || null,
            });
          }).catch(() => {});
        },
      },
    ]);
  }

  return (
    <ScreenWrapper style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <View style={styles.trackerPreviewHeader}>
            <Image source={avatarSourceFor(displayChild)} style={styles.avatar} />
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>Tap Tracker</Text>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{displayChild.name}</Text>
                <View style={styles.sessionHeaderControls}>
                  <TouchableOpacity style={[styles.iconControl, inactivePreview ? styles.iconControlDisabled : null]} onPress={() => setPaused((value) => !value)} disabled={inactivePreview}>
                    <MaterialIcons name={paused ? 'play-arrow' : 'pause'} size={22} color="#0f172a" />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.iconControl, inactivePreview ? styles.iconControlDisabled : null]} onPress={confirmEndSession} disabled={inactivePreview}>
                    <MaterialIcons name="stop" size={22} color="#dc2626" />
                  </TouchableOpacity>
                  <Text style={styles.timerText}>{inactivePreview ? '00:00:00' : (workspace.activeSession ? sessionTimerLabel : '00:00:00')}</Text>
                </View>
              </View>
              <Text style={styles.subtitle}>{[subtitle, displayChild.gender, displayChild.medicalConditions].filter(Boolean).join(' • ') || 'Session details'}</Text>
            </View>
          </View>
        </View>
        <TherapySessionPanel
          workspace={workspace}
          mode="tracker"
          title="Live Behavior Tracking"
          trackerPaused={paused}
          hideTrackerFeed
          showInactiveTracker={inactivePreview}
          inactiveTrackerMessage="Start a session to activate."
        />
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  headerCard: { borderRadius: 18, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff', padding: 16 },
  trackerPreviewHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 14, minHeight: 72 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#e5e7eb' },
  headerTextWrap: { marginLeft: 12, flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  sessionHeaderControls: { flexDirection: 'row', alignItems: 'center', marginLeft: 16, flexShrink: 0 },
  title: { color: '#2563eb', fontWeight: '800', textTransform: 'uppercase', fontSize: 12 },
  name: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginTop: 4 },
  subtitle: { marginTop: 4, color: '#64748b' },
  timerText: { fontSize: 20, fontWeight: '800', color: '#0f172a', marginLeft: 12 },
  iconControl: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dbe4f0', marginRight: 8, backgroundColor: '#fff' },
  iconControlDisabled: { opacity: 0.45 },
});