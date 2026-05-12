const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

// Keep all Cloud Functions in a single region for predictable latency/costs.
// Firebase default is often us-central1, but we make it explicit.
const regional = functions.region('us-central1');

function safeString(v) {
  try {
    if (v == null) return '';
    return String(v);
  } catch (_) {
    return '';
  }
}

function hasExpoPushToken(token) {
  const t = safeString(token).trim();
  return t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[');
}

function pushPrefAllows(preferences, kind) {
  if (!preferences || typeof preferences !== 'object') return true;
  const keys = Object.keys(preferences);
  if (!keys.length) return true;
  if (kind === 'chats') return Boolean(preferences.chats ?? true);
  if (kind === 'updates') return Boolean(preferences.updates ?? preferences.other ?? true);
  if (kind === 'other') return Boolean(preferences.other ?? preferences.updates ?? true);
  return true;
}

function shouldDeleteTokenForExpoError(expoTicket) {
  try {
    if (!expoTicket || expoTicket.status !== 'error') return false;
    const details = expoTicket.details && typeof expoTicket.details === 'object' ? expoTicket.details : {};
    const code = safeString(details.error).trim();
    return code === 'DeviceNotRegistered' || code === 'InvalidExpoPushToken';
  } catch (_) {
    return false;
  }
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

async function sendExpoPush(tokens, { title, body, data, kind } = {}) {
  if (!Array.isArray(tokens) || !tokens.length) return { ok: true, skipped: true, reason: 'no-tokens' };
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
  const tickets = json && Array.isArray(json.data) ? json.data : null;
  const tokensToDelete = [];

  if (resp.ok && tickets && tickets.length === messages.length) {
    for (let i = 0; i < tickets.length; i += 1) {
      if (shouldDeleteTokenForExpoError(tickets[i])) tokensToDelete.push(messages[i].to);
    }
  }

  if (tokensToDelete.length) {
    try {
      const batch = admin.firestore().batch();
      tokensToDelete.forEach((t) => {
        const ref = admin.firestore().collection('pushTokens').doc(String(t));
        batch.delete(ref);
      });
      await batch.commit();
    } catch (_) {
      // ignore cleanup failures
    }
  }

  return { ok: resp.ok, status: resp.status, expo: json, deleted: tokensToDelete.length, kind: kind || undefined };
}

function isPrivateHostname(hostname) {
  const h = safeString(hostname).trim().toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.local')) return true;
  if (/^(127\.|10\.|192\.168\.|0\.|169\.254\.)/.test(h)) return true;
  // 172.16.0.0 – 172.31.255.255
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  return false;
}

async function fetchTextWithLimits(url, { timeoutMs = 5000, maxBytes = 1024 * 1024 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'CommunityBridgeLinkPreview/1.0',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const contentType = safeString(resp.headers.get('content-type'));
    if (!contentType.toLowerCase().includes('text/html')) {
      throw new Error(`Unsupported content-type: ${contentType || 'unknown'}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) throw new Error('Response too large');
    return Buffer.from(arrayBuffer).toString('utf8');
  } finally {
    clearTimeout(timeout);
  }
}

function extractMeta(html, nameOrProp) {
  const key = safeString(nameOrProp).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  const m = html.match(re);
  return m && m[1] ? String(m[1]).trim() : '';
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  return m && m[1] ? String(m[1]).trim() : '';
}

function nowMs() {
  return Date.now();
}

function randomDigits(len) {
  const n = Number(len) || 6;
  const max = 10 ** n;
  const v = crypto.randomInt(0, max);
  return String(v).padStart(n, '0');
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

function getMfaSecret() {
  // Use an env var (preferred). Fallback keeps dev/test usable but should be set in prod.
  const fromEnv = safeString(process.env.CB_MFA_CODE_SECRET || process.env.BB_MFA_CODE_SECRET).trim();
  if (fromEnv) return fromEnv;
  const fromProject = safeString(process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT).trim();
  return fromProject || 'bb_mfa_default_secret';
}

function normalizeMethod(method) {
  const m = safeString(method).trim().toLowerCase();
  if (m === 'sms') return 'sms';
  return 'email';
}

function normalizePhone(phone) {
  // Minimal normalization. Prefer storing E.164 in user profile.
  const p = safeString(phone).trim();
  return p;
}

function getDisplayEmail(email) {
  const e = safeString(email).trim();
  return e;
}

async function sendEmailOtp({ to, code }) {
  const smtpUrl = safeString(process.env.CB_SMTP_URL || process.env.BB_SMTP_URL).trim();
  if (!smtpUrl) {
    const err = new Error('Email 2FA is not configured (missing CB_SMTP_URL/BB_SMTP_URL).');
    err.code = 'BB_MFA_EMAIL_NOT_CONFIGURED';
    throw err;
  }

  let nodemailer;
  try {
    // Lazy-load to keep deploy analysis fast.
    // eslint-disable-next-line global-require
    nodemailer = require('nodemailer');
  } catch (_) {
    const err = new Error('Email 2FA dependency missing (nodemailer).');
    err.code = 'BB_MFA_EMAIL_DEP_MISSING';
    throw err;
  }

  const from = safeString(process.env.CB_EMAIL_FROM || process.env.BB_EMAIL_FROM || process.env.CB_SMTP_FROM || process.env.BB_SMTP_FROM || 'info@communitybridge.app').trim();
  const transporter = nodemailer.createTransport(smtpUrl);
  const subject = 'CommunityBridge verification code';
  const text = `Your CommunityBridge verification code is: ${code}\n\nThis code expires in 10 minutes.`;

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
  });
}

async function sendSmsOtp({ to, code }) {
  const sid = safeString(process.env.CB_TWILIO_ACCOUNT_SID || process.env.BB_TWILIO_ACCOUNT_SID).trim();
  const token = safeString(process.env.CB_TWILIO_AUTH_TOKEN || process.env.BB_TWILIO_AUTH_TOKEN).trim();
  if (!sid || !token) {
    const err = new Error('SMS 2FA is not configured (missing CB_TWILIO_ACCOUNT_SID/CB_TWILIO_AUTH_TOKEN or BB_TWILIO_ACCOUNT_SID/BB_TWILIO_AUTH_TOKEN).');
    err.code = 'BB_MFA_SMS_NOT_CONFIGURED';
    throw err;
  }

  let twilioFactory;
  try {
    // Lazy-load to keep deploy analysis fast.
    // eslint-disable-next-line global-require
    twilioFactory = require('twilio');
  } catch (_) {
    const err = new Error('SMS 2FA dependency missing (twilio).');
    err.code = 'BB_MFA_SMS_DEP_MISSING';
    throw err;
  }

  const from = safeString(process.env.CB_TWILIO_FROM || process.env.BB_TWILIO_FROM).trim();
  const messagingServiceSid = safeString(process.env.CB_TWILIO_MESSAGING_SERVICE_SID || process.env.BB_TWILIO_MESSAGING_SERVICE_SID).trim();
  if (!from && !messagingServiceSid) {
    const err = new Error('SMS 2FA missing CB_TWILIO_FROM/CB_TWILIO_MESSAGING_SERVICE_SID or BB_TWILIO_FROM/BB_TWILIO_MESSAGING_SERVICE_SID.');
    err.code = 'BB_MFA_SMS_FROM_MISSING';
    throw err;
  }

  const client = twilioFactory(sid, token);
  const body = `CommunityBridge verification code: ${code} (expires in 10 minutes)`;
  const msg = { to, body };
  if (messagingServiceSid) msg.messagingServiceSid = messagingServiceSid;
  else msg.from = from;
  await client.messages.create(msg);
}

function sanitizeChallengeForClient(ch) {
  if (!ch || typeof ch !== 'object') return null;
  return {
    method: ch.method || null,
    to: ch.to || null,
    expiresAt: ch.expiresAt || null,
    sentAt: ch.sentAt || null,
  };
}

function sanitizeLookupDoc(id, data, extras) {
  const payload = data && typeof data === 'object' ? data : {};
  return {
    id: safeString(id).trim(),
    name: safeString(payload.name || payload.displayName || payload.title).trim(),
    active: payload.active !== false,
    ...extras,
  };
}

function normalizedEnrollmentCodes(data) {
  const base = [];
  const single = safeString(data?.enrollmentCode).trim();
  if (single) base.push(single);
  const list = Array.isArray(data?.enrollmentCodes) ? data.enrollmentCodes : [];
  list.forEach((code) => {
    const value = safeString(code).trim();
    if (value) base.push(value);
  });
  return Array.from(new Set(base.map((value) => value.toUpperCase())));
}

async function resolveEnrollmentContextFromCode({ firestore, enrollmentCode }) {
  const campusSnap = await firestore.collectionGroup('campuses').where('active', '==', true).get();
  const matches = campusSnap.docs.filter((docSnap) => normalizedEnrollmentCodes(docSnap.data()).includes(enrollmentCode));
  if (!matches.length) {
    throw new functions.https.HttpsError('permission-denied', 'Enrollment code did not match an active campus.');
  }
  if (matches.length > 1) {
    throw new functions.https.HttpsError('failed-precondition', 'Enrollment code matched multiple campuses. Contact support to finish account setup.');
  }

  const matchedCampus = matches[0];
  const orgRef = matchedCampus.ref.parent.parent;
  const orgSnap = orgRef ? await orgRef.get() : null;
  const orgData = orgSnap?.exists ? (orgSnap.data() || {}) : null;
  const resolvedOrganizationId = safeString(orgSnap?.id).trim();
  const resolvedProgramId = safeString(matchedCampus.data()?.programId || matchedCampus.data()?.branchId).trim();
  if (!orgSnap?.exists || orgData?.active === false || !resolvedOrganizationId || !resolvedProgramId) {
    throw new functions.https.HttpsError('not-found', 'Enrollment context is not active.');
  }

  const programSnap = await orgRef.collection('programs').doc(resolvedProgramId).get();
  if (!programSnap.exists || programSnap.data()?.active === false) {
    throw new functions.https.HttpsError('not-found', 'Program not found.');
  }

  return {
    organization: sanitizeLookupDoc(orgSnap.id, orgData, {
      shortCode: safeString(orgData?.shortCode || orgData?.code).trim(),
    }),
    program: sanitizeLookupDoc(programSnap.id, programSnap.data(), {
      organizationId: resolvedOrganizationId,
      type: safeString(programSnap.data()?.type).trim(),
    }),
    campus: sanitizeLookupDoc(matchedCampus.id, matchedCampus.data(), {
      organizationId: resolvedOrganizationId,
      programId: resolvedProgramId,
    }),
  };
}

function slugify(value) {
  return safeString(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeEmail(value) {
  return safeString(value).trim().toLowerCase();
}

function normalizeProgramTypeValue(value) {
  const raw = safeString(value).trim().toLowerCase();
  if (!raw) return 'centerBasedAba';
  if (['centerbasedaba', 'center_based_aba', 'center based aba', 'aba'].includes(raw)) return 'centerBasedAba';
  if (['earlyinterventionacademy', 'early_intervention_academy', 'early intervention academy', 'academy'].includes(raw)) return 'earlyInterventionAcademy';
  if (['corporate', 'operations'].includes(raw)) return 'corporate';
  return 'centerBasedAba';
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const key = safeString(keyFn(item)).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function htmlEscape(value) {
  return safeString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderIntakeResultPage({ title, body, accent = '#2563eb' }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${htmlEscape(title)}</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: linear-gradient(180deg, #f8fafc, #eef2ff); color: #0f172a; }
      .wrap { max-width: 720px; margin: 0 auto; padding: 64px 20px; }
      .card { background: #fff; border: 1px solid rgba(15, 23, 42, 0.08); border-radius: 24px; padding: 28px; box-shadow: 0 22px 50px rgba(15, 23, 42, 0.08); }
      h1 { margin: 0 0 14px; font-size: 32px; }
      p { margin: 0; font-size: 16px; line-height: 1.7; color: #475569; }
      .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 12px; margin-bottom: 16px; background: ${accent}; color: #fff; font-size: 12px; font-weight: 700; letter-spacing: 0.02em; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="pill">CommunityBridge Organization Intake</div>
        <h1>${htmlEscape(title)}</h1>
        <p>${htmlEscape(body)}</p>
      </div>
    </div>
  </body>
</html>`;
}

function getPublicBaseUrl(req) {
  const configured = safeString(process.env.CB_PUBLIC_BASE_URL || process.env.BB_PUBLIC_BASE_URL).trim();
  if (configured) return configured.replace(/\/$/, '');
  const proto = safeString(req.headers['x-forwarded-proto'] || req.protocol || 'https').trim() || 'https';
  const host = safeString(req.headers['x-forwarded-host'] || req.headers.host).trim() || 'communitybridge.app';
  return `${proto}://${host}`.replace(/\/$/, '');
}

function getOrgIntakeSecret() {
  const fromEnv = safeString(process.env.CB_ORG_INTAKE_SECRET || process.env.BB_ORG_INTAKE_SECRET).trim();
  if (fromEnv) return fromEnv;
  return `${getMfaSecret()}_org_intake`;
}

function getOrgSignupInbox() {
  return safeString(process.env.CB_ORG_SIGNUP_TO || process.env.BB_ORG_SIGNUP_TO || 'org_signup@communitybridge.app').trim();
}

function getRecaptchaSiteKey() {
  return safeString(process.env.CB_RECAPTCHA_SITE_KEY || process.env.BB_RECAPTCHA_SITE_KEY).trim();
}

function getRecaptchaSecretKey() {
  return safeString(process.env.CB_RECAPTCHA_SECRET_KEY || process.env.BB_RECAPTCHA_SECRET_KEY).trim();
}

function getGooglePlacesApiKey() {
  return safeString(
    process.env.CB_GOOGLE_PLACES_API_KEY ||
    process.env.BB_GOOGLE_PLACES_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY
  ).trim();
}

async function verifyRecaptchaToken({ token, remoteIp }) {
  const secret = getRecaptchaSecretKey();
  if (!secret) {
    const err = new Error('reCAPTCHA is not configured (missing CB_RECAPTCHA_SECRET_KEY/BB_RECAPTCHA_SECRET_KEY).');
    err.code = 'BB_RECAPTCHA_NOT_CONFIGURED';
    throw err;
  }

  const recaptchaToken = safeString(token).trim();
  if (!recaptchaToken) return { ok: false, reason: 'missing-token' };

  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', recaptchaToken);
  if (remoteIp) params.set('remoteip', safeString(remoteIp).trim());

  const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const json = await resp.json().catch(() => null);
  const success = Boolean(json && json.success === true);
  return {
    ok: success,
    reason: success ? '' : safeString((json && Array.isArray(json['error-codes']) && json['error-codes'][0]) || 'verification-failed').trim(),
    payload: json,
  };
}

function buildSubmissionToken(submissionId) {
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = sha256Hex(`${safeString(submissionId).trim()}:${token}:${getOrgIntakeSecret()}`);
  return { token, tokenHash };
}

function verifySubmissionToken(submissionId, token, tokenHash) {
  const expected = sha256Hex(`${safeString(submissionId).trim()}:${safeString(token).trim()}:${getOrgIntakeSecret()}`);
  return !!tokenHash && expected === safeString(tokenHash).trim();
}

function normalizeIntakeLocation(location, index, orgId) {
  const item = location && typeof location === 'object' ? location : {};
  const programName = safeString(item.programName).trim();
  const programId = safeString(item.programId).trim() || slugify(programName);
  const city = safeString(item.city).trim();
  const state = safeString(item.state).trim().toUpperCase();
  const zipCode = safeString(item.zipCode).trim();
  const enrollmentCode = safeString(item.enrollmentCode).trim() || zipCode;
  const campusName = safeString(item.name).trim() || [programName, city].filter(Boolean).join(' - ');
  const fallbackId = slugify(`${orgId}-${programId}-${city}-${zipCode || index + 1}`);
  return {
    id: safeString(item.id).trim() || fallbackId,
    organizationId: orgId,
    programId,
    programName,
    programType: normalizeProgramTypeValue(item.programType),
    name: campusName,
    slug: slugify(campusName) || fallbackId,
    phone: normalizePhone(item.phone),
    email: normalizeEmail(item.email),
    address1: safeString(item.address1).trim(),
    address2: safeString(item.address2).trim(),
    city,
    state,
    zipCode,
    enrollmentCode,
    enrollmentCodes: uniqueBy([enrollmentCode, zipCode].filter(Boolean).map((value) => ({ value: value.toUpperCase() })), (entry) => entry.value).map((entry) => entry.value),
    campusType: safeString(item.campusType).trim() || 'Center',
    active: true,
  };
}

function normalizeIntakeSubmission(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const organizationName = safeString(payload?.organization?.name || payload.organizationName).trim();
  const orgId = safeString(payload?.organization?.id || payload.organizationId).trim() || slugify(organizationName);
  const locationsRaw = Array.isArray(payload?.locations) ? payload.locations : [];
  const locations = uniqueBy(
    locationsRaw.map((location, index) => normalizeIntakeLocation(location, index, orgId)).filter((location) => location.programId && location.name),
    (location) => location.id
  );

  const programs = uniqueBy(locations.map((location) => ({
    id: location.programId,
    organizationId: orgId,
    name: location.programName,
    slug: slugify(location.programName) || location.programId,
    type: location.programType,
    description: '',
    active: true,
  })), (program) => program.id);

  return {
    organization: {
      id: orgId,
      name: organizationName,
      directoryName: safeString(payload?.organization?.directoryName || payload.organizationDirectoryName).trim() || organizationName,
      slug: safeString(payload?.organization?.slug).trim() || orgId,
      shortCode: safeString(payload?.organization?.shortCode || payload.organizationShortCode).trim().toUpperCase(),
      phone: normalizePhone(payload?.organization?.phone || payload.organizationPhone),
      email: normalizeEmail(payload?.organization?.email || payload.organizationEmail),
      address1: safeString(payload?.organization?.address1 || payload.organizationAddress1).trim(),
      address2: safeString(payload?.organization?.address2 || payload.organizationAddress2).trim(),
      city: safeString(payload?.organization?.city || payload.organizationCity).trim(),
      state: safeString(payload?.organization?.state || payload.organizationState).trim().toUpperCase(),
      zipCode: safeString(payload?.organization?.zipCode || payload.organizationZipCode).trim(),
      website: safeString(payload?.organization?.website || payload.organizationWebsite).trim(),
      active: true,
    },
    contact: {
      name: safeString(payload?.contact?.name || payload.contactName).trim(),
      title: safeString(payload?.contact?.title || payload.contactTitle).trim(),
      email: normalizeEmail(payload?.contact?.email || payload.contactEmail),
      phone: normalizePhone(payload?.contact?.phone || payload.contactPhone),
    },
    notes: safeString(payload?.notes).trim(),
    locations,
    programs,
    honeypot: safeString(payload?.website).trim(),
  };
}

function validateIntakeSubmission(submission) {
  const errors = [];
  if (submission.honeypot) errors.push('Spam check failed.');
  if (!submission?.organization?.id || !submission?.organization?.name) errors.push('Organization name is required.');
  if (!submission?.contact?.name) errors.push('Primary contact name is required.');
  if (!submission?.contact?.email) errors.push('Primary contact email is required.');
  if (!submission?.locations?.length) errors.push('At least one location is required.');
  (submission?.locations || []).forEach((location, index) => {
    if (!location.programName) errors.push(`Location ${index + 1}: program name is required.`);
    if (!location.name) errors.push(`Location ${index + 1}: campus name is required.`);
    if (!location.city || !location.state || !location.zipCode) errors.push(`Location ${index + 1}: city, state, and ZIP are required.`);
    if (!location.enrollmentCode) errors.push(`Location ${index + 1}: enrollment code is required.`);
  });
  return errors;
}

function formatIntakeAddress(item) {
  const line1 = [item?.address1, item?.address2].filter(Boolean).join(', ');
  const line2 = [item?.city, item?.state, item?.zipCode].filter(Boolean).join(', ');
  return [line1, line2].filter(Boolean).join(' | ');
}

function buildIntakeSummaryText(submission) {
  const lines = [];
  const organizationName = submission.organization.directoryName || submission.organization.name;
  lines.push(`Organization: ${organizationName}`);
  if (submission.organization.shortCode) lines.push(`Short code: ${submission.organization.shortCode}`);
  if (submission.organization.website) lines.push(`Website: ${submission.organization.website}`);
  if (submission.organization.email) lines.push(`Organization email: ${submission.organization.email}`);
  if (submission.organization.phone) lines.push(`Organization phone: ${submission.organization.phone}`);
  const organizationAddress = formatIntakeAddress(submission.organization);
  if (organizationAddress) lines.push(`Organization address: ${organizationAddress}`);
  lines.push(`Primary contact: ${submission.contact.name}${submission.contact.title ? ` (${submission.contact.title})` : ''}`);
  lines.push(`Contact email: ${submission.contact.email}`);
  if (submission.contact.phone) lines.push(`Contact phone: ${submission.contact.phone}`);
  lines.push(`Programs requested: ${(submission.programs || []).length}`);
  lines.push(`Locations requested: ${(submission.locations || []).length}`);
  lines.push('');
  lines.push('Requested locations:');
  (submission.locations || []).forEach((location, index) => {
    lines.push(`${index + 1}. ${location.name}`);
    lines.push(`   Program: ${location.programName}`);
    if (location.programType) lines.push(`   Program type: ${location.programType}`);
    lines.push(`   Enrollment code: ${location.enrollmentCode}`);
    if (location.campusType) lines.push(`   Campus type: ${location.campusType}`);
    if (location.phone) lines.push(`   Phone: ${location.phone}`);
    if (location.email) lines.push(`   Email: ${location.email}`);
    const locationAddress = formatIntakeAddress(location);
    if (locationAddress) lines.push(`   Address: ${locationAddress}`);
  });
  if (submission.notes) {
    lines.push('');
    lines.push(`Notes: ${submission.notes}`);
  }
  return lines.join('\n');
}

function buildIntakeLocationHtml(locations) {
  return (locations || []).map((location) => `
    <li style="margin-bottom:12px;">
      <strong>${htmlEscape(location.name)}</strong><br />
      Program: ${htmlEscape(location.programName)}<br />
      ${location.programType ? `Program type: ${htmlEscape(location.programType)}<br />` : ''}
      Enrollment code: ${htmlEscape(location.enrollmentCode)}<br />
      ${location.campusType ? `Campus type: ${htmlEscape(location.campusType)}<br />` : ''}
      ${location.phone ? `Phone: ${htmlEscape(location.phone)}<br />` : ''}
      ${location.email ? `Email: ${htmlEscape(location.email)}<br />` : ''}
      ${htmlEscape(formatIntakeAddress(location))}
    </li>`).join('');
}

function buildIntakeEmailHtml({ submission, approveUrl, rejectUrl }) {
  const locationItems = buildIntakeLocationHtml(submission.locations || []);
  const organizationAddress = formatIntakeAddress(submission.organization);

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.6;">
      <h2 style="margin-bottom:8px;">New organization intake submission</h2>
      <p><strong>Organization:</strong> ${htmlEscape(submission.organization.directoryName || submission.organization.name)}</p>
      ${submission.organization.shortCode ? `<p><strong>Short code:</strong> ${htmlEscape(submission.organization.shortCode)}</p>` : ''}
      ${submission.organization.website ? `<p><strong>Website:</strong> ${htmlEscape(submission.organization.website)}</p>` : ''}
      ${submission.organization.email ? `<p><strong>Organization email:</strong> ${htmlEscape(submission.organization.email)}</p>` : ''}
      ${submission.organization.phone ? `<p><strong>Organization phone:</strong> ${htmlEscape(submission.organization.phone)}</p>` : ''}
      ${organizationAddress ? `<p><strong>Organization address:</strong> ${htmlEscape(organizationAddress)}</p>` : ''}
      <p><strong>Primary contact:</strong> ${htmlEscape(submission.contact.name)}${submission.contact.title ? `, ${htmlEscape(submission.contact.title)}` : ''}</p>
      <p><strong>Contact email:</strong> ${htmlEscape(submission.contact.email)}</p>
      ${submission.contact.phone ? `<p><strong>Contact phone:</strong> ${htmlEscape(submission.contact.phone)}</p>` : ''}
      <p><strong>Programs requested:</strong> ${htmlEscape(String((submission.programs || []).length))}</p>
      <p><strong>Locations requested:</strong> ${htmlEscape(String((submission.locations || []).length))}</p>
      <p><strong>Requested locations:</strong></p>
      <ul>${locationItems}</ul>
      ${submission.notes ? `<p><strong>Notes:</strong> ${htmlEscape(submission.notes)}</p>` : ''}
      <p style="margin-top:24px;">
        <a href="${htmlEscape(approveUrl)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;margin-right:10px;">Approve</a>
        <a href="${htmlEscape(rejectUrl)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:700;">Reject</a>
      </p>
    </div>`;
}

function buildApplicantConfirmationEmailHtml({ submission }) {
  const locationItems = buildIntakeLocationHtml(submission.locations || []);

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.6;">
      <h2 style="margin-bottom:8px;">Your CommunityBridge organization intake was received</h2>
      <p>Thanks for submitting <strong>${htmlEscape(submission.organization.directoryName || submission.organization.name)}</strong> for review.</p>
      <p>CommunityBridge operations has received your intake and will review it before activation. When approved, your organization, programs, and campuses will be added directly into the app for enrollment.</p>
      <p><strong>Primary contact:</strong> ${htmlEscape(submission.contact.name)}${submission.contact.title ? `, ${htmlEscape(submission.contact.title)}` : ''}</p>
      <p><strong>Contact email:</strong> ${htmlEscape(submission.contact.email)}</p>
      <p><strong>Locations submitted:</strong></p>
      <ul>${locationItems}</ul>
      ${submission.notes ? `<p><strong>Your notes:</strong> ${htmlEscape(submission.notes)}</p>` : ''}
      <p style="margin-top:24px;">If you need to correct anything before approval, reply to this email and include your organization name.</p>
    </div>`;
}

function buildApplicantConfirmationEmailText({ submission }) {
  const lines = [
    `Your CommunityBridge organization intake was received for ${submission.organization.directoryName || submission.organization.name}.`,
    '',
    'CommunityBridge operations has received your intake and will review it before activation.',
    'When approved, your organization, programs, and campuses will be added directly into the app for enrollment.',
    '',
    buildIntakeSummaryText(submission),
    '',
    'If you need to correct anything before approval, reply to this email and include your organization name.',
  ];
  return lines.join('\n');
}

function getOrganizationIntakeMailer() {
  const smtpUrl = safeString(process.env.CB_SMTP_URL || process.env.BB_SMTP_URL).trim();
  if (!smtpUrl) {
    const err = new Error('Organization intake email is not configured (missing CB_SMTP_URL/BB_SMTP_URL).');
    err.code = 'BB_ORG_INTAKE_EMAIL_NOT_CONFIGURED';
    throw err;
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (_) {
    const err = new Error('Organization intake dependency missing (nodemailer).');
    err.code = 'BB_ORG_INTAKE_EMAIL_DEP_MISSING';
    throw err;
  }

  const from = safeString(process.env.CB_EMAIL_FROM || process.env.BB_EMAIL_FROM || process.env.CB_SMTP_FROM || process.env.BB_SMTP_FROM || 'info@communitybridge.app').trim();
  return {
    from,
    transporter: nodemailer.createTransport(smtpUrl),
  };
}

async function sendOrganizationIntakeEmail({ to, submission, approveUrl, rejectUrl }) {
  const { from, transporter } = getOrganizationIntakeMailer();
  const subject = `Organization intake: ${submission.organization.directoryName || submission.organization.name}`;
  const text = [
    buildIntakeSummaryText(submission),
    '',
    'Approve submission:',
    approveUrl,
    '',
    'Reject submission:',
    rejectUrl,
  ].join('\n');

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html: buildIntakeEmailHtml({ submission, approveUrl, rejectUrl }),
  });
}

function getApplicantNotificationRecipients(submission) {
  return uniqueBy([
    normalizeEmail(submission?.contact?.email),
    normalizeEmail(submission?.organization?.email),
  ].filter(Boolean), (value) => value);
}

async function sendOrganizationIntakeConfirmationEmail({ to, submission }) {
  if (!to) return;
  const { from, transporter } = getOrganizationIntakeMailer();
  const subject = `We received your CommunityBridge intake for ${submission.organization.directoryName || submission.organization.name}`;

  await transporter.sendMail({
    from,
    to,
    subject,
    text: buildApplicantConfirmationEmailText({ submission }),
    html: buildApplicantConfirmationEmailHtml({ submission }),
  });
}

function applyCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

async function activateApprovedSubmission(submissionRef, submissionData) {
  const data = submissionData && typeof submissionData === 'object' ? submissionData : {};
  const organization = data.organization && typeof data.organization === 'object' ? data.organization : {};
  const programs = Array.isArray(data.programs) ? data.programs : [];
  const locations = Array.isArray(data.locations) ? data.locations : [];
  const now = admin.firestore.FieldValue.serverTimestamp();
  const orgRef = admin.firestore().collection('organizations').doc(organization.id);
  const batch = admin.firestore().batch();

  batch.set(orgRef, {
    id: organization.id,
    name: organization.name,
    directoryName: organization.directoryName || organization.name,
    slug: organization.slug || organization.id,
    shortCode: organization.shortCode || '',
    phone: organization.phone || '',
    email: organization.email || '',
    address1: organization.address1 || '',
    address2: organization.address2 || '',
    city: organization.city || '',
    state: organization.state || '',
    zipCode: organization.zipCode || '',
    website: organization.website || '',
    active: true,
    sourceSubmissionId: submissionRef.id,
    updatedAt: now,
    approvedAt: now,
  }, { merge: true });

  const campusCountByProgram = {};
  locations.forEach((location) => {
    const key = safeString(location.programId).trim();
    if (!key) return;
    campusCountByProgram[key] = (campusCountByProgram[key] || 0) + 1;
  });

  programs.forEach((program) => {
    const programRef = orgRef.collection('programs').doc(program.id);
    batch.set(programRef, {
      id: program.id,
      organizationId: organization.id,
      name: program.name,
      slug: program.slug || program.id,
      type: program.type || 'centerBasedAba',
      description: program.description || '',
      active: true,
      sourceSubmissionId: submissionRef.id,
      updatedAt: now,
      approvedAt: now,
    }, { merge: true });

    const branchRef = orgRef.collection('branches').doc(program.id);
    batch.set(branchRef, {
      id: program.id,
      organizationId: organization.id,
      name: program.name,
      slug: program.slug || program.id,
      campusCount: Number(campusCountByProgram[program.id] || 0),
      active: true,
      sourceSubmissionId: submissionRef.id,
      updatedAt: now,
      approvedAt: now,
    }, { merge: true });
  });

  locations.forEach((location) => {
    const campusRef = orgRef.collection('campuses').doc(location.id);
    batch.set(campusRef, {
      id: location.id,
      organizationId: organization.id,
      programId: location.programId,
      name: location.name,
      slug: location.slug || location.id,
      phone: location.phone || '',
      email: location.email || '',
      address1: location.address1 || '',
      address2: location.address2 || '',
      city: location.city || '',
      state: location.state || '',
      zipCode: location.zipCode || '',
      enrollmentCode: location.enrollmentCode || '',
      enrollmentCodes: Array.isArray(location.enrollmentCodes) ? location.enrollmentCodes : normalizedEnrollmentCodes(location),
      campusType: location.campusType || 'Center',
      active: true,
      sourceSubmissionId: submissionRef.id,
      updatedAt: now,
      approvedAt: now,
    }, { merge: true });
  });

  batch.set(submissionRef, {
    status: 'approved',
    approvedAt: now,
    updatedAt: now,
    activatedOrganizationId: organization.id,
  }, { merge: true });

  await batch.commit();
}

exports.submitOrganizationIntake = regional.https.onRequest(async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });

  try {
    const submission = normalizeIntakeSubmission(req.body || {});
    const errors = validateIntakeSubmission(submission);
    if (errors.length) return res.status(400).json({ ok: false, errors });
    const forwardedFor = safeString(req.headers['x-forwarded-for']).split(',')[0].trim();
    const recaptcha = await verifyRecaptchaToken({ token: req.body?.recaptchaToken, remoteIp: forwardedFor || null });
    if (!recaptcha.ok) {
      return res.status(400).json({ ok: false, error: 'reCAPTCHA verification failed. Please try again.' });
    }

    const submissionRef = admin.firestore().collection('organizationIntakeSubmissions').doc();
    const { token, tokenHash } = buildSubmissionToken(submissionRef.id);
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + (7 * 24 * 60 * 60 * 1000));
    const baseUrl = getPublicBaseUrl(req);
    const approveUrl = `${baseUrl}/organizations-intake-action?submission=${encodeURIComponent(submissionRef.id)}&token=${encodeURIComponent(token)}&action=approve`;
    const rejectUrl = `${baseUrl}/organizations-intake-action?submission=${encodeURIComponent(submissionRef.id)}&token=${encodeURIComponent(token)}&action=reject`;

    await submissionRef.set({
      status: 'pending',
      organization: submission.organization,
      contact: submission.contact,
      programs: submission.programs,
      locations: submission.locations,
      notes: submission.notes,
      reviewTokenHash: tokenHash,
      reviewTokenExpiresAt: expiresAt,
      submittedAt: now,
      updatedAt: now,
      submittedFromIp: forwardedFor || null,
      applicantEmail: submission.contact.email,
      recaptchaVerifiedAt: now,
    });

    await sendOrganizationIntakeEmail({
      to: getOrgSignupInbox(),
      submission,
      approveUrl,
      rejectUrl,
    });

    const applicantRecipients = getApplicantNotificationRecipients(submission);
    let confirmationEmailStatus = 'skipped';
    let confirmationEmailError = '';
    try {
      await sendOrganizationIntakeConfirmationEmail({
        to: applicantRecipients,
        submission,
      });
      confirmationEmailStatus = applicantRecipients.length ? 'sent' : 'skipped';
    } catch (confirmationError) {
      confirmationEmailStatus = 'failed';
      confirmationEmailError = safeString(confirmationError?.code || confirmationError?.message || 'unknown_error').slice(0, 200);
      console.error('submitOrganizationIntake confirmation email failed', confirmationError);
    }

    try {
      await submissionRef.set({
        applicantConfirmationEmail: {
          status: confirmationEmailStatus,
          email: applicantRecipients.join(', '),
          emails: applicantRecipients,
          sentAt: confirmationEmailStatus === 'sent' ? admin.firestore.FieldValue.serverTimestamp() : null,
          failedAt: confirmationEmailStatus === 'failed' ? admin.firestore.FieldValue.serverTimestamp() : null,
          error: confirmationEmailError,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (auditError) {
      console.error('submitOrganizationIntake confirmation audit update failed', auditError);
    }

    return res.status(200).json({
      ok: true,
      submissionId: submissionRef.id,
      confirmationEmailStatus,
    });
  } catch (error) {
    console.error('submitOrganizationIntake failed', error);
    return res.status(500).json({ ok: false, error: 'Unable to submit organization intake.' });
  }
});

exports.organizationIntakeConfig = regional.https.onRequest(async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed.' });

  return res.status(200).json({
    ok: true,
    recaptchaSiteKey: getRecaptchaSiteKey() || '',
    googlePlacesApiKey: getGooglePlacesApiKey() || '',
  });
});

exports.organizationIntakeAction = regional.https.onRequest(async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).send(renderIntakeResultPage({ title: 'Method not allowed', body: 'Use the link from the intake email to review this submission.', accent: '#dc2626' }));

  try {
    const submissionId = safeString(req.query.submission).trim();
    const token = safeString(req.query.token).trim();
    const action = safeString(req.query.action).trim().toLowerCase();
    if (!submissionId || !token || !['approve', 'reject'].includes(action)) {
      return res.status(400).send(renderIntakeResultPage({ title: 'Invalid review link', body: 'This intake review link is incomplete or invalid.', accent: '#dc2626' }));
    }

    const submissionRef = admin.firestore().collection('organizationIntakeSubmissions').doc(submissionId);
    const snap = await submissionRef.get();
    if (!snap.exists) {
      return res.status(404).send(renderIntakeResultPage({ title: 'Submission not found', body: 'This intake submission could not be found.', accent: '#dc2626' }));
    }

    const data = snap.data() || {};
    const expiresAtMs = data.reviewTokenExpiresAt && typeof data.reviewTokenExpiresAt.toMillis === 'function'
      ? data.reviewTokenExpiresAt.toMillis()
      : 0;
    if (!verifySubmissionToken(submissionId, token, data.reviewTokenHash)) {
      return res.status(403).send(renderIntakeResultPage({ title: 'Invalid review token', body: 'This approval link is not valid.', accent: '#dc2626' }));
    }
    if (expiresAtMs && Date.now() > expiresAtMs) {
      return res.status(410).send(renderIntakeResultPage({ title: 'Review link expired', body: 'This intake review link has expired. Submit the organization again or generate a new review link.', accent: '#dc2626' }));
    }
    if (data.status === 'approved') {
      return res.status(200).send(renderIntakeResultPage({ title: 'Already approved', body: 'This organization submission has already been approved and is active in CommunityBridge.', accent: '#16a34a' }));
    }
    if (data.status === 'rejected') {
      return res.status(200).send(renderIntakeResultPage({ title: 'Already rejected', body: 'This organization submission has already been rejected.', accent: '#f97316' }));
    }

    if (action === 'reject') {
      await submissionRef.set({
        status: 'rejected',
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      const applicantRecipients = getApplicantNotificationRecipients(data);
      try {
        await sendOrganizationDecisionEmail({
          to: applicantRecipients,
          submission: data,
          decision: 'rejected',
          publicBaseUrl: getPublicBaseUrl(req),
        });
        await submissionRef.set({
          applicantDecisionEmail: {
            status: applicantRecipients.length ? 'sent' : 'skipped',
            decision: 'rejected',
            email: applicantRecipients.join(', '),
            emails: applicantRecipients,
            sentAt: applicantRecipients.length ? admin.firestore.FieldValue.serverTimestamp() : null,
            error: '',
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (decisionEmailError) {
        console.error('organizationIntakeAction rejected decision email failed', decisionEmailError);
        await submissionRef.set({
          applicantDecisionEmail: {
            status: 'failed',
            decision: 'rejected',
            email: applicantRecipients.join(', '),
            emails: applicantRecipients,
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            error: safeString(decisionEmailError?.code || decisionEmailError?.message || 'unknown_error').slice(0, 200),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      return res.status(200).send(renderIntakeResultPage({ title: 'Submission rejected', body: 'The organization submission was rejected and no tenant data was activated.', accent: '#f97316' }));
    }

    await activateApprovedSubmission(submissionRef, data);

    const applicantRecipients = getApplicantNotificationRecipients(data);
    try {
      await sendOrganizationDecisionEmail({
        to: applicantRecipients,
        submission: data,
        decision: 'approved',
        publicBaseUrl: getPublicBaseUrl(req),
      });
      await submissionRef.set({
        applicantDecisionEmail: {
          status: applicantRecipients.length ? 'sent' : 'skipped',
          decision: 'approved',
          email: applicantRecipients.join(', '),
          emails: applicantRecipients,
          sentAt: applicantRecipients.length ? admin.firestore.FieldValue.serverTimestamp() : null,
          error: '',
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (decisionEmailError) {
      console.error('organizationIntakeAction approved decision email failed', decisionEmailError);
      await submissionRef.set({
        applicantDecisionEmail: {
          status: 'failed',
          decision: 'approved',
          email: applicantRecipients.join(', '),
          emails: applicantRecipients,
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          error: safeString(decisionEmailError?.code || decisionEmailError?.message || 'unknown_error').slice(0, 200),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return res.status(200).send(renderIntakeResultPage({ title: 'Organization approved', body: 'The organization, programs, and campuses are now active and available for user enrollment immediately.', accent: '#16a34a' }));
  } catch (error) {
    console.error('organizationIntakeAction failed', error);
    return res.status(500).send(renderIntakeResultPage({ title: 'Unable to complete review', body: 'The organization submission could not be processed. Please try again from the original email or contact support.', accent: '#dc2626' }));
  }
});

// Optional callable used by the mobile app. Safe no-op stub.
exports.linkPreview = regional.https.onCall(async (data, context) => {
  // Signed-in only (mirrors old authMiddleware behavior).
  if (!context.auth) return null;
  const rawUrl = data && data.url ? String(data.url).trim() : '';
  if (!rawUrl) return null;

  let u;
  try {
    u = new URL(rawUrl);
  } catch (_) {
    return null;
  }

  if (!['http:', 'https:'].includes(u.protocol)) return null;
  if (isPrivateHostname(u.hostname)) return null;

  try {
    const html = await fetchTextWithLimits(u.toString(), { timeoutMs: 5000, maxBytes: 1024 * 1024 });
    const ogTitle = extractMeta(html, 'og:title');
    const ogDesc = extractMeta(html, 'og:description');
    const ogImage = extractMeta(html, 'og:image');
    const title = ogTitle || extractTitle(html);
    const description = ogDesc || extractMeta(html, 'description');
    const image = ogImage;

    return {
      url: u.toString(),
      title: title || null,
      description: description || null,
      image: image || null,
    };
  } catch (_) {
    return null;
  }
});

// Send a one-time verification code (email by default; sms optional).
exports.mfaSendCode = regional.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }

  const uid = safeString(context.auth.uid).trim();
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }

  const method = normalizeMethod(data?.method);
  const email = getDisplayEmail(context.auth.token?.email);

  let destination = null;
  if (method === 'email') {
    destination = email;
    if (!destination) {
      throw new functions.https.HttpsError('failed-precondition', 'No email address on account.');
    }
  } else {
    const phoneOverride = normalizePhone(data?.phone);
    if (phoneOverride) destination = phoneOverride;
    if (!destination) {
      const userSnap = await admin.firestore().collection('users').doc(uid).get();
      const userData = userSnap.exists ? (userSnap.data() || {}) : {};
      destination = normalizePhone(userData.phone || userData.phoneNumber || userData.mobile || '');
    }
    if (!destination) {
      throw new functions.https.HttpsError('failed-precondition', 'No phone number on profile.');
    }
  }

  const ref = admin.firestore().collection('mfaChallenges').doc(uid);
  const now = admin.firestore.Timestamp.now();
  const cooldownMs = 60 * 1000;
  const ttlMs = 10 * 60 * 1000;

  const existing = await ref.get();
  if (existing.exists) {
    const prev = existing.data() || {};
    const prevSentAt = prev.sentAt && typeof prev.sentAt.toMillis === 'function' ? prev.sentAt.toMillis() : 0;
    if (prevSentAt && (nowMs() - prevSentAt) < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - (nowMs() - prevSentAt)) / 1000);
      throw new functions.https.HttpsError('resource-exhausted', `Please wait ${waitSec}s before resending.`);
    }
  }

  const code = randomDigits(6);
  const secret = getMfaSecret();
  const codeHash = sha256Hex(`${uid}:${code}:${secret}`);
  const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + ttlMs);

  await ref.set({
    uid,
    method,
    to: destination,
    codeHash,
    attempts: 0,
    maxAttempts: 5,
    sentAt: now,
    expiresAt,
    updatedAt: now,
  }, { merge: true });

  try {
    if (method === 'sms') {
      await sendSmsOtp({ to: destination, code });
    } else {
      await sendEmailOtp({ to: destination, code });
    }
  } catch (error) {
    try { await ref.delete(); } catch (_) {}
    const msg = method === 'sms'
      ? 'Unable to send text verification code right now.'
      : 'Unable to send email verification code right now.';
    throw new functions.https.HttpsError('internal', msg);
  }

  return { ok: true, challenge: sanitizeChallengeForClient({ method, to: destination, sentAt: now, expiresAt }) };
});

// Verify a submitted code; on success, mark the user as MFA-verified.
exports.mfaVerifyCode = regional.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }

  const uid = safeString(context.auth.uid).trim();
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }

  const code = safeString(data?.code).trim();
  if (!/^[0-9]{4,8}$/.test(code)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid code.');
  }

  const ref = admin.firestore().collection('mfaChallenges').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'No active verification challenge.');
  }

  const ch = snap.data() || {};
  const expiresAtMs = ch.expiresAt && typeof ch.expiresAt.toMillis === 'function' ? ch.expiresAt.toMillis() : 0;
  if (!expiresAtMs || nowMs() > expiresAtMs) {
    try { await ref.delete(); } catch (_) {}
    throw new functions.https.HttpsError('deadline-exceeded', 'Verification code expired.');
  }

  const attempts = Number.isFinite(Number(ch.attempts)) ? Number(ch.attempts) : 0;
  const maxAttempts = Number.isFinite(Number(ch.maxAttempts)) ? Number(ch.maxAttempts) : 5;
  if (attempts >= maxAttempts) {
    try { await ref.delete(); } catch (_) {}
    throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Request a new code.');
  }

  const secret = getMfaSecret();
  const expected = safeString(ch.codeHash).trim();
  const actual = sha256Hex(`${uid}:${code}:${secret}`);
  if (!expected || expected !== actual) {
    await ref.set(
      { attempts: attempts + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    throw new functions.https.HttpsError('permission-denied', 'Incorrect code.');
  }

  // Mark user verified (timestamp in profile). Keep claims optional for future use.
  const now = admin.firestore.FieldValue.serverTimestamp();
  await admin.firestore().collection('users').doc(uid).set(
    { mfaVerifiedAt: now },
    { merge: true }
  );

  try {
    const user = await admin.auth().getUser(uid).catch(() => null);
    const prev = (user && user.customClaims && typeof user.customClaims === 'object') ? user.customClaims : {};
    await admin.auth().setCustomUserClaims(uid, { ...prev, bb_mfa: true });
  } catch (_) {
    // Claims are best-effort; Firestore rules primarily rely on mfaVerifiedAt.
  }

  try { await ref.delete(); } catch (_) {}
  return { ok: true };
});

exports.listOrganizationsPublic = regional.https.onCall(async () => {
  const snap = await admin.firestore().collection('organizations').where('active', '==', true).get();
  const items = snap.docs
    .map((docSnap) => sanitizeLookupDoc(docSnap.id, docSnap.data(), {
      shortCode: safeString(docSnap.data()?.shortCode || docSnap.data()?.code).trim(),
    }))
    .filter((item) => item.id && item.name);
  return { items };
});

exports.listProgramsPublic = regional.https.onCall(async (data) => {
  const organizationId = safeString(data?.organizationId).trim();
  if (!organizationId) {
    throw new functions.https.HttpsError('invalid-argument', 'organizationId is required.');
  }
  const snap = await admin.firestore().collection('organizations').doc(organizationId).collection('programs').where('active', '==', true).get();
  const items = snap.docs
    .map((docSnap) => sanitizeLookupDoc(docSnap.id, docSnap.data(), {
      organizationId,
      type: safeString(docSnap.data()?.type).trim(),
    }))
    .filter((item) => item.id && item.name);
  return { items };
});

exports.listBranchesPublic = regional.https.onCall(async (data) => {
  const organizationId = safeString(data?.organizationId).trim();
  if (!organizationId) {
    throw new functions.https.HttpsError('invalid-argument', 'organizationId is required.');
  }
  const snap = await admin.firestore().collection('organizations').doc(organizationId).collection('branches').where('active', '==', true).get();
  const items = snap.docs
    .map((docSnap) => sanitizeLookupDoc(docSnap.id, docSnap.data(), {
      organizationId,
      campusCount: Number(docSnap.data()?.campusCount || 0),
    }))
    .filter((item) => item.id && item.name);
  return { items };
});

exports.listCampusesPublic = regional.https.onCall(async (data) => {
  const organizationId = safeString(data?.organizationId).trim();
  const programId = safeString(data?.programId || data?.branchId).trim();
  if (!organizationId) {
    throw new functions.https.HttpsError('invalid-argument', 'organizationId is required.');
  }
  let queryRef = admin.firestore().collection('organizations').doc(organizationId).collection('campuses').where('active', '==', true);
  if (programId) queryRef = queryRef.where('programId', '==', programId);
  const snap = await queryRef.get();
  const items = snap.docs
    .map((docSnap) => sanitizeLookupDoc(docSnap.id, docSnap.data(), {
      organizationId,
      programId: safeString(docSnap.data()?.programId || docSnap.data()?.branchId).trim(),
    }))
    .filter((item) => item.id && item.name);
  return { items };
});

exports.resolveEnrollmentContextPublic = regional.https.onCall(async (data) => {
  const organizationId = safeString(data?.organizationId).trim();
  const programId = safeString(data?.programId || data?.branchId).trim();
  const campusId = safeString(data?.campusId).trim();
  const enrollmentCode = safeString(data?.enrollmentCode).trim().toUpperCase();

  if (!enrollmentCode) {
    throw new functions.https.HttpsError('invalid-argument', 'enrollmentCode is required.');
  }
  if (!organizationId || !programId) {
    return resolveEnrollmentContextFromCode({
      firestore: admin.firestore(),
      enrollmentCode,
    });
  }

  const orgRef = admin.firestore().collection('organizations').doc(organizationId);
  const programRef = orgRef.collection('programs').doc(programId);
  const [orgSnap, programSnap] = await Promise.all([orgRef.get(), programRef.get()]);
  if (!orgSnap.exists || orgSnap.data()?.active === false) {
    throw new functions.https.HttpsError('not-found', 'Organization not found.');
  }
  if (!programSnap.exists || programSnap.data()?.active === false) {
    throw new functions.https.HttpsError('not-found', 'Program not found.');
  }

  let campusQuery = orgRef.collection('campuses').where('active', '==', true).where('programId', '==', programId);
  if (campusId) {
    const scopedSnap = await orgRef.collection('campuses').doc(campusId).get();
    const scopedData = scopedSnap.exists ? (scopedSnap.data() || {}) : null;
    if (!scopedSnap.exists || scopedData.active === false || safeString(scopedData.programId || scopedData.branchId).trim() !== programId) {
      throw new functions.https.HttpsError('not-found', 'Campus not found for this program.');
    }
    const codes = normalizedEnrollmentCodes(scopedData);
    if (!codes.includes(enrollmentCode)) {
      throw new functions.https.HttpsError('permission-denied', 'Enrollment code did not match the selected campus.');
    }
    return {
      organization: sanitizeLookupDoc(orgSnap.id, orgSnap.data(), {
        shortCode: safeString(orgSnap.data()?.shortCode || orgSnap.data()?.code).trim(),
      }),
      program: sanitizeLookupDoc(programSnap.id, programSnap.data(), { organizationId, type: safeString(programSnap.data()?.type).trim() }),
      campus: sanitizeLookupDoc(scopedSnap.id, scopedData, { organizationId, programId }),
    };
  }

  const campusSnap = await campusQuery.get();
  const matchedCampus = campusSnap.docs.find((docSnap) => normalizedEnrollmentCodes(docSnap.data()).includes(enrollmentCode));
  if (!matchedCampus) {
    throw new functions.https.HttpsError('permission-denied', 'Enrollment code did not match an active campus.');
  }

  return {
    organization: sanitizeLookupDoc(orgSnap.id, orgSnap.data(), {
      shortCode: safeString(orgSnap.data()?.shortCode || orgSnap.data()?.code).trim(),
    }),
    program: sanitizeLookupDoc(programSnap.id, programSnap.data(), { organizationId, type: safeString(programSnap.data()?.type).trim() }),
    campus: sanitizeLookupDoc(matchedCampus.id, matchedCampus.data(), { organizationId, programId }),
  };
});

exports.onArrivalPingCreate = regional.firestore
  .document('arrivalPings/{pingId}')
  .onCreate(async (snap) => {
    const payload = snap.data() || {};
    const role = safeString(payload.role).trim().toLowerCase();
    if (role !== 'parent' && role !== 'therapist') return null;

    const actorId = safeString(payload.userId).trim();
    if (!actorId) return null;

    const childId = payload.childId != null ? safeString(payload.childId).trim() : '';
    const shiftId = payload.shiftId != null ? safeString(payload.shiftId).trim() : '';

    const bucketMs = 10 * 60 * 1000;
    const bucket = Math.floor(Date.now() / bucketMs);
    const dedupeId = `arrival_${actorId}_${childId || 'none'}_${shiftId || 'none'}_${bucket}`.slice(0, 1500);
    const dedupeRef = admin.firestore().collection('arrivalAlertDedupe').doc(dedupeId);

    const now = admin.firestore.FieldValue.serverTimestamp();
    const title = role === 'therapist' ? 'Therapist Arrival' : 'Parent Arrival';

    // Dedupe using a transaction: only one memo per actor/child/shift per 10-minute bucket.
    let createdMemoId = null;
    await admin.firestore().runTransaction(async (tx) => {
      const existing = await tx.get(dedupeRef);
      if (existing.exists) return;

      tx.create(dedupeRef, {
        actorId,
        role,
        childId: childId || null,
        shiftId: shiftId || null,
        pingId: snap.id,
        createdAt: now,
      });

      const memoRef = admin.firestore().collection('urgentMemos').doc();
      createdMemoId = memoRef.id;

      const meta = {
        lat: Number.isFinite(Number(payload.lat)) ? Number(payload.lat) : null,
        lng: Number.isFinite(Number(payload.lng)) ? Number(payload.lng) : null,
        distanceMiles: payload.distanceMiles != null ? Number(payload.distanceMiles) : null,
        dropZoneMiles: payload.dropZoneMiles != null ? Number(payload.dropZoneMiles) : null,
        eventId: payload.eventId != null ? safeString(payload.eventId) : null,
        shiftId: shiftId || null,
        when: payload.when != null ? safeString(payload.when) : null,
      };

      tx.set(memoRef, {
        type: 'arrival_alert',
        status: 'pending',
        proposerUid: actorId,
        actorRole: role,
        childId: childId || null,
        title,
        body: '',
        note: '',
        meta,
        createdAt: now,
        updatedAt: now,
      });
    });

    if (!createdMemoId) return null;

    // Push notify admins (best-effort).
    try {
      const usersSnap = await admin
        .firestore()
        .collection('users')
        .where('role', 'in', ['admin', 'administrator'])
        .get();

      const adminUids = usersSnap.docs.map((d) => d.id).filter(Boolean);
      if (!adminUids.length) return null;

      const tokens = [];
      for (const uid of adminUids) {
        const tSnap = await admin
          .firestore()
          .collection('pushTokens')
          .where('enabled', '==', true)
          .where('userUid', '==', uid)
          .limit(50)
          .get();

        tSnap.docs.forEach((d) => {
          const rec = d.data() || {};
          const token = safeString(rec.token || d.id).trim();
          if (!token) return;
          if (!pushPrefAllows(rec.preferences || {}, 'updates')) return;
          tokens.push(token);
        });
      }

      await sendExpoPush(tokens, {
        title,
        body: 'Arrival detected. Open Alerts.',
        data: { kind: 'arrival_alert', memoId: createdMemoId, actorId, actorRole: role, childId: childId || null },
        kind: 'updates',
      });
    } catch (_) {
      // ignore push failures
    }

    return null;
  });

exports.onMessageCreate = regional.firestore
  .document('messages/{messageId}')
  .onCreate(async (snap) => {
    const message = snap.data() || {};
    const senderId = safeString(message?.sender?.id).trim();
    const recipients = Array.isArray(message?.participantUids) ? message.participantUids.map((item) => safeString(item).trim()).filter(Boolean) : [];
    const recipientUids = recipients.filter((uid) => uid && uid !== senderId);
    if (!recipientUids.length) return null;

    try {
      const tokens = [];
      for (const uid of recipientUids) {
        const tSnap = await admin.firestore().collection('pushTokens').where('enabled', '==', true).where('userUid', '==', uid).limit(50).get();
        tSnap.docs.forEach((d) => {
          const rec = d.data() || {};
          const token = safeString(rec.token || d.id).trim();
          if (!token) return;
          if (!pushPrefAllows(rec.preferences || {}, 'chats')) return;
          tokens.push(token);
        });
      }

      if (!tokens.length) return null;

      await sendExpoPush(tokens, {
        title: 'New message',
        body: 'Open Chats to view it.',
        data: { kind: 'chat_message', messageId: snap.id, threadId: safeString(message?.threadId).trim() || snap.id },
        kind: 'chats',
      });
    } catch (_) {
      // ignore push failures
    }

    return null;
  });

exports.onUrgentMemoCreate = regional.firestore
  .document('urgentMemos/{memoId}')
  .onCreate(async (snap) => {
    const memo = snap.data() || {};
    const type = safeString(memo?.type).trim().toLowerCase();

    try {
      let targetUids = [];
      if (type === 'arrival_alert' || type === 'time_update') {
        const usersSnap = await admin.firestore().collection('users').where('role', 'in', ['admin', 'administrator']).get();
        targetUids = usersSnap.docs.map((d) => d.id).filter(Boolean);
      } else {
        const recipients = Array.isArray(memo?.recipients) ? memo.recipients : [];
        targetUids = recipients.map((item) => safeString(item?.id || item).trim()).filter(Boolean);
      }

      targetUids = Array.from(new Set(targetUids));
      if (!targetUids.length) return null;

      const tokens = [];
      for (const uid of targetUids) {
        const tSnap = await admin.firestore().collection('pushTokens').where('enabled', '==', true).where('userUid', '==', uid).limit(50).get();
        tSnap.docs.forEach((d) => {
          const rec = d.data() || {};
          const token = safeString(rec.token || d.id).trim();
          if (!token) return;
          if (!pushPrefAllows(rec.preferences || {}, 'updates')) return;
          tokens.push(token);
        });
      }

      if (!tokens.length) return null;

      await sendExpoPush(tokens, {
        title: type === 'admin_memo' ? 'New memo' : 'New alert',
        body: 'Open the app for details.',
        data: { kind: type || 'urgent_memo', memoId: snap.id, childId: memo?.childId || null },
        kind: 'updates',
      });
    } catch (_) {
      // ignore push failures
    }

    return null;
  });

exports.onTimeChangeProposalCreate = regional.firestore
  .document('timeChangeProposals/{proposalId}')
  .onCreate(async (snap) => {
    const proposal = snap.data() || {};

    try {
      const usersSnap = await admin.firestore().collection('users').where('role', 'in', ['admin', 'administrator']).get();
      const targetUids = usersSnap.docs.map((d) => d.id).filter(Boolean);
      if (!targetUids.length) return null;

      const tokens = [];
      for (const uid of targetUids) {
        const tSnap = await admin.firestore().collection('pushTokens').where('enabled', '==', true).where('userUid', '==', uid).limit(50).get();
        tSnap.docs.forEach((d) => {
          const rec = d.data() || {};
          const token = safeString(rec.token || d.id).trim();
          if (!token) return;
          if (!pushPrefAllows(rec.preferences || {}, 'updates')) return;
          tokens.push(token);
        });
      }

      if (!tokens.length) return null;

      const notification = buildScheduleChangePushNotification(proposal);
      await sendExpoPush(tokens, {
        title: notification.title,
        body: notification.body,
        data: {
          kind: notification.dataKind,
          proposalId: snap.id,
          childId: proposal?.childId || null,
          type: safeString(proposal?.type).trim().toLowerCase() || null,
        },
        kind: 'updates',
      });
    } catch (_) {
      // ignore push failures
    }

    return null;
  });
