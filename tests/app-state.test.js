const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRoleOverride,
  isDevSwitcherUser,
  isDemoReviewerUser,
  isSpecialAccessUser,
  getMfaFreshnessWindowMs,
  DEFAULT_MFA_WINDOW_MS,
  DEV_MFA_WINDOW_MS,
} = require('../src/utils/authState');
const { attachTherapistsToChildren, mergeById } = require('../src/utils/directoryState');
const { humanizeScreenLabel } = require('../src/utils/screenLabels');
const { getStorageScopeId, buildScopedStorageKeys, STORAGE_SCOPE_FALLBACK } = require('../src/utils/storageScope');
const { buildVisibleThreads, countUnreadVisibleThreads } = require('../src/utils/chatThreads');
const { getEffectiveChatIdentity } = require('../src/utils/demoIdentity');
const { canManageTargetUser, filterManageableUsers } = require('../scripts/admin-scope');

test('normalizeRoleOverride maps supported role aliases', () => {
  assert.equal(normalizeRoleOverride(' Administrator '), 'admin');
  assert.equal(normalizeRoleOverride('therapist'), 'therapist');
  assert.equal(normalizeRoleOverride('bcba'), 'bcba');
  assert.equal(normalizeRoleOverride('parent'), 'parent');
  assert.equal(normalizeRoleOverride('unknown'), '');
});

test('dev switcher user and MFA window honor the controlled dev account', () => {
  assert.equal(isDevSwitcherUser('dev@communitybridge.app'), true);
  assert.equal(isDevSwitcherUser('other@communitybridge.app'), false);
  assert.equal(isDemoReviewerUser('appreview@communitybridge.app'), true);
  assert.equal(isSpecialAccessUser('appreview@communitybridge.app'), true);
  assert.equal(isSpecialAccessUser('dev@communitybridge.app'), true);
  assert.equal(getMfaFreshnessWindowMs({ email: 'dev@communitybridge.app' }), DEV_MFA_WINDOW_MS);
  assert.equal(getMfaFreshnessWindowMs({ email: 'appreview@communitybridge.app' }), DEV_MFA_WINDOW_MS);
  assert.equal(getMfaFreshnessWindowMs({ email: 'other@communitybridge.app' }), DEFAULT_MFA_WINDOW_MS);
});

test('mergeById appends only new records', () => {
  const existing = [{ id: '1', name: 'one' }];
  const additions = [{ id: '1', name: 'duplicate' }, { id: '2', name: 'two' }];
  assert.deepEqual(mergeById(existing, additions), [
    { id: '1', name: 'one' },
    { id: '2', name: 'two' },
  ]);
});

test('attachTherapistsToChildren uses server-normalized assignments when present', () => {
  const children = [{ id: 'child-1' }];
  const therapists = [
    { id: 'aba-1', name: 'ABA One' },
    { id: 'bcba-1', name: 'BCBA One' },
  ];
  const aba = {
    assignments: [{ childId: 'child-1', session: 'AM', abaId: 'aba-1' }],
    supervision: [{ abaId: 'aba-1', bcbaId: 'bcba-1' }],
  };

  const [mapped] = attachTherapistsToChildren(children, therapists, aba);
  assert.equal(mapped.amTherapist.name, 'ABA One');
  assert.equal(mapped.pmTherapist, null);
  assert.equal(mapped.bcaTherapist.name, 'BCBA One');
});

test('attachTherapistsToChildren falls back to assignedABA when no normalized assignments exist', () => {
  const children = [{ id: 'child-2', session: 'PM', assignedABA: ['aba-2'] }];
  const therapists = [{ id: 'aba-2', name: 'ABA Two', supervisedBy: 'bcba-2' }, { id: 'bcba-2', name: 'BCBA Two' }];
  const [mapped] = attachTherapistsToChildren(children, therapists, null);
  assert.equal(mapped.amTherapist, null);
  assert.equal(mapped.pmTherapist.name, 'ABA Two');
  assert.equal(mapped.bcaTherapist.name, 'BCBA Two');
});

test('humanizeScreenLabel inserts spaces for route-like screen names', () => {
  assert.equal(humanizeScreenLabel('MyChildMain'), 'My Child Main');
  assert.equal(humanizeScreenLabel('CareTeam'), 'Care Team');
  assert.equal(humanizeScreenLabel('program_documents'), 'program documents');
});

test('getStorageScopeId scopes cache keys to a stable per-user id', () => {
  assert.equal(getStorageScopeId({ id: 'User-123' }), 'user-123');
  assert.equal(getStorageScopeId({ uid: 'Firebase UID' }), 'firebase_uid');
  assert.equal(getStorageScopeId({ email: 'Person+One@Example.com' }), 'person_one_example.com');
  assert.equal(getStorageScopeId(null), STORAGE_SCOPE_FALLBACK);
});

test('buildScopedStorageKeys creates distinct keys per user scope', () => {
  const alpha = buildScopedStorageKeys({ id: 'alpha' });
  const beta = buildScopedStorageKeys({ id: 'beta' });
  assert.equal(alpha.posts, 'bbs_posts_v1::alpha');
  assert.equal(alpha.messages, 'bbs_messages_v1::alpha');
  assert.notEqual(alpha.posts, beta.posts);
  assert.notEqual(alpha.blocked, beta.blocked);
});

test('org admin can only manage non-admin users in the same organization', () => {
  const actor = { role: 'orgAdmin', organizationId: 'org-1' };
  assert.equal(canManageTargetUser(actor, { role: 'parent', organizationId: 'org-1' }), true);
  assert.equal(canManageTargetUser(actor, { role: 'parent', organizationId: 'org-2' }), false);
  assert.equal(canManageTargetUser(actor, { role: 'admin', organizationId: 'org-1' }), false);
});

test('campus admin can only manage non-admin users with overlapping campus scope', () => {
  const actor = { role: 'campusAdmin', organizationId: 'org-1', campusIds: ['campus-a'] };
  assert.equal(canManageTargetUser(actor, { role: 'parent', organizationId: 'org-1', campusIds: ['campus-a'] }), true);
  assert.equal(canManageTargetUser(actor, { role: 'parent', organizationId: 'org-1', campusIds: ['campus-b'] }), false);
  assert.equal(canManageTargetUser(actor, { role: 'parent', organizationId: 'org-2', campusIds: ['campus-a'] }), false);
});

test('filterManageableUsers keeps global admins away from elevated targets but not regular users', () => {
  const actor = { role: 'admin' };
  const items = filterManageableUsers(actor, [
    { id: '1', role: 'parent' },
    { id: '2', role: 'orgAdmin', organizationId: 'org-1' },
    { id: '3', role: 'therapist' },
  ]);
  assert.deepEqual(items.map((item) => item.id), ['1', '3']);
});

test('visible chat threads and unread counts stay scoped to the active user', () => {
  const messages = [
    {
      id: 'thread-parent',
      threadId: 'thread-parent',
      createdAt: '2026-04-28T10:00:00.000Z',
      sender: { id: 'therapist-1', name: 'Therapist One' },
      to: [{ id: 'parent-1', name: 'Parent One' }],
    },
    {
      id: 'thread-admin',
      threadId: 'thread-admin',
      createdAt: '2026-04-28T11:00:00.000Z',
      sender: { id: 'therapist-2', name: 'Therapist Two' },
      to: [{ id: 'admin-1', name: 'Admin One' }],
    },
  ];

  const parentThreads = buildVisibleThreads(messages, {}, { id: 'parent-1', role: 'parent' }, []);
  assert.deepEqual(parentThreads.map((thread) => thread.id), ['thread-parent']);
  assert.equal(countUnreadVisibleThreads(messages, {}, { id: 'parent-1', role: 'parent' }, []), 1);
  assert.equal(countUnreadVisibleThreads(messages, {}, { id: 'parent-2', role: 'parent' }, []), 0);
  assert.equal(countUnreadVisibleThreads(messages, {}, { id: 'admin-1', role: 'admin' }, []), 2);
  assert.equal(countUnreadVisibleThreads(messages, {}, { id: 'admin-1', role: 'admin' }, ['thread-admin']), 1);
});

test('special-access users resolve to the active demo chat persona', () => {
  assert.deepEqual(
    getEffectiveChatIdentity({ id: 'firebase-user', email: 'appreview@communitybridge.app', role: 'admin' }),
    { id: 'admin-demo', name: 'Jordan Admin', email: 'admin-demo@communitybridge.app', role: 'admin' }
  );
  assert.deepEqual(
    getEffectiveChatIdentity({ id: 'firebase-user', email: 'dev@communitybridge.app', role: 'therapist' }),
    { id: 'ABA-001', name: 'Daniel Lopez', email: 'daniel.lopez@communitybridge.app', role: 'therapist' }
  );
  assert.deepEqual(
    getEffectiveChatIdentity({ id: 'firebase-user', email: 'dev@communitybridge.app', role: 'parent' }),
    { id: 'PT-001', name: 'Carlos Garcia', email: 'carlos.garcia@communitybridge.app', role: 'parent' }
  );
});

test('special-access chat visibility follows the active role persona instead of the shared login id', () => {
  const messages = [
    {
      id: 'admin-thread-1',
      threadId: 'admin-thread',
      createdAt: '2026-04-28T10:00:00.000Z',
      sender: { id: 'admin-demo', name: 'Jordan Admin' },
      to: [{ id: 'ABA-001', name: 'Daniel Lopez' }],
    },
    {
      id: 'parent-thread-1',
      threadId: 'parent-thread',
      createdAt: '2026-04-28T11:00:00.000Z',
      sender: { id: 'ABA-001', name: 'Daniel Lopez' },
      to: [{ id: 'PT-001', name: 'Carlos Garcia' }],
    },
  ];

  const sharedLogin = { id: 'firebase-user', email: 'appreview@communitybridge.app' };
  assert.deepEqual(
    buildVisibleThreads(messages, {}, { ...sharedLogin, role: 'admin' }, []).map((thread) => thread.id),
    ['parent-thread', 'admin-thread']
  );
  assert.deepEqual(
    buildVisibleThreads(messages, {}, { ...sharedLogin, role: 'therapist' }, []).map((thread) => thread.id),
    ['admin-thread', 'parent-thread']
  );
  assert.deepEqual(
    buildVisibleThreads(messages, {}, { ...sharedLogin, role: 'parent' }, []).map((thread) => thread.id),
    ['parent-thread']
  );
});

test('chat threads group messages from the same participant despite mixed identifiers', () => {
  const messages = [
    {
      id: 'admin-tech-thread-1',
      threadId: 'admin-tech-thread-1',
      createdAt: '2026-04-28T09:00:00.000Z',
      sender: { id: 'tech-1', name: 'Taylor Tech', email: 'taylor@communitybridge.app' },
      to: [{ id: 'admin-1', name: 'Admin One' }],
    },
    {
      id: 'admin-tech-thread-2',
      threadId: 'admin-tech-thread-2',
      createdAt: '2026-04-28T10:00:00.000Z',
      sender: { email: 'taylor@communitybridge.app', name: 'Taylor Tech' },
      to: [{ id: 'admin-1', name: 'Admin One' }],
    },
    {
      id: 'admin-parent-thread-1',
      threadId: 'admin-parent-thread-1',
      createdAt: '2026-04-28T11:00:00.000Z',
      sender: { id: 'parent-1', name: 'Parent One' },
      to: [{ id: 'admin-1', name: 'Admin One' }],
    },
  ];

  const adminThreads = buildVisibleThreads(messages, {}, { id: 'admin-1', role: 'admin' }, []);
  assert.equal(adminThreads.length, 2);
  assert.deepEqual(adminThreads.map((thread) => thread.id), ['user:parent-1', 'user:tech-1']);
  assert.deepEqual(adminThreads.find((thread) => thread.id === 'user:tech-1')?.threadIds.sort(), ['admin-tech-thread-1', 'admin-tech-thread-2']);
});