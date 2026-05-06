import React, { useEffect } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useData } from '../DataContext';
import { useAuth } from '../AuthContext';
import { avatarSourceFor } from '../utils/idVisibility';
import { MaterialIcons } from '@expo/vector-icons';
import AppIconButton from '../components/AppIconButton';
import MoodTrackerCard from '../components/MoodTrackerCard';
import { isAdminRole, isStaffRole } from '../core/tenant/models';
import SessionSummarySnapshot from '../components/SessionSummarySnapshot';
import { resolveTherapyWorkspaceTarget } from '../features/sessionTracking/utils/dashboardSessionTarget';
import { THERAPY_ROLE_LABELS, getDisplayRoleLabel } from '../utils/roleTerminology';
import { maskPhoneDisplay } from '../utils/inputFormat';
// header provided by ScreenWrapper
import { ScreenWrapper } from '../components/ScreenWrapper';
const { PREVIEW_CHILD } = require('../features/sessionTracking/utils/previewWorkspace');

export default function ChildDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { childId, sessionAction, sessionPreview } = route.params || {};
  const { children = [], fetchAndSync } = useData();
  const canOpenRelatedChats = isAdminRole(user?.role);
  const canRecordMood = isAdminRole(user?.role) || isStaffRole(user?.role);
  const canManageSession = canRecordMood;

  const child = (children || []).find((c) => c.id === childId) || null;
  const isSessionPreview = Boolean(sessionPreview) && !child;
  const displayChild = child || (isSessionPreview ? PREVIEW_CHILD : null);
  useEffect(() => {
    if (!sessionAction) return;
    const { routeName, params } = resolveTherapyWorkspaceTarget(sessionAction, child?.id || null, isSessionPreview);
    navigation.replace(routeName, params);
  }, [sessionAction, navigation, child?.id, isSessionPreview]);

  const openPhone = (phone) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Unable to place call', 'Your device could not open the phone app.');
    });
  };

  const openEmail = (email) => {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() => {
      Alert.alert('Unable to open email', 'Your device could not open the email app.');
    });
  };


  if (!displayChild) {
    return (
      <View style={styles.empty}><Text style={{ color: '#666' }}>Child not found</Text></View>
    );
  }

  function openTherapyRoute(routeName) {
    navigation.navigate(routeName, {
      childId: child?.id || null,
      sessionPreview: isSessionPreview,
    });
  }

  return (
    <ScreenWrapper style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }} style={{ flex: 1 }}>

      <View style={styles.header}>
        <Image source={avatarSourceFor(displayChild)} style={styles.avatar} />
        <View style={{ marginLeft: 12 }}>
          <Text style={styles.name}>{displayChild.name}</Text>
          <Text style={styles.meta}>{displayChild.age} • {displayChild.room}</Text>
        </View>
      </View>

      {displayChild.carePlan ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Care Plan</Text>
          <Text style={styles.sectionText}>{displayChild.carePlan}</Text>
        </View>
      ) : null}

      {!isSessionPreview ? (
        <MoodTrackerCard
          childId={child?.id}
          latestEntry={child?.latestMoodEntry}
          editable={canRecordMood}
          onRecorded={() => fetchAndSync({ force: true })}
        />
      ) : null}

      {canManageSession ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{THERAPY_ROLE_LABELS.therapist} Workspace</Text>
          <Text style={styles.sectionText}>The {THERAPY_ROLE_LABELS.therapist} workflow now runs through dedicated screens so tracking, summary review, and reporting all share the same session state and preview behavior.</Text>
          {isSessionPreview ? <Text style={styles.previewBanner}>Preview mode is available from each {THERAPY_ROLE_LABELS.therapist} tool without saving any learner data.</Text> : null}
          <View style={styles.launchGrid}>
            <TouchableOpacity style={styles.launchCard} onPress={() => openTherapyRoute('TapTracker')}>
              <MaterialIcons name="touch-app" size={20} color="#2563eb" />
              <Text style={styles.launchTitle}>Tap Tracker</Text>
              <Text style={styles.launchHint}>Open live event capture and {THERAPY_ROLE_LABELS.therapist.toLowerCase()} notes.</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.launchCard} onPress={() => openTherapyRoute('SummaryReview')}>
              <MaterialIcons name="fact-check" size={20} color="#2563eb" />
              <Text style={styles.launchTitle}>Summary Review</Text>
              <Text style={styles.launchHint}>Edit and approve the session summary draft.</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.launchCard} onPress={() => openTherapyRoute('Reports')}>
              <MaterialIcons name="query-stats" size={20} color="#2563eb" />
              <Text style={styles.launchTitle}>Reports</Text>
              <Text style={styles.launchHint}>Review behavior, mood, attendance, and mastery trends.</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.launchCard} onPress={() => openTherapyRoute('ChildProgressInsights')}>
              <MaterialIcons name="insights" size={20} color="#2563eb" />
              <Text style={styles.launchTitle}>Progress Insights</Text>
              <Text style={styles.launchHint}>Open the approved-summary trend view for this learner.</Text>
            </TouchableOpacity>
            {!isSessionPreview ? (
              <TouchableOpacity style={styles.launchCard} onPress={() => navigation.navigate('TherapistDocumentationDashboard')}>
                <MaterialIcons name="assignment-turned-in" size={20} color="#2563eb" />
                <Text style={styles.launchTitle}>Documentation</Text>
                <Text style={styles.launchHint}>Review outstanding summary approvals and recent documentation status.</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {!isSessionPreview && canOpenRelatedChats ? (
        <View style={{ marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ padding: 8, backgroundColor: '#2563eb', borderRadius: 8 }} onPress={() => {
            const firstParent = (child.parents || [])[0];
            const firstTherapist = child.amTherapist || child.pmTherapist || child.bcaTherapist;
            const target = firstParent ? firstParent.id : (firstTherapist ? firstTherapist.id : null);
            if (target) navigation.navigate('AdminChatMonitor', { initialUserId: target });
          }}><Text style={{ color: '#fff', fontWeight: '700' }}>Related Chats</Text></TouchableOpacity>
        </View>
      ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Parents</Text>
            {(displayChild.parents || []).map((p) => (
              <TouchableOpacity key={p.id} style={[styles.personRow, { justifyContent: 'space-between' }]} onPress={() => navigation.navigate('ParentDetail', { parentId: p.id })}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Image source={avatarSourceFor(p)} style={styles.smallAvatar} />
                  <View style={{ marginLeft: 8 }}>
                    <Text style={{ fontWeight: '700' }}>{p.name}</Text>
                    <Text style={{ color: '#6b7280' }}>{maskPhoneDisplay(p.phone)}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {p.phone ? <AppIconButton accessibilityLabel="Call parent" name="call" iconSize={18} size={36} style={{ marginLeft: 8 }} onPress={() => openPhone(p.phone)} /> : null}
                  {p.email ? <AppIconButton accessibilityLabel="Email parent" name="email" iconSize={18} size={36} style={{ marginLeft: 8 }} onPress={() => openEmail(p.email)} /> : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>

      {!isSessionPreview && child.notes ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notes</Text>
          <Text style={styles.sectionText}>{child.notes}</Text>
        </View>
      ) : null}

      {!isSessionPreview && Array.isArray(child.upcoming) && child.upcoming.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upcoming</Text>
          {child.upcoming.map((u) => (
            <View key={u.id} style={{ marginTop: 8 }}>
              <Text style={{ fontWeight: '700' }}>{u.title}</Text>
              <Text style={{ color: '#6b7280' }}>{u.when}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {!isSessionPreview ? <View style={styles.section}>
        <Text style={styles.sectionTitle}>{THERAPY_ROLE_LABELS.therapists}</Text>
        {child.amTherapist ? (
          <TouchableOpacity style={styles.personRow} onPress={() => navigation.navigate('FacultyDetail', { facultyId: child.amTherapist.id })}>
            <Image source={avatarSourceFor(child.amTherapist)} style={styles.smallAvatar} />
            <View style={{ marginLeft: 8 }}>
              <Text style={{ fontWeight: '700' }}>{child.amTherapist.name}</Text>
              <Text style={{ color: '#6b7280' }}>{getDisplayRoleLabel(child.amTherapist.role)}</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        {child.pmTherapist ? (
          <TouchableOpacity style={styles.personRow} onPress={() => navigation.navigate('FacultyDetail', { facultyId: child.pmTherapist.id })}>
            <Image source={avatarSourceFor(child.pmTherapist)} style={styles.smallAvatar} />
            <View style={{ marginLeft: 8 }}>
              <Text style={{ fontWeight: '700' }}>{child.pmTherapist.name}</Text>
              <Text style={{ color: '#6b7280' }}>{getDisplayRoleLabel(child.pmTherapist.role)}</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        {child.bcaTherapist ? (
          <TouchableOpacity style={styles.personRow} onPress={() => navigation.navigate('FacultyDetail', { facultyId: child.bcaTherapist.id })}>
            <Image source={avatarSourceFor(child.bcaTherapist)} style={styles.smallAvatar} />
            <View style={{ marginLeft: 8 }}>
              <Text style={{ fontWeight: '700' }}>{child.bcaTherapist.name}</Text>
              <Text style={{ color: '#6b7280' }}>{getDisplayRoleLabel(child.bcaTherapist.role)}</Text>
            </View>
          </TouchableOpacity>
        ) : null}
      </View> : null}

      <View style={{ height: 32 }} />
      </ScrollView>
      
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#eee' },
  name: { fontSize: 20, fontWeight: '700' },
  meta: { color: '#6b7280', marginTop: 4 },
  section: { marginTop: 12 },
  sectionCard: { marginTop: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f8fafc' },
  sectionTitle: { fontWeight: '700', marginBottom: 6 },
  sectionText: { color: '#374151' },
  personRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  smallAvatar: { width: 44, height: 44, borderRadius: 22 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  previewBanner: { marginTop: 8, marginBottom: 4, color: '#1d4ed8', backgroundColor: '#eff6ff', borderRadius: 10, padding: 10, lineHeight: 18 },
  launchGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 10 },
  launchCard: { width: '48%', minHeight: 116, borderRadius: 14, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#ffffff', padding: 12, marginBottom: 10 },
  launchTitle: { marginTop: 10, fontWeight: '800', color: '#0f172a' },
  launchHint: { marginTop: 6, color: '#475569', lineHeight: 18 },
});
