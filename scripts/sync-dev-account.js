#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry') || process.argv.includes('-n');
const DEV_USER_PASSWORD = String(process.env.DEV_USER_PASSWORD || '').trim();

if (!DEV_USER_PASSWORD) {
  throw new Error('DEV_USER_PASSWORD is required to sync the development account.');
}

const DEV_USER = {
  email: 'dev@communitybridge.app',
  password: DEV_USER_PASSWORD,
  name: 'Developer',
  role: 'admin',
};

const DELETE_EMAILS = [
  'admin@communitybridge.app',
  'parent@communitybridge.app',
  'therapist@communitybridge.app',
  'hligon+tester@getsparqd.com',
];

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

const DATABASE_URL = (
  process.env.CB_DATABASE_URL ||
  process.env.BB_DATABASE_URL ||
  process.env.DATABASE_URL ||
  ''
).trim();

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
    if (host.endsWith('.supabase.co') || host.includes('.pooler.supabase.com') || sslParam === '1' || sslParam === 'true' || sslMode === 'require') {
      cfg.ssl = { rejectUnauthorized: false };
    }
  } catch (_) {}
  return cfg;
}

function getProjectId() {
  const fromEnv = (
    process.env.CB_FIREBASE_PROJECT_ID ||
    process.env.BB_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    ''
  ).trim();
  if (fromEnv) return fromEnv;
  return 'communitybridge-26apr';
}

function initFirebaseAdmin() {
  if (admin.apps && admin.apps.length) return admin.app();
  const projectId = getProjectId();
  return admin.initializeApp(projectId ? { projectId } : undefined);
}

async function getUsersColumns(pool) {
  const result = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
  return new Set((result.rows || []).map((row) => String(row.column_name)));
}

async function deleteFirebaseUserByEmail(auth, firestore, email) {
  try {
    const userRecord = await auth.getUserByEmail(email);
    if (DRY) {
      console.log(`[dev-sync][dry] would delete Firebase user ${email} (uid=${userRecord.uid})`);
      return;
    }
    await firestore.collection('users').doc(userRecord.uid).delete().catch(() => {});
    await firestore.collection('parents').doc(userRecord.uid).delete().catch(() => {});
    await firestore.collection('directoryLinks').doc(userRecord.uid).delete().catch(() => {});
    await auth.deleteUser(userRecord.uid);
    console.log(`[dev-sync][fb] deleted ${email}`);
  } catch (error) {
    if (error && error.code === 'auth/user-not-found') {
      console.log(`[dev-sync][fb] ${email} not found`);
      return;
    }
    throw error;
  }
}

async function upsertFirebaseUser(auth, user) {
  let userRecord = null;
  try {
    userRecord = await auth.getUserByEmail(user.email);
  } catch (error) {
    if (!error || error.code !== 'auth/user-not-found') throw error;
  }

  if (DRY) {
    console.log(`[dev-sync][dry] would ${userRecord ? 'update' : 'create'} Firebase user ${user.email}`);
    return userRecord ? userRecord.uid : 'dry-run-dev-uid';
  }

  if (userRecord) {
    userRecord = await auth.updateUser(userRecord.uid, {
      email: user.email,
      password: user.password,
      displayName: user.name,
      emailVerified: true,
      disabled: false,
    });
    console.log(`[dev-sync][fb] updated ${user.email}`);
  } else {
    userRecord = await auth.createUser({
      email: user.email,
      password: user.password,
      displayName: user.name,
      emailVerified: true,
      disabled: false,
    });
    console.log(`[dev-sync][fb] created ${user.email}`);
  }

  await auth.setCustomUserClaims(userRecord.uid, { role: user.role, devUser: true });
  return userRecord.uid;
}

async function upsertFirestoreProfile(firestore, uid, user) {
  if (DRY) {
    console.log(`[dev-sync][dry] would upsert Firestore profile for ${user.email}`);
    return;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await firestore.collection('users').doc(uid).set({
    id: uid,
    name: user.name,
    email: user.email,
    role: user.role,
    devUser: true,
    mfaVerifiedAt: now,
    updatedAt: now,
    createdAt: now,
  }, { merge: true });
  console.log(`[dev-sync][fs] upserted users/${uid}`);
}

async function deletePostgresUsers(pool, emails) {
  if (!emails.length) return;
  if (DRY) {
    console.log(`[dev-sync][dry] would delete Postgres users for ${emails.join(', ')}`);
    return;
  }
  const result = await pool.query('DELETE FROM users WHERE lower(email) = ANY($1::text[])', [emails.map((email) => String(email).toLowerCase())]);
  console.log(`[dev-sync][pg] deleted ${Number(result.rowCount || 0)} user row(s)`);
}

async function upsertPostgresUser(pool, columns, uid, user) {
  const now = new Date();
  const hash = bcrypt.hashSync(user.password, 12);
  const cols = ['id', 'email', 'password_hash', 'name', 'role', 'created_at', 'updated_at'];
  const vals = [uid, user.email.toLowerCase(), hash, user.name, user.role, now, now];

  if (columns.has('phone')) { cols.push('phone'); vals.push(''); }
  if (columns.has('email_verified_at')) { cols.push('email_verified_at'); vals.push(now); }
  if (columns.has('mfa_verified_at')) { cols.push('mfa_verified_at'); vals.push(now); }

  if (DRY) {
    console.log(`[dev-sync][dry] would upsert Postgres user ${user.email} role=${user.role}`);
    return;
  }

  const placeholders = cols.map((_, index) => `$${index + 1}`).join(',');
  const updates = cols.filter((column) => column !== 'id' && column !== 'created_at').map((column) => `${column} = EXCLUDED.${column}`).join(', ');

  try {
    await pool.query(
      `INSERT INTO users (${cols.join(',')}) VALUES (${placeholders})
       ON CONFLICT (email) DO UPDATE SET ${updates}`,
      vals
    );
    console.log(`[dev-sync][pg] upserted ${user.email}`);
    return;
  } catch (error) {
    if (!/no unique or exclusion constraint/i.test(String(error && error.message))) throw error;
  }

  const existing = await pool.query('SELECT id FROM users WHERE lower(email) = $1', [user.email.toLowerCase()]);
  if (existing.rows[0]) {
    const setCols = cols.filter((column) => column !== 'id' && column !== 'created_at');
    const setSql = setCols.map((column, index) => `${column} = $${index + 2}`).join(', ');
    const params = [existing.rows[0].id, ...setCols.map((column) => vals[cols.indexOf(column)])];
    await pool.query(`UPDATE users SET ${setSql} WHERE id = $1`, params);
    console.log(`[dev-sync][pg] updated ${user.email}`);
  } else {
    await pool.query(`INSERT INTO users (${cols.join(',')}) VALUES (${placeholders})`, vals);
    console.log(`[dev-sync][pg] inserted ${user.email}`);
  }
}

async function main() {
  console.log(`[dev-sync] mode=${DRY ? 'DRY RUN' : 'WRITE'}`);
  if (!DATABASE_URL && !DRY) {
    throw new Error('Missing CB_DATABASE_URL/BB_DATABASE_URL/DATABASE_URL.');
  }

  let auth = null;
  let firestore = null;
  if (!DRY) {
    initFirebaseAdmin();
    auth = admin.auth();
    firestore = admin.firestore();
  }

  if (auth && firestore) {
    for (const email of DELETE_EMAILS) {
      await deleteFirebaseUserByEmail(auth, firestore, email);
    }
  } else if (DRY) {
    for (const email of DELETE_EMAILS) {
      console.log(`[dev-sync][dry] would delete Firebase user ${email}`);
    }
  }

  let pool = null;
  let columns = new Set();
  if (DATABASE_URL) {
    pool = new Pool(buildPgPoolConfig(DATABASE_URL));
    columns = await getUsersColumns(pool);
    if (!columns.size) {
      throw new Error('users table not found in target database');
    }
    await deletePostgresUsers(pool, DELETE_EMAILS);
  }

  try {
    const uid = auth ? await upsertFirebaseUser(auth, DEV_USER) : 'dry-run-dev-uid';
    if (firestore) {
      await upsertFirestoreProfile(firestore, uid, DEV_USER);
    } else if (DRY) {
      console.log(`[dev-sync][dry] would upsert Firestore profile for ${DEV_USER.email}`);
    }
    if (pool) await upsertPostgresUser(pool, columns, uid, DEV_USER);
  } finally {
    if (pool) await pool.end().catch(() => {});
  }

  console.log(`[dev-sync] done. dev login: ${DEV_USER.email} / ${DEV_USER.password}`);
}

main().catch((error) => {
  console.error('[dev-sync] fatal:', error && error.message ? error.message : String(error));
  process.exit(1);
});