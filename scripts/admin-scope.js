'use strict';

function safeString(value) {
  try {
    if (value == null) return '';
    return String(value).trim();
  } catch (_) {
    return '';
  }
}

function normalizeRole(role) {
  return safeString(role).toLowerCase();
}

function normalizeIds(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => safeString(value))
    .filter(Boolean)));
}

function normalizeMemberships(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      if (!value || typeof value !== 'object') return null;
      const organizationId = safeString(value.organizationId);
      if (!organizationId) return null;
      return {
        organizationId,
        programId: safeString(value.programId || value.branchId),
        campusId: safeString(value.campusId),
      };
    })
    .filter(Boolean);
}

function getScopedOrganizationIds(user) {
  return normalizeIds([user.organizationId, ...user.memberships.map((membership) => membership.organizationId)]);
}

function getScopedProgramIds(user) {
  return normalizeIds([...(Array.isArray(user.programIds) ? user.programIds : []), ...user.memberships.map((membership) => membership.programId)]);
}

function getScopedCampusIds(user) {
  return normalizeIds([...(Array.isArray(user.campusIds) ? user.campusIds : []), ...user.memberships.map((membership) => membership.campusId)]);
}

function hasIdOverlap(left, right) {
  const leftIds = normalizeIds(left);
  const rightIds = normalizeIds(right);
  if (!leftIds.length || !rightIds.length) return false;
  return leftIds.some((value) => rightIds.includes(value));
}

function isAdminRole(role) {
  const value = normalizeRole(role);
  return value === 'admin'
    || value === 'administrator'
    || value === 'campusadmin'
    || value === 'campus_admin'
    || value === 'orgadmin'
    || value === 'org_admin'
    || value === 'organizationadmin'
    || value === 'superadmin'
    || value === 'super_admin';
}

function isSuperAdminRole(role) {
  const value = normalizeRole(role);
  return value === 'superadmin' || value === 'super_admin';
}

function normalizeScopedUser(user) {
  const item = user && typeof user === 'object' ? user : {};
  const memberships = normalizeMemberships(item.memberships);
  return {
    ...item,
    role: normalizeRole(item.role),
    organizationId: safeString(item.organizationId),
    programIds: normalizeIds(item.programIds || item.branchIds),
    campusIds: normalizeIds(item.campusIds),
    memberships,
  };
}

function hasCampusOverlap(actor, target) {
  return hasIdOverlap(getScopedCampusIds(actor), getScopedCampusIds(target));
}

function hasProgramOverlap(actor, target) {
  return hasIdOverlap(getScopedProgramIds(actor), getScopedProgramIds(target));
}

function hasOrganizationOverlap(actor, target) {
  return hasIdOverlap(getScopedOrganizationIds(actor), getScopedOrganizationIds(target));
}

function canManageTargetUser(actorInput, targetInput) {
  const actor = normalizeScopedUser(actorInput);
  const target = normalizeScopedUser(targetInput);

  if (!isAdminRole(actor.role)) return false;
  if (isSuperAdminRole(actor.role)) return true;
  if (isAdminRole(target.role)) return false;

  if (!hasOrganizationOverlap(actor, target)) return false;

  if (actor.role === 'admin' || actor.role === 'administrator') {
    if (getScopedCampusIds(actor).length) return hasCampusOverlap(actor, target);
    if (getScopedProgramIds(actor).length) return hasProgramOverlap(actor, target);
    return getScopedOrganizationIds(actor).length > 0;
  }

  if (actor.role === 'orgadmin' || actor.role === 'org_admin' || actor.role === 'organizationadmin') {
    return getScopedOrganizationIds(actor).length > 0;
  }

  if (actor.role === 'campusadmin' || actor.role === 'campus_admin') {
    return hasCampusOverlap(actor, target);
  }

  return false;
}

function filterManageableUsers(actor, users) {
  return (Array.isArray(users) ? users : []).filter((user) => canManageTargetUser(actor, user));
}

module.exports = {
  normalizeScopedUser,
  canManageTargetUser,
  filterManageableUsers,
};
