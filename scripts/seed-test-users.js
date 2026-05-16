#!/usr/bin/env node
/*
  Seed demo users for TestFlight / QA into BOTH:
    1) Firebase Auth (so mobile login via signInWithEmailAndPassword works)
    2) The Postgres `users` table (so the API has a profile + role for them)
    3) The Firestore + Postgres directory records (so /api/directory/me returns linked data)

  Hardcoded demo users:
    hligon35@gmail.com            / ParentDemo123!   role=parent
    cheyanne2448@gmail.com        / ParentDemo123!   role=parent
    appreview@communitybridge.app / Approved123!     role=parent
    aba@communitybridge.app       / AbaTech123!      role=therapist
    abatech1@communitybridge.app  / AbaTech123!      role=therapist
    abatech2@communitybridge.app  / AbaTech123!      role=therapist
    abatech3@communitybridge.app  / AbaTech123!      role=therapist
    abatech4@communitybridge.app  / AbaTech123!      role=therapist
    bcba@communitybridge.app      / BcbaDemo123!     role=bcba
    office@communitybridge.app    / OfficeDemo123!   role=office
    admin@communitybridge.app     / AdminDemo123!    role=admin

  Requirements:
    - GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON for the
      Firebase project, OR run `gcloud auth application-default login` first.
    - One of: CB_DATABASE_URL / BB_DATABASE_URL / DATABASE_URL pointing at the
      same Postgres the API uses.
    - npm deps already installed: firebase-admin, pg, bcryptjs.

  Behavior:
    - Idempotent. Re-running updates the existing Firebase user's password +
      emailVerified flag and refreshes the Postgres row.
    - Sets emailVerified=true and a custom claim { role } on the Firebase user.
    - Marks the Postgres row with mfa_verified_at = NOW() (when the column
      exists) so the in-app MFA gate is bypassed for the reviewer accounts.

  Usage:
    # PowerShell
    $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\path\\to\\service-account.json"
    $env:CB_DATABASE_URL = "postgres://..."
    node ./scripts/seed-test-users.js

    # bash
    GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json \
    CB_DATABASE_URL=postgres://... \
    node ./scripts/seed-test-users.js

    # Dry run (no writes)
    node ./scripts/seed-test-users.js --dry
*/

'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry') || process.argv.includes('-n');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key]) continue;
    process.env[key] = match[2];
  }
}

loadEnvFile(path.join(process.cwd(), '.env'));
loadEnvFile(path.join(process.cwd(), 'env', 'cloudrun.env'));

const TEST_USERS = [
  { name: 'Jason Bridgeport',             email: 'hligon35@gmail.com',          password: 'ParentDemo123!', role: 'parent' },
  { name: 'Chelsey Bridgeport',            email: 'cheyanne2448@gmail.com',      password: 'ParentDemo123!', role: 'parent' },
  { name: 'App Reviewer',                  email: 'appreview@communitybridge.app', password: 'Approved123!', role: 'parent' },
  { name: 'CommunityBridge ABA', email: 'aba@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CB ABA Tech 1', email: 'abatech1@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CB ABA Tech 2', email: 'abatech2@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CB ABA Tech 3', email: 'abatech3@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CB ABA Tech 4', email: 'abatech4@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CB BCBA',     email: 'bcba@communitybridge.app',    password: 'BcbaDemo123!',   role: 'bcba' },
  { name: 'CB Office',   email: 'office@communitybridge.app',  password: 'OfficeDemo123!', role: 'office' },
  { name: 'CB Admin',    email: 'admin@communitybridge.app',   password: 'AdminDemo123!',  role: 'admin' },
];

const SEEDED_CENTER_BASED_PROGRAM_ID = 'center-based-aba';

const DEMO_EMAIL_MAP = Object.freeze(Object.fromEntries(TEST_USERS.map((user) => [String(user.email || '').trim().toLowerCase(), user])));

function loadTenantSeedData() {
  const filePath = path.join(process.cwd(), 'src', 'seed', 'tenantDirectory.seed.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const organizations = Array.isArray(raw?.organizations) ? raw.organizations : [];
  const programs = Array.isArray(raw?.programs) ? raw.programs : [];
  const campuses = Array.isArray(raw?.campuses) ? raw.campuses : [];
  const organization = organizations[0] || null;
  const program = programs.find((item) => String(item?.id || '').trim() === SEEDED_CENTER_BASED_PROGRAM_ID) || null;
  const matchingCampuses = campuses.filter((item) => String(item?.programId || '').trim() === SEEDED_CENTER_BASED_PROGRAM_ID);
  const campus = matchingCampuses[0] || null;
  if (!organization || !program || !campus) {
    throw new Error(`Tenant seed must include organization data, the ${SEEDED_CENTER_BASED_PROGRAM_ID} program, and a matching campus.`);
  }
  if (matchingCampuses.length !== 1) {
    throw new Error(`Tenant seed must include exactly one ${SEEDED_CENTER_BASED_PROGRAM_ID} campus for test users. Found ${matchingCampuses.length}.`);
  }
  return { organizations, programs, campuses, organization, program, campus };
}

const TENANT_SEED = loadTenantSeedData();
const DEMO_FAMILY_ID = 'family-cook-demo';
const REVIEW_FAMILY_ID = 'family-app-reviewer';

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

function normalizeProgramType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'centerBasedAba';
  if (raw === 'center based aba' || raw === 'center-based aba' || raw === 'centerbasedaba') return 'centerBasedAba';
  return String(value || '').trim();
}

function buildMembership(role) {
  return [{
    organizationId: String(TENANT_SEED.organization.id || '').trim(),
    programId: String(TENANT_SEED.program.id || '').trim(),
    campusId: String(TENANT_SEED.campus.id || '').trim(),
    role: String(role || '').trim(),
    programType: normalizeProgramType(TENANT_SEED.program.type),
  }];
}

function buildUserProfilePayload(user, uid) {
  const { firstName, lastName } = splitName(user?.name);
  const role = String(user?.role || '').trim();
  const organizationId = String(TENANT_SEED.organization.id || '').trim();
  const programId = String(TENANT_SEED.program.id || '').trim();
  const campusId = String(TENANT_SEED.campus.id || '').trim();
  return {
    id: uid,
    uid,
    firstName,
    lastName,
    name: String(user?.name || '').trim(),
    email: String(user?.email || '').trim().toLowerCase(),
    role,
    active: true,
    organizationId,
    programIds: [programId],
    campusIds: [campusId],
    memberships: buildMembership(role),
    mfaVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function buildDirectoryEntitiesByEmail(uidByEmail) {
  const lookupUid = (email) => {
    const key = String(email || '').trim().toLowerCase();
    const uid = String(uidByEmail.get(key) || '').trim();
    if (!uid) throw new Error(`Missing seeded uid for ${email}`);
    return uid;
  };

  const organizationId = String(TENANT_SEED.organization.id || '').trim();
  const organizationName = String(TENANT_SEED.organization.name || '').trim();
  const programId = String(TENANT_SEED.program.id || '').trim();
  const programName = String(TENANT_SEED.program.name || '').trim();
  const campusId = String(TENANT_SEED.campus.id || '').trim();
  const campusName = String(TENANT_SEED.campus.name || '').trim();
  const enrollmentCode = String(TENANT_SEED.campus.enrollmentCode || '').trim();

  const parent1 = DEMO_EMAIL_MAP['hligon35@gmail.com'];
  const parent2 = DEMO_EMAIL_MAP['cheyanne2448@gmail.com'];
  const reviewParent = DEMO_EMAIL_MAP['appreview@communitybridge.app'];
  const aba = DEMO_EMAIL_MAP['aba@communitybridge.app'];
  const tech1 = DEMO_EMAIL_MAP['abatech1@communitybridge.app'];
  const tech2 = DEMO_EMAIL_MAP['abatech2@communitybridge.app'];
  const tech3 = DEMO_EMAIL_MAP['abatech3@communitybridge.app'];
  const tech4 = DEMO_EMAIL_MAP['abatech4@communitybridge.app'];
  const bcba = DEMO_EMAIL_MAP['bcba@communitybridge.app'];
  const office = DEMO_EMAIL_MAP['office@communitybridge.app'];
  const adminUser = DEMO_EMAIL_MAP['admin@communitybridge.app'];

  const parentRefs = [parent1, parent2].map((user) => ({
    id: lookupUid(user.email),
    userId: lookupUid(user.email),
    uid: lookupUid(user.email),
    name: user.name,
    email: user.email.toLowerCase(),
    phone: '',
  }));
  const reviewParentRefs = [reviewParent].map((user) => ({
    id: lookupUid(user.email),
    userId: lookupUid(user.email),
    uid: lookupUid(user.email),
    name: user.name,
    email: user.email.toLowerCase(),
    phone: '',
  }));

  const staffUsers = [aba, tech1, tech2, tech3, tech4, bcba, office, adminUser];
  const therapistDocs = staffUsers.map((user) => ({
    id: lookupUid(user.email),
    userId: lookupUid(user.email),
    uid: lookupUid(user.email),
    name: user.name,
    email: user.email.toLowerCase(),
    emailNormalized: user.email.toLowerCase(),
    role: user.role,
    title: user.role === 'bcba'
      ? 'Clinical Director'
      : user.role === 'office'
        ? 'Operations Director'
        : user.role === 'admin'
          ? 'Center Administrator'
          : 'ABA Therapist',
    organizationId,
    organizationName,
    programId,
    programName,
    campusId,
    campusName,
    programIds: [programId],
    campusIds: [campusId],
    supervisedBy: user.role === 'therapist' ? lookupUid(bcba.email) : '',
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }));

  const parentDocs = [
    { user: parent1, childIds: ['child-001', 'child-002'], familyId: DEMO_FAMILY_ID },
    { user: parent2, childIds: ['child-001', 'child-002'], familyId: DEMO_FAMILY_ID },
    { user: reviewParent, childIds: ['child-review-boy', 'child-review-girl'], familyId: REVIEW_FAMILY_ID },
  ].map(({ user, childIds, familyId }) => ({
    id: lookupUid(user.email),
    userId: lookupUid(user.email),
    uid: lookupUid(user.email),
    name: user.name,
    email: user.email.toLowerCase(),
    emailNormalized: user.email.toLowerCase(),
    organizationId,
    organizationName,
    programId,
    programName,
    campusId,
    campusName,
    childIds,
    familyId,
    preferredContactMethod: 'app',
    relationshipType: 'Parent/Guardian',
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }));

  const childSeeds = [
    {
      id: 'child-001',
      name: 'Zachary Bridgeport',
      age: '5',
      room: 'Blue-1',
      session: 'AM',
      notes: 'Zachary is working on functional communication during transitions.',
      monthlyGoal: 'Use functional communication during transitions.',
      successCriteria: 'Meets target in 80% of opportunities across two consecutive sessions.',
      curriculum: 'Functional Communication, Transitions, Visual Schedule',
      behaviorNotes: 'Responsive to prompts and visual supports.',
      assignedTechEmails: [aba.email, tech2.email],
      amTechEmail: aba.email,
      pmTechEmail: tech2.email,
      parentRefs,
      familyId: DEMO_FAMILY_ID,
      dropoffTimeISO: '2026-05-13T08:30:00.000Z',
      pickupTimeISO: '2026-05-13T12:15:00.000Z',
    },
    {
      id: 'child-002',
      name: 'Ashley Bridgeport',
      age: '7',
      room: 'Blue-2',
      session: 'PM',
      notes: 'Ashley is working on spontaneous requests for preferred items.',
      monthlyGoal: 'Increase spontaneous requests for preferred items.',
      successCriteria: 'Meets target in 80% of opportunities across two consecutive sessions.',
      curriculum: 'Peer Play, Matching, Independent Work',
      behaviorNotes: 'Benefits from movement breaks and AAC supports.',
      assignedTechEmails: [tech3.email, tech4.email],
      amTechEmail: tech3.email,
      pmTechEmail: tech4.email,
      parentRefs,
      familyId: DEMO_FAMILY_ID,
      dropoffTimeISO: '2026-05-13T12:45:00.000Z',
      pickupTimeISO: '2026-05-13T16:15:00.000Z',
    },
    {
      id: 'child-review-boy',
      name: 'Boy Reviewer',
      age: '6',
      room: 'Green-1',
      session: 'AM',
      notes: 'Boy Reviewer is working on transition tolerance, expressive requests, and independent routines.',
      monthlyGoal: 'Increase independent requests and smoother transitions across the morning routine.',
      successCriteria: 'Demonstrates the target skill in 4 of 5 opportunities across two consecutive sessions.',
      curriculum: 'Functional Communication, Daily Living, Visual Schedules',
      behaviorNotes: 'Responds well to first/then supports and movement breaks.',
      assignedTechEmails: [aba.email, tech2.email],
      amTechEmail: aba.email,
      pmTechEmail: tech2.email,
      parentRefs: reviewParentRefs,
      familyId: REVIEW_FAMILY_ID,
      dropoffTimeISO: '2026-05-13T08:20:00.000Z',
      pickupTimeISO: '2026-05-13T12:10:00.000Z',
      insurance: { provider: 'Reviewer Family Health', memberId: 'RVW-BOY-001', policyNumber: 'POL-REVIEW-BOY' },
    },
    {
      id: 'child-review-girl',
      name: 'Girl Reviewer',
      age: '8',
      room: 'Green-2',
      session: 'PM',
      notes: 'Girl Reviewer is focusing on peer engagement, coping strategies, and independent work completion.',
      monthlyGoal: 'Increase peer engagement and independent completion of structured tasks.',
      successCriteria: 'Completes structured tasks independently in 80% of observed opportunities.',
      curriculum: 'Peer Play, Self-Regulation, Independent Work',
      behaviorNotes: 'Benefits from previewing schedule changes and access to calming tools.',
      assignedTechEmails: [tech3.email, tech4.email],
      amTechEmail: tech3.email,
      pmTechEmail: tech4.email,
      parentRefs: reviewParentRefs,
      familyId: REVIEW_FAMILY_ID,
      dropoffTimeISO: '2026-05-13T12:50:00.000Z',
      pickupTimeISO: '2026-05-13T16:20:00.000Z',
      insurance: { provider: 'Reviewer Family Health', memberId: 'RVW-GIRL-001', policyNumber: 'POL-REVIEW-GIRL' },
    },
  ];

  const childDocs = childSeeds.map((child) => ({
    id: child.id,
    name: child.name,
    firstName: splitName(child.name).firstName,
    lastName: splitName(child.name).lastName,
    age: child.age,
    room: child.room,
    session: child.session,
    notes: child.notes,
    carePlan: child.monthlyGoal,
    monthlyGoal: child.monthlyGoal,
    successCriteria: child.successCriteria,
    curriculum: child.curriculum,
    programCurriculum: child.curriculum,
    behaviorNotes: child.behaviorNotes,
    organizationId,
    organizationName,
    programId,
    programName,
    campusId,
    campusName,
    enrollmentCode,
    familyId: child.familyId || DEMO_FAMILY_ID,
    parents: child.parentRefs || parentRefs,
    parentIds: (child.parentRefs || parentRefs).map((parent) => parent.id),
    assignedABA: child.assignedTechEmails.map((email) => lookupUid(email)),
    assigned_ABA: child.assignedTechEmails.map((email) => lookupUid(email)),
    amTherapistId: lookupUid(child.amTechEmail),
    pmTherapistId: lookupUid(child.pmTechEmail),
    bcaTherapistId: lookupUid(bcba.email),
    insurance: child.insurance || null,
    dropoffTimeISO: child.dropoffTimeISO || null,
    pickupTimeISO: child.pickupTimeISO || null,
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }));

  const directoryLinks = [
    ...[parent1, parent2, reviewParent].map((user) => ({
      uid: lookupUid(user.email),
      data: {
        role: 'parent',
        parentId: lookupUid(user.email),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    })),
    ...[aba, tech1, tech2, tech3, tech4].map((user) => ({
      uid: lookupUid(user.email),
      data: {
        role: 'therapist',
        therapistId: lookupUid(user.email),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    })),
  ];

  return { parentDocs, therapistDocs, childDocs, directoryLinks };
}

const DATABASE_URL = (
  process.env.CB_DATABASE_URL ||
  process.env.BB_DATABASE_URL ||
  process.env.DATABASE_URL ||
  ''
).trim();

if (!DATABASE_URL && !DRY) {
  console.error('[seed] Missing CB_DATABASE_URL/BB_DATABASE_URL/DATABASE_URL.');
  process.exit(1);
}

function buildPgPoolConfig(connectionString) {
  const cfg = { connectionString };
  const force = String(process.env.CB_PG_SSL || process.env.BB_PG_SSL || '').toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(force)) {
    cfg.ssl = { rejectUnauthorized: false };
    return cfg;
  }
  try {
    const u = new URL(connectionString);
    const host = String(u.hostname || '').toLowerCase();
    const sslParam = String(u.searchParams.get('ssl') || '').toLowerCase();
    const sslMode = String(u.searchParams.get('sslmode') || '').toLowerCase();
    if (host.endsWith('.supabase.co') || sslParam === '1' || sslParam === 'true' || sslMode === 'require') {
      cfg.ssl = { rejectUnauthorized: false };
    }
  } catch (_) { /* ignore */ }
  return cfg;
}

function readJsonFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function inferProjectIdFromFirebaseConfig() {
  const raw = String(process.env.FIREBASE_CONFIG || '').trim();
  if (!raw) return '';
  try {
    const parsed = raw.startsWith('{') ? JSON.parse(raw) : readJsonFile(raw);
    return String(parsed?.projectId || parsed?.project_id || '').trim();
  } catch (_) {
    return '';
  }
}

function inferProjectIdFromServiceAccount() {
  const serviceAccountPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  const parsed = readJsonFile(serviceAccountPath);
  return String(parsed?.project_id || parsed?.projectId || '').trim();
}

function inferFirebaseProjectIdFromEas() {
  try {
    const easFilePath = path.resolve(process.cwd(), 'eas.json');
    if (!fs.existsSync(easFilePath)) return '';
    const eas = JSON.parse(fs.readFileSync(easFilePath, 'utf8'));
    const env = eas?.build?.internal?.env || eas?.build?.development?.env || null;
    return String(env?.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  } catch (_) {
    return '';
  }
}

function getProjectId() {
  return (
    process.env.CB_FIREBASE_PROJECT_ID ||
    process.env.BB_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    inferProjectIdFromFirebaseConfig() ||
    inferProjectIdFromServiceAccount() ||
    inferFirebaseProjectIdFromEas() ||
    'communitybridge-26apr'
  ).trim();
}

function initFirebaseAdmin() {
  if (admin.apps && admin.apps.length) return admin.app();
  const projectId = getProjectId();
  if (projectId) {
    if (!process.env.CB_FIREBASE_PROJECT_ID) process.env.CB_FIREBASE_PROJECT_ID = projectId;
    if (!process.env.GCLOUD_PROJECT) process.env.GCLOUD_PROJECT = projectId;
    if (!process.env.GCP_PROJECT) process.env.GCP_PROJECT = projectId;
  }
  // Application Default Credentials: GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC.
  return admin.initializeApp(projectId ? { projectId } : undefined);
}

async function upsertTenantDirectory(firestore) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const organization of TENANT_SEED.organizations) {
    const organizationId = String(organization?.id || '').trim();
    if (!organizationId) continue;
    if (DRY) {
      console.log(`[seed][dry] would seed tenant organization ${organizationId}`);
    } else {
      await firestore.collection('organizations').doc(organizationId).set({
        ...organization,
        id: organizationId,
        updatedAt: now,
      }, { merge: true });
    }
  }

  for (const program of TENANT_SEED.programs) {
    const organizationId = String(program?.organizationId || '').trim();
    const programId = String(program?.id || '').trim();
    if (!organizationId || !programId) continue;
    if (DRY) {
      console.log(`[seed][dry] would seed tenant program ${organizationId}/${programId}`);
    } else {
      await firestore.collection('organizations').doc(organizationId).collection('programs').doc(programId).set({
        ...program,
        id: programId,
        organizationId,
        updatedAt: now,
      }, { merge: true });
    }
  }

  for (const campus of TENANT_SEED.campuses) {
    const organizationId = String(campus?.organizationId || '').trim();
    const programId = String(campus?.programId || '').trim();
    const campusId = String(campus?.id || '').trim();
    if (!organizationId || !programId || !campusId) continue;
    if (DRY) {
      console.log(`[seed][dry] would seed tenant campus ${organizationId}/${programId}/${campusId}`);
    } else {
      await firestore.collection('organizations').doc(organizationId).collection('campuses').doc(campusId).set({
        ...campus,
        id: campusId,
        organizationId,
        programId,
        updatedAt: now,
      }, { merge: true });
    }
  }
}

async function upsertFirebaseUser(u) {
  const auth = admin.auth();
  let userRecord = null;
  try {
    userRecord = await auth.getUserByEmail(u.email);
  } catch (e) {
    if (!e || e.code !== 'auth/user-not-found') throw e;
  }

  if (userRecord) {
    userRecord = await auth.updateUser(userRecord.uid, {
      email: u.email,
      emailVerified: true,
      password: u.password,
      displayName: u.name,
      disabled: false,
    });
    console.log(`[seed][fb] updated ${u.email} (uid=${userRecord.uid})`);
  } else {
    userRecord = await auth.createUser({
      email: u.email,
      emailVerified: true,
      password: u.password,
      displayName: u.name,
      disabled: false,
    });
    console.log(`[seed][fb] created ${u.email} (uid=${userRecord.uid})`);
  }

  await auth.setCustomUserClaims(userRecord.uid, { role: u.role });
  return userRecord.uid;
}

async function getUsersColumns(pool) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`
  );
  return new Set(rows.map((r) => String(r.column_name)));
}

async function upsertPostgresUser(pool, columns, u, uid) {
  const now = new Date();
  const hash = bcrypt.hashSync(u.password, 12);

  // Use the Firebase UID as the Postgres id so the two stores line up.
  const cols = ['id', 'email', 'password_hash', 'name', 'role', 'created_at', 'updated_at'];
  const vals = [uid, u.email.toLowerCase(), hash, u.name, u.role, now, now];

  if (columns.has('phone')) { cols.push('phone'); vals.push(''); }
  if (columns.has('email_verified_at')) { cols.push('email_verified_at'); vals.push(now); }
  if (columns.has('mfa_verified_at')) { cols.push('mfa_verified_at'); vals.push(now); }
  if (columns.has('organization_id')) { cols.push('organization_id'); vals.push(String(TENANT_SEED.organization.id || '').trim()); }

  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
  const updates = cols
    .filter((c) => c !== 'id' && c !== 'created_at')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');

  // Conflict on email (case-insensitive). Some schemas have a unique index on
  // lower(email); fall back to a manual update if ON CONFLICT cannot match.
  try {
    await pool.query(
      `INSERT INTO users (${cols.join(',')}) VALUES (${placeholders})
       ON CONFLICT (email) DO UPDATE SET ${updates}`,
      vals
    );
    console.log(`[seed][pg] upserted ${u.email} role=${u.role}`);
    return;
  } catch (e) {
    if (!/no unique or exclusion constraint/i.test(String(e && e.message))) throw e;
  }

  // Fallback: manual upsert by lower(email).
  const existing = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [u.email.toLowerCase()]);
  if (existing.rows[0]) {
    const setCols = cols.filter((c) => c !== 'id' && c !== 'created_at');
    const setSql = setCols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const params = [existing.rows[0].id, ...setCols.map((c) => vals[cols.indexOf(c)])];
    await pool.query(`UPDATE users SET ${setSql} WHERE id = $1`, params);
    console.log(`[seed][pg] updated ${u.email} role=${u.role}`);
  } else {
    await pool.query(
      `INSERT INTO users (${cols.join(',')}) VALUES (${placeholders})`,
      vals
    );
    console.log(`[seed][pg] inserted ${u.email} role=${u.role}`);
  }
}

async function upsertFirestoreUserProfile(firestore, user, uid) {
  const profile = buildUserProfilePayload(user, uid);
  if (DRY) {
    console.log(`[seed][dry] would upsert Firestore user profile ${user.email}`);
    return;
  }
  await firestore.collection('users').doc(uid).set(profile, { merge: true });
  await firestore.collection('organizations').doc(profile.organizationId).collection('users').doc(uid).set(profile, { merge: true });
}

async function upsertDirectoryRecords(firestore, uidByEmail) {
  const records = buildDirectoryEntitiesByEmail(uidByEmail);
  for (const parent of records.parentDocs) {
    if (DRY) {
      console.log(`[seed][dry] would upsert parent ${parent.id} (${parent.email})`);
    } else {
      await firestore.collection('parents').doc(parent.id).set(parent, { merge: true });
    }
  }
  for (const therapist of records.therapistDocs) {
    if (DRY) {
      console.log(`[seed][dry] would upsert staff ${therapist.id} role=${therapist.role} (${therapist.email})`);
    } else {
      await firestore.collection('therapists').doc(therapist.id).set(therapist, { merge: true });
    }
  }
  for (const child of records.childDocs) {
    if (DRY) {
      console.log(`[seed][dry] would upsert child ${child.id} assignedABA=${child.assignedABA.join(',')}`);
    } else {
      await firestore.collection('children').doc(child.id).set(child, { merge: true });
    }
  }
  for (const link of records.directoryLinks) {
    if (DRY) {
      console.log(`[seed][dry] would upsert directory link ${link.uid} role=${link.data.role}`);
    } else {
      await firestore.collection('directoryLinks').doc(link.uid).set(link.data, { merge: true });
    }
  }
  if (!DRY) {
    await firestore.collection('meta').doc('directory').set({ seededAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
}

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeSession(value) {
  const session = String(value || '').trim().toUpperCase();
  if (session === 'AM' || session === 'PM') return session;
  return '';
}

function deriveChildAbaAssignments(child) {
  const childId = normalizeId(child?.id);
  if (!childId) return [];

  const rawAssigned = child?.assignedABA || child?.assigned_ABA || child?.assigned || [];
  const assigned = (Array.isArray(rawAssigned) ? rawAssigned : [rawAssigned])
    .map((value) => normalizeId(value))
    .filter(Boolean);

  if (!assigned.length) return [];

  const session = normalizeSession(child?.session);
  if (assigned.length === 1) {
    return [{ childId, session: session || 'AM', abaId: assigned[0] }];
  }

  if (session === 'AM') {
    return [
      { childId, session: 'AM', abaId: assigned[0] },
      { childId, session: 'PM', abaId: assigned[1] },
    ];
  }
  if (session === 'PM') {
    return [
      { childId, session: 'PM', abaId: assigned[0] },
      { childId, session: 'AM', abaId: assigned[1] },
    ];
  }

  return [
    { childId, session: 'AM', abaId: assigned[0] },
    { childId, session: 'PM', abaId: assigned[1] },
  ];
}

function toPostgresDirectoryJson(record, nowIso) {
  return {
    ...record,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

async function upsertPostgresDirectoryRecords(pool, uidByEmail) {
  const records = buildDirectoryEntitiesByEmail(uidByEmail);
  const now = new Date();
  const nowIso = now.toISOString();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const parent of records.parentDocs) {
      await client.query(
        `INSERT INTO directory_parents (id, data_json, created_at, updated_at)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (id) DO UPDATE SET data_json = EXCLUDED.data_json, updated_at = EXCLUDED.updated_at`,
        [parent.id, JSON.stringify(toPostgresDirectoryJson(parent, nowIso)), now, now]
      );
    }

    for (const therapist of records.therapistDocs) {
      await client.query(
        `INSERT INTO directory_therapists (id, data_json, created_at, updated_at)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (id) DO UPDATE SET data_json = EXCLUDED.data_json, updated_at = EXCLUDED.updated_at`,
        [therapist.id, JSON.stringify(toPostgresDirectoryJson(therapist, nowIso)), now, now]
      );
    }

    for (const child of records.childDocs) {
      await client.query(
        `INSERT INTO directory_children (id, data_json, created_at, updated_at)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (id) DO UPDATE SET data_json = EXCLUDED.data_json, updated_at = EXCLUDED.updated_at`,
        [child.id, JSON.stringify(toPostgresDirectoryJson(child, nowIso)), now, now]
      );
    }

    await client.query('DELETE FROM child_aba_assignments', []);
    await client.query('DELETE FROM aba_supervision', []);

    for (const therapist of records.therapistDocs) {
      const abaId = normalizeId(therapist?.id);
      const bcbaId = normalizeId(therapist?.supervisedBy || therapist?.supervised_by);
      if (!abaId || !bcbaId) continue;
      await client.query(
        `INSERT INTO aba_supervision (aba_id, bcba_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (aba_id) DO UPDATE SET bcba_id = EXCLUDED.bcba_id, updated_at = EXCLUDED.updated_at`,
        [abaId, bcbaId, now, now]
      );
    }

    for (const child of records.childDocs) {
      for (const assignment of deriveChildAbaAssignments(child)) {
        await client.query(
          `INSERT INTO child_aba_assignments (child_id, session, aba_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (child_id, session) DO UPDATE SET aba_id = EXCLUDED.aba_id, updated_at = EXCLUDED.updated_at`,
          [assignment.childId, assignment.session, assignment.abaId, now, now]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`[seed][pg] upserted directory graph parents=${records.parentDocs.length} children=${records.childDocs.length} staff=${records.therapistDocs.length}`);
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // ignore rollback errors and surface the original failure below
    }
    throw e;
  } finally {
    client.release();
  }
}

function buildReviewSessionSummary({ childName, therapistName, sessionDate, moodScore, progressLevel, independenceLevel, programsWorkedOn, successCriteriaMet, interferingBehaviors, narrative }) {
  return {
    sessionDate,
    childName,
    moodScore: { selectedValue: moodScore, label: String(moodScore) },
    dailyRecap: {
      progressLevel,
      independenceLevel,
      therapistNarrative: narrative,
    },
    programsWorkedOn,
    successCriteriaMet,
    interferingBehaviors,
    careTeamHighlights: [
      `${therapistName} documented a stable routine and measurable progress during this session.`,
    ],
  };
}

async function upsertReviewExperienceData(pool, uidByEmail) {
  const lookupUid = (email) => {
    const key = String(email || '').trim().toLowerCase();
    const uid = String(uidByEmail.get(key) || '').trim();
    if (!uid) throw new Error(`Missing seeded uid for ${email}`);
    return uid;
  };

  const reviewParent = DEMO_EMAIL_MAP['appreview@communitybridge.app'];
  const office = DEMO_EMAIL_MAP['office@communitybridge.app'];
  const adminUser = DEMO_EMAIL_MAP['admin@communitybridge.app'];
  const bcba = DEMO_EMAIL_MAP['bcba@communitybridge.app'];
  const aba = DEMO_EMAIL_MAP['aba@communitybridge.app'];
  const tech1 = DEMO_EMAIL_MAP['abatech1@communitybridge.app'];
  const tech3 = DEMO_EMAIL_MAP['abatech3@communitybridge.app'];
  const reviewParentId = lookupUid(reviewParent.email);
  const officeId = lookupUid(office.email);
  const adminId = lookupUid(adminUser.email);
  const bcbaId = lookupUid(bcba.email);
  const abaId = lookupUid(aba.email);
  const tech3Id = lookupUid(tech3.email);
  const organizationId = String(TENANT_SEED.organization.id || '').trim();
  const programId = String(TENANT_SEED.program.id || '').trim();
  const campusId = String(TENANT_SEED.campus.id || '').trim();

  const makeActor = (id, name, role) => ({ id, name, role, avatar: '' });
  const reviewActor = makeActor(reviewParentId, reviewParent.name, reviewParent.role);
  const officeActor = makeActor(officeId, office.name, office.role);
  const adminActor = makeActor(adminId, adminUser.name, adminUser.role);
  const bcbaActor = makeActor(bcbaId, bcba.name, bcba.role);

  const posts = [
    {
      id: 'post-review-welcome',
      author: officeActor,
      title: 'Welcome to CommunityBridge',
      body: 'This review account includes sample schedules, care team contacts, parent messaging, urgent updates, and approved session summaries for Boy Reviewer and Girl Reviewer.',
      likes: 4,
      shares: 1,
      comments: [],
      createdAt: '2026-05-10T14:00:00.000Z',
      updatedAt: '2026-05-10T14:00:00.000Z',
    },
    {
      id: 'post-review-documents',
      author: adminActor,
      title: 'Family Reminder',
      body: 'Insurance information, attendance history, and recent progress summaries are available in this review account for App Store testing.',
      likes: 2,
      shares: 0,
      comments: [],
      createdAt: '2026-05-11T16:30:00.000Z',
      updatedAt: '2026-05-11T16:30:00.000Z',
    },
  ];

  const messages = [
    {
      id: 'msg-review-office-1',
      threadId: 'thread-review-office',
      body: 'Hi App Reviewer, Boy Reviewer is set for an 8:20 AM arrival tomorrow. Let us know if pickup needs to move.',
      sender: officeActor,
      to: [reviewActor],
      createdAt: '2026-05-12T13:15:00.000Z',
    },
    {
      id: 'msg-review-office-2',
      threadId: 'thread-review-office',
      body: 'Thanks. We are on time for the usual pickup window.',
      sender: reviewActor,
      to: [officeActor],
      createdAt: '2026-05-12T13:22:00.000Z',
    },
    {
      id: 'msg-review-bcba-1',
      threadId: 'thread-review-bcba',
      body: 'Girl Reviewer had a strong afternoon session today. I posted an updated summary with peer engagement notes.',
      sender: bcbaActor,
      to: [reviewActor],
      createdAt: '2026-05-12T18:05:00.000Z',
    },
  ];

  const urgentMemos = [
    {
      id: 'memo-review-admin',
      type: 'admin_memo',
      status: 'sent',
      proposerId: adminId,
      actorRole: 'admin',
      childId: 'child-review-boy',
      title: 'Pickup Reminder',
      body: 'Boy Reviewer will be ready for pickup at the front desk at 12:10 PM.',
      note: '',
      recipients: [reviewParentId],
      ack: 0,
      createdAt: '2026-05-12T15:00:00.000Z',
      updatedAt: '2026-05-12T15:00:00.000Z',
    },
    {
      id: 'memo-review-urgent',
      type: 'urgent_memo',
      status: 'sent',
      proposerId: officeId,
      actorRole: 'office',
      childId: 'child-review-girl',
      title: 'Schedule Update',
      body: 'Girl Reviewer will use the Green-2 classroom entrance for the afternoon program this week.',
      note: 'Please use the side entrance sign-in station.',
      recipients: [reviewParentId],
      ack: 0,
      createdAt: '2026-05-11T17:20:00.000Z',
      updatedAt: '2026-05-11T17:20:00.000Z',
    },
  ];

  const timeChangeProposals = [
    {
      id: 'proposal-review-girl-pickup',
      childId: 'child-review-girl',
      type: 'pickup',
      proposedIso: '2026-05-14T16:35:00.000Z',
      note: 'Requesting a 15-minute later pickup for Girl Reviewer on Thursday.',
      proposerId: reviewParentId,
      action: 'pending',
      createdAt: '2026-05-12T19:10:00.000Z',
    },
  ];

  const attendanceRecords = [
    { id: 'attendance-review-boy-2026-05-12', childId: 'child-review-boy', recordedFor: '2026-05-12', status: 'present', note: 'On time', actorId: officeId, actorRole: 'office', createdAt: '2026-05-12T08:25:00.000Z', updatedAt: '2026-05-12T08:25:00.000Z' },
    { id: 'attendance-review-boy-2026-05-13', childId: 'child-review-boy', recordedFor: '2026-05-13', status: 'present', note: 'Smooth arrival', actorId: officeId, actorRole: 'office', createdAt: '2026-05-13T08:18:00.000Z', updatedAt: '2026-05-13T08:18:00.000Z' },
    { id: 'attendance-review-girl-2026-05-12', childId: 'child-review-girl', recordedFor: '2026-05-12', status: 'present', note: 'Ready for PM session', actorId: officeId, actorRole: 'office', createdAt: '2026-05-12T12:47:00.000Z', updatedAt: '2026-05-12T12:47:00.000Z' },
    { id: 'attendance-review-girl-2026-05-13', childId: 'child-review-girl', recordedFor: '2026-05-13', status: 'tardy', note: 'Arrived 10 minutes late', actorId: officeId, actorRole: 'office', createdAt: '2026-05-13T13:00:00.000Z', updatedAt: '2026-05-13T13:00:00.000Z' },
  ];

  const moodEntries = [
    { id: 'mood-review-boy-1', childId: 'child-review-boy', score: 4, note: 'Engaged and responsive.', actorId: abaId, actorRole: 'therapist', recordedAt: '2026-05-12T11:45:00.000Z', createdAt: '2026-05-12T11:45:00.000Z' },
    { id: 'mood-review-boy-2', childId: 'child-review-boy', score: 5, note: 'Strong transition morning.', actorId: abaId, actorRole: 'therapist', recordedAt: '2026-05-13T11:50:00.000Z', createdAt: '2026-05-13T11:50:00.000Z' },
    { id: 'mood-review-girl-1', childId: 'child-review-girl', score: 4, note: 'Good participation with peers.', actorId: tech3Id, actorRole: 'therapist', recordedAt: '2026-05-12T15:40:00.000Z', createdAt: '2026-05-12T15:40:00.000Z' },
    { id: 'mood-review-girl-2', childId: 'child-review-girl', score: 3, note: 'Needed extra regulation support after arrival.', actorId: tech3Id, actorRole: 'therapist', recordedAt: '2026-05-13T15:35:00.000Z', createdAt: '2026-05-13T15:35:00.000Z' },
  ];

  const therapySessions = [
    { id: 'session-review-boy-1', childId: 'child-review-boy', childName: 'Boy Reviewer', therapistId: abaId, therapistRole: 'therapist', organizationId, programId, campusId, sessionDate: '2026-05-12', sessionType: 'am', startedAt: '2026-05-12T08:35:00.000Z', endedAt: '2026-05-12T11:30:00.000Z', status: 'submitted', summaryGeneratedAt: '2026-05-12T11:35:00.000Z', approvedAt: '2026-05-12T12:05:00.000Z', createdAt: '2026-05-12T08:35:00.000Z', updatedAt: '2026-05-12T12:05:00.000Z' },
    { id: 'session-review-girl-1', childId: 'child-review-girl', childName: 'Girl Reviewer', therapistId: tech3Id, therapistRole: 'therapist', organizationId, programId, campusId, sessionDate: '2026-05-12', sessionType: 'pm', startedAt: '2026-05-12T13:00:00.000Z', endedAt: '2026-05-12T15:45:00.000Z', status: 'submitted', summaryGeneratedAt: '2026-05-12T15:50:00.000Z', approvedAt: '2026-05-12T16:10:00.000Z', createdAt: '2026-05-12T13:00:00.000Z', updatedAt: '2026-05-12T16:10:00.000Z' },
  ];

  const summaryBoy = buildReviewSessionSummary({
    childName: 'Boy Reviewer',
    therapistName: aba.name,
    sessionDate: '2026-05-12',
    moodScore: 5,
    progressLevel: 'Moderate progress',
    independenceLevel: 'Moderate independence',
    programsWorkedOn: ['Functional Communication', 'Transition Practice', 'Following Directions'],
    successCriteriaMet: ['Requested break with prompt', 'Transitioned with visual schedule'],
    interferingBehaviors: [{ label: 'Task refusal', frequency: 1 }],
    narrative: 'Boy Reviewer completed his morning routine with fewer prompts and used a verbal request during two transitions.',
  });
  const summaryGirl = buildReviewSessionSummary({
    childName: 'Girl Reviewer',
    therapistName: tech3.name,
    sessionDate: '2026-05-12',
    moodScore: 4,
    progressLevel: 'Moderate progress',
    independenceLevel: 'Minimal independence',
    programsWorkedOn: ['Peer Play', 'Independent Work', 'Coping Skills'],
    successCriteriaMet: ['Joined peer game for 10 minutes', 'Completed two independent tasks'],
    interferingBehaviors: [{ label: 'Avoidance', frequency: 2 }],
    narrative: 'Girl Reviewer re-engaged after arrival support and completed structured work with one verbal prompt.',
  });

  const therapySessionSummaries = [
    { id: 'summary-review-boy-1', sessionId: 'session-review-boy-1', childId: 'child-review-boy', therapistId: abaId, status: 'approved', version: 1, summary: summaryBoy, summaryText: 'Boy Reviewer showed moderate progress in communication and transitions.', generatedAt: '2026-05-12T11:35:00.000Z', updatedAt: '2026-05-12T12:05:00.000Z', approvedAt: '2026-05-12T12:05:00.000Z' },
    { id: 'summary-review-girl-1', sessionId: 'session-review-girl-1', childId: 'child-review-girl', therapistId: tech3Id, status: 'approved', version: 1, summary: summaryGirl, summaryText: 'Girl Reviewer showed moderate progress in peer engagement and structured task completion.', generatedAt: '2026-05-12T15:50:00.000Z', updatedAt: '2026-05-12T16:10:00.000Z', approvedAt: '2026-05-12T16:10:00.000Z' },
  ];

  for (const post of posts) {
    await pool.query(
      `INSERT INTO posts (id, author_json, title, body, image, likes, shares, comments_json, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       ON CONFLICT (id) DO UPDATE SET author_json = EXCLUDED.author_json, title = EXCLUDED.title, body = EXCLUDED.body, image = EXCLUDED.image, likes = EXCLUDED.likes, shares = EXCLUDED.shares, comments_json = EXCLUDED.comments_json, updated_at = EXCLUDED.updated_at`,
      [post.id, JSON.stringify(post.author), post.title, post.body, null, post.likes, post.shares, JSON.stringify(post.comments), new Date(post.createdAt), new Date(post.updatedAt)]
    );
  }

  for (const message of messages) {
    await pool.query(
      `INSERT INTO messages (id, thread_id, body, sender_json, to_json, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       ON CONFLICT (id) DO UPDATE SET thread_id = EXCLUDED.thread_id, body = EXCLUDED.body, sender_json = EXCLUDED.sender_json, to_json = EXCLUDED.to_json, created_at = EXCLUDED.created_at`,
      [message.id, message.threadId, message.body, JSON.stringify(message.sender), JSON.stringify(message.to), new Date(message.createdAt)]
    );
  }

  for (const memo of urgentMemos) {
    const memoJson = {
      id: memo.id,
      type: memo.type,
      title: memo.title,
      body: memo.body,
      note: memo.note,
      recipients: memo.recipients,
      proposerId: memo.proposerId,
      childId: memo.childId,
      status: memo.status,
      createdAt: memo.createdAt,
      date: memo.createdAt,
    };
    await pool.query(
      `INSERT INTO urgent_memos (id, type, status, proposer_id, actor_role, child_id, title, body, note, meta_json, memo_json, responded_at, ack, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15)
       ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, status = EXCLUDED.status, proposer_id = EXCLUDED.proposer_id, actor_role = EXCLUDED.actor_role, child_id = EXCLUDED.child_id, title = EXCLUDED.title, body = EXCLUDED.body, note = EXCLUDED.note, meta_json = EXCLUDED.meta_json, memo_json = EXCLUDED.memo_json, responded_at = EXCLUDED.responded_at, ack = EXCLUDED.ack, updated_at = EXCLUDED.updated_at`,
      [memo.id, memo.type, memo.status, memo.proposerId, memo.actorRole, memo.childId, memo.title, memo.body, memo.note, JSON.stringify({ seeded: true }), JSON.stringify(memoJson), null, memo.ack, new Date(memo.createdAt), new Date(memo.updatedAt)]
    );
  }

  for (const proposal of timeChangeProposals) {
    await pool.query(
      `INSERT INTO time_change_proposals (id, child_id, type, proposed_iso, note, proposer_id, action, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET child_id = EXCLUDED.child_id, type = EXCLUDED.type, proposed_iso = EXCLUDED.proposed_iso, note = EXCLUDED.note, proposer_id = EXCLUDED.proposer_id, action = EXCLUDED.action, created_at = EXCLUDED.created_at`,
      [proposal.id, proposal.childId, proposal.type, proposal.proposedIso, proposal.note, proposal.proposerId, proposal.action, new Date(proposal.createdAt)]
    );
  }

  for (const record of attendanceRecords) {
    await pool.query(
      `INSERT INTO attendance_records (id, child_id, recorded_for, status, note, actor_id, actor_role, created_at, updated_at)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (child_id, recorded_for) DO UPDATE SET id = EXCLUDED.id, status = EXCLUDED.status, note = EXCLUDED.note, actor_id = EXCLUDED.actor_id, actor_role = EXCLUDED.actor_role, updated_at = EXCLUDED.updated_at`,
      [record.id, record.childId, record.recordedFor, record.status, record.note, record.actorId, record.actorRole, new Date(record.createdAt), new Date(record.updatedAt)]
    );
  }

  for (const mood of moodEntries) {
    await pool.query(
      `INSERT INTO mood_entries (id, child_id, score, note, actor_id, actor_role, recorded_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET child_id = EXCLUDED.child_id, score = EXCLUDED.score, note = EXCLUDED.note, actor_id = EXCLUDED.actor_id, actor_role = EXCLUDED.actor_role, recorded_at = EXCLUDED.recorded_at, created_at = EXCLUDED.created_at`,
      [mood.id, mood.childId, mood.score, mood.note, mood.actorId, mood.actorRole, new Date(mood.recordedAt), new Date(mood.createdAt)]
    );
  }

  for (const session of therapySessions) {
    await pool.query(
      `INSERT INTO therapy_sessions (id, child_id, child_name, therapist_id, therapist_role, organization_id, program_id, campus_id, session_date, session_type, started_at, ended_at, status, summary_generated_at, approved_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET child_id = EXCLUDED.child_id, child_name = EXCLUDED.child_name, therapist_id = EXCLUDED.therapist_id, therapist_role = EXCLUDED.therapist_role, organization_id = EXCLUDED.organization_id, program_id = EXCLUDED.program_id, campus_id = EXCLUDED.campus_id, session_date = EXCLUDED.session_date, session_type = EXCLUDED.session_type, started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, status = EXCLUDED.status, summary_generated_at = EXCLUDED.summary_generated_at, approved_at = EXCLUDED.approved_at, updated_at = EXCLUDED.updated_at`,
      [session.id, session.childId, session.childName, session.therapistId, session.therapistRole, session.organizationId, session.programId, session.campusId, session.sessionDate, session.sessionType, new Date(session.startedAt), new Date(session.endedAt), session.status, new Date(session.summaryGeneratedAt), new Date(session.approvedAt), new Date(session.createdAt), new Date(session.updatedAt)]
    );
  }

  for (const summary of therapySessionSummaries) {
    await pool.query(
      `INSERT INTO therapy_session_summaries (id, session_id, child_id, therapist_id, status, version, summary_json, summary_text, generated_at, updated_at, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
       ON CONFLICT (session_id) DO UPDATE SET id = EXCLUDED.id, child_id = EXCLUDED.child_id, therapist_id = EXCLUDED.therapist_id, status = EXCLUDED.status, version = EXCLUDED.version, summary_json = EXCLUDED.summary_json, summary_text = EXCLUDED.summary_text, generated_at = EXCLUDED.generated_at, updated_at = EXCLUDED.updated_at, approved_at = EXCLUDED.approved_at`,
      [summary.id, summary.sessionId, summary.childId, summary.therapistId, summary.status, summary.version, JSON.stringify(summary.summary), summary.summaryText, new Date(summary.generatedAt), new Date(summary.updatedAt), new Date(summary.approvedAt)]
    );
  }

  console.log('[seed][pg] upserted App Reviewer experience data');
}

async function main() {
  console.log(`[seed] mode=${DRY ? 'DRY RUN' : 'WRITE'} users=${TEST_USERS.length}`);

  if (DRY) {
    await upsertTenantDirectory(null);
    for (const u of TEST_USERS) {
      console.log(`[seed][dry] would seed ${u.email} role=${u.role}`);
    }
    const fakeUidByEmail = new Map(TEST_USERS.map((user, index) => [String(user.email || '').trim().toLowerCase(), `dry-run-uid-${index + 1}`]));
    await upsertDirectoryRecords(null, fakeUidByEmail);
    console.log('[seed][dry] would upsert Postgres directory graph from the same seeded records');
    return;
  }

  initFirebaseAdmin();
  const projectId = getProjectId() || '(from ADC)';
  console.log(`[seed] firebase project=${projectId}`);
  const firestore = admin.firestore();
  await upsertTenantDirectory(firestore);

  const pool = new Pool(buildPgPoolConfig(DATABASE_URL));
  try {
    const columns = await getUsersColumns(pool);
    if (!columns.size) {
      throw new Error('users table not found in target database');
    }

    const uidByEmail = new Map();
    for (const u of TEST_USERS) {
      try {
        const uid = await upsertFirebaseUser(u);
        await upsertPostgresUser(pool, columns, u, uid);
        await upsertFirestoreUserProfile(firestore, u, uid);
        uidByEmail.set(String(u.email || '').trim().toLowerCase(), uid);
      } catch (e) {
        console.error(`[seed] FAILED ${u.email}:`, (e && e.message) || e);
      }
    }

    if (uidByEmail.size === TEST_USERS.length) {
      await upsertDirectoryRecords(firestore, uidByEmail);
      await upsertPostgresDirectoryRecords(pool, uidByEmail);
      await upsertReviewExperienceData(pool, uidByEmail);
    } else {
      console.warn('[seed] Skipping directory graph because one or more user accounts failed to seed.');
    }
  } finally {
    await pool.end().catch(() => {});
  }

  console.log('[seed] done.');
}

main().catch((e) => {
  console.error('[seed] fatal:', e);
  const details = String(e?.details || e?.message || '').toLowerCase();
  if (details.includes('invalid_rapt') || details.includes('invalid_grant')) {
    console.error('[seed] Google Application Default Credentials need re-authentication.');
    console.error('[seed] Fix by either:');
    console.error('[seed]   1) setting GOOGLE_APPLICATION_CREDENTIALS to a Firebase service-account JSON for communitybridge-26apr, or');
    console.error('[seed]   2) running: gcloud auth application-default login');
  }
  process.exit(1);
});
