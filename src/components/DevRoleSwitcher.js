import React, { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, TouchableOpacity, Text, Alert, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { useTenant } from '../core/tenant/TenantContext';
import { MaterialIcons } from '@expo/vector-icons';
import { logPress } from '../utils/logger';
import { isDevSwitcherUser, isDemoReviewerUser } from '../utils/authState';
import { THERAPY_ROLE_LABELS } from '../utils/roleTerminology';
import { ENABLE_DEV_SWITCHER } from '../config';

const DEV_SWITCHER_VISIBILITY_KEY = '@communitybridge/dev-switcher-visible';

export default function DevRoleSwitcher() {
  const { setRole, user, isDemoReviewer } = useAuth();
  const { clearAllData, resetScreenshotSeed } = useData();
  const tenant = useTenant() || {};
  const isDevAccount = isDevSwitcherUser(user?.email);
  const isReviewAccount = isDemoReviewer || isDemoReviewerUser(user?.email);
  const isAllowed = ENABLE_DEV_SWITCHER && (__DEV__ || isDevAccount || isReviewAccount);
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

  // Visible in __DEV__ builds for everyone, OR for the dev@communitybridge.app
  // account in any build (controlled gate so the dev account can navigate the
  // hierarchy/paths in production-like environments).
  if (!isAllowed || !visibilityReady) return null;

  const changeRole = (r) => {
    if (!setRole) return;
    logPress('DevTools:ChangeRole', { role: r });
    setRole(r);
    setOpen(false);
    Alert.alert('Role changed', `Switched to ${r}`);
  };

  const {
    programs = [],
    campuses = [],
    currentOrganization,
    currentProgram,
    currentProgramId,
    currentCampus,
    currentCampusId,
    setSelectedProgramId,
    setSelectedCampusId,
  } = tenant;

  function cycleProgram() {
    if (!Array.isArray(programs) || programs.length < 2 || !setSelectedProgramId) return;
    const idx = programs.findIndex((p) => p.id === currentProgramId);
    const next = programs[(idx + 1) % programs.length];
    if (next) {
      logPress('DevTools:CycleProgram', { from: currentProgramId, to: next.id });
      setSelectedProgramId(next.id);
    }
  }

  function cycleCampus() {
    if (!Array.isArray(campuses) || campuses.length < 2 || !setSelectedCampusId) return;
    const idx = campuses.findIndex((c) => c.id === currentCampusId);
    const next = campuses[(idx + 1) % campuses.length];
    if (next) {
      logPress('DevTools:CycleCampus', { from: currentCampusId, to: next.id });
      setSelectedCampusId(next.id);
    }
  }

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
          <Text style={styles.badgeText}>{isReviewAccount ? 'DEMO' : ((user && user.role) ? user.role.toString().toUpperCase() : 'DEV')}</Text>
        </View>
      </TouchableOpacity>
      {open && (
        <ScrollView style={styles.menu} contentContainerStyle={{ paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
          {isReviewAccount ? (
            <View style={styles.demoBanner}>
              <Text style={styles.demoBannerTitle}>App Review Demo Mode</Text>
              <Text style={styles.demoBannerText}>This panel is only available to the review account and drives a seeded local walkthrough.</Text>
            </View>
          ) : null}
          <Text style={styles.sectionLabel}>Review Data</Text>
          <TouchableOpacity onPress={seedScreenshotMode} style={styles.menuBtn}>
            <Text>Demo View</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={clearDemoData} style={styles.menuBtn}>
            <Text>Clear seeded data</Text>
          </TouchableOpacity>

          <View style={styles.divider} />
          {/* Role */}
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
          <TouchableOpacity onPress={() => changeRole('admin')} style={styles.menuBtn}>
            <Text>Admin</Text>
          </TouchableOpacity>

          {/* Tenant */}
          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>Tenant</Text>
          <View style={styles.menuBtn}>
            <Text style={styles.kv}>Org: <Text style={styles.kvVal}>{currentOrganization?.name || '—'}</Text></Text>
            <Text style={styles.kv}>Program: <Text style={styles.kvVal}>{currentProgram?.name || '—'}</Text></Text>
            <Text style={styles.kv}>Campus: <Text style={styles.kvVal}>{currentCampus?.name || '—'}</Text></Text>
          </View>
          <TouchableOpacity onPress={cycleProgram} disabled={programs.length < 2} style={[styles.menuBtn, programs.length < 2 && { opacity: 0.4 }]}>
            <Text>Next Program ({programs.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={cycleCampus} disabled={campuses.length < 2} style={[styles.menuBtn, campuses.length < 2 && { opacity: 0.4 }]}>
            <Text>Next Campus ({campuses.length})</Text>
          </TouchableOpacity>

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
  kv: { fontSize: 12, color: '#475569' },
  kvVal: { color: '#0f172a', fontWeight: '700' },
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
