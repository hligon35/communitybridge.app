import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useAuth } from '../AuthContext';
import { useTenant } from '../core/tenant/TenantContext';
import { isAdminRole, isBcbaRole, isOfficeAdminRole, isStaffRole, normalizeUserRole } from '../core/tenant/models';
import { THERAPY_ROLE_LABELS } from '../utils/roleTerminology';
// header provided by ScreenWrapper
const { SUPPORT_EMAIL, SUPPORT_URL, ACCOUNT_DELETE_URL } = require('../config/brand');

export default function HelpScreen() {
  const { user } = useAuth();
  const tenant = useTenant();
  const labels = tenant?.labels || {};
  const normalizedRole = normalizeUserRole(user?.role);
  const isOfficeAdmin = isOfficeAdminRole(normalizedRole);
  const isBcba = isBcbaRole(normalizedRole);
  const isStaff = isStaffRole(normalizedRole);
  const isAdmin = isAdminRole(normalizedRole);

  const roleTitle = useMemo(() => {
    if (isOfficeAdmin) return 'Office and admin help';
    if (isBcba) return 'BCBA help';
    if (isStaff) return `${THERAPY_ROLE_LABELS.therapist} and faculty help`;
    return 'Family help';
  }, [isBcba, isOfficeAdmin, isStaff]);

  const intro = useMemo(() => {
    if (isOfficeAdmin) return 'Use this screen for the fastest path to directory, scheduling, communication, compliance, and account support questions.';
    if (isBcba) return 'Use this screen for the fastest path to learner review, documentation, communication, and family support questions.';
    if (isStaff) return 'Use this screen for quick guidance on daily sessions, classroom communication, notifications, and account support.';
    return 'Use this screen for quick guidance on your child, messages, arrival detection, notifications, and account support.';
  }, [isBcba, isOfficeAdmin, isStaff]);

  const sections = useMemo(() => {
    if (isOfficeAdmin) {
      return [
        {
          title: 'Operations',
          body: 'Use the student and staff directories for assignments, roster review, scheduling, and scope-based updates. Reports, billing, compliance, and organization settings are all managed from the admin workspace.',
        },
        {
          title: 'Messages and alerts',
          body: 'Use Chats for direct follow-up and Admin Chat Monitor for broad message oversight. Urgent memos, attendance issues, and notification settings should be reviewed from the related admin workspaces so operational teams stay aligned.',
        },
        {
          title: 'Account and support',
          body: 'For login issues, permission changes, or workspace questions, contact support with the affected user role, organization, and campus so the issue can be traced quickly.',
        },
      ];
    }

    if (isBcba) {
      return [
        {
          title: 'Clinical workflow',
          body: 'Use your dashboard, student directory, and progress tools to review learners, trends, goals, attendance, summaries, and care team details without leaving the clinical workspace.',
        },
        {
          title: 'Messages and notifications',
          body: 'Use Chats for parent and staff communication. If notifications or break alerts are missing, confirm notification permissions are enabled on the device and review in-app notification settings.',
        },
        {
          title: 'Account and support',
          body: 'For access issues, missing learners, or documentation questions, include the learner name, campus, and time of the issue when contacting support.',
        },
      ];
    }

    if (isStaff) {
      return [
        {
          title: 'Daily workspace',
          body: `Use ${labels.staffDashboard || 'your dashboard'} for sessions, notes, items needed, and care team visibility. Break timers, session tools, and classroom updates are designed to keep you in one workflow during active service.`,
        },
        {
          title: 'Messages and notifications',
          body: 'Use Chats for parent and team follow-up. If new messages or break reminders do not appear, pull to refresh and verify notification access in both app settings and device settings.',
        },
        {
          title: 'Account and support',
          body: 'For schedule problems, missing children, or note-sync issues, contact support with the child name, session time, and device type so the problem can be reproduced faster.',
        },
      ];
    }

    return [
      {
        title: 'Arrival detection',
        body: 'Arrival Detection helps your center prepare for pickup. It uses device location when enabled, so if it stops updating, check device location permission and background location access first.',
      },
      {
        title: 'Messages and notifications',
        body: 'Use Chats for private communication with staff. If a message or reminder does not appear, refresh the screen and make sure notifications are allowed for CommunityBridge in your device settings.',
      },
      {
        title: labels.myChild || 'My Child',
        body: `Use ${labels.myChild || 'My Child'} to review profile details, assigned care team members, notes, progress, and support updates. If something looks missing, contact the center so they can confirm your linked access.`,
      },
      {
        title: 'Account and support',
        body: 'Use Profile Settings to sign out or manage account options. For login or child-linking issues, contact support and include your child name and the email on the account.',
      },
    ];
  }, [isBcba, isOfficeAdmin, isStaff, labels.myChild, labels.staffDashboard]);

  const supportLinks = useMemo(() => ([
    {
      key: 'email',
      label: 'Email Support',
      onPress: () => Linking.openURL(`mailto:${encodeURIComponent(SUPPORT_EMAIL)}?subject=${encodeURIComponent('CommunityBridge Support')}`),
    },
    {
      key: 'support',
      label: 'Support Page',
      onPress: () => Linking.openURL(SUPPORT_URL),
    },
    {
      key: 'delete',
      label: 'Delete Account',
      onPress: () => Linking.openURL(ACCOUNT_DELETE_URL),
    },
  ]), []);

  return (
    <ScreenWrapper hideBanner style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>{roleTitle}</Text>
          <Text style={styles.heroText}>{intro}</Text>
          <View style={styles.linkRow}>
            {supportLinks.map((link, index) => (
              <React.Fragment key={link.key}>
                <TouchableOpacity style={styles.linkButton} onPress={link.onPress}>
                  <Text style={styles.linkText}>{link.label}</Text>
                </TouchableOpacity>
                {index < supportLinks.length - 1 ? <Text style={styles.linkDivider}>•</Text> : null}
              </React.Fragment>
            ))}
          </View>
        </View>

        {sections.map((section) => (
          <View key={section.title} style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.paragraph}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 18, paddingTop: 12, paddingBottom: 28 },
  heroCard: { borderRadius: 20, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#dbe4f0', padding: 18 },
  heroTitle: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  heroText: { marginTop: 8, color: '#475569', lineHeight: 20 },
  linkRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', flexWrap: 'wrap' },
  linkButton: { paddingVertical: 4, paddingHorizontal: 0 },
  linkText: { color: '#1d4ed8', fontWeight: '700' },
  linkDivider: { color: '#94a3b8', marginLeft: 4, marginRight: 4, fontWeight: '700' },
  sectionCard: { marginTop: 14, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  paragraph: { marginTop: 6, color: '#374151', lineHeight: 20 },
});
