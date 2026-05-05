import React, { useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { hasFullAdminSectionAccess, ADMIN_SECTION_KEYS } from '../core/tenant/models';
import * as Api from '../Api';

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeHeader(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean);
  return normalizeText(value).split(/[;,|]/).map((item) => normalizeText(item)).filter(Boolean);
}

function buildImportId(prefix, parts, fallbackIndex) {
  const base = parts
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean)
    .join('-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base) return `${prefix}-${base}`;
  return `${prefix}-${fallbackIndex}-${Date.now().toString(36)}`;
}

function buildRowMap(record) {
  const map = new Map();
  Object.entries(record && typeof record === 'object' ? record : {}).forEach(([key, value]) => {
    map.set(normalizeHeader(key), value);
  });
  return map;
}

function pickValue(record, aliases) {
  const map = buildRowMap(record);
  for (const alias of aliases) {
    const value = map.get(normalizeHeader(alias));
    if (Array.isArray(value)) {
      if (value.length) return value;
      continue;
    }
    if (normalizeText(value)) return value;
  }
  return '';
}

function parseDelimitedRecords(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const rows = [];
  let currentCell = '';
  let currentRow = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === ',' && !insideQuotes) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1;
      currentRow.push(currentCell);
      if (currentRow.some((value) => normalizeText(value))) rows.push(currentRow);
      currentCell = '';
      currentRow = [];
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  if (currentRow.some((value) => normalizeText(value))) rows.push(currentRow);
  if (!rows.length) return [];

  const headers = rows[0].map((header, index) => normalizeText(header) || `column_${index + 1}`);
  return rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] != null ? row[index] : '';
    });
    return record;
  });
}

function inferRecordType(record) {
  const explicit = normalizeText(pickValue(record, ['type', 'entity', 'record type', 'kind', 'category'])).toLowerCase();
  if (explicit.includes('parent') || explicit.includes('guardian') || explicit.includes('family')) return 'parent';
  if (explicit.includes('staff') || explicit.includes('therap') || explicit.includes('bcba') || explicit.includes('teacher') || explicit.includes('faculty') || explicit.includes('provider')) return 'therapist';
  if (explicit.includes('child') || explicit.includes('student') || explicit.includes('learner')) return 'child';

  if (normalizeText(pickValue(record, ['child name', 'student name', 'learner name', 'student', 'learner']))) return 'child';

  const role = normalizeText(pickValue(record, ['role', 'title', 'staff role'])).toLowerCase();
  if (role && !role.includes('parent')) return 'therapist';

  if (normalizeText(pickValue(record, ['parent name', 'guardian name', 'guardian', 'parent']))) return 'parent';
  return '';
}

function normalizeChildRecord(record, index) {
  const name = normalizeText(pickValue(record, ['name', 'child name', 'student name', 'learner name', 'student', 'learner']));
  if (!name) return null;
  const parentName = normalizeText(pickValue(record, ['parent name', 'guardian name', 'guardian', 'parent']));
  const parentEmail = normalizeEmail(pickValue(record, ['parent email', 'guardian email', 'family email']));
  const parentPhone = normalizeText(pickValue(record, ['parent phone', 'guardian phone', 'family phone']));
  const parents = [];
  if (parentName || parentEmail || parentPhone) {
    parents.push({
      ...(parentName ? { name: parentName } : { name: parentEmail || 'Parent/Guardian' }),
      ...(parentEmail ? { email: parentEmail } : {}),
      ...(parentPhone ? { phone: parentPhone } : {}),
    });
  }
  return {
    id: normalizeText(pickValue(record, ['id', 'child id', 'student id', 'learner id'])) || buildImportId('child', [name, parentName, parentEmail], index),
    name,
    age: normalizeText(pickValue(record, ['age', 'grade', 'dob', 'date of birth'])),
    room: normalizeText(pickValue(record, ['room', 'classroom', 'homeroom', 'class'])),
    session: normalizeText(pickValue(record, ['session'])).toUpperCase(),
    organizationId: normalizeText(pickValue(record, ['organization id', 'org id'])),
    organizationName: normalizeText(pickValue(record, ['organization', 'organization name', 'org name'])),
    programId: normalizeText(pickValue(record, ['program id', 'program'])),
    programName: normalizeText(pickValue(record, ['program name'])),
    campusId: normalizeText(pickValue(record, ['campus id', 'location id', 'site id'])),
    campusName: normalizeText(pickValue(record, ['campus', 'location', 'site', 'campus name', 'location name'])),
    enrollmentCode: normalizeText(pickValue(record, ['enrollment code', 'code'])).toUpperCase(),
    carePlan: normalizeText(pickValue(record, ['care plan', 'program notes', 'notes'])),
    parents,
  };
}

function normalizeParentRecord(record, index) {
  const name = normalizeText(pickValue(record, ['name', 'parent name', 'guardian name', 'guardian', 'parent']));
  const email = normalizeEmail(pickValue(record, ['email', 'parent email', 'guardian email']));
  const phone = normalizeText(pickValue(record, ['phone', 'parent phone', 'guardian phone']));
  if (!name && !email && !phone) return null;
  return {
    id: normalizeText(pickValue(record, ['id', 'parent id', 'guardian id'])) || buildImportId('parent', [email, name, phone], index),
    name: name || email || 'Parent/Guardian',
    email,
    phone,
    childIds: splitList(pickValue(record, ['child ids', 'children', 'learner ids', 'student ids'])),
  };
}

function normalizeTherapistRecord(record, index) {
  const name = normalizeText(pickValue(record, ['name', 'staff name', 'therapist name', 'provider name', 'employee name']));
  const email = normalizeEmail(pickValue(record, ['email', 'staff email', 'therapist email']));
  const phone = normalizeText(pickValue(record, ['phone', 'staff phone', 'therapist phone']));
  const role = normalizeText(pickValue(record, ['role', 'title', 'staff role'])) || 'staff';
  if (!name && !email) return null;
  return {
    id: normalizeText(pickValue(record, ['id', 'staff id', 'therapist id', 'provider id'])) || buildImportId('staff', [email, name, role], index),
    name: name || email || 'Staff',
    email,
    phone,
    role,
  };
}

function dedupeRecords(items) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item?.id) return;
    map.set(String(item.id), { ...(map.get(String(item.id)) || {}), ...item });
  });
  return Array.from(map.values());
}

function normalizeImportedDirectory(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const children = [];
  const parents = [];
  const therapists = [];

  function ingestRecords(records, explicitType = '') {
    (Array.isArray(records) ? records : []).forEach((record, index) => {
      const type = explicitType || inferRecordType(record);
      if (type === 'child') {
        const normalized = normalizeChildRecord(record, children.length + index + 1);
        if (normalized) children.push(normalized);
        return;
      }
      if (type === 'parent') {
        const normalized = normalizeParentRecord(record, parents.length + index + 1);
        if (normalized) parents.push(normalized);
        return;
      }
      if (type === 'therapist') {
        const normalized = normalizeTherapistRecord(record, therapists.length + index + 1);
        if (normalized) therapists.push(normalized);
      }
    });
  }

  if (Array.isArray(source)) {
    ingestRecords(source);
  } else {
    ingestRecords(source.children || source.students || source.learners, 'child');
    ingestRecords(source.parents || source.guardians || source.families, 'parent');
    ingestRecords(source.therapists || source.staff || source.providers || source.faculty || source.employees, 'therapist');
    ingestRecords(source.records || source.items || source.rows);
    if (!children.length && !parents.length && !therapists.length) {
      ingestRecords([source]);
    }
  }

  const normalized = {
    children: dedupeRecords(children),
    parents: dedupeRecords(parents),
    therapists: dedupeRecords(therapists),
  };
  const total = normalized.children.length + normalized.parents.length + normalized.therapists.length;
  if (!total) throw new Error('Import file did not contain any recognizable children, parents, or staff records.');
  return normalized;
}

export default function ImportCenterScreen() {
  const { user } = useAuth();
  const { fetchAndSync } = useData();
  const canManageImports = hasFullAdminSectionAccess(user?.role, ADMIN_SECTION_KEYS.SETTINGS);
  const [pickedFile, setPickedFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastImportSummary, setLastImportSummary] = useState(null);
  const [auditItems, setAuditItems] = useState([]);
  const [auditError, setAuditError] = useState('');

  const samplePayload = useMemo(() => ({
    learners: [{ child_name: 'Sample Learner', guardian_name: 'Sample Parent', enrollment_code: 'CENTER-101', room: 'A1' }],
    staff: [{ full_name: 'Sample BCBA', title: 'bcba', email: 'bcba@example.com' }],
  }), []);

  if (!canManageImports) {
    return (
      <ScreenWrapper style={styles.container}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Import Center is reserved for office admin workflow.</Text>
        </View>
      </ScreenWrapper>
    );
  }

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setAuditError('');
        const response = await Api.getAuditLogs(12);
        if (!mounted) return;
        const items = Array.isArray(response?.items) ? response.items : [];
        setAuditItems(items.filter((item) => String(item?.action || '').toLowerCase().includes('directory') || String(item?.action || '').toLowerCase().includes('import')));
      } catch (_) {
        if (mounted) {
          setAuditItems([]);
          setAuditError('Could not load recent import audit activity.');
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function pickImportFile() {
    try {
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        await new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.json,.csv,text/csv,application/json,text/plain';
          input.onchange = () => {
            const file = input.files && input.files[0] ? input.files[0] : null;
            if (file) {
              setPickedFile({
                name: file.name || 'selected file',
                file,
                size: file.size,
              });
            }
            resolve();
          };
          input.click();
        });
        return;
      }

      const DocumentPickerModule = require('expo-document-picker');
      const DocumentPicker = DocumentPickerModule?.default || DocumentPickerModule;
      if (!DocumentPicker?.getDocumentAsync) {
        Alert.alert('Import', 'File picker is not available.');
        return;
      }
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/csv', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result?.canceled) return;
      const asset = Array.isArray(result?.assets) ? result.assets[0] : null;
      if (!asset?.uri) return;
      setPickedFile({ name: asset.name || 'selected file', uri: asset.uri, size: asset.size });
    } catch (error) {
      Alert.alert('Import failed', error?.message || String(error));
    }
  }

  async function readImportContents() {
    if (!pickedFile) throw new Error('Choose a JSON or CSV file before importing.');
    if (pickedFile.file && typeof pickedFile.file.text === 'function') return pickedFile.file.text();
    if (pickedFile.uri) return FileSystem.readAsStringAsync(pickedFile.uri, { encoding: FileSystem.EncodingType.UTF8 });
    throw new Error('Selected file could not be read.');
  }

  async function runImport() {
    try {
      setBusy(true);
      const raw = await readImportContents();
      const fileName = String(pickedFile?.name || '').toLowerCase();
      let parsed;
      if (fileName.endsWith('.csv')) {
        parsed = parseDelimitedRecords(raw);
      } else {
        try {
          parsed = JSON.parse(String(raw || ''));
        } catch (_) {
          parsed = parseDelimitedRecords(raw);
        }
      }
      const normalized = normalizeImportedDirectory(parsed);
      await Api.mergeDirectory(normalized);
      await fetchAndSync({ force: true });
      setLastImportSummary({
        children: normalized.children.length,
        parents: normalized.parents.length,
        therapists: normalized.therapists.length,
        importedAt: new Date().toISOString(),
      });
      Alert.alert('Import complete', `Imported ${normalized.children.length} students, ${normalized.parents.length} parents, and ${normalized.therapists.length} staff records.`);
    } catch (error) {
      Alert.alert('Import failed', error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenWrapper style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Supported shapes</Text>
          <Text style={styles.helperText}>Use top-level arrays such as children, students, learners, parents, guardians, staff, providers, or a flat CSV or records export with recognizable headers like student name, guardian name, room, role, or email.</Text>
          <Text style={styles.codeBlock}>{JSON.stringify(samplePayload, null, 2)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Import file</Text>
          <Text style={styles.helperText}>{pickedFile ? `${pickedFile.name}${pickedFile.size ? ` • ${pickedFile.size} bytes` : ''}` : 'No file selected yet.'}</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.primaryButton} onPress={pickImportFile} disabled={busy}>
              <Text style={styles.primaryButtonText}>{pickedFile ? 'Change File' : 'Choose File'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondaryButton, !pickedFile ? styles.disabledButton : null]} onPress={runImport} disabled={busy || !pickedFile}>
              <Text style={styles.secondaryButtonText}>{busy ? 'Importing...' : 'Run Import'}</Text>
            </TouchableOpacity>
          </View>
          {lastImportSummary ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Last Import</Text>
              <Text style={styles.summaryText}>{lastImportSummary.children} students • {lastImportSummary.parents} parents • {lastImportSummary.therapists} staff</Text>
              <Text style={styles.summaryText}>{new Date(lastImportSummary.importedAt).toLocaleString()}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Recent import-related audit activity</Text>
          {auditError ? <Text style={styles.errorText}>{auditError}</Text> : null}
          {auditItems.length ? auditItems.map((item) => (
            <View key={item.id || item.createdAt} style={styles.auditRow}>
              <Text style={styles.auditAction}>{String(item.action || 'audit.event')}</Text>
              <Text style={styles.auditMeta}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Unknown time'}</Text>
            </View>
          )) : <Text style={styles.helperText}>No import audit entries yet.</Text>}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16 },
  card: { marginTop: 14, borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff', padding: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#111827', marginBottom: 8 },
  codeBlock: { borderRadius: 12, backgroundColor: '#0f172a', color: '#e2e8f0', padding: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, marginTop: 12 },
  helperText: { color: '#64748b', lineHeight: 18 },
  errorText: { color: '#b91c1c', marginBottom: 8 },
  buttonRow: { flexDirection: 'row', marginTop: 12 },
  primaryButton: { flex: 1, backgroundColor: '#2563eb', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginRight: 8 },
  primaryButtonText: { color: '#fff', fontWeight: '800' },
  secondaryButton: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#334155', fontWeight: '800' },
  disabledButton: { opacity: 0.55 },
  summaryCard: { marginTop: 12, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', padding: 12 },
  summaryTitle: { fontWeight: '800', color: '#0f172a', marginBottom: 4 },
  summaryText: { color: '#475569' },
  auditRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  auditAction: { color: '#0f172a', fontWeight: '700' },
  auditMeta: { marginTop: 4, color: '#64748b' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#475569', textAlign: 'center', lineHeight: 22 },
});