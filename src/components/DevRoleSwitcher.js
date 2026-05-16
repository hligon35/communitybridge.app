import React, { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, TouchableOpacity, Text, Alert, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { MaterialIcons } from '@expo/vector-icons';
import { logPress } from '../utils/logger';
import { isDemoReviewerUser, isSpecialAccessUser } from '../utils/authState';
import { THERAPY_ROLE_LABELS } from '../utils/roleTerminology';
import { ENABLE_DEV_SWITCHER } from '../config';

const DEV_SWITCHER_VISIBILITY_KEY = '@communitybridge/dev-switcher-visible';

export default function DevRoleSwitcher() {
  const { setRole, user, devRoleBehavior = 'remember', setDevStartupBehavior } = useAuth();
  const { clearAllData, resetScreenshotSeed } = useData();
  const isReviewerAccount = isDemoReviewerUser(user?.email);
  const isSpecialAccessAccount = isSpecialAccessUser(user?.email);
  const canUseDevRoleTools = __DEV__ || isSpecialAccessAccount;
  const isDevAccount = isSpecialAccessAccount && !isReviewerAccount;
  const canChangeRole = canUseDevRoleTools;
  const isAllowed = ENABLE_DEV_SWITCHER && (__DEV__ || isSpecialAccessAccount);
  const [open, setOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [visibilityReady, setVisibilityReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isAllowed) {
      setVisibilityReady(true);
      return () => {
        cancelled = true;
      };
    }

    AsyncStorage.getItem(DEV_SWITCHER_VISIBILITY_KEY)
      .then((stored) => {
        if (cancelled) return;
        setIsVisible(stored !== 'hidden');
      })
      .catch(() => {
        if (cancelled) return;
        setIsVisible(true);
      })
      .finally(() => {
        if (!cancelled) setVisibilityReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isAllowed]);

  const toggleVisibility = async () => {
    const nextVisible = !isVisible;
    setIsVisible(nextVisible);
    if (!nextVisible) setOpen(false);
    try {
      await AsyncStorage.setItem(DEV_SWITCHER_VISIBILITY_KEY, nextVisible ? 'visible' : 'hidden');
    } catch (_) {
      // ignore persistence failures and keep the in-memory toggle
    }
    Alert.alert('Developer tools', nextVisible ? 'Developer button shown.' : 'Developer button hidden. Long press the lower-right corner for 3 seconds to show it again.');
  };

  // Visible in __DEV__ builds for everyone, OR for the controlled special-access
  // accounts used for internal QA and App Review in production-like builds.
  if (!isAllowed || !visibilityReady) return null;

  const changeRole = (r) => {
    if (!setRole) return;
    logPress('DevTools:ChangeRole', { role: r });
    setRole(r);
    setOpen(false);
    Alert.alert('Role changed', `Switched to ${r}`);
  };

  const changeDevBehavior = (behavior) => {
    if (!setDevStartupBehavior) return;
    logPress('DevTools:ChangeDevBehavior', { behavior });
    setDevStartupBehavior(behavior);
    Alert.alert('Dev behavior updated', behavior === 'remember' ? 'The dev account will keep using the last selected role on launch.' : `The dev account will open as ${behavior} on launch.`);
  };

  function seedScreenshotMode() {
    try {
      logPress('DevTools:SeedScreenshotMode');
      resetScreenshotSeed();
      Alert.alert('Demo View loaded', 'Loaded the Demo View local data set for directory, chats, memos, proposals, and progress snapshots.');
    } catch (e) {
      Alert.alert('Error', 'Could not load Demo View data');
    }
  }

  function clearDemoData() {
    logPress('DevTools:ClearDemoDataPrompt');
    Alert.alert('Confirm', 'Clear all seeded review data?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          try {
            logPress('DevTools:ClearDemoDataConfirm');
            await clearAllData();
            Alert.alert('Cleared', 'Seeded review data removed.');
          } catch (e) {
            Alert.alert('Error', 'Could not clear seeded review data');
          }
        },
      },
    ]);
  }

  if (!isVisible) {
    return (
      <View pointerEvents="box-none" style={styles.container}>
        <TouchableOpacity
          style={styles.hiddenActivator}
          delayLongPress={3000}
          onLongPress={toggleVisibility}
          accessibilityLabel="Show developer tools"
        />
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={styles.container}>
      {/* Role badge */}
      <TouchableOpacity
        style={styles.badgeWrap}
        delayLongPress={3000}
        onLongPress={toggleVisibility}
        activeOpacity={0.95}
      >
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{isReviewerAccount ? 'DEMO' : (user && user.role) ? user.role.toString().toUpperCase() : 'DEV'}</Text>
        </View>
      </TouchableOpacity>
      {open && (
        <ScrollView style={styles.menu} contentContainerStyle={{ paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
          {isReviewerAccount ? (
            <View style={styles.demoBanner}>
              <Text style={styles.demoBannerTitle}>App Review Demo Mode</Text>
              <Text style={styles.demoBannerText}>This panel is only available to the review account and unlocks the seeded caregiver, staff, BCBA, office, and admin walkthroughs.</Text>
            </View>
          ) : null}
          <Text style={styles.sectionLabel}>Review Data</Text>
          <TouchableOpacity onPress={seedScreenshotMode} style={styles.menuBtn}>
            <Text>Demo View</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={clearDemoData} style={styles.menuBtn}>
            <Text>Clear seeded data</Text>
          </TouchableOpacity>

          {canChangeRole ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionLabel}>Role</Text>
              <TouchableOpacity onPress={() => changeRole('parent')} style={styles.menuBtn}>
                <Text>Parent</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeRole('therapist')} style={styles.menuBtn}>
                <Text>{THERAPY_ROLE_LABELS.therapist}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeRole('bcba')} style={styles.menuBtn}>
                <Text>BCBA</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeRole('office')} style={styles.menuBtn}>
                <Text>Office</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeRole('admin')} style={styles.menuBtn}>
                <Text>Admin</Text>
              </TouchableOpacity>
            </>
          ) : null}

          {isDevAccount ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionLabel}>Dev Startup</Text>
              <TouchableOpacity onPress={() => changeDevBehavior('remember')} style={[styles.menuBtn, devRoleBehavior === 'remember' ? styles.menuBtnActive : null]}>
                <Text style={[styles.menuBtnText, devRoleBehavior === 'remember' ? styles.menuBtnTextActive : null]}>Remember last role</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeDevBehavior('parent')} style={[styles.menuBtn, devRoleBehavior === 'parent' ? styles.menuBtnActive : null]}>
                <Text style={[styles.menuBtnText, devRoleBehavior === 'parent' ? styles.menuBtnTextActive : null]}>Parent on launch</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeDevBehavior('admin')} style={[styles.menuBtn, devRoleBehavior === 'admin' ? styles.menuBtnActive : null]}>
                <Text style={[styles.menuBtnText, devRoleBehavior === 'admin' ? styles.menuBtnTextActive : null]}>Admin on launch</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeDevBehavior('office')} style={[styles.menuBtn, devRoleBehavior === 'office' ? styles.menuBtnActive : null]}>
                <Text style={[styles.menuBtnText, devRoleBehavior === 'office' ? styles.menuBtnTextActive : null]}>Office on launch</Text>
              </TouchableOpacity>
            </>
          ) : null}

        </ScrollView>
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => { logPress('DevTools:ToggleMenu', { open: !open }); setOpen(!open); }}
        onLongPress={toggleVisibility}
        delayLongPress={3000}
        accessibilityLabel="Developer role switcher"
      >
        <MaterialIcons name="developer-mode" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    bottom: 80,
    alignItems: 'flex-end',
    zIndex: 9999,
  },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  menu: {
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    maxHeight: 460,
    width: 260,
  },
  sectionLabel: {
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 2,
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  divider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 6 },
  demoBanner: {
    marginBottom: 8,
    marginHorizontal: 6,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  demoBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1d4ed8',
    marginBottom: 4,
  },
  demoBannerText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#1e3a8a',
  },
  menuBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  menuBtnActive: {
    backgroundColor: '#dbeafe',
    borderRadius: 8,
  },
  menuBtnText: {
    color: '#111827',
  },
  menuBtnTextActive: {
    color: '#1d4ed8',
    fontWeight: '800',
  },
  badgeWrap: {
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  hiddenActivator: {
    width: 65,
    height: 65,
    borderRadius: 33,
    backgroundColor: 'transparent',
  },
  badge: {
    backgroundColor: '#111827',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    elevation: 6,
  },
  badgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
});
