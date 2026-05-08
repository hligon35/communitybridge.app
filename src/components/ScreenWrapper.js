import React, { useContext } from 'react';
import { View, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import ScreenHeader from './ScreenHeader';
import WebNav from './WebNav';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTenant } from '../core/tenant/TenantContext';
import { useAuth } from '../AuthContext';
import { canAccessAdminWorkspace, isAdminRole } from '../core/tenant/models';
import { humanizeScreenLabel } from '../utils/screenLabels';
import useIsTabletLayout from '../hooks/useIsTabletLayout';
import { MobileAdminShellContext } from './TabletNavigationShell';
import { shouldShowSubscreenBack } from '../utils/backNavigation';
import { canAccessPhoneRoute, getPhoneFallbackCopy, getPhoneAccessProfile, isPhoneViewport as resolvePhoneViewport } from '../utils/mobileRoleAccess';

function PhoneRouteFallback({ navigation, role, routeName }) {
  const profile = getPhoneAccessProfile(role);
  const copy = getPhoneFallbackCopy(role, routeName);

  function goToRoot(rootName) {
    const stackNav = navigation?.getParent?.();
    const rootNav = stackNav?.getParent?.() || stackNav || navigation;
    if (rootNav && typeof rootNav.navigate === 'function') {
      rootNav.navigate(rootName);
      return;
    }
    navigation?.navigate?.(rootName);
  }

  const primaryRoot = profile === 'parent' || profile === 'therapist' ? 'Home' : 'Controls';

  return (
    <View style={styles.phoneFallbackWrap}>
      <View style={styles.phoneFallbackCard}>
        <Text style={styles.phoneFallbackEyebrow}>Phone Workspace</Text>
        <Text style={styles.phoneFallbackTitle}>{copy.title}</Text>
        <Text style={styles.phoneFallbackBody}>{copy.body}</Text>
        <View style={styles.phoneFallbackActions}>
          <TouchableOpacity style={styles.phoneFallbackPrimaryButton} onPress={() => goToRoot(primaryRoot)}>
            <Text style={styles.phoneFallbackPrimaryText}>Go to Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.phoneFallbackSecondaryButton} onPress={() => goToRoot('Chats')}>
            <Text style={styles.phoneFallbackSecondaryText}>Open Chats</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.phoneFallbackSecondaryButton} onPress={() => goToRoot('Settings')}>
            <Text style={styles.phoneFallbackSecondaryText}>Settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export function ScreenWrapper({
  children,
  style,
  hideBanner = false,
  bannerShowBack,
  bannerTitle,
  bannerLeft,
  bannerRight,
  bannerTitleLeft,
  mobileHeaderBelow,
  mobileHeaderBelowScrollEnabled = true,
  bottomSpacerHeight,
  webBottomSpacerHeight,
}) {
  const navigation = useNavigation();
  const route = useRoute();
  const tenant = useTenant();
  const { user } = useAuth();
  const { width, height } = useWindowDimensions();
  const isTabletLayout = useIsTabletLayout();
  const labels = tenant?.labels || {};
  const shellContext = useContext(MobileAdminShellContext);
  const isWeb = Platform.OS === 'web';
  const isPhoneViewport = resolvePhoneViewport(width, height);
  const suppressLegacyWebNav = Boolean(isWeb && isAdminRole(user?.role) && isPhoneViewport);
  const hasAdminPhoneWorkspace = Boolean(!isWeb && canAccessAdminWorkspace(user?.role) && isPhoneViewport);
  const isPhoneRouteAllowed = !(!isWeb && isPhoneViewport) || canAccessPhoneRoute(user?.role, route?.name);
  const useAdminPhoneMainArea = Boolean(hasAdminPhoneWorkspace && route?.name !== 'StudentDirectory' && route?.name !== 'FacultyDirectory');
  const useAdminPhoneHeaderBelow = Boolean(hasAdminPhoneWorkspace);
  const showMobileHeaderBelow = Boolean(useAdminPhoneHeaderBelow && mobileHeaderBelow);
  const showNativeStackHeader = !isWeb && !isTabletLayout;

  const nameMap = {
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

  const title = bannerTitle || nameMap[route?.name] || humanizeScreenLabel(route?.name) || '';
  const computedShowBack = !isWeb && title !== 'Home' && shouldShowSubscreenBack(navigation, route?.name);
  const showBack = (typeof bannerShowBack === 'boolean') ? bannerShowBack : computedShowBack;
  const resolvedWebBottomSpacerHeight = typeof webBottomSpacerHeight === 'number' ? webBottomSpacerHeight : 24;
  const usesMobileAdminShell = Boolean(shellContext?.showMobileAdminShell);
  const resolvedBottomSpacerHeight = typeof bottomSpacerHeight === 'number'
    ? bottomSpacerHeight
    : (usesMobileAdminShell || useAdminPhoneMainArea ? 0 : 72);

  return (
    <View style={[{ flex: 1, width: '100%', backgroundColor: isWeb ? '#f0f2f5' : '#fff' }, style]}>
      {/* web: show top WebNav; mobile: show ScreenHeader */}
      {isWeb && !isTabletLayout && !suppressLegacyWebNav
        ? <WebNav />
        : (!hideBanner && !showNativeStackHeader && !shellContext?.suppressScreenHeader && <ScreenHeader title={title} showBack={showBack} left={bannerLeft} right={bannerRight} titleLeft={showMobileHeaderBelow ? null : bannerTitleLeft} />)}

      {showMobileHeaderBelow ? (
        <View style={styles.mobileHeaderBelowShell}>
          <View style={styles.mobileHeaderBelowMain}>
            <ScrollView
              horizontal
              scrollEnabled={mobileHeaderBelowScrollEnabled}
              showsHorizontalScrollIndicator={false}
              bounces={mobileHeaderBelowScrollEnabled}
              contentContainerStyle={styles.mobileHeaderBelowContent}
            >
              {mobileHeaderBelow}
            </ScrollView>
          </View>
        </View>
      ) : null}

      {isWeb ? (
        <View style={{ flex: 1, width: '100%', alignItems: 'center', paddingHorizontal: 16, paddingTop: 20 }}>
          <View style={{ flex: 1, width: '100%', maxWidth: 1120 }}>
            {children}
            {resolvedWebBottomSpacerHeight > 0 ? <View style={{ height: resolvedWebBottomSpacerHeight }} accessibilityElementsHidden importantForAccessibility="no" /> : null}
          </View>
        </View>
      ) : !isPhoneRouteAllowed ? (
        <PhoneRouteFallback navigation={navigation} role={user?.role} routeName={route?.name} />
      ) : useAdminPhoneMainArea ? (
        <View style={styles.mobileAdminShell}>
          <View style={styles.mobileAdminMain}>
            {children}
            {resolvedBottomSpacerHeight > 0 ? <View style={{ height: resolvedBottomSpacerHeight }} accessibilityElementsHidden importantForAccessibility="no" /> : null}
          </View>
        </View>
      ) : (
        <>
          {children}
          {/* spacer to prevent bottom nav from overlapping content */}
          {resolvedBottomSpacerHeight > 0 ? <View style={{ height: resolvedBottomSpacerHeight }} accessibilityElementsHidden importantForAccessibility="no" /> : null}
        </>
      )}
    </View>
  );
}

export function CenteredContainer({ children, contentStyle }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'web' ? 20 : 16, paddingBottom: 16 }}>
      <View style={[{ width: '100%', maxWidth: Platform.OS === 'web' ? 980 : 720 }, contentStyle]}>{children}</View>
    </View>
  );
}

export function WebSurface({ children, style, compact = false }) {
  return (
    <View
      style={[
        styles.webSurface,
        compact ? styles.webSurfaceCompact : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function WebColumns({ left, main, right, style, leftWidth = 280, rightWidth = 300 }) {
  if (Platform.OS !== 'web') {
    return <View style={style}>{main}</View>;
  }

  return (
    <View style={[styles.webColumns, style]}>
      {left ? <View style={[styles.webRail, { width: leftWidth }]}>{left}</View> : null}
      <View style={styles.webMain}>{main}</View>
      {right ? <View style={[styles.webRail, { width: rightWidth }]}>{right}</View> : null}
    </View>
  );
}

export function WebStickySection({ children, style, top = 20 }) {
  if (Platform.OS !== 'web') return <View style={style}>{children}</View>;
  return <View style={[{ position: 'sticky', top }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  webSurface: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e4e8ee',
    padding: 18,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  webSurfaceCompact: {
    padding: 14,
    borderRadius: 16,
  },
  webColumns: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  webRail: {
    flexShrink: 0,
  },
  webMain: {
    flex: 1,
    minWidth: 0,
    marginHorizontal: 18,
  },
  mobileAdminShell: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  mobileAdminMain: {
    flex: 1,
    width: '100%',
    maxWidth: 920,
  },
  mobileHeaderBelowShell: {
    width: '100%',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
  mobileHeaderBelowMain: {
    width: '100%',
    maxWidth: 920,
  },
  mobileHeaderBelowContent: {
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  phoneFallbackWrap: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
  },
  phoneFallbackCard: {
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    padding: 20,
  },
  phoneFallbackEyebrow: {
    color: '#1d4ed8',
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  phoneFallbackTitle: {
    marginTop: 8,
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  phoneFallbackBody: {
    marginTop: 10,
    color: '#475569',
    lineHeight: 21,
  },
  phoneFallbackActions: {
    marginTop: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  phoneFallbackPrimaryButton: {
    borderRadius: 999,
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 10,
    marginBottom: 10,
  },
  phoneFallbackPrimaryText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  phoneFallbackSecondaryButton: {
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 10,
    marginBottom: 10,
  },
  phoneFallbackSecondaryText: {
    color: '#0f172a',
    fontWeight: '800',
  },
});

export default ScreenWrapper;
