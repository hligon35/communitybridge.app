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

const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry') || process.argv.includes('-n');

const TEST_USERS = [
  { name: 'Harold Ligon',             email: 'hligon35@gmail.com',          password: 'ParentDemo123!', role: 'parent' },
  { name: 'Cheyanne Cook',            email: 'cheyanne2448@gmail.com',      password: 'ParentDemo123!', role: 'parent' },
  { name: 'CommunityBridge ABA Tech 1', email: 'abatech1@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CommunityBridge ABA Tech 2', email: 'abatech2@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CommunityBridge ABA Tech 3', email: 'abatech3@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CommunityBridge ABA Tech 4', email: 'abatech4@communitybridge.app', password: 'AbaTech123!', role: 'therapist' },
  { name: 'CommunityBridge BCBA',     email: 'bcba@communitybridge.app',    password: 'BcbaDemo123!',   role: 'bcba' },
  { name: 'CommunityBridge Office',   email: 'office@communitybridge.app',  password: 'OfficeDemo123!', role: 'office' },
  { name: 'CommunityBridge Admin',    email: 'admin@communitybridge.app',   password: 'AdminDemo123!',  role: 'admin' },
];

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

function getProjectId() {
  return (
    process.env.CB_FIREBASE_PROJECT_ID ||
    process.env.BB_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    ''
  ).trim();
}

function initFirebaseAdmin() {
  if (admin.apps && admin.apps.length) return admin.app();
  const projectId = getProjectId();
  // Application Default Credentials: GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC.
  return admin.initializeApp(projectId ? { projectId } : undefined);
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

async function main() {
  console.log(`[seed] mode=${DRY ? 'DRY RUN' : 'WRITE'} users=${TEST_USERS.length}`);

  if (DRY) {
    for (const u of TEST_USERS) {
      console.log(`[seed][dry] would seed ${u.email} role=${u.role}`);
    }
    return;
  }

  initFirebaseAdmin();
  const projectId = getProjectId() || '(from ADC)';
  console.log(`[seed] firebase project=${projectId}`);

  const pool = new Pool(buildPgPoolConfig(DATABASE_URL));
  try {
    const columns = await getUsersColumns(pool);
    if (!columns.size) {
      throw new Error('users table not found in target database');
    }

    for (const u of TEST_USERS) {
      try {
        const uid = await upsertFirebaseUser(u);
        await upsertPostgresUser(pool, columns, u, uid);
      } catch (e) {
        console.error(`[seed] FAILED ${u.email}:`, (e && e.message) || e);
      }
    }
  } finally {
    await pool.end().catch(() => {});
  }

  console.log('[seed] done.');
}

main().catch((e) => {
  console.error('[seed] fatal:', e);
  process.exit(1);
});
