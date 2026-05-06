import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../AuthContext';
import { navigationRef } from '../navigationRef';
import { useTenant } from '../core/tenant/TenantContext';
import { isAdminRole } from '../core/tenant/models';
import { humanizeScreenLabel } from '../utils/screenLabels';

export default function WebNav() {
  const navigation = useNavigation();
  const route = useRoute();
  const { user, logout } = useAuth();
  const tenant = useTenant();
  const labels = tenant?.labels || {};
  const role = (user && user.role) ? (user.role || '').toString().toLowerCase() : 'parent';
  const titleMap = {
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
  const headerTitle = titleMap[route?.name] || humanizeScreenLabel(route?.name) || 'Community Bridge';

  function navTo(route, params) {
    // Top-level tab targets (Home/Chats/Settings/Controls/MyClass/MyChild)
    // live inside the `Main` screen of the outer AppStack. Use the root
    // navigationRef with an explicit nested-screen payload so the call works
    // regardless of how deep in the stack tree this component is rendered.
    try {
      if (navigationRef?.isReady?.() && typeof navigationRef.navigate === 'function') {
        navigationRef.navigate('Main', { screen: route, ...(params ? { params } : {}) });
        return;
      }
    } catch (_) {}
    const parent = navigation?.getParent?.();
    if (parent?.navigate) parent.navigate(route, params);
    else if (navigation?.navigate) navigation.navigate(route, params);
  }

  function openHelp() {
    navTo('Settings', { screen: 'Help' });
  }

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <TouchableOpacity onPress={() => navTo('Home')} style={styles.titleWrap}>
          <Text style={styles.titleText} numberOfLines={1}>{headerTitle}</Text>
        </TouchableOpacity>

        <View style={styles.links}>
          <TouchableOpacity onPress={() => navTo('Home')} style={styles.link}><Text style={styles.linkText}>Home</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navTo('Chats')} style={styles.link}><Text style={styles.linkText}>Messages</Text></TouchableOpacity>
          {role !== 'therapist' && <TouchableOpacity onPress={() => navTo('MyChild')} style={styles.link}><Text style={styles.linkText}>{labels.myChild || 'My Child'}</Text></TouchableOpacity>}
          {role === 'therapist' && <TouchableOpacity onPress={() => navTo('MyClass')} style={styles.link}><Text style={styles.linkText}>{labels.myClass || 'My Class'}</Text></TouchableOpacity>}
          {isAdminRole(role) && <TouchableOpacity onPress={() => navTo('Controls')} style={styles.link}><Text style={styles.linkText}>{labels.dashboard || 'Dashboard'}</Text></TouchableOpacity>}
          <TouchableOpacity onPress={() => navTo('Settings')} style={styles.link}><Text style={styles.linkText}>Settings</Text></TouchableOpacity>
          <TouchableOpacity onPress={openHelp} style={styles.iconLink} accessibilityRole="button" accessibilityLabel="Help">
            <MaterialIcons name="help-outline" size={20} color="#1d4ed8" />
          </TouchableOpacity>
          {user ? (
            <TouchableOpacity onPress={() => { logout && logout(); }} style={styles.link}>
              <Text style={[styles.linkText, styles.logoutText]}>Logout</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e6e6e6',
    // Ensure header (and its absolutely-positioned dropdown) sit above page content like the Post button
    zIndex: 1000,
    ...(typeof window !== 'undefined' ? { position: 'relative' } : {}),
  },
  inner: {
    maxWidth: 1100,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 16,
    zIndex: 1000,
  },
  titleWrap: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    flex: 1,
    minWidth: 0,
  },
  titleText: {
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '800',
  },
  links: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    marginLeft: 16,
  },
  link: {
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  linkText: {
    color: '#111827',
    fontWeight: '600',
  },
  iconLink: { paddingHorizontal: 10, paddingVertical: 10 },
  logoutText: {
    color: '#ef4444',
  },
});
