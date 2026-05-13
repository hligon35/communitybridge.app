#!/usr/bin/env node
/*
  Seed a small set of auth users via the public API.

  Default target:
    SERVER_URL=https://communitybridge.app

  Usage:
    node scripts/seed-prod-auth-users.js

  Notes:
  - Does NOT print passwords.
  - Handles "already exists" gracefully.
  - If signup requires 2FA and delivery is broken, it prints actionable next steps.
*/

const { URL } = require('url');
const https = require('https');
const http = require('http');

const DEFAULT_SERVER_URL = 'https://communitybridge.app';

const USERS = [
  // NOTE: Fill in the passwords before running this script.
  { name: 'Harold Ligon', email: 'hligon35@gmail.com', password: 'Zing@r088', role: 'parent', twoFaMethod: 'email' },
  { name: 'App Reviewer', email: 'appreview@communitybridge.app', password: 'Approved123!', role: 'parent', twoFaMethod: 'email' },
];

function postJson(fullUrl, json) {
  return new Promise((resolve, reject) => {
    const url = new URL(fullUrl);
    const body = JSON.stringify(json);
    const opts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(opts, (res) => {
      let resp = '';
      res.on('data', (c) => (resp += c.toString()));
      res.on('end', () => {
        let data = resp;
        try {
          data = JSON.parse(resp || '{}');
        } catch (_) {
          // leave as string
        }
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data });
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function redactAuthPayload(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  if (out.token) out.token = '[redacted token]';
  return out;
}

async function seedOne(serverUrl, user) {
  const signupUrl = `${serverUrl.replace(/\/+$/, '')}/api/auth/signup`;
  const loginUrl = `${serverUrl.replace(/\/+$/, '')}/api/auth/login`;

  console.log(`\n== signup ${user.email} (${user.role}) ==`);
  const signupRes = await postJson(signupUrl, user);

  // Happy path: token issued (no 2FA)
  if (signupRes.ok && signupRes.data && signupRes.data.token) {
    console.log({ status: signupRes.status, ok: true, data: redactAuthPayload(signupRes.data) });
    return { created: true, authed: true };
  }

  // 2FA-required path
  if (signupRes.ok && signupRes.data && signupRes.data.challengeId) {
    console.log({ status: signupRes.status, ok: true, data: redactAuthPayload(signupRes.data) });
    console.log('2FA is required for signup. Check your email/SMS for the code and complete verification in-app.');
    return { created: true, authed: false, requires2fa: true };
  }

  // Already exists -> try login to confirm password works
  if (signupRes.status === 409) {
    console.log({ status: signupRes.status, ok: false, data: redactAuthPayload(signupRes.data) });
    console.log('User already exists; attempting login to confirm credentials...');
    const loginRes = await postJson(loginUrl, { email: user.email, password: user.password });
    console.log({ status: loginRes.status, ok: loginRes.ok, data: redactAuthPayload(loginRes.data) });
    return { created: false, authed: !!(loginRes.ok && loginRes.data && loginRes.data.token) };
  }

  // Common production failure right now
  const msg = (signupRes.data && signupRes.data.error) ? String(signupRes.data.error) : '';
  console.log({ status: signupRes.status, ok: false, data: redactAuthPayload(signupRes.data) });

  if (signupRes.status === 500 && msg.toLowerCase().includes('2fa delivery failed')) {
    console.log('\nSignup is failing because production is configured to REQUIRE 2FA on signup, but delivery is failing.');
    console.log('Fix options (pick one):');
    console.log('- Configure SMTP correctly (BB_SMTP_URL + BB_EMAIL_FROM) so nodemailer can send');
    console.log('- Temporarily set BB_DEBUG_2FA_RETURN_CODE=1 (returns a code without sending)');
    console.log('- Temporarily set BB_REQUIRE_2FA_ON_SIGNUP=0 (skip 2FA on signup)');
    console.log('Tip: set BB_DEBUG_2FA_DELIVERY_ERRORS=1 to include a "debug" message in the 500 response for faster diagnosis.');
  }

  return { created: false, authed: false, error: signupRes.data };
}

async function main() {
  const serverUrl = process.env.SERVER_URL || DEFAULT_SERVER_URL;
  console.log(`Target server: ${serverUrl}`);

  for (const user of USERS) {
    // Never print passwords
    const safeUser = { ...user };
    await seedOne(serverUrl, safeUser);
  }

  console.log('\nDone.');
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Seeder failed:', e && e.message ? e.message : e);
    process.exit(1);
  });
}
