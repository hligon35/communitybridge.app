import React, { useContext } from 'react';
import { View, Platform, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import ScreenHeader from './ScreenHeader';
import WebNav from './WebNav';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTenant } from '../core/tenant/TenantContext';
import { useAuth } from '../AuthContext';
import { isAdminRole } from '../core/tenant/models';
import { humanizeScreenLabel } from '../utils/screenLabels';
import useIsTabletLayout from '../hooks/useIsTabletLayout';
import { MobileAdminShellContext } from './TabletNavigationShell';
import { shouldShowSubscreenBack } from '../utils/backNavigation';

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
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const isPhoneViewport = shortEdge < 600 && longEdge < 1100;
  const suppressLegacyWebNav = Boolean(isWeb && isAdminRole(user?.role) && isPhoneViewport);
  const useAdminPhoneMainArea = Boolean(!isWeb && isAdminRole(user?.role) && isPhoneViewport && route?.name !== 'StudentDirectory' && route?.name !== 'FacultyDirectory');
  const useAdminPhoneHeaderBelow = Boolean(!isWeb && isAdminRole(user?.role) && isPhoneViewport);
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
});

export default ScreenWrapper;
