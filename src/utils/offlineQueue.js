/**
 * Offline write queue for non-idempotent API mutations.
 *
 * Sensible defaults applied:
 *  - Storage: AsyncStorage under `bb_offline_queue_v1` (same surface DataContext
 *    already uses to cache PHI; no new persistence boundary is introduced).
 *  - TTL: queued items older than 24h are dropped on the next flush.
 *  - Conflict policy: server-wins. The replay simply re-issues the original
 *    mutation; if the server has already accepted an equivalent write (e.g.
 *    via deduping idempotency keys passed by the caller) the second call is
 *    expected to be a no-op or return the existing record.
 *  - Replay trigger: `flushOfflineQueue()` is exposed and called explicitly
 *    by the app shell when network/foreground state changes. We deliberately
 *    avoid timer-based replay so PHI mutations do not run in the background
 *    without a user-driven foreground state.
 *
 * Threading: a single in-flight flush promise prevents concurrent drains from
 * double-submitting the same item.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'bb_offline_queue_v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const dispatchers = new Map();
let inFlightFlush = null;
const listeners = new Set();

function notify(state) {
  for (const l of listeners) {
    try { l(state); } catch (_) { /* ignore listener errors */ }
  }
}

async function read() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function write(items) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items || []));
  } catch (_) {
    // storage failures are intentionally swallowed: an offline-queue write
    // failing should not surface as a user-facing error on top of the
    // primary network failure we are already retrying around.
  }
}

export function registerOfflineDispatcher(kind, handler) {
  if (typeof kind !== 'string' || !kind) return;
  if (typeof handler !== 'function') return;
  dispatchers.set(kind, handler);
}

export function subscribeToOfflineQueue(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function enqueueOfflineWrite(kind, args) {
  if (!kind) return null;
  const items = await read();
  const item = {
    id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    args: args == null ? null : args,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
  };
  items.push(item);
  await write(items);
  notify({ kind: 'enqueued', size: items.length });
  return item;
}

export async function getOfflineQueueSize() {
  const items = await read();
  return items.length;
}

export async function listOfflineQueueItems() {
  return read();
}

export async function clearOfflineQueue() {
  await write([]);
  notify({ kind: 'cleared', size: 0 });
}

export async function flushOfflineQueue() {
  if (inFlightFlush) return inFlightFlush;
  inFlightFlush = (async () => {
    const all = await read();
    const now = Date.now();
    const fresh = all.filter((item) => (now - Number(item?.createdAt || 0)) < MAX_AGE_MS);
    const dropped = all.length - fresh.length;
    const remaining = [];
    let processed = 0;
    for (const item of fresh) {
      const fn = dispatchers.get(item.kind);
      if (!fn) {
        // No dispatcher registered yet — keep for a later flush so callers
        // that register late do not lose pending work.
        remaining.push(item);
        continue;
      }
      try {
        await fn(item.args);
        processed += 1;
      } catch (e) {
        const attempts = Number(item.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          // Drop after MAX_ATTEMPTS to avoid unbounded growth.
          continue;
        }
        remaining.push({
          ...item,
          attempts,
          lastError: String(e?.message || e || 'unknown error'),
        });
      }
    }
    await write(remaining);
    const state = { kind: 'flushed', processed, pending: remaining.length, dropped };
    notify(state);
    return state;
  })().finally(() => { inFlightFlush = null; });
  return inFlightFlush;
}
