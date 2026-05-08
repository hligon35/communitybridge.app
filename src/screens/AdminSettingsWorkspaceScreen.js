import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import AddressAutocompleteField from '../components/AddressAutocompleteField';
import { useAuth } from '../AuthContext';
import * as Api from '../Api';
import { ADMIN_SECTION_KEYS, canAccessAdminSection, hasFullAdminSectionAccess } from '../core/tenant/models';
import { shouldShowSubscreenBack } from '../utils/backNavigation';

const { SUPPORT_EMAIL, SUPPORT_URL } = require('../config/brand');

const SECTION_CONFIG = {
  organization: {
    bannerTitle: 'Organization Settings',
    panelTitle: 'Organization Settings',
    panelText: 'Edit the organization profile, support channels, and arrival defaults used across the app.',
    saveLabel: 'Save organization',
  },
  branding: {
    bannerTitle: 'Branding',
    panelTitle: 'Branding Settings',
    panelText: 'Control brand naming, color tokens, and external links used in the organization-facing experience.',
    saveLabel: 'Save branding',
  },
};

function buildFormState(item) {
  const next = item && typeof item === 'object' ? item : {};
  const organizationProfile = next.organizationProfile && typeof next.organizationProfile === 'object' ? next.organizationProfile : {};
  const branding = next.branding && typeof next.branding === 'object' ? next.branding : {};
  const billing = next.billing && typeof next.billing === 'object' ? next.billing : {};
  return {
    organizationName: String(organizationProfile.organizationName || '').trim(),
    supportEmail: String(organizationProfile.supportEmail || '').trim(),
    supportPhone: String(organizationProfile.supportPhone || '').trim(),
    address: String(next.address || organizationProfile.address || '').trim(),
    dropZoneMiles: next.dropZoneMiles != null ? String(next.dropZoneMiles) : '',
    orgArrivalEnabled: Boolean(next.orgArrivalEnabled),
    brandName: String(branding.brandName || '').trim(),
    logoUrl: String(branding.logoUrl || '').trim(),
    primaryColor: String(branding.primaryColor || '').trim(),
    accentColor: String(branding.accentColor || '').trim(),
    supportUrl: String(branding.supportUrl || '').trim(),
    paymentPortalUrl: String(billing.paymentPortalUrl || '').trim(),
    billingContactEmail: String(billing.contactEmail || '').trim(),
    billingContactPhone: String(billing.contactPhone || '').trim(),
    showBillingContactEmail: billing.showContactEmail !== false,
    showBillingContactPhone: billing.showContactPhone !== false,
  };
}

function Field({ label, value, onChangeText, placeholder, multiline = false, keyboardType = 'default', autoCapitalize = 'sentences' }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        style={[styles.input, multiline ? styles.inputMultiline : null]}
      />
    </View>
  );
}

export default function AdminSettingsWorkspaceScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { user } = useAuth();
  const sectionKey = SECTION_CONFIG[route?.params?.sectionKey] ? route.params.sectionKey : 'organization';
  const sectionConfig = SECTION_CONFIG[sectionKey];
  const canManageOfficeSettings = hasFullAdminSectionAccess(user?.role, ADMIN_SECTION_KEYS.SETTINGS);
  const canSeeSettingsWorkspace = canAccessAdminSection(user?.role, ADMIN_SECTION_KEYS.SETTINGS);
  const [settingsItem, setSettingsItem] = React.useState({});
  const [form, setForm] = React.useState(() => buildFormState({}));
  const [loading, setLoading] = React.useState(canSeeSettingsWorkspace);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const loadSettings = React.useCallback(async () => {
    if (!canSeeSettingsWorkspace) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await Api.getOrgSettings();
      const item = result?.item && typeof result.item === 'object' ? result.item : {};
      setSettingsItem(item);
      setForm(buildFormState(item));
    } catch (loadError) {
      setError(String(loadError?.message || loadError || 'Could not load settings.'));
    } finally {
      setLoading(false);
    }
  }, [canSeeSettingsWorkspace]);

  React.useEffect(() => {
    loadSettings().catch(() => {});
  }, [loadSettings]);

  const updateField = React.useCallback((key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const saveSection = React.useCallback(async () => {
    if (!canManageOfficeSettings) return;
    setSaving(true);
    setError('');
    try {
      let payload = {};
      if (sectionKey === 'organization') {
        const dropZoneMilesValue = Number(form.dropZoneMiles);
        payload = {
          ...settingsItem,
          address: form.address,
          dropZoneMiles: Number.isFinite(dropZoneMilesValue) ? dropZoneMilesValue : null,
          orgArrivalEnabled: Boolean(form.orgArrivalEnabled),
          organizationProfile: {
            ...(settingsItem.organizationProfile || {}),
            organizationName: form.organizationName,
            supportEmail: form.supportEmail,
            supportPhone: form.supportPhone,
            address: form.address,
          },
          billing: {
            ...(settingsItem.billing || {}),
            paymentPortalUrl: form.paymentPortalUrl,
            contactEmail: form.billingContactEmail,
            contactPhone: form.billingContactPhone,
            showContactEmail: Boolean(form.showBillingContactEmail),
            showContactPhone: Boolean(form.showBillingContactPhone),
          },
        };
      } else {
        payload = {
          ...settingsItem,
          branding: {
            ...(settingsItem.branding || {}),
            brandName: form.brandName,
            logoUrl: form.logoUrl,
            primaryColor: form.primaryColor,
            accentColor: form.accentColor,
            supportUrl: form.supportUrl,
          },
        };
      }
      const result = await Api.updateOrgSettings(payload);
      const item = result?.item && typeof result.item === 'object' ? result.item : payload;
      setSettingsItem(item);
      setForm(buildFormState(item));
    } catch (saveError) {
      setError(String(saveError?.message || saveError || 'Could not save settings.'));
    } finally {
      setSaving(false);
    }
  }, [canManageOfficeSettings, form, sectionKey, settingsItem]);

  const renderSection = () => {
    if (loading) {
      return (
        <View style={styles.panelCard}>
          <ActivityIndicator color="#2563eb" />
          <Text style={styles.panelStatus}>Loading settings...</Text>
        </View>
      );
    }

    if (sectionKey === 'organization') {
      return (
        <View style={styles.panelCard}>
          <View style={styles.panelHeader}>
            <View style={styles.panelHeaderText}>
              <Text style={styles.panelTitle}>{sectionConfig.panelTitle}</Text>
              <Text style={styles.panelText}>{sectionConfig.panelText}</Text>
            </View>
            {canManageOfficeSettings ? (
              <TouchableOpacity style={styles.saveButton} onPress={saveSection} disabled={saving}>
                <Text style={styles.saveButtonText}>{saving ? 'Saving...' : sectionConfig.saveLabel}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.editorGrid}>
            <Field label="Organization name" value={form.organizationName} onChangeText={(value) => updateField('organizationName', value)} placeholder="AlphaZone Labs" />
            <Field label="Support email" value={form.supportEmail} onChangeText={(value) => updateField('supportEmail', value)} placeholder={SUPPORT_EMAIL} keyboardType="email-address" autoCapitalize="none" />
            <Field label="Support phone" value={form.supportPhone} onChangeText={(value) => updateField('supportPhone', value)} placeholder="(555) 123-4567" keyboardType="phone-pad" autoCapitalize="none" />
          </View>
          <AddressAutocompleteField label="Organization address" value={form.address} onChangeText={(value) => updateField('address', value)} placeholder="123 Main St, City, ST 00000" />
          <View style={styles.editorGrid}>
            <Field label="Arrival action radius (miles)" value={form.dropZoneMiles} onChangeText={(value) => updateField('dropZoneMiles', value)} placeholder="0.25" keyboardType="decimal-pad" autoCapitalize="none" />
            <View style={styles.switchCard}>
              <Text style={styles.fieldLabel}>Arrival check-in enabled</Text>
              <Text style={styles.switchText}>Allow organization-level arrival detection and check-in prompts.</Text>
              <Switch value={Boolean(form.orgArrivalEnabled)} onValueChange={(value) => updateField('orgArrivalEnabled', value)} trackColor={{ false: '#cbd5e1', true: '#93c5fd' }} thumbColor={form.orgArrivalEnabled ? '#2563eb' : '#f8fafc'} />
            </View>
          </View>
          <View style={styles.sectionDivider}>
            <Text style={styles.sectionTitle}>Billing Contact Settings</Text>
            <Text style={styles.panelText}>Configure the organization payment portal and which billing contact methods families can use.</Text>
          </View>
          <Field label="Payment portal URL" value={form.paymentPortalUrl} onChangeText={(value) => updateField('paymentPortalUrl', value)} placeholder="https://payments.example.org/portal" autoCapitalize="none" />
          <View style={styles.editorGrid}>
            <Field label="Billing contact email" value={form.billingContactEmail} onChangeText={(value) => updateField('billingContactEmail', value)} placeholder="billing@communitybridge.app" keyboardType="email-address" autoCapitalize="none" />
            <Field label="Billing contact phone" value={form.billingContactPhone} onChangeText={(value) => updateField('billingContactPhone', value)} placeholder="(555) 123-4567" keyboardType="phone-pad" autoCapitalize="none" />
          </View>
          <View style={styles.editorGrid}>
            <View style={styles.switchCard}>
              <Text style={styles.fieldLabel}>Show billing contact email</Text>
              <Text style={styles.switchText}>Expose the billing email from the family billing screen.</Text>
              <Switch value={Boolean(form.showBillingContactEmail)} onValueChange={(value) => updateField('showBillingContactEmail', value)} trackColor={{ false: '#cbd5e1', true: '#93c5fd' }} thumbColor={form.showBillingContactEmail ? '#2563eb' : '#f8fafc'} />
            </View>
            <View style={styles.switchCard}>
              <Text style={styles.fieldLabel}>Show billing contact phone</Text>
              <Text style={styles.switchText}>Expose the billing phone number from the family billing screen.</Text>
              <Switch value={Boolean(form.showBillingContactPhone)} onValueChange={(value) => updateField('showBillingContactPhone', value)} trackColor={{ false: '#cbd5e1', true: '#93c5fd' }} thumbColor={form.showBillingContactPhone ? '#2563eb' : '#f8fafc'} />
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.panelCard}>
        <View style={styles.panelHeader}>
          <View style={styles.panelHeaderText}>
            <Text style={styles.panelTitle}>{sectionConfig.panelTitle}</Text>
            <Text style={styles.panelText}>{sectionConfig.panelText}</Text>
          </View>
          {canManageOfficeSettings ? (
            <TouchableOpacity style={styles.saveButton} onPress={saveSection} disabled={saving}>
              <Text style={styles.saveButtonText}>{saving ? 'Saving...' : sectionConfig.saveLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.editorGrid}>
          <Field label="Brand name" value={form.brandName} onChangeText={(value) => updateField('brandName', value)} placeholder="CommunityBridge" />
          <Field label="Logo URL" value={form.logoUrl} onChangeText={(value) => updateField('logoUrl', value)} placeholder="https://.../logo.png" autoCapitalize="none" />
          <Field label="Support URL" value={form.supportUrl} onChangeText={(value) => updateField('supportUrl', value)} placeholder={SUPPORT_URL} autoCapitalize="none" />
        </View>
        <View style={styles.editorGrid}>
          <Field label="Primary color" value={form.primaryColor} onChangeText={(value) => updateField('primaryColor', value)} placeholder="#2563EB" autoCapitalize="characters" />
          <Field label="Accent color" value={form.accentColor} onChangeText={(value) => updateField('accentColor', value)} placeholder="#0F172A" autoCapitalize="characters" />
        </View>
        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>Preview</Text>
          <View style={styles.previewRow}>
            <View style={[styles.swatch, { backgroundColor: form.primaryColor || '#2563eb' }]} />
            <View style={[styles.swatch, { backgroundColor: form.accentColor || '#0f172a' }]} />
            <View>
              <Text style={styles.previewName}>{form.brandName || 'CommunityBridge'}</Text>
              <Text style={styles.previewUrl}>{form.supportUrl || 'Support link not set'}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <ScreenWrapper style={styles.container} bannerShowBack={shouldShowSubscreenBack(navigation, route?.name)} bannerTitle={sectionConfig.bannerTitle}>
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {renderSection()}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 40 },
  errorText: { marginTop: 14, color: '#b91c1c', fontWeight: '600' },
  panelCard: { borderRadius: 22, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#ffffff', padding: 18 },
  panelHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  panelHeaderText: { flex: 1, paddingRight: 12 },
  panelTitle: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  panelText: { marginTop: 6, maxWidth: 700, color: '#64748b', lineHeight: 20 },
  panelStatus: { marginTop: 10, color: '#64748b', textAlign: 'center' },
  saveButton: { borderRadius: 12, backgroundColor: '#0f172a', paddingHorizontal: 16, paddingVertical: 12 },
  saveButtonText: { color: '#fff', fontWeight: '800' },
  editorGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 4 },
  field: { width: '100%', marginTop: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#dbe2ea', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#fff', color: '#0f172a' },
  inputMultiline: { minHeight: 92, textAlignVertical: 'top' },
  switchCard: { width: '100%', marginTop: 14, borderWidth: 1, borderColor: '#dbe2ea', borderRadius: 12, padding: 14, backgroundColor: '#f8fafc' },
  switchText: { marginTop: 6, marginBottom: 12, color: '#64748b', lineHeight: 19 },
  sectionDivider: { marginTop: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  previewCard: { marginTop: 16, borderRadius: 16, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', padding: 16 },
  previewLabel: { fontSize: 12, fontWeight: '800', color: '#475569', textTransform: 'uppercase' },
  previewRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center' },
  swatch: { width: 18, height: 18, borderRadius: 999, marginRight: 10, borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)' },
  previewName: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  previewUrl: { marginTop: 4, color: '#64748b' },
});