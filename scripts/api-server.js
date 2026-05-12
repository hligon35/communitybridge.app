#!/usr/bin/env node

const { spawnSync } = require('child_process');

function parseNodeMajor(version) {
  const match = String(version || '').match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

function getNodeMajorAtPath(nodeExe) {
  try {
    const r = spawnSync(nodeExe, ['-p', 'process.versions.node'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    if (r.status !== 0) return 0;
    return parseNodeMajor(String(r.stdout || '').trim());
  } catch (_) {
    return 0;
  }
}

function reexecWithNvmNode20IfNeeded() {
  if (process.platform !== 'win32') return false;
  if (process.env.BB_NODE_REEXEC === '1') return false;

  const major = parseNodeMajor(process.versions && process.versions.node);
  // This repo targets Node 20.x (see package.json engines). Avoid very new majors.
  if (major === 20) return false;

  const fs = require('fs');
  const path = require('path');
  const candidates = [];

  if (process.env.NVM_SYMLINK) {
    candidates.push(path.join(process.env.NVM_SYMLINK, 'node.exe'));
  }

  candidates.push('C:\\nvm4w\\nodejs\\node.exe');

  if (process.env.NVM_HOME) {
    candidates.push(path.join(process.env.NVM_HOME, 'v20.20.0', 'node.exe'));
    candidates.push(path.join(process.env.NVM_HOME, '20.20.0', 'node.exe'));
  }
  candidates.push('C:\\nvm4w\\v20.20.0\\node.exe');
  candidates.push('C:\\nvm\\v20.20.0\\node.exe');

  const node20Exe = candidates.find((p) => {
    try {
      if (!p || !fs.existsSync(p)) return false;
      return getNodeMajorAtPath(p) === 20;
    } catch (_) {
      return false;
    }
  });

  if (!node20Exe) {
    console.error(
      `\nUnsupported Node.js v${process.versions.node} for local API server in this repo.\n` +
        `Install/use Node 20.x (nvm4w) and re-run: npm run api:server\n`
    );
    process.exit(1);
  }

  const r = spawnSync(node20Exe, [process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, BB_NODE_REEXEC: '1' },
    windowsHide: true,
  });

  process.exit(typeof r.status === 'number' ? r.status : 1);
}

reexecWithNvmNode20IfNeeded();

const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const { captureServerException, initServerSentry } = require('./sentry-node');

initServerSentry({ service: 'api-server-sqlite' });
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { registerFirebaseMfaRoutes } = require('./firebase-mfa-routes');
const { registerOrganizationIntakeRoutes } = require('./organization-intake-routes');
const {
  signApprovalAccessToken: signManagedAccessApprovalToken,
  verifyApprovalAccessToken: verifyManagedAccessApprovalToken,
  assertApprovalLinkInviteIsActive,
  buildInvitePasswordCompletionProfileUpdate,
} = require('./managed-access-auth');
const {
  DEFAULT_SUMMARY_FILENAME,
  buildTherapySessionSummary,
  renderSessionSummaryText,
} = require('./session-summary');

function parseCsvEnv(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getClientIp(req) {
  try {
    const xf = req.headers['x-forwarded-for'];
    const raw = String(Array.isArray(xf) ? xf[0] : xf || '').split(',')[0].trim();
    return raw || (req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '') || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function createInMemoryRateLimiter({ windowMs, max, keyFn }) {
  const hits = new Map();

  return (req, res, next) => {
    try {
      const key = keyFn ? String(keyFn(req) || '').trim() : '';
      if (!key) return next();

      const now = Date.now();
      const prev = hits.get(key);
      if (!prev || now >= prev.resetAt) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }

      prev.count += 1;
      hits.set(key, prev);
      if (prev.count <= max) return next();

      const retryAfterSec = Math.max(1, Math.ceil((prev.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({ ok: false, error: 'Too many requests', retryAfterSec });
    } catch (_) {
      return next();
    }
  };
}

function safeLower(v) {
  try { return String(v || '').trim().toLowerCase(); } catch (_) { return ''; }
}

function loadDotEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const cleaned = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
      const eq = cleaned.indexOf('=');
      if (eq <= 0) continue;

      const key = cleaned.slice(0, eq).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;

      let value = cleaned.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (_) {
    // ignore dotenv parsing errors
  }
}

// Local dev convenience: load env vars without requiring dotenv.
// This enables CB_* (preferred) and BB_* (legacy) env toggles.
loadDotEnvFile(path.resolve(process.cwd(), '.env.local'));
loadDotEnvFile(path.resolve(process.cwd(), '.env'));

function inferFirebaseProjectIdFromEas() {
  try {
    const p = path.resolve(process.cwd(), 'eas.json');
    if (!fs.existsSync(p)) return '';
    const raw = fs.readFileSync(p, 'utf8');
    const eas = JSON.parse(raw);
    const env = eas?.build?.internal?.env || eas?.build?.development?.env || null;
    const projectId = env && env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ? String(env.EXPO_PUBLIC_FIREBASE_PROJECT_ID).trim() : '';
    return projectId;
  } catch (_) {
    return '';
  }
}

// Ensure firebase-admin can verify Firebase ID tokens reliably in local dev.
if (!process.env.CB_FIREBASE_PROJECT_ID && !process.env.BB_FIREBASE_PROJECT_ID) {
  const inferred = inferFirebaseProjectIdFromEas();
  if (inferred) process.env.CB_FIREBASE_PROJECT_ID = inferred;
}
let SqliteDatabase = null;
function getSqliteDatabaseCtor() {
  if (SqliteDatabase) return SqliteDatabase;
  // Lazy require so the server can still boot in environments where
  // better-sqlite3 native bindings are unavailable (e.g. local Node mismatch).
  // eslint-disable-next-line global-require
  SqliteDatabase = require('better-sqlite3');
  return SqliteDatabase;
}
const multer = require('multer');
const { normalizeScopedUser, canManageTargetUser, filterManageableUsers } = require('./admin-scope');
let twilioLib = null;
function getTwilioLib() {
  if (twilioLib) return twilioLib;
  try {
    // Lazy require so the server can still boot even if the dependency
    // is missing in a given deployment image.
    // eslint-disable-next-line global-require
    twilioLib = require('twilio');
    return twilioLib;
  } catch (e) {
    return null;
  }
}

let nodemailerLib = null;
function getNodemailerLib() {
  if (nodemailerLib) return nodemailerLib;
  try {
    // Lazy require so the server can still boot even if the dependency
    // is missing in a given deployment image.
    // eslint-disable-next-line global-require
    nodemailerLib = require('nodemailer');
    return nodemailerLib;
  } catch (e) {
    return null;
  }
}

let firebaseAdminLib = null;

function getFirebaseAdminServiceAccountEnvValue() {
  return safeString(
    process.env.CB_FIREBASE_SERVICE_ACCOUNT_JSON
      || process.env.BB_FIREBASE_SERVICE_ACCOUNT_JSON
      || process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ).trim();
}

function getFirebaseAdminCredential() {
  const raw = getFirebaseAdminServiceAccountEnvValue();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    if (!parsed || !parsed.client_email || !parsed.private_key) return null;
    return require('firebase-admin').credential.cert(parsed);
  } catch (_) {
    return null;
  }
}

function getFirebaseAdmin() {
  if (firebaseAdminLib) return firebaseAdminLib;
  // eslint-disable-next-line global-require
  firebaseAdminLib = require('firebase-admin');
  try {
    if (!firebaseAdminLib.apps || !firebaseAdminLib.apps.length) {
      const projectId = safeString(
        process.env.CB_FIREBASE_PROJECT_ID ||
        process.env.BB_FIREBASE_PROJECT_ID ||
        process.env.FIREBASE_PROJECT_ID ||
        process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        'communitybridge-26apr'
      ).trim();
      const credential = getFirebaseAdminCredential();
      firebaseAdminLib.initializeApp({
        ...(projectId ? { projectId } : {}),
        ...(credential ? { credential } : {}),
      });
    }
  } catch (_) {
    // ignore duplicate initializeApp calls
  }
  return firebaseAdminLib;
}

const PORT = Number(process.env.PORT || 3005);
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.CB_REQUEST_TIMEOUT_MS || process.env.BB_REQUEST_TIMEOUT_MS || 30_000));
const SHUTDOWN_GRACE_MS = Math.max(1_000, Number(process.env.CB_SHUTDOWN_GRACE_MS || process.env.BB_SHUTDOWN_GRACE_MS || 10_000));
const DB_PATH = process.env.CB_DB_PATH || process.env.BB_DB_PATH || path.join(process.cwd(), '.communitybridge', 'communitybridge.sqlite');
const JWT_SECRET = process.env.CB_JWT_SECRET || process.env.BB_JWT_SECRET || '';
const NODE_ENV = String(process.env.NODE_ENV || '').trim().toLowerCase();
const PUBLIC_BASE_URL = (process.env.CB_PUBLIC_BASE_URL || process.env.BB_PUBLIC_BASE_URL || '').trim();

let shuttingDown = false;
let activeServer = null;
const activeSockets = new Set();

function requestUsesHttps(req) {
  try {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '').split(',')[0].trim().toLowerCase();
    return proto === 'https';
  } catch (_) {
    return false;
  }
}

function applySecurityHeaders(req, res) {
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (requestUsesHttps(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (String(req.path || '').startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
}

// CORS
const CORS_ORIGINS = parseCsvEnv(process.env.CB_CORS_ORIGINS || process.env.BB_CORS_ORIGINS);
const DEFAULT_PROD_CORS_ORIGINS = [
  'https://communitybridge.app',
  'https://www.communitybridge.app',
  'https://app.communitybridge.app',
  'https://communitybridge-26apr.web.app',
  'https://communitybridge-26apr.firebaseapp.com',
  'https://communitybridge-app-20260424.web.app',
  'https://communitybridge-app-20260424.firebaseapp.com',
  'https://communitybridge--communitybridge-26apr.us-east5.hosted.app',
];

function buildCorsOptions() {
  const allowList = (CORS_ORIGINS && CORS_ORIGINS.length)
    ? CORS_ORIGINS
    : (NODE_ENV === 'production' ? DEFAULT_PROD_CORS_ORIGINS : []);

  return {
    origin: (origin, cb) => {
      // Native/mobile requests often have no Origin; allow.
      if (!origin) return cb(null, true);
      if (!allowList.length) return cb(null, true);
      const ok = allowList.includes(String(origin));
      return cb(null, ok);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
    maxAge: 86400,
  };
}

// Upload privacy
const REQUIRE_UPLOAD_AUTH = envFlag(
  process.env.CB_REQUIRE_UPLOAD_AUTH || process.env.BB_REQUIRE_UPLOAD_AUTH,
  NODE_ENV === 'production'
);

function signUploadAccessToken(reqPath) {
  if (!JWT_SECRET) return '';
  const p = String(reqPath || '').trim();
  if (!p.startsWith('/uploads/')) return '';
  // Short-lived bearer URL token for <img src="..."> style consumers.
  return jwt.sign({ typ: 'upload', p }, JWT_SECRET, { expiresIn: '1d' });
}

function uploadAccessMiddleware(req, res, next) {
  try {
    if (!REQUIRE_UPLOAD_AUTH) return next();
    if (!JWT_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const reqPath = req.path ? `/uploads${String(req.path).startsWith('/') ? '' : '/'}${String(req.path)}` : (req.originalUrl || req.url || '');

    const header = req.headers.authorization || req.headers.Authorization || '';
    const bearer = String(header).startsWith('Bearer ') ? String(header).slice(7) : '';
    if (bearer) {
      try {
        jwt.verify(bearer, JWT_SECRET);
        return next();
      } catch (_) {
        // fall through to signed URL token
      }
    }

    const t = (req.query && (req.query.t || req.query.token)) ? String(req.query.t || req.query.token).trim() : '';
    if (t) {
      try {
        const payload = jwt.verify(t, JWT_SECRET);
        if (payload && payload.typ === 'upload' && payload.p === reqPath) return next();
      } catch (_) {
        // ignore
      }
    }

    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  } catch (_) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
}

function envFlag(value, defaultValue = false) {
  if (value == null) return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (v === '') return defaultValue;
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
}

const ALLOW_SIGNUP = envFlag(process.env.CB_ALLOW_SIGNUP || process.env.BB_ALLOW_SIGNUP, false);
// IMPORTANT:
// Requiring 2FA on signup by default will hard-fail account creation when email/SMS delivery
// isn't configured (e.g. missing BB_SMTP_URL/BB_EMAIL_FROM). Default to OFF unless explicitly enabled.
const REQUIRE_2FA_ON_SIGNUP = envFlag(process.env.CB_REQUIRE_2FA_ON_SIGNUP || process.env.BB_REQUIRE_2FA_ON_SIGNUP, true);
const DEBUG_2FA_RETURN_CODE = envFlag(process.env.CB_DEBUG_2FA_RETURN_CODE || process.env.BB_DEBUG_2FA_RETURN_CODE, false);
// When enabled, include the underlying delivery failure message in API responses.
// Keep disabled in production by default to avoid leaking implementation details.
const DEBUG_2FA_DELIVERY_ERRORS = envFlag(process.env.CB_DEBUG_2FA_DELIVERY_ERRORS || process.env.BB_DEBUG_2FA_DELIVERY_ERRORS, false);
const LOG_REQUESTS = envFlag(process.env.CB_DEBUG_REQUESTS || process.env.BB_DEBUG_REQUESTS, false);
// When enabled, allow the server to start without a DB (static hosting only).
// This is intended for local debugging and should not be used for real app traffic.
const ALLOW_NO_DB = envFlag(process.env.CB_ALLOW_NO_DB || process.env.BB_ALLOW_NO_DB, false);

// 2FA delivery toggles
// Default: email enabled, SMS disabled.
const ENABLE_EMAIL_2FA = envFlag(process.env.CB_ENABLE_EMAIL_2FA || process.env.BB_ENABLE_EMAIL_2FA, true);
const ENABLE_SMS_2FA = envFlag(process.env.CB_ENABLE_SMS_2FA || process.env.BB_ENABLE_SMS_2FA, false);

// 2FA delivery (SMS only).
// Configure Twilio in production/TestFlight:
// - BB_TWILIO_ACCOUNT_SID
// - BB_TWILIO_AUTH_TOKEN
// - BB_TWILIO_FROM (E.164, e.g. +15551234567) OR BB_TWILIO_MESSAGING_SERVICE_SID
const TWILIO_ACCOUNT_SID = (process.env.CB_TWILIO_ACCOUNT_SID || process.env.BB_TWILIO_ACCOUNT_SID || '').trim();
const TWILIO_AUTH_TOKEN = (process.env.CB_TWILIO_AUTH_TOKEN || process.env.BB_TWILIO_AUTH_TOKEN || '').trim();
const TWILIO_FROM = (process.env.CB_TWILIO_FROM || process.env.BB_TWILIO_FROM || '').trim();
const TWILIO_MESSAGING_SERVICE_SID = (process.env.CB_TWILIO_MESSAGING_SERVICE_SID || process.env.BB_TWILIO_MESSAGING_SERVICE_SID || '').trim();

// 2FA delivery (Email)
// Configure SMTP:
// - CB_SMTP_URL / BB_SMTP_URL (e.g. smtp://user:pass@smtp.example.com:587)
// - CB_EMAIL_FROM / BB_EMAIL_FROM (e.g. CommunityBridge <no-reply@example.com>)
const SMTP_URL = (process.env.CB_SMTP_URL || process.env.BB_SMTP_URL || '').trim();
const EMAIL_FROM = (process.env.CB_EMAIL_FROM || process.env.BB_EMAIL_FROM || '').trim();
const EMAIL_2FA_SUBJECT = (process.env.CB_EMAIL_2FA_SUBJECT || process.env.BB_EMAIL_2FA_SUBJECT || 'CommunityBridge verification code').trim();
const EMAIL_PASSWORD_RESET_SUBJECT = (process.env.CB_EMAIL_PASSWORD_RESET_SUBJECT || process.env.BB_EMAIL_PASSWORD_RESET_SUBJECT || 'CommunityBridge password reset').trim();
const EMAIL_STAFF_INVITE_SUBJECT = (process.env.CB_EMAIL_STAFF_INVITE_SUBJECT || process.env.BB_EMAIL_STAFF_INVITE_SUBJECT || 'CommunityBridge staff invite').trim();
const EMAIL_ONBOARDING_APPROVAL_SUBJECT = (process.env.CB_EMAIL_ONBOARDING_APPROVAL_SUBJECT || process.env.BB_EMAIL_ONBOARDING_APPROVAL_SUBJECT || 'CommunityBridge organization approval').trim();
const ACCESS_CODE_TTL_HOURS = Math.max(1, Number(process.env.CB_ACCESS_CODE_TTL_HOURS || process.env.BB_ACCESS_CODE_TTL_HOURS || 72));
const APPROVAL_LINK_TTL_HOURS = Math.max(1, Number(process.env.CB_APPROVAL_LINK_TTL_HOURS || process.env.BB_APPROVAL_LINK_TTL_HOURS || 72));

const RETURN_PASSWORD_RESET_CODE = envFlag(process.env.CB_RETURN_PASSWORD_RESET_CODE || process.env.BB_RETURN_PASSWORD_RESET_CODE, false);
const PASSWORD_RESET_TTL_MINUTES = Math.max(5, Number(process.env.CB_PASSWORD_RESET_TTL_MINUTES || process.env.BB_PASSWORD_RESET_TTL_MINUTES || 30));

const slog = require('./logger');

function twilioEnabled() {
  if (!ENABLE_SMS_2FA) return false;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return false;
  if (TWILIO_MESSAGING_SERVICE_SID) return true;
  return !!TWILIO_FROM;
}

function emailEnabled() {
  if (!ENABLE_EMAIL_2FA) return false;
  return !!(SMTP_URL && EMAIL_FROM);
}

let twilioClient = null;
function getTwilioClient() {
  if (!twilioEnabled()) return null;
  if (twilioClient) return twilioClient;
  const twilio = getTwilioLib();
  if (!twilio) {
    throw new Error("Missing dependency 'twilio' in this server build. Install server dependencies (npm ci) so the twilio package is included.");
  }
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return twilioClient;
}

function normalizeE164Phone(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (/^\d{10}$/.test(cleaned)) return `+1${cleaned}`;
  if (/^1\d{10}$/.test(cleaned)) return `+${cleaned}`;
  if (!cleaned.startsWith('+')) return '';
  const digits = cleaned.slice(1).replace(/\D/g, '');
  const out = `+${digits}`;
  if (!/^\+\d{10,15}$/.test(out)) return '';
  return out;
}

async function send2faCodeSms({ to, code }) {
  const client = getTwilioClient();
  if (!client) {
    throw new Error('2FA SMS delivery is not configured (set BB_TWILIO_ACCOUNT_SID/BB_TWILIO_AUTH_TOKEN and BB_TWILIO_FROM or BB_TWILIO_MESSAGING_SERVICE_SID)');
  }

  const body = `CommunityBridge verification code: ${code}. Expires in 5 minutes.`;
  const msg = {
    to,
    body,
  };
  if (TWILIO_MESSAGING_SERVICE_SID) msg.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID;
  else msg.from = TWILIO_FROM;

  await client.messages.create(msg);
}

let emailTransporter = null;
function getEmailTransporter() {
  if (!emailEnabled()) return null;
  if (emailTransporter) return emailTransporter;
  const nodemailer = getNodemailerLib();
  if (!nodemailer) {
    throw new Error("Missing dependency 'nodemailer' in this server build. Install server dependencies (npm ci) so the nodemailer package is included.");
  }
  emailTransporter = nodemailer.createTransport(SMTP_URL);
  return emailTransporter;
}

function normalizeEmail(input) {
  const v = String(input || '').trim().toLowerCase();
  if (!v) return '';
  // Minimal sanity check; avoid strict RFC parsing.
  if (!/^\S+@\S+\.[^\s@]+$/.test(v)) return '';
  return v;
}

function validatePasswordPolicy(password) {
  const raw = String(password || '');
  if (raw.length < 8) return 'password must be at least 8 characters';
  if (!/[A-Z]/.test(raw)) return 'password must include at least 1 uppercase letter';
  if (!/[^A-Za-z0-9]/.test(raw)) return 'password must include at least 1 special character';
  return '';
}

function generateBootstrapPassword() {
  return `Bb!${Date.now()}Z${Math.random().toString(36).slice(2, 12)}9`;
}

function hasValidEntityId(value) {
  const id = safeString(value).trim();
  return Boolean(id && id.length <= 128);
}

function validateDirectoryMergePayload(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const buckets = [
    ['children', Array.isArray(payload.children) ? payload.children : []],
    ['parents', Array.isArray(payload.parents) ? payload.parents : []],
    ['therapists', Array.isArray(payload.therapists) ? payload.therapists : []],
  ];
  for (const [label, items] of buckets) {
    if (items.length > 1000) return `${label} exceeds the 1000 item limit`;
    for (const item of items) {
      if (!item || typeof item !== 'object') return `${label} entries must be objects`;
      if (!hasValidEntityId(item.id)) return `${label} entries require a valid id`;
    }
  }
  return '';
}

async function send2faCodeEmail({ to, code }) {
  const destination = normalizeEmail(to);
  if (!destination) throw new Error('Invalid email destination');

  const transporter = getEmailTransporter();
  if (!transporter) {
    throw new Error('2FA email delivery is not configured (set CB_SMTP_URL/BB_SMTP_URL and CB_EMAIL_FROM/BB_EMAIL_FROM, and ensure CB_ENABLE_EMAIL_2FA/BB_ENABLE_EMAIL_2FA=1)');
  }

  const text = `CommunityBridge verification code: ${code}. Expires in 5 minutes.`;
  await transporter.sendMail({
    from: EMAIL_FROM,
    to: destination,
    subject: EMAIL_2FA_SUBJECT,
    text,
  });
}

async function deliver2faCode({ method, destination, code }) {
  const m = String(method || '').trim().toLowerCase();
  if (m === 'sms') {
    if (!ENABLE_SMS_2FA) throw new Error('SMS 2FA is disabled');
    return send2faCodeSms({ to: destination, code });
  }
  if (m === 'email') {
    if (!ENABLE_EMAIL_2FA) throw new Error('Email 2FA is disabled');
    return send2faCodeEmail({ to: destination, code });
  }
  throw new Error('Unsupported 2FA method');
}

// Ephemeral 2FA challenges for dev/testing.
// NOTE: This is in-memory and resets when the server restarts.
const twoFaChallenges = new Map();

const TWOFA_CODE_TTL_MS = 5 * 60 * 1000;
const TWOFA_RESEND_COOLDOWN_MS = 5 * 60 * 1000;

function nanoIdShort() {
  // nanoId() exists in this file; keep challenge IDs short/unique.
  // Avoid external deps to keep scripts self-contained.
  return `ch_${nanoId().slice(-10)}`;
}

function maskDest(method, value) {
  const v = String(value || '');
  if (!v) return '';
  if (method === 'sms') {
    const last = v.replace(/\D/g, '').slice(-4);
    return last ? `***-***-${last}` : '***';
  }
  // email
  const at = v.indexOf('@');
  if (at <= 1) return '***';
  return `${v[0]}***${v.slice(at)}`;
}

function maskEmail(email) {
  const v = String(email || '').trim().toLowerCase();
  const at = v.indexOf('@');
  if (at <= 1) return '***';
  return `${v[0]}***${v.slice(at)}`;
}

function newOtpCode() {
  // 6-digit numeric code.
  return String(Math.floor(100000 + Math.random() * 900000));
}

function create2faChallenge({ userId, method, destination }) {
  const challengeId = nanoIdShort();
  const code = newOtpCode();
  const now = Date.now();
  const expiresAt = now + TWOFA_CODE_TTL_MS;
  twoFaChallenges.set(challengeId, { userId, method, destination, code, expiresAt, attempts: 0, lastSentAt: now });
  return { challengeId, code, expiresAt };
}

function resend2faChallenge(challengeId) {
  const ch = twoFaChallenges.get(challengeId);
  if (!ch) return { ok: false, status: 404, error: 'invalid challenge' };

  const now = Date.now();
  const last = Number(ch.lastSentAt || 0);
  const waitMs = (last + TWOFA_RESEND_COOLDOWN_MS) - now;
  if (waitMs > 0) {
    return {
      ok: false,
      status: 429,
      error: 'Too many requests; please wait before requesting another code',
      retryAfterSec: Math.ceil(waitMs / 1000),
    };
  }

  ch.code = newOtpCode();
  ch.expiresAt = now + TWOFA_CODE_TTL_MS;
  ch.attempts = 0;
  ch.lastSentAt = now;
  twoFaChallenges.set(challengeId, ch);
  return { ok: true, challengeId, code: ch.code, expiresAt: ch.expiresAt, method: ch.method, destination: ch.destination };
}

function consume2faChallenge(challengeId, code) {
  const ch = twoFaChallenges.get(challengeId);
  if (!ch) return { ok: false, error: 'invalid challenge' };
  if (Date.now() > ch.expiresAt) {
    twoFaChallenges.delete(challengeId);
    return { ok: false, error: 'challenge expired' };
  }
  ch.attempts += 1;
  if (ch.attempts > 10) {
    twoFaChallenges.delete(challengeId);
    return { ok: false, error: 'too many attempts' };
  }
  if (String(code || '').trim() !== String(ch.code)) {
    return { ok: false, error: 'invalid code' };
  }
  twoFaChallenges.delete(challengeId);
  return { ok: true, userId: ch.userId, method: ch.method };
}
// Dev compatibility: allow the mobile app's __DEV__ auto-login token.
// Default: enabled outside production, disabled in production.
const ALLOW_DEV_TOKEN = envFlag(process.env.CB_ALLOW_DEV_TOKEN || process.env.BB_ALLOW_DEV_TOKEN, NODE_ENV !== 'production');
if (NODE_ENV === 'production' && ALLOW_DEV_TOKEN) {
  throw new Error('CB_ALLOW_DEV_TOKEN/BB_ALLOW_DEV_TOKEN must be disabled in production.');
}

const ADMIN_EMAIL = process.env.CB_ADMIN_EMAIL || process.env.BB_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.CB_ADMIN_PASSWORD || process.env.BB_ADMIN_PASSWORD || '';
const ADMIN_NAME = process.env.CB_ADMIN_NAME || process.env.BB_ADMIN_NAME || 'Admin';
const RESERVED_SUPER_ADMIN_EMAILS = new Set([
  String(ADMIN_EMAIL || '').trim().toLowerCase(),
  'alphazonelabsllc@gmail.com',
].filter(Boolean));

function isReservedSuperAdminEmail(email) {
  return RESERVED_SUPER_ADMIN_EMAILS.has(String(email || '').trim().toLowerCase());
}

function applyReservedSuperAdminRole(user) {
  const item = user && typeof user === 'object' ? { ...user } : {};
  if (!isReservedSuperAdminEmail(item.email)) return item;
  return {
    ...item,
    role: 'superAdmin',
  };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function nowISO() {
  return new Date().toISOString();
}

function nanoId() {
  // simple, dependency-free id
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

ensureDir(path.dirname(DB_PATH));
let db = null;
let dbInitError = null;
try {
  const DatabaseCtor = getSqliteDatabaseCtor();
  db = new DatabaseCtor(DB_PATH);
} catch (e) {
  db = null;
  dbInitError = e || new Error('SQLite initialization failed');
  const msg = String(dbInitError && dbInitError.message ? dbInitError.message : dbInitError || '');
  const isBindingsMissing =
    /could not locate the bindings file/i.test(msg) ||
    /better_sqlite3\.node/i.test(msg) ||
    /node-v\d+-win32-x64/i.test(msg);
  const allowAutoNoDb = NODE_ENV !== 'production' && isBindingsMissing;

  if (!ALLOW_NO_DB && !allowAutoNoDb) throw dbInitError;
  try {
    console.warn(
      '[api] SQLite unavailable; continuing without DB ' +
        (ALLOW_NO_DB
          ? 'because CB_ALLOW_NO_DB=1 or BB_ALLOW_NO_DB=1'
          : '(auto-fallback for local dev)')
    );
    console.warn('[api] SQLite error:', msg || '(unknown)');
    if (allowAutoNoDb) {
      console.warn(`[api] Node ${process.versions.node} detected. This repo expects Node 20.x (see package.json engines).`);
      console.warn('[api] Fix options:');
      console.warn('  - Use Node 20.x, then reinstall deps (npm install)');
      console.warn('  - OR set BB_DATABASE_URL to use Postgres (start-server will switch to api-server-pg.js)');
      console.warn('  - OR set BB_ALLOW_NO_DB=1 to force this mode explicitly');
    }
  } catch (_) {}
}

async function shutdownServer(signal) {

app.get('/api/audit-logs', authMiddleware, requireAdmin, (req, res) => {
  const rawLimit = Number(req.query?.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, Math.floor(rawLimit))) : 25;
  try {
    const rows = db.prepare(
      'SELECT id, actor_id, action, target_type, target_id, status, details_json, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
    const items = (rows || []).map((row) => {
      let details = {};
      if (row.details_json) {
        try { details = JSON.parse(String(row.details_json)); } catch (_) { details = {}; }
      }
      return {
        id: row.id,
        actorId: row.actor_id || '',
        action: row.action || '',
        targetType: row.target_type || '',
        targetId: row.target_id || '',
        status: row.status || 'success',
        details,
        createdAt: row.created_at || nowISO(),
      };
    });
    if (isSuperAdminRole(req.user?.role)) {
      return res.json({
        ok: true,
        mode: 'superAdminRaw',
        items: items.map((item) => ({
          id: item.id,
          action: item.action,
          targetType: item.targetType,
          targetId: item.targetId,
          status: item.status,
          createdAt: item.createdAt,
        })),
      });
    }
    return res.json({ ok: true, items });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    console.log(`[api] ${signal} received; draining connections...`);
  } catch (_) {}

  const deadline = setTimeout(() => {
    for (const socket of activeSockets) {
      try {
        socket.destroy();
      } catch (_) {
        // ignore
      }
    }
  }, SHUTDOWN_GRACE_MS);

  try {
    if (activeServer) {
      await new Promise((resolve) => activeServer.close(resolve));
    }
    if (db && typeof db.close === 'function') {
      db.close();
    }
    process.exit(0);
  } catch (e) {
    try {
      console.error('[api] Graceful shutdown failed', e);
    } catch (_) {}
    process.exit(1);
  } finally {
    clearTimeout(deadline);
  }
}

const UPLOAD_DIR = process.env.CB_UPLOAD_DIR || process.env.BB_UPLOAD_DIR
  ? String(process.env.CB_UPLOAD_DIR || process.env.BB_UPLOAD_DIR)
  : path.join(path.dirname(DB_PATH), 'uploads');

ensureDir(UPLOAD_DIR);

if (db) {
  db.pragma('journal_mode = WAL');

  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  phone TEXT,
  address TEXT,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directory_children (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directory_parents (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directory_therapists (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Normalized ABA relationships (derived from directory JSON).
CREATE TABLE IF NOT EXISTS aba_supervision (
  aba_id TEXT PRIMARY KEY,
  bcba_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS child_aba_assignments (
  child_id TEXT NOT NULL,
  session TEXT NOT NULL,
  aba_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (child_id, session)
);

CREATE TABLE IF NOT EXISTS org_settings (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions_config (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_json TEXT,
  title TEXT,
  body TEXT,
  image TEXT,
  likes INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  comments_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  body TEXT NOT NULL,
  sender_json TEXT,
  to_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS urgent_memos (
  id TEXT PRIMARY KEY,
  type TEXT,
  status TEXT,
  proposer_id TEXT,
  actor_role TEXT,
  child_id TEXT,
  title TEXT,
  body TEXT,
  note TEXT,
  meta_json TEXT,
  memo_json TEXT,
  responded_at TEXT,
  ack INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS time_change_proposals (
  id TEXT PRIMARY KEY,
  child_id TEXT,
  type TEXT,
  proposed_iso TEXT,
  note TEXT,
  proposer_id TEXT,
  action TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT,
  platform TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  preferences_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS arrival_pings (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  role TEXT,
  child_id TEXT,
  lat REAL,
  lng REAL,
  event_id TEXT,
  when_iso TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS access_invites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  invite_type TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  organization_id TEXT,
  source_submission_id TEXT,
  sent_at TEXT,
  resent_at TEXT,
  expires_at TEXT,
  first_login_at TEXT,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_email_status TEXT,
  last_email_error TEXT
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  recorded_for TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  actor_id TEXT,
  actor_role TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(child_id, recorded_for)
);

CREATE TABLE IF NOT EXISTS mood_entries (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  note TEXT,
  actor_id TEXT,
  actor_role TEXT,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS therapy_sessions (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  child_name TEXT,
  therapist_id TEXT NOT NULL,
  therapist_role TEXT,
  organization_id TEXT,
  program_id TEXT,
  campus_id TEXT,
  session_date TEXT NOT NULL,
  session_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  summary_generated_at TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS therapy_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  therapist_id TEXT,
  event_type TEXT NOT NULL,
  event_code TEXT NOT NULL,
  label TEXT,
  value_json TEXT,
  intensity TEXT,
  frequency_delta INTEGER,
  metadata_json TEXT,
  occurred_at TEXT NOT NULL,
  source TEXT,
  client_event_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS therapy_session_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  child_id TEXT NOT NULL,
  therapist_id TEXT,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  summary_json TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  status TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);
`);
}

try {
  db.exec('CREATE INDEX IF NOT EXISTS aba_supervision_bcba_idx ON aba_supervision (bcba_id)');
  db.exec('CREATE INDEX IF NOT EXISTS child_aba_assignments_aba_idx ON child_aba_assignments (aba_id)');
  db.exec('CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets (user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS access_invites_user_id_idx ON access_invites (user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS access_invites_email_idx ON access_invites (email)');
  db.exec('CREATE INDEX IF NOT EXISTS access_invites_status_idx ON access_invites (used_at, revoked_at, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS attendance_records_child_id_idx ON attendance_records (child_id)');
  db.exec('CREATE INDEX IF NOT EXISTS attendance_records_recorded_for_idx ON attendance_records (recorded_for)');
  db.exec('CREATE INDEX IF NOT EXISTS mood_entries_child_id_idx ON mood_entries (child_id)');
  db.exec('CREATE INDEX IF NOT EXISTS mood_entries_recorded_at_idx ON mood_entries (recorded_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS therapy_sessions_child_id_idx ON therapy_sessions (child_id)');
  db.exec('CREATE INDEX IF NOT EXISTS therapy_sessions_status_idx ON therapy_sessions (status)');
  db.exec('CREATE INDEX IF NOT EXISTS therapy_session_events_session_id_idx ON therapy_session_events (session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS therapy_session_events_child_id_idx ON therapy_session_events (child_id)');
  db.exec('CREATE INDEX IF NOT EXISTS therapy_session_summaries_child_id_idx ON therapy_session_summaries (child_id)');
} catch (_) {
  // ignore
}

function passwordResetEmailConfigured() {
  return !!(SMTP_URL && EMAIL_FROM);
}

function inviteEmailConfigured() {
  return !!(SMTP_URL && EMAIL_FROM);
}

function hashInviteAccessCode(code) {
  const raw = String(code || '');
  return crypto.createHash('sha256').update(`invite:${raw}:${JWT_SECRET}`).digest('hex');
}

function generateInviteAccessCode() {
  // Six numeric digits keep the first-login path simple on mobile while still being one-time use.
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function signApprovalAccessToken(payload) {
  return signManagedAccessApprovalToken({ jwtSecret: JWT_SECRET, payload });
}

function verifyApprovalAccessToken(token) {
  return verifyManagedAccessApprovalToken({ token, jwtSecret: JWT_SECRET });
}

async function buildManagedAccessLoginAuthResponse(userRow, inviteRow) {
  try {
    const customToken = await getFirebaseAdmin().auth().createCustomToken(String(userRow.id), { role: String(userRow.role || inviteRow.role || '') });
    return { authMode: 'firebase-custom-token', customToken, apiToken: '' };
  } catch (error) {
    if (!ALLOW_DEV_TOKEN || !JWT_SECRET) throw error;
    return {
      authMode: 'local-api-session',
      customToken: '',
      apiToken: jwt.sign({ sub: String(userRow.id) }, JWT_SECRET, { expiresIn: '10m' }),
    };
  }
}

function buildInviteLoginUrl(req) {
  return buildPublicUrl(req, '/login');
}

function buildApprovalAccessUrl(req, approvalAccessToken) {
  // /login is the only supported app entrypoint in this project.
  // Route the one-time token there so the existing LoginScreen can
  // create the limited session and hand off to password setup.
  const url = new URL(buildPublicUrl(req, '/login'));
  url.searchParams.set('token', String(approvalAccessToken || ''));
  return url.toString();
}

let passwordResetTransporter = null;
function getPasswordResetEmailTransporter() {
  if (!passwordResetEmailConfigured()) return null;
  if (passwordResetTransporter) return passwordResetTransporter;
  const nodemailer = getNodemailerLib();
  if (!nodemailer) {
    throw new Error("Missing dependency 'nodemailer' in this server build. Install server dependencies (npm ci) so the nodemailer package is included.");
  }
  passwordResetTransporter = nodemailer.createTransport(SMTP_URL);
  return passwordResetTransporter;
}

function hashResetCode(code) {
  const raw = String(code || '');
  return crypto.createHash('sha256').update(`${raw}:${JWT_SECRET}`).digest('hex');
}

function generateResetCode() {
  // 12 hex chars (~48 bits). Short enough to type; large enough to avoid guessing.
  return crypto.randomBytes(6).toString('hex');
}

async function sendPasswordResetEmail({ to, code }) {
  const destination = normalizeEmail(to);
  if (!destination) throw new Error('Invalid email destination');

  const transporter = getPasswordResetEmailTransporter();
  if (!transporter) {
    throw new Error('Password reset email delivery is not configured (set CB_SMTP_URL/BB_SMTP_URL and CB_EMAIL_FROM/BB_EMAIL_FROM)');
  }

  const text = `CommunityBridge password reset code: ${code}.\n\nEnter this code in the app to set a new password.\n\nThis code expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.`;
  await transporter.sendMail({
    from: EMAIL_FROM,
    to: destination,
    subject: EMAIL_PASSWORD_RESET_SUBJECT,
    text,
  });
}

function escapeInviteHtml(value) {
  return safeString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeManagedInviteRole(role) {
  const value = safeString(role).trim().toLowerCase();
  if (!value) return 'faculty';
  if (value === 'office personnel' || value === 'office_personnel' || value === 'officepersonnel') return 'faculty';
  if (value === 'aba tech' || value === 'aba_tech' || value === 'abatech') return 'therapist';
  if (value === 'organizationadmin' || value === 'org_admin') return 'orgAdmin';
  if (value === 'super_admin') return 'superAdmin';
  if (value === 'campus_admin') return 'campusAdmin';
  return safeString(role).trim();
}

function getManagedInviteRoleLabel(role) {
  const value = safeString(normalizeManagedInviteRole(role)).trim().toLowerCase();
  if (value === 'bcba') return 'BCBA';
  if (value === 'faculty' || value === 'staff') return 'Office Personnel';
  if (value === 'therapist') return 'ABA Tech';
  if (value === 'orgadmin') return 'Org Admin';
  if (value === 'superadmin') return 'Super Admin';
  if (value === 'campusadmin') return 'Campus Admin';
  if (value === 'admin') return 'Admin';
  return safeString(role).trim() || 'Staff';
}

function getInviteTypeLabel(inviteType) {
  const value = safeString(inviteType).trim().toLowerCase();
  if (value === 'onboarding_primary_contact') return 'organization approval';
  return 'staff invite';
}

function getStrongPasswordPolicyError(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(value)) return 'Password must include at least 1 uppercase letter.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must include at least 1 special character.';
  return '';
}

function buildAccessInviteEmailContent({ email, role, accessCode, loginUrl, inviteType }) {
  const roleLabel = getManagedInviteRoleLabel(role);
  const intro = inviteType === 'onboarding_primary_contact'
    ? 'Your organization has been approved. You are the Super Admin for this organization.'
    : 'An administrator created your CommunityBridge staff invite.';
  const subject = inviteType === 'onboarding_primary_contact'
    ? EMAIL_ONBOARDING_APPROVAL_SUBJECT
    : EMAIL_STAFF_INVITE_SUBJECT;
  const text = [
    intro,
    '',
    `Email on file: ${email}`,
    `Assigned role: ${roleLabel}`,
    `Access code: ${accessCode}`,
    `Login: ${loginUrl}`,
    '',
    'Enter the access code once, then create a new password to finish activation.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbeafe;border-radius:20px;padding:24px;">
      <p style="margin:0 0 12px;color:#1d4ed8;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;">${escapeInviteHtml(getInviteTypeLabel(inviteType))}</p>
      <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;">${escapeInviteHtml(intro)}</h1>
      <p style="margin:0 0 12px;color:#475569;line-height:1.7;">Use the details below to complete your first login.</p>
      <div style="border:1px solid #e2e8f0;border-radius:16px;padding:16px;background:#f8fafc;">
        <p style="margin:0 0 8px;"><strong>Email on file:</strong> ${escapeInviteHtml(email)}</p>
        <p style="margin:0 0 8px;"><strong>Assigned role:</strong> ${escapeInviteHtml(roleLabel)}</p>
        <p style="margin:0 0 8px;"><strong>Access code:</strong> <span style="font-size:24px;font-weight:800;letter-spacing:0.22em;">${escapeInviteHtml(accessCode)}</span></p>
        <p style="margin:0;"><strong>Login:</strong> <a href="${escapeInviteHtml(loginUrl)}">${escapeInviteHtml(loginUrl)}</a></p>
      </div>
      <p style="margin:16px 0 0;color:#475569;line-height:1.7;">Enter the access code once, then create a new password to finish activation.</p>
    </div>
  </body>
</html>`;
  return { subject, text, html };
}

async function sendAccessInviteEmail({ req, to, role, accessCode, inviteType }) {
  const destination = normalizeEmail(to);
  if (!destination) throw new Error('Invalid email destination');
  const transporter = getPasswordResetEmailTransporter();
  if (!transporter || !inviteEmailConfigured()) {
    throw new Error('Invite email delivery is not configured (set CB_SMTP_URL/BB_SMTP_URL and CB_EMAIL_FROM/BB_EMAIL_FROM)');
  }
  const { subject, text, html } = buildAccessInviteEmailContent({
    email: destination,
    role,
    accessCode,
    loginUrl: buildInviteLoginUrl(req),
    inviteType,
  });
  await transporter.sendMail({
    from: EMAIL_FROM,
    to: destination,
    subject,
    text,
    html,
  });
}

function isAdminRole(role) {
  const r = safeString(role).trim().toLowerCase();
  return r === 'admin'
    || r === 'administrator'
    || r === 'orgadmin'
    || r === 'org_admin'
    || r === 'organizationadmin'
    || r === 'superadmin'
    || r === 'super_admin';
}

function isSuperAdminRole(role) {
  const r = safeString(role).trim().toLowerCase();
  return r === 'superadmin' || r === 'super_admin';
}

function isRestrictedSignupRole(role) {
  return isAdminRole(role);
}

function defaultPermissionsConfig() {
  return {
    Admin: {
      'users:manage': true,
      'children:edit': true,
      'messages:send': true,
      'settings:system': true,
      'export:data': true,
    },
    Office: {
      'users:manage': true,
      'children:edit': true,
      'messages:send': true,
      'settings:system': true,
      'export:data': true,
    },
    BCBA: {
      'users:manage': false,
      'children:edit': true,
      'messages:send': true,
      'settings:system': false,
      'export:data': false,
    },
    Therapist: {
      'users:manage': false,
      'children:edit': true,
      'messages:send': true,
      'settings:system': false,
      'export:data': false,
    },
    Parent: {
      'users:manage': false,
      'children:edit': false,
      'messages:send': true,
      'settings:system': false,
      'export:data': false,
    },
    'Super Admin': {
      'users:manage': false,
      'children:edit': false,
      'messages:send': false,
      'settings:system': false,
      'export:data': false,
    },
  };
}

function normalizePermissionsConfigValue(value) {
  const input = value && typeof value === 'object' ? value : {};
  const defaults = defaultPermissionsConfig();
  return {
    Admin: { ...defaults.Admin, ...(input.Admin || {}) },
    Office: { ...defaults.Office, ...(input.Office || input.Admin || {}) },
    BCBA: { ...defaults.BCBA, ...(input.BCBA || input.Therapist || {}) },
    Therapist: { ...defaults.Therapist, ...(input.Therapist || input.Teacher || input.Staff || {}) },
    Parent: { ...defaults.Parent, ...(input.Parent || {}) },
    'Super Admin': { ...defaults['Super Admin'], ...(input['Super Admin'] || {}) },
  };
}

function getPermissionsConfigRow() {
  const row = db.prepare('SELECT data_json FROM permissions_config WHERE id = ?').get('default');
  if (!row || !row.data_json) return null;
  try { return normalizePermissionsConfigValue(JSON.parse(String(row.data_json))); } catch (_) { return null; }
}

function permissionRoleKey(role) {
  const r = safeString(role).trim().toLowerCase();
  if (r === 'superadmin' || r === 'super_admin') return 'Super Admin';
  if (r === 'admin' || r === 'administrator' || r === 'orgadmin' || r === 'org_admin' || r === 'organizationadmin') return 'Admin';
  if (r === 'office' || r === 'officeadmin' || r === 'office admin' || r === 'office-admin' || r === 'office_admin' || r === 'reception' || r === 'receptionist' || r === 'frontdesk' || r === 'front desk' || r === 'front-desk' || r === 'front_desk' || r === 'campusadmin' || r === 'campus_admin') return 'Office';
  if (r === 'bcba') return 'BCBA';
  if (r.includes('therapist') || r.includes('teacher') || r.includes('faculty') || r === 'staff') return 'Therapist';
  if (r.includes('parent')) return 'Parent';
  return 'Therapist';
}

function roleHasCapability(role, config, capability) {
  const key = permissionRoleKey(role);
  const caps = config && typeof config === 'object' ? config[key] : null;
  return Boolean(caps && caps[capability]);
}

function ensurePermissionsConfigSeeded() {
  const existing = getPermissionsConfigRow();
  if (existing) return existing;
  const now = nowISO();
  const config = defaultPermissionsConfig();
  db.prepare(
    'INSERT INTO permissions_config (id, data_json, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING'
  ).run('default', JSON.stringify(config), now, now);
  return config;
}

function requireAdmin(req, res, next) {
  try {
    if (req.user && isAdminRole(req.user.role)) return next();
  } catch (e) {}
  return res.status(403).json({ ok: false, error: 'admin required' });
}

function requireSuperAdmin(req, res, next) {
  try {
    if (req.user && isSuperAdminRole(req.user.role)) return next();
  } catch (e) {}
  return res.status(403).json({ ok: false, error: 'super admin required' });
}

function requirePermissionEditor(req, res, next) {
  try {
    const role = safeString(req.user?.role).trim().toLowerCase();
    if (role === 'admin' || role === 'administrator' || role === 'orgadmin' || role === 'org_admin' || role === 'organizationadmin') return next();
  } catch (e) {}
  return res.status(403).json({ ok: false, error: 'admin required to edit role permissions' });
}

function sanitizeDirectoryRecordForSuperAdmin(record, entityType) {
  const item = record && typeof record === 'object' ? record : {};
  const linkedStudentIds = Array.isArray(item.linkedStudentIds) ? item.linkedStudentIds.map(String).filter(Boolean) : [];
  const campusIds = Array.isArray(item.campusIds) ? item.campusIds.map(String).filter(Boolean) : [];
  const programIds = Array.isArray(item.programIds || item.branchIds) ? (item.programIds || item.branchIds).map(String).filter(Boolean) : [];
  return {
    id: safeString(item.id || item.uid),
    entityType,
    role: safeString(item.role),
    organizationId: safeString(item.organizationId),
    programIds,
    campusIds,
    linkedStudentCount: linkedStudentIds.length,
    active: item.active !== false,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

function buildSuperAdminDirectoryPayload({ children, parents, therapists, aba }) {
  const safeChildren = (Array.isArray(children) ? children : []).map((item) => sanitizeDirectoryRecordForSuperAdmin(item, 'child'));
  const safeParents = (Array.isArray(parents) ? parents : []).map((item) => sanitizeDirectoryRecordForSuperAdmin(item, 'parent'));
  const safeTherapists = (Array.isArray(therapists) ? therapists : []).map((item) => sanitizeDirectoryRecordForSuperAdmin(item, 'staff'));
  return {
    ok: true,
    mode: 'superAdminRaw',
    summary: {
      children: safeChildren.length,
      parents: safeParents.length,
      staff: safeTherapists.length,
      assignments: Array.isArray(aba?.assignments) ? aba.assignments.length : 0,
      supervisionLinks: Array.isArray(aba?.supervision) ? aba.supervision.length : 0,
    },
    children: safeChildren,
    parents: safeParents,
    therapists: safeTherapists,
    aba: {
      assignments: Array.isArray(aba?.assignments) ? aba.assignments.map((item) => ({ childId: safeString(item?.childId), session: safeString(item?.session), abaId: safeString(item?.abaId) })) : [],
      supervision: Array.isArray(aba?.supervision) ? aba.supervision.map((item) => ({ abaId: safeString(item?.abaId), bcbaId: safeString(item?.bcbaId) })) : [],
    },
  };
}

function requireCapability(capability) {
  return (req, res, next) => {
    try {
      const config = ensurePermissionsConfigSeeded();
      if (roleHasCapability(req.user?.role, config, capability)) return next();
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
    return res.status(403).json({ ok: false, error: `${capability} capability required` });
  };
}

function ensureUserProfileColumns() {
  if (!db) return;
  try {
    const cols = db.prepare("PRAGMA table_info('users')").all();
    const names = new Set((cols || []).map((c) => String(c.name || '').toLowerCase()));

    if (!names.has('avatar')) {
      db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
    }
    if (!names.has('phone')) {
      db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
    }
    if (!names.has('address')) {
      db.exec('ALTER TABLE users ADD COLUMN address TEXT');
    }
  } catch (e) {
    console.warn('[api] users table migration failed:', e && e.message ? e.message : String(e));
  }
}

ensureUserProfileColumns();

function ensureUserEmailCaseInsensitiveUniqueness() {
  if (!db) return;
  try {
    // If duplicates already exist (older DBs), creating a unique index will fail.
    const dups = db
      .prepare("SELECT lower(email) AS email_lc, COUNT(*) AS c FROM users GROUP BY lower(email) HAVING c > 1")
      .all();
    if (Array.isArray(dups) && dups.length) {
      slog.warn('db', 'Duplicate user emails detected; cannot enforce case-insensitive uniqueness until cleaned up', { duplicates: dups.length });
      return;
    }

    // Enforce case-insensitive uniqueness going forward.
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email_nocase_idx ON users(email COLLATE NOCASE)");
  } catch (e) {
    slog.warn('db', 'users email NOCASE uniqueness index skipped', { message: e?.message || String(e) });
  }
}

ensureUserEmailCaseInsensitiveUniqueness();

// Lightweight migrations for older databases.
if (db) {
  try {
    const cols = db.prepare("PRAGMA table_info('urgent_memos')").all().map((c) => String(c.name));
    const ensureCol = (name, ddl) => { if (!cols.includes(name)) db.exec(ddl); };
    ensureCol('memo_json', "ALTER TABLE urgent_memos ADD COLUMN memo_json TEXT");
    ensureCol('status', "ALTER TABLE urgent_memos ADD COLUMN status TEXT");
    ensureCol('responded_at', "ALTER TABLE urgent_memos ADD COLUMN responded_at TEXT");
  } catch (e) {
    slog.warn('db', 'urgent_memos migration skipped', { message: e?.message || String(e) });
  }
}

function safeJsonParse(text, fallback) {
  try {
    if (!text) return fallback;
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

function normalizeSession(value) {
  const s = safeString(value).trim().toUpperCase();
  if (s === 'AM' || s === 'PM') return s;
  return null;
}

function normalizeId(value) {
  const s = safeString(value).trim();
  return s || null;
}

function deriveChildAbaAssignments(child) {
  try {
    const childId = normalizeId(child && child.id);
    if (!childId) return [];

    const rawAssigned = (child && (child.assignedABA || child.assigned_ABA || child.assigned)) || [];
    const assignedArr = Array.isArray(rawAssigned) ? rawAssigned : [rawAssigned];
    const assigned = assignedArr
      .map((x) => normalizeId(x))
      .filter(Boolean);

    if (!assigned.length) return [];

    const sess = normalizeSession(child && child.session);

    if (assigned.length === 1) {
      if (sess) return [{ childId, session: sess, abaId: assigned[0] }];
      return [{ childId, session: 'AM', abaId: assigned[0] }];
    }

    if (sess === 'AM') {
      return [
        { childId, session: 'AM', abaId: assigned[0] },
        { childId, session: 'PM', abaId: assigned[1] },
      ];
    }
    if (sess === 'PM') {
      return [
        { childId, session: 'PM', abaId: assigned[0] },
        { childId, session: 'AM', abaId: assigned[1] },
      ];
    }
    return [
      { childId, session: 'AM', abaId: assigned[0] },
      { childId, session: 'PM', abaId: assigned[1] },
    ];
  } catch (_) {
    return [];
  }
}

function rebuildAbaRelationshipsFromDirectorySqlite(now) {
  const therapistRows = db.prepare('SELECT data_json FROM directory_therapists').all();
  const therapists = (therapistRows || [])
    .map((r) => safeJsonParse(String(r && r.data_json ? r.data_json : ''), null))
    .filter(Boolean);

  const supervision = new Map();
  for (const t of therapists) {
    const abaId = normalizeId(t && t.id);
    const bcbaId = normalizeId(t && (t.supervisedBy || t.supervised_by));
    if (abaId && bcbaId) supervision.set(abaId, bcbaId);
  }

  const childRows = db.prepare('SELECT data_json FROM directory_children').all();
  const children = (childRows || [])
    .map((r) => safeJsonParse(String(r && r.data_json ? r.data_json : ''), null))
    .filter(Boolean);

  const assignments = new Map();
  for (const c of children) {
    const pairs = deriveChildAbaAssignments(c);
    for (const p of pairs) assignments.set(`${p.childId}|${p.session}`, p);
  }

  db.prepare('DELETE FROM child_aba_assignments').run();
  db.prepare('DELETE FROM aba_supervision').run();

  const upsertSupervision = db.prepare(
    'INSERT INTO aba_supervision (aba_id, bcba_id, created_at, updated_at) VALUES (?,?,?,?)\n' +
    'ON CONFLICT(aba_id) DO UPDATE SET bcba_id=excluded.bcba_id, updated_at=excluded.updated_at'
  );
  const upsertAssignment = db.prepare(
    'INSERT INTO child_aba_assignments (child_id, session, aba_id, created_at, updated_at) VALUES (?,?,?,?,?)\n' +
    'ON CONFLICT(child_id, session) DO UPDATE SET aba_id=excluded.aba_id, updated_at=excluded.updated_at'
  );

  for (const [abaId, bcbaId] of supervision.entries()) {
    upsertSupervision.run(abaId, bcbaId, now, now);
  }
  for (const p of assignments.values()) {
    upsertAssignment.run(p.childId, p.session, p.abaId, now, now);
  }

  return { supervision: supervision.size, assignments: assignments.size };
}

// Best-effort: keep ABA relationship tables in sync at startup.
try {
  rebuildAbaRelationshipsFromDirectorySqlite(nowISO());
} catch (_) {
  // ignore
}

function shouldMirrorManagedUserToStaffDirectory(role) {
  const normalized = safeString(normalizeManagedInviteRole(role)).trim().toLowerCase();
  return Boolean(normalized && normalized !== 'parent');
}

function buildManagedUserStaffDirectoryRecord(userRow, existingRecord) {
  const existing = existingRecord && typeof existingRecord === 'object' ? existingRecord : {};
  const nextName = safeString(userRow?.name).trim() || safeString(existing.name).trim() || safeString(userRow?.email).trim();
  const nextEmail = normalizeEmail(userRow?.email) || normalizeEmail(existing.email);
  return {
    ...existing,
    id: safeString(userRow?.id).trim(),
    name: nextName,
    email: nextEmail,
    avatar: safeString(userRow?.avatar).trim() || safeString(existing.avatar).trim(),
    phone: safeString(userRow?.phone).trim() || safeString(existing.phone).trim(),
    address: safeString(userRow?.address).trim() || safeString(existing.address).trim(),
    role: safeString(userRow?.role).trim() || safeString(existing.role).trim(),
  };
}

function syncManagedUserStaffDirectorySqlite(userId) {
  const uid = safeString(userId).trim();
  if (!uid) return null;

  const now = nowISO();
  const existingRow = db.prepare('SELECT data_json, created_at FROM directory_therapists WHERE id = ?').get(uid) || null;
  const userRow = db.prepare('SELECT id,email,name,avatar,phone,address,role FROM users WHERE id = ?').get(uid) || null;

  if (!userRow || !shouldMirrorManagedUserToStaffDirectory(userRow.role)) {
    if (existingRow) {
      db.prepare('DELETE FROM directory_therapists WHERE id = ?').run(uid);
      rebuildAbaRelationshipsFromDirectorySqlite(now);
    }
    return null;
  }

  const existingRecord = safeJsonParse(String(existingRow?.data_json || ''), null);
  const nextRecord = buildManagedUserStaffDirectoryRecord(userRow, existingRecord);
  db.prepare(
    'INSERT INTO directory_therapists (id, data_json, created_at, updated_at) VALUES (?,?,?,?)\n' +
    'ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at'
  ).run(uid, JSON.stringify(nextRecord), existingRow?.created_at || now, now);
  rebuildAbaRelationshipsFromDirectorySqlite(now);
  return nextRecord;
}

function roleLower(u) {
  try { return String(u && u.role ? u.role : '').trim().toLowerCase(); } catch (_) { return ''; }
}

function isAdminUser(u) {
  const r = roleLower(u);
  return r === 'admin' || r === 'administrator';
}

function safeString(v) {
  try {
    if (v == null) return '';
    return String(v);
  } catch (_) {
    return '';
  }
}

async function syncFirebaseManagedUser(userId, nextFields = {}) {
  const admin = getFirebaseAdmin();
  const auth = admin.auth();
  const firestore = admin.firestore();
  const uid = String(userId || '').trim();
  const userRecord = await auth.getUser(uid);
  const update = {};

  if (nextFields.email !== undefined) update.email = String(nextFields.email || '').trim().toLowerCase();
  if (nextFields.name !== undefined) update.displayName = String(nextFields.name || '').trim();
  if (nextFields.password !== undefined) update.password = String(nextFields.password || '');
  if (Object.keys(update).length) await auth.updateUser(uid, update);

  if (nextFields.role !== undefined) {
    const currentClaims = userRecord.customClaims || {};
    await auth.setCustomUserClaims(uid, { ...currentClaims, role: String(nextFields.role).trim() });
  }

  const profileUpdate = {
    id: uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (nextFields.email !== undefined) profileUpdate.email = String(nextFields.email || '').trim().toLowerCase();
  if (nextFields.name !== undefined) profileUpdate.name = String(nextFields.name || '').trim();
  if (nextFields.role !== undefined) profileUpdate.role = String(nextFields.role).trim();
  if (nextFields.organizationId !== undefined) profileUpdate.organizationId = safeString(nextFields.organizationId).trim();
  if (nextFields.programIds !== undefined) profileUpdate.programIds = normalizeManagedIdList(nextFields.programIds);
  if (nextFields.campusIds !== undefined) profileUpdate.campusIds = normalizeManagedIdList(nextFields.campusIds);
  if (nextFields.memberships !== undefined) profileUpdate.memberships = Array.isArray(nextFields.memberships) ? nextFields.memberships.filter((item) => item && typeof item === 'object') : [];
  await firestore.collection('users').doc(uid).set(profileUpdate, { merge: true });
}

async function deleteFirebaseManagedUser(userId) {
  const admin = getFirebaseAdmin();
  const auth = admin.auth();
  const firestore = admin.firestore();
  const uid = String(userId || '').trim();
  if (!uid) return;

  await firestore.collection('users').doc(uid).delete().catch(() => {});
  await firestore.collection('parents').doc(uid).delete().catch(() => {});
  await firestore.collection('directoryLinks').doc(uid).delete().catch(() => {});
  await auth.deleteUser(uid);
}

function normalizeManagedIdList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => safeString(value).trim())
    .filter(Boolean)));
}

async function getFirebaseManagedProfiles(userIds) {
  const ids = normalizeManagedIdList(userIds);
  if (!ids.length) return new Map();
  const admin = getFirebaseAdmin();
  const firestore = admin.firestore();
  const refs = ids.map((id) => firestore.collection('users').doc(id));
  const snaps = await Promise.all(refs.map((ref) => ref.get().catch(() => null)));
  const out = new Map();
  snaps.forEach((snap, index) => {
    if (!snap || !snap.exists) return;
    const data = snap.data() || {};
    out.set(ids[index], {
      organizationId: safeString(data.organizationId).trim(),
      programIds: normalizeManagedIdList(data.programIds || data.branchIds),
      campusIds: normalizeManagedIdList(data.campusIds),
      memberships: Array.isArray(data.memberships) ? data.memberships.filter((item) => item && typeof item === 'object') : [],
    });
  });
  return out;
}

function serializeAccessInviteRow(row) {
  if (!row) return null;
  const status = row.used_at
    ? 'used'
    : row.revoked_at
      ? 'revoked'
      : row.first_login_at
        ? 'started'
        : 'sent';
  return {
    id: String(row.id || ''),
    userId: String(row.user_id || ''),
    email: String(row.email || ''),
    role: String(row.role || ''),
    inviteType: String(row.invite_type || 'staff'),
    organizationId: String(row.organization_id || ''),
    sourceSubmissionId: String(row.source_submission_id || ''),
    status,
    sentAt: row.sent_at || row.created_at || null,
    resentAt: row.resent_at || null,
    expiresAt: row.expires_at || null,
    firstLoginAt: row.first_login_at || null,
    usedAt: row.used_at || null,
    revokedAt: row.revoked_at || null,
    lastEmailStatus: String(row.last_email_status || ''),
    lastEmailError: String(row.last_email_error || ''),
  };
}

function getLatestAccessInviteRowForUser(userId) {
  const uid = safeString(userId).trim();
  if (!uid || !db) return null;
  return db.prepare('SELECT * FROM access_invites WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(uid) || null;
}

function getLatestAccessInviteRows(userIds) {
  const ids = normalizeManagedIdList(userIds);
  const out = new Map();
  ids.forEach((userId) => {
    const row = getLatestAccessInviteRowForUser(userId);
    if (row) out.set(userId, serializeAccessInviteRow(row));
  });
  return out;
}

async function ensureFirebaseManagedUserForInvite(userId, nextFields = {}) {
  const admin = getFirebaseAdmin();
  const auth = admin.auth();
  const firestore = admin.firestore();
  const uid = safeString(userId).trim();
  if (!uid) throw new Error('userId required');

  let userRecord = null;
  let created = false;
  try {
    userRecord = await auth.getUser(uid);
  } catch (error) {
    const code = safeString(error?.code).toLowerCase();
    if (!code.includes('user-not-found')) throw error;
  }

  if (!userRecord) {
    // Mirror the production path: keep a random bootstrap password in Firebase and
    // let the 6-digit code authenticate only through the invite exchange endpoint.
    userRecord = await auth.createUser({
      uid,
      email: safeString(nextFields.email).trim().toLowerCase(),
      displayName: safeString(nextFields.name).trim() || safeString(nextFields.email).trim().toLowerCase(),
      password: generateBootstrapPassword(),
    });
    created = true;
  } else {
    await auth.updateUser(uid, {
      email: safeString(nextFields.email).trim().toLowerCase(),
      displayName: safeString(nextFields.name).trim() || safeString(nextFields.email).trim().toLowerCase(),
    });
  }

  await syncFirebaseManagedUser(uid, {
    email: nextFields.email,
    name: nextFields.name,
    role: nextFields.role,
    organizationId: nextFields.organizationId,
    programIds: nextFields.programIds,
    campusIds: nextFields.campusIds,
    memberships: nextFields.memberships,
  });

  // Keep the first-login requirement on the shared profile document so the app can gate the navigator.
  await firestore.collection('users').doc(uid).set({
    id: uid,
    email: safeString(nextFields.email).trim().toLowerCase(),
    name: safeString(nextFields.name).trim(),
    role: safeString(nextFields.role).trim(),
    organizationId: safeString(nextFields.organizationId).trim(),
    programIds: normalizeManagedIdList(nextFields.programIds),
    campusIds: normalizeManagedIdList(nextFields.campusIds),
    memberships: Array.isArray(nextFields.memberships) ? nextFields.memberships.filter((item) => item && typeof item === 'object') : [],
    passwordSetupRequired: true,
    inviteType: safeString(nextFields.inviteType).trim() || 'staff',
    inviteStatus: 'sent',
    inviteSentAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { userRecord, created };
}

async function createOrRefreshManagedAccessInvite({
  req,
  email,
  role,
  name,
  phone,
  address,
  organizationId,
  programIds,
  campusIds,
  memberships,
  inviteType,
  sourceSubmissionId,
  userId,
  sendEmail = true,
  returnAccessCode = false,
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = normalizeManagedInviteRole(role);
  if (!normalizedEmail) throw new Error('Valid email required');
  if (!normalizedRole) throw new Error('Role required');

  let localUser = null;
  if (userId) {
    localUser = db.prepare('SELECT * FROM users WHERE id = ?').get(String(userId).trim()) || null;
  }
  if (!localUser) {
    localUser = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(normalizedEmail) || null;
  }

  let firebaseUser = null;
  try {
    firebaseUser = await getFirebaseAdmin().auth().getUserByEmail(normalizedEmail);
  } catch (error) {
    const code = safeString(error?.code).toLowerCase();
    if (!code.includes('user-not-found')) throw error;
  }

  const managedUserId = safeString(localUser?.id).trim() || safeString(firebaseUser?.uid).trim() || nanoId();
  const now = nowISO();
  const accessCode = generateInviteAccessCode();
  const accessCodeExpiresAt = new Date(Date.now() + (ACCESS_CODE_TTL_HOURS * 60 * 60 * 1000)).toISOString();
  const resolvedName = safeString(name).trim() || safeString(localUser?.name).trim() || safeString(firebaseUser?.displayName).trim() || normalizedEmail;
  const resolvedPhone = safeString(phone).trim() || safeString(localUser?.phone).trim();
  const resolvedAddress = safeString(address).trim() || safeString(localUser?.address).trim();
  const passwordHash = localUser?.password_hash || bcrypt.hashSync(generateBootstrapPassword(), 12);

  if (localUser) {
    db.prepare('UPDATE users SET email = ?, name = ?, phone = ?, address = ?, role = ?, updated_at = ? WHERE id = ?')
      .run(normalizedEmail, resolvedName, resolvedPhone, resolvedAddress, normalizedRole, now, managedUserId);
  } else {
    db.prepare('INSERT INTO users (id,email,password_hash,name,phone,address,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(managedUserId, normalizedEmail, passwordHash, resolvedName, resolvedPhone, resolvedAddress, normalizedRole, now, now);
  }

  await ensureFirebaseManagedUserForInvite(managedUserId, {
    email: normalizedEmail,
    name: resolvedName,
    role: normalizedRole,
    organizationId: safeString(organizationId).trim(),
    programIds: normalizeManagedIdList(programIds),
    campusIds: normalizeManagedIdList(campusIds),
    memberships: Array.isArray(memberships) ? memberships : [],
    inviteType,
  });

  const inviteId = nanoId();
  const resolvedInviteType = safeString(inviteType).trim() || 'staff';
  const approvalAccessToken = signApprovalAccessToken({
    inviteId,
    userId: managedUserId,
    email: normalizedEmail,
    organizationId: safeString(organizationId).trim(),
    exp: Date.now() + (APPROVAL_LINK_TTL_HOURS * 60 * 60 * 1000),
  });
  const delivery = {
    accessCode,
    inviteType: resolvedInviteType,
    loginUrl: buildInviteLoginUrl(req),
    approvalLink: buildApprovalAccessUrl(req, approvalAccessToken),
    role: normalizedRole,
    email: normalizedEmail,
  };
  db.prepare('UPDATE access_invites SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL').run(now, now, managedUserId);
  db.prepare('INSERT INTO access_invites (id, user_id, email, role, invite_type, code_hash, organization_id, source_submission_id, sent_at, expires_at, created_at, updated_at, last_email_status, last_email_error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      inviteId,
      managedUserId,
      normalizedEmail,
      normalizedRole,
      resolvedInviteType,
      hashInviteAccessCode(accessCode),
      safeString(organizationId).trim(),
      safeString(sourceSubmissionId).trim(),
      now,
      accessCodeExpiresAt,
      now,
      now,
      sendEmail ? 'pending' : 'shared-via-approval',
      ''
    );

  if (sendEmail) {
    try {
      await sendAccessInviteEmail({ req, to: normalizedEmail, role: normalizedRole, accessCode, inviteType: resolvedInviteType });
      db.prepare('UPDATE access_invites SET last_email_status = ?, sent_at = ?, updated_at = ? WHERE id = ?').run('sent', now, now, inviteId);
    } catch (error) {
      db.prepare('UPDATE access_invites SET last_email_status = ?, last_email_error = ?, updated_at = ? WHERE id = ?').run('failed', safeString(error?.message || error).slice(0, 200), now, inviteId);
      throw error;
    }
  }

  const row = db.prepare('SELECT id,email,name,avatar,phone,address,role,created_at,updated_at FROM users WHERE id = ?').get(managedUserId);
  const firebaseProfiles = await getFirebaseManagedProfiles([managedUserId]).catch(() => new Map());
  const latestInvite = getLatestAccessInviteRowForUser(managedUserId);
  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      avatar: row.avatar || '',
      phone: row.phone || '',
      address: row.address || '',
      role: row.role,
      organizationId: firebaseProfiles.get(managedUserId)?.organizationId || '',
      programIds: firebaseProfiles.get(managedUserId)?.programIds || [],
      campusIds: firebaseProfiles.get(managedUserId)?.campusIds || [],
      memberships: firebaseProfiles.get(managedUserId)?.memberships || [],
      invite: serializeAccessInviteRow(latestInvite),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    invite: serializeAccessInviteRow(latestInvite),
    delivery: returnAccessCode ? delivery : null,
  };
}

async function markInviteLoginStarted(userId, inviteId) {
  const admin = getFirebaseAdmin();
  const now = nowISO();
  const row = db.prepare('SELECT * FROM access_invites WHERE id = ? AND user_id = ? AND first_login_at IS NULL AND used_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR datetime(expires_at) > datetime(\'now\'))').get(String(inviteId || '').trim(), String(userId || '').trim());
  if (!row) throw new Error('invalid or expired access code');
  db.prepare('UPDATE access_invites SET first_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, String(inviteId || '').trim());
  await admin.firestore().collection('users').doc(String(userId || '').trim()).set({
    passwordSetupRequired: true,
    inviteStatus: 'started',
    inviteFirstLoginAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function completeManagedInvitePasswordSetup(userId, inviteId, newPassword) {
  const policyError = getStrongPasswordPolicyError(newPassword);
  if (policyError) throw new Error(policyError);
  const uid = safeString(userId).trim();
  const iid = safeString(inviteId).trim();
  if (!uid || !iid) throw new Error('invite session is incomplete');
  const now = nowISO();
  const inviteRow = db.prepare('SELECT * FROM access_invites WHERE id = ? AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL').get(iid, uid);
  if (!inviteRow) throw new Error('invite access code is no longer active');

  await getFirebaseAdmin().auth().updateUser(uid, { password: String(newPassword || '') });
  const hash = bcrypt.hashSync(String(newPassword || ''), 12);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, now, uid);
  db.prepare('UPDATE access_invites SET first_login_at = COALESCE(first_login_at, ?), used_at = ?, updated_at = ? WHERE id = ?').run(now, now, now, iid);
  await getFirebaseAdmin().firestore().collection('users').doc(uid).set(
    buildInvitePasswordCompletionProfileUpdate(getFirebaseAdmin().firestore.FieldValue.serverTimestamp()),
    { merge: true }
  );
  syncManagedUserStaffDirectorySqlite(uid);
}

function hasExpoPushToken(token) {
  const t = safeString(token).trim();
  return t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[');
}

function pushPrefAllows(preferences, kind) {
  // Preferences are opt-in toggles stored by the mobile Settings screen.
  // If preferences are missing/empty, default to allowing pushes.
  if (!preferences || typeof preferences !== 'object') return true;
  const keys = Object.keys(preferences);
  if (!keys.length) return true;
  if (kind === 'chats') return Boolean(preferences.chats ?? true);
  if (kind === 'updates' || kind === 'other') return Boolean(preferences.updates ?? preferences.other ?? true);
  // fallback
  return true;
}

function buildScheduleChangePushNotification(change = {}) {
  const type = safeString(change?.type).trim().toLowerCase();
  const note = safeString(change?.note).trim();

  if (type === 'cancel' || type === 'canceled' || type === 'cancelled' || note.toLowerCase().includes('cancel')) {
    return {
      title: 'Cancellation request',
      body: 'A child schedule cancellation needs review.',
      dataKind: 'schedule_cancellation',
    };
  }

  const label = type === 'dropoff' ? 'drop-off' : 'pickup';
  return {
    title: 'Schedule change request',
    body: `A ${label} change needs review.`,
    dataKind: 'schedule_change',
  };
}

async function notifyAdminsOfScheduleCancellation(child = {}, { childId, session, cancellationReason, canceledByName, canceledAt } = {}) {
  try {
    const adminRows = db.prepare("SELECT id FROM users WHERE lower(role) IN ('admin', 'administrator')").all();
    const recipientIds = Array.from(new Set(adminRows.map((row) => safeString(row.id).trim()).filter(Boolean)));
    if (!recipientIds.length) return;

    const tokens = [];
    recipientIds.forEach((uid) => {
      const rows = db.prepare('SELECT token, preferences FROM push_tokens WHERE user_id = ? AND enabled = 1').all(uid);
      rows.forEach((row) => {
        const token = safeString(row.token).trim();
        if (!token) return;
        let preferences = {};
        try {
          preferences = row.preferences ? JSON.parse(row.preferences) : {};
        } catch (_) {
          preferences = {};
        }
        if (!pushPrefAllows(preferences, 'updates')) return;
        tokens.push(token);
      });
    });

    if (!tokens.length) return;
    const learnerName = safeString(child?.name).trim() || 'A learner';
    const sessionLabel = safeString(session).trim() || safeString(child?.session).trim() || 'scheduled';
    const actorLabel = safeString(canceledByName).trim() || 'A parent';
    const reason = safeString(cancellationReason).trim();
    await sendExpoPush(tokens, {
      title: 'Session canceled',
      body: `${actorLabel} canceled ${learnerName}'s ${sessionLabel} session${reason ? `: ${reason}` : '.'}`,
      data: {
        kind: 'schedule_cancellation',
        childId: safeString(childId).trim() || null,
        session: sessionLabel || null,
        canceledAt: safeString(canceledAt).trim() || null,
      },
    });
  } catch (_) {
    // ignore push failures
  }
}

async function sendExpoPush(tokens, { title, body, data } = {}) {
  try {
    if (!Array.isArray(tokens) || !tokens.length) return { ok: true, skipped: true, reason: 'no-tokens' };
    if (typeof fetch !== 'function') {
      console.warn('[api] fetch() not available; skipping push send');
      return { ok: false, skipped: true, reason: 'no-fetch' };
    }

    const unique = Array.from(new Set(tokens.map((t) => safeString(t).trim()))).filter(hasExpoPushToken);
    if (!unique.length) return { ok: true, skipped: true, reason: 'no-valid-tokens' };

    const messages = unique.map((to) => ({
      to,
      title: safeString(title || 'CommunityBridge'),
      body: safeString(body || ''),
      data: (data && typeof data === 'object') ? data : {},
      sound: 'default',
      channelId: 'communitybridge-alerts-v2',
      priority: 'high',
      badge: 1,
    }));

    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    const json = await resp.json().catch(() => null);

    if (!resp.ok) {
      captureServerException(new Error(`Expo push send failed with status ${resp.status}`), {
        area: 'notifications',
        action: 'expo_push_send',
        status: resp.status,
        tokenCount: unique.length,
        kind: safeString(data?.kind).trim() || 'unknown',
        hasMemoId: Boolean(data?.memoId),
        hasThreadId: Boolean(data?.threadId),
        expoResponse: json,
      });
    }

    // Best-effort cleanup for invalid/unregistered tokens.
    // Expo returns tickets in the same order as the messages array.
    try {
      const tickets = json && Array.isArray(json.data) ? json.data : null;
      if (resp.ok && tickets && tickets.length === messages.length) {
        const tokensToDelete = [];
        const ticketErrors = [];
        for (let i = 0; i < tickets.length; i += 1) {
          if (tickets[i]?.status === 'error') {
            ticketErrors.push({
              code: safeString(tickets[i]?.details?.error || tickets[i]?.message).trim(),
              index: i,
            });
          }
          if (shouldDeleteTokenForExpoError(tickets[i])) tokensToDelete.push(messages[i].to);
        }
        if (ticketErrors.length) {
          captureServerException(new Error('Expo push ticket errors'), {
            area: 'notifications',
            action: 'expo_push_tickets',
            tokenCount: unique.length,
            kind: safeString(data?.kind).trim() || 'unknown',
            ticketErrors,
          });
        }
        const deleted = deletePushTokens(tokensToDelete);
        if (deleted) console.log(`[api] push cleanup: deleted ${deleted} invalid token(s)`);
      }
    } catch (_) {
      // ignore cleanup failures
    }

    return { ok: resp.ok, status: resp.status, expo: json };
  } catch (e) {
    captureServerException(e, {
      area: 'notifications',
      action: 'expo_push_send',
      tokenCount: Array.isArray(tokens) ? tokens.length : 0,
      kind: safeString(data?.kind).trim() || 'unknown',
      hasMemoId: Boolean(data?.memoId),
      hasThreadId: Boolean(data?.threadId),
    });
    console.warn('[api] push send failed', e && e.message ? e.message : String(e));
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function getAdminUserIds() {
  try {
    const rows = db.prepare('SELECT id, role FROM users').all();
    const ids = [];
    for (const r of rows) {
      const role = safeString(r.role).trim().toLowerCase();
      if (isAdminRole(role)) ids.push(String(r.id));
    }
    // Dev convenience: allow dev-token users to receive admin pushes.
    ids.push('dev');
    return Array.from(new Set(ids.filter(Boolean)));
  } catch (_) {
    return ['dev'];
  }
}

function recordAuditLog({ actorId, action, targetType, targetId, status = 'success', details = {} } = {}) {
  try {
    db.prepare(
      'INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, status, details_json, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(nanoId(), actorId ? String(actorId) : null, String(action || 'unknown'), targetType ? String(targetType) : null, targetId ? String(targetId) : null, String(status || 'success'), JSON.stringify(details || {}), nowISO());
  } catch (_) {
    // ignore audit failures
  }
}

function getPushTokensForUsers(userIds, { kind } = {}) {
  try {
    if (!Array.isArray(userIds) || !userIds.length) return [];
    const placeholders = userIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT token, enabled, preferences_json FROM push_tokens WHERE enabled = 1 AND user_id IN (${placeholders})`
    ).all(...userIds.map(String));

    const out = [];
    for (const row of rows) {
      const token = safeString(row.token).trim();
      if (!token) continue;
      const prefs = safeJsonParse(row.preferences_json, {});
      if (kind && !pushPrefAllows(prefs, kind)) continue;
      out.push(token);
    }
    return Array.from(new Set(out));
  } catch (_) {
    return [];
  }
}

function deletePushTokens(tokens) {
  try {
    if (!Array.isArray(tokens) || !tokens.length) return 0;
    const unique = Array.from(new Set(tokens.map((t) => safeString(t).trim()))).filter(Boolean);
    if (!unique.length) return 0;
    const placeholders = unique.map(() => '?').join(',');
    const info = db.prepare(`DELETE FROM push_tokens WHERE token IN (${placeholders})`).run(...unique);
    return Number(info && typeof info.changes === 'number' ? info.changes : 0);
  } catch (_) {
    return 0;
  }
}

function shouldDeleteTokenForExpoError(expoTicket) {
  // Expo ticket format: { status: 'error', message, details: { error: 'DeviceNotRegistered' | ... } }
  try {
    if (!expoTicket || expoTicket.status !== 'error') return false;
    const details = expoTicket.details && typeof expoTicket.details === 'object' ? expoTicket.details : {};
    const code = safeString(details.error).trim();
    // Only delete for terminal token problems.
    return code === 'DeviceNotRegistered' || code === 'InvalidExpoPushToken';
  } catch (_) {
    return false;
  }
}

function normalizeRecipients(input) {
  if (!Array.isArray(input)) return [];
  const ids = [];
  for (const item of input) {
    if (!item) continue;
    if (typeof item === 'string' || typeof item === 'number') ids.push(String(item));
    else if (typeof item === 'object' && item.id != null) ids.push(String(item.id));
  }
  return Array.from(new Set(ids.filter(Boolean)));
}

function inferThreadRecipientIds(threadId, currentUserId) {
  const threadKey = safeString(threadId).trim();
  const actorId = safeString(currentUserId).trim();
  if (!threadKey || !actorId) return [];

  const rows = db.prepare('SELECT sender_json, to_json FROM messages WHERE thread_id = ? ORDER BY datetime(created_at) ASC').all(threadKey);
  const inferred = [];

  for (const row of rows) {
    let sender = row?.sender_json;
    if (typeof sender === 'string') {
      try {
        sender = JSON.parse(sender);
      } catch (_) {
        sender = null;
      }
    }
    const senderId = safeString(sender?.id).trim();
    if (senderId && senderId !== actorId) inferred.push(senderId);

    let recipients = row?.to_json;
    if (typeof recipients === 'string') {
      try {
        recipients = JSON.parse(recipients);
      } catch (_) {
        recipients = [];
      }
    }
    normalizeRecipients(recipients).forEach((id) => {
      if (id && id !== actorId) inferred.push(id);
    });
  }

  return Array.from(new Set(inferred));
}

function normalizeRoleTargets(input) {
  if (!Array.isArray(input)) return [];
  const roles = [];
  for (const item of input) {
    if (!item) continue;
    roles.push(String(item).trim().toLowerCase());
  }
  return Array.from(new Set(roles.filter(Boolean)));
}

function messageVisibleToUser(user, message) {
  if (!user || !message) return false;
  if (isAdminRole(user.role)) return true;

  const userId = safeString(user.id).trim();
  if (!userId) return false;

  const senderId = safeString(message.sender_json?.id || message.sender?.id).trim();
  if (senderId && senderId === userId) return true;

  const recipientIds = normalizeRecipients(message.to_json || message.to || []);
  if (recipientIds.includes(userId)) return true;

  const roles = normalizeRoleTargets(message.to_roles || message.toRoles || []);
  return roles.includes(roleLower(user));
}

function memoVisibleToUser(user, row) {
  if (!user || !row) return false;
  if (isAdminRole(user.role)) return true;

  const userId = safeString(user.id).trim();
  if (!userId) return false;

  const memo = safeJsonParse(row.memo_json, {});
  const proposerId = safeString(row.proposer_id || memo.proposerId || memo.proposerUid).trim();
  if (proposerId && proposerId === userId) return true;

  const recipientIds = normalizeRecipients(memo.recipients);
  return recipientIds.includes(userId);
}

function proposalVisibleToUser(user, row) {
  if (!user || !row) return false;
  if (isAdminRole(user.role)) return true;
  const userId = safeString(user.id).trim();
  return !!userId && userId === safeString(row.proposer_id || row.proposerId || row.proposerUid).trim();
}

function userToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar || '',
    phone: row.phone || '',
    address: row.address || '',
    role: row.role,
  };
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function requireJwtConfigured() {
  if (!JWT_SECRET) {
    console.warn('[api] Missing BB_JWT_SECRET. Set this in server environment for production.');
  }
}

requireJwtConfigured();

// Seed admin user if configured
try {
  if (db && ADMIN_EMAIL && ADMIN_PASSWORD) {
    const normalizedAdminEmail = String(ADMIN_EMAIL).trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(normalizedAdminEmail);
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
    const t = nowISO();
    if (!existing) {
      const id = nanoId();
      db.prepare('INSERT INTO users (id,email,password_hash,name,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, normalizedAdminEmail, hash, ADMIN_NAME, 'superAdmin', t, t);
      console.log('[api] Seeded admin user:', normalizedAdminEmail);
    } else {
      db.prepare('UPDATE users SET password_hash = ?, name = ?, role = ?, updated_at = ? WHERE id = ?')
        .run(hash, ADMIN_NAME, 'superAdmin', t, existing.id);
      console.log('[api] Refreshed seeded admin user:', normalizedAdminEmail);
    }
  }
} catch (e) {
  console.warn('[api] Admin seed failed:', e && e.message ? e.message : String(e));
}

const app = express();
app.disable('x-powered-by');
app.use(cors(buildCorsOptions()));
app.use((req, res, next) => {
  applySecurityHeaders(req, res);
  if (shuttingDown && req.path !== '/api/health') {
    return res.status(503).json({ ok: false, error: 'Server is restarting. Please retry shortly.' });
  }
  return next();
});
app.use(bodyParser.json({ limit: '2mb' }));

// Firebase-backed MFA endpoints (used by the mobile/web app).
registerFirebaseMfaRoutes(app);
registerOrganizationIntakeRoutes(app, { createOrRefreshManagedAccessInvite });

// Serve uploaded media. Files are stored under the same host-mounted .data dir.
app.use('/uploads', uploadAccessMiddleware, express.static(UPLOAD_DIR));

// Rate limits (best-effort, in-memory)
const AUTH_RATE_WINDOW_MS = Math.max(10_000, Number(process.env.CB_AUTH_RATE_WINDOW_MS || process.env.BB_AUTH_RATE_WINDOW_MS || 5 * 60 * 1000));
const AUTH_RATE_MAX = Math.max(1, Number(process.env.CB_AUTH_RATE_MAX || process.env.BB_AUTH_RATE_MAX || 30));
const TWO_FA_VERIFY_RATE_WINDOW_MS = Math.max(10_000, Number(process.env.CB_2FA_VERIFY_RATE_WINDOW_MS || process.env.BB_2FA_VERIFY_RATE_WINDOW_MS || 10 * 60 * 1000));
const TWO_FA_VERIFY_RATE_MAX = Math.max(1, Number(process.env.CB_2FA_VERIFY_RATE_MAX || process.env.BB_2FA_VERIFY_RATE_MAX || 12));
const TWO_FA_RESEND_RATE_WINDOW_MS = Math.max(10_000, Number(process.env.CB_2FA_RESEND_RATE_WINDOW_MS || process.env.BB_2FA_RESEND_RATE_WINDOW_MS || 10 * 60 * 1000));
const TWO_FA_RESEND_RATE_MAX = Math.max(1, Number(process.env.CB_2FA_RESEND_RATE_MAX || process.env.BB_2FA_RESEND_RATE_MAX || 6));
const UPLOAD_RATE_WINDOW_MS = Math.max(10_000, Number(process.env.CB_UPLOAD_RATE_WINDOW_MS || process.env.BB_UPLOAD_RATE_WINDOW_MS || 10 * 60 * 1000));
const UPLOAD_RATE_MAX = Math.max(1, Number(process.env.CB_UPLOAD_RATE_MAX || process.env.BB_UPLOAD_RATE_MAX || 30));

const authRateLimit = createInMemoryRateLimiter({
  windowMs: AUTH_RATE_WINDOW_MS,
  max: AUTH_RATE_MAX,
  keyFn: (req) => {
    const ip = getClientIp(req);
    const email = safeLower(req.body && req.body.email);
    const route = safeLower(req.path);
    return `auth:${route}:${ip}:${email}`;
  },
});

const twoFaVerifyRateLimit = createInMemoryRateLimiter({
  windowMs: TWO_FA_VERIFY_RATE_WINDOW_MS,
  max: TWO_FA_VERIFY_RATE_MAX,
  keyFn: (req) => {
    const ip = getClientIp(req);
    const route = safeLower(req.path);
    const challengeId = safeLower(req.body && req.body.challengeId);
    return `auth-2fa-verify:${route}:${ip}:${challengeId}`;
  },
});

const twoFaResendRateLimit = createInMemoryRateLimiter({
  windowMs: TWO_FA_RESEND_RATE_WINDOW_MS,
  max: TWO_FA_RESEND_RATE_MAX,
  keyFn: (req) => {
    const ip = getClientIp(req);
    const route = safeLower(req.path);
    const challengeId = safeLower(req.body && req.body.challengeId);
    return `auth-2fa-resend:${route}:${ip}:${challengeId}`;
  },
});

const uploadRateLimit = createInMemoryRateLimiter({
  windowMs: UPLOAD_RATE_WINDOW_MS,
  max: UPLOAD_RATE_MAX,
  keyFn: (req) => {
    const ip = getClientIp(req);
    const route = safeLower(req.path);
    return `upload:${route}:${ip}`;
  },
});

function buildPublicUrl(req, pathname) {
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (PUBLIC_BASE_URL) return `${PUBLIC_BASE_URL.replace(/\/$/, '')}${p}`;
  const proto = (req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0].trim() : '') || req.protocol;
  const host = (req.headers['x-forwarded-host'] ? String(req.headers['x-forwarded-host']).split(',')[0].trim() : '') || req.get('host');
  return `${proto}://${host}${p}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const orig = (file && file.originalname) ? String(file.originalname) : 'upload';
      const ext = path.extname(orig).slice(0, 12);
      const safeBase = path.basename(orig, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file';
      cb(null, `${nanoId()}_${safeBase}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

async function authMiddleware(req, res, next) {
  if (!db) return res.status(503).json({ ok: false, error: 'Database unavailable' });
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = String(header).startsWith('Bearer ') ? String(header).slice(7) : '';

  if (ALLOW_DEV_TOKEN && token === 'dev-token') {
    req.user = { id: 'dev', email: 'dev@example.com', name: 'Developer', role: 'ADMIN' };
    return next();
  }

  if (!token) return res.status(401).json({ ok: false, error: 'missing auth token' });

  try {
    let userId = '';
    if (JWT_SECRET) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        userId = payload && payload.sub ? String(payload.sub) : '';
      } catch (_) {
        userId = '';
      }
    }

    if (!userId) {
      const admin = getFirebaseAdmin();
      const decoded = await admin.auth().verifyIdToken(token);
      userId = decoded && decoded.uid ? String(decoded.uid) : '';
    }

    if (!userId) return res.status(401).json({ ok: false, error: 'invalid token' });

    const row = db.prepare('SELECT id,email,name,avatar,phone,address,role FROM users WHERE id = ?').get(userId);
    if (!row) return res.status(401).json({ ok: false, error: 'user not found' });
    return Promise.resolve(getFirebaseManagedProfiles([userId]).catch(() => new Map())).then((firebaseProfile) => {
      req.user = normalizeScopedUser(applyReservedSuperAdminRole({ ...userToClient(row), ...(firebaseProfile.get(userId) || {}) }));
      return next();
    });
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'invalid token' });
  }
}

function isParentRole(role) {
  const r = safeString(role).trim().toLowerCase();
  return r.includes('parent');
}

function isTherapistRole(role) {
  const r = safeString(role).trim().toLowerCase();
  return r.includes('therapist') || r.includes('bcba');
}

function isBcbaRole(role) {
  const r = safeString(role).trim().toLowerCase();
  return r.includes('bcba');
}

function pickDirectoryRecordForUser(user, records) {
  const uid = safeString(user && user.id).trim();
  if (uid) {
    const byId = (records || []).find((r) => r && safeString(r.id).trim() === uid);
    if (byId) return byId;
  }
  const uEmail = normalizeEmail(user && user.email);
  if (uEmail) {
    const matches = (records || []).filter((r) => r && normalizeEmail(r.email) === uEmail);
    if (matches.length) return matches[0];
  }
  return null;
}

function childHasParentId(child, parentId) {
  const pid = safeString(parentId).trim();
  if (!pid) return false;
  const parentIds = Array.isArray(child && child.parentIds) ? child.parentIds : [];
  if (parentIds.some((value) => safeString(value).trim() === pid)) return true;
  const list = Array.isArray(child && child.parents) ? child.parents : [];
  return list.some((p) => {
    if (!p) return false;
    if (typeof p === 'string' || typeof p === 'number') return safeString(p).trim() === pid;
    if (typeof p === 'object' && p.id != null) return safeString(p.id).trim() === pid;
    return false;
  });
}

function canWriteChildCareData(user) {
  const role = safeString(user && user.role);
  const normalizedRole = role.trim().toLowerCase();
  return isAdminRole(role)
    || isTherapistRole(role)
    || isBcbaRole(role)
    || normalizedRole === 'faculty'
    || normalizedRole === 'staff'
    || normalizedRole === 'teacher';
}

function requireChildCareWriteAccess(req, res, next) {
  if (canWriteChildCareData(req.user)) return next();
  return res.status(403).json({ ok: false, error: 'Forbidden' });
}

function normalizeDateKey(value) {
  const raw = safeString(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw || Date.now());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeMoodScore(value) {
  const score = Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 15) return null;
  return score;
}

function normalizeDocumentEntry(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const url = safeString(doc.url).trim();
  if (!url) return null;
  return {
    id: safeString(doc.id).trim() || nanoId(),
    title: safeString(doc.title || doc.name || doc.fileName).trim() || 'Document',
    meta: safeString(doc.meta || doc.description).trim(),
    url,
    fileName: safeString(doc.fileName || doc.name).trim(),
    mimeType: safeString(doc.mimeType).trim(),
    uploadedAt: safeString(doc.uploadedAt || doc.createdAt).trim() || nowISO(),
  };
}

function normalizeDocumentScopeMap(value) {
  const source = value && typeof value === 'object' ? value : {};
  const out = {};
  Object.entries(source).forEach(([scopeId, docs]) => {
    const normalizedScopeId = safeString(scopeId).trim();
    if (!normalizedScopeId) return;
    const normalizedDocs = (Array.isArray(docs) ? docs : []).map((doc) => normalizeDocumentEntry(doc)).filter(Boolean);
    if (!normalizedDocs.length) return;
    out[normalizedScopeId] = normalizedDocs;
  });
  return out;
}

function normalizeTherapySessionType(value) {
  const normalized = safeString(value).trim().toUpperCase();
  if (normalized === 'AM' || normalized === 'PM') return normalized;
  return 'CUSTOM';
}

function normalizeTherapyEventType(value) {
  const normalized = safeString(value).trim().toLowerCase();
  const allowed = new Set(['behavior', 'program', 'mood', 'meal', 'toileting', 'note', 'milestone', 'session_marker']);
  return allowed.has(normalized) ? normalized : '';
}

function normalizeTherapyEvent(entry, session, actor) {
  const payload = entry && typeof entry === 'object' ? entry : {};
  const eventType = normalizeTherapyEventType(payload.eventType || payload.type);
  if (!eventType) return null;
  const eventCode = safeString(payload.eventCode || payload.code || payload.label || eventType).trim().toLowerCase().replace(/\s+/g, '_');
  if (!eventCode) return null;
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? { ...payload.metadata } : {};
  if (payload.note != null && metadata.note == null) metadata.note = safeString(payload.note).trim();
  if (payload.score != null && metadata.score == null) metadata.score = payload.score;
  if (payload.status != null && metadata.status == null) metadata.status = payload.status;
  if (payload.mealType != null && metadata.type == null) metadata.type = payload.mealType;
  const occurredAt = safeString(payload.occurredAt).trim() || nowISO();
  const frequencyDeltaRaw = Number(payload.frequencyDelta);
  return {
    id: nanoId(),
    sessionId: session.id,
    childId: session.child_id,
    therapistId: safeString(actor?.id || actor?.uid).trim() || safeString(session.therapist_id).trim(),
    eventType,
    eventCode,
    label: safeString(payload.label || payload.title || payload.eventCode || payload.code || eventType).trim() || eventCode,
    value: payload.value !== undefined ? payload.value : (payload.score !== undefined ? payload.score : null),
    intensity: safeString(payload.intensity).trim() || null,
    frequencyDelta: Number.isFinite(frequencyDeltaRaw) ? Math.trunc(frequencyDeltaRaw) : 1,
    metadata,
    occurredAt,
    source: safeString(payload.source).trim() || 'tap-grid',
    clientEventId: safeString(payload.clientEventId).trim() || null,
    createdAt: nowISO(),
  };
}

function validateTherapyEventPayload(item) {
  if (!item) return 'Valid event payload required';
  if (!item.eventType || !item.eventCode) return 'Valid event payload required';
  if (safeString(item.eventCode).trim().length > 80) return 'event code is too long';
  if (safeString(item.label).trim().length > 200) return 'event label is too long';
  if (!/^\d{4}-\d{2}-\d{2}T/.test(safeString(item.occurredAt).trim())) return 'occurredAt must be an ISO timestamp';
  if (!Number.isFinite(Number(item.frequencyDelta)) || Math.abs(Number(item.frequencyDelta)) > 1000) return 'frequencyDelta is out of range';
  return '';
}

function buildTherapySessionResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    childId: row.child_id,
    childName: safeString(row.child_name).trim(),
    therapistId: safeString(row.therapist_id).trim(),
    therapistRole: safeString(row.therapist_role).trim(),
    organizationId: safeString(row.organization_id).trim(),
    programId: safeString(row.program_id).trim(),
    campusId: safeString(row.campus_id).trim(),
    sessionDate: row.session_date,
    sessionType: row.session_type,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    summaryGeneratedAt: row.summary_generated_at,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildTherapySessionEventResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    childId: row.child_id,
    therapistId: safeString(row.therapist_id).trim(),
    eventType: row.event_type,
    eventCode: row.event_code,
    label: safeString(row.label).trim(),
    value: safeJsonParse(safeString(row.value_json), null),
    intensity: safeString(row.intensity).trim() || null,
    frequencyDelta: Number(row.frequency_delta) || 0,
    metadata: safeJsonParse(safeString(row.metadata_json), {}),
    occurredAt: row.occurred_at,
    source: safeString(row.source).trim() || 'tap-grid',
    clientEventId: safeString(row.client_event_id).trim() || null,
    createdAt: row.created_at,
  };
}

function buildTherapySessionSummaryResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    childId: row.child_id,
    therapistId: safeString(row.therapist_id).trim(),
    status: row.status,
    version: Number(row.version) || 1,
    summary: safeJsonParse(safeString(row.summary_json), null),
    summaryText: safeString(row.summary_text),
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at || null,
    fileName: DEFAULT_SUMMARY_FILENAME,
  };
}

function getChildDisplayNameByIdSqlite(childId) {
  try {
    const rows = db.prepare('SELECT data_json FROM directory_children ORDER BY updated_at DESC').all();
    for (const row of rows || []) {
      const item = safeJsonParse(String(row && row.data_json ? row.data_json : ''), null);
      if (safeString(item?.id).trim() === safeString(childId).trim()) return safeString(item?.name).trim();
    }
  } catch (_) {
    // ignore
  }
  return '';
}

function getTherapySessionRowSqlite(sessionId) {
  return db.prepare('SELECT * FROM therapy_sessions WHERE id = ?').get(sessionId);
}

function getTherapySessionSummaryRowSqlite(sessionId) {
  return db.prepare('SELECT * FROM therapy_session_summaries WHERE session_id = ?').get(sessionId);
}

function upsertTherapySessionSummarySqlite({ session, summary, status = 'draft', approvedAt = null }) {
  const existing = getTherapySessionSummaryRowSqlite(session.id);
  const now = nowISO();
  const nextVersion = (Number(existing?.version) || 0) + 1;
  const summaryText = renderSessionSummaryText(summary);
  const row = {
    id: existing?.id || nanoId(),
    sessionId: session.id,
    childId: session.child_id,
    therapistId: safeString(session.therapist_id).trim(),
    status,
    version: nextVersion,
    summaryJson: JSON.stringify(summary),
    summaryText,
    generatedAt: existing?.generated_at || now,
    updatedAt: now,
    approvedAt: approvedAt || null,
  };
  db.prepare(
    'INSERT INTO therapy_session_summaries (id, session_id, child_id, therapist_id, status, version, summary_json, summary_text, generated_at, updated_at, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)\n' +
    'ON CONFLICT(session_id) DO UPDATE SET child_id=excluded.child_id, therapist_id=excluded.therapist_id, status=excluded.status, version=excluded.version, summary_json=excluded.summary_json, summary_text=excluded.summary_text, updated_at=excluded.updated_at, approved_at=excluded.approved_at'
  ).run(row.id, row.sessionId, row.childId, row.therapistId, row.status, row.version, row.summaryJson, row.summaryText, row.generatedAt, row.updatedAt, row.approvedAt);
  return getTherapySessionSummaryRowSqlite(session.id);
}

function generateTherapySessionSummarySqlite(sessionId, overrideSummary) {
  const session = getTherapySessionRowSqlite(sessionId);
  if (!session) return null;
  const eventRows = db.prepare('SELECT * FROM therapy_session_events WHERE session_id = ? ORDER BY occurred_at ASC, created_at ASC').all(sessionId);
  const events = (eventRows || []).map((row) => buildTherapySessionEventResponse(row));
  const summary = buildTherapySessionSummary({
    sessionId: session.id,
    sessionDate: session.session_date,
    childId: session.child_id,
    childName: safeString(session.child_name).trim() || getChildDisplayNameByIdSqlite(session.child_id),
    events,
    existingSummary: overrideSummary,
  });
  return upsertTherapySessionSummarySqlite({ session, summary, status: overrideSummary ? 'draft' : (session.approved_at ? 'approved' : 'draft'), approvedAt: session.approved_at || null });
}

function readOrgSettingsItemSqlite() {
  try {
    const row = db.prepare('SELECT data_json FROM org_settings WHERE id = ?').get('default');
    return row && row.data_json ? safeJsonParse(String(row.data_json), null) : null;
  } catch (_) {
    return null;
  }
}

function getScopedDocumentsFromSettings(orgSettings, scopeKey, scopeId) {
  const normalizedScopeId = safeString(scopeId).trim();
  if (!normalizedScopeId) return [];
  const map = orgSettings && typeof orgSettings === 'object' && orgSettings[scopeKey] && typeof orgSettings[scopeKey] === 'object'
    ? orgSettings[scopeKey]
    : {};
  return (Array.isArray(map[normalizedScopeId]) ? map[normalizedScopeId] : [])
    .map((doc) => normalizeDocumentEntry(doc))
    .filter(Boolean);
}

function getLatestMoodEntriesByChildIdSqlite() {
  const rows = db.prepare('SELECT child_id, score, note, actor_id, actor_role, recorded_at, created_at FROM mood_entries ORDER BY child_id ASC, recorded_at DESC, created_at DESC').all();
  const out = new Map();
  for (const row of rows || []) {
    const childId = safeString(row && row.child_id).trim();
    if (!childId || out.has(childId)) continue;
    out.set(childId, {
      childId,
      score: Number(row.score),
      note: safeString(row.note).trim(),
      actorId: safeString(row.actor_id).trim(),
      actorRole: safeString(row.actor_role).trim(),
      recordedAt: safeString(row.recorded_at).trim(),
      createdAt: safeString(row.created_at).trim(),
    });
  }
  return out;
}

function enrichChildrenWithCareData(children, orgSettings, latestMoodEntriesByChildId) {
  return (Array.isArray(children) ? children : []).map((child) => {
    const childId = safeString(child && child.id).trim();
    const latestMoodEntry = childId ? latestMoodEntriesByChildId.get(childId) || null : null;
    const moodScore = latestMoodEntry ? Number(latestMoodEntry.score) : null;
    const programId = safeString((child && (child.programId || child.branchId)) || '').trim();
    const campusId = safeString(child && child.campusId).trim();
    return {
      ...child,
      programDocs: Array.isArray(child && child.programDocs) && child.programDocs.length
        ? child.programDocs
        : getScopedDocumentsFromSettings(orgSettings, 'programDocumentsByProgramId', programId),
      campusDocs: Array.isArray(child && child.campusDocs) && child.campusDocs.length
        ? child.campusDocs
        : getScopedDocumentsFromSettings(orgSettings, 'campusDocumentsByCampusId', campusId),
      moodScore: moodScore != null ? moodScore : child?.moodScore ?? null,
      mood: moodScore != null ? moodScore : child?.mood ?? null,
      latestMoodEntry: latestMoodEntry || child?.latestMoodEntry || null,
    };
  });
}

function getVisibleChildIdsForUser(user) {
  const childRows = db.prepare('SELECT data_json FROM directory_children ORDER BY updated_at DESC').all();
  const parentRows = db.prepare('SELECT data_json FROM directory_parents ORDER BY updated_at DESC').all();
  const therapistRows = db.prepare('SELECT data_json FROM directory_therapists ORDER BY updated_at DESC').all();
  const assignRows = db.prepare('SELECT child_id, session, aba_id FROM child_aba_assignments ORDER BY child_id ASC').all();
  const supervisionRows = db.prepare('SELECT aba_id, bcba_id FROM aba_supervision ORDER BY aba_id ASC').all();

  const allChildren = (childRows || []).map((row) => safeJsonParse(String(row && row.data_json ? row.data_json : ''), null)).filter(Boolean);
  const allParents = (parentRows || []).map((row) => safeJsonParse(String(row && row.data_json ? row.data_json : ''), null)).filter(Boolean);
  const allTherapists = (therapistRows || []).map((row) => safeJsonParse(String(row && row.data_json ? row.data_json : ''), null)).filter(Boolean);
  const allAssignments = (assignRows || []).map((row) => ({ childId: row.child_id, session: row.session, abaId: row.aba_id }));
  const allSupervision = (supervisionRows || []).map((row) => ({ abaId: row.aba_id, bcbaId: row.bcba_id }));

  if (user && isAdminRole(user.role)) {
    return allChildren.map((child) => safeString(child && child.id).trim()).filter(Boolean);
  }

  const role = safeString(user && user.role);
  const wantParent = isParentRole(role);
  const wantTherapist = isTherapistRole(role);
  const wantBcba = isBcbaRole(role);
  const outChildIds = new Set();
  const outTherapistIds = new Set();

  const supervisionByAba = new Map();
  (allSupervision || []).forEach((entry) => {
    const abaId = safeString(entry && entry.abaId).trim();
    const bcbaId = safeString(entry && entry.bcbaId).trim();
    if (abaId && bcbaId) supervisionByAba.set(abaId, bcbaId);
  });

  if (wantParent) {
    const meParent = pickDirectoryRecordForUser(user, allParents);
    if (!meParent) return [];
    const meParentId = safeString(meParent && meParent.id).trim();
    (allChildren || []).forEach((child) => {
      const childId = safeString(child && child.id).trim();
      if (childId && childHasParentId(child, meParentId)) outChildIds.add(childId);
    });
    return Array.from(outChildIds);
  }

  if (!(wantTherapist || wantBcba)) return [];

  const meTherapist = pickDirectoryRecordForUser(user, allTherapists);
  const meTherapistId = safeString(meTherapist && meTherapist.id).trim();
  if (!meTherapistId) return [];
  outTherapistIds.add(meTherapistId);

  if (wantBcba) {
    (allSupervision || []).forEach((entry) => {
      if (safeString(entry && entry.bcbaId).trim() === meTherapistId) {
        const abaId = safeString(entry && entry.abaId).trim();
        if (abaId) outTherapistIds.add(abaId);
      }
    });
  } else {
    const bcbaId = supervisionByAba.get(meTherapistId) || safeString(meTherapist && (meTherapist.supervisedBy || meTherapist.supervised_by)).trim();
    if (bcbaId) outTherapistIds.add(bcbaId);
  }

  (allAssignments || []).forEach((assignment) => {
    const childId = safeString(assignment && assignment.childId).trim();
    const abaId = safeString(assignment && assignment.abaId).trim();
    if (!childId || !abaId) return;
    if (wantBcba) {
      if (outTherapistIds.has(abaId) && abaId !== meTherapistId) outChildIds.add(childId);
      return;
    }
    if (abaId === meTherapistId) outChildIds.add(childId);
  });

  return Array.from(outChildIds);
}

function sanitizePublicLookupDoc(id, data, extras) {
  const payload = data && typeof data === 'object' ? data : {};
  return {
    id: safeString(id).trim(),
    name: safeString(payload.name || payload.displayName || payload.title).trim(),
    active: payload.active !== false,
    ...extras,
  };
}

function normalizedPublicEnrollmentCodes(data) {
  const values = [];
  const single = safeString(data?.enrollmentCode).trim();
  if (single) values.push(single);
  const list = Array.isArray(data?.enrollmentCodes) ? data.enrollmentCodes : [];
  list.forEach((code) => {
    const value = safeString(code).trim();
    if (value) values.push(value);
  });
  return Array.from(new Set(values.map((value) => value.toUpperCase())));
}

function normalizePersonName(value) {
  return safeString(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function childHasParentName(child, normalizedName) {
  if (!normalizedName) return false;
  const parents = Array.isArray(child?.parents) ? child.parents : [];
  return parents.some((parent) => {
    if (!parent) return false;
    if (typeof parent === 'string') return normalizePersonName(parent) === normalizedName;
    return normalizePersonName(parent.name || `${parent.firstName || ''} ${parent.lastName || ''}`) === normalizedName;
  });
}

async function resolvePublicEnrollmentContext({ firestore, organizationId, programId, campusId, enrollmentCode }) {
  const cleanedCode = safeString(enrollmentCode).trim().toUpperCase();
  if (!cleanedCode) {
    const err = new Error('enrollmentCode is required.');
    err.httpStatus = 400;
    throw err;
  }

  if (!organizationId || !programId) {
    const campusSnap = await firestore.collectionGroup('campuses').where('active', '==', true).get();
    const matches = campusSnap.docs.filter((docSnap) => normalizedPublicEnrollmentCodes(docSnap.data()).includes(cleanedCode));
    if (!matches.length) {
      const err = new Error('Enrollment code did not match an active campus.');
      err.httpStatus = 403;
      throw err;
    }
    if (matches.length > 1) {
      const err = new Error('Enrollment code matched multiple campuses. Contact support to finish account setup.');
      err.httpStatus = 409;
      throw err;
    }

    const matchedCampus = matches[0];
    const orgRef = matchedCampus.ref.parent.parent;
    const orgSnap = orgRef ? await orgRef.get() : null;
    const orgData = orgSnap?.exists ? (orgSnap.data() || {}) : null;
    const resolvedOrganizationId = safeString(orgSnap?.id).trim();
    const resolvedProgramId = safeString(matchedCampus.data()?.programId || matchedCampus.data()?.branchId).trim();
    if (!orgSnap?.exists || orgData?.active === false || !resolvedOrganizationId || !resolvedProgramId) {
      const err = new Error('Enrollment context is not active.');
      err.httpStatus = 404;
      throw err;
    }

    const programSnap = await orgRef.collection('programs').doc(resolvedProgramId).get();
    if (!programSnap.exists || programSnap.data()?.active === false) {
      const err = new Error('Program not found.');
      err.httpStatus = 404;
      throw err;
    }

    return {
      organizationId: resolvedOrganizationId,
      organizationName: safeString(orgData?.name || orgData?.displayName).trim(),
      programId: resolvedProgramId,
      programName: safeString(programSnap.data()?.name || programSnap.data()?.displayName).trim(),
      campusId: matchedCampus.id,
      campusName: safeString(matchedCampus.data()?.name || matchedCampus.data()?.displayName).trim(),
      organization: sanitizePublicLookupDoc(orgSnap.id, orgData, {
        shortCode: safeString(orgData?.shortCode || orgData?.code).trim(),
      }),
      program: sanitizePublicLookupDoc(programSnap.id, programSnap.data(), { organizationId: resolvedOrganizationId, type: safeString(programSnap.data()?.type).trim() }),
      campus: sanitizePublicLookupDoc(matchedCampus.id, matchedCampus.data(), { organizationId: resolvedOrganizationId, programId: resolvedProgramId }),
    };
  }

  const orgRef = firestore.collection('organizations').doc(organizationId);
  const programRef = orgRef.collection('programs').doc(programId);
  const [orgSnap, programSnap] = await Promise.all([orgRef.get(), programRef.get()]);
  if (!orgSnap.exists || orgSnap.data()?.active === false) {
    const err = new Error('Organization not found.');
    err.httpStatus = 404;
    throw err;
  }
  if (!programSnap.exists || programSnap.data()?.active === false) {
    const err = new Error('Program not found.');
    err.httpStatus = 404;
    throw err;
  }

  if (campusId) {
    const campusSnap = await orgRef.collection('campuses').doc(campusId).get();
    const campusData = campusSnap.exists ? (campusSnap.data() || {}) : null;
    if (!campusSnap.exists || campusData?.active === false || safeString(campusData?.programId || campusData?.branchId).trim() !== programId) {
      const err = new Error('Campus not found for this program.');
      err.httpStatus = 404;
      throw err;
    }
    if (!normalizedPublicEnrollmentCodes(campusData).includes(cleanedCode)) {
      const err = new Error('Enrollment code did not match the selected campus.');
      err.httpStatus = 403;
      throw err;
    }
    return {
      organizationId,
      organizationName: safeString(orgSnap.data()?.name || orgSnap.data()?.displayName).trim(),
      programId,
      programName: safeString(programSnap.data()?.name || programSnap.data()?.displayName).trim(),
      campusId,
      campusName: safeString(campusData?.name || campusData?.displayName).trim(),
      organization: sanitizePublicLookupDoc(orgSnap.id, orgSnap.data(), {
        shortCode: safeString(orgSnap.data()?.shortCode || orgSnap.data()?.code).trim(),
      }),
      program: sanitizePublicLookupDoc(programSnap.id, programSnap.data(), { organizationId, type: safeString(programSnap.data()?.type).trim() }),
      campus: sanitizePublicLookupDoc(campusSnap.id, campusData, { organizationId, programId }),
    };
  }

  const campusSnap = await orgRef.collection('campuses').where('active', '==', true).where('programId', '==', programId).get();
  const matchedCampus = campusSnap.docs.find((docSnap) => normalizedPublicEnrollmentCodes(docSnap.data()).includes(cleanedCode));
  if (!matchedCampus) {
    const err = new Error('Enrollment code did not match an active campus.');
    err.httpStatus = 403;
    throw err;
  }

  return {
    organizationId,
    organizationName: safeString(orgSnap.data()?.name || orgSnap.data()?.displayName).trim(),
    programId,
    programName: safeString(programSnap.data()?.name || programSnap.data()?.displayName).trim(),
    campusId: matchedCampus.id,
    campusName: safeString(matchedCampus.data()?.name || matchedCampus.data()?.displayName).trim(),
    organization: sanitizePublicLookupDoc(orgSnap.id, orgSnap.data(), {
      shortCode: safeString(orgSnap.data()?.shortCode || orgSnap.data()?.code).trim(),
    }),
    program: sanitizePublicLookupDoc(programSnap.id, programSnap.data(), { organizationId, type: safeString(programSnap.data()?.type).trim() }),
    campus: sanitizePublicLookupDoc(matchedCampus.id, matchedCampus.data(), { organizationId, programId }),
  };
}

async function createFirebasePublicSignupUser(payload) {
  const admin = getFirebaseAdmin();
  const auth = admin.auth();
  const firestore = admin.firestore();

  const name = safeString(payload?.name).trim();
  const firstName = safeString(payload?.firstName).trim();
  const lastName = safeString(payload?.lastName).trim();
  const email = normalizeEmail(payload?.email);
  const password = safeString(payload?.password);
  const role = safeString(payload?.role || 'parent').trim() || 'parent';
  let organizationId = safeString(payload?.organizationId).trim();
  let organizationName = safeString(payload?.organizationName).trim();
  let programId = safeString(payload?.programId).trim();
  let programName = safeString(payload?.programName).trim();
  let campusId = safeString(payload?.campusId).trim();
  let campusName = safeString(payload?.campusName).trim();
  const enrollmentCode = safeString(payload?.enrollmentCode).trim().toUpperCase();

  if (!email || !password || !name) {
    const err = new Error('name, email, and password are required');
    err.httpStatus = 400;
    throw err;
  }
  if (name.length > 120) {
    const err = new Error('name is too long');
    err.httpStatus = 400;
    throw err;
  }
  const passwordPolicyError = validatePasswordPolicy(password);
  if (passwordPolicyError) {
    const err = new Error(passwordPolicyError);
    err.httpStatus = 400;
    throw err;
  }
  if (isRestrictedSignupRole(role)) {
    const err = new Error('elevated roles must be provisioned by an existing administrator');
    err.httpStatus = 403;
    throw err;
  }
  if (!enrollmentCode) {
    const err = new Error('enrollmentCode is required');
    err.httpStatus = 400;
    throw err;
  }
  const enrollmentContext = await resolvePublicEnrollmentContext({
    firestore,
    organizationId,
    programId,
    campusId,
    enrollmentCode,
  });
  organizationId = enrollmentContext.organizationId;
  organizationName = organizationName || enrollmentContext.organizationName;
  programId = enrollmentContext.programId;
  programName = programName || enrollmentContext.programName;
  campusId = enrollmentContext.campusId;
  campusName = campusName || enrollmentContext.campusName;

  try {
    const existing = await auth.getUserByEmail(email);
    const err = new Error('email already exists');
    err.httpStatus = 409;
    err.uid = existing?.uid || '';
    throw err;
  } catch (error) {
    const code = safeString(error?.code).toLowerCase();
    if (error?.httpStatus === 409) throw error;
    if (code && !code.includes('user-not-found')) throw error;
  }

  let userRecord = null;
  try {
    userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    await firestore.collection('users').doc(userRecord.uid).set({
      id: userRecord.uid,
      name,
      firstName,
      lastName,
      email,
      role,
      organizationId,
      organizationName,
      programId,
      programName,
      campusId,
      campusName,
      enrollmentCode,
      avatar: 'default',
      active: true,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });

    if (String(role).toLowerCase().includes('parent')) {
      const normalizedName = normalizePersonName(name);
      const childSnap = await firestore.collection('children')
        .where('organizationId', '==', organizationId)
        .where('programId', '==', programId)
        .where('campusId', '==', campusId)
        .limit(100)
        .get();
      const matchingChildren = childSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
        .filter((child) => childHasParentName(child, normalizedName));
      if (!matchingChildren.length) {
        const err = new Error('We could not match that parent name to any children for this enrollment code.');
        err.httpStatus = 404;
        throw err;
      }

      await firestore.collection('parents').doc(userRecord.uid).set({
        id: userRecord.uid,
        uid: userRecord.uid,
        name,
        email,
        organizationId,
        organizationName,
        programId,
        programName,
        campusId,
        campusName,
        childIds: matchingChildren.map((child) => child.id),
        familyId: userRecord.uid,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });

      await firestore.collection('directoryLinks').doc(userRecord.uid).set({
        role: 'parent',
        parentId: userRecord.uid,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });

      await Promise.all(matchingChildren.map((child) => {
        const existingParentIds = Array.isArray(child.parentIds) ? child.parentIds.map((value) => safeString(value).trim()).filter(Boolean) : [];
        const nextParentIds = Array.from(new Set([...existingParentIds, userRecord.uid]));
        const existingParents = Array.isArray(child.parents) ? child.parents : [];
        const hasParentEntry = existingParents.some((entry) => safeString(entry?.id || entry).trim() === userRecord.uid);
        const nextParents = hasParentEntry ? existingParents : [...existingParents, { id: userRecord.uid, name, email }];
        return firestore.collection('children').doc(child.id).set({
          parentIds: nextParentIds,
          parents: nextParents,
          updatedAt: now,
        }, { merge: true });
      }));
    }

    return { ok: true, uid: userRecord.uid };
  } catch (error) {
    if (userRecord?.uid) {
      await firestore.collection('users').doc(userRecord.uid).delete().catch(() => {});
      await firestore.collection('parents').doc(userRecord.uid).delete().catch(() => {});
      await firestore.collection('directoryLinks').doc(userRecord.uid).delete().catch(() => {});
      await auth.deleteUser(userRecord.uid).catch(() => {});
    }
    throw error;
  }
}

app.get('/api/health', (req, res) => {
  const payload = { ok: !shuttingDown, uptime: process.uptime(), shuttingDown, db: Boolean(db), dbError: db ? null : (dbInitError ? String(dbInitError.message || dbInitError) : 'unavailable') };
  if (shuttingDown) return res.status(503).json(payload);
  return res.json(payload);
});

app.get('/api/public/organizations', async (_req, res) => {
  try {
    const admin = getFirebaseAdmin();
    const snap = await admin.firestore().collection('organizations').where('active', '==', true).get();
    const items = snap.docs
      .map((docSnap) => sanitizePublicLookupDoc(docSnap.id, docSnap.data(), {
        shortCode: safeString(docSnap.data()?.shortCode || docSnap.data()?.code).trim(),
      }))
      .filter((item) => item.id && item.name);
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || 'Could not load organizations.' });
  }
});

app.get('/api/public/programs', async (req, res) => {
  const organizationId = safeString(req.query?.organizationId).trim();
  if (!organizationId) {
    return res.status(400).json({ ok: false, error: 'organizationId is required.' });
  }
  try {
    const admin = getFirebaseAdmin();
    const snap = await admin.firestore().collection('organizations').doc(organizationId).collection('programs').where('active', '==', true).get();
    const items = snap.docs
      .map((docSnap) => sanitizePublicLookupDoc(docSnap.id, docSnap.data(), {
        organizationId,
        type: safeString(docSnap.data()?.type).trim(),
      }))
      .filter((item) => item.id && item.name);
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || 'Could not load programs.' });
  }
});

app.get('/api/public/campuses', async (req, res) => {
  const organizationId = safeString(req.query?.organizationId).trim();
  const programId = safeString(req.query?.programId || req.query?.branchId).trim();
  if (!organizationId) {
    return res.status(400).json({ ok: false, error: 'organizationId is required.' });
  }
  try {
    const admin = getFirebaseAdmin();
    let queryRef = admin.firestore().collection('organizations').doc(organizationId).collection('campuses').where('active', '==', true);
    if (programId) queryRef = queryRef.where('programId', '==', programId);
    const snap = await queryRef.get();
    const items = snap.docs
      .map((docSnap) => sanitizePublicLookupDoc(docSnap.id, docSnap.data(), {
        organizationId,
        programId: safeString(docSnap.data()?.programId || docSnap.data()?.branchId).trim(),
      }))
      .filter((item) => item.id && item.name);
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || 'Could not load campuses.' });
  }
});

app.post('/api/public/enrollment-context', async (req, res) => {
  const organizationId = safeString(req.body?.organizationId).trim();
  const programId = safeString(req.body?.programId || req.body?.branchId).trim();
  const campusId = safeString(req.body?.campusId).trim();
  const enrollmentCode = safeString(req.body?.enrollmentCode).trim().toUpperCase();

  if (!enrollmentCode) {
    return res.status(400).json({ ok: false, error: 'enrollmentCode is required.' });
  }

  try {
    const admin = getFirebaseAdmin();
    const result = await resolvePublicEnrollmentContext({
      firestore: admin.firestore(),
      organizationId,
      programId,
      campusId,
      enrollmentCode,
    });

    return res.json({
      organization: result.organization,
      program: result.program,
      campus: result.campus,
    });
  } catch (error) {
    return res.status(Number(error?.httpStatus || 500)).json({ ok: false, error: error?.message || 'Could not resolve enrollment context.' });
  }
});

app.post('/api/public/firebase-signup', authRateLimit, async (req, res) => {
  try {
    const result = await createFirebasePublicSignupUser(req.body || {});
    return res.status(201).json(result);
  } catch (error) {
    const status = Number(error?.httpStatus || 0) || (safeString(error?.code).toLowerCase().includes('already-exists') ? 409 : 500);
    return res.status(status).json({ ok: false, error: error?.message || 'firebase signup failed' });
  }
});

// Directory (SQLite-backed). Admin-only for now.
app.get('/api/directory', authMiddleware, requireAdmin, (req, res) => {
  try {
    const orgSettings = readOrgSettingsItemSqlite();
    const latestMoodEntriesByChildId = getLatestMoodEntriesByChildIdSqlite();
    const children = enrichChildrenWithCareData(
      db.prepare('SELECT data_json FROM directory_children ORDER BY updated_at DESC').all()
        .map((r) => {
          try { return JSON.parse(String(r.data_json || '')); } catch (e) { return null; }
        }).filter(Boolean),
      orgSettings,
      latestMoodEntriesByChildId,
    );
    const parents = db.prepare('SELECT data_json FROM directory_parents ORDER BY updated_at DESC').all()
      .map((r) => {
        try { return JSON.parse(String(r.data_json || '')); } catch (e) { return null; }
      }).filter(Boolean);
    const therapists = db.prepare('SELECT data_json FROM directory_therapists ORDER BY updated_at DESC').all()
      .map((r) => {
        try { return JSON.parse(String(r.data_json || '')); } catch (e) { return null; }
      }).filter(Boolean);

    const assignments = db.prepare('SELECT child_id, session, aba_id FROM child_aba_assignments ORDER BY child_id ASC').all()
      .map((r) => ({ childId: r.child_id, session: r.session, abaId: r.aba_id }));
    const supervision = db.prepare('SELECT aba_id, bcba_id FROM aba_supervision ORDER BY aba_id ASC').all()
      .map((r) => ({ abaId: r.aba_id, bcbaId: r.bcba_id }));

    const aba = { assignments, supervision };
    if (isSuperAdminRole(req.user?.role)) {
      return res.json(buildSuperAdminDirectoryPayload({ children, parents, therapists, aba }));
    }
    return res.json({ ok: true, children, parents, therapists, aba });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Directory scope for the current user (safe for non-admins).
app.get('/api/directory/me', authMiddleware, (req, res) => {
  try {
    const orgSettings = readOrgSettingsItemSqlite();
    const latestMoodEntriesByChildId = getLatestMoodEntriesByChildIdSqlite();
    const allChildren = enrichChildrenWithCareData(
      db.prepare('SELECT data_json FROM directory_children ORDER BY updated_at DESC').all()
        .map((r) => {
          try { return JSON.parse(String(r.data_json || '')); } catch (e) { return null; }
        }).filter(Boolean),
      orgSettings,
      latestMoodEntriesByChildId,
    );
    const allParents = db.prepare('SELECT data_json FROM directory_parents ORDER BY updated_at DESC').all()
      .map((r) => {
        try { return JSON.parse(String(r.data_json || '')); } catch (e) { return null; }
      }).filter(Boolean);
    const allTherapists = db.prepare('SELECT data_json FROM directory_therapists ORDER BY updated_at DESC').all()
      .map((r) => {
        try { return JSON.parse(String(r.data_json || '')); } catch (e) { return null; }
      }).filter(Boolean);

    const allAssignments = db.prepare('SELECT child_id, session, aba_id FROM child_aba_assignments ORDER BY child_id ASC').all()
      .map((r) => ({ childId: r.child_id, session: r.session, abaId: r.aba_id }));
    const allSupervision = db.prepare('SELECT aba_id, bcba_id FROM aba_supervision ORDER BY aba_id ASC').all()
      .map((r) => ({ abaId: r.aba_id, bcbaId: r.bcba_id }));

    if (req.user && isSuperAdminRole(req.user.role)) {
      return res.json(buildSuperAdminDirectoryPayload({ children: allChildren, parents: allParents, therapists: allTherapists, aba: { assignments: allAssignments, supervision: allSupervision } }));
    }

    if (req.user && isAdminRole(req.user.role)) {
      return res.json({ ok: true, children: allChildren, parents: allParents, therapists: allTherapists, aba: { assignments: allAssignments, supervision: allSupervision } });
    }

    const role = safeString(req.user && req.user.role);
    const wantParent = isParentRole(role);
    const wantTherapist = isTherapistRole(role);
    const wantBcba = isBcbaRole(role);

    const outChildIds = new Set();
    const outParentIds = new Set();
    const outTherapistIds = new Set();

    const supervisionByAba = new Map();
    (allSupervision || []).forEach((s) => {
      const abaId = safeString(s && s.abaId).trim();
      const bcbaId = safeString(s && s.bcbaId).trim();
      if (abaId && bcbaId) supervisionByAba.set(abaId, bcbaId);
    });

    const assignmentsByChild = new Map();
    (allAssignments || []).forEach((a) => {
      const childId = safeString(a && a.childId).trim();
      const abaId = safeString(a && a.abaId).trim();
      const session = safeString(a && a.session).trim().toUpperCase();
      if (!childId || !abaId) return;
      const list = assignmentsByChild.get(childId) || [];
      list.push({ childId, session, abaId });
      assignmentsByChild.set(childId, list);
    });

    if (wantParent) {
      const meParent = pickDirectoryRecordForUser(req.user, allParents);
      if (!meParent) {
        return res.json({ ok: true, children: [], parents: [], therapists: [], aba: { assignments: [], supervision: [] }, unlinked: true });
      }

      const meParentId = safeString(meParent.id).trim();
      (allChildren || []).forEach((c) => {
        const childId = safeString(c && c.id).trim();
        if (!childId) return;
        if (!childHasParentId(c, meParentId)) return;
        outChildIds.add(childId);

        const parentList = Array.isArray(c && c.parents) ? c.parents : [];
        parentList.forEach((p) => {
          const pid = (typeof p === 'object' && p && p.id != null) ? safeString(p.id).trim() : safeString(p).trim();
          if (pid) outParentIds.add(pid);
        });

        const childAssignments = assignmentsByChild.get(childId) || [];
        childAssignments.forEach((a) => {
          if (a.abaId) outTherapistIds.add(a.abaId);
        });

        const rawAssigned = (c && (c.assignedABA || c.assigned_ABA || c.assigned)) || [];
        const assignedArr = Array.isArray(rawAssigned) ? rawAssigned : [rawAssigned];
        assignedArr.forEach((id) => {
          const tid = safeString(id).trim();
          if (tid) outTherapistIds.add(tid);
        });
      });

      Array.from(outTherapistIds).forEach((abaId) => {
        const bcbaId = supervisionByAba.get(abaId);
        if (bcbaId) outTherapistIds.add(bcbaId);
      });

      // Parent messaging also needs office/admin contacts in the visible staff roster.
      (allTherapists || []).forEach((staff) => {
        const staffId = safeString(staff && staff.id).trim();
        const staffRole = safeString(staff && staff.role).trim().toLowerCase();
        if (!staffId) return;
        if (isAdminRole(staffRole) || ['office', 'officeadmin', 'office admin', 'office-admin', 'office_admin', 'reception', 'receptionist', 'frontdesk', 'front desk', 'front-desk', 'front_desk'].includes(staffRole)) outTherapistIds.add(staffId);
      });
    } else if (wantTherapist) {
      const meTherapist = pickDirectoryRecordForUser(req.user, allTherapists);
      if (!meTherapist) {
        return res.json({ ok: true, children: [], parents: [], therapists: [], aba: { assignments: [], supervision: [] }, unlinked: true });
      }

      const meTherapistId = safeString(meTherapist.id).trim();
      if (meTherapistId) outTherapistIds.add(meTherapistId);

      if (wantBcba) {
        // BCBA staff views need the full roster, including office users.
        (allTherapists || []).forEach((staff) => {
          const staffId = safeString(staff && staff.id).trim();
          if (staffId) outTherapistIds.add(staffId);
        });
        (allSupervision || []).forEach((s) => {
          if (safeString(s && s.bcbaId).trim() === meTherapistId) {
            const abaId = safeString(s && s.abaId).trim();
            if (abaId) outTherapistIds.add(abaId);
          }
        });
      } else {
        const bcbaId = supervisionByAba.get(meTherapistId) || safeString(meTherapist.supervisedBy || meTherapist.supervised_by).trim();
        if (bcbaId) outTherapistIds.add(bcbaId);
      }

      (allAssignments || []).forEach((a) => {
        const childId = safeString(a && a.childId).trim();
        const abaId = safeString(a && a.abaId).trim();
        if (!childId || !abaId) return;
        if (wantBcba) {
          if (outTherapistIds.has(abaId) && abaId !== meTherapistId) outChildIds.add(childId);
        } else {
          if (abaId === meTherapistId) outChildIds.add(childId);
        }
      });

      (allChildren || []).forEach((c) => {
        const childId = safeString(c && c.id).trim();
        if (!childId || !outChildIds.has(childId)) return;

        const parentList = Array.isArray(c && c.parents) ? c.parents : [];
        parentList.forEach((p) => {
          const pid = (typeof p === 'object' && p && p.id != null) ? safeString(p.id).trim() : safeString(p).trim();
          if (pid) outParentIds.add(pid);
        });

        const childAssignments = assignmentsByChild.get(childId) || [];
        childAssignments.forEach((aa) => {
          if (aa.abaId) outTherapistIds.add(aa.abaId);
        });
      });

      Array.from(outTherapistIds).forEach((abaId) => {
        const bcbaId = supervisionByAba.get(abaId);
        if (bcbaId) outTherapistIds.add(bcbaId);
      });
    } else {
      return res.json({ ok: true, children: [], parents: [], therapists: [], aba: { assignments: [], supervision: [] } });
    }

    const children = (allChildren || []).filter((c) => {
      const id = safeString(c && c.id).trim();
      return id && outChildIds.has(id);
    });
    const parents = (allParents || []).filter((p) => {
      const id = safeString(p && p.id).trim();
      return id && outParentIds.has(id);
    });
    const therapists = (allTherapists || []).filter((t) => {
      const id = safeString(t && t.id).trim();
      return id && outTherapistIds.has(id);
    });

    const abaAssignments = (allAssignments || []).filter((a) => {
      const childId = safeString(a && a.childId).trim();
      const abaId = safeString(a && a.abaId).trim();
      return childId && abaId && outChildIds.has(childId) && outTherapistIds.has(abaId);
    });
    const abaSupervision = (allSupervision || []).filter((s) => {
      const abaId = safeString(s && s.abaId).trim();
      const bcbaId = safeString(s && s.bcbaId).trim();
      return abaId && bcbaId && outTherapistIds.has(abaId) && outTherapistIds.has(bcbaId);
    });

    return res.json({ ok: true, children, parents, therapists, aba: { assignments: abaAssignments, supervision: abaSupervision } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post('/api/directory/merge', authMiddleware, requireAdmin, requireCapability('children:edit'), (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const payloadError = validateDirectoryMergePayload(body);
  if (payloadError) return res.status(400).json({ ok: false, error: payloadError });
  const children = Array.isArray(body.children) ? body.children : [];
  const parents = Array.isArray(body.parents) ? body.parents : [];
  const therapists = Array.isArray(body.therapists) ? body.therapists : [];

  function normalize(items) {
    const out = [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const id = it.id != null ? String(it.id).trim() : '';
      if (!id) continue;
      out.push({ id, item: { ...it, id } });
    }
    return out;
  }

  const c = normalize(children);
  const p = normalize(parents);
  const t = normalize(therapists);
  const now = nowISO();

  const upsertChild = db.prepare(
    'INSERT INTO directory_children (id, data_json, created_at, updated_at) VALUES (?,?,?,?)\n' +
    'ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at'
  );
  const upsertParent = db.prepare(
    'INSERT INTO directory_parents (id, data_json, created_at, updated_at) VALUES (?,?,?,?)\n' +
    'ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at'
  );
  const upsertTherapist = db.prepare(
    'INSERT INTO directory_therapists (id, data_json, created_at, updated_at) VALUES (?,?,?,?)\n' +
    'ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at'
  );

  const tx = db.transaction(() => {
    for (const row of c) upsertChild.run(row.id, JSON.stringify(row.item), now, now);
    for (const row of p) upsertParent.run(row.id, JSON.stringify(row.item), now, now);
    for (const row of t) upsertTherapist.run(row.id, JSON.stringify(row.item), now, now);

    rebuildAbaRelationshipsFromDirectorySqlite(now);
  });

  try {
    tx();
    return res.json({ ok: true, upserted: { children: c.length, parents: p.length, therapists: t.length } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ABA relationship maintenance (admin-only)
app.post('/api/aba/refresh', authMiddleware, requireAdmin, (req, res) => {
  const now = nowISO();
  try {
    const tx = db.transaction(() => rebuildAbaRelationshipsFromDirectorySqlite(now));
    const rebuilt = tx();
    return res.json({ ok: true, rebuilt });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Org settings (arrival/business location). Readable by any authed user; writable by admins.
app.get('/api/org-settings', authMiddleware, (req, res) => {
  try {
    const row = db.prepare('SELECT data_json FROM org_settings WHERE id = ?').get('default');
    let item = null;
    if (row && row.data_json) {
      try { item = JSON.parse(String(row.data_json)); } catch (e) { item = null; }
    }
    return res.json({ ok: true, item });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.put('/api/org-settings', authMiddleware, requireAdmin, requireCapability('settings:system'), (req, res) => {
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const currentItem = readOrgSettingsItemSqlite() || {};
  const address = payload.address != null ? String(payload.address) : '';
  const lat = payload.lat != null ? Number(payload.lat) : null;
  const lng = payload.lng != null ? Number(payload.lng) : null;
  const dropZoneMiles = payload.dropZoneMiles != null ? Number(payload.dropZoneMiles) : null;
  const orgArrivalEnabled = (typeof payload.orgArrivalEnabled === 'boolean') ? payload.orgArrivalEnabled : null;
  const currentBilling = currentItem.billing && typeof currentItem.billing === 'object' ? currentItem.billing : {};
  const payloadBilling = payload.billing && typeof payload.billing === 'object' ? payload.billing : {};

  const item = {
    ...currentItem,
    address,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    dropZoneMiles: Number.isFinite(dropZoneMiles) ? dropZoneMiles : null,
    orgArrivalEnabled: orgArrivalEnabled,
    billing: {
      ...currentBilling,
      paymentPortalUrl: payloadBilling.paymentPortalUrl != null ? String(payloadBilling.paymentPortalUrl).trim() : String(currentBilling.paymentPortalUrl || '').trim(),
      contactEmail: payloadBilling.contactEmail != null ? String(payloadBilling.contactEmail).trim() : String(currentBilling.contactEmail || '').trim(),
      contactPhone: payloadBilling.contactPhone != null ? String(payloadBilling.contactPhone).trim() : String(currentBilling.contactPhone || '').trim(),
      showContactEmail: typeof payloadBilling.showContactEmail === 'boolean' ? payloadBilling.showContactEmail : currentBilling.showContactEmail !== false,
      showContactPhone: typeof payloadBilling.showContactPhone === 'boolean' ? payloadBilling.showContactPhone : currentBilling.showContactPhone !== false,
    },
    programDocumentsByProgramId: normalizeDocumentScopeMap(payload.programDocumentsByProgramId != null ? payload.programDocumentsByProgramId : currentItem.programDocumentsByProgramId),
    campusDocumentsByCampusId: normalizeDocumentScopeMap(payload.campusDocumentsByCampusId != null ? payload.campusDocumentsByCampusId : currentItem.campusDocumentsByCampusId),
  };
  const now = nowISO();

  try {
    db.prepare(
      'INSERT INTO org_settings (id, data_json, created_at, updated_at) VALUES (?,?,?,?)\n' +
      'ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at'
    ).run('default', JSON.stringify(item), now, now);
    recordAuditLog({
      actorId: req.user?.id,
      action: 'org_settings.updated',
      targetType: 'org_settings',
      targetId: 'default',
      details: { orgArrivalEnabled: item.orgArrivalEnabled, hasLocation: Number.isFinite(item.lat) && Number.isFinite(item.lng) },
    });
    return res.json({ ok: true, item });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/api/children/attendance', authMiddleware, (req, res) => {
  try {
    const dateKey = normalizeDateKey(req.query && req.query.date);
    if (!dateKey) return res.status(400).json({ ok: false, error: 'Invalid date' });

    const visibleChildIds = getVisibleChildIdsForUser(req.user);
    if (!visibleChildIds.length) return res.json({ ok: true, dateKey, items: [] });

    const placeholders = visibleChildIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, child_id, recorded_for, status, note, actor_id, actor_role, created_at, updated_at
       FROM attendance_records
       WHERE recorded_for = ? AND child_id IN (${placeholders})
       ORDER BY child_id ASC`
    ).all(dateKey, ...visibleChildIds);

    return res.json({
      ok: true,
      dateKey,
      items: (rows || []).map((row) => ({
        id: row.id,
        childId: row.child_id,
        recordedFor: row.recorded_for,
        status: row.status,
        note: safeString(row.note).trim(),
        actorId: safeString(row.actor_id).trim(),
        actorRole: safeString(row.actor_role).trim(),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.put('/api/children/attendance', authMiddleware, requireChildCareWriteAccess, (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const dateKey = normalizeDateKey(body.date || body.recordedFor);
    if (!dateKey) return res.status(400).json({ ok: false, error: 'Invalid date' });

    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    const entries = (Array.isArray(body.entries) ? body.entries : [])
      .map((entry) => ({
        childId: safeString(entry && entry.childId).trim(),
        status: safeString(entry && entry.status).trim().toLowerCase(),
        note: safeString(entry && entry.note).trim(),
      }))
      .filter((entry) => entry.childId && ['present', 'absent', 'tardy'].includes(entry.status) && visibleChildIds.has(entry.childId));

    if (!entries.length) return res.status(400).json({ ok: false, error: 'No valid attendance entries' });

    const now = nowISO();
    const actorId = safeString(req.user && (req.user.id || req.user.uid)).trim() || null;
    const actorRole = safeString(req.user && req.user.role).trim() || null;
    const upsert = db.prepare(
      'INSERT INTO attendance_records (id, child_id, recorded_for, status, note, actor_id, actor_role, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)\n' +
      'ON CONFLICT(child_id, recorded_for) DO UPDATE SET status=excluded.status, note=excluded.note, actor_id=excluded.actor_id, actor_role=excluded.actor_role, updated_at=excluded.updated_at'
    );

    const tx = db.transaction(() => {
      entries.forEach((entry) => {
        upsert.run(nanoId(), entry.childId, dateKey, entry.status, entry.note || null, actorId, actorRole, now, now);
      });
    });
    tx();

    return res.json({ ok: true, dateKey, saved: entries.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

function parseScheduleIso(value) {
  const raw = safeString(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeScheduleSession(childLike, startDate) {
  const session = safeString(childLike?.session).trim().toUpperCase();
  if (session === 'AM' || session === 'PM') return session;
  return startDate && startDate.getHours() >= 12 ? 'PM' : 'AM';
}

function getScheduleTherapistForSession(childLike, sessionKey) {
  const sessionSpecific = sessionKey === 'PM' ? childLike?.pmTherapist : childLike?.amTherapist;
  if (sessionSpecific) return sessionSpecific;
  const fallbackAssigned = Array.isArray(childLike?.assignedABA) && childLike.assignedABA.length
    ? childLike.assignedABA[0]
    : Array.isArray(childLike?.assigned_ABA) && childLike.assigned_ABA.length
      ? childLike.assigned_ABA[0]
      : childLike?.bcaTherapist;
  return fallbackAssigned || null;
}

function toTherapistIdentity(entry) {
  if (!entry) return { id: '', label: '' };
  if (typeof entry === 'string') {
    const trimmed = safeString(entry).trim();
    return { id: trimmed, label: trimmed };
  }
  const id = safeString(entry.id || entry.uid).trim();
  const label = safeString(entry.name || entry.email || id).trim();
  return { id, label };
}

function formatConflictTimeRange(startDate, endDate) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) return 'the requested time';
  return `${startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

app.put('/api/children/:childId/schedule', authMiddleware, requireChildCareWriteAccess, (req, res) => {
  try {
    const childId = safeString(req.params && req.params.childId).trim();
    if (!childId) return res.status(400).json({ ok: false, error: 'Missing childId' });

    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(childId)) return res.status(403).json({ ok: false, error: 'Forbidden' });

    const row = db.prepare('SELECT data_json FROM directory_children WHERE id = ?').get(childId);
    let currentChild = null;
    try {
      currentChild = row && row.data_json ? JSON.parse(String(row.data_json || '{}')) : null;
    } catch (_) {
      currentChild = null;
    }
    if (!currentChild || typeof currentChild !== 'object') return res.status(404).json({ ok: false, error: 'Child not found' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const providedSession = body.session === undefined ? null : safeString(body.session).trim().toUpperCase();
    if (providedSession && !['AM', 'PM'].includes(providedSession)) {
      return res.status(400).json({ ok: false, error: 'Session must be AM or PM' });
    }

    const providedDropoffTimeISO = body.dropoffTimeISO === undefined ? null : safeString(body.dropoffTimeISO).trim();
    const providedPickupTimeISO = body.pickupTimeISO === undefined ? null : safeString(body.pickupTimeISO).trim();
    if (providedDropoffTimeISO && Number.isNaN(Date.parse(providedDropoffTimeISO))) {
      return res.status(400).json({ ok: false, error: 'dropoffTimeISO must be a valid ISO timestamp' });
    }
    if (providedPickupTimeISO && Number.isNaN(Date.parse(providedPickupTimeISO))) {
      return res.status(400).json({ ok: false, error: 'pickupTimeISO must be a valid ISO timestamp' });
    }

    let assignedIds = null;
    if (body.assignedABA !== undefined || body.assigned_ABA !== undefined) {
      const rawAssigned = Array.isArray(body.assignedABA)
        ? body.assignedABA
        : Array.isArray(body.assigned_ABA)
          ? body.assigned_ABA
          : [];
      assignedIds = Array.from(new Set(rawAssigned.map((value) => safeString(value).trim()).filter(Boolean)));
    }

    const nextChild = {
      ...currentChild,
      id: childId,
      updatedAt: nowISO(),
    };
    const changedFields = [];

    if (providedSession) {
      nextChild.session = providedSession;
      changedFields.push('session');
    }
    if (body.room !== undefined) {
      nextChild.room = safeString(body.room).trim() || 'Room TBD';
      changedFields.push('room');
    }
    if (body.dropoffTimeISO !== undefined) {
      nextChild.dropoffTimeISO = providedDropoffTimeISO || null;
      changedFields.push('dropoffTimeISO');
    }
    if (body.pickupTimeISO !== undefined) {
      nextChild.pickupTimeISO = providedPickupTimeISO || null;
      changedFields.push('pickupTimeISO');
    }
    if (assignedIds) {
      nextChild.assignedABA = assignedIds;
      nextChild.assigned_ABA = assignedIds;
      changedFields.push('assignedABA');
    }
    if (body.amTherapist !== undefined) {
      nextChild.amTherapist = body.amTherapist || null;
      changedFields.push('amTherapist');
    }
    if (body.pmTherapist !== undefined) {
      nextChild.pmTherapist = body.pmTherapist || null;
      changedFields.push('pmTherapist');
    }
    if (body.scheduleApproval !== undefined) {
      const approval = body.scheduleApproval && typeof body.scheduleApproval === 'object' ? body.scheduleApproval : null;
      nextChild.scheduleApproval = approval ? {
        status: safeString(approval.status).trim() || 'pending',
        submittedAt: approval.submittedAt ? safeString(approval.submittedAt).trim() : null,
        submittedById: approval.submittedById ? safeString(approval.submittedById).trim() : null,
        submittedByName: approval.submittedByName ? safeString(approval.submittedByName).trim() : null,
        approvedAt: approval.approvedAt ? safeString(approval.approvedAt).trim() : null,
        approvedById: approval.approvedById ? safeString(approval.approvedById).trim() : null,
        approvedByName: approval.approvedByName ? safeString(approval.approvedByName).trim() : null,
      } : null;
      changedFields.push('scheduleApproval');
    }
    if (body.scheduleStatus !== undefined || body.status !== undefined) {
      const nextStatus = safeString(body.scheduleStatus !== undefined ? body.scheduleStatus : body.status).trim().toLowerCase();
      nextChild.scheduleStatus = nextStatus || null;
      nextChild.status = nextStatus || null;
      changedFields.push('scheduleStatus');
    }
    if (body.cancellationReason !== undefined) {
      nextChild.cancellationReason = safeString(body.cancellationReason).trim() || '';
      changedFields.push('cancellationReason');
    }
    if (body.canceledAt !== undefined) {
      nextChild.canceledAt = body.canceledAt ? safeString(body.canceledAt).trim() : null;
      changedFields.push('canceledAt');
    }
    if (body.canceledById !== undefined) {
      nextChild.canceledById = body.canceledById ? safeString(body.canceledById).trim() : null;
      changedFields.push('canceledById');
    }
    if (body.canceledByName !== undefined) {
      nextChild.canceledByName = body.canceledByName ? safeString(body.canceledByName).trim() : null;
      changedFields.push('canceledByName');
    }

    const nextStart = parseScheduleIso(nextChild.dropoffTimeISO);
    const nextEnd = parseScheduleIso(nextChild.pickupTimeISO);
    if (nextStart && nextEnd && nextStart.getTime() >= nextEnd.getTime()) {
      return res.status(400).json({ ok: false, error: 'Session end time must be later than the start time.' });
    }

    if (nextStart && nextEnd) {
      const nextSession = normalizeScheduleSession(nextChild, nextStart);
      const assignedTherapist = toTherapistIdentity(getScheduleTherapistForSession(nextChild, nextSession));
      if (assignedTherapist.id) {
        const allRows = db.prepare('SELECT id, data_json FROM directory_children WHERE id <> ?').all(childId);
        const conflictingChild = allRows
          .map((entry) => ({ id: safeString(entry?.id).trim(), item: safeJsonParse(String(entry?.data_json || ''), null) }))
          .filter((entry) => entry.item && typeof entry.item === 'object')
          .find((entry) => {
            const candidate = entry.item;
            const candidateStatus = safeString(candidate.scheduleStatus || candidate.status).trim().toLowerCase();
            if (candidateStatus === 'canceled') return false;
            const candidateStart = parseScheduleIso(candidate.dropoffTimeISO);
            const candidateEnd = parseScheduleIso(candidate.pickupTimeISO);
            if (!candidateStart || !candidateEnd) return false;
            if (candidateStart.getTime() >= candidateEnd.getTime()) return false;
            const candidateSession = normalizeScheduleSession(candidate, candidateStart);
            const candidateTherapist = toTherapistIdentity(getScheduleTherapistForSession(candidate, candidateSession));
            if (!candidateTherapist.id || candidateTherapist.id !== assignedTherapist.id) return false;
            return nextStart.getTime() < candidateEnd.getTime() && nextEnd.getTime() > candidateStart.getTime();
          });

        if (conflictingChild?.item) {
          const conflictingStart = parseScheduleIso(conflictingChild.item.dropoffTimeISO);
          const conflictingEnd = parseScheduleIso(conflictingChild.item.pickupTimeISO);
          const therapistLabel = assignedTherapist.label || 'The selected therapist';
          const learnerLabel = safeString(conflictingChild.item.name).trim() || 'another learner';
          return res.status(409).json({
            ok: false,
            code: 'BB_SCHEDULE_CONFLICT',
            error: `${therapistLabel} is already booked with ${learnerLabel} during ${formatConflictTimeRange(conflictingStart, conflictingEnd)}.`,
          });
        }
      }
    }

    const now = nowISO();
    const tx = db.transaction(() => {
      db.prepare('UPDATE directory_children SET data_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(nextChild), now, childId);
      if (changedFields.includes('assignedABA') || changedFields.includes('amTherapist') || changedFields.includes('pmTherapist')) {
        rebuildAbaRelationshipsFromDirectorySqlite(now);
      }
    });
    tx();

    recordAuditLog({
      actorId: req.user?.id || req.user?.uid,
      action: 'child_schedule.updated',
      targetType: 'child',
      targetId: childId,
      details: { changedFields, session: nextChild.session || '', assignedABA: nextChild.assignedABA || [] },
    });

    if (String(nextChild.scheduleStatus || nextChild.status || '').trim().toLowerCase() === 'canceled' && changedFields.includes('scheduleStatus')) {
      notifyAdminsOfScheduleCancellation(nextChild, {
        childId,
        session: nextChild.session,
        cancellationReason: nextChild.cancellationReason,
        canceledByName: nextChild.canceledByName,
        canceledAt: nextChild.canceledAt,
      }).catch(() => {});
    }

    return res.json({ ok: true, item: nextChild });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/api/children/:childId/attendance', authMiddleware, (req, res) => {
  try {
    const childId = safeString(req.params && req.params.childId).trim();
    if (!childId) return res.status(400).json({ ok: false, error: 'Missing childId' });

    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(childId)) return res.status(403).json({ ok: false, error: 'Forbidden' });

    const limit = Math.max(1, Math.min(Number(req.query && req.query.limit) || 365, 1000));
    const rows = db.prepare(
      'SELECT id, child_id, recorded_for, status, note, actor_id, actor_role, created_at, updated_at FROM attendance_records WHERE child_id = ? ORDER BY recorded_for DESC, updated_at DESC LIMIT ?'
    ).all(childId, limit);

    return res.json({
      ok: true,
      childId,
      items: (rows || []).map((row) => ({
        id: row.id,
        childId: row.child_id,
        recordedFor: row.recorded_for,
        status: row.status,
        note: safeString(row.note).trim(),
        actorId: safeString(row.actor_id).trim(),
        actorRole: safeString(row.actor_role).trim(),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/api/children/:childId/mood', authMiddleware, (req, res) => {
  try {
    const childId = safeString(req.params && req.params.childId).trim();
    if (!childId) return res.status(400).json({ ok: false, error: 'Missing childId' });

    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(childId)) return res.status(403).json({ ok: false, error: 'Forbidden' });

    const limit = Math.max(1, Math.min(Number(req.query && req.query.limit) || 60, 200));
    const rows = db.prepare(
      'SELECT id, child_id, score, note, actor_id, actor_role, recorded_at, created_at FROM mood_entries WHERE child_id = ? ORDER BY recorded_at DESC, created_at DESC LIMIT ?'
    ).all(childId, limit);

    return res.json({
      ok: true,
      childId,
      items: (rows || []).map((row) => ({
        id: row.id,
        childId: row.child_id,
        score: Number(row.score),
        note: safeString(row.note).trim(),
        actorId: safeString(row.actor_id).trim(),
        actorRole: safeString(row.actor_role).trim(),
        recordedAt: row.recorded_at,
        createdAt: row.created_at,
      })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post('/api/children/:childId/mood', authMiddleware, requireChildCareWriteAccess, (req, res) => {
  try {
    const childId = safeString(req.params && req.params.childId).trim();
    if (!childId) return res.status(400).json({ ok: false, error: 'Missing childId' });

    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(childId)) return res.status(403).json({ ok: false, error: 'Forbidden' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const score = normalizeMoodScore(body.score);
    if (score == null) return res.status(400).json({ ok: false, error: 'Mood score must be an integer between 1 and 15' });

    const item = {
      id: nanoId(),
      childId,
      score,
      note: safeString(body.note).trim(),
      actorId: safeString(req.user && (req.user.id || req.user.uid)).trim(),
      actorRole: safeString(req.user && req.user.role).trim(),
      recordedAt: safeString(body.recordedAt).trim() || nowISO(),
      createdAt: nowISO(),
    };

    db.prepare(
      'INSERT INTO mood_entries (id, child_id, score, note, actor_id, actor_role, recorded_at, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(item.id, item.childId, item.score, item.note || null, item.actorId || null, item.actorRole || null, item.recordedAt, item.createdAt);

    return res.json({ ok: true, item });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post('/api/therapy-sessions', authMiddleware, requireChildCareWriteAccess, (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const childId = safeString(body.childId).trim();
    if (!childId) return res.status(400).json({ ok: false, error: 'childId required' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(childId)) return res.status(403).json({ ok: false, error: 'Forbidden' });

    const existing = db.prepare('SELECT * FROM therapy_sessions WHERE child_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1').get(childId, 'active');
    if (existing) return res.status(409).json({ ok: false, error: 'An active session already exists for this child.', item: buildTherapySessionResponse(existing) });

    const now = nowISO();
    const item = {
      id: nanoId(),
      childId,
      childName: safeString(body.childName).trim() || getChildDisplayNameByIdSqlite(childId),
      therapistId: safeString(req.user && (req.user.id || req.user.uid)).trim(),
      therapistRole: safeString(req.user && req.user.role).trim(),
      organizationId: safeString(body.organizationId).trim() || null,
      programId: safeString(body.programId).trim() || null,
      campusId: safeString(body.campusId).trim() || null,
      sessionDate: normalizeDateKey(body.sessionDate || body.startedAt || now),
      sessionType: normalizeTherapySessionType(body.sessionType),
      startedAt: safeString(body.startedAt).trim() || now,
      endedAt: null,
      status: 'active',
      summaryGeneratedAt: null,
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    if (!item.sessionDate) return res.status(400).json({ ok: false, error: 'sessionDate must be a valid date' });

    db.prepare(
      'INSERT INTO therapy_sessions (id, child_id, child_name, therapist_id, therapist_role, organization_id, program_id, campus_id, session_date, session_type, started_at, ended_at, status, summary_generated_at, approved_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(item.id, item.childId, item.childName || null, item.therapistId, item.therapistRole || null, item.organizationId, item.programId, item.campusId, item.sessionDate, item.sessionType, item.startedAt, item.endedAt, item.status, item.summaryGeneratedAt, item.approvedAt, item.createdAt, item.updatedAt);

    recordAuditLog({ actorId: req.user?.id, action: 'therapy_session.started', targetType: 'therapy_session', targetId: item.id, details: { childId: item.childId, sessionType: item.sessionType } });
    return res.status(201).json({ ok: true, item: buildTherapySessionResponse(getTherapySessionRowSqlite(item.id)) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/api/therapy-sessions/active', authMiddleware, (req, res) => {
  try {
    const childId = safeString(req.query && req.query.childId).trim();
    if (!childId) return res.status(400).json({ ok: false, error: 'childId required' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(childId)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const row = db.prepare('SELECT * FROM therapy_sessions WHERE child_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1').get(childId, 'active');
    return res.json({ ok: true, item: buildTherapySessionResponse(row) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post('/api/therapy-sessions/:sessionId/events', authMiddleware, requireChildCareWriteAccess, (req, res) => {
  try {
    const sessionId = safeString(req.params && req.params.sessionId).trim();
    const session = getTherapySessionRowSqlite(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    if (safeString(session.status).trim().toLowerCase() !== 'active') return res.status(409).json({ ok: false, error: 'Session is no longer active' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(session.child_id)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const item = normalizeTherapyEvent(req.body && req.body.event ? req.body.event : req.body, session, req.user);
    const payloadError = validateTherapyEventPayload(item);
    if (payloadError) return res.status(400).json({ ok: false, error: payloadError });

    db.prepare('INSERT INTO therapy_session_events (id, session_id, child_id, therapist_id, event_type, event_code, label, value_json, intensity, frequency_delta, metadata_json, occurred_at, source, client_event_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(item.id, item.sessionId, item.childId, item.therapistId || null, item.eventType, item.eventCode, item.label || null, JSON.stringify(item.value), item.intensity || null, item.frequencyDelta, JSON.stringify(item.metadata || {}), item.occurredAt, item.source || null, item.clientEventId, item.createdAt);

    db.prepare('UPDATE therapy_sessions SET updated_at = ? WHERE id = ?').run(nowISO(), sessionId);
    return res.status(201).json({ ok: true, item: buildTherapySessionEventResponse(db.prepare('SELECT * FROM therapy_session_events WHERE id = ?').get(item.id)) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/api/therapy-sessions/:sessionId/events', authMiddleware, (req, res) => {
  try {
    const sessionId = safeString(req.params && req.params.sessionId).trim();
    const session = getTherapySessionRowSqlite(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(session.child_id)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const limit = Math.max(1, Math.min(Number(req.query && req.query.limit) || 40, 200));
    const rows = db.prepare('SELECT * FROM therapy_session_events WHERE session_id = ? ORDER BY occurred_at DESC, created_at DESC LIMIT ?').all(sessionId, limit);
    return res.json({ ok: true, sessionId, items: (rows || []).map((row) => buildTherapySessionEventResponse(row)) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post('/api/therapy-sessions/:sessionId/events/bulk', authMiddleware, requireChildCareWriteAccess, (req, res) => {
  try {
    const sessionId = safeString(req.params && req.params.sessionId).trim();
    const session = getTherapySessionRowSqlite(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    if (safeString(session.status).trim().toLowerCase() !== 'active') return res.status(409).json({ ok: false, error: 'Session is no longer active' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(session.child_id)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const rawEntries = Array.isArray(req.body?.events) ? req.body.events : [];
    if (rawEntries.length > 250) return res.status(400).json({ ok: false, error: 'Too many events supplied' });
    const entries = rawEntries.map((entry) => normalizeTherapyEvent(entry, session, req.user)).filter(Boolean);
    const invalidEntry = entries.map((entry) => validateTherapyEventPayload(entry)).find(Boolean);
    if (invalidEntry) return res.status(400).json({ ok: false, error: invalidEntry });
    if (!entries.length) return res.status(400).json({ ok: false, error: 'No valid events supplied' });

    const insert = db.prepare('INSERT INTO therapy_session_events (id, session_id, child_id, therapist_id, event_type, event_code, label, value_json, intensity, frequency_delta, metadata_json, occurred_at, source, client_event_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const tx = db.transaction(() => {
      entries.forEach((item) => {
        insert.run(item.id, item.sessionId, item.childId, item.therapistId || null, item.eventType, item.eventCode, item.label || null, JSON.stringify(item.value), item.intensity || null, item.frequencyDelta, JSON.stringify(item.metadata || {}), item.occurredAt, item.source || null, item.clientEventId, item.createdAt);
      });
    });
    tx();
    db.prepare('UPDATE therapy_sessions SET updated_at = ? WHERE id = ?').run(nowISO(), sessionId);
    return res.status(201).json({ ok: true, items: entries.map((item) => buildTherapySessionEventResponse(db.prepare('SELECT * FROM therapy_session_events WHERE id = ?').get(item.id))) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Therapy-event change request: a therapist submits a request to edit or remove
// an already-recorded therapy event. The request is stored in audit_logs and
// surfaces via the existing /api/audit-logs admin viewer. Mutation of the
// underlying event row is deliberately deferred to a follow-up admin review
// flow so this endpoint can ship without schema changes. It replaces the
// prior placeholder Alert.alert handlers in the client.
app.post('/api/therapy-sessions/:sessionId/events/:eventId/change-request', authMiddleware, requireChildCareWriteAccess, (req, res) => {
  try {
    const sessionId = safeString(req.params && req.params.sessionId).trim();
    const eventId = safeString(req.params && req.params.eventId).trim();
    if (!sessionId || !eventId) return res.status(400).json({ ok: false, error: 'sessionId and eventId required' });
    const session = getTherapySessionRowSqlite(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(session.child_id)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const eventRow = db.prepare('SELECT * FROM therapy_session_events WHERE id = ? AND session_id = ?').get(eventId, sessionId);
    if (!eventRow) return res.status(404).json({ ok: false, error: 'Event not found' });

    const body = req.body || {};
    const action = String(body.action || '').trim().toLowerCase();
    if (action !== 'edit' && action !== 'remove') {
      return res.status(400).json({ ok: false, error: 'action must be "edit" or "remove"' });
    }
    const reason = safeString(body.reason).trim().slice(0, 1000);
    const proposed = (action === 'edit' && body.proposed && typeof body.proposed === 'object') ? body.proposed : null;

    const requestId = nanoId();
    recordAuditLog({
      actorId: req.user?.id,
      action: 'therapy_event.change_request_submitted',
      targetType: 'therapy_session_event',
      targetId: eventId,
      status: 'pending',
      details: {
        requestId,
        sessionId,
        eventId,
        childId: session.child_id,
        changeAction: action,
        reason: reason || null,
        proposed,
      },
    });
    return res.status(201).json({ ok: true, requestId, status: 'pending' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post('/api/therapy-sessions/:sessionId/end', authMiddleware, requireChildCareWriteAccess, (req, res) => {
  try {
    const sessionId = safeString(req.params && req.params.sessionId).trim();
    const session = getTherapySessionRowSqlite(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(session.child_id)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const endedAt = safeString(req.body?.endedAt).trim() || nowISO();
    db.prepare('UPDATE therapy_sessions SET ended_at = ?, status = ?, summary_generated_at = ?, updated_at = ? WHERE id = ?').run(endedAt, 'summary_draft', endedAt, nowISO(), sessionId);
    const summaryRow = generateTherapySessionSummarySqlite(sessionId, null);
    return res.json({ ok: true, item: buildTherapySessionResponse(getTherapySessionRowSqlite(sessionId)), summary: buildTherapySessionSummaryResponse(summaryRow) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post('/api/therapy-sessions/:sessionId/generate-summary', authMiddleware, requireChildCareWriteAccess, (req, res) => {
  try {
    const sessionId = safeString(req.params && req.params.sessionId).trim();
    const session = getTherapySessionRowSqlite(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(session.child_id)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const summaryRow = generateTherapySessionSummarySqlite(sessionId, null);
    db.prepare('UPDATE therapy_sessions SET status = ?, summary_generated_at = ?, updated_at = ? WHERE id = ?').run('summary_draft', nowISO(), nowISO(), sessionId);
    return res.json({ ok: true, summary: buildTherapySessionSummaryResponse(summaryRow) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/api/therapy-sessions/:sessionId/summary', authMiddleware, (req, res) => {
  try {
    const sessionId = safeString(req.params && req.params.sessionId).trim();
    const session = getTherapySessionRowSqlite(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(session.child_id)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const summary = getTherapySessionSummaryRowSqlite(sessionId);
    if (!summary) return res.status(404).json({ ok: false, error: 'Summary not found' });
    return res.json({ ok: true, item: buildTherapySessionSummaryResponse(summary) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.put('/api/therapy-sessions/:sessionId/summary', authMiddleware, requireChildCareWriteAccess, (req, res) => {
  try {
    const sessionId = safeString(req.params && req.params.sessionId).trim();
    const session = getTherapySessionRowSqlite(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(session.child_id)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const overrideSummary = req.body && typeof req.body.summary === 'object' ? req.body.summary : (req.body && typeof req.body === 'object' ? req.body : null);
    if (!overrideSummary || typeof overrideSummary !== 'object') return res.status(400).json({ ok: false, error: 'summary object required' });
    const summaryRow = generateTherapySessionSummarySqlite(sessionId, overrideSummary);
    db.prepare('UPDATE therapy_sessions SET status = ?, updated_at = ? WHERE id = ?').run('summary_draft', nowISO(), sessionId);
    return res.json({ ok: true, item: buildTherapySessionSummaryResponse(summaryRow) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post('/api/therapy-sessions/:sessionId/summary/approve', authMiddleware, requireChildCareWriteAccess, (req, res) => {
  try {
    const sessionId = safeString(req.params && req.params.sessionId).trim();
    const session = getTherapySessionRowSqlite(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(session.child_id)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const existing = getTherapySessionSummaryRowSqlite(sessionId);
    if (!existing) return res.status(404).json({ ok: false, error: 'Summary not found' });
    const overrideSummary = req.body && typeof req.body.summary === 'object' ? req.body.summary : safeJsonParse(safeString(existing.summary_json), null);
    const approvedAt = nowISO();
    const summary = buildTherapySessionSummary({
      sessionId: session.id,
      sessionDate: session.session_date,
      childId: session.child_id,
      childName: safeString(session.child_name).trim() || getChildDisplayNameByIdSqlite(session.child_id),
      events: db.prepare('SELECT * FROM therapy_session_events WHERE session_id = ? ORDER BY occurred_at ASC, created_at ASC').all(sessionId).map((row) => buildTherapySessionEventResponse(row)),
      existingSummary: { ...(overrideSummary || {}), therapistEdited: true, approvedByTherapistId: safeString(req.user?.id).trim(), approvedAt },
    });
    const summaryRow = upsertTherapySessionSummarySqlite({ session: { ...session, approved_at: approvedAt }, summary, status: 'approved', approvedAt });
    db.prepare('UPDATE therapy_sessions SET status = ?, approved_at = ?, updated_at = ? WHERE id = ?').run('submitted', approvedAt, nowISO(), sessionId);
    recordAuditLog({ actorId: req.user?.id, action: 'therapy_session.summary_approved', targetType: 'therapy_session', targetId: sessionId, details: { childId: session.child_id } });
    return res.json({ ok: true, item: buildTherapySessionSummaryResponse(summaryRow) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/api/children/:childId/session-summaries', authMiddleware, (req, res) => {
  try {
    const childId = safeString(req.params && req.params.childId).trim();
    if (!childId) return res.status(400).json({ ok: false, error: 'Missing childId' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(childId)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const limit = Math.max(1, Math.min(Number(req.query && req.query.limit) || 20, 100));
    const rows = db.prepare('SELECT * FROM therapy_session_summaries WHERE child_id = ? AND status = ? ORDER BY COALESCE(approved_at, updated_at) DESC LIMIT ?').all(childId, 'approved', limit);
    return res.json({ ok: true, childId, items: (rows || []).map((row) => buildTherapySessionSummaryResponse(row)) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/api/children/:childId/session-summaries/latest', authMiddleware, (req, res) => {
  try {
    const childId = safeString(req.params && req.params.childId).trim();
    if (!childId) return res.status(400).json({ ok: false, error: 'Missing childId' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(childId)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const row = db.prepare('SELECT * FROM therapy_session_summaries WHERE child_id = ? AND status = ? ORDER BY COALESCE(approved_at, updated_at) DESC LIMIT 1').get(childId, 'approved');
    return res.json({ ok: true, childId, item: buildTherapySessionSummaryResponse(row) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

function buildEmptyChildProgressInsights(childId) {
  return {
    ok: true,
    childId,
    range: { from: '', to: '' },
    stats: {
      sessions: 0,
      approvedSummaries: 0,
      averageMood: null,
      successCriteriaCount: 0,
      programsWorkedOnCount: 0,
      behaviorEventsCount: 0,
    },
    trends: {
      mood: [],
      behaviorFrequency: [],
      independence: [],
      progressLevel: [],
    },
    latestSummary: null,
  };
}

function buildEmptyTherapistDocumentationInsights() {
  return {
    ok: true,
    stats: {
      sessionsEnded: 0,
      summariesGenerated: 0,
      summariesApproved: 0,
      overdueSummaries: 0,
    },
    items: [],
  };
}

function buildEmptyOrganizationInsights() {
  return {
    ok: true,
    stats: {
      activeChildren: 0,
      sessions: 0,
      approvedSummaries: 0,
      activeCampuses: 0,
    },
    campuses: [],
    programs: [],
  };
}

function summarizeApprovedSessionRows(rows) {
  const items = (Array.isArray(rows) ? rows : []).map((row) => buildTherapySessionSummaryResponse(row)).filter(Boolean);
  const moodValues = [];
  let successCriteriaCount = 0;
  let programsWorkedOnCount = 0;
  let behaviorEventsCount = 0;
  function progressOrdinal(value) {
    const normalized = safeString(value).trim().toLowerCase();
    if (normalized.includes('significant')) return 4;
    if (normalized.includes('moderate')) return 3;
    if (normalized.includes('minimal') || normalized.includes('slight')) return 2;
    if (normalized.includes('no')) return 1;
    return 0;
  }
  const trends = { mood: [], behaviorFrequency: [], independence: [], progressLevel: [] };
  items.forEach((item) => {
    const sessionDate = safeString(item?.sessionDate).trim();
    let label = '—';
    try {
      label = sessionDate ? new Date(sessionDate).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—';
    } catch (_) {
      label = '—';
    }
    const summary = item?.summary || {};
    const moodValue = Number(summary?.moodScore?.selectedValue);
    const successCount = Array.isArray(summary?.successCriteriaMet) ? summary.successCriteriaMet.length : 0;
    const programCount = Array.isArray(summary?.programsWorkedOn) ? summary.programsWorkedOn.length : 0;
    const behaviorCount = (Array.isArray(summary?.interferingBehaviors) ? summary.interferingBehaviors : []).reduce((sum, behavior) => sum + (Number(behavior?.frequency) || 0), 0);
    successCriteriaCount += successCount;
    programsWorkedOnCount += programCount;
    behaviorEventsCount += behaviorCount;
    if (Number.isFinite(moodValue)) moodValues.push(moodValue);
    trends.mood.push({ label, value: Number.isFinite(moodValue) ? moodValue : 0 });
    trends.behaviorFrequency.push({ label, value: behaviorCount });
    trends.independence.push({ label, value: progressOrdinal(summary?.dailyRecap?.independenceLevel) });
    trends.progressLevel.push({ label, value: progressOrdinal(summary?.dailyRecap?.progressLevel) });
  });
  return {
    items,
    stats: {
      sessions: items.length,
      approvedSummaries: items.length,
      averageMood: moodValues.length ? Math.round((moodValues.reduce((sum, value) => sum + value, 0) / moodValues.length) * 10) / 10 : null,
      successCriteriaCount,
      programsWorkedOnCount,
      behaviorEventsCount,
    },
    trends,
    latestSummary: items[0] || null,
  };
}

function safeSelectTherapySummaryRowsByChildSqlite(childId, limit) {
  try {
    return db.prepare('SELECT * FROM therapy_session_summaries WHERE child_id = ? AND status = ? ORDER BY COALESCE(approved_at, updated_at) DESC LIMIT ?').all(childId, 'approved', limit);
  } catch (_) {
    return [];
  }
}

function safeSelectTherapySessionsByChildIdsSqlite(childIds) {
  if (!Array.isArray(childIds) || !childIds.length) return [];
  try {
    const placeholders = childIds.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM therapy_sessions WHERE child_id IN (${placeholders})`).all(...childIds);
  } catch (_) {
    return [];
  }
}

function safeSelectTherapySummaryRowsByChildIdsSqlite(childIds) {
  if (!Array.isArray(childIds) || !childIds.length) return [];
  try {
    const placeholders = childIds.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM therapy_session_summaries WHERE child_id IN (${placeholders}) AND status = ? ORDER BY COALESCE(approved_at, updated_at) DESC`).all(...childIds, 'approved');
  } catch (_) {
    return [];
  }
}

app.get('/api/children/:childId/progress-insights', authMiddleware, (req, res) => {
  try {
    const childId = safeString(req.params && req.params.childId).trim();
    if (!childId) return res.status(400).json({ ok: false, error: 'Missing childId' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(childId)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const limit = Math.max(1, Math.min(Number(req.query && req.query.limit) || 20, 100));
    const rows = safeSelectTherapySummaryRowsByChildSqlite(childId, limit);
    const emptyPayload = buildEmptyChildProgressInsights(childId);
    const aggregated = summarizeApprovedSessionRows(rows);
    return res.json({
      ...emptyPayload,
      range: {
        from: aggregated.items.length ? safeString(aggregated.items[aggregated.items.length - 1]?.sessionDate).trim() : '',
        to: aggregated.items.length ? safeString(aggregated.items[0]?.sessionDate).trim() : '',
      },
      stats: aggregated.stats,
      trends: aggregated.trends,
      latestSummary: aggregated.latestSummary,
    });
  } catch (_) {
    return res.json(buildEmptyChildProgressInsights(safeString(req.params && req.params.childId).trim()));
  }
});

app.get('/api/insights/therapist-documentation', authMiddleware, (req, res) => {
  try {
    const userId = safeString(req.user?.id).trim();
    const visibleChildIds = getVisibleChildIdsForUser(req.user);
    if (!visibleChildIds.length) return res.json(buildEmptyTherapistDocumentationInsights());
    const limit = Math.max(1, Math.min(Number(req.query?.limit) || 10, 50));
    const placeholders = visibleChildIds.map(() => '?').join(',');
    const sessionRows = db.prepare(`SELECT * FROM therapy_sessions WHERE child_id IN (${placeholders}) AND therapist_id = ? ORDER BY COALESCE(ended_at, updated_at, created_at) DESC`).all(...visibleChildIds, userId);
    const summaryRows = db.prepare(`SELECT * FROM therapy_session_summaries WHERE child_id IN (${placeholders}) ORDER BY COALESCE(approved_at, updated_at) DESC`).all(...visibleChildIds);
    const summariesBySessionId = new Map((summaryRows || []).map((row) => [safeString(row.session_id).trim(), buildTherapySessionSummaryResponse(row)]));
    const items = (sessionRows || []).slice(0, limit).map((session) => {
      const summary = summariesBySessionId.get(safeString(session.id).trim()) || null;
      const status = summary?.status || (safeString(session.status).trim() === 'submitted' ? 'approved' : 'needs_review');
      return {
        sessionId: session.id,
        childId: session.child_id,
        childName: safeString(session.child_name).trim() || getChildDisplayNameByIdSqlite(session.child_id),
        sessionDate: safeString(session.session_date).trim(),
        sessionDateLabel: safeString(session.session_date).trim() ? new Date(session.session_date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'No date',
        status,
        statusLabel: status === 'approved' ? 'Approved' : 'Needs review',
      };
    });
    return res.json({
      ok: true,
      stats: {
        sessionsEnded: (sessionRows || []).filter((row) => safeString(row.ended_at).trim()).length,
        summariesGenerated: (sessionRows || []).filter((row) => safeString(row.summary_generated_at).trim()).length,
        summariesApproved: (summaryRows || []).filter((row) => safeString(row.status).trim() === 'approved').length,
        overdueSummaries: (sessionRows || []).filter((row) => safeString(row.ended_at).trim() && safeString(row.status).trim() !== 'submitted').length,
      },
      items,
    });
  } catch (_) {
    return res.json(buildEmptyTherapistDocumentationInsights());
  }
});

app.get('/api/insights/organization', authMiddleware, (req, res) => {
  try {
    const visibleChildIds = getVisibleChildIdsForUser(req.user);
    if (!visibleChildIds.length) return res.json(buildEmptyOrganizationInsights());
    const sessionRows = safeSelectTherapySessionsByChildIdsSqlite(visibleChildIds);
    const summaryRows = safeSelectTherapySummaryRowsByChildIdsSqlite(visibleChildIds);
    const campusMap = new Map();
    const programMap = new Map();
    (sessionRows || []).forEach((session) => {
      const campusId = safeString(session.campus_id).trim() || 'unassigned-campus';
      const programId = safeString(session.program_id).trim() || 'unassigned-program';
      if (!campusMap.has(campusId)) campusMap.set(campusId, { id: campusId, name: campusId === 'unassigned-campus' ? 'Unassigned campus' : campusId, sessions: 0, approvedSummaries: 0, averageMood: null, behaviorEvents: 0 });
      if (!programMap.has(programId)) programMap.set(programId, { id: programId, title: programId === 'unassigned-program' ? 'Unassigned program' : programId, status: '', childName: '', sessionDateLabel: '', sessions: 0, approvedSummaries: 0 });
      campusMap.get(campusId).sessions += 1;
      programMap.get(programId).sessions += 1;
    });
    (summaryRows || []).forEach((row) => {
      const summary = buildTherapySessionSummaryResponse(row);
      const relatedSession = (sessionRows || []).find((session) => safeString(session.id).trim() === safeString(row.session_id).trim()) || null;
      const campusId = safeString(relatedSession?.campus_id).trim() || 'unassigned-campus';
      const programId = safeString(relatedSession?.program_id).trim() || 'unassigned-program';
      const campus = campusMap.get(campusId) || { id: campusId, name: campusId, sessions: 0, approvedSummaries: 0, averageMood: null, behaviorEvents: 0 };
      const program = programMap.get(programId) || { id: programId, title: programId, status: '', childName: '', sessionDateLabel: '', sessions: 0, approvedSummaries: 0 };
      const moodValue = Number(summary?.summary?.moodScore?.selectedValue);
      const behaviorEvents = (Array.isArray(summary?.summary?.interferingBehaviors) ? summary.summary.interferingBehaviors : []).reduce((sum, item) => sum + (Number(item?.frequency) || 0), 0);
      campus.approvedSummaries += 1;
      campus.behaviorEvents += behaviorEvents;
      campus._moodTotal = (campus._moodTotal || 0) + (Number.isFinite(moodValue) ? moodValue : 0);
      campus._moodCount = (campus._moodCount || 0) + (Number.isFinite(moodValue) ? 1 : 0);
      program.approvedSummaries += 1;
      program.status = `${program.approvedSummaries} approved summaries`;
      campusMap.set(campusId, campus);
      programMap.set(programId, program);
    });
    const campuses = Array.from(campusMap.values()).map((campus) => ({
      ...campus,
      averageMood: campus._moodCount ? Math.round((campus._moodTotal / campus._moodCount) * 10) / 10 : null,
      approvalRateLabel: campus.sessions ? `${Math.round((campus.approvedSummaries / campus.sessions) * 100)}%` : '0%',
    }));
    const programs = Array.from(programMap.values()).map((program) => ({
      ...program,
      title: program.title || program.id || 'Program',
      childName: `${program.sessions} sessions`,
      sessionDateLabel: `${program.approvedSummaries} approved`,
      status: program.status || `${program.approvedSummaries} approved summaries`,
    }));
    return res.json({
      ok: true,
      stats: {
        activeChildren: visibleChildIds.length,
        sessions: sessionRows.length,
        approvedSummaries: summaryRows.length,
        activeCampuses: campuses.filter((campus) => campus.sessions > 0 || campus.approvedSummaries > 0).length,
      },
      campuses,
      programs,
    });
  } catch (_) {
    return res.json(buildEmptyOrganizationInsights());
  }
});

app.get('/api/therapy-sessions/:sessionId/artifacts/session-summary.txt', authMiddleware, (req, res) => {
  try {
    const sessionId = safeString(req.params && req.params.sessionId).trim();
    const session = getTherapySessionRowSqlite(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const visibleChildIds = new Set(getVisibleChildIdsForUser(req.user));
    if (!visibleChildIds.has(session.child_id)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const row = getTherapySessionSummaryRowSqlite(sessionId);
    if (!row) return res.status(404).json({ ok: false, error: 'Summary not found' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${DEFAULT_SUMMARY_FILENAME}"`);
    return res.send(safeString(row.summary_text));
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/api/permissions-config', authMiddleware, requireAdmin, (req, res) => {
  try {
    const item = ensurePermissionsConfigSeeded();
    return res.json({ ok: true, item });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.put('/api/permissions-config', authMiddleware, requirePermissionEditor, (req, res) => {
  const item = req.body && typeof req.body === 'object' ? req.body : null;
  if (!item) return res.status(400).json({ ok: false, error: 'permissions config object required' });
  const now = nowISO();
  try {
    const normalized = normalizePermissionsConfigValue(item);
    db.prepare(
      'INSERT INTO permissions_config (id, data_json, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at'
    ).run('default', JSON.stringify(normalized), now, now);
    recordAuditLog({
      actorId: req.user?.id,
      action: 'permissions_config.updated',
      targetType: 'permissions_config',
      targetId: 'default',
      details: { roleCount: Object.keys(normalized || {}).length },
    });
    return res.json({ ok: true, item: normalized });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Request logging (dev-friendly)
if (LOG_REQUESTS) {
  app.use((req, res, next) => {
    const startedAt = Date.now();
    const path = req.originalUrl || req.url;
    const method = (req.method || 'GET').toUpperCase();

    slog.debug('req', `${method} ${path}`, { hasAuth: !!(req.headers && req.headers.authorization) });

    res.on('finish', () => {
      const ms = Date.now() - startedAt;
      slog.info('req', `${method} ${path} -> ${res.statusCode} (${ms}ms)`);
    });

    next();
  });
}

// Auth
app.post('/api/auth/login', authRateLimit, (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = (req.body && req.body.password) ? String(req.body.password) : '';
  if (!email || !password) return res.status(400).json({ ok: false, error: 'email and password required' });
  if (password.length > 256) return res.status(400).json({ ok: false, error: 'password is too long' });

  try {
    slog.debug('auth', 'Login attempt', { email: maskEmail(email) });

    const row = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
    if (!row) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'invalid credentials' });

    if (!JWT_SECRET) return res.status(500).json({ ok: false, error: 'server missing BB_JWT_SECRET' });

    const user = userToClient(row);
    const token = signToken(user);
    slog.info('auth', 'Login success', { userId: user?.id, email: maskEmail(email) });
    return res.json({ token, user });
  } catch (e) {
    slog.error('auth', 'Login failed unexpectedly', { email: maskEmail(email), message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: 'login failed' });
  }
});

app.post('/api/auth/invite-login', authRateLimit, async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const accessCode = (req.body && req.body.accessCode != null) ? String(req.body.accessCode).trim() : '';
  if (!email || !accessCode) return res.status(400).json({ ok: false, error: 'email and accessCode required' });
  if (!/^\d{6}$/.test(accessCode)) return res.status(400).json({ ok: false, error: 'accessCode must be a 6-digit code' });

  try {
    const inviteRow = db.prepare(
      'SELECT * FROM access_invites WHERE lower(email) = ? AND code_hash = ? AND first_login_at IS NULL AND used_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR datetime(expires_at) > datetime(\'now\')) ORDER BY created_at DESC LIMIT 1'
    ).get(email, hashInviteAccessCode(accessCode));
    if (!inviteRow) return res.status(401).json({ ok: false, error: 'invalid credentials' });

    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(String(inviteRow.user_id || ''));
    if (!userRow) return res.status(404).json({ ok: false, error: 'user not found' });

    await markInviteLoginStarted(userRow.id, inviteRow.id);
    const authSession = await buildManagedAccessLoginAuthResponse(userRow, inviteRow);
    const latestInvite = serializeAccessInviteRow(getLatestAccessInviteRowForUser(userRow.id));
    return res.json({
      ok: true,
      customToken: authSession.customToken,
      apiToken: authSession.apiToken,
      authMode: authSession.authMode,
      user: {
        ...userToClient(userRow),
        passwordSetupRequired: true,
      },
      invite: latestInvite,
    });
  } catch (e) {
    slog.error('auth', 'Invite login failed', { email: maskEmail(email), message: e?.message || String(e) });
    return res.status(500).json({ ok: false, error: e?.message || 'invite login failed' });
  }
});

app.post('/api/auth/approval-link-login', authRateLimit, async (req, res) => {
  const approvalToken = (req.body && req.body.token != null) ? String(req.body.token).trim() : '';
  if (!approvalToken) return res.status(400).json({ ok: false, error: 'token required' });

  try {
    const payload = verifyApprovalAccessToken(approvalToken);
    const inviteRow = db.prepare(
      'SELECT * FROM access_invites WHERE id = ? AND user_id = ? AND lower(email) = ? ORDER BY created_at DESC LIMIT 1'
    ).get(safeString(payload?.inviteId).trim(), safeString(payload?.userId).trim(), normalizeEmail(payload?.email));
    assertApprovalLinkInviteIsActive({ payload, inviteRow });

    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(String(inviteRow.user_id || ''));
    if (!userRow) return res.status(404).json({ ok: false, error: 'user not found' });

    await markInviteLoginStarted(userRow.id, inviteRow.id);

    const authSession = await buildManagedAccessLoginAuthResponse(userRow, inviteRow);
    const latestInvite = serializeAccessInviteRow(getLatestAccessInviteRowForUser(userRow.id));
    return res.json({
      ok: true,
      customToken: authSession.customToken,
      apiToken: authSession.apiToken,
      authMode: authSession.authMode,
      user: {
        ...userToClient(userRow),
        passwordSetupRequired: true,
      },
      invite: latestInvite,
      redirectIntent: 'approval-staff-management',
    });
  } catch (e) {
    const message = e?.message || 'approval access link is invalid';
    const status = String(message).toLowerCase().includes('approval access link') ? 401 : 500;
    return res.status(status).json({ ok: false, error: message });
  }
});

app.post('/api/auth/complete-invite-password', authMiddleware, async (req, res) => {
  const userId = safeString(req.user?.id).trim();
  const newPassword = (req.body && req.body.newPassword != null) ? String(req.body.newPassword) : '';
  if (!userId) return res.status(401).json({ ok: false, error: 'authentication required' });

  try {
    const inviteRow = db.prepare(
      'SELECT * FROM access_invites WHERE user_id = ? AND first_login_at IS NOT NULL AND used_at IS NULL AND revoked_at IS NULL ORDER BY first_login_at DESC, created_at DESC LIMIT 1'
    ).get(userId);
    if (!inviteRow) return res.status(400).json({ ok: false, error: 'invite session is no longer active' });

    await completeManagedInvitePasswordSetup(userId, inviteRow.id, newPassword);
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return res.json({ ok: true, user: userRow ? userToClient(userRow) : null });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e?.message || 'could not complete password setup' });
  }
});

// Password reset (request a reset code)
app.post('/api/auth/forgot-password', authRateLimit, async (req, res) => {
  const email = (req.body && req.body.email) ? String(req.body.email).trim().toLowerCase() : '';
  if (!email) return res.status(400).json({ ok: false, error: 'email required' });
  if (!JWT_SECRET) return res.status(500).json({ ok: false, error: 'server missing BB_JWT_SECRET' });
  if (!passwordResetEmailConfigured()) {
    return res.status(503).json({ ok: false, error: 'Password reset delivery is not configured.' });
  }

  // Always return ok to avoid account enumeration.
  try {
    const row = db.prepare('SELECT id,email FROM users WHERE lower(email) = ?').get(email);
    if (row && row.id) {
      const resetCode = generateResetCode();
      const tokenHash = hashResetCode(resetCode);
      const createdAt = nowISO();
      const expiresAt = new Date(Date.now() + (PASSWORD_RESET_TTL_MINUTES * 60 * 1000)).toISOString();

      try {
        db.prepare('INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at, created_at) VALUES (?,?,?,?,?,?)')
          .run(nanoId(), String(row.id), tokenHash, expiresAt, null, createdAt);
      } catch (e) {
        // Non-fatal: still attempt delivery.
      }

      // Try to deliver via email if configured; otherwise log.
      try {
        if (passwordResetEmailConfigured()) {
          await sendPasswordResetEmail({ to: email, code: resetCode });
        } else {
          slog.warn('auth', 'Password reset requested but SMTP not configured', { email: maskEmail(email) });
        }
      } catch (e) {
        slog.error('auth', 'Password reset delivery failed', { email: maskEmail(email), message: e?.message || String(e) });
      }

      const payload = { ok: true };
      if (RETURN_PASSWORD_RESET_CODE) payload.resetCode = resetCode;
      return res.json(payload);
    }
  } catch (e) {
    // ignore
  }

  return res.json({ ok: true });
});

// Password reset (consume code and set a new password)
app.post('/api/auth/reset-password', authRateLimit, (req, res) => {
  const email = (req.body && req.body.email) ? String(req.body.email).trim().toLowerCase() : '';
  const resetCode = (req.body && (req.body.resetCode || req.body.code || req.body.token)) ? String(req.body.resetCode || req.body.code || req.body.token).trim() : '';
  const newPassword = (req.body && req.body.newPassword) ? String(req.body.newPassword) : '';
  if (!email || !resetCode || !newPassword) return res.status(400).json({ ok: false, error: 'email, resetCode, newPassword required' });
  if (String(newPassword).length < 6) return res.status(400).json({ ok: false, error: 'password must be at least 6 characters' });
  if (!JWT_SECRET) return res.status(500).json({ ok: false, error: 'server missing BB_JWT_SECRET' });

  try {
    const user = db.prepare('SELECT id,email FROM users WHERE lower(email) = ?').get(email);
    if (!user || !user.id) return res.status(400).json({ ok: false, error: 'invalid code' });

    const tokenHash = hashResetCode(resetCode);
    const now = nowISO();
    const row = db.prepare(
      'SELECT * FROM password_resets WHERE user_id = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1'
    ).get(String(user.id), tokenHash, now);

    if (!row) return res.status(400).json({ ok: false, error: 'invalid or expired code' });

    const hash = bcrypt.hashSync(newPassword, 12);
    const tx = db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, now, String(user.id));
      db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(now, String(row.id));
    });
    tx();

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.post('/api/account/delete', authMiddleware, async (req, res) => {
  const userId = safeString(req.user?.id).trim();
  const confirmed = req.body?.confirm === true;
  if (!userId) return res.status(401).json({ ok: false, error: 'not authenticated' });
  if (!confirmed) return res.status(400).json({ ok: false, error: 'confirmation required' });

  try {
    const existingUser = db.prepare('SELECT id,role,email FROM users WHERE id = ?').get(userId);
    if (!existingUser) return res.status(404).json({ ok: false, error: 'user not found' });

    recordAuditLog({
      actorId: userId,
      action: 'account.deleted_self',
      targetType: 'user',
      targetId: userId,
      details: { role: existingUser.role, email: existingUser.email },
    });

    try {
      await deleteFirebaseManagedUser(userId);
    } catch (e) {
      const code = String(e?.code || '');
      const message = String(e?.message || '');
      if (!code.includes('auth/user-not-found') && !message.toLowerCase().includes('user-not-found')) {
        return res.status(500).json({ ok: false, error: e?.message || 'firebase delete failed' });
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'account delete failed' });
  }
});

app.put('/api/auth/me', authMiddleware, (req, res) => {
  const name = (req.body && req.body.name != null) ? String(req.body.name).trim() : undefined;
  const email = (req.body && req.body.email != null) ? String(req.body.email).trim().toLowerCase() : undefined;
  const avatarRaw = (req.body && req.body.avatar != null) ? String(req.body.avatar).trim() : undefined;
  const phoneRaw = (req.body && req.body.phone != null) ? String(req.body.phone).trim() : undefined;
  const address = (req.body && req.body.address != null) ? String(req.body.address).trim() : undefined;
  const newPassword = (req.body && req.body.password != null) ? String(req.body.password) : undefined;

  if (name !== undefined && !name) return res.status(400).json({ ok: false, error: 'name cannot be empty' });
  if (email !== undefined && !email) return res.status(400).json({ ok: false, error: 'email cannot be empty' });

  let avatar = avatarRaw;
  if (avatar !== undefined) {
    if (!avatar) avatar = '';
    // Allow:
    // - absolute URLs (http/https)
    // - local uploads served by this API (/uploads/...)
    const ok = avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('/uploads/');
    if (!ok) return res.status(400).json({ ok: false, error: 'avatar must be a valid URL or /uploads/... path' });
    if (avatar.length > 2048) return res.status(400).json({ ok: false, error: 'avatar URL too long' });
  }

  let phone = phoneRaw;
  if (phone !== undefined) {
    if (!phone) phone = '';
    else {
      const normalized = normalizeE164Phone(phone);
      if (!normalized) {
        return res.status(400).json({ ok: false, error: 'phone must be in E.164 format (e.g. +15551234567)' });
      }
      phone = normalized;
    }
  }

  if (newPassword !== undefined) {
    if (!String(newPassword).trim()) return res.status(400).json({ ok: false, error: 'password cannot be empty' });
    if (String(newPassword).length < 6) return res.status(400).json({ ok: false, error: 'password must be at least 6 characters' });
  }

  try {
    const userId = String(req.user.id);

    if (email !== undefined) {
      const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ? AND id <> ?').get(email, userId);
      if (existing) return res.status(409).json({ ok: false, error: 'email already exists' });
    }

    const fields = [];
    const values = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (email !== undefined) { fields.push('email = ?'); values.push(email); }
    if (avatar !== undefined) { fields.push('avatar = ?'); values.push(avatar); }
    if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
    if (address !== undefined) { fields.push('address = ?'); values.push(address); }
    if (newPassword !== undefined) {
      const hash = bcrypt.hashSync(newPassword, 12);
      fields.push('password_hash = ?');
      values.push(hash);
    }

    if (!fields.length) {
      return res.status(400).json({ ok: false, error: 'no fields to update' });
    }

    fields.push('updated_at = ?');
    values.push(nowISO());
    values.push(userId);

    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const row = db.prepare('SELECT id,email,name,avatar,phone,address,role FROM users WHERE id = ?').get(userId);
    if (!row) return res.status(404).json({ ok: false, error: 'user not found' });
    if (!JWT_SECRET) return res.status(500).json({ ok: false, error: 'server missing BB_JWT_SECRET' });

    const user = userToClient(row);
    const token = signToken(user);
    return res.json({ ok: true, token, user });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'update failed' });
  }
});

app.get('/api/admin/users', authMiddleware, requireAdmin, requireCapability('users:manage'), async (req, res) => {
  try {
    const rows = db.prepare('SELECT id,email,name,avatar,phone,address,role,created_at,updated_at FROM users ORDER BY lower(email) ASC').all();
    const firebaseProfiles = await getFirebaseManagedProfiles((rows || []).map((row) => row.id)).catch(() => new Map());
    const inviteRows = getLatestAccessInviteRows((rows || []).map((row) => row.id));
    const items = (rows || []).map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      avatar: row.avatar || '',
      phone: row.phone || '',
      address: row.address || '',
      role: row.role,
      organizationId: firebaseProfiles.get(row.id)?.organizationId || '',
      programIds: firebaseProfiles.get(row.id)?.programIds || [],
      campusIds: firebaseProfiles.get(row.id)?.campusIds || [],
      memberships: firebaseProfiles.get(row.id)?.memberships || [],
      invite: inviteRows.get(row.id) || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return res.json({ ok: true, items: filterManageableUsers(req.user, items) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'list users failed' });
  }
});

app.post('/api/admin/users/invite', authMiddleware, requireAdmin, requireCapability('users:manage'), async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const requestedRole = normalizeManagedInviteRole(req.body && req.body.role);
  const name = safeString(req.body && req.body.name).trim();
  const phone = safeString(req.body && req.body.phone).trim();
  const address = safeString(req.body && req.body.address).trim();
  const organizationId = safeString(req.body && req.body.organizationId).trim();
  const programIds = normalizeManagedIdList(req.body && req.body.programIds);
  const campusIds = normalizeManagedIdList(req.body && req.body.campusIds);
  const memberships = Array.isArray(req.body?.memberships) ? req.body.memberships : [];
  const role = isReservedSuperAdminEmail(email) ? 'superAdmin' : requestedRole;

  if (!email) return res.status(400).json({ ok: false, error: 'email required' });
  if (!role) return res.status(400).json({ ok: false, error: 'role required' });
  if (isSuperAdminRole(role) && !isSuperAdminRole(req.user?.role)) {
    return res.status(403).json({ ok: false, error: 'super admin assignments are reserved for the raw-data account' });
  }

  try {
    if (!isSuperAdminRole(req.user?.role)) {
      const inviteTarget = normalizeScopedUser({
        email,
        role,
        organizationId,
        programIds,
        campusIds,
        memberships,
      });
      if (!canManageTargetUser(req.user, inviteTarget)) {
        return res.status(403).json({ ok: false, error: 'target user is outside your admin scope' });
      }
    }
    const result = await createOrRefreshManagedAccessInvite({
      req,
      email,
      role,
      name,
      phone,
      address,
      organizationId,
      programIds,
      campusIds,
      memberships,
      inviteType: 'staff',
      sourceSubmissionId: '',
      userId: '',
    });
    recordAuditLog({
      actorId: req.user?.id,
      action: 'admin_user.invited',
      targetType: 'user',
      targetId: result.user?.id,
      details: { role, email },
    });
    return res.json({ ok: true, user: result.user, invite: result.invite });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'invite failed' });
  }
});

app.put('/api/admin/users/:userId', authMiddleware, requireAdmin, requireCapability('users:manage'), async (req, res) => {
  const userId = safeString(req.params && req.params.userId).trim();

  const name = (req.body && req.body.name != null) ? String(req.body.name).trim() : undefined;
  const email = (req.body && req.body.email != null) ? String(req.body.email).trim().toLowerCase() : undefined;
  const avatarRaw = (req.body && req.body.avatar != null) ? String(req.body.avatar).trim() : undefined;
  const phoneRaw = (req.body && req.body.phone != null) ? String(req.body.phone).trim() : undefined;
  const address = (req.body && req.body.address != null) ? String(req.body.address).trim() : undefined;
  const role = (req.body && req.body.role != null) ? String(req.body.role).trim() : undefined;
  const organizationId = (req.body && req.body.organizationId != null) ? String(req.body.organizationId).trim() : undefined;
  const programIds = (req.body && req.body.programIds != null) ? normalizeManagedIdList(req.body.programIds) : undefined;
  const campusIds = (req.body && req.body.campusIds != null) ? normalizeManagedIdList(req.body.campusIds) : undefined;
  const memberships = (req.body && Array.isArray(req.body.memberships))
    ? req.body.memberships.filter((item) => item && typeof item === 'object').map((item) => ({
      organizationId: safeString(item.organizationId).trim(),
      programId: safeString(item.programId || item.branchId).trim(),
      campusId: safeString(item.campusId).trim(),
      role: safeString(item.role || role || '').trim(),
      programType: safeString(item.programType).trim(),
    })).filter((item) => item.organizationId)
    : undefined;
  const newPassword = (req.body && req.body.password != null) ? String(req.body.password) : undefined;

  if (name !== undefined && !name) return res.status(400).json({ ok: false, error: 'name cannot be empty' });
  if (email !== undefined && !email) return res.status(400).json({ ok: false, error: 'email cannot be empty' });

  let avatar = avatarRaw;
  if (avatar !== undefined) {
    if (!avatar) avatar = '';
    const ok = avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('/uploads/');
    if (!ok) return res.status(400).json({ ok: false, error: 'avatar must be a valid URL or /uploads/... path' });
    if (avatar.length > 2048) return res.status(400).json({ ok: false, error: 'avatar URL too long' });
  }

  let phone = phoneRaw;
  if (phone !== undefined) {
    if (!phone) phone = '';
    else {
      const normalized = normalizeE164Phone(phone);
      if (!normalized) return res.status(400).json({ ok: false, error: 'phone must be in E.164 format (e.g. +15551234567)' });
      phone = normalized;
    }
  }

  if (newPassword !== undefined) {
    if (!String(newPassword).trim()) return res.status(400).json({ ok: false, error: 'password cannot be empty' });
    if (String(newPassword).length < 6) return res.status(400).json({ ok: false, error: 'password must be at least 6 characters' });
  }

  try {
    const existingUser = applyReservedSuperAdminRole(db.prepare('SELECT id,email,role FROM users WHERE id = ?').get(userId));
    if (!existingUser) return res.status(404).json({ ok: false, error: 'user not found' });

    const requesterIsSuperAdmin = isSuperAdminRole(req.user?.role);
    const targetIsSuperAdmin = isSuperAdminRole(existingUser.role);
    const targetProfile = await getFirebaseManagedProfiles([userId]).catch(() => new Map());
    const targetScopedUser = normalizeScopedUser({ ...existingUser, ...(targetProfile.get(userId) || {}) });
    if (targetIsSuperAdmin && !requesterIsSuperAdmin) {
      return res.status(403).json({ ok: false, error: 'super admin required to manage this user' });
    }
    const nextRole = isReservedSuperAdminEmail(email !== undefined ? email : existingUser.email)
      ? 'superAdmin'
      : role;
    if (nextRole !== undefined && isSuperAdminRole(nextRole) && !requesterIsSuperAdmin) {
      return res.status(403).json({ ok: false, error: 'super admin assignments are reserved for the raw-data account' });
    }
    if (!canManageTargetUser(req.user, targetScopedUser)) {
      return res.status(403).json({ ok: false, error: 'target user is outside your admin scope' });
    }
    const nextScopedUser = normalizeScopedUser({
      ...existingUser,
      ...(targetProfile.get(userId) || {}),
      email: email !== undefined ? email : existingUser.email,
      role: nextRole !== undefined ? nextRole : existingUser.role,
      organizationId: organizationId !== undefined ? organizationId : targetScopedUser.organizationId,
      programIds: programIds !== undefined ? programIds : targetScopedUser.programIds,
      campusIds: campusIds !== undefined ? campusIds : targetScopedUser.campusIds,
      memberships: memberships !== undefined ? memberships : targetScopedUser.memberships,
    });
    if (!requesterIsSuperAdmin && !canManageTargetUser(req.user, nextScopedUser)) {
      return res.status(403).json({ ok: false, error: 'updated user would be outside your admin scope' });
    }

    if (email !== undefined) {
      const duplicate = db.prepare('SELECT id FROM users WHERE lower(email) = ? AND id <> ?').get(email, userId);
      if (duplicate) return res.status(409).json({ ok: false, error: 'email already exists' });
    }

    const firebaseFields = {};
    if (name !== undefined) firebaseFields.name = name;
    if (email !== undefined) firebaseFields.email = email;
    if (nextRole !== undefined) firebaseFields.role = nextRole;
    if (organizationId !== undefined) firebaseFields.organizationId = organizationId;
    if (programIds !== undefined) firebaseFields.programIds = programIds;
    if (campusIds !== undefined) firebaseFields.campusIds = campusIds;
    if (memberships !== undefined) firebaseFields.memberships = memberships;
    if (newPassword !== undefined) firebaseFields.password = newPassword;
    if (Object.keys(firebaseFields).length) {
      try {
        await syncFirebaseManagedUser(userId, firebaseFields);
      } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || 'firebase sync failed' });
      }
    }

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (email !== undefined) { fields.push('email = ?'); values.push(email); }
    if (avatar !== undefined) { fields.push('avatar = ?'); values.push(avatar); }
    if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
    if (address !== undefined) { fields.push('address = ?'); values.push(address); }
    if (nextRole !== undefined) { fields.push('role = ?'); values.push(nextRole); }
    if (newPassword !== undefined) {
      const hash = bcrypt.hashSync(newPassword, 12);
      fields.push('password_hash = ?');
      values.push(hash);
    }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'no fields to update' });

    fields.push('updated_at = ?');
    values.push(nowISO());
    values.push(userId);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    syncManagedUserStaffDirectorySqlite(userId);

    const row = db.prepare('SELECT id,email,name,avatar,phone,address,role,created_at,updated_at FROM users WHERE id = ?').get(userId);
    const firebaseProfile = await getFirebaseManagedProfiles([userId]).catch(() => new Map());
    const scope = firebaseProfile.get(userId) || {};
    slog.info('admin', 'Managed user updated', {
      actorId: req.user?.id,
      targetUserId: userId,
      roleChanged: nextRole !== undefined,
      scopeChanged: organizationId !== undefined || programIds !== undefined || campusIds !== undefined || memberships !== undefined,
    });
    recordAuditLog({
      actorId: req.user?.id,
      action: 'admin_user.updated',
      targetType: 'user',
      targetId: userId,
      details: {
        roleChanged: nextRole !== undefined,
        scopeChanged: organizationId !== undefined || programIds !== undefined || campusIds !== undefined || memberships !== undefined,
        passwordChanged: newPassword !== undefined,
      },
    });
    return res.json({ ok: true, user: {
      id: row.id,
      email: row.email,
      name: row.name,
      avatar: row.avatar || '',
      phone: row.phone || '',
      address: row.address || '',
      role: applyReservedSuperAdminRole(row).role,
      organizationId: scope.organizationId || '',
      programIds: scope.programIds || [],
      campusIds: scope.campusIds || [],
      memberships: scope.memberships || [],
      invite: serializeAccessInviteRow(getLatestAccessInviteRowForUser(userId)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'admin update failed' });
  }
});

app.post('/api/admin/users/:userId/invite-resend', authMiddleware, requireAdmin, requireCapability('users:manage'), async (req, res) => {
  const userId = safeString(req.params && req.params.userId).trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

  try {
    const existingUser = applyReservedSuperAdminRole(db.prepare('SELECT id,email,name,phone,address,role FROM users WHERE id = ?').get(userId));
    if (!existingUser) return res.status(404).json({ ok: false, error: 'user not found' });

    const requesterIsSuperAdmin = isSuperAdminRole(req.user?.role);
    const targetIsSuperAdmin = isSuperAdminRole(existingUser.role);
    const targetProfile = await getFirebaseManagedProfiles([userId]).catch(() => new Map());
    const scope = targetProfile.get(userId) || {};
    const targetScopedUser = normalizeScopedUser({ ...existingUser, ...scope });
    if (targetIsSuperAdmin && !requesterIsSuperAdmin) {
      return res.status(403).json({ ok: false, error: 'super admin required to manage this user' });
    }
    if (!canManageTargetUser(req.user, targetScopedUser)) {
      return res.status(403).json({ ok: false, error: 'target user is outside your admin scope' });
    }

    const latestInvite = getLatestAccessInviteRowForUser(userId);
    const result = await createOrRefreshManagedAccessInvite({
      req,
      email: existingUser.email,
      role: existingUser.role,
      name: existingUser.name,
      phone: existingUser.phone,
      address: existingUser.address,
      organizationId: scope.organizationId || '',
      programIds: scope.programIds || [],
      campusIds: scope.campusIds || [],
      memberships: scope.memberships || [],
      inviteType: safeString(latestInvite?.invite_type).trim() || 'staff',
      sourceSubmissionId: safeString(latestInvite?.source_submission_id).trim(),
      userId,
    });
    recordAuditLog({
      actorId: req.user?.id,
      action: 'admin_user.invite_resent',
      targetType: 'user',
      targetId: userId,
      details: { email: existingUser.email },
    });
    return res.json({ ok: true, user: result.user, invite: result.invite });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'invite resend failed' });
  }
});

app.delete('/api/admin/users/:userId', authMiddleware, requireAdmin, requireCapability('users:manage'), async (req, res) => {
  const userId = safeString(req.params && req.params.userId).trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });
  if (userId === safeString(req.user?.id).trim()) return res.status(400).json({ ok: false, error: 'cannot delete the active user via admin endpoint' });

  try {
    const existingUser = applyReservedSuperAdminRole(db.prepare('SELECT id,email,role FROM users WHERE id = ?').get(userId));
    if (!existingUser) return res.status(404).json({ ok: false, error: 'user not found' });

    const requesterIsSuperAdmin = isSuperAdminRole(req.user?.role);
    const targetIsAdmin = isAdminRole(existingUser.role);
    const targetProfile = await getFirebaseManagedProfiles([userId]).catch(() => new Map());
    const targetScopedUser = normalizeScopedUser({ ...existingUser, ...(targetProfile.get(userId) || {}) });
    if (targetIsAdmin && !requesterIsSuperAdmin) {
      return res.status(403).json({ ok: false, error: 'super admin required to delete elevated users' });
    }
    if (!canManageTargetUser(req.user, targetScopedUser)) {
      return res.status(403).json({ ok: false, error: 'target user is outside your admin scope' });
    }

    try {
      await deleteFirebaseManagedUser(userId);
    } catch (e) {
      const code = String(e?.code || '');
      const message = String(e?.message || '');
      if (!code.includes('auth/user-not-found') && !message.toLowerCase().includes('user-not-found')) {
        return res.status(500).json({ ok: false, error: e?.message || 'firebase delete failed' });
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  syncManagedUserStaffDirectorySqlite(userId);
  slog.info('admin', 'Managed user deleted', { actorId: req.user?.id, targetUserId: userId, targetRole: existingUser.role });
    recordAuditLog({
      actorId: req.user?.id,
      action: 'admin_user.deleted',
      targetType: 'user',
      targetId: userId,
      details: { targetRole: existingUser.role },
    });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'admin delete failed' });
  }
});

// Optional signup (off by default)
app.post('/api/auth/signup', authRateLimit, async (req, res) => {
  if (!ALLOW_SIGNUP) return res.status(403).json({ ok: false, error: 'signup disabled' });

  const email = normalizeEmail(req.body && req.body.email);
  const password = (req.body && req.body.password) ? String(req.body.password) : '';
  const name = (req.body && req.body.name) ? String(req.body.name).trim() : '';
  const role = (req.body && req.body.role) ? String(req.body.role).trim() : 'parent';
  const twoFaMethod = (req.body && req.body.twoFaMethod) ? String(req.body.twoFaMethod).trim().toLowerCase() : 'email';
  const phone = (req.body && req.body.phone) ? String(req.body.phone).trim() : '';

  if (!email || !password || !name) return res.status(400).json({ ok: false, error: 'name, email, password required' });
  if (name.length > 120) return res.status(400).json({ ok: false, error: 'name is too long' });
  const passwordPolicyError = validatePasswordPolicy(password);
  if (passwordPolicyError) return res.status(400).json({ ok: false, error: passwordPolicyError });
  if (!JWT_SECRET) return res.status(500).json({ ok: false, error: 'server missing BB_JWT_SECRET' });
  if (isRestrictedSignupRole(role)) return res.status(403).json({ ok: false, error: 'elevated roles must be provisioned by an existing administrator' });

  const exists = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (exists) return res.status(409).json({ ok: false, error: 'email already exists' });

  // If 2FA is required, validate delivery configuration before creating an account.
  if (REQUIRE_2FA_ON_SIGNUP) {
    const method = (twoFaMethod === 'sms' || twoFaMethod === 'email') ? twoFaMethod : 'email';
    if (method === 'sms') {
      if (!ENABLE_SMS_2FA) return res.status(400).json({ ok: false, error: 'SMS 2FA is currently disabled' });
      if (!twilioEnabled()) {
        return res.status(503).json({
          ok: false,
          error: '2FA SMS delivery is not configured (set BB_TWILIO_ACCOUNT_SID/BB_TWILIO_AUTH_TOKEN and BB_TWILIO_FROM or BB_TWILIO_MESSAGING_SERVICE_SID)',
        });
      }
    } else {
      if (!ENABLE_EMAIL_2FA) return res.status(400).json({ ok: false, error: 'Email 2FA is currently disabled' });
      if (!emailEnabled()) {
        return res.status(503).json({
          ok: false,
          error: '2FA email delivery is not configured (set BB_SMTP_URL and BB_EMAIL_FROM, and ensure BB_ENABLE_EMAIL_2FA=1)',
        });
      }
    }
  }

  const id = nanoId();
  const hash = bcrypt.hashSync(password, 12);
  const t = nowISO();
  try {
    db.prepare('INSERT INTO users (id,email,password_hash,name,phone,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, email, hash, name, phone, role, t, t);
  } catch (e) {
    // If a duplicate email got created concurrently, return a consistent error.
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('unique') || msg.includes('constraint')) {
      return res.status(409).json({ ok: false, error: 'email already exists' });
    }
    return res.status(500).json({ ok: false, error: e?.message || 'signup failed' });
  }

  const user = { id, email, name, role };

  // For end-to-end testing, default to requiring 2FA on signup.
  if (REQUIRE_2FA_ON_SIGNUP) {
    const method = (twoFaMethod === 'sms' || twoFaMethod === 'email') ? twoFaMethod : 'email';
    if (method === 'sms' && !ENABLE_SMS_2FA) {
      return res.status(400).json({ ok: false, error: 'SMS 2FA is currently disabled' });
    }
    if (method === 'email' && !ENABLE_EMAIL_2FA) {
      return res.status(400).json({ ok: false, error: 'Email 2FA is currently disabled' });
    }

    let destination = '';
    if (method === 'sms') {
      destination = normalizeE164Phone(phone);
      if (!destination) {
        return res.status(400).json({ ok: false, error: 'phone required for sms 2fa (E.164 format, e.g. +15551234567)' });
      }
    } else {
      destination = normalizeEmail(email);
      if (!destination) {
        return res.status(400).json({ ok: false, error: 'valid email required for email 2fa' });
      }
    }

    const ch = create2faChallenge({ userId: id, method, destination });
    slog.info('auth', '2FA challenge created (signup)', { method, to: maskDest(method, destination), userId: id });

    // Deliver the code (production/TestFlight). Only log/return the code when explicitly enabled.
    if (DEBUG_2FA_RETURN_CODE) {
      slog.debug('auth', '2FA code (dev)', { challengeId: ch.challengeId, code: ch.code });
    } else {
      try {
        await deliver2faCode({ method, destination, code: ch.code });
        slog.info('auth', '2FA code delivered', { method, to: maskDest(method, destination), challengeId: ch.challengeId });
      } catch (e) {
        // Roll back created user on delivery failure to avoid orphan accounts.
        try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch (_) {}
        try { twoFaChallenges.delete(ch.challengeId); } catch (_) {}
        slog.error('auth', '2FA delivery failed', { method, to: maskDest(method, destination), message: e?.message || String(e) });
        const payload = { ok: false, error: '2FA delivery failed; contact support' };
        if (DEBUG_2FA_DELIVERY_ERRORS) payload.debug = (e?.message || String(e));
        return res.status(500).json(payload);
      }
    }

    const payload = {
      ok: true,
      user,
      requires2fa: true,
      method,
      to: maskDest(method, destination),
      challengeId: ch.challengeId,
    };
    if (DEBUG_2FA_RETURN_CODE) payload.devCode = ch.code;
    return res.status(201).json(payload);
  }

  const token = signToken(user);
  return res.status(201).json({ token, user, requires2fa: false });
});

// Verify 2FA challenge and mint an auth token.
app.post('/api/auth/2fa/verify', authRateLimit, twoFaVerifyRateLimit, (req, res) => {
  const challengeId = (req.body && req.body.challengeId) ? String(req.body.challengeId).trim() : '';
  const code = (req.body && req.body.code) ? String(req.body.code).trim() : '';
  if (!challengeId || !code) return res.status(400).json({ ok: false, error: 'challengeId and code required' });

  const result = consume2faChallenge(challengeId, code);
  if (!result.ok) return res.status(401).json({ ok: false, error: result.error || 'verification failed' });

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId);
  if (!row) return res.status(404).json({ ok: false, error: 'user not found' });
  if (!JWT_SECRET) return res.status(500).json({ ok: false, error: 'server missing BB_JWT_SECRET' });

  const user = userToClient(row);
  const token = signToken(user);
  slog.info('auth', '2FA verified; token issued', { userId: user?.id, method: result.method });
  return res.json({ ok: true, token, user });
});

// Resend SMS 2FA code with a cooldown.
app.post('/api/auth/2fa/resend', authRateLimit, twoFaResendRateLimit, async (req, res) => {
  const challengeId = (req.body && req.body.challengeId) ? String(req.body.challengeId).trim() : '';
  if (!challengeId) return res.status(400).json({ ok: false, error: 'challengeId required' });

  const updated = resend2faChallenge(challengeId);
  if (!updated.ok) {
    const status = updated.status || 400;
    const payload = { ok: false, error: updated.error || 'resend failed' };
    if (updated.retryAfterSec) payload.retryAfterSec = updated.retryAfterSec;
    return res.status(status).json(payload);
  }

  if (DEBUG_2FA_RETURN_CODE) {
    slog.debug('auth', '2FA code resent (dev)', { challengeId, code: updated.code });
    return res.json({ ok: true, method: updated.method, to: maskDest(updated.method, updated.destination), challengeId, devCode: updated.code });
  }

  try {
    await deliver2faCode({ method: updated.method, destination: updated.destination, code: updated.code });
    slog.info('auth', '2FA code resent', { method: updated.method, to: maskDest(updated.method, updated.destination), challengeId });
    return res.json({ ok: true, method: updated.method, to: maskDest(updated.method, updated.destination), challengeId });
  } catch (e) {
    slog.error('auth', '2FA resend failed', { method: updated.method, to: maskDest(updated.method, updated.destination), message: e?.message || String(e) });
    const payload = { ok: false, error: '2FA delivery failed; contact support' };
    if (DEBUG_2FA_DELIVERY_ERRORS) payload.debug = (e?.message || String(e));
    return res.status(500).json(payload);
  }
});

// Board / Posts
app.get('/api/board', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM posts ORDER BY datetime(created_at) DESC').all();

  // Attach the latest avatar URL from the users table (author_json may be a snapshot).
  let avatarByUserId = {};
  try {
    const authorIds = Array.from(
      new Set(
        rows
          .map((r) => {
            const a = safeJsonParse(r.author_json, null);
            return a && a.id ? String(a.id) : '';
          })
          .filter(Boolean)
      )
    );

    if (authorIds.length) {
      const placeholders = authorIds.map(() => '?').join(',');
      const urows = db.prepare(`SELECT id, avatar FROM users WHERE id IN (${placeholders})`).all(...authorIds);
      avatarByUserId = (urows || []).reduce((acc, u) => {
        const id = u && u.id ? String(u.id) : '';
        if (id) acc[id] = u && u.avatar ? String(u.avatar) : '';
        return acc;
      }, {});
    }
  } catch (e) {
    // ignore; fallback to pravatar client-side
  }

  const out = rows.map((r) => {
    let author = safeJsonParse(r.author_json, null);
    if (author && author.id) {
      const a = avatarByUserId[String(author.id)] || '';
      if (a) author = { ...author, avatar: a };
    }
    const comments = safeJsonParse(r.comments_json, []);
    return {
      id: r.id,
      author,
      title: r.title || '',
      body: r.body || '',
      text: r.body || '',
      image: r.image || undefined,
      likes: r.likes || 0,
      shares: r.shares || 0,
      comments,
      createdAt: r.created_at,
    };
  });
  res.json(out);
});

app.post('/api/board', authMiddleware, (req, res) => {
  const title = (req.body && req.body.title) ? String(req.body.title) : '';
  const body = (req.body && (req.body.body || req.body.text)) ? String(req.body.body || req.body.text) : '';
  const image = (req.body && req.body.image) ? String(req.body.image) : null;

  const id = nanoId();
  const t = nowISO();
  const author = req.user ? { id: req.user.id, name: req.user.name, avatar: req.user.avatar || '' } : null;
  db.prepare('INSERT INTO posts (id, author_json, title, body, image, likes, shares, comments_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, JSON.stringify(author), title, body, image, 0, 0, JSON.stringify([]), t, t);

  res.status(201).json({
    id,
    author,
    title,
    body,
    text: body,
    image: image || undefined,
    likes: 0,
    shares: 0,
    comments: [],
    createdAt: t,
  });
});

app.post('/api/board/like', authMiddleware, (req, res) => {
  const postId = (req.body && req.body.postId) ? String(req.body.postId) : '';
  if (!postId) return res.status(400).json({ ok: false, error: 'postId required' });
  db.prepare('UPDATE posts SET likes = likes + 1, updated_at = ? WHERE id = ?').run(nowISO(), postId);
  const row = db.prepare('SELECT likes, shares FROM posts WHERE id = ?').get(postId);
  return res.json({ id: postId, likes: Number(row?.likes) || 0, shares: Number(row?.shares) || 0 });
});

app.post('/api/board/share', authMiddleware, (req, res) => {
  const postId = (req.body && req.body.postId) ? String(req.body.postId) : '';
  if (!postId) return res.status(400).json({ ok: false, error: 'postId required' });
  db.prepare('UPDATE posts SET shares = shares + 1, updated_at = ? WHERE id = ?').run(nowISO(), postId);
  const row = db.prepare('SELECT likes, shares FROM posts WHERE id = ?').get(postId);
  return res.json({ id: postId, likes: Number(row?.likes) || 0, shares: Number(row?.shares) || 0 });
});

app.post('/api/board/comments', authMiddleware, (req, res) => {
  const postId = (req.body && req.body.postId) ? String(req.body.postId) : '';
  const raw = (req.body && req.body.comment) ? req.body.comment : null;
  if (!postId || raw == null) return res.status(400).json({ ok: false, error: 'postId and comment required' });

  const row = db.prepare('SELECT comments_json FROM posts WHERE id = ?').get(postId);
  if (!row) return res.status(404).json({ ok: false, error: 'post not found' });

  const comments = safeJsonParse(row.comments_json, []);

  const author = { id: req.user.id, name: req.user.name, avatar: req.user.avatar || '' };
  const createdAt = nowISO();

  let body = '';
  let parentId = null;
  let clientId = null;
  if (typeof raw === 'string') {
    body = raw;
  } else if (raw && typeof raw === 'object') {
    if (raw.body != null) body = String(raw.body);
    else if (raw.text != null) body = String(raw.text);
    parentId = raw.parentId ? String(raw.parentId) : null;
    clientId = raw.id ? String(raw.id) : null;
  }
  if (!body) return res.status(400).json({ ok: false, error: 'comment body required' });

  const makeBase = (id) => ({
    id,
    body,
    author,
    createdAt,
    reactions: {},
    userReactions: {},
  });

  let created = null;
  if (!parentId) {
    const id = clientId || nanoId();
    created = { ...makeBase(id), replies: [] };
    comments.push(created);
  } else {
    const parent = comments.find((c) => c && String(c.id) === String(parentId));
    if (!parent) return res.status(404).json({ ok: false, error: 'parent comment not found' });
    const id = clientId || nanoId();
    created = makeBase(id);
    parent.replies = Array.isArray(parent.replies) ? parent.replies : [];
    parent.replies.push(created);
  }

  db.prepare('UPDATE posts SET comments_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(comments), nowISO(), postId);
  slog.debug('api', 'Comment created', { postId, parentId: parentId || undefined, commentId: created?.id });
  return res.status(201).json(created);
});

// React to a comment (toggle per-user reactions)
app.post('/api/board/comments/react', authMiddleware, (req, res) => {
  const postId = (req.body && req.body.postId) ? String(req.body.postId) : '';
  const commentId = (req.body && req.body.commentId) ? String(req.body.commentId) : '';
  const emoji = (req.body && req.body.emoji) ? String(req.body.emoji) : '';
  if (!postId || !commentId || !emoji) return res.status(400).json({ ok: false, error: 'postId, commentId, emoji required' });

  const row = db.prepare('SELECT comments_json FROM posts WHERE id = ?').get(postId);
  if (!row) return res.status(404).json({ ok: false, error: 'post not found' });

  const comments = safeJsonParse(row.comments_json, []);
  const uid = req.user?.id ? String(req.user.id) : 'anonymous';

  const applyReaction = (c) => {
    if (!c || String(c.id) !== String(commentId)) return false;
    c.reactions = (c.reactions && typeof c.reactions === 'object') ? c.reactions : {};
    c.userReactions = (c.userReactions && typeof c.userReactions === 'object') ? c.userReactions : {};
    const prev = c.userReactions[uid];
    if (prev === emoji) {
      c.reactions[emoji] = Math.max(0, Number(c.reactions[emoji] || 1) - 1);
      delete c.userReactions[uid];
    } else {
      if (prev) c.reactions[prev] = Math.max(0, Number(c.reactions[prev] || 1) - 1);
      c.reactions[emoji] = Number(c.reactions[emoji] || 0) + 1;
      c.userReactions[uid] = emoji;
    }
    return true;
  };

  let updated = null;
  for (const c of comments) {
    if (applyReaction(c)) { updated = c; break; }
    if (Array.isArray(c?.replies)) {
      for (const r of c.replies) {
        if (applyReaction(r)) { updated = r; break; }
      }
      if (updated) break;
    }
  }
  if (!updated) return res.status(404).json({ ok: false, error: 'comment not found' });

  db.prepare('UPDATE posts SET comments_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(comments), nowISO(), postId);
  slog.debug('api', 'Comment reacted', { postId, commentId, emoji });
  return res.json(updated);
});

// Messages / Chats
app.get('/api/messages', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM messages ORDER BY datetime(created_at) ASC').all();
  const parsed = rows.filter((r) => messageVisibleToUser(req.user, r)).map((r) => {
    const sender = safeJsonParse(r.sender_json, null);
    const to = safeJsonParse(r.to_json, []);
    return {
      id: r.id,
      threadId: r.thread_id || undefined,
      body: r.body,
      sender,
      to,
      createdAt: r.created_at,
    };
  });

  // Overlay latest avatars so identity stays correct even if profile avatars change.
  try {
    const ids = new Set();
    for (const m of parsed) {
      if (m?.sender?.id) ids.add(String(m.sender.id));
      if (Array.isArray(m?.to)) {
        for (const t of m.to) {
          if (t?.id) ids.add(String(t.id));
        }
      }
    }
    const idList = Array.from(ids);
    if (idList.length) {
      const placeholders = idList.map(() => '?').join(',');
      const urows = db.prepare(`SELECT id, avatar FROM users WHERE id IN (${placeholders})`).all(...idList);
      const avatarById = new Map(urows.map((u) => [String(u.id), u.avatar]));
      for (const m of parsed) {
        if (m?.sender?.id) {
          const a = avatarById.get(String(m.sender.id));
          if (a) m.sender = { ...m.sender, avatar: a };
        }
        if (Array.isArray(m?.to)) {
          m.to = m.to.map((t) => {
            if (!t?.id) return t;
            const a = avatarById.get(String(t.id));
            return a ? { ...t, avatar: a } : t;
          });
        }
      }
    }
  } catch (e) {
    // Non-fatal: messages still return without avatar overlay.
  }

  res.json(parsed);
});

app.post('/api/messages', authMiddleware, (req, res) => {
  const threadId = (req.body && (req.body.threadId || req.body.thread_id)) ? String(req.body.threadId || req.body.thread_id) : null;
  const body = (req.body && req.body.body) ? String(req.body.body) : '';
  const to = (req.body && Array.isArray(req.body.to)) ? req.body.to : [];
  if (!body) return res.status(400).json({ ok: false, error: 'body required' });

  const id = nanoId();
  const t = nowISO();
  const sender = req.user ? { id: req.user.id, name: req.user.name, avatar: req.user.avatar } : null;
  const inferredRecipientIds = to.length ? [] : inferThreadRecipientIds(threadId, req.user?.id);
  const resolvedTo = to.length ? to : inferredRecipientIds.map((recipientId) => ({ id: recipientId }));

  db.prepare('INSERT INTO messages (id, thread_id, body, sender_json, to_json, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, threadId, body, JSON.stringify(sender), JSON.stringify(resolvedTo), t);

  try {
    const recipientIds = normalizeRecipients(resolvedTo).filter((uid) => uid !== String(req.user?.id || ''));
    const tokens = getPushTokensForUsers(recipientIds, { kind: 'chats' });
    setTimeout(() => {
      sendExpoPush(tokens, {
        title: 'New message',
        body: 'Open Chats to view it.',
        data: { kind: 'chat_message', messageId: id, threadId: threadId || id },
      }).catch(() => {});
    }, 0);
  } catch (_) {
    // ignore push failures
  }

  res.status(201).json({ id, threadId: threadId || undefined, body, sender, to, createdAt: t });
});

// Urgent memos
app.get('/api/urgent-memos', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM urgent_memos ORDER BY datetime(created_at) DESC').all();
  res.json(rows.filter((r) => memoVisibleToUser(req.user, r)).map((r) => {
    const memo = safeJsonParse(r.memo_json, null);
    const base = (memo && typeof memo === 'object') ? memo : {};
    const createdAt = r.created_at;
    const title = r.title || base.title || base.subject || 'Urgent';
    const body = r.body || base.body || base.note || '';
    return {
      ...base,
      id: r.id,
      title,
      body,
      ack: Boolean(r.ack),
      status: r.status || base.status || undefined,
      respondedAt: r.responded_at || base.respondedAt || undefined,
      date: base.date || createdAt,
      createdAt,
    };
  }));
});

function buildUrgentMemoPushContent(memoObj) {
  const type = safeString(memoObj?.type).trim().toLowerCase();
  if (type === 'admin_memo') {
    const title = safeString(memoObj?.subject || memoObj?.title).trim() || 'New announcement';
    const body = safeString(memoObj?.body || memoObj?.note).trim() || 'Open the app to review the announcement.';
    return {
      title: title.slice(0, 60),
      body: body.slice(0, 110),
    };
  }
  if (type === 'urgent_memo') {
    const title = safeString(memoObj?.title || memoObj?.subject).trim() || 'Urgent memo';
    const body = safeString(memoObj?.body || memoObj?.note).trim() || 'Open the app for details.';
    return {
      title: title.slice(0, 60),
      body: body.slice(0, 110),
    };
  }
  return {
    title: 'New alert',
    body: 'Open the app for details.',
  };
}

app.post('/api/urgent-memos', authMiddleware, (req, res) => {
  const payload = (req.body && typeof req.body === 'object') ? req.body : {};
  const id = payload.id ? String(payload.id) : nanoId();
  const t = nowISO();
  const title = payload.title ? String(payload.title) : (payload.subject ? String(payload.subject) : 'Urgent');
  const body = payload.body ? String(payload.body) : (payload.note ? String(payload.note) : '');
  const status = payload.status ? String(payload.status) : (payload.type === 'time_update' ? 'pending' : (payload.type ? 'sent' : null));
  const memoObj = { ...payload, id, title, body, createdAt: t, date: t, status: status || payload.status };

  db.prepare('INSERT OR REPLACE INTO urgent_memos (id, title, body, memo_json, status, responded_at, ack, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, title, body, JSON.stringify(memoObj), status, null, 0, t);
  slog.info('api', 'Urgent memo created', { memoId: id, type: memoObj.type, status: status || undefined });

  try {
    const recipientIds = (memoObj.type === 'arrival_alert' || memoObj.type === 'time_update')
      ? getAdminUserIds()
      : normalizeRecipients(memoObj.recipients);
    const tokens = getPushTokensForUsers(recipientIds, { kind: 'updates' });
    const pushContent = buildUrgentMemoPushContent(memoObj);
    setTimeout(() => {
      sendExpoPush(tokens, {
        title: pushContent.title,
        body: pushContent.body,
        data: { kind: memoObj.type || 'urgent_memo', memoId: id, childId: memoObj.childId || null, openTo: 'login' },
      }).catch(() => {});
    }, 0);
  } catch (_) {
    // ignore push failures
  }

  res.status(201).json(memoObj);
});

app.post('/api/urgent-memos/respond', authMiddleware, (req, res) => {
  const memoId = (req.body && (req.body.memoId || req.body.id)) ? String(req.body.memoId || req.body.id) : '';
  const action = (req.body && (req.body.action || req.body.status)) ? String(req.body.action || req.body.status) : '';
  if (!memoId || !action) return res.status(400).json({ ok: false, error: 'memoId and action required' });

  const row = db.prepare('SELECT * FROM urgent_memos WHERE id = ?').get(memoId);
  if (!row) return res.status(404).json({ ok: false, error: 'memo not found' });
  if (!memoVisibleToUser(req.user, row)) return res.status(403).json({ ok: false, error: 'forbidden' });

  const t = nowISO();
  const memo = safeJsonParse(row.memo_json, null);
  const base = (memo && typeof memo === 'object') ? memo : {};
  const next = { ...base, id: memoId, status: action, respondedAt: t };

  db.prepare('UPDATE urgent_memos SET status = ?, responded_at = ?, memo_json = ? WHERE id = ?')
    .run(action, t, JSON.stringify(next), memoId);
  slog.info('api', 'Urgent memo responded', { memoId, action });
  return res.json({ ok: true, memo: next });
});

app.post('/api/urgent-memos/read', authMiddleware, (req, res) => {
  const ids = Array.isArray(req.body && req.body.memoIds) ? req.body.memoIds.map(String) : [];
  if (!ids.length) return res.json({ ok: true });
  const t = nowISO();
  const stmt = db.prepare('UPDATE urgent_memos SET ack = 1 WHERE id = ?');
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM urgent_memos WHERE id IN (${placeholders})`).all(...ids);
  const visibleIds = rows.filter((row) => memoVisibleToUser(req.user, row)).map((row) => String(row.id));
  const tx = db.transaction((arr) => { arr.forEach((id) => stmt.run(id)); });
  tx(visibleIds);
  res.json({ ok: true, updatedAt: t });
});

function normalizeArrivalEventType(value) {
  const raw = safeLower(value);
  if (raw === 'approaching' || raw === 'arrived' || raw === 'heartbeat' || raw === 'exit') return raw;
  return 'arrived';
}

function buildArrivalAlertId(payload, actorId) {
  const sessionKey = safeString(payload && payload.sessionKey).trim();
  if (sessionKey) return `arrival:${sessionKey}`;
  const childId = safeString(payload && payload.childId).trim();
  const eventId = safeString(payload && payload.eventId).trim();
  const shiftId = safeString(payload && payload.shiftId).trim();
  const when = safeString(payload && (payload.sessionStart || payload.when)).trim();
  return ['arrival', actorId, childId || shiftId, eventId, when].filter(Boolean).join(':');
}

function buildArrivalAlertCopy({ actorRole, actorName, parentName, therapistName, childName, arrivalStatus }) {
  if (arrivalStatus === 'approaching') {
    if (actorRole === 'parent' && childName) {
      return {
        title: `${childName} nearby`,
        body: `${childName} and ${parentName || actorName || 'their parent'} are nearby.`,
      };
    }
    if (actorRole === 'therapist') {
      return {
        title: childName ? `${childName} session nearby` : 'Therapist nearby',
        body: `${therapistName || actorName || 'Assigned ABA staff'} is nearby.`,
      };
    }
    return { title: 'Arrival nearby', body: 'A scheduled arrival is nearby.' };
  }

  if (arrivalStatus === 'exited') {
    return {
      title: childName ? `${childName} left arrival zone` : 'Arrival zone exited',
      body: childName ? `${childName} left the arrival zone.` : 'The scheduled arrival left the arrival zone.',
    };
  }

  return {
    title: childName ? `${childName} near site` : 'Near site',
    body: 'Near site, prepare immediate roster adjustment.',
  };
}

// Arrival pings (stores basic history)
app.post('/api/arrival/ping', authMiddleware, (req, res) => {
  const payload = req.body || {};
  const id = nanoId();
  const createdAt = nowISO();
  const actorId = req.user ? safeString(req.user.id).trim() : '';
  const actorRole = req.user ? safeString(req.user.role).trim() : '';
  db.prepare('INSERT INTO arrival_pings (id, user_id, role, child_id, lat, lng, event_id, when_iso, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(
      id,
      actorId || null,
      actorRole || null,
      payload.childId ? String(payload.childId) : null,
      Number.isFinite(Number(payload.lat)) ? Number(payload.lat) : null,
      Number.isFinite(Number(payload.lng)) ? Number(payload.lng) : null,
      payload.eventId ? String(payload.eventId) : null,
      payload.when ? String(payload.when) : null,
      createdAt
    );

  // Keep one mutable arrival alert per session scope so repeat heartbeats only refresh lastSeenAt.
  try {
    const r = String(actorRole || '').trim().toLowerCase();
    if (r === 'parent' || r === 'therapist') {
      const actorName = safeString((req.user && req.user.name) || payload.actorName).trim();
      const childId = payload.childId != null ? String(payload.childId) : null;
      const shiftId = payload.shiftId != null ? String(payload.shiftId) : null;
      const eventType = normalizeArrivalEventType(payload.eventType);
      const arrivalStatus = eventType === 'heartbeat' ? 'arrived' : (eventType === 'exit' ? 'exited' : eventType);
      const alertId = buildArrivalAlertId(payload, actorId);
      const existing = db.prepare('SELECT * FROM urgent_memos WHERE id = ?').get(alertId);
      const existingMeta = safeJsonParse(existing?.meta_json, {}) || {};
      const existingMemo = safeJsonParse(existing?.memo_json, {}) || {};
      const previousArrivalStatus = safeLower(existingMeta.arrivalStatus || existingMemo.arrivalStatus);
      const incomingRecipients = normalizeRecipients(payload.recipientIds || payload.recipients || []);
      const visibleRecipients = Array.from(new Set([
        ...normalizeRecipients(existingMemo.recipients || existingMemo.recipientIds || []),
        ...((arrivalStatus === 'arrived' || arrivalStatus === 'exited') ? incomingRecipients : []),
      ].filter(Boolean)));
      const { title, body } = buildArrivalAlertCopy({
        actorRole: r,
        actorName,
        parentName: safeString(payload.parentName).trim(),
        therapistName: safeString(payload.therapistName).trim(),
        childName: safeString(payload.childName).trim(),
        arrivalStatus,
      });
      const t = nowISO();
      const workflowStatus = eventType === 'heartbeat'
        ? (safeString(existing?.status || existingMemo.status).trim() || 'pending')
        : 'pending';
      const ackValue = eventType === 'heartbeat' && existing ? Number(existing.ack || 0) : 0;
      const meta = {
        ...(existingMeta && typeof existingMeta === 'object' ? existingMeta : {}),
        sessionKey: safeString(payload.sessionKey).trim() || alertId,
        sessionStart: payload.sessionStart ? String(payload.sessionStart) : (payload.when ? String(payload.when) : null),
        actorId,
        actorRole: r,
        actorName: actorName || null,
        parentName: payload.parentName ? String(payload.parentName) : null,
        therapistName: payload.therapistName ? String(payload.therapistName) : null,
        childName: payload.childName ? String(payload.childName) : null,
        childId,
        shiftId,
        eventId: payload.eventId ? String(payload.eventId) : null,
        arrivalStatus,
        eventType,
        heartbeatMinute: payload.heartbeatMinute != null ? Number(payload.heartbeatMinute) : null,
        lat: Number.isFinite(Number(payload.lat)) ? Number(payload.lat) : null,
        lng: Number.isFinite(Number(payload.lng)) ? Number(payload.lng) : null,
        distanceMiles: payload.distanceMiles != null ? Number(payload.distanceMiles) : null,
        dropZoneMiles: payload.dropZoneMiles != null ? Number(payload.dropZoneMiles) : null,
        arrivalRadiusMiles: payload.arrivalRadiusMiles != null ? Number(payload.arrivalRadiusMiles) : null,
        approachingRadiusMiles: payload.approachingRadiusMiles != null ? Number(payload.approachingRadiusMiles) : null,
        minutesUntilStart: payload.minutesUntilStart != null ? Number(payload.minutesUntilStart) : null,
        lastSeenAt: t,
        detectedAt: payload.detectedAt ? String(payload.detectedAt) : t,
      };
      const createdAtMemo = existing?.created_at || existingMemo.createdAt || t;
      const memoObj = {
        ...(existingMemo && typeof existingMemo === 'object' ? existingMemo : {}),
        id: alertId,
        type: 'arrival_alert',
        childId,
        childName: meta.childName,
        title,
        body,
        note: '',
        status: workflowStatus,
        arrivalStatus,
        eventType,
        proposerId: actorId,
        actorRole: r,
        actorName: actorName || null,
        parentName: meta.parentName,
        therapistName: meta.therapistName,
        recipientIds: visibleRecipients,
        recipients: visibleRecipients,
        lastSeenAt: t,
        sessionKey: meta.sessionKey,
        sessionStart: meta.sessionStart,
        shiftId,
        eventId: meta.eventId,
        distanceMiles: meta.distanceMiles,
        arrivalRadiusMiles: meta.arrivalRadiusMiles,
        approachingRadiusMiles: meta.approachingRadiusMiles,
        heartbeatMinute: meta.heartbeatMinute,
        createdAt: createdAtMemo,
        updatedAt: t,
        date: createdAtMemo,
      };

      if (existing) {
        db.prepare(`
          UPDATE urgent_memos
          SET type = ?, status = ?, proposer_id = ?, actor_role = ?, child_id = ?, title = ?, body = ?, note = ?, meta_json = ?, memo_json = ?, responded_at = ?, ack = ?, updated_at = ?
          WHERE id = ?
        `).run(
          'arrival_alert',
          workflowStatus,
          actorId,
          r,
          childId,
          title,
          body,
          '',
          JSON.stringify(meta),
          JSON.stringify(memoObj),
          eventType === 'heartbeat' ? existing.responded_at || null : null,
          ackValue,
          t,
          alertId
        );
      } else {
        db.prepare(`
          INSERT INTO urgent_memos (
            id, type, status, proposer_id, actor_role, child_id, title, body, note, meta_json, memo_json, responded_at, ack, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          alertId,
          'arrival_alert',
          workflowStatus,
          actorId,
          r,
          childId,
          title,
          body,
          '',
          JSON.stringify(meta),
          JSON.stringify(memoObj),
          null,
          ackValue,
          createdAtMemo,
          t
        );
      }

      const shouldNotify = arrivalStatus === 'arrived' && previousArrivalStatus !== 'arrived';
      if (shouldNotify) {
        try {
          const adminIds = getAdminUserIds();
          const recipientIds = Array.from(new Set([...adminIds, ...visibleRecipients].filter(Boolean)));
          const tokens = getPushTokensForUsers(recipientIds, { kind: 'updates' });
          setTimeout(() => {
            sendExpoPush(tokens, {
              title,
              body,
              data: { kind: 'arrival_alert', memoId: alertId, actorId, actorRole: r, childId, arrivalStatus },
            }).catch(() => {});
          }, 0);
        } catch (_) {
          // ignore
        }
      }
    }
  } catch (_) {
    // ignore alert generation failures
  }

  res.json({ ok: true });
});

// Time change proposals
app.get('/api/children/time-change-proposals', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM time_change_proposals ORDER BY datetime(created_at) DESC').all();
  res.json(rows.filter((r) => proposalVisibleToUser(req.user, r)).map((r) => ({
    id: r.id,
    childId: r.child_id,
    type: r.type,
    proposedISO: r.proposed_iso,
    note: r.note,
    proposerId: r.proposer_id,
    action: r.action,
    createdAt: r.created_at,
  })));
});

app.post('/api/children/propose-time-change', authMiddleware, (req, res) => {
  const id = nanoId();
  const p = req.body || {};
  const createdAt = nowISO();
  db.prepare('INSERT INTO time_change_proposals (id, child_id, type, proposed_iso, note, proposer_id, action, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(
      id,
      p.childId != null ? String(p.childId) : null,
      p.type ? String(p.type) : 'pickup',
      p.proposedISO ? String(p.proposedISO) : createdAt,
      p.note ? String(p.note) : '',
      p.proposerId != null ? String(p.proposerId) : (req.user ? String(req.user.id) : null),
      null,
      createdAt
    );

  try {
    const adminRows = db.prepare("SELECT id FROM users WHERE lower(role) IN ('admin', 'administrator')").all();
    const recipientIds = Array.from(new Set(adminRows.map((row) => safeString(row.id).trim()).filter(Boolean)));
    if (recipientIds.length) {
      const notification = buildScheduleChangePushNotification(p);
      const tokens = [];
      recipientIds.forEach((uid) => {
        const rows = db.prepare('SELECT token, preferences FROM push_tokens WHERE user_id = ? AND enabled = 1').all(uid);
        rows.forEach((row) => {
          const token = safeString(row.token).trim();
          if (!token) return;
          let preferences = {};
          try {
            preferences = row.preferences ? JSON.parse(row.preferences) : {};
          } catch (_) {
            preferences = {};
          }
          if (!pushPrefAllows(preferences, 'updates')) return;
          tokens.push(token);
        });
      });

      sendExpoPush(tokens, {
        title: notification.title,
        body: notification.body,
        data: {
          kind: notification.dataKind,
          proposalId: id,
          childId: p.childId != null ? String(p.childId) : null,
          type: p.type ? String(p.type).toLowerCase() : null,
        },
      }).catch(() => {});
    }
  } catch (_) {
    // ignore push failures
  }

  res.status(201).json({ id, ...p, proposerId: p.proposerId != null ? String(p.proposerId) : (req.user ? String(req.user.id) : null), createdAt });
});

app.post('/api/children/respond-time-change', authMiddleware, (req, res) => {
  const proposalId = (req.body && req.body.proposalId) ? String(req.body.proposalId) : '';
  const action = (req.body && req.body.action) ? String(req.body.action) : '';
  if (!proposalId || !action) return res.status(400).json({ ok: false, error: 'proposalId and action required' });
  const row = db.prepare('SELECT * FROM time_change_proposals WHERE id = ?').get(proposalId);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  if (!proposalVisibleToUser(req.user, row)) return res.status(403).json({ ok: false, error: 'forbidden' });
  db.prepare('UPDATE time_change_proposals SET action = ? WHERE id = ?').run(action, proposalId);
  res.json({
    ok: true,
    item: {
      id: row.id,
      childId: row.child_id,
      type: row.type,
      proposedISO: row.proposed_iso,
      note: row.note,
      proposerId: row.proposer_id,
      action: row.action,
      createdAt: row.created_at,
    },
  });
});

// Push tokens
app.post('/api/push/register', authMiddleware, (req, res) => {
  const token = (req.body && req.body.token) ? String(req.body.token) : '';
  const userId = (req.body && req.body.userId) ? String(req.body.userId) : (req.user ? String(req.user.id) : '');
  const platform = (req.body && req.body.platform) ? String(req.body.platform) : '';
  const enabled = (req.body && typeof req.body.enabled === 'boolean') ? (req.body.enabled ? 1 : 0) : 1;
  const preferences = (req.body && typeof req.body.preferences === 'object') ? req.body.preferences : {};

  if (!token) return res.status(400).json({ ok: false, error: 'token required' });

  const t = nowISO();
  db.prepare(`
    INSERT INTO push_tokens (token, user_id, platform, enabled, preferences_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
      user_id=excluded.user_id,
      platform=excluded.platform,
      enabled=excluded.enabled,
      preferences_json=excluded.preferences_json,
      updated_at=excluded.updated_at
  `).run(token, userId, platform, enabled, JSON.stringify(preferences), t);

  res.json({ ok: true, stored: true });
});

app.post('/api/push/unregister', authMiddleware, (req, res) => {
  const token = (req.body && req.body.token) ? String(req.body.token) : '';
  if (!token) return res.status(400).json({ ok: false, error: 'token required' });
  db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
  res.json({ ok: true, removed: true });
});

// Minimal compatibility endpoints for features not yet backed
app.post('/api/media/sign', authMiddleware, uploadRateLimit, (req, res) => {
  const key = (req.body && req.body.key) ? String(req.body.key) : `uploads/${Date.now()}`;
  res.json({ url: `http://localhost:9000/${key}`, fields: {}, key });
});

app.get('/api/link/preview', authMiddleware, (req, res) => {
  const url = (req.query && req.query.url) ? String(req.query.url) : '';
  res.json({ ok: true, url, title: url, description: '', image: '' });
});

// Media upload (local disk). The mobile app uses this when attaching an image to a post.
// Expects multipart/form-data with a `file` field.
app.post('/api/media/upload', authMiddleware, uploadRateLimit, upload.single('file'), (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ ok: false, error: 'file required' });

  const relPath = `/uploads/${encodeURIComponent(f.filename)}`;
  let url = buildPublicUrl(req, relPath);
  if (REQUIRE_UPLOAD_AUTH) {
    const token = signUploadAccessToken(relPath);
    if (token) url = `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
  }

  res.status(201).json({
    ok: true,
    url,
    path: relPath,
    filename: f.filename,
    mimetype: f.mimetype,
    size: f.size,
  });
});

// If this service is mounted directly on a custom domain (e.g. app.communitybridge.app),
// serve the static site from /public for non-API routes.
// This prevents the default Express "Cannot GET /" response on the root path.
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PUBLIC_DIR_PREFIX = `${PUBLIC_DIR}${path.sep}`;

// Optional: exported Expo web app bundle.
// Build it with `npm run build:web` (outputs to /web-dist).
const WEB_DIST_DIR = path.resolve(__dirname, '..', 'web-dist');
const WEB_DIST_DIR_PREFIX = `${WEB_DIST_DIR}${path.sep}`;

function getRequestHost(req) {
  try {
    const xfHost = req.headers['x-forwarded-host'];
    const raw = String(xfHost || req.headers.host || '').split(',')[0].trim();
    return raw.toLowerCase();
  } catch (_) {
    return '';
  }
}

function shouldServeWebApp(req) {
  // If CB_SERVE_WEB_APP or BB_SERVE_WEB_APP is set, always serve the web app.
  if (String(process.env.CB_SERVE_WEB_APP || process.env.BB_SERVE_WEB_APP || '') === '1') return true;

  const host = getRequestHost(req);
  return host.startsWith('app.');
}

function dirExists(p) {
  try {
    const st = fs.statSync(p);
    return st && st.isDirectory();
  } catch (_) {
    return false;
  }
}

function fileExists(p) {
  try {
    const st = fs.statSync(p);
    return st && st.isFile();
  } catch (_) {
    return false;
  }
}

function resolvePublicFileForRequestPath(reqPath) {
  try {
    if (!reqPath) return null;
    // Never handle API routes here.
    if (reqPath.startsWith('/api/') || reqPath === '/api') return null;
    if (reqPath.startsWith('/uploads/') || reqPath === '/uploads') return null;

    const decoded = decodeURIComponent(String(reqPath));
    const normalized = decoded.replace(/\\/g, '/');
    if (normalized.includes('..') || normalized.includes('\u0000')) return null;

    // Root.
    if (normalized === '/' || normalized === '') {
      const p = path.resolve(PUBLIC_DIR, 'index.html');
      return fileExists(p) ? p : null;
    }

    // Trim leading slashes.
    const rel = normalized.replace(/^\/+/, '');

    // 1) Direct file (/favicon.png)
    let candidate = path.resolve(PUBLIC_DIR, rel);
    if (!candidate.startsWith(PUBLIC_DIR_PREFIX) && candidate !== PUBLIC_DIR) return null;
    if (fileExists(candidate)) return candidate;

    // 2) Directory index (/support -> /support/index.html)
    candidate = path.resolve(PUBLIC_DIR, rel, 'index.html');
    if (candidate.startsWith(PUBLIC_DIR_PREFIX) && fileExists(candidate)) return candidate;

    // 3) Clean URL (/support -> /support.html)
    candidate = path.resolve(PUBLIC_DIR, `${rel}.html`);
    if (candidate.startsWith(PUBLIC_DIR_PREFIX) && fileExists(candidate)) return candidate;
  } catch (_) {
    // ignore
  }
  return null;
}

function resolveWebDistFileForRequestPath(reqPath) {
  try {
    if (!dirExists(WEB_DIST_DIR)) return null;
    if (!reqPath) return null;
    if (reqPath.startsWith('/api/') || reqPath === '/api') return null;
    if (reqPath.startsWith('/uploads/') || reqPath === '/uploads') return null;

    const decoded = decodeURIComponent(String(reqPath));
    const normalized = decoded.replace(/\\/g, '/');
    if (normalized.includes('..') || normalized.includes('\u0000')) return null;

    // Root -> SPA entry.
    if (normalized === '/' || normalized === '') {
      const p = path.resolve(WEB_DIST_DIR, 'index.html');
      return fileExists(p) ? p : null;
    }

    const rel = normalized.replace(/^\/+/, '');

    // Static file.
    let candidate = path.resolve(WEB_DIST_DIR, rel);
    if (!candidate.startsWith(WEB_DIST_DIR_PREFIX) && candidate !== WEB_DIST_DIR) return null;
    if (fileExists(candidate)) return candidate;

    // Directory index.
    candidate = path.resolve(WEB_DIST_DIR, rel, 'index.html');
    if (candidate.startsWith(WEB_DIST_DIR_PREFIX) && fileExists(candidate)) return candidate;

    // SPA fallback for clean routes (no file extension).
    if (!rel.includes('.')) {
      candidate = path.resolve(WEB_DIST_DIR, 'index.html');
      return fileExists(candidate) ? candidate : null;
    }
  } catch (_) {
    // ignore
  }
  return null;
}

// Express 5 uses path-to-regexp v6+, where `"*"` is not a valid path pattern.
// Use a regex catch-all to keep Cloud Run from crashing at startup.
app.get(/.*/, (req, res, next) => {
  // On the app subdomain, serve the exported web app if present.
  if (shouldServeWebApp(req)) {
    // Keep the root path as marketing (and let it optionally redirect to /home
    // if already authenticated). The Expo web app is intentionally served under /home.
    if (req.path === '/' || req.path === '/index.html') {
      const pRoot = resolvePublicFileForRequestPath('/');
      if (pRoot) return res.sendFile(pRoot);
    }

    if (
      req.path === '/app-login' ||
      req.path === '/app-login.html' ||
      req.path.startsWith('/app-login/') ||
      req.path === '/login' ||
      req.path === '/login.html' ||
      req.path.startsWith('/login/')
    ) {
      const pAuth = req.path === '/app-login' || req.path === '/app-login.html' || req.path.startsWith('/app-login/')
        ? resolvePublicFileForRequestPath('/app-login')
        : resolvePublicFileForRequestPath('/dashboard');
      if (pAuth) return res.sendFile(pAuth);
    }

    if (
      req.path === '/sign-up' ||
      req.path === '/sign-up.html' ||
      req.path.startsWith('/sign-up/')
    ) {
      const pSignUp = resolvePublicFileForRequestPath(req.path);
      if (pSignUp) return res.sendFile(pSignUp);
    }

    const pWeb = resolveWebDistFileForRequestPath(req.path);
    if (pWeb) return res.sendFile(pWeb);

    // Fallback to public assets (favicon, support pages) if needed.
    const pPublic = resolvePublicFileForRequestPath(req.path);
    if (pPublic) return res.sendFile(pPublic);

    return next();
  }

  if (
    req.path === '/app-login' ||
    req.path === '/app-login.html' ||
    req.path.startsWith('/app-login/') ||
    req.path === '/login' ||
    req.path === '/login.html' ||
    req.path.startsWith('/login/')
  ) {
    const pAuth = (req.path === '/app-login' || req.path === '/app-login.html' || req.path.startsWith('/app-login/'))
      ? (resolvePublicFileForRequestPath('/app-login') || resolveWebDistFileForRequestPath('/'))
      : (resolvePublicFileForRequestPath('/dashboard') || resolveWebDistFileForRequestPath('/'));
    if (pAuth) return res.sendFile(pAuth);
  }

  const p = resolvePublicFileForRequestPath(req.path);
  if (!p) return next();
  return res.sendFile(p);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] CommunityBridge API listening on :${PORT}`);
  console.log(`[api] DB: ${DB_PATH}`);
});

activeServer = server;
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.on('connection', (socket) => {
  activeSockets.add(socket);
  socket.on('close', () => activeSockets.delete(socket));
});

process.on('uncaughtException', (e) => {
  console.error('[api] Uncaught', e);
});

process.on('SIGTERM', () => {
  shutdownServer('SIGTERM').catch(() => process.exit(1));
});

process.on('SIGINT', () => {
  shutdownServer('SIGINT').catch(() => process.exit(1));
});
