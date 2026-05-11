#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry') || process.argv.includes('-n');

const PRESERVE_EMAILS = Array.from(new Set([
  'dev@communitybridge.app',
  'appreview@communitybridge.app',
  'alphazonelabsllc@gmail.com',
  ...String(process.env.CB_PRESERVE_EMAILS || process.env.BB_PRESERVE_EMAILS || '')
    .split(',')
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean),
]));

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
    const url = new URL(connectionString);
    const host = String(url.hostname || '').toLowerCase();
    const sslParam = String(url.searchParams.get('ssl') || '').toLowerCase();
    const sslMode = String(url.searchParams.get('sslmode') || '').toLowerCase();
    if (host.endsWith('.supabase.co') || host.includes('.pooler.supabase.com') || sslParam === '1' || sslParam === 'true' || sslMode === 'require') {
      cfg.ssl = { rejectUnauthorized: false };
    }
  } catch (_) {}
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
    'communitybridge-26apr'
  ).trim();
}

function initFirebaseAdmin() {
  if (admin.apps && admin.apps.length) return admin.app();
  const projectId = getProjectId();
  return admin.initializeApp(projectId ? { projectId } : undefined);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function listAllAuthUsers(auth) {
  const users = [];
  let nextPageToken = undefined;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    users.push(...(page.users || []));
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return users;
}

async function deleteDocumentRecursive(docRef) {
  const subcollections = await docRef.listCollections().catch(() => []);
  for (const collectionRef of subcollections) {
    const snapshot = await collectionRef.get();
    for (const childDoc of snapshot.docs) {
      await deleteDocumentRecursive(childDoc.ref);
    }
  }
  await docRef.delete().catch(() => {});
}

async function deleteCollectionRecursive(collectionRef) {
  const snapshot = await collectionRef.get();
  for (const doc of snapshot.docs) {
    await deleteDocumentRecursive(doc.ref);
  }
  return snapshot.size;
}

async function cleanupFirestoreProfiles(firestore, preservedEmails, preservedUids) {
  const snapshot = await firestore.collection('users').get();
  let deleted = 0;
  let preserved = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const email = normalizeEmail(data.email);
    const keep = preservedUids.has(doc.id) || (email && preservedEmails.has(email));
    if (keep) {
      preserved += 1;
      continue;
    }
    if (!DRY) {
      await firestore.collection('users').doc(doc.id).delete().catch(() => {});
      await firestore.collection('parents').doc(doc.id).delete().catch(() => {});
      await firestore.collection('directoryLinks').doc(doc.id).delete().catch(() => {});
    }
    deleted += 1;
  }
  return { deleted, preserved, total: snapshot.size };
}

async function cleanupFirebaseAuth(auth, firestore, preservedEmails) {
  const users = await listAllAuthUsers(auth);
  const preservedUids = new Set();
  let deleted = 0;
  let preserved = 0;

  for (const userRecord of users) {
    const email = normalizeEmail(userRecord.email);
    if (email && preservedEmails.has(email)) {
      preservedUids.add(userRecord.uid);
      preserved += 1;
      continue;
    }
    if (!DRY) {
      await firestore.collection('users').doc(userRecord.uid).delete().catch(() => {});
      await firestore.collection('parents').doc(userRecord.uid).delete().catch(() => {});
      await firestore.collection('directoryLinks').doc(userRecord.uid).delete().catch(() => {});
      await auth.deleteUser(userRecord.uid);
    }
    deleted += 1;
  }

  return { deleted, preserved, total: users.length, preservedUids };
}

async function cleanupFirestoreOrganizations(firestore) {
  const collections = ['organizations', 'organizationIntakeSubmissions'];
  const result = {};
  for (const name of collections) {
    const collectionRef = firestore.collection(name);
    const snapshot = await collectionRef.get();
    if (!DRY) {
      await deleteCollectionRecursive(collectionRef);
    }
    result[name] = snapshot.size;
  }
  return result;
}

async function cleanupFirestoreSeedCollections(firestore, preservedEmails, preservedUids) {
  const result = {};

  const keyedCollections = ['parents', 'therapists', 'directoryLinks'];
  for (const name of keyedCollections) {
    const snapshot = await firestore.collection(name).get();
    let deleted = 0;
    let preserved = 0;
    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      const email = normalizeEmail(data.email || data.emailNormalized);
      const keep = preservedUids.has(doc.id) || (email && preservedEmails.has(email));
      if (keep) {
        preserved += 1;
        continue;
      }
      if (!DRY) {
        await firestore.collection(name).doc(doc.id).delete().catch(() => {});
      }
      deleted += 1;
    }
    result[name] = { deleted, preserved, total: snapshot.size };
  }

  const wipeCollections = ['children', 'pushTokens'];
  for (const name of wipeCollections) {
    const collectionRef = firestore.collection(name);
    const snapshot = await collectionRef.get();
    if (!DRY) {
      await deleteCollectionRecursive(collectionRef);
    }
    result[name] = { deleted: snapshot.size, total: snapshot.size };
  }

  const metaDirectoryRef = firestore.collection('meta').doc('directory');
  const metaDirectorySnapshot = await metaDirectoryRef.get().catch(() => null);
  if (!DRY && metaDirectorySnapshot?.exists) {
    await metaDirectoryRef.delete().catch(() => {});
  }
  result.metaDirectory = { deleted: metaDirectorySnapshot?.exists ? 1 : 0 };

  return result;
}

async function cleanupPostgres(pool, preservedEmails) {
  const preserved = Array.from(preservedEmails);
  const client = await pool.connect();
  const stats = {};
  const trackedDeletes = [
    ['directory_children', 'DELETE FROM directory_children'],
    ['directory_parents', 'DELETE FROM directory_parents'],
    ['directory_therapists', 'DELETE FROM directory_therapists'],
    ['aba_supervision', 'DELETE FROM aba_supervision'],
    ['child_aba_assignments', 'DELETE FROM child_aba_assignments'],
    ['org_settings', 'DELETE FROM org_settings'],
    ['posts', 'DELETE FROM posts'],
    ['messages', 'DELETE FROM messages'],
    ['urgent_memos', 'DELETE FROM urgent_memos'],
    ['time_change_proposals', 'DELETE FROM time_change_proposals'],
    ['push_tokens', 'DELETE FROM push_tokens'],
    ['arrival_pings', 'DELETE FROM arrival_pings'],
    ['password_resets', 'DELETE FROM password_resets'],
    ['access_invites', 'DELETE FROM access_invites'],
    ['attendance_records', 'DELETE FROM attendance_records'],
    ['mood_entries', 'DELETE FROM mood_entries'],
    ['therapy_session_events', 'DELETE FROM therapy_session_events'],
    ['therapy_session_summaries', 'DELETE FROM therapy_session_summaries'],
    ['therapy_sessions', 'DELETE FROM therapy_sessions'],
    ['audit_logs', 'DELETE FROM audit_logs'],
  ];

  try {
    if (!DRY) await client.query('BEGIN');

    for (const [label, sql] of trackedDeletes) {
      const result = await client.query(sql).catch(() => ({ rowCount: 0 }));
      stats[label] = Number(result.rowCount || 0);
    }

    const usersDelete = await client.query('DELETE FROM users WHERE lower(email) <> ALL($1::text[])', [preserved]);
    stats.users = Number(usersDelete.rowCount || 0);

    const preservedRows = await client.query('SELECT id, email, role FROM users WHERE lower(email) = ANY($1::text[]) ORDER BY lower(email) ASC', [preserved]);
    stats.preservedUsers = preservedRows.rows || [];

    if (!DRY) await client.query('COMMIT');
  } catch (error) {
    if (!DRY) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return stats;
}

async function main() {
  console.log(`[cleanup] mode=${DRY ? 'DRY RUN' : 'WRITE'} preserve=${PRESERVE_EMAILS.join(', ')}`);

  initFirebaseAdmin();
  const auth = admin.auth();
  const firestore = admin.firestore();

  const authStats = await cleanupFirebaseAuth(auth, firestore, new Set(PRESERVE_EMAILS));
  const profileStats = await cleanupFirestoreProfiles(firestore, new Set(PRESERVE_EMAILS), authStats.preservedUids);
  const orgStats = await cleanupFirestoreOrganizations(firestore);
  const seedCollectionStats = await cleanupFirestoreSeedCollections(firestore, new Set(PRESERVE_EMAILS), authStats.preservedUids);

  let pgStats = null;
  if (DATABASE_URL) {
    const pool = new Pool(buildPgPoolConfig(DATABASE_URL));
    try {
      pgStats = await cleanupPostgres(pool, new Set(PRESERVE_EMAILS));
    } finally {
      await pool.end().catch(() => {});
    }
  } else {
    console.log('[cleanup] skipping Postgres cleanup because no database URL is configured');
  }

  console.log('[cleanup] firebase auth', { total: authStats.total, preserved: authStats.preserved, deleted: authStats.deleted });
  console.log('[cleanup] firestore profiles', profileStats);
  console.log('[cleanup] firestore organizations', orgStats);
  console.log('[cleanup] firestore seed collections', seedCollectionStats);
  if (pgStats) {
    console.log('[cleanup] postgres', pgStats);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[cleanup] FAILED', error && error.message ? error.message : error);
    process.exit(1);
  });
}