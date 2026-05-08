import React, { useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar, Platform, AppState, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// Temporarily remove TailwindProvider if not available at runtime
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthProvider, useAuth } from './src/AuthContext';
import { DataProvider } from './src/DataContext';
import UrgentMemoOverlay from './src/components/UrgentMemoOverlay';
import BottomNav from './src/components/BottomNav';
import ErrorBoundary from './src/components/ErrorBoundary';
import ArrivalDetector from './src/components/ArrivalDetector';
import DevRoleSwitcher from './src/components/DevRoleSwitcher';
import { logger, setDebugContext } from './src/utils/logger';
import { registerGlobalDebugHandlers } from './src/utils/registerDebugHandlers';
import { configureNotificationHandling } from './src/utils/pushNotifications';
import { navigationRef, resetToLogin } from './src/navigationRef';
import { isPhoneViewport as resolvePhoneViewport } from './src/utils/mobileRoleAccess';

import RoleDashboardScreen from './src/screens/RoleDashboardScreen';
import InsuranceBillingScreen from './src/screens/InsuranceBillingScreen';
import TherapistItemsNeededScreen from './src/screens/TherapistItemsNeededScreen';
import CareTeamScreen from './src/screens/CareTeamScreen';
import ScheduleCalendarScreen from './src/screens/ScheduleCalendarScreen';
import ChatsScreen from './src/screens/ChatsScreen';
import ChatThreadScreen from './src/screens/ChatThreadScreen';
import NewThreadScreen from './src/screens/NewThreadScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AdminSettingsHubScreen from './src/screens/AdminSettingsHubScreen';
import AdminSettingsWorkspaceScreen from './src/screens/AdminSettingsWorkspaceScreen';
import EditProfileScreen from './src/screens/EditProfileScreen';
import HelpScreen from './src/screens/HelpScreen';
import MyClassScreen from './src/screens/MyClassScreen';
import MyChildScreen from './src/screens/MyChildScreen';
import AdminControlsScreen from './src/screens/AdminControlsScreen';
import AdminChatMonitorScreen from './src/screens/AdminChatMonitorScreen';
import UserMonitorScreen from './src/screens/UserMonitorScreen';
import StudentDirectoryScreen from './src/screens/StudentDirectoryScreen';
import FacultyDirectoryScreen from './src/screens/FacultyDirectoryScreen';
import ParentDirectoryScreen from './src/screens/ParentDirectoryScreen';
import ParentDetailScreen from './src/screens/ParentDetailScreen';
import ChildDetailScreen from './src/screens/ChildDetailScreen';
import FacultyDetailScreen from './src/screens/FacultyDetailScreen';
import TapTrackerScreen from './src/screens/TapTrackerScreen';
import TapLogsScreen from './src/screens/TapLogsScreen';
import SummaryReviewScreen from './src/screens/SummaryReviewScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import ManagePermissionsScreen from './src/screens/ManagePermissionsScreen';
import PrivacyDefaultsScreen from './src/screens/PrivacyDefaultsScreen';
import AdminAlertsScreen from './src/screens/AdminAlertsScreen';
import AdminMemosScreen from './src/screens/AdminMemosScreen';
import ExportDataScreen from './src/screens/ExportDataScreen';
import ImportCenterScreen from './src/screens/ImportCenterScreen';
import AttendanceScreen from './src/screens/modules/AttendanceScreen';
import ProgramDirectoryScreen from './src/screens/modules/ProgramDirectoryScreen';
import CampusDirectoryScreen from './src/screens/modules/CampusDirectoryScreen';
import ProgramDocumentsScreen from './src/screens/modules/ProgramDocumentsScreen';
import CampusDocumentsScreen from './src/screens/modules/CampusDocumentsScreen';
import BcbaSessionReviewQueueScreen from './src/features/aba/screens/BcbaSessionReviewQueueScreen';
import LearnerClinicalProfileScreen from './src/features/aba/screens/LearnerClinicalProfileScreen';
import ChildProgressInsightsScreen from './src/features/sessionInsights/screens/ChildProgressInsightsScreen';
import TherapistDocumentationDashboardScreen from './src/features/sessionInsights/screens/TherapistDocumentationDashboardScreen';
import OrganizationInsightsDashboardScreen from './src/features/sessionInsights/screens/OrganizationInsightsDashboardScreen';
import { HelpButton, BackButton } from './src/components/TopButtons';
import { View, Text } from 'react-native';
import LoginScreen from './screens/LoginScreen';
import TwoFactorScreen from './screens/TwoFactorScreen';
import CreatePasswordScreen from './screens/CreatePasswordScreen';
import { initSentry, Sentry } from './src/sentry';
import { CommonActions } from '@react-navigation/native';
import { TenantProvider } from './src/core/tenant/TenantContext';
import { canAccessAdminWorkspace, isAdminRole, isBcbaRole, isStaffRole, normalizeUserRole } from './src/core/tenant/models';
import { humanizeScreenLabel } from './src/utils/screenLabels';
import TabletNavigationShell from './src/components/TabletNavigationShell';
import useIsTabletLayout from './src/hooks/useIsTabletLayout';
import { consumeApprovalAccessIntent, getApprovalAccessNavigationParams } from './src/utils/approvalAccessIntent';
import { shouldShowSubscreenBack } from './src/utils/backNavigation';

const shouldSilenceNativeReleaseConsole = Platform.OS !== 'web' && !(typeof __DEV__ !== 'undefined' && __DEV__);
if (shouldSilenceNativeReleaseConsole && typeof console !== 'undefined') {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
}

initSentry();

const RootStack = createNativeStackNavigator();
const AppStack = createNativeStackNavigator();

const HEADER_HEIGHT = 96;
const SHOW_STACK_HEADERS = Platform.OS !== 'web';

function StackHeaderTitle({ children }) {
  return (
    <Text
      style={landscapeStyles.stackHeaderTitle}
      numberOfLines={2}
      ellipsizeMode="tail"
    >
      {children}
    </Text>
  );
}

function getDeepestRouteName(state) {
  try {
    const route = state?.routes?.[state.index || 0];
    if (!route) return null;
    if (route.state) return getDeepestRouteName(route.state);
    return route.name || null;
  } catch (_) {
    return null;
  }
}

const MyClassStackNav = createNativeStackNavigator();
function MyClassStack() {
  const isTabletLayout = useIsTabletLayout();
  return (
    <MyClassStackNav.Navigator
      screenOptions={({ navigation, route, back }) => {
        const showBack = Boolean(back) && shouldShowSubscreenBack(navigation, route?.name);
        return {
          headerShown: SHOW_STACK_HEADERS && !isTabletLayout,
          title: humanizeScreenLabel(route?.name),
          headerTitleAlign: 'center',
          headerTitle: ({ children }) => <StackHeaderTitle>{children}</StackHeaderTitle>,
          headerStyle: { height: HEADER_HEIGHT },
          headerBackVisible: showBack,
          headerBackTitleVisible: false,
          headerLeft: () => (showBack ? <BackButton onPress={() => navigation.goBack()} /> : null),
          headerRight: () => <HelpButton />,
        };
      }}
    >
      <MyClassStackNav.Screen name="MyClassMain" component={MyClassScreen} options={{ title: 'My Class' }} />
    </MyClassStackNav.Navigator>
  );
}

const ControlsStackNav = createNativeStackNavigator();
function ControlsStack() {
  const isTabletLayout = useIsTabletLayout();
  return (
    <ControlsStackNav.Navigator
      screenOptions={({ navigation, route, back }) => {
        const showBack = Boolean(back) && shouldShowSubscreenBack(navigation, route?.name);
        return {
          headerShown: SHOW_STACK_HEADERS && !isTabletLayout,
          title: humanizeScreenLabel(route?.name),
          headerTitleAlign: 'center',
          headerTitle: ({ children }) => <StackHeaderTitle>{children}</StackHeaderTitle>,
          headerStyle: { height: HEADER_HEIGHT },
          headerBackVisible: showBack,
          headerBackTitleVisible: false,
          headerLeft: () => (showBack ? <BackButton onPress={() => navigation.goBack()} /> : null),
          headerRight: () => <HelpButton />,
        };
      }}
    >
      <ControlsStackNav.Screen name="ControlsMain" component={AdminControlsScreen} options={{ title: 'Dashboard' }} />
      <ControlsStackNav.Screen name="StudentDirectory" component={StudentDirectoryScreen} options={{ title: 'Students' }} />
      <ControlsStackNav.Screen name="FacultyDirectory" component={FacultyDirectoryScreen} options={{ title: 'Staff' }} />
      <ControlsStackNav.Screen name="ParentDirectory" component={ParentDirectoryScreen} options={{ title: 'Parent Directory' }} />
      <ControlsStackNav.Screen name="ParentDetail" component={ParentDetailScreen} options={{ title: 'Parent' }} />
      <ControlsStackNav.Screen name="ChildDetail" component={ChildDetailScreen} options={{ title: 'Student' }} />
      <ControlsStackNav.Screen name="TapTracker" component={TapTrackerScreen} options={{ title: 'Tap Tracker' }} />
      <ControlsStackNav.Screen name="TapLogs" component={TapLogsScreen} options={{ title: 'Tap Logs' }} />
      <ControlsStackNav.Screen name="SummaryReview" component={SummaryReviewScreen} options={{ title: 'Session Report' }} />
      <ControlsStackNav.Screen name="Reports" component={ReportsScreen} options={{ title: 'Data & Reports' }} />
      <ControlsStackNav.Screen name="ChildProgressInsights" component={ChildProgressInsightsScreen} options={{ title: 'Progress Insights' }} />
      <ControlsStackNav.Screen name="TherapistDocumentationDashboard" component={TherapistDocumentationDashboardScreen} options={{ title: 'Documentation Dashboard' }} />
      <ControlsStackNav.Screen name="OrganizationInsightsDashboard" component={OrganizationInsightsDashboardScreen} options={{ title: 'Organization Insights' }} />
      <ControlsStackNav.Screen name="FacultyDetail" component={FacultyDetailScreen} options={{ title: 'Faculty' }} />
      <ControlsStackNav.Screen name="AdminMemos" component={AdminMemosScreen} options={{ title: 'Compose Memo' }} />
      <ControlsStackNav.Screen name="AdminChatMonitor" component={AdminChatMonitorScreen} options={{ title: 'Communication' }} />
      <ControlsStackNav.Screen name="AdminSettings" component={AdminSettingsHubScreen} options={{ title: 'Settings' }} />
      <ControlsStackNav.Screen name="OrganizationSettings" component={AdminSettingsWorkspaceScreen} initialParams={{ sectionKey: 'organization' }} options={{ title: 'Organization Settings' }} />
      <ControlsStackNav.Screen name="BrandingSettings" component={AdminSettingsWorkspaceScreen} initialParams={{ sectionKey: 'branding' }} options={{ title: 'Branding' }} />
      <ControlsStackNav.Screen name="UserMonitor" component={UserMonitorScreen} options={{ title: 'User Monitor' }} />
      <ControlsStackNav.Screen name="ChatThread" component={ChatThreadScreen} options={{ title: 'Thread' }} />
      <ControlsStackNav.Screen name="ManagePermissions" component={ManagePermissionsScreen} options={{ title: 'Manage Permissions' }} />
      <ControlsStackNav.Screen name="PrivacyDefaults" component={PrivacyDefaultsScreen} options={{ title: 'Profile Settings' }} />
      <ControlsStackNav.Screen name="AdminAlerts" component={AdminAlertsScreen} options={{ title: 'Compliance' }} />
      <ControlsStackNav.Screen name="InsuranceBilling" component={InsuranceBillingScreen} options={{ title: 'Billing & Authorizations' }} />
      
      <ControlsStackNav.Screen name="ImportCenter" component={ImportCenterScreen} options={{ title: 'Import Center' }} />
      <ControlsStackNav.Screen name="ExportData" component={ExportDataScreen} options={{ title: 'Export Data' }} />
      <ControlsStackNav.Screen name="Attendance" component={AttendanceScreen} options={{ title: 'Attendance' }} />
      <ControlsStackNav.Screen name="ScheduleCalendar" component={ScheduleCalendarScreen} options={{ title: 'Scheduling' }} />
      <ControlsStackNav.Screen name="ProgramDirectory" component={ProgramDirectoryScreen} options={{ title: 'Programs & Goals' }} />
      <ControlsStackNav.Screen name="BcbaSessionReviewQueue" component={BcbaSessionReviewQueueScreen} options={{ title: 'BCBA Review Queue' }} />
      <ControlsStackNav.Screen name="LearnerClinicalProfile" component={LearnerClinicalProfileScreen} options={{ title: 'Learner Clinical Profile' }} />
      <ControlsStackNav.Screen name="CampusDirectory" component={CampusDirectoryScreen} options={{ title: 'Campus Directory' }} />
      <ControlsStackNav.Screen name="ProgramDocuments" component={ProgramDocumentsScreen} options={{ title: 'Program Documents' }} />
      <ControlsStackNav.Screen name="CampusDocuments" component={CampusDocumentsScreen} options={{ title: 'Campus Documents' }} />
    </ControlsStackNav.Navigator>
  );
}

const CommunityStackNav = createNativeStackNavigator();
function CommunityStack() {
  const isTabletLayout = useIsTabletLayout();
  return (
    <CommunityStackNav.Navigator
      screenOptions={({ navigation, route, back }) => {
        const showBack = Boolean(back) && shouldShowSubscreenBack(navigation, route?.name);
        return {
          headerShown: SHOW_STACK_HEADERS && !isTabletLayout,
          title: humanizeScreenLabel(route?.name),
          headerTitleAlign: 'center',
          headerTitle: ({ children }) => <StackHeaderTitle>{children}</StackHeaderTitle>,
          headerStyle: { height: HEADER_HEIGHT },
          headerBackVisible: showBack,
          headerBackTitleVisible: false,
          headerLeft: () => (showBack ? <BackButton onPress={() => navigation.goBack()} /> : null),
          headerRight: () => <HelpButton />,
        };
      }}
    >
      <CommunityStackNav.Screen name="CommunityMain" component={RoleDashboardScreen} options={{ title: 'Dashboard' }} />
      <CommunityStackNav.Screen name="InsuranceBilling" component={InsuranceBillingScreen} options={{ title: 'Billing & Insurance' }} />
      <CommunityStackNav.Screen name="TherapistItemsNeeded" component={TherapistItemsNeededScreen} options={{ title: 'Items Needed' }} />
      <CommunityStackNav.Screen name="CareTeam" component={CareTeamScreen} options={{ title: 'My Care Team' }} />
      <CommunityStackNav.Screen name="ScheduleCalendar" component={ScheduleCalendarScreen} options={{ title: 'Schedule' }} />
      <CommunityStackNav.Screen name="ChildDetail" component={ChildDetailScreen} options={{ title: 'Child Profile' }} />
      <CommunityStackNav.Screen name="TapTracker" component={TapTrackerScreen} options={{ title: 'Tap Tracker' }} />
      <CommunityStackNav.Screen name="TapLogs" component={TapLogsScreen} options={{ title: 'Tap Logs' }} />
      <CommunityStackNav.Screen name="SummaryReview" component={SummaryReviewScreen} options={{ title: 'Session Report' }} />
      <CommunityStackNav.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
      <CommunityStackNav.Screen name="ChildProgressInsights" component={ChildProgressInsightsScreen} options={{ title: 'Progress Insights' }} />
      <CommunityStackNav.Screen name="TherapistDocumentationDashboard" component={TherapistDocumentationDashboardScreen} options={{ title: 'Documentation Dashboard' }} />
      <CommunityStackNav.Screen name="BcbaSessionReviewQueue" component={BcbaSessionReviewQueueScreen} options={{ title: 'BCBA Review Queue' }} />
      <CommunityStackNav.Screen name="LearnerClinicalProfile" component={LearnerClinicalProfileScreen} options={{ title: 'Learner Clinical Profile' }} />
      <CommunityStackNav.Screen name="ParentDetail" component={ParentDetailScreen} options={{ title: 'Parent' }} />
      <CommunityStackNav.Screen name="FacultyDetail" component={FacultyDetailScreen} options={{ title: 'Faculty' }} />
    </CommunityStackNav.Navigator>
  );
}

const MyChildStackNav = createNativeStackNavigator();
function MyChildStack() {
  const isTabletLayout = useIsTabletLayout();
  return (
    <MyChildStackNav.Navigator
      screenOptions={({ navigation, route, back }) => {
        const showBack = Boolean(back) && shouldShowSubscreenBack(navigation, route?.name);
        return {
          headerShown: SHOW_STACK_HEADERS && !isTabletLayout,
          title: humanizeScreenLabel(route?.name),
          headerTitleAlign: 'center',
          headerTitle: ({ children }) => <StackHeaderTitle>{children}</StackHeaderTitle>,
          headerStyle: { height: HEADER_HEIGHT },
          headerBackVisible: showBack,
          headerBackTitleVisible: false,
          headerLeft: () => (showBack ? <BackButton onPress={() => navigation.goBack()} /> : null),
          headerRight: () => <HelpButton />,
        };
      }}
    >
      <MyChildStackNav.Screen name="MyChildMain" component={MyChildScreen} options={{ title: 'My Child' }} />
      <MyChildStackNav.Screen name="ChildProgressInsights" component={ChildProgressInsightsScreen} options={{ title: 'Progress Insights' }} />
    </MyChildStackNav.Navigator>
  );
}

const ChatsStackNav = createNativeStackNavigator();
function ChatsStack() {
  const isTabletLayout = useIsTabletLayout();
  return (
    <ChatsStackNav.Navigator
      screenOptions={({ navigation, route, back }) => {
        const showBack = Boolean(back) && shouldShowSubscreenBack(navigation, route?.name);
        return {
          headerShown: SHOW_STACK_HEADERS && !isTabletLayout,
          title: humanizeScreenLabel(route?.name),
          headerTitleAlign: 'center',
          headerTitle: ({ children }) => <StackHeaderTitle>{children}</StackHeaderTitle>,
          headerStyle: { height: HEADER_HEIGHT },
          headerBackVisible: showBack,
          headerBackTitleVisible: false,
          headerLeft: () => (showBack ? <BackButton onPress={() => navigation.goBack()} label={route?.name === 'ChatThread' ? 'Chats' : ''} /> : null),
          headerRight: () => <HelpButton />,
        };
      }}
    >
      <ChatsStackNav.Screen name="ChatsList" component={ChatsScreen} options={{ title: 'Chats' }} />
      <ChatsStackNav.Screen name="NewThread" component={NewThreadScreen} options={{ title: 'New Message' }} />
      <ChatsStackNav.Screen name="ChatThread" component={ChatThreadScreen} options={{ title: 'Thread' }} />
    </ChatsStackNav.Navigator>
  );
}

const SettingsStackNav = createNativeStackNavigator();
function SettingsStack() {
  const isTabletLayout = useIsTabletLayout();
  return (
    <SettingsStackNav.Navigator
      screenOptions={({ navigation, route, back }) => {
        const showBack = Boolean(back) && shouldShowSubscreenBack(navigation, route?.name);
        return {
          headerShown: SHOW_STACK_HEADERS && !isTabletLayout,
          title: humanizeScreenLabel(route?.name),
          headerTitleAlign: 'center',
          headerTitle: ({ children }) => <StackHeaderTitle>{children}</StackHeaderTitle>,
          headerStyle: { height: HEADER_HEIGHT },
          headerBackVisible: showBack,
          headerBackTitleVisible: false,
          headerLeft: () => (showBack ? <BackButton onPress={() => navigation.goBack()} /> : null),
          headerRight: () => <HelpButton />,
        };
      }}
    >
      <SettingsStackNav.Screen name="SettingsMain" component={SettingsScreen} options={{ title: 'Profile Settings' }} />
      <SettingsStackNav.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit Profile' }} />
      <SettingsStackNav.Screen name="Help" component={HelpScreen} options={{ title: 'Help' }} />
    </SettingsStackNav.Navigator>
  );
}

function MainShell({ currentRoute }) {
  const { user } = useAuth();
  const isTabletLayout = useIsTabletLayout();
  const { width, height } = useWindowDimensions();
  const role = normalizeUserRole(user?.role);
  const isPhoneViewport = resolvePhoneViewport(width, height);
  const isPhoneAdminViewport = canAccessAdminWorkspace(role) && isPhoneViewport;
  const isParentWorkspace = !canAccessAdminWorkspace(role) && !isStaffRole(role);
  const shouldRequireLandscape = Boolean(
    !isPhoneViewport
    && !isPhoneAdminViewport
    && !isParentWorkspace
    && !isTabletLayout
    && width < height
    && Math.max(width, height) >= 640
  );

  return (
    <TenantProvider>
      <DataProvider>
        {shouldRequireLandscape ? (
          <View style={landscapeStyles.rotateWrap}>
            <View style={landscapeStyles.rotateCard}>
              <Text style={landscapeStyles.rotateEyebrow}>Landscape required</Text>
              <Text style={landscapeStyles.rotateTitle}>Rotate your phone to continue</Text>
              <Text style={landscapeStyles.rotateBody}>Staff, BCBA, and admin workspaces now open in a landscape tablet-style layout on phones so the assigned role tools render correctly.</Text>
            </View>
          </View>
        ) : (
          <>
            <TabletNavigationShell currentRoute={currentRoute}>
              <MainRoutes />
            </TabletNavigationShell>
            {!isTabletLayout && !isPhoneAdminViewport ? <BottomNav navigationRef={navigationRef} currentRoute={currentRoute} /> : null}
          </>
        )}
        <UrgentMemoOverlay />
        <ArrivalDetector />
        <DevRoleSwitcher />
      </DataProvider>
    </TenantProvider>
  );
}

// MainRoutes chooses which top-level stacks to expose based on authenticated user role.
function MainRoutes() {
  const { user } = useAuth();
  const role = normalizeUserRole(user?.role);
  const isBcbaWorkspace = isBcbaRole(role);
  const hasAdminWorkspace = canAccessAdminWorkspace(role);
  const hasStaffWorkspace = isStaffRole(role);

  const screens = [];
  if (!hasAdminWorkspace) {
    screens.push({ name: 'Home', component: CommunityStack });
  }
  screens.push({ name: 'Chats', component: ChatsStack });

  if (isStaffRole(role)) {
    if (isBcbaWorkspace) {
      screens.push({ name: 'Controls', component: ControlsStack });
    } else {
      // Therapists / faculty: surface the My Class workspace defined in MyClassStack.
      screens.push({ name: 'MyClass', component: MyClassStack });
    }
  } else if (isAdminRole(role)) {
    screens.push({ name: 'Controls', component: ControlsStack });
  } else {
    screens.push({ name: 'MyChild', component: MyChildStack });
  }

  screens.push({ name: 'Settings', component: SettingsStack });

  const initialWorkspace = hasAdminWorkspace
    ? 'Controls'
    : hasStaffWorkspace
      ? 'Home'
      : 'Home';

  return (
    <RootStack.Navigator key={`workspace:${role || 'parent'}:${initialWorkspace}`} screenOptions={{ headerShown: false }} initialRouteName={initialWorkspace}>
      {screens.map(s => (
        <RootStack.Screen key={s.name} name={s.name} component={s.component} />
      ))}
    </RootStack.Navigator>
  );
}

const landscapeStyles = StyleSheet.create({
  stackHeaderTitle: {
    maxWidth: 220,
    fontSize: 17,
    lineHeight: 20,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  rotateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#e2e8f0',
  },
  rotateCard: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 24,
    padding: 24,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  rotateEyebrow: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  rotateTitle: {
    marginTop: 8,
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '800',
  },
  rotateBody: {
    marginTop: 10,
    color: '#475569',
    lineHeight: 22,
  },
});

// IMPORTANT: AppNavigator MUST be defined at module scope.
// Previously it was declared inside `App()` and React therefore created a
// fresh component type on every render of `App`. Whenever `setCurrentRoute`
// fired from `onStateChange`, `App` re-rendered, the `AppNavigator` function
// identity changed, and React unmounted + remounted the entire tree
// (NavigationContainer, all stacks, DataProvider, every screen). That reset
// the navigation state back to `initialRouteName="Login"` on every tab tap,
// which is the main navigation bug reported in production.
function AppNavigator() {
  const auth = useAuth();
  const [currentRoute, setCurrentRoute] = useState('Login');
  const webEscapeHandledRef = useRef(false);

  useEffect(() => {
    // Web debugging escape hatch:
    //  - `/?logout=1` => sign out
    //  - `/?reset=1`  => sign out + clear storage + reload
    try {
      if (Platform.OS !== 'web') return;
      if (webEscapeHandledRef.current) return;

      const search = String(globalThis?.location?.search || '');
      if (!search || search === '?') return;

      const params = new URLSearchParams(search);
      const wantsLogout = params.get('logout') === '1' || params.get('bbLogout') === '1';
      const wantsReset = params.get('reset') === '1' || params.get('bbReset') === '1';
      if (!wantsLogout && !wantsReset) return;

      webEscapeHandledRef.current = true;

      (async () => {
        try {
          await auth?.logout?.();
        } catch (_) {}

        if (wantsReset) {
          try { globalThis?.localStorage?.clear?.(); } catch (_) {}
          try { globalThis?.sessionStorage?.clear?.(); } catch (_) {}
          try { globalThis?.indexedDB?.deleteDatabase?.('firebaseLocalStorageDb'); } catch (_) {}
        }

        // Strip the params so refreshes don't loop.
        try {
          const url = new URL(String(globalThis?.location?.href || ''), String(globalThis?.location?.origin || 'http://localhost'));
          url.searchParams.delete('logout');
          url.searchParams.delete('bbLogout');
          url.searchParams.delete('reset');
          url.searchParams.delete('bbReset');
          globalThis?.history?.replaceState?.({}, '', url.pathname + url.search + url.hash);
        } catch (_) {}

        if (wantsReset) {
          try { globalThis?.location?.reload?.(); } catch (_) {}
        }
      })();
    } catch (_) {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.logout]);

  useEffect(() => {
    try {
      if (!navigationRef.isReady()) return;
      if (auth?.loading) return;
      if (!auth?.token) return;

      // If orgSettings turns on MFA (or the user isn't verified), prevent access to Main.
      if (auth?.needsMfa) {
        const r = navigationRef.getCurrentRoute();
        const name = r?.name ? String(r.name) : '';
        if (name && name !== 'Login' && name !== 'TwoFactor') {
          navigationRef.dispatch(
            CommonActions.reset({ index: 0, routes: [{ name: 'TwoFactor' }] })
          );
        }
      } else if (auth?.passwordSetupRequired) {
        const r = navigationRef.getCurrentRoute();
        const name = r?.name ? String(r.name) : '';
        if (name && name !== 'Login' && name !== 'CreatePassword') {
          navigationRef.dispatch(
            CommonActions.reset({ index: 0, routes: [{ name: 'CreatePassword' }] })
          );
        }
      }
    } catch (_) {
      // ignore
    }
  }, [auth?.loading, auth?.token, auth?.needsMfa, auth?.passwordSetupRequired]);

  useEffect(() => {
    // Drain any writes that were queued during a network outage.
    // Triggered: when auth becomes available, when the app returns to the
    // foreground (native), and when the browser regains the `online` event
    // (web). Failures inside the queue are swallowed so this never disrupts
    // the UI.
    if (!auth?.token || auth?.needsMfa || auth?.passwordSetupRequired) return undefined;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      try {
        // Lazy-require so this module doesn't get pulled in unless auth is ready.
        // eslint-disable-next-line global-require
        const { flushOfflineQueue } = require('./src/Api');
        if (typeof flushOfflineQueue === 'function') {
          flushOfflineQueue().catch(() => {});
        }
      } catch (_) { /* ignore */ }
    };

    run();

    let appStateSub = null;
    try {
      if (Platform.OS !== 'web' && AppState && typeof AppState.addEventListener === 'function') {
        appStateSub = AppState.addEventListener('change', (next) => {
          if (next === 'active') run();
        });
      }
    } catch (_) { /* ignore */ }

    let onlineHandler = null;
    try {
      if (Platform.OS === 'web' && typeof globalThis.addEventListener === 'function') {
        onlineHandler = () => run();
        globalThis.addEventListener('online', onlineHandler);
      }
    } catch (_) { /* ignore */ }

    return () => {
      cancelled = true;
      try { appStateSub?.remove?.(); } catch (_) { /* ignore */ }
      try {
        if (onlineHandler && typeof globalThis.removeEventListener === 'function') {
          globalThis.removeEventListener('online', onlineHandler);
        }
      } catch (_) { /* ignore */ }
    };
  }, [auth?.token, auth?.needsMfa, auth?.passwordSetupRequired]);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    let active = true;
    let subscription = null;
    let Notifications = null;
    try {
      Notifications = require('expo-notifications');
    } catch (_) {
      Notifications = null;
    }
    if (!Notifications) return undefined;

    const handleResponse = (response) => {
      const data = response?.notification?.request?.content?.data || response?.request?.content?.data || {};
      const kind = String(data?.kind || '').trim().toLowerCase();
      if (!data?.memoId && kind !== 'admin_memo' && kind !== 'urgent_memo') return;
      if (!navigationRef?.isReady?.()) return;
      if (!auth?.token || auth?.needsMfa || auth?.passwordSetupRequired) {
        resetToLogin();
      }
    };

    Notifications.getLastNotificationResponseAsync?.()
      ?.then((response) => {
        if (!active || !response) return;
        handleResponse(response);
        Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
      })
      .catch(() => {});

    subscription = Notifications.addNotificationResponseReceivedListener?.((response) => {
      handleResponse(response);
    });

    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, [auth?.token, auth?.needsMfa, auth?.passwordSetupRequired]);

  useEffect(() => {
    try {
      if (Platform.OS !== 'web') return;
      if (!navigationRef.isReady()) return;
        if (auth?.loading || !auth?.token || auth?.passwordSetupRequired || auth?.needsMfa) return;
      const approvalIntent = consumeApprovalAccessIntent();
      const approvalParams = getApprovalAccessNavigationParams(approvalIntent);
      if (!approvalParams) return;
      navigationRef.navigate('Main', approvalParams);
    } catch (_) {
      // ignore
    }
  }, [auth?.loading, auth?.token, auth?.needsMfa, auth?.passwordSetupRequired]);

  return (
    <NavigationContainer
      ref={navigationRef}
      onStateChange={(state) => {
        try {
          const mainState = state?.routes?.find?.((route) => route.name === 'Main')?.state || state;
          const next = getDeepestRouteName(mainState) || getDeepestRouteName(state) || 'Home';
          if (next) {
            setCurrentRoute((prev) => (prev === next ? prev : next));
            setDebugContext({ route: next });
            logger.debug('nav', 'Route change', { route: next });
          }
        } catch (e) {
          // ignore
        }
      }}
    >
      <AppStack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Login">
        <AppStack.Screen name="Login">
          {(props) => <LoginScreen {...props} suppressAutoRedirect={false} />}
        </AppStack.Screen>
        <AppStack.Screen
          name="TwoFactor"
          component={TwoFactorScreen}
          options={{ gestureEnabled: false }}
        />
        <AppStack.Screen
          name="CreatePassword"
          component={CreatePasswordScreen}
          options={{ gestureEnabled: false }}
        />
        <AppStack.Screen name="Main">
          {() => <MainShell currentRoute={currentRoute} />}
        </AppStack.Screen>
      </AppStack.Navigator>
    </NavigationContainer>
  );
}

function App() {
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    try {
      // expo-notifications push token listeners are not fully supported on web.
      // Skip notification setup on web to avoid noisy console warnings.
      if (Platform.OS !== 'web') configureNotificationHandling();
      registerGlobalDebugHandlers();
      logger.debug('app', 'Registered global debug handlers');
    } catch (e) {
      // ignore
    }

    const missing = [];
    if (!RoleDashboardScreen) missing.push('RoleDashboardScreen');
    if (!ChatsScreen) missing.push('ChatsScreen');
    if (!ChatThreadScreen) missing.push('ChatThreadScreen');
    if (!SettingsScreen) missing.push('SettingsScreen');
    if (!AuthProvider) missing.push('AuthProvider');
    if (!DataProvider) missing.push('DataProvider');
    if (!UrgentMemoOverlay) missing.push('UrgentMemoOverlay');
    if (missing.length) setProblem(missing);
    else setProblem(null);
    // log for Metro/console
    logger.info('app', 'App imports', {
      RoleDashboardScreen: !!RoleDashboardScreen,
      ChatsScreen: !!ChatsScreen,
      ChatThreadScreen: !!ChatThreadScreen,
      SettingsScreen: !!SettingsScreen,
      AuthProvider: !!AuthProvider,
      DataProvider: !!DataProvider,
      UrgentMemoOverlay: !!UrgentMemoOverlay,
    });
  }, []);

  if (problem && problem.length) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Missing components detected</Text>
        <Text>{problem.join(', ')}</Text>
        <Text style={{ marginTop: 12, color: '#666' }}>Check the import paths and default exports for those files.</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <StatusBar barStyle="dark-content" translucent={false} />
        <SafeAreaProvider>
          <AuthProvider>
            <AppNavigator />
          </AuthProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(App);
