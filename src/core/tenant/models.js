export const USER_ROLES = Object.freeze({
  PARENT: 'parent',
  FACULTY: 'therapist',
  THERAPIST: 'therapist',
  BCBA: 'bcba',
  OFFICE: 'office',
  RECEPTION: 'office',
  CAMPUS_ADMIN: 'office',
  ORG_ADMIN: 'admin',
  SUPER_ADMIN: 'superAdmin',
  ADMIN: 'admin',
});

export const ADMIN_SECTION_KEYS = Object.freeze({
  DASHBOARD: 'dashboard',
  STUDENTS: 'students',
  STAFF: 'staff',
  SCHEDULING: 'scheduling',
  PROGRAMS_GOALS: 'programs_goals',
  DATA_REPORTS: 'data_reports',
  BILLING_AUTHORIZATIONS: 'billing_authorizations',
  COMPLIANCE: 'compliance',
  COMMUNICATION: 'communication',
  SETTINGS: 'settings',
});

const ADMIN_SECTION_ACCESS = Object.freeze({
  [ADMIN_SECTION_KEYS.DASHBOARD]: Object.freeze({ bcba: 'full', office: 'full', reception: 'full' }),
  [ADMIN_SECTION_KEYS.STUDENTS]: Object.freeze({ bcba: 'full_clinical', office: 'roster_only', reception: 'roster_only' }),
  [ADMIN_SECTION_KEYS.STAFF]: Object.freeze({ bcba: 'view_only', office: 'full', reception: 'view_only' }),
  [ADMIN_SECTION_KEYS.SCHEDULING]: Object.freeze({ bcba: 'clinical_scheduling', office: 'full', reception: 'front_desk' }),
  [ADMIN_SECTION_KEYS.PROGRAMS_GOALS]: Object.freeze({ bcba: 'full', office: 'none', reception: 'none' }),
  [ADMIN_SECTION_KEYS.DATA_REPORTS]: Object.freeze({ bcba: 'clinical_reports', office: 'operational_reports', reception: 'none' }),
  [ADMIN_SECTION_KEYS.BILLING_AUTHORIZATIONS]: Object.freeze({ bcba: 'view_only', office: 'full', reception: 'view_only' }),
  [ADMIN_SECTION_KEYS.COMPLIANCE]: Object.freeze({ bcba: 'view_only', office: 'full', reception: 'none' }),
  [ADMIN_SECTION_KEYS.COMMUNICATION]: Object.freeze({ bcba: 'full_clinical', office: 'admin_only', reception: 'none' }),
  [ADMIN_SECTION_KEYS.SETTINGS]: Object.freeze({ bcba: 'limited', office: 'full', reception: 'none' }),
});

export const PROGRAM_TYPES = Object.freeze({
  CORPORATE: 'corporate',
  CENTER_BASED_ABA: 'centerBasedAba',
  EARLY_INTERVENTION_ACADEMY: 'earlyInterventionAcademy',
});

export const CONTACT_RELATIONSHIP_TYPES = Object.freeze(['mother', 'father', 'guardian', 'caregiver', 'emergencyContact', 'pickupContact']);
export const STAFF_RELATIONSHIP_TYPES = Object.freeze(['teacher', 'therapist', 'bcba', 'office', 'reception', 'campusAdmin', 'frontDesk']);

export const CANONICAL_USER_ROLES = Object.freeze([
  USER_ROLES.PARENT,
  USER_ROLES.THERAPIST,
  USER_ROLES.BCBA,
  USER_ROLES.OFFICE,
  USER_ROLES.ADMIN,
  USER_ROLES.SUPER_ADMIN,
]);

function safeString(value) {
  try {
    if (value == null) return '';
    return String(value).trim();
  } catch (_) {
    return '';
  }
}

function safeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  const normalized = safeString(value).toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function isoTimestamp(value) {
  try {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  } catch (_) {
    // ignore malformed timestamp values
  }
  return null;
}

export function normalizeUserRole(role) {
  const value = safeString(role).toLowerCase();
  if (!value) return USER_ROLES.PARENT;
  if (value === 'parent') return USER_ROLES.PARENT;
  if (value === 'faculty') return USER_ROLES.THERAPIST;
  if (value === 'therapist' || value === 'abatech' || value === 'aba tech' || value === 'aba-tech' || value === 'aba_tech' || value === 'behavior technician') return USER_ROLES.THERAPIST;
  if (value === 'bcba') return USER_ROLES.BCBA;
  if (value === 'office' || value === 'officeadmin' || value === 'office admin' || value === 'office-admin' || value === 'office_admin' || value === 'office personnel' || value === 'officepersonnel') return USER_ROLES.OFFICE;
  if (value === 'reception' || value === 'receptionist' || value === 'frontdesk' || value === 'front desk' || value === 'front-desk' || value === 'front_desk') return USER_ROLES.OFFICE;
  if (value === 'admin') return USER_ROLES.ADMIN;
  if (value === 'administrator') return USER_ROLES.ADMIN;
  if (value === 'campusadmin' || value === 'campus_admin') return USER_ROLES.OFFICE;
  if (value === 'orgadmin' || value === 'org_admin' || value === 'organizationadmin') return USER_ROLES.ADMIN;
  if (value === 'superadmin' || value === 'super_admin') return USER_ROLES.SUPER_ADMIN;
  if (value === 'teacher' || value === 'staff') return USER_ROLES.THERAPIST;
  return safeString(role) || USER_ROLES.PARENT;
}

export function normalizeProgramType(programType) {
  const value = safeString(programType).toLowerCase();
  if (!value) return PROGRAM_TYPES.CENTER_BASED_ABA;
  if (value === 'center_based_aba' || value === 'centerbasedaba') return PROGRAM_TYPES.CENTER_BASED_ABA;
  if (value === 'early_intervention_academy' || value === 'earlyinterventionacademy') return PROGRAM_TYPES.EARLY_INTERVENTION_ACADEMY;
  if (value === 'corporate') return PROGRAM_TYPES.CORPORATE;
  return safeString(programType) || PROGRAM_TYPES.CENTER_BASED_ABA;
}

export function buildOrganizationModel(value) {
  const item = value && typeof value === 'object' ? value : {};
  return {
    id: safeString(item.id || item.slug),
    name: safeString(item.name),
    slug: safeString(item.slug || item.id),
    phone: safeString(item.phone),
    email: safeString(item.email),
    active: safeBoolean(item.active, true),
    createdAt: isoTimestamp(item.createdAt),
    updatedAt: isoTimestamp(item.updatedAt),
  };
}

export function buildProgramModel(value) {
  const item = value && typeof value === 'object' ? value : {};
  return {
    id: safeString(item.id || item.slug),
    organizationId: safeString(item.organizationId),
    name: safeString(item.name),
    slug: safeString(item.slug || item.id),
    type: normalizeProgramType(item.type),
    description: safeString(item.description),
    active: safeBoolean(item.active, true),
    createdAt: isoTimestamp(item.createdAt),
    updatedAt: isoTimestamp(item.updatedAt),
  };
}

export function buildCampusModel(value) {
  const item = value && typeof value === 'object' ? value : {};
  return {
    id: safeString(item.id || item.slug),
    organizationId: safeString(item.organizationId),
    programId: safeString(item.programId || item.branchId),
    name: safeString(item.name),
    slug: safeString(item.slug || item.id),
    phone: safeString(item.phone),
    email: safeString(item.email),
    address1: safeString(item.address1),
    address2: safeString(item.address2),
    city: safeString(item.city),
    state: safeString(item.state),
    zipCode: safeString(item.zipCode),
    enrollmentCode: safeString(item.enrollmentCode),
    campusType: safeString(item.campusType),
    active: safeBoolean(item.active, true),
    createdAt: isoTimestamp(item.createdAt),
    updatedAt: isoTimestamp(item.updatedAt),
  };
}

export function buildAppUserModel(value) {
  const item = value && typeof value === 'object' ? value : {};
  return {
    id: safeString(item.id || item.uid),
    firstName: safeString(item.firstName),
    lastName: safeString(item.lastName),
    email: safeString(item.email),
    role: normalizeUserRole(item.role),
    organizationId: safeString(item.organizationId),
    programIds: uniqueIds(item.programIds || item.branchIds),
    campusIds: uniqueIds(item.campusIds),
    linkedStudentIds: uniqueIds(item.linkedStudentIds),
    active: safeBoolean(item.active, true),
    createdAt: isoTimestamp(item.createdAt),
    updatedAt: isoTimestamp(item.updatedAt),
  };
}

export function buildStudentModel(value) {
  const item = value && typeof value === 'object' ? value : {};
  return {
    id: safeString(item.id),
    firstName: safeString(item.firstName),
    lastName: safeString(item.lastName),
    organizationId: safeString(item.organizationId),
    programId: safeString(item.programId || item.branchId),
    campusId: safeString(item.campusId),
    guardianIds: uniqueIds(item.guardianIds || item.parentIds),
    staffIds: uniqueIds(item.staffIds || item.assignedABA),
    active: safeBoolean(item.active, true),
    createdAt: isoTimestamp(item.createdAt),
    updatedAt: isoTimestamp(item.updatedAt),
  };
}

export function isAdminRole(role) {
  const value = normalizeUserRole(role);
  return value === USER_ROLES.ADMIN || value === USER_ROLES.SUPER_ADMIN;
}

export function isBcbaRole(role) {
  return normalizeUserRole(role) === USER_ROLES.BCBA;
}

export function isOfficeAdminRole(role) {
  const value = normalizeUserRole(role);
  return value === USER_ROLES.OFFICE || value === USER_ROLES.ADMIN;
}

export function isReceptionRole(role) {
  return false;
}

export function getAdminActorType(role) {
  if (isBcbaRole(role)) return 'bcba';
  if (isOfficeAdminRole(role)) return 'office';
  return 'none';
}

export function canAccessAdminWorkspace(role) {
  return getAdminActorType(role) !== 'none';
}

export function getAdminSectionAccess(role, sectionKey) {
  const actorType = getAdminActorType(role);
  if (actorType === 'none') return 'none';
  return ADMIN_SECTION_ACCESS[sectionKey]?.[actorType] || 'none';
}

export function canAccessAdminSection(role, sectionKey) {
  return getAdminSectionAccess(role, sectionKey) !== 'none';
}

export function hasFullAdminSectionAccess(role, sectionKey) {
  return getAdminSectionAccess(role, sectionKey) === 'full';
}

export function isSuperAdminRole(role) {
  return normalizeUserRole(role) === USER_ROLES.SUPER_ADMIN;
}

export function isScopedAdminRole(role) {
  const value = normalizeUserRole(role);
  return value === USER_ROLES.ADMIN || value === USER_ROLES.SUPER_ADMIN;
}

export function isStaffRole(role) {
  const value = normalizeUserRole(role);
  return value === USER_ROLES.THERAPIST || value === USER_ROLES.BCBA;
}

export function uniqueIds(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => safeString(value))
    .filter(Boolean)));
}

export function normalizeMemberships(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      if (!value || typeof value !== 'object') return null;
      const organizationId = safeString(value.organizationId);
      const programId = safeString(value.programId || value.branchId);
      const campusId = safeString(value.campusId);
      if (!organizationId) return null;
      return {
        organizationId,
        programId,
        campusId,
        role: normalizeUserRole(value.role),
        programType: normalizeProgramType(value.programType),
      };
    })
    .filter(Boolean);
}

export function buildTenantProfile(profile) {
  const memberships = normalizeMemberships(profile?.memberships);
  const fallbackMembership = profile?.organizationId ? [{
    organizationId: safeString(profile.organizationId),
    programId: safeString(profile.programId || profile?.branchId || profile?.tenant?.programId || profile?.tenant?.branchId),
    campusId: safeString(profile.campusId || profile?.tenant?.campusId),
    role: normalizeUserRole(profile?.role),
    programType: normalizeProgramType(profile?.programType || profile?.tenant?.programType),
  }] : [];
  const resolvedMemberships = memberships.length ? memberships : fallbackMembership;
  const programIds = uniqueIds([
    ...(Array.isArray(profile?.programIds) ? profile.programIds : []),
    ...(Array.isArray(profile?.branchIds) ? profile.branchIds : []),
    ...resolvedMemberships.map((membership) => membership.programId),
  ]);
  const campusIds = uniqueIds([
    ...(Array.isArray(profile?.campusIds) ? profile.campusIds : []),
    ...resolvedMemberships.map((membership) => membership.campusId),
  ]);
  const currentProgramType = normalizeProgramType(
    profile?.programType ||
    profile?.tenant?.programType ||
    resolvedMemberships[0]?.programType
  );
  return {
    organizationId: safeString(profile?.organizationId || profile?.tenant?.organizationId),
    programIds,
    campusIds,
    memberships: resolvedMemberships,
    role: normalizeUserRole(profile?.role),
    currentProgramId: safeString(profile?.programId || profile?.branchId || profile?.tenant?.programId || profile?.tenant?.branchId || programIds[0]),
    currentProgramType,
  };
}
