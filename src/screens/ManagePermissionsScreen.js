import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, TextInput, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AppDropdown from '../components/AppDropdown';
import { ScreenWrapper } from '../components/ScreenWrapper';
import AddressAutocompleteField from '../components/AddressAutocompleteField';
import ImageToggle from '../components/ImageToggle';
import { useAuth } from '../AuthContext';
import { buildTenantProfile, isSuperAdminRole, normalizeUserRole, uniqueIds } from '../core/tenant/models';
import { listActiveOrganizations } from '../core/tenant/OrganizationRepository';
import { listProgramsByOrganization } from '../core/tenant/ProgramRepository';
import { listCampusesByOrganization } from '../core/tenant/CampusRepository';
import { THERAPY_ROLE_LABELS, getDisplayRoleLabel } from '../utils/roleTerminology';
import { formatAddressInput } from '../utils/addressInput';
import { formatPhoneInput } from '../utils/inputFormat';
import { getPasswordPolicyError } from '../utils/passwordPolicy';
import * as Api from '../Api';

function InlineToast({ toast, onClose }) {
  if (!toast?.visible) return null;
  const tone = toast.tone || 'success';
  const config = tone === 'error'
    ? { card: styles.toastError, icon: 'error-outline', iconColor: '#b91c1c' }
    : tone === 'info'
      ? { card: styles.toastInfo, icon: 'info-outline', iconColor: '#1d4ed8' }
      : { card: styles.toastSuccess, icon: 'check-circle-outline', iconColor: '#166534' };

  return (
    <View pointerEvents="box-none" style={styles.toastHost}>
      <View style={[styles.toastCard, config.card]}>
        <MaterialIcons name={config.icon} size={20} color={config.iconColor} style={styles.toastIcon} />
        <View style={styles.toastCopy}>
          {toast.title ? <Text style={styles.toastTitle}>{toast.title}</Text> : null}
          {toast.message ? <Text style={styles.toastMessage}>{toast.message}</Text> : null}
        </View>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss message" style={styles.toastDismiss}>
          <MaterialIcons name="close" size={18} color="#475569" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const DEFAULT_ROLES = ['Admin', 'Office', 'BCBA', 'Therapist', 'Parent', 'Super Admin'];
const DEFAULT_CAPS = [
  { id: 'users:manage', label: 'Manage users' },
  { id: 'children:edit', label: 'Edit children' },
  { id: 'messages:send', label: 'Send messages' },
  { id: 'settings:system', label: 'System settings' },
  { id: 'export:data', label: 'Export data' },
];
const PERMISSION_GROUPS = [
  {
    key: 'operations',
    label: 'Operations',
    description: 'Administrative and office-facing controls for user access, exports, settings, and operational workflows.',
    roles: ['Admin', 'Office', 'Super Admin'],
  },
  {
    key: 'clinical',
    label: 'Clinical',
    description: `BCBA and ${THERAPY_ROLE_LABELS.therapist} workflows, child editing, and clinical communication.`,
    roles: ['BCBA', 'Therapist'],
  },
  {
    key: 'family',
    label: 'Family',
    description: 'Parent-facing communication and constrained account access.',
    roles: ['Parent'],
  },
];
const ROLE_OPTIONS = [
  { value: 'parent', label: 'Parent', adminOnly: false },
  { value: 'therapist', label: THERAPY_ROLE_LABELS.therapist, adminOnly: false },
  { value: 'bcba', label: 'BCBA', adminOnly: false },
  { value: 'office', label: 'Office', adminOnly: false },
  { value: 'admin', label: 'Admin', adminOnly: true },
];
const STAFF_INVITE_ROLE_OPTIONS = [
  { value: 'bcba', label: 'BCBA', adminOnly: false },
  { value: 'office', label: 'Office', adminOnly: false },
  { value: 'therapist', label: 'ABA Tech', adminOnly: false },
  { value: 'admin', label: 'Admin', adminOnly: true },
];

function capabilityRoleKey(role) {
  const value = normalizeUserRole(role);
  if (value === 'superAdmin') return 'Super Admin';
  if (value === 'admin') return 'Admin';
  if (value === 'office') return 'Office';
  if (value === 'bcba') return 'BCBA';
  if (value === 'therapist') return 'Therapist';
  if (value === 'parent') return 'Parent';
  return 'Therapist';
}

function createUserDraft(user) {
  const item = user && typeof user === 'object' ? user : {};
  return {
    name: String(item.name || ''),
    email: String(item.email || ''),
    phone: formatPhoneInput(item.phone),
    address: String(item.address || ''),
    role: normalizeUserRole(item.role),
    organizationId: String(item.organizationId || ''),
    programIds: Array.isArray(item.programIds) ? item.programIds.map(String) : [],
    campusIds: Array.isArray(item.campusIds) ? item.campusIds.map(String) : [],
    password: '',
  };
}

function normalizeManagedUsers(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    role: normalizeUserRole(item?.role),
  }));
}

function isPendingInvite(invite) {
  if (!invite || typeof invite !== 'object') return false;
  const status = String(invite.status || '').trim().toLowerCase();
  if (status === 'used' || status === 'revoked') return false;
  return status === 'sent' || status === 'started' || String(invite.lastEmailStatus || '').trim().toLowerCase() === 'failed';
}

function isValidEmail(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function buildDefaultMapping() {
  const init = {};
  DEFAULT_ROLES.forEach((role) => {
    init[role] = {};
    DEFAULT_CAPS.forEach((cap) => { init[role][cap.id] = false; });
  });
  return init;
}

export default function ManagePermissionsScreen(){
  const { user } = useAuth();
  const toastTimerRef = useRef(null);
  const [mapping, setMapping] = useState(buildDefaultMapping());
  const [managedUsers, setManagedUsers] = useState([]);
  const [userDrafts, setUserDrafts] = useState({});
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const [permissionsSaving, setPermissionsSaving] = useState(false);
  const [permissionsError, setPermissionsError] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [savingUserId, setSavingUserId] = useState('');
  const [deletingUserId, setDeletingUserId] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [toast, setToast] = useState({ visible: false, title: '', message: '', tone: 'success' });
  const [inviteDraft, setInviteDraft] = useState({ email: '', role: 'bcba' });
  const [sectionsOpen, setSectionsOpen] = useState({ users: true, permissions: true });
  const [roleSectionsOpen, setRoleSectionsOpen] = useState({
    Admin: true,
    Office: false,
    BCBA: false,
    Therapist: false,
    Parent: false,
    'Super Admin': false,
  });
  const [userSectionsOpen, setUserSectionsOpen] = useState({});
  const [selectedPermissionGroup, setSelectedPermissionGroup] = useState('operations');
  const [organizations, setOrganizations] = useState([]);
  const [programsByOrg, setProgramsByOrg] = useState({});
  const [campusesByOrg, setCampusesByOrg] = useState({});
  const canManagePermissions = normalizeUserRole(user?.role) === 'admin';
  const actorTenantProfile = useMemo(() => buildTenantProfile(user || {}), [user]);
  const actorOrganizationIds = useMemo(() => {
    if (canManagePermissions) return [];
    return uniqueIds([
      actorTenantProfile.organizationId,
      ...actorTenantProfile.memberships.map((membership) => String(membership?.organizationId || '').trim()),
    ]);
  }, [actorTenantProfile, canManagePermissions]);
  const actorProgramIds = useMemo(() => {
    if (canManagePermissions) return [];
    return uniqueIds(actorTenantProfile.programIds);
  }, [actorTenantProfile.programIds, canManagePermissions]);
  const actorCampusIds = useMemo(() => {
    if (canManagePermissions) return [];
    return uniqueIds(actorTenantProfile.campusIds);
  }, [actorTenantProfile.campusIds, canManagePermissions]);
  const canManageUsers = useMemo(() => {
    return normalizeUserRole(user?.role) === 'admin';
  }, [user?.role]);
  const visibleRoleOptions = useMemo(() => {
    return ROLE_OPTIONS.filter((option) => canManagePermissions || !option.adminOnly);
  }, [canManagePermissions]);
  const visibleInviteRoleOptions = useMemo(() => {
    return STAFF_INVITE_ROLE_OPTIONS.filter((option) => canManagePermissions || !option.adminOnly);
  }, [canManagePermissions]);
  const selectedInviteRole = useMemo(() => {
    return visibleInviteRoleOptions.find((option) => option.value === normalizeUserRole(inviteDraft.role)) || visibleInviteRoleOptions[0] || null;
  }, [inviteDraft.role, visibleInviteRoleOptions]);

  const campusLookup = useMemo(() => {
    const map = new Map();
    Object.values(campusesByOrg || {}).forEach((items) => {
      (Array.isArray(items) ? items : []).forEach((item) => {
        if (item?.id) map.set(String(item.id), item);
      });
    });
    return map;
  }, [campusesByOrg]);
  const visiblePermissionGroup = useMemo(() => {
    return PERMISSION_GROUPS.find((group) => group.key === selectedPermissionGroup) || PERMISSION_GROUPS[0];
  }, [selectedPermissionGroup]);
  const visiblePermissionRoles = useMemo(() => {
    const roles = visiblePermissionGroup?.roles || DEFAULT_ROLES;
    return roles.filter((role) => DEFAULT_ROLES.includes(role));
  }, [visiblePermissionGroup]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  function dismissToast() {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast((current) => ({ ...current, visible: false }));
  }

  function showToast(payload) {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    const next = typeof payload === 'string' ? { message: payload } : (payload || {});
    setToast({
      visible: true,
      title: String(next.title || '').trim(),
      message: String(next.message || '').trim(),
      tone: next.tone || 'success',
    });
    toastTimerRef.current = setTimeout(() => {
      setToast((current) => ({ ...current, visible: false }));
      toastTimerRef.current = null;
    }, next.durationMs || 3600);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      if (!canManagePermissions && !actorOrganizationIds.length) {
        if (active) setOrganizations([]);
        return;
      }
      try {
        const items = await listActiveOrganizations();
        const nextItems = (Array.isArray(items) ? items : []).filter((item) => {
          if (canManagePermissions) return true;
          return actorOrganizationIds.includes(String(item?.id || '').trim());
        });
        if (active) setOrganizations(nextItems);
      } catch (_) {
        if (active) {
          setOrganizations([]);
          setUsersError((current) => current || 'Could not load organization directory options.');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [actorOrganizationIds, canManagePermissions]);

  useEffect(() => {
    (async () => {
      try {
        setPermissionsLoading(true);
        setPermissionsError('');
        const res = await Api.getPermissionsConfig();
        setMapping({ ...buildDefaultMapping(), ...(res?.item || {}) });
      } catch (e) {
        setPermissionsError(String(e?.message || 'Could not load permissions configuration.'));
        setMapping(buildDefaultMapping());
      } finally {
        setPermissionsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!canManageUsers) {
      setManagedUsers([]);
      setUserDrafts({});
      return;
    }

    (async () => {
      try {
        setUsersLoading(true);
        setUsersError('');
        const res = await Api.listManagedUsers();
        const items = normalizeManagedUsers(res?.items);
        const nextDrafts = {};
        const nextSectionsOpen = {};
        items.forEach((item, index) => {
          nextDrafts[item.id] = createUserDraft(item);
          nextSectionsOpen[item.id] = index === 0;
        });
        setManagedUsers(items);
        setUserDrafts(nextDrafts);
        setUserSectionsOpen(nextSectionsOpen);
      } catch (e) {
        setUsersError(String(e?.message || 'Could not load managed users.'));
      } finally {
        setUsersLoading(false);
      }
    })();
  }, [canManageUsers]);

  useEffect(() => {
    const orgIds = Array.from(new Set(Object.values(userDrafts || {})
      .map((draft) => String(draft?.organizationId || '').trim())
      .filter(Boolean)));
    orgIds.forEach((orgId) => {
      ensureProgramsLoaded(orgId);
      ensureCampusesLoaded(orgId);
    });
  }, [userDrafts]);

  async function toggle(role, capId, value){
    if (!canManagePermissions || permissionsSaving) return;
    const nextMapping = { ...mapping, [role]: { ...(mapping[role] || {}), [capId]: !!value } };
    setMapping(nextMapping);
    try {
      setPermissionsSaving(true);
      setPermissionsError('');
      await Api.updatePermissionsConfig(nextMapping);
    } catch (e) {
      setPermissionsError(String(e?.message || 'Could not save permissions configuration.'));
      setMapping(mapping);
    } finally {
      setPermissionsSaving(false);
    }
  }

  function updateUserDraft(userId, field, value) {
    const nextValue = field === 'phone'
      ? formatPhoneInput(value)
      : field === 'address'
        ? formatAddressInput(value)
        : value;
    setUserDrafts((current) => ({
      ...current,
      [userId]: {
        ...(current[userId] || createUserDraft({})),
        [field]: nextValue,
      },
    }));
  }

  function upsertManagedUser(nextUser) {
    if (!nextUser?.id) return;
    let inserted = false;
    setManagedUsers((current) => {
      const existingIndex = current.findIndex((item) => item.id === nextUser.id);
      inserted = existingIndex === -1;
      if (existingIndex === -1) return [nextUser, ...current];
      return current.map((item) => (item.id === nextUser.id ? nextUser : item));
    });
    setUserDrafts((current) => ({
      ...current,
      [nextUser.id]: createUserDraft(nextUser),
    }));
    setUserSectionsOpen((current) => ({ ...current, [nextUser.id]: inserted ? false : Boolean(current[nextUser.id]) }));
  }

  async function sendInvite() {
    const email = String(inviteDraft.email || '').trim().toLowerCase();
    const role = normalizeUserRole(inviteDraft.role);
    const inviteOrganizationId = !canManagePermissions ? String(actorOrganizationIds[0] || '').trim() : '';
    const inviteProgramIds = !canManagePermissions ? actorProgramIds : [];
    const inviteCampusIds = !canManagePermissions ? actorCampusIds : [];
    const inviteMemberships = !canManagePermissions
      ? (actorTenantProfile.memberships || []).map((membership) => ({
          organizationId: String(membership?.organizationId || '').trim(),
          programId: String(membership?.programId || '').trim(),
          campusId: String(membership?.campusId || '').trim(),
          role,
          programType: String(membership?.programType || '').trim(),
        })).filter((membership) => membership.organizationId)
      : [];
    if (!isValidEmail(email)) {
      Alert.alert('Valid email required', 'Enter a valid staff email before sending the invite.');
      return;
    }
    if (!role) {
      Alert.alert('Role required', 'Choose a role before sending the invite.');
      return;
    }
    if (!canManagePermissions && !inviteOrganizationId) {
      Alert.alert('Organization scope required', 'Your account needs an organization scope before you can invite managed users.');
      return;
    }

    try {
      setInviteBusy(true);
      setUsersError('');
      const payload = { email, role };
      if (!canManagePermissions) {
        payload.organizationId = inviteOrganizationId;
        if (inviteProgramIds.length) payload.programIds = inviteProgramIds;
        if (inviteCampusIds.length) payload.campusIds = inviteCampusIds;
        if (inviteMemberships.length) payload.memberships = inviteMemberships;
      }
      const result = await Api.sendManagedUserInvite(payload);
      if (result?.user) upsertManagedUser(normalizeManagedUsers([result.user])[0] || result.user);
      setInviteDraft((current) => ({ ...current, email: '' }));
      showToast({ title: 'Invite sent', message: `A one-time access code was emailed to ${email}.`, tone: 'success' });
    } catch (error) {
      setUsersError(String(error?.message || 'Could not send invite.'));
    } finally {
      setInviteBusy(false);
    }
  }

  async function resendInvite(userItem) {
    try {
      setSavingUserId(userItem.id);
      setUsersError('');
      const result = await Api.resendManagedUserInvite(userItem.id);
      if (result?.user) upsertManagedUser(normalizeManagedUsers([result.user])[0] || result.user);
      showToast({ title: 'Invite sent', message: `A new one-time access code was emailed to ${userItem.email || 'this user'}.`, tone: 'success' });
    } catch (error) {
      setUsersError(String(error?.message || 'Could not resend invite.'));
    } finally {
      setSavingUserId('');
    }
  }

  function renderInviteStatus(userItem) {
    const invite = userItem?.invite;
    if (!isPendingInvite(invite)) return null;
    const statusLabel = invite.status === 'started'
        ? 'Password setup in progress'
        : invite.lastEmailStatus === 'failed'
          ? 'Invite email failed'
          : 'Pending invite';
    return (
      <View style={styles.inviteCard}>
        <Text style={styles.inviteTitle}>{statusLabel}</Text>
        <Text style={styles.inviteMeta}>{invite.sentAt ? `Last sent ${new Date(invite.sentAt).toLocaleString()}` : 'No send timestamp available.'}</Text>
        {invite.expiresAt ? <Text style={styles.inviteMeta}>{`Access code expires ${new Date(invite.expiresAt).toLocaleString()}`}</Text> : null}
        {invite.lastEmailError ? <Text style={styles.inviteError}>{invite.lastEmailError}</Text> : null}
        <TouchableOpacity style={[styles.secondaryActionButton, savingUserId === userItem.id ? styles.disabledButton : null]} onPress={() => resendInvite(userItem)} disabled={savingUserId === userItem.id}>
          <Text style={styles.secondaryActionButtonText}>{savingUserId === userItem.id ? 'Sending...' : 'Resend Invite'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function ensureProgramsLoaded(organizationId) {
    const orgId = String(organizationId || '').trim();
    if (!orgId || programsByOrg[orgId]) return;
    try {
      const items = await listProgramsByOrganization(orgId);
      const nextItems = (Array.isArray(items) ? items : []).filter((item) => {
        if (canManagePermissions) return true;
        if (actorProgramIds.length) return actorProgramIds.includes(String(item?.id || '').trim());
        return actorOrganizationIds.includes(orgId);
      });
      setProgramsByOrg((current) => ({ ...current, [orgId]: nextItems }));
    } catch (_) {
      setProgramsByOrg((current) => ({ ...current, [orgId]: [] }));
      setUsersError((current) => current || 'Could not load programs for the selected organization.');
    }
  }

  async function ensureCampusesLoaded(organizationId) {
    const orgId = String(organizationId || '').trim();
    if (!orgId || campusesByOrg[orgId]) return;
    try {
      const items = await listCampusesByOrganization(orgId, '');
      const nextItems = (Array.isArray(items) ? items : []).filter((item) => {
        if (canManagePermissions) return true;
        if (actorCampusIds.length) return actorCampusIds.includes(String(item?.id || '').trim());
        return actorOrganizationIds.includes(orgId);
      });
      setCampusesByOrg((current) => ({ ...current, [orgId]: nextItems }));
    } catch (_) {
      setCampusesByOrg((current) => ({ ...current, [orgId]: [] }));
      setUsersError((current) => current || 'Could not load campuses for the selected organization.');
    }
  }

  function setUserOrganization(userId, organizationId) {
    const nextOrganizationId = String(organizationId || '').trim();
    updateUserDraft(userId, 'organizationId', nextOrganizationId);
    updateUserDraft(userId, 'programIds', []);
    updateUserDraft(userId, 'campusIds', []);
    if (nextOrganizationId) {
      ensureProgramsLoaded(nextOrganizationId);
      ensureCampusesLoaded(nextOrganizationId);
    }
  }

  function toggleDraftSelection(userId, field, value) {
    const normalized = String(value || '').trim();
    const current = Array.isArray(userDrafts[userId]?.[field]) ? userDrafts[userId][field] : [];
    const next = current.includes(normalized)
      ? current.filter((item) => item !== normalized)
      : [...current, normalized];
    updateUserDraft(userId, field, next);
    if (field === 'programIds') {
      const availableCampuses = campusesByOrg[String(userDrafts[userId]?.organizationId || '').trim()] || [];
      const allowedCampusIds = new Set((availableCampuses || [])
        .filter((campus) => !next.length || next.includes(String(campus.programId || '')))
        .map((campus) => String(campus.id || '')));
      const currentCampusIds = Array.isArray(userDrafts[userId]?.campusIds) ? userDrafts[userId].campusIds : [];
      updateUserDraft(userId, 'campusIds', currentCampusIds.filter((campusId) => allowedCampusIds.has(String(campusId))));
    }
  }

  function buildMembershipsForDraft(draft) {
    const role = normalizeUserRole(draft.role);
    const organizationId = String(draft.organizationId || '').trim();
    if (!organizationId) return [];

    const campusIds = Array.isArray(draft.campusIds) ? draft.campusIds.map(String) : [];
    const programIds = Array.isArray(draft.programIds) ? draft.programIds.map(String) : [];
    if (campusIds.length) {
      return campusIds.map((campusId) => {
        const campus = campusLookup.get(String(campusId));
        return {
          organizationId,
          programId: String(campus?.programId || ''),
          campusId: String(campusId),
          role,
        };
      });
    }
    if (programIds.length) {
      return programIds.map((programId) => ({
        organizationId,
        programId: String(programId),
        campusId: '',
        role,
      }));
    }
    return [{ organizationId, programId: '', campusId: '', role }];
  }

  async function saveUser(userItem) {
    const draft = userDrafts[userItem.id] || createUserDraft(userItem);
    const trimmedName = String(draft.name || '').trim();
    const trimmedEmail = String(draft.email || '').trim().toLowerCase();
    const trimmedPhone = String(draft.phone || '').trim();
    const trimmedAddress = String(draft.address || '').trim();
    const trimmedPassword = String(draft.password || '').trim();
    if (!trimmedName) {
      Alert.alert('Name required', 'Enter a full name before saving.');
      return;
    }
    if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
      Alert.alert('Valid email required', 'Enter a valid email address before saving.');
      return;
    }
    if (trimmedPhone && trimmedPhone.replace(/\D/g, '').length !== 10) {
      Alert.alert('Valid phone required', 'Phone numbers must contain 10 digits.');
      return;
    }
    const passwordError = getPasswordPolicyError(trimmedPassword);
    if (passwordError) {
      Alert.alert('Invalid password', passwordError);
      return;
    }
    const payload = {};
    if (trimmedName !== String(userItem.name || '').trim()) payload.name = trimmedName;
    if (trimmedEmail !== String(userItem.email || '').trim().toLowerCase()) payload.email = trimmedEmail;
    if (trimmedPhone !== String(userItem.phone || '').trim()) payload.phone = trimmedPhone;
    if (trimmedAddress !== String(userItem.address || '').trim()) payload.address = trimmedAddress;
    if (normalizeUserRole(draft.role) !== normalizeUserRole(userItem.role)) payload.role = normalizeUserRole(draft.role);
    const nextOrganizationId = String(draft.organizationId || '').trim();
    const nextProgramIds = Array.isArray(draft.programIds) ? draft.programIds.map(String) : [];
    const nextCampusIdsRaw = Array.isArray(draft.campusIds) ? draft.campusIds.map(String) : [];
    const nextCampusIds = nextProgramIds.length
      ? nextCampusIdsRaw.filter((campusId) => nextProgramIds.includes(String(campusLookup.get(String(campusId))?.programId || '')))
      : nextCampusIdsRaw;
    const currentOrganizationId = String(userItem.organizationId || '').trim();
    const currentProgramIds = Array.isArray(userItem.programIds) ? userItem.programIds.map(String) : [];
    const currentCampusIds = Array.isArray(userItem.campusIds) ? userItem.campusIds.map(String) : [];
    if (nextOrganizationId !== currentOrganizationId) payload.organizationId = nextOrganizationId;
    if (JSON.stringify(nextProgramIds) !== JSON.stringify(currentProgramIds)) payload.programIds = nextProgramIds;
    if (JSON.stringify(nextCampusIds) !== JSON.stringify(currentCampusIds)) payload.campusIds = nextCampusIds;
    const memberships = buildMembershipsForDraft(draft);
    if (JSON.stringify(memberships) !== JSON.stringify(Array.isArray(userItem.memberships) ? userItem.memberships : [])) payload.memberships = memberships;
    if (trimmedPassword) payload.password = trimmedPassword;

    const normalizedRole = normalizeUserRole(draft.role);
    if ((normalizedRole === 'orgAdmin' || normalizedRole === 'campusAdmin') && !nextOrganizationId) {
      Alert.alert('Organization required', 'Org admins and campus admins must be assigned to an organization.');
      return;
    }
    if (normalizedRole === 'campusAdmin' && !nextCampusIds.length) {
      Alert.alert('Campus required', 'Campus admins must be assigned to at least one campus.');
      return;
    }

    if (!Object.keys(payload).length) {
      Alert.alert('No changes', 'Update one or more fields before saving.');
      return;
    }

    try {
      setSavingUserId(userItem.id);
      setUsersError('');
      const res = await Api.updateManagedUser(userItem.id, payload);
      const nextUser = normalizeManagedUsers([res?.user])[0] || userItem;
      setManagedUsers((current) => current.map((item) => (item.id === userItem.id ? nextUser : item)));
      setUserDrafts((current) => ({
        ...current,
        [userItem.id]: createUserDraft(nextUser),
      }));
    } catch (e) {
      setUsersError(String(e?.message || 'Could not update user.'));
    } finally {
      setSavingUserId('');
    }
  }

  function confirmDeleteUser(userItem) {
    Alert.alert(
      'Delete user',
      `Delete ${userItem.name || userItem.email || 'this user'}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingUserId(userItem.id);
              setUsersError('');
              await Api.deleteManagedUser(userItem.id);
              setManagedUsers((current) => current.filter((item) => item.id !== userItem.id));
              setUserDrafts((current) => {
                const next = { ...current };
                delete next[userItem.id];
                return next;
              });
            } catch (e) {
              setUsersError(String(e?.message || 'Could not delete user.'));
            } finally {
              setDeletingUserId('');
            }
          },
        },
      ]
    );
  }

  function renderRole(role){
    const caps = mapping[role] || {};
    const open = !!roleSectionsOpen[role];
    return (
      <View style={styles.roleCard}>
        <TouchableOpacity
          style={styles.sectionHeader}
          activeOpacity={0.85}
          onPress={() => setRoleSectionsOpen((current) => ({ ...current, [role]: !current[role] }))}
        >
          <Text style={styles.roleTitle}>{getDisplayRoleLabel(role)}</Text>
          <MaterialIcons name={open ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={22} color={open ? '#2563eb' : '#6b7280'} />
        </TouchableOpacity>
        {open ? DEFAULT_CAPS.map((c) => (
          <View key={c.id} style={styles.capRow}>
            <Text style={styles.capLabel}>{c.label}</Text>
            <ImageToggle value={!!caps[c.id]} onValueChange={(v) => toggle(role, c.id, v)} accessibilityLabel={`${getDisplayRoleLabel(role)} ${c.label}`} disabled={!canManagePermissions || permissionsSaving} />
          </View>
        )) : null}
      </View>
    );
  }

  function renderUserCard(userItem) {
    const draft = userDrafts[userItem.id] || createUserDraft(userItem);
    const open = !!userSectionsOpen[userItem.id];
    const busy = savingUserId === userItem.id || deletingUserId === userItem.id;
    const scopedRole = normalizeUserRole(draft.role);
    const availablePrograms = programsByOrg[String(draft.organizationId || '').trim()] || [];
    const availableCampuses = (campusesByOrg[String(draft.organizationId || '').trim()] || []).filter((campus) => {
      if (!draft.programIds?.length) return true;
      return draft.programIds.includes(String(campus.programId || ''));
    });
    return (
      <View key={userItem.id} style={styles.userCard}>
        <TouchableOpacity
          style={styles.sectionHeader}
          activeOpacity={0.85}
          onPress={() => setUserSectionsOpen((current) => ({ ...current, [userItem.id]: !current[userItem.id] }))}
        >
          <View style={styles.userHeaderTextWrap}>
            <Text style={styles.userName}>{userItem.name || 'Unnamed user'}</Text>
            <Text style={styles.userMeta}>{userItem.email || 'No email'} • {getDisplayRoleLabel(draft.role || 'parent')}</Text>
          </View>
          <MaterialIcons name={open ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={22} color={open ? '#2563eb' : '#6b7280'} />
        </TouchableOpacity>
        {open ? (
          <View style={styles.userBody}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput value={draft.name} onChangeText={(value) => updateUserDraft(userItem.id, 'name', String(value || '').slice(0, 120))} style={styles.input} placeholder="Full name" maxLength={120} />

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput value={draft.email} onChangeText={(value) => updateUserDraft(userItem.id, 'email', String(value || '').slice(0, 254))} style={styles.input} placeholder="Email" autoCapitalize="none" keyboardType="email-address" maxLength={254} />

            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput value={draft.phone} onChangeText={(value) => updateUserDraft(userItem.id, 'phone', value)} style={styles.input} placeholder="555-123-4567" autoCapitalize="none" keyboardType="phone-pad" maxLength={12} />

            <Text style={styles.fieldLabel}>Address</Text>
            <AddressAutocompleteField value={draft.address} onChangeText={(value) => updateUserDraft(userItem.id, 'address', String(value || '').slice(0, 300))} placeholder="Address" maxLength={300} />

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.roleChipWrap}>
              {visibleRoleOptions.map((option) => {
                const selected = normalizeUserRole(draft.role) === option.value;
                return (
                  <TouchableOpacity
                    key={`${userItem.id}-${option.value}`}
                    onPress={() => updateUserDraft(userItem.id, 'role', option.value)}
                    style={[styles.roleChip, selected ? styles.roleChipSelected : null]}
                    disabled={busy}
                  >
                    <Text style={[styles.roleChipLabel, selected ? styles.roleChipLabelSelected : null]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Organization scope</Text>
            <View style={styles.roleChipWrap}>
              {canManagePermissions || !actorOrganizationIds.length ? (
                <TouchableOpacity
                  onPress={() => setUserOrganization(userItem.id, '')}
                  style={[styles.roleChip, !draft.organizationId ? styles.roleChipSelected : null]}
                  disabled={busy}
                >
                  <Text style={[styles.roleChipLabel, !draft.organizationId ? styles.roleChipLabelSelected : null]}>No org scope</Text>
                </TouchableOpacity>
              ) : null}
              {organizations.map((organization) => {
                const selected = String(draft.organizationId || '') === String(organization.id || '');
                return (
                  <TouchableOpacity
                    key={`${userItem.id}-org-${organization.id}`}
                    onPress={() => setUserOrganization(userItem.id, organization.id)}
                    style={[styles.roleChip, selected ? styles.roleChipSelected : null]}
                    disabled={busy}
                  >
                    <Text style={[styles.roleChipLabel, selected ? styles.roleChipLabelSelected : null]}>{organization.name || organization.id}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {draft.organizationId ? (
              <>
                <Text style={styles.fieldLabel}>Program access</Text>
                <View style={styles.roleChipWrap}>
                  {availablePrograms.length ? availablePrograms.map((program) => {
                    const selected = draft.programIds.includes(String(program.id || ''));
                    return (
                      <TouchableOpacity
                        key={`${userItem.id}-program-${program.id}`}
                        onPress={() => toggleDraftSelection(userItem.id, 'programIds', program.id)}
                        style={[styles.roleChip, selected ? styles.roleChipSelected : null]}
                        disabled={busy}
                      >
                        <Text style={[styles.roleChipLabel, selected ? styles.roleChipLabelSelected : null]}>{program.name || program.id}</Text>
                      </TouchableOpacity>
                    );
                  }) : <Text style={styles.helperText}>No programs found for this organization.</Text>}
                </View>

                <Text style={styles.fieldLabel}>Campus access</Text>
                <View style={styles.roleChipWrap}>
                  {availableCampuses.length ? availableCampuses.map((campus) => {
                    const selected = draft.campusIds.includes(String(campus.id || ''));
                    return (
                      <TouchableOpacity
                        key={`${userItem.id}-campus-${campus.id}`}
                        onPress={() => toggleDraftSelection(userItem.id, 'campusIds', campus.id)}
                        style={[styles.roleChip, selected ? styles.roleChipSelected : null]}
                        disabled={busy}
                      >
                        <Text style={[styles.roleChipLabel, selected ? styles.roleChipLabelSelected : null]}>{campus.name || campus.id}</Text>
                      </TouchableOpacity>
                    );
                  }) : <Text style={styles.helperText}>No campuses found for the selected scope.</Text>}
                </View>
              </>
            ) : null}

            {(scopedRole === 'orgAdmin' || scopedRole === 'campusAdmin') ? (
              <Text style={styles.helperText}>
                {scopedRole === 'orgAdmin'
                  ? 'Org admins should have one organization selected. Program and campus chips can narrow that access further.'
                  : 'Campus admins must have an organization and at least one campus selected.'}
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>Reset password</Text>
            <TextInput value={draft.password} onChangeText={(value) => updateUserDraft(userItem.id, 'password', String(value || '').slice(0, 128))} style={styles.input} placeholder="Leave blank to keep current password" secureTextEntry maxLength={128} />
            <Text style={styles.helperText}>Use this only for office-managed account recovery. End users should still use the standard reset-password flow from login.</Text>

            {renderInviteStatus(userItem)}

            <View style={styles.userActionRow}>
              <TouchableOpacity style={[styles.actionButton, styles.saveButton]} onPress={() => saveUser(userItem)} disabled={busy}>
                <Text style={styles.actionButtonText}>{savingUserId === userItem.id ? 'Saving...' : 'Save changes'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, styles.deleteButton]} onPress={() => confirmDeleteUser(userItem)} disabled={busy}>
                <Text style={styles.actionButtonText}>{deletingUserId === userItem.id ? 'Deleting...' : 'Delete user'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <ScreenWrapper style={styles.container}>
      {!canManagePermissions && !canManageUsers ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>Access required</Text>
          <Text style={styles.noticeBody}>You need permission to manage users or edit permission mapping.</Text>
        </View>
      ) : null}
      {permissionsError ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>Permissions unavailable</Text>
          <Text style={styles.noticeBody}>{permissionsError}</Text>
        </View>
      ) : null}
      {usersError ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>User management unavailable</Text>
          <Text style={styles.noticeBody}>{usersError}</Text>
        </View>
      ) : null}
      {(permissionsLoading || permissionsSaving || usersLoading) ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color="#2563eb" />
          <Text style={styles.statusText}>
            {permissionsLoading ? 'Loading access controls...' : permissionsSaving ? 'Saving permissions...' : 'Loading users...'}
          </Text>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.panel}>
          <TouchableOpacity
            style={styles.sectionHeader}
            activeOpacity={0.85}
            onPress={() => setSectionsOpen((current) => ({ ...current, users: !current.users }))}
          >
            <View>
              <Text style={styles.sectionTitle}>User management</Text>
              <Text style={styles.sectionHint}>Edit user details, roles, and account access.</Text>
            </View>
            <MaterialIcons name={sectionsOpen.users ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={24} color={sectionsOpen.users ? '#2563eb' : '#6b7280'} />
          </TouchableOpacity>
          {sectionsOpen.users ? (
            canManageUsers ? (
              <View style={styles.sectionBody}>
                <View style={styles.infoCard}>
                  <Text style={styles.infoTitle}>Role assignment rules</Text>
                  <Text style={styles.infoBody}>Admins can assign Parent, ABA Tech, BCBA, Office, and Admin roles. Legacy campus-admin users are treated as Office and legacy org-admin users are treated as Admin.</Text>
                </View>
                <View style={styles.inviteComposer}>
                  <Text style={styles.inviteComposerTitle}>Staff invite</Text>
                  <Text style={styles.helperText}>Enter a staff email, choose the role, and send a one-time access code. Invited users will be forced to create a password after the first login.</Text>
                  <Text style={styles.fieldLabel}>Staff email</Text>
                  <TextInput value={inviteDraft.email} onChangeText={(value) => setInviteDraft((current) => ({ ...current, email: String(value || '').slice(0, 254) }))} style={styles.input} placeholder="staff@example.com" autoCapitalize="none" keyboardType="email-address" maxLength={254} />
                  <Text style={styles.fieldLabel}>Role</Text>
                  <View style={styles.dropdownWrap}>
                    <AppDropdown
                      buttonStyle={styles.dropdownButton}
                      disabled={inviteBusy}
                      onSelect={(optionValue) => setInviteDraft((current) => ({ ...current, role: optionValue }))}
                      options={visibleInviteRoleOptions.map((option) => ({ value: option.value, label: option.label }))}
                      placeholder="Choose a role"
                      selectedValue={normalizeUserRole(inviteDraft.role)}
                      textStyle={styles.dropdownButtonText}
                      value={selectedInviteRole?.label || 'Choose a role'}
                    />
                  </View>
                  <TouchableOpacity style={[styles.primaryInviteButton, inviteBusy ? styles.disabledButton : null]} onPress={sendInvite} disabled={inviteBusy}>
                    <Text style={styles.primaryInviteButtonText}>{inviteBusy ? 'Sending...' : 'Send Invite'}</Text>
                  </TouchableOpacity>
                </View>
                {managedUsers.length ? managedUsers.map((item) => renderUserCard(item)) : (
                  <Text style={styles.emptyState}>No users available to manage.</Text>
                )}
              </View>
            ) : (
              <View style={styles.sectionBody}>
                <Text style={styles.emptyState}>Your account cannot manage users.</Text>
              </View>
            )
          ) : null}
        </View>

        <View style={styles.panel}>
          <TouchableOpacity
            style={styles.sectionHeader}
            activeOpacity={0.85}
            onPress={() => setSectionsOpen((current) => ({ ...current, permissions: !current.permissions }))}
          >
            <View>
              <Text style={styles.sectionTitle}>Permission mapping</Text>
              <Text style={styles.sectionHint}>Control which capabilities each role receives.</Text>
            </View>
            <MaterialIcons name={sectionsOpen.permissions ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={24} color={sectionsOpen.permissions ? '#2563eb' : '#6b7280'} />
          </TouchableOpacity>
          {sectionsOpen.permissions ? (
            canManagePermissions ? (
              <View style={styles.sectionBody}>
                <View style={styles.infoCard}>
                  <Text style={styles.infoTitle}>adminPermissions</Text>
                  <Text style={styles.infoBody}>The permission matrix is grouped by office, clinical, and family access so the document’s split admin model maps to existing roles without duplicating accounts.</Text>
                </View>
                <View style={styles.groupChipWrap}>
                  {PERMISSION_GROUPS.map((group) => {
                    const selected = group.key === visiblePermissionGroup.key;
                    return (
                      <TouchableOpacity
                        key={group.key}
                        onPress={() => setSelectedPermissionGroup(group.key)}
                        style={[styles.groupChip, selected ? styles.groupChipSelected : null]}
                      >
                        <Text style={[styles.groupChipLabel, selected ? styles.groupChipLabelSelected : null]}>{group.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.groupDescription}>{visiblePermissionGroup.description}</Text>
                {visiblePermissionRoles.map((role) => renderRole(role))}
              </View>
            ) : (
              <View style={styles.sectionBody}>
                <Text style={styles.emptyState}>Only super admins can change permission mapping.</Text>
              </View>
            )
          ) : null}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  toastHost: { position: 'absolute', top: 12, left: 12, right: 12, zIndex: 1000, alignItems: 'center' },
  toastCard: { width: '100%', maxWidth: 520, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  toastSuccess: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  toastInfo: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  toastError: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  toastIcon: { marginTop: 1, marginRight: 10 },
  toastCopy: { flex: 1 },
  toastTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  toastMessage: { marginTop: 2, fontSize: 13, lineHeight: 18, color: '#334155' },
  toastDismiss: { marginLeft: 10, padding: 2 },
  content: { padding: 12, paddingBottom: 28 },
  panel: { marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  sectionHeader: { paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  sectionHint: { marginTop: 2, color: '#6b7280' },
  sectionBody: { paddingHorizontal: 12, paddingBottom: 12 },
  noticeCard: { margin: 12, padding: 14, borderRadius: 10, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  noticeTitle: { fontWeight: '800', color: '#991b1b', marginBottom: 4 },
  noticeBody: { color: '#7f1d1d', lineHeight: 20 },
  statusRow: { marginHorizontal: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  statusText: { marginLeft: 8, color: '#1d4ed8', fontWeight: '600' },
  infoCard: { marginBottom: 12, padding: 12, borderRadius: 10, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe' },
  inviteComposer: { marginBottom: 12, padding: 12, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  inviteComposerTitle: { color: '#0f172a', fontWeight: '800', marginBottom: 4 },
  infoTitle: { color: '#1d4ed8', fontWeight: '800', marginBottom: 4 },
  infoBody: { color: '#1e3a8a', lineHeight: 20 },
  roleCard: { padding: 12, borderRadius: 8, backgroundColor: '#fff', marginBottom: 12, borderWidth: 1, borderColor: '#f3f4f6' },
  roleTitle: { fontWeight: '700', color: '#111827' },
  capRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  capLabel: { color: '#111827' },
  userCard: { marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, backgroundColor: '#f8fafc' },
  userHeaderTextWrap: { flex: 1, paddingRight: 12 },
  userName: { fontWeight: '800', color: '#0f172a' },
  userMeta: { marginTop: 2, color: '#6b7280' },
  userBody: { paddingHorizontal: 12, paddingBottom: 12 },
  fieldLabel: { marginTop: 10, marginBottom: 6, fontWeight: '700', color: '#374151' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: '#fff', color: '#111827' },
  multilineInput: { minHeight: 72, textAlignVertical: 'top' },
  dropdownWrap: { zIndex: 2 },
  dropdownButton: {},
  dropdownButtonText: { color: '#111827', fontWeight: '600' },
  roleChipWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  roleChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', marginRight: 8, marginBottom: 8 },
  roleChipSelected: { backgroundColor: '#dbeafe', borderColor: '#2563eb' },
  roleChipLabel: { color: '#334155', fontWeight: '600' },
  roleChipLabelSelected: { color: '#1d4ed8' },
  groupChipWrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  groupChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#bfdbfe', backgroundColor: '#eff6ff', marginRight: 8, marginBottom: 8 },
  groupChipSelected: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  groupChipLabel: { color: '#1d4ed8', fontWeight: '700' },
  groupChipLabelSelected: { color: '#fff' },
  groupDescription: { color: '#475569', lineHeight: 20, marginBottom: 12 },
  helperText: { color: '#64748b', lineHeight: 20, marginBottom: 8 },
  inviteCard: { marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#eff6ff' },
  inviteTitle: { color: '#1d4ed8', fontWeight: '800' },
  inviteMeta: { marginTop: 4, color: '#1e3a8a', lineHeight: 18 },
  inviteError: { marginTop: 6, color: '#b91c1c', lineHeight: 18 },
  primaryInviteButton: { marginTop: 6, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: '#2563eb' },
  primaryInviteButtonText: { color: '#fff', fontWeight: '800' },
  secondaryActionButton: { marginTop: 10, alignSelf: 'flex-start', borderRadius: 10, borderWidth: 1, borderColor: '#93c5fd', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  secondaryActionButtonText: { color: '#1d4ed8', fontWeight: '700' },
  userActionRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  actionButton: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveButton: { backgroundColor: '#2563eb', marginRight: 8 },
  deleteButton: { backgroundColor: '#dc2626', marginLeft: 8 },
  actionButtonText: { color: '#fff', fontWeight: '700' },
  emptyState: { color: '#6b7280', lineHeight: 20 },
});