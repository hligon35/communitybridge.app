const STORAGE_SCOPE_FALLBACK = '__anon__';

const STORAGE_KEY_BASES = {
  posts: 'bbs_posts_v1',
  messages: 'bbs_messages_v1',
  memos: 'bbs_memos_v1',
  archivedThreads: 'bbs_archived_threads_v1',
  threadReads: 'bbs_thread_reads_v1',
  children: 'bbs_children_v1',
  blocked: 'bbs_blocked_v1',
  chatBlocked: 'bbs_chat_blocked_v1',
  parents: 'bbs_parents_v1',
  therapists: 'bbs_therapists_v1',
  seedStatus: 'bbs_seed_status_v1',
};

function normalizeStorageScopePart(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
  return normalized || STORAGE_SCOPE_FALLBACK;
}

function getStorageScopeId(user) {
  const candidate = user?.id || user?.uid || user?.email || STORAGE_SCOPE_FALLBACK;
  return normalizeStorageScopePart(candidate);
}

function buildScopedStorageKey(baseKey, scopeId) {
  return `${baseKey}::${normalizeStorageScopePart(scopeId)}`;
}

function buildScopedStorageKeys(user) {
  const scopeId = getStorageScopeId(user);
  return Object.entries(STORAGE_KEY_BASES).reduce((acc, [name, baseKey]) => {
    acc[name] = buildScopedStorageKey(baseKey, scopeId);
    return acc;
  }, {});
}

module.exports = {
  STORAGE_SCOPE_FALLBACK,
  STORAGE_KEY_BASES,
  getStorageScopeId,
  buildScopedStorageKey,
  buildScopedStorageKeys,
};