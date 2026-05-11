#!/usr/bin/env node
/*
  Seed demo users for TestFlight / QA into BOTH:
    1) Firebase Auth (so mobile login via signInWithEmailAndPassword works)
    2) The Postgres `users` table (so the API has a profile + role for them)

  Hardcoded demo users:
    hligon35@gmail.com            / ParentDemo123!   role=parent
    cheyanne2448@gmail.com        / ParentDemo123!   role=parent
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
  { name: 'CommunityBridge ABA Tech 1', email: 'abatech1@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CommunityBridge ABA Tech 2', email: 'abatech2@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CommunityBridge ABA Tech 3', email: 'abatech3@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CommunityBridge ABA Tech 4', email: 'abatech4@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CommunityBridge BCBA',     email: 'bcba@communitybridge.app',    password: 'BcbaDemo123!',   role: 'bcba' },
  { name: 'CommunityBridge Office',   email: 'office@communitybridge.app',  password: 'OfficeDemo123!', role: 'office' },
  { name: 'CommunityBridge Admin',    email: 'admin@communitybridge.app',   password: 'AdminDemo123!',  role: 'admin' },
];

const DEMO_EMAIL_MAP = Object.freeze(Object.fromEntries(TEST_USERS.map((user) => [String(user.email || '').trim().toLowerCase(), user])));

function loadTenantSeedData() {
  const filePath = path.join(process.cwd(), 'src', 'seed', 'tenantDirectory.seed.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const organizations = Array.isArray(raw?.organizations) ? raw.organizations : [];
  const programs = Array.isArray(raw?.programs) ? raw.programs : [];
  const campuses = Array.isArray(raw?.campuses) ? raw.campuses : [];
  const organization = organizations[0] || null;
  const program = programs.find((item) => String(item?.id || '').trim() === 'center-based-aba') || programs[0] || null;
  const campus = campuses.find((item) => String(item?.programId || '').trim() === String(program?.id || '').trim()) || campuses[0] || null;
  if (!organization || !program || !campus) {
    throw new Error('Tenant seed is missing organization/program/campus data.');
  }
  return { organizations, programs, campuses, organization, program, campus };
}

const TENANT_SEED = loadTenantSeedData();
const DEMO_FAMILY_ID = 'family-cook-demo';

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

  const staffUsers = [tech1, tech2, tech3, tech4, bcba, office, adminUser];
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

  const parentDocs = [parent1, parent2].map((user) => ({
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
    childIds: ['child-001', 'child-002'],
    familyId: DEMO_FAMILY_ID,
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
      assignedTechEmails: [tech1.email, tech2.email],
      amTechEmail: tech1.email,
      pmTechEmail: tech2.email,
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
    familyId: DEMO_FAMILY_ID,
    parents: parentRefs,
    parentIds: parentRefs.map((parent) => parent.id),
    assignedABA: child.assignedTechEmails.map((email) => lookupUid(email)),
    assigned_ABA: child.assignedTechEmails.map((email) => lookupUid(email)),
    amTherapistId: lookupUid(child.amTechEmail),
    pmTherapistId: lookupUid(child.pmTechEmail),
    bcaTherapistId: lookupUid(bcba.email),
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }));

  const directoryLinks = [
    ...[parent1, parent2].map((user) => ({
      uid: lookupUid(user.email),
      data: {
        role: 'parent',
        parentId: lookupUid(user.email),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    })),
    ...[tech1, tech2, tech3, tech4].map((user) => ({
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

async function main() {
  console.log(`[seed] mode=${DRY ? 'DRY RUN' : 'WRITE'} users=${TEST_USERS.length}`);

  if (DRY) {
    await upsertTenantDirectory(null);
    for (const u of TEST_USERS) {
      console.log(`[seed][dry] would seed ${u.email} role=${u.role}`);
    }
    const fakeUidByEmail = new Map(TEST_USERS.map((user, index) => [String(user.email || '').trim().toLowerCase(), `dry-run-uid-${index + 1}`]));
    await upsertDirectoryRecords(null, fakeUidByEmail);
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
