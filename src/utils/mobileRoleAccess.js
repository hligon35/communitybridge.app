import { USER_ROLES, isAdminRole, isBcbaRole, isOfficeAdminRole, isReceptionRole, normalizeUserRole } from '../core/tenant/models';

export const PHONE_ROUTE_ACCESS = Object.freeze({
  parent: Object.freeze([
    'CommunityMain',
    'ChatsList',
    'ChatThread',
    'NewThread',
    'MyChildMain',
    'ChildProgressInsights',
    'Reports',
    'ScheduleCalendar',
    'InsuranceBilling',
    'CareTeam',
    'SettingsMain',
    'Help',
  ]),
  therapist: Object.freeze([
    'CommunityMain',
    'ChatsList',
    'ChatThread',
    'NewThread',
    'ScheduleCalendar',
    'Reports',
    'SettingsMain',
    'Help',
  ]),
  bcba: Object.freeze([
    'ControlsMain',
    'ChatsList',
    'ChatThread',
    'NewThread',
    'FacultyDirectory',
    'StudentDirectory',
    'Reports',
    'ScheduleCalendar',
    'TherapistDocumentationDashboard',
    'OrganizationInsightsDashboard',
    'AdminAlerts',
    'SettingsMain',
    'Help',
  ]),
  office: Object.freeze([
    'ControlsMain',
    'ChatsList',
    'ChatThread',
    'NewThread',
    'FacultyDirectory',
    'ParentDirectory',
    'StudentDirectory',
    'Reports',
    'ScheduleCalendar',
    'StaffActivity',
    'AdminAlerts',
    'SettingsMain',
    'Help',
  ]),
  reception: Object.freeze([
    'ControlsMain',
    'ChatsList',
    'ChatThread',
    'NewThread',
    'FacultyDirectory',
    'ParentDirectory',
    'StudentDirectory',
    'ScheduleCalendar',
    'SettingsMain',
    'Help',
  ]),
  admin: Object.freeze([
    'ControlsMain',
    'ChatsList',
    'ChatThread',
    'NewThread',
    'FacultyDirectory',
    'ParentDirectory',
    'StudentDirectory',
    'Reports',
    'ScheduleCalendar',
    'StaffActivity',
    'AdminAlerts',
    'OrganizationInsightsDashboard',
    'SettingsMain',
    'Help',
  ]),
});

export function isPhoneViewport(width, height) {
  const shortEdge = Math.min(Number(width || 0), Number(height || 0));
  const longEdge = Math.max(Number(width || 0), Number(height || 0));
  return shortEdge < 600 && longEdge < 1100;
}

export function getPhoneAccessProfile(role) {
  const normalizedRole = normalizeUserRole(role);
  if (normalizedRole === USER_ROLES.PARENT) return 'parent';
  if (normalizedRole === USER_ROLES.THERAPIST) return 'therapist';
  if (isBcbaRole(normalizedRole)) return 'bcba';
  if (isReceptionRole(normalizedRole)) return 'reception';
  if (isOfficeAdminRole(normalizedRole) && !isAdminRole(normalizedRole)) return 'office';
  if (isAdminRole(normalizedRole)) return 'admin';
  return 'parent';
}

export function canAccessPhoneRoute(role, routeName) {
  const profile = getPhoneAccessProfile(role);
  const allowedRoutes = PHONE_ROUTE_ACCESS[profile] || [];
  return allowedRoutes.includes(String(routeName || '').trim());
}

export function isAggregateOnlyPhoneProfile(role) {
  const profile = getPhoneAccessProfile(role);
  return profile === 'office' || profile === 'admin' || profile === 'reception';
}

export function canUsePhoneCaseload(role) {
  const profile = getPhoneAccessProfile(role);
  return profile === 'therapist' || profile === 'bcba';
}

export function shouldUsePhoneSafeReports(role) {
  return getPhoneAccessProfile(role) !== 'parent';
}

export function shouldUsePhoneSafeSchedule(role) {
  return getPhoneAccessProfile(role) !== 'parent';
}

export function shouldHideTapToolsOnPhone(role) {
  return getPhoneAccessProfile(role) === 'therapist';
}

export function getPhoneFallbackCopy(role, routeName) {
  const profile = getPhoneAccessProfile(role);
  const route = String(routeName || '').trim();

  if (route === 'InsuranceBilling') {
    return {
      title: 'Billing is not available on this phone view',
      body: profile === 'parent'
        ? 'Use the family billing summary on mobile, or open the full billing workspace on tablet or desktop for more detail.'
        : 'Billing and insurance details stay on tablet or desktop only for this role.',
    };
  }

  if (route === 'StudentDirectory' || route === 'ParentDirectory' || route === 'ChildDetail' || route === 'ParentDetail' || route === 'FacultyDirectory' || route === 'FacultyDetail') {
    return {
      title: 'Detailed directories stay off this phone view',
      body: 'Use the aggregate dashboard, schedule, insights, or chats on phone. Open tablet or desktop for full directory details.',
    };
  }

  if (route === 'TapTracker' || route === 'TapLogs' || route === 'SummaryReview') {
    return {
      title: 'Session tools are tablet-only',
      body: 'This role can use session tracking and reporting tools from tablet only.',
    };
  }

  return {
    title: 'This screen is not part of the phone workspace',
    body: 'Use the approved phone modules for this role, or move to tablet or desktop for the full workspace.',
  };
}