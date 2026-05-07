import React, { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { useTenant } from '../core/tenant/TenantContext';
import { ADMIN_SECTION_KEYS, canAccessAdminSection, canAccessAdminWorkspace, isBcbaRole, isOfficeAdminRole, isStaffRole } from '../core/tenant/models';
import { isChildLinkedToTherapist } from '../features/sessionTracking/utils/dashboardSessionTarget';
import useIsTabletLayout from '../hooks/useIsTabletLayout';
import { navigationRef } from '../navigationRef';
import { THERAPY_ROLE_LABELS, getDisplayRoleLabel, getWorkspaceLabel } from '../utils/roleTerminology';
import { humanizeScreenLabel } from '../utils/screenLabels';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const checkUpdatesIcon = require('../../assets/icons/checkUpdates.png');
const BREAK_OPTIONS = [5, 10, 15, 30];

export const MobileAdminShellContext = createContext({
  showMobileAdminShell: false,
  openMobileNav: () => {},
  suppressScreenHeader: false,
  topInset: 0,
});

function openTarget(target) {
  if (!navigationRef?.isReady?.()) return;
  if (!target?.root) return;
  if (target.screen) {
    navigationRef.navigate('Main', {
      screen: target.root,
      params: {
        screen: target.screen,
        ...(target.params ? { params: target.params } : {}),
      },
    });
    return;
  }
  navigationRef.navigate('Main', { screen: target.root, ...(target.params ? { params: target.params } : {}) });
}

let notificationsModule = null;
function getNotificationsModule() {
  if (notificationsModule) return notificationsModule;
  try {
    notificationsModule = require('expo-notifications');
    return notificationsModule;
  } catch (_) {
    return null;
  }
}

async function ensureBreakNotificationsReady() {
  if (Platform.OS === 'web') return { ok: false, reason: 'web-unsupported' };
  const Notifications = getNotificationsModule();
  if (!Notifications) return { ok: false, reason: 'missing-deps' };
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing?.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested?.status;
    }
    if (status !== 'granted') return { ok: false, reason: 'permission-denied' };
    if (Platform.OS === 'android' && typeof Notifications.setNotificationChannelAsync === 'function') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
    }
    return { ok: true, Notifications };
  } catch (error) {
    return { ok: false, reason: 'setup-failed', message: error?.message || String(error) };
  }
}

function formatBreakCountdown(endAt, now = Date.now()) {
  const remainingMs = Math.max(0, Number(endAt || 0) - Number(now || 0));
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TabletNavigationShell({ currentRoute, children }) {
  const isTabletLayout = useIsTabletLayout();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { children: directoryChildren = [], therapists = [], createStaffLog } = useData();
  const tenant = useTenant();
  const labels = tenant?.labels || {};
  const [collapsed, setCollapsed] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [quickLogDraft, setQuickLogDraft] = useState(null);
  const [quickLogBody, setQuickLogBody] = useState('');
  const [quickLogSaving, setQuickLogSaving] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [breakPickerOpen, setBreakPickerOpen] = useState(false);
  const [breakEndsAt, setBreakEndsAt] = useState(null);
  const [breakDurationMinutes, setBreakDurationMinutes] = useState(0);
  const [breakNow, setBreakNow] = useState(Date.now());
  const breakNotificationIdsRef = useRef([]);
  const isStaff = isStaffRole(user?.role);
  const showAdminWorkspace = canAccessAdminWorkspace(user?.role);
  const isParentWorkspace = !showAdminWorkspace && !isStaff;
  const workspaceLabel = getWorkspaceLabel(user?.role);
  const screenTitleMap = {
    CommunityMain: 'Home',
    ChatsList: 'Chats',
    ChatThread: 'New Message',
    MyChildMain: labels.myChild || 'My Child',
    SettingsMain: 'Profile Settings',
    MyClassMain: labels.myClass || 'My Class',
    ControlsMain: labels.dashboard || 'Dashboard',
    StudentDirectory: 'Student Directory',
    ParentDirectory: 'Parent Directory',
    FacultyDirectory: labels.facultyDirectory || 'Faculty Directory',
    ChildDetail: 'Student',
    FacultyDetail: labels.facultyDetail || 'Faculty',
    TapTracker: 'Tap Tracker',
    SummaryReview: 'Session Report',
    ScheduleCalendar: 'Schedule',
    ManagePermissions: 'Manage Permissions',
    PrivacyDefaults: 'Profile Settings',
    ModeratePosts: 'Moderate Posts',
    ExportData: 'Export Data',
  };
  const currentScreenTitle = screenTitleMap[currentRoute] || humanizeScreenLabel(currentRoute) || workspaceLabel;
  const preferredUserName = String(user?.firstName || '').trim()
    || String(user?.name || '').trim().split(/\s+/).filter(Boolean)[0]
    || String(user?.email || '').trim()
    || 'User';
  const roleLabel = getDisplayRoleLabel(user?.role || '') || 'User';
  const drawerGreeting = `Hello, ${preferredUserName} (${roleLabel})`;
  const showQuickAdd = !showAdminWorkspace && isStaff;
  const showBcbaQuickActions = showAdminWorkspace && isBcbaRole(user?.role);
  const showHeaderQuickMenu = showQuickAdd || showBcbaQuickActions;
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const isPhoneViewport = Platform.OS !== 'ios' || !Platform.isPad
    ? shortEdge < 600 && longEdge < 1100
    : false;
  const showMobileAdminShell = Boolean(showAdminWorkspace && isPhoneViewport);
  const mobileAdminShellValue = useMemo(() => ({
    showMobileAdminShell,
    openMobileNav: () => setMobileNavOpen(true),
    suppressScreenHeader: false,
    topInset: Math.max(insets.top, 0),
  }), [insets.top, showMobileAdminShell]);
  const tabletShellValue = useMemo(() => ({
    showMobileAdminShell: false,
    openMobileNav: () => {},
    suppressScreenHeader: true,
    topInset: 0,
  }), []);
  const activeRouteParams = navigationRef?.getCurrentRoute?.()?.params || null;
  const activeRouteChildId = String(activeRouteParams?.childId || '').trim();

  useEffect(() => {
    setQuickMenuOpen(false);
  }, [currentRoute]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [currentRoute]);

  useEffect(() => {
    if (showHeaderQuickMenu) return;
    setQuickMenuOpen(false);
  }, [showHeaderQuickMenu]);

  useEffect(() => {
    setQuickLogDraft(null);
    setQuickLogBody('');
    setQuickLogSaving(false);
  }, [currentRoute]);

  useEffect(() => {
    if (!breakEndsAt) return undefined;
    setBreakNow(Date.now());
    const timerId = setInterval(() => {
      setBreakNow(Date.now());
    }, 1000);
    return () => clearInterval(timerId);
  }, [breakEndsAt]);

  useEffect(() => {
    if (!breakEndsAt) return;
    if (breakNow < breakEndsAt) return;
    setBreakEndsAt(null);
    setBreakDurationMinutes(0);
  }, [breakEndsAt, breakNow]);

  useEffect(() => {
    const Notifications = getNotificationsModule();
    if (!Notifications || typeof Notifications.addNotificationReceivedListener !== 'function') return undefined;
    const subscription = Notifications.addNotificationReceivedListener((event) => {
      const data = event?.request?.content?.data || {};
      if (data?.type !== 'break-end') return;
      setBreakEndsAt(null);
      setBreakDurationMinutes(0);
      Alert.alert('Break complete', `Your ${data?.minutes || 0}-minute break has ended.`);
    });
    return () => {
      subscription?.remove?.();
    };
  }, []);

  async function cancelBreakNotifications() {
    const Notifications = getNotificationsModule();
    if (!Notifications || typeof Notifications.cancelScheduledNotificationAsync !== 'function') {
      breakNotificationIdsRef.current = [];
      return;
    }
    const ids = [...breakNotificationIdsRef.current];
    breakNotificationIdsRef.current = [];
    await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  }

  async function startBreak(minutes) {
    const durationMinutes = Number(minutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return;

    const endAt = Date.now() + (durationMinutes * 60 * 1000);
    setBreakPickerOpen(false);
    setBreakDurationMinutes(durationMinutes);
    setBreakEndsAt(endAt);
    setBreakNow(Date.now());
    await cancelBreakNotifications();

    const setup = await ensureBreakNotificationsReady();
    if (!setup.ok || !setup.Notifications) return;

    const Notifications = setup.Notifications;
    const scheduledIds = [];

    if (durationMinutes > 2) {
      const warningId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Break reminder',
          body: '2 minutes left on your break.',
          sound: 'default',
          channelId: 'default',
          data: { type: 'break-warning', minutes: durationMinutes },
        },
        trigger: { seconds: Math.max(1, durationMinutes * 60 - 120) },
      }).catch(() => null);
      if (warningId) scheduledIds.push(warningId);
    }

    const endId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Break complete',
        body: `Your ${durationMinutes}-minute break is over.`,
        sound: 'default',
        channelId: 'default',
        data: { type: 'break-end', minutes: durationMinutes },
      },
      trigger: { seconds: Math.max(1, durationMinutes * 60) },
    }).catch(() => null);
    if (endId) scheduledIds.push(endId);
    breakNotificationIdsRef.current = scheduledIds;
  }

  const linkedTherapistChildren = useMemo(() => {
    const therapistId = String(user?.id || '').trim();
    if (!showQuickAdd || !therapistId) return [];
    return (Array.isArray(directoryChildren) ? directoryChildren : []).filter((child) => isChildLinkedToTherapist(child, therapistId));
  }, [directoryChildren, showQuickAdd, user?.id]);

  const activeQuickChild = useMemo(() => {
    if (!linkedTherapistChildren.length) return null;
    return linkedTherapistChildren.find((child) => String(child?.id || '').trim() === activeRouteChildId) || linkedTherapistChildren[0] || null;
  }, [activeRouteChildId, linkedTherapistChildren]);

  const quickLogRecipients = useMemo(() => {
    return (Array.isArray(therapists) ? therapists : [])
      .filter((staff) => {
        if (!staff?.id) return false;
        if (String(staff.id) === String(user?.id || '')) return false;
        return isBcbaRole(staff?.role) || isOfficeAdminRole(staff?.role);
      })
      .map((staff) => ({
        id: staff.id,
        role: staff.role || 'office',
        name: staff.name || `${staff.firstName || ''} ${staff.lastName || ''}`.trim() || staff.email || 'Staff',
      }));
  }, [therapists, user?.id]);

  const quickMenuWidth = useMemo(() => {
    const drawerWidth = collapsed ? 92 : 280;
    const availableWidth = Math.max(176, width - drawerWidth - 120);
    return Math.max(176, Math.min(220, availableWidth));
  }, [collapsed, width]);

  const quickHeaderMenuItems = useMemo(() => {
    if (showBcbaQuickActions) {
      return [
        { key: 'program', label: 'Add Program', target: { root: 'Controls', screen: 'ProgramDirectory', params: { focusMode: 'editor' } } },
        { key: 'documentation', label: 'Documentation', target: { root: 'Controls', screen: 'TherapistDocumentationDashboard' } },
        { key: 'insights', label: 'Org Insights', target: { root: 'Controls', screen: 'OrganizationInsightsDashboard' } },
      ];
    }
    if (showQuickAdd) {
      return [
        { key: 'quick-note', label: 'Quick Note', logType: 'quick_note', modalTitle: 'Quick Note', placeholder: 'Add a short session note for office or BCBA follow-up.' },
        { key: 'incident', label: 'Incident Log', logType: 'incident_log', modalTitle: 'Incident Log', placeholder: 'Describe the incident and any immediate action taken.' },
        { key: 'unexpected-data', label: 'Unexpected Data', logType: 'unexpected_data', modalTitle: 'Unexpected Data', placeholder: 'Describe the unexpected session data or observation.' },
      ];
    }
    return [];
  }, [showBcbaQuickActions, showQuickAdd]);

  function openQuickLogModal(item) {
    if (!activeQuickChild?.id) {
      Alert.alert('Select a learner', 'Open a learner workspace first so the quick log can be attached to the correct record.');
      return;
    }
    setQuickMenuOpen(false);
    setQuickLogBody('');
    setQuickLogDraft(item);
  }

  async function submitQuickLog() {
    if (!quickLogDraft?.logType) return;
    if (!activeQuickChild?.id) {
      Alert.alert('Select a learner', 'Open a learner workspace first so the quick log can be attached to the correct record.');
      return;
    }
    const body = String(quickLogBody || '').trim();
    if (!body) {
      Alert.alert('Add details', 'Enter a note before saving this quick log.');
      return;
    }
    setQuickLogSaving(true);
    try {
      const created = await createStaffLog?.({
        type: quickLogDraft.logType,
        title: `${quickLogDraft.modalTitle} · ${activeQuickChild?.name || 'Learner'}`,
        body,
        childId: activeQuickChild.id,
        recipients: quickLogRecipients,
      });
      if (!created) {
        throw new Error('The quick log could not be saved.');
      }
      setQuickLogDraft(null);
      setQuickLogBody('');
      Alert.alert('Saved', `${quickLogDraft.modalTitle} was saved for ${activeQuickChild?.name || 'the selected learner'}.`);
    } catch (error) {
      Alert.alert('Save failed', String(error?.message || error || 'The quick log could not be saved.'));
    } finally {
      setQuickLogSaving(false);
    }
  }

  async function checkForOtaUpdate() {
    if (Platform.OS === 'web') {
      Alert.alert('Not supported', 'EAS Update is not supported on web.');
      return;
    }
    if (!Updates.isEnabled) {
      Alert.alert(
        'Updates disabled',
        'This build does not have expo-updates enabled, or you are running a dev session. Install an EAS-built binary to receive OTA updates.'
      );
      return;
    }

    try {
      setUpdateBusy(true);
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        Alert.alert('Up to date', 'No update is available for this channel/runtime version.');
        return;
      }

      await Updates.fetchUpdateAsync();
      Alert.alert(
        'Update downloaded',
        'Restart the app to apply it now.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Restart now', onPress: () => Updates.reloadAsync().catch(() => {}) },
        ]
      );
    } catch (error) {
      Alert.alert('Update check failed', error?.message || String(error));
    } finally {
      setUpdateBusy(false);
    }
  }

  const navGroups = useMemo(() => {
    if (showAdminWorkspace) {
      return [
        {
          label: 'Admin',
          items: [
            { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', target: { root: 'Controls', screen: 'ControlsMain' } },
            { key: 'students', label: 'Students', icon: 'school', target: { root: 'Controls', screen: 'StudentDirectory' }, section: ADMIN_SECTION_KEYS.STUDENTS },
            { key: 'staff', label: 'Staff', icon: 'groups', target: { root: 'Controls', screen: 'FacultyDirectory' }, section: ADMIN_SECTION_KEYS.STAFF },
            { key: 'scheduling', label: 'Scheduling', icon: 'event', target: { root: 'Controls', screen: 'ScheduleCalendar' }, section: ADMIN_SECTION_KEYS.SCHEDULING },
            { key: 'programs', label: 'Programs & Goals', icon: 'assignment', target: { root: 'Controls', screen: 'ProgramDirectory' }, section: ADMIN_SECTION_KEYS.PROGRAMS_GOALS },
            { key: 'reports', label: 'Data & Reports', icon: 'query-stats', target: { root: 'Controls', screen: 'Reports' }, section: ADMIN_SECTION_KEYS.DATA_REPORTS },
            { key: 'billing', label: 'Billing & Authorizations', icon: 'receipt-long', target: { root: 'Controls', screen: 'InsuranceBilling' }, section: ADMIN_SECTION_KEYS.BILLING_AUTHORIZATIONS },
            { key: 'compliance', label: 'Compliance', icon: 'verified-user', target: { root: 'Controls', screen: 'AdminAlerts' }, section: ADMIN_SECTION_KEYS.COMPLIANCE },
            { key: 'communication', label: 'Communication', icon: 'forum', target: { root: 'Controls', screen: 'AdminChatMonitor' }, section: ADMIN_SECTION_KEYS.COMMUNICATION },
            { key: 'settings', label: 'Settings', icon: 'settings', target: { root: 'Controls', screen: 'AdminSettings' }, section: ADMIN_SECTION_KEYS.SETTINGS },
          ].filter((item) => !item.section || canAccessAdminSection(user?.role, item.section)),
        },
      ];
    }

    if (isParentWorkspace) {
      return [{
        label: workspaceLabel,
        items: [
          { key: 'dashboard', label: labels.dashboard || 'Dashboard', icon: 'dashboard', target: { root: 'Home', screen: 'CommunityMain' } },
          { key: 'messages', label: 'Chats', icon: 'chat', target: { root: 'Chats', screen: 'ChatsList' } },
          { key: 'my-child', label: 'My Child', icon: 'child-care', target: { root: 'MyChild', screen: 'MyChildMain' } },
          { key: 'settings', label: 'Settings', icon: 'settings', target: { root: 'Settings', screen: 'SettingsMain' } },
        ],
      }];
    }

    const therapistItems = [
      { key: 'dashboard', label: labels.dashboard || 'Dashboard', icon: 'dashboard', target: { root: 'Home', screen: 'CommunityMain' } },
      { key: 'tap-tracker', label: 'Tap Tracker', icon: 'touch-app', target: { root: 'Home', screen: 'TapTracker', params: { sessionPreview: true } } },
      { key: 'tap-logs', label: 'Tap Logs', icon: 'format-list-bulleted', target: { root: 'Home', screen: 'TapLogs', params: { sessionPreview: true } } },
      { key: 'session-report', label: 'Session Report', icon: 'fact-check', target: { root: 'Home', screen: 'SummaryReview', params: { sessionPreview: true } } },
      { key: 'schedule', label: 'Schedule', icon: 'event', target: { root: 'Home', screen: 'ScheduleCalendar' } },
      { key: 'messages', label: 'Messages', icon: 'chat', target: { root: 'Chats', screen: 'ChatsList' } },
      { key: 'settings', label: 'Settings', icon: 'settings', target: { root: 'Settings', screen: 'SettingsMain' } },
    ];

    return [{ label: workspaceLabel, items: therapistItems }];
  }, [isParentWorkspace, isStaff, labels.dashboard, showAdminWorkspace, user?.role, workspaceLabel]);

  if (!isTabletLayout && !showMobileAdminShell) return children;

  const renderNavItems = (collapsedItems = false, onItemPress = null) => (
    <>
      {navGroups.map((group) => (
        <View key={group.label} style={styles.group}>
          {!collapsedItems ? <Text style={styles.groupLabel}>{group.label}</Text> : null}
          {group.items.map((item) => {
            const active = currentRoute === (item.target.screen || item.target.root);
            return (
              <TouchableOpacity
                key={item.key}
                style={[styles.navItem, active ? styles.navItemActive : null]}
                onPress={() => {
                  openTarget(item.target);
                  onItemPress?.();
                }}
              >
                <MaterialIcons name={item.icon} size={active ? 24 : 20} color="#f8fafc" />
                {!collapsedItems ? <Text style={[styles.navLabel, active ? styles.navLabelActive : null]}>{item.label}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </>
  );

  if (showMobileAdminShell) {
    return (
      <MobileAdminShellContext.Provider value={mobileAdminShellValue}>
        <View style={styles.mobileShellFrame}>
          <View style={[styles.contentWrap, styles.mobileContentWrap, { paddingTop: 0, paddingBottom: 0 }]}>
            <View style={styles.mobileScreenWrap}>{children}</View>
          </View>
          {mobileNavOpen ? (
            <View
              style={[
                styles.mobileNavOverlayShell,
                {
                  top: Math.max(insets.top, 16),
                  bottom: Math.max(insets.bottom, 0) + 42,
                },
              ]}
            >
              <View style={styles.mobileNavOverlay}>
                <View style={styles.mobileNavHeader}>
                  <View>
                    <Text style={styles.mobileNavTitle} numberOfLines={2}>{drawerGreeting}</Text>
                  </View>
                  <TouchableOpacity style={styles.mobileNavCloseButton} onPress={() => setMobileNavOpen(false)} accessibilityLabel="Close navigation menu">
                    <MaterialIcons name="close" size={24} color="#0f172a" />
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.mobileNavScroll} contentContainerStyle={styles.mobileNavScrollContent} showsVerticalScrollIndicator>
                  {renderNavItems(false, () => setMobileNavOpen(false))}
                  <View style={styles.mobileFooterSection}>
                    <TouchableOpacity style={[styles.mobileBreakButton, breakEndsAt ? styles.mobileBreakButtonActive : null]} onPress={() => setBreakPickerOpen(true)}>
                      <MaterialIcons name="free-breakfast" size={20} color="#0f172a" />
                      <Text style={styles.mobileBreakText}>Break</Text>
                      {breakEndsAt ? <Text style={styles.mobileBreakTimerText}>{formatBreakCountdown(breakEndsAt, breakNow)}</Text> : null}
                    </TouchableOpacity>
                    <View style={styles.mobileUtilitySection}>
                      <TouchableOpacity style={styles.mobileUtilityButton} onPress={() => { setMobileNavOpen(false); openTarget({ root: 'Settings', screen: 'Help' }); }}>
                        <MaterialIcons name="help-outline" size={20} color="#1d4ed8" />
                        <Text style={styles.mobileUtilityText}>Help</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.mobileUtilityButton, updateBusy ? styles.mobileUtilityButtonDisabled : null]} onPress={checkForOtaUpdate} disabled={updateBusy}>
                        <Image source={checkUpdatesIcon} style={[styles.mobileUtilityIcon, updateBusy ? styles.drawerUtilityIconDisabled : null]} resizeMode="contain" />
                        <Text style={styles.mobileUtilityText}>{updateBusy ? 'Checking for updates...' : 'Check for updates'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.mobileLogoutButton} onPress={() => { setMobileNavOpen(false); logout?.(); }}>
                        <MaterialIcons name="logout" size={20} color="#b91c1c" />
                        <Text style={styles.mobileLogoutText}>Logout</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </ScrollView>
              </View>
            </View>
          ) : null}
          <View style={[styles.mobileBottomMenuShell, { paddingBottom: Math.max(insets.bottom, 0) }]}>
            <TouchableOpacity
              style={styles.mobileBottomMenuButton}
              onPress={() => setMobileNavOpen((current) => !current)}
              accessibilityLabel={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            >
              <MaterialIcons name={mobileNavOpen ? 'close' : 'menu'} size={22} color="#ffffff" />
            </TouchableOpacity>
          </View>
          <Modal visible={breakPickerOpen} transparent animationType="fade" onRequestClose={() => setBreakPickerOpen(false)}>
            <TouchableOpacity style={styles.breakModalBackdrop} activeOpacity={1} onPress={() => setBreakPickerOpen(false)}>
              <TouchableOpacity activeOpacity={1} style={styles.breakModalCard} onPress={() => {}}>
                <Text style={styles.breakModalTitle}>Break</Text>
                <Text style={styles.breakModalSubtitle}>Choose a break length.</Text>
                <View style={styles.breakGrid}>
                  {BREAK_OPTIONS.map((minutes) => (
                    <TouchableOpacity key={minutes} style={styles.breakOptionButton} onPress={() => startBreak(minutes)}>
                      <Text style={styles.breakOptionText}>{minutes} min</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        </View>
      </MobileAdminShellContext.Provider>
    );
  }

  return (
    <MobileAdminShellContext.Provider value={tabletShellValue}>
      <View style={styles.shellFrame}>
        <View style={[styles.shellHeader, { paddingTop: Platform.OS !== 'web' ? Math.max(insets.top, 12) : 12 }]}> 
          <Text style={styles.shellHeaderTitle} numberOfLines={1}>{currentScreenTitle}</Text>
        </View>
        <View style={styles.shell}>
          <View style={[styles.drawer, { paddingTop: 20, paddingBottom: 20 + Math.max(insets.bottom, 0) }, collapsed ? styles.drawerCollapsed : null]}>
          <View style={[styles.drawerBrandWrap, collapsed ? styles.drawerBrandWrapCollapsed : null]}>
          </View>
          {!collapsed ? (
            <View style={styles.drawerIdentityWrap}>
              <Text style={styles.drawerIdentityText} numberOfLines={2}>{drawerGreeting}</Text>
            </View>
          ) : null}
          {Platform.OS !== 'web' ? (
            <TouchableOpacity style={styles.drawerToggle} onPress={() => setCollapsed((value) => !value)}>
              <MaterialIcons name={collapsed ? 'menu' : 'menu-open'} size={22} color="#e2e8f0" />
              {!collapsed ? <Text style={styles.drawerToggleText}>Collapse</Text> : null}
            </TouchableOpacity>
          ) : null}

          {renderNavItems(collapsed)}
          {showHeaderQuickMenu ? (
            <View style={styles.drawerQuickActionWrap}>
              <TouchableOpacity
                style={[styles.drawerQuickActionButton, quickMenuOpen ? styles.drawerQuickActionButtonActive : null]}
                onPress={() => setQuickMenuOpen((value) => !value)}
                accessibilityLabel={showBcbaQuickActions ? 'Quick actions' : 'Quick add'}
              >
                <MaterialIcons name="add" size={20} color="#f8fafc" />
                {!collapsed ? <Text style={styles.drawerQuickActionText}>{showBcbaQuickActions ? 'Quick actions' : 'Quick add'}</Text> : null}
              </TouchableOpacity>
              {quickMenuOpen ? (
                <View style={[styles.drawerQuickMenu, { width: collapsed ? 216 : quickMenuWidth }]}> 
                  {quickHeaderMenuItems.map((item) => (
                    <TouchableOpacity
                      key={item.key}
                      style={styles.quickHeaderMenuItem}
                      onPress={() => {
                        setQuickMenuOpen(false);
                        if (item.target) {
                          openTarget(item.target);
                          return;
                        }
                        if (item.logType) {
                          openQuickLogModal(item);
                        }
                      }}
                    >
                      <Text style={styles.quickHeaderMenuText}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.drawerUtilitySection}>
            <TouchableOpacity style={[styles.drawerUtilityButton, breakEndsAt ? styles.drawerUtilityButtonActive : null]} onPress={() => setBreakPickerOpen(true)}>
              <MaterialIcons name="free-breakfast" size={20} color="#f8fafc" />
              {!collapsed ? <Text style={styles.drawerUtilityText}>Break</Text> : null}
              {!collapsed && breakEndsAt ? <Text style={styles.drawerUtilityTimerText}>{formatBreakCountdown(breakEndsAt, breakNow)}</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity style={styles.drawerUtilityButton} onPress={() => openTarget({ root: 'Settings', screen: 'Help' })}>
              <MaterialIcons name="help-outline" size={20} color="#f8fafc" />
              {!collapsed ? <Text style={styles.drawerUtilityText}>Help</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.drawerUtilityButton, updateBusy ? styles.drawerUtilityButtonDisabled : null]} onPress={checkForOtaUpdate} disabled={updateBusy}>
              <Image source={checkUpdatesIcon} style={[styles.drawerUtilityIcon, updateBusy ? styles.drawerUtilityIconDisabled : null]} resizeMode="contain" />
              {!collapsed ? <Text style={styles.drawerUtilityText}>{updateBusy ? 'Checking…' : 'Check for updates'}</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity style={styles.logoutButton} onPress={() => logout?.()}>
              <MaterialIcons name="logout" size={20} color="#fecaca" />
              {!collapsed ? <Text style={styles.logoutText}>Logout</Text> : null}
            </TouchableOpacity>
          </View>
        </View>

          <View style={[styles.contentWrap, { paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Modal visible={breakPickerOpen} transparent animationType="fade" onRequestClose={() => setBreakPickerOpen(false)}>
              <TouchableOpacity style={styles.breakModalBackdrop} activeOpacity={1} onPress={() => setBreakPickerOpen(false)}>
                <TouchableOpacity activeOpacity={1} style={styles.breakModalCard} onPress={() => {}}>
                  <Text style={styles.breakModalTitle}>Break</Text>
                  <Text style={styles.breakModalSubtitle}>Choose a break length.</Text>
                  <View style={styles.breakGrid}>
                    {BREAK_OPTIONS.map((minutes) => (
                      <TouchableOpacity key={minutes} style={styles.breakOptionButton} onPress={() => startBreak(minutes)}>
                        <Text style={styles.breakOptionText}>{minutes} min</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>
            <Modal visible={!!quickLogDraft} transparent animationType="fade" onRequestClose={() => !quickLogSaving && setQuickLogDraft(null)}>
              <View style={styles.modalOverlay}>
                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>{quickLogDraft?.modalTitle || 'Quick Log'}</Text>
                  <Text style={styles.modalSubtitle}>Save this note to {activeQuickChild?.name || 'the selected learner'} and notify office or BCBA reviewers.</Text>
                  <TextInput
                    value={quickLogBody}
                    onChangeText={setQuickLogBody}
                    placeholder={quickLogDraft?.placeholder || 'Add details'}
                    multiline
                    editable={!quickLogSaving}
                    style={styles.modalInput}
                  />
                  <View style={styles.modalActions}>
                    <TouchableOpacity style={styles.modalSecondaryBtn} onPress={() => setQuickLogDraft(null)} disabled={quickLogSaving}>
                      <Text style={styles.modalSecondaryBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.modalPrimaryBtn} onPress={submitQuickLog} disabled={quickLogSaving}>
                      <Text style={styles.modalPrimaryBtnText}>{quickLogSaving ? 'Saving...' : 'Save Log'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
            <View style={styles.screenWrap}>{children}</View>
          </View>
        </View>
      </View>
    </MobileAdminShellContext.Provider>
  );
}

const styles = StyleSheet.create({
  shellFrame: { flex: 1, backgroundColor: '#e2e8f0' },
  mobileShellFrame: { flex: 1, backgroundColor: '#ffffff' },
  shellHeader: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 24,
    paddingBottom: 12,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  shellHeaderTitle: { color: '#0f172a', fontWeight: '800', fontSize: 24, lineHeight: 30, textAlign: 'center' },
  shell: { flex: 1, flexDirection: 'row', backgroundColor: '#e2e8f0' },
  drawer: { width: 280, backgroundColor: '#0f172a', paddingHorizontal: 16 },
  drawerCollapsed: { width: 92, paddingHorizontal: 10 },
  drawerBrandWrap: { alignItems: 'flex-start', justifyContent: 'center', marginBottom: 8, minHeight: 12 },
  drawerBrandWrapCollapsed: { alignItems: 'center' },
  drawerIdentityWrap: { marginBottom: 16, paddingHorizontal: 6 },
  drawerIdentityText: { color: '#e2e8f0', fontWeight: '800', fontSize: 16, lineHeight: 22 },
  drawerToggle: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  drawerToggleText: { color: '#e2e8f0', fontWeight: '700', marginLeft: 10 },
  group: { marginBottom: 18 },
  groupLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginBottom: 3 },
  navItem: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 4.5, backgroundColor: '#172554' },
  navItemActive: { backgroundColor: '#2563eb' },
  navLabel: { color: '#f8fafc', fontWeight: '700', marginLeft: 10, fontSize: 15 },
  navLabelActive: { color: '#f8fafc', fontSize: 16 },
  drawerQuickActionWrap: { marginBottom: 12, position: 'relative' },
  drawerQuickActionButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#1d4ed8' },
  drawerQuickActionButtonActive: { backgroundColor: '#1e40af' },
  drawerQuickActionText: { color: '#f8fafc', fontWeight: '700', marginLeft: 10 },
  drawerQuickMenu: { position: 'absolute', top: 48, left: 0, borderRadius: 14, borderWidth: 1, borderColor: '#dbe4f0', backgroundColor: '#ffffff', paddingVertical: 8, shadowColor: '#0f172a', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8, zIndex: 10 },
  drawerUtilitySection: { marginTop: 'auto' },
  drawerUtilityButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#1e293b', marginBottom: 8 },
  drawerUtilityButtonActive: { backgroundColor: '#1e40af' },
  drawerUtilityButtonDisabled: { opacity: 0.72 },
  drawerUtilityIcon: { width: 20, height: 20 },
  drawerUtilityIconDisabled: { opacity: 0.5 },
  drawerUtilityText: { color: '#e2e8f0', fontWeight: '700', marginLeft: 10 },
  drawerUtilityTimerText: { color: '#f8fafc', fontWeight: '800', marginLeft: 'auto' },
  logoutButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#1e293b' },
  logoutText: { color: '#fecaca', fontWeight: '700', marginLeft: 10 },
  contentWrap: { flex: 1, paddingHorizontal: 12, position: 'relative' },
  mobileContentWrap: { paddingHorizontal: 0 },
  quickMenuDismissLayer: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  topBar: { minHeight: 70, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 18, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, zIndex: 30 },
  mobileTopBar: { paddingHorizontal: 14, alignItems: 'flex-start' },
  brandRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  mobileBrandRow: { flex: 1, minWidth: 0 },
  greetingWrap: { marginLeft: 14 },
  mobileGreetingWrap: { flex: 1, minWidth: 0, marginLeft: 12 },
  topTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  mobileTopTitle: { fontSize: 16 },
  headerActions: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' },
  mobileHeaderActions: { flexShrink: 0, marginLeft: 12 },
  quickAddAnchor: { position: 'relative', marginLeft: 10 },
  iconOnlyButton: { width: 40, height: 40, borderRadius: 20, marginLeft: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eff6ff' },
  quickAddButton: { marginLeft: 0 },
  iconOnlyButtonActive: { backgroundColor: '#dbeafe' },
  quickHeaderMenu: { position: 'absolute', top: 44, right: 0, borderRadius: 14, borderWidth: 1, borderColor: '#dbe4f0', backgroundColor: '#ffffff', paddingVertical: 8, shadowColor: '#0f172a', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  quickHeaderMenuItem: { paddingVertical: 10, paddingHorizontal: 14 },
  quickHeaderMenuText: { color: '#0f172a', fontWeight: '700' },
  screenWrap: { flex: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: '#f8fafc' },
  mobileScreenWrap: { flex: 1, borderRadius: 0, overflow: 'visible', backgroundColor: '#ffffff' },
  mobileNavOverlayShell: { position: 'absolute', left: 0, right: 0, zIndex: 20 },
  mobileNavOverlay: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  mobileNavHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  mobileNavTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a', lineHeight: 24, maxWidth: 260 },
  mobileNavCloseButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0' },
  mobileNavScroll: { flex: 1 },
  mobileNavScrollContent: { flexGrow: 1, paddingBottom: 0 },
  mobileBottomMenuShell: {
    backgroundColor: '#ffffff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    paddingTop: 0,
  },
  mobileBottomMenuButton: {
    width: '100%',
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1d4ed8',
  },
  mobileFooterSection: { marginTop: 'auto' },
  mobileBreakButton: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: '#dbe2ea', backgroundColor: '#ffffff', marginTop: 10 },
  mobileBreakButtonActive: { backgroundColor: '#eff6ff', borderColor: '#93c5fd' },
  mobileBreakText: { color: '#0f172a', fontWeight: '700', marginLeft: 10 },
  mobileBreakTimerText: { color: '#0f172a', fontWeight: '800', marginLeft: 'auto' },
  mobileUtilitySection: { marginTop: 6, paddingTop: 8, paddingBottom: 6, borderTopWidth: 1, borderTopColor: '#dbe2ea' },
  mobileUtilityButton: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 12, backgroundColor: '#eff6ff', marginBottom: 10 },
  mobileUtilityButtonDisabled: { opacity: 0.72 },
  mobileUtilityIcon: { width: 20, height: 20 },
  mobileUtilityText: { color: '#0f172a', fontWeight: '700', marginLeft: 10 },
  mobileLogoutButton: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 12, backgroundColor: '#fee2e2' },
  mobileLogoutText: { color: '#b91c1c', fontWeight: '800', marginLeft: 10 },
  breakModalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.25)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  breakModalCard: { borderRadius: 18, backgroundColor: '#ffffff', padding: 16, minWidth: 220 },
  breakModalTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  breakModalSubtitle: { marginTop: 4, marginBottom: 12, color: '#64748b' },
  breakGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  breakOptionButton: { width: '48%', borderRadius: 12, borderWidth: 1, borderColor: '#dbe2ea', backgroundColor: '#f8fafc', paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  breakOptionText: { color: '#0f172a', fontWeight: '800' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 24 },
  modalCard: { borderRadius: 20, backgroundColor: '#ffffff', padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  modalSubtitle: { marginTop: 6, color: '#64748b' },
  modalInput: { marginTop: 14, minHeight: 120, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  modalSecondaryBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#e2e8f0', marginRight: 8 },
  modalSecondaryBtnText: { color: '#0f172a', fontWeight: '700' },
  modalPrimaryBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563eb' },
  modalPrimaryBtnText: { color: '#ffffff', fontWeight: '700' },
});