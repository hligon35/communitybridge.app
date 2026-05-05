import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useAuth } from '../AuthContext';
import { ADMIN_SECTION_KEYS, canAccessAdminSection, hasFullAdminSectionAccess, isBcbaRole } from '../core/tenant/models';

export default function AdminSettingsHubScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isBcba = isBcbaRole(user?.role);
  const canManageOfficeSettings = hasFullAdminSectionAccess(user?.role, ADMIN_SECTION_KEYS.SETTINGS);
  const canSeeSettingsWorkspace = canAccessAdminSection(user?.role, ADMIN_SECTION_KEYS.SETTINGS);

  const cardBasis = width >= 1040 ? '31.6%' : width >= 700 ? '48.4%' : '100%';

  const openPersonalSettings = React.useCallback(() => {
    const parentNavigation = navigation.getParent?.();
    if (parentNavigation?.navigate) {
      parentNavigation.navigate('Settings', { screen: 'SettingsMain' });
      return;
    }
    navigation.navigate('Settings', { screen: 'SettingsMain' });
  }, [navigation]);

  const sections = canSeeSettingsWorkspace ? [
    { title: 'Personal Settings', description: 'Update your own display name, contact details, privacy preferences, and notification settings.', action: openPersonalSettings },
    { title: 'Organization Settings', description: canManageOfficeSettings ? 'Office configuration for organization profile, campuses, and operating defaults.' : 'Review organization profile, campuses, and operating defaults from one workspace.', action: () => navigation.navigate('OrganizationSettings') },
    { title: 'User Roles & Permissions', description: canManageOfficeSettings ? 'Office role and access management.' : 'Review role access and permission routing from a dedicated settings screen.', action: () => navigation.navigate('ManagePermissions') },
    { title: 'Clinical Templates', description: 'BCBA clinical templates and reusable programming standards.', action: () => navigation.navigate('ProgramDirectory', { focusMode: 'library' }) },
    { title: 'Import Center', description: canManageOfficeSettings ? 'Office imports for users, rosters, and documents.' : 'Open the import center to review roster, document, and user-import workflows.', action: () => navigation.navigate('ImportCenter') },
    { title: 'Branding', description: canManageOfficeSettings ? 'Logo, visual identity, and published experience controls.' : 'Review organization branding, colors, and published support links.', action: () => navigation.navigate('BrandingSettings') },
  ] : [];

  return (
    <ScreenWrapper style={styles.container} bannerShowBack={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.grid}>
          {sections.map((section) => {
            return (
              <TouchableOpacity
                key={section.title}
                style={[styles.card, { flexBasis: cardBasis }]}
                onPress={section.action}
                accessibilityRole="button"
                accessibilityLabel={section.title}
                activeOpacity={0.88}
              >
                <View style={styles.cardContent}>
                  <View style={styles.cardTitleButton}>
                    <Text style={styles.cardTitle}>{section.title}</Text>
                  </View>
                  <Text style={styles.cardDescription}>{section.description}</Text>
                </View>
                <View style={styles.cardActionRow}>
                  <Text style={styles.cardActionText}>{section.title === 'Personal Settings' ? 'Open profile settings' : 'Open workspace'}</Text>
                  <MaterialIcons name="arrow-forward" size={18} color="#64748b" />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { marginTop: 14, borderRadius: 18, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff', padding: 16, minHeight: 176 },
  cardContent: { flexGrow: 1 },
  cardTitleButton: { alignSelf: 'flex-start' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  cardDescription: { marginTop: 10, color: '#64748b', lineHeight: 20 },
  cardActionRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardActionText: { color: '#0f172a', fontWeight: '700' },
});