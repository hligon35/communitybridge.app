import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Platform, Image } from 'react-native';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { logPress } from '../utils/logger';
import { isAdminRole, isStaffRole, normalizeUserRole } from '../core/tenant/models';
import { useTenant } from '../core/tenant/TenantContext';
import useIsTabletLayout from '../hooks/useIsTabletLayout';

const chatsIcon = require('../../assets/icons/chats.png');
const controlsIcon = require('../../assets/icons/dashboard.png');
const settingsIcon = require('../../assets/icons/settings.png');
const myChildIcon = require('../../assets/icons/mychild.png');

const TAB_TARGETS = Object.freeze({
  Home: Object.freeze({ root: 'Home', screen: 'CommunityMain' }),
  Chats: Object.freeze({ root: 'Chats', screen: 'ChatsList' }),
  Controls: Object.freeze({ root: 'Controls', screen: 'ControlsMain' }),
  MyChild: Object.freeze({ root: 'MyChild', screen: 'MyChildMain' }),
  MyClass: Object.freeze({ root: 'MyClass', screen: 'MyClassMain' }),
  Settings: Object.freeze({ root: 'Settings', screen: 'SettingsMain' }),
});

const TAB_ROUTE_GROUPS = Object.freeze({
  Home: new Set(['Home', 'CommunityMain', 'AnnouncementFeedScreen', 'InsuranceBilling', 'TherapistItemsNeeded', 'CareTeam', 'ScheduleCalendar', 'ChildDetail', 'TapTracker', 'TapLogs', 'SummaryReview', 'Reports', 'ChildProgressInsights', 'TherapistDocumentationDashboard', 'BcbaSessionReviewQueue', 'LearnerClinicalProfile', 'ParentDetail', 'FacultyDetail']),
  Chats: new Set(['Chats', 'ChatsList', 'NewThread', 'ChatThread']),
  Controls: new Set(['Controls', 'ControlsMain', 'StudentDirectory', 'FacultyDirectory', 'ParentDirectory', 'ParentDetail', 'ChildDetail', 'TapTracker', 'TapLogs', 'SummaryReview', 'Reports', 'ChildProgressInsights', 'TherapistDocumentationDashboard', 'OrganizationInsightsDashboard', 'FacultyDetail', 'AdminMemos', 'AdminChatMonitor', 'AdminSettings', 'OrganizationSettings', 'BrandingSettings', 'UserMonitor', 'ManagePermissions', 'PrivacyDefaults', 'AdminAlerts', 'InsuranceBilling', 'ImportCenter', 'ExportData', 'Attendance', 'ScheduleCalendar', 'ProgramDirectory', 'BcbaSessionReviewQueue', 'LearnerClinicalProfile', 'CampusDirectory', 'ProgramDocuments', 'CampusDocuments']),
  MyChild: new Set(['MyChild', 'MyChildMain', 'ChildProgressInsights', 'RecentApprovedSessions']),
  MyClass: new Set(['MyClass', 'MyClassMain']),
  Settings: new Set(['Settings', 'SettingsMain', 'EditProfile', 'Help']),
});

function resolveActiveTab(routeName, tabs) {
  const normalizedRoute = String(routeName || '').trim();
  const tabKeys = (Array.isArray(tabs) ? tabs : []).map((tab) => tab.key);
  const direct = tabKeys.find((tabKey) => TAB_ROUTE_GROUPS[tabKey]?.has(normalizedRoute));
  return direct || normalizedRoute;
}

function NavImageIcon({ source, active, size = 24 }) {
  return (
    <Image
      source={source}
      style={{ width: size, height: size, resizeMode: 'contain', opacity: active ? 1 : 0.68, backgroundColor: 'transparent' }}
    />
  );
}

export default function BottomNav({ navigationRef, currentRoute }) {
  // don't show mobile bottom nav on web
  const isTabletLayout = useIsTabletLayout();
  if (Platform.OS === 'web' || isTabletLayout) return null;
  const { user } = useAuth();
  const { urgentMemos = [], unreadThreadCount = 0 } = useData();
  const tenant = useTenant();
  const labels = tenant?.labels || {};
  const role = normalizeUserRole(user?.role);
  const useCompactRoleTabs = isStaffRole(role) || isAdminRole(role);
  const compactDashboardTabKey = role === 'therapist' ? 'Home' : 'Controls';

  // For parents, show any pending urgent alerts they created on the MyChild tab
  const parentPendingCount = (user && role === 'parent') ? (urgentMemos || []).filter((m) => (m.proposerId === user.id) && (!m.status || m.status === 'pending')).length : 0;

  // define tabs depending on role
  let tabs = [
    { key: 'Chats', label: 'Chats', icon: (active) => (<NavImageIcon source={chatsIcon} active={active} />), count: unreadThreadCount },
  ];
  if (useCompactRoleTabs) {
    tabs.unshift({ key: compactDashboardTabKey, label: labels.dashboard || 'Dashboard', icon: (active) => (<NavImageIcon source={controlsIcon} active={active} />) });
  }
  if (!useCompactRoleTabs) {
    tabs.unshift({ key: 'Home', label: labels.dashboard || 'Dashboard', icon: (active) => (<NavImageIcon source={controlsIcon} active={active} />) });
    tabs.push({ key: 'MyChild', label: labels.myChild || 'My Child', icon: (active) => (<NavImageIcon source={myChildIcon} active={active} />), count: parentPendingCount });
  }
  tabs.push({ key: 'Settings', label: 'Settings', icon: (active) => (<NavImageIcon source={settingsIcon} active={active} />) });
  const activeTab = resolveActiveTab(currentRoute, tabs);

  function go(name) {
    logPress('BottomNav:tab', { to: name, from: currentRoute });
    try {
      if (!navigationRef || typeof navigationRef.isReady !== 'function' || !navigationRef.isReady()) return;
      if (typeof navigationRef.navigate !== 'function') return;
      const target = TAB_TARGETS[name];
      if (!target) return;
      navigationRef.navigate('Main', {
        screen: target.root,
        params: { screen: target.screen },
      });
    } catch (_) {
      // ignore
    }
  }

  // animation for badges
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const hasAny = tabs && tabs.some((t) => t.count && t.count > 0);
    if (hasAny) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.08, duration: 600, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
    // reset scale when no alerts
    scale.setValue(1);
  }, [tabs, scale]);

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.inner}>
        {tabs.map(t => (
          <TouchableOpacity key={t.key} style={styles.button} onPress={() => go(t.key)}>
            {t.icon(activeTab === t.key)}
            <Text style={[styles.label, activeTab === t.key && styles.active]}>{t.label}</Text>
            {t.count > 0 ? (
              <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
                <Text style={styles.badgeText}>{t.count}</Text>
              </Animated.View>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  inner: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    backgroundColor: '#ffffff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    paddingBottom: 2,
    paddingTop: 2,
  },
  button: {
    minWidth: 56,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  label: {
    color: '#444',
    fontSize: 12,
    marginTop: 2,
  },
  active: {
    color: '#0066FF',
    fontWeight: '700',
  },
  badge: { position: 'absolute', top: 0, right: 2, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
});
