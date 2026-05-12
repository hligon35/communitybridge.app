const { getEffectiveChatIdentity } = require('./demoIdentity');

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function isAdminLikeRole(role) {
  const value = normalizeRole(role);
  return value === 'admin'
    || value === 'administrator'
    || value === 'superadmin'
    || value === 'super_admin'
    || value === 'orgadmin'
    || value === 'org_admin'
    || value === 'organizationadmin'
    || value === 'campusadmin'
    || value === 'campus_admin';
}

function getParticipantTokens(user) {
  return [user?.id, user?.uid, user?.name, user?.email]
    .map(normalizeToken)
    .filter(Boolean);
}

function getUserParticipantTokens(user) {
  const effectiveUser = getEffectiveChatIdentity(user);
  return Array.from(new Set([
    ...getParticipantTokens(user),
    ...getParticipantTokens(effectiveUser),
  ]));
}

function addParticipantTokens(set, participant) {
  [participant?.id, participant?.uid, participant?.name, participant?.email]
    .map(normalizeToken)
    .filter(Boolean)
    .forEach((value) => set.add(value));
}

function participantTokenMatches(token, participantToken) {
  const left = normalizeToken(token);
  const right = normalizeToken(participantToken);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function isParticipantMatch(participant, userTokens) {
  const participantTokens = new Set();
  addParticipantTokens(participantTokens, participant);
  return userTokens.some((token) => Array.from(participantTokens).some((participantToken) => participantTokenMatches(token, participantToken)));
}

function getConversationParticipant(message, user) {
  const userTokens = getUserParticipantTokens(user);
  if (!userTokens.length) return null;
  const targets = Array.isArray(message?.to) ? message.to.filter(Boolean) : [];
  const sender = message?.sender && typeof message.sender === 'object' ? message.sender : null;

  if (sender && !isParticipantMatch(sender, userTokens)) return sender;

  const firstTarget = targets.find((target) => !isParticipantMatch(target, userTokens));
  if (firstTarget) return firstTarget;

  return sender || targets[0] || null;
}

function getConversationKey(message, user) {
  const participant = getConversationParticipant(message, user);
  const participantId = normalizeToken(participant?.id || participant?.email || participant?.name);
  if (participantId) return `user:${participantId}`;
  return `thread:${normalizeToken(message?.threadId || message?.id || 'default')}`;
}

function getConversationTitle(participant, fallbackMessage) {
  return String(
    participant?.name
    || participant?.fullName
    || participant?.email
    || fallbackMessage?.sender?.name
    || 'Conversation'
  ).trim();
}

function isMessageFromUser(message, user) {
  const userTokens = getUserParticipantTokens(user);
  if (!userTokens.length) return false;
  const senderTokens = new Set();
  addParticipantTokens(senderTokens, message?.sender);
  return userTokens.some((token) => Array.from(senderTokens).some((senderToken) => participantTokenMatches(token, senderToken)));
}

function canViewThread(threadMessages, user) {
  if (isAdminLikeRole(user?.role)) return true;
  const messages = Array.isArray(threadMessages) ? threadMessages : [];
  if (!messages.length) return false;
  const userTokens = getUserParticipantTokens(user);
  if (!userTokens.length) return false;
  const participants = new Set();
  messages.forEach((message) => {
    addParticipantTokens(participants, message?.sender);
    if (Array.isArray(message?.to)) message.to.forEach((target) => addParticipantTokens(participants, target));
  });
  const participantTokens = Array.from(participants);
  return userTokens.some((token) => participantTokens.some((participantToken) => participantTokenMatches(token, participantToken)));
}

function buildVisibleThreads(messages, threadReads, user, archivedThreads) {
  const items = Array.isArray(messages) ? messages : [];
  const reads = threadReads && typeof threadReads === 'object' ? threadReads : {};
  const archived = new Set((archivedThreads || []).map((value) => String(value)));

  const threads = items.reduce((acc, msg) => {
    const key = getConversationKey(msg, user);
    const participant = getConversationParticipant(msg, user);
    const rawThreadId = String(msg?.threadId || msg?.id || '').trim();
    acc[key] = acc[key] || {
      id: key,
      last: msg,
      participant,
      threadIds: new Set(),
      messages: [],
    };
    if (participant && !acc[key].participant) acc[key].participant = participant;
    if (rawThreadId) acc[key].threadIds.add(rawThreadId);
    acc[key].messages.push(msg);
    if (new Date(msg?.createdAt) > new Date(acc[key].last?.createdAt)) acc[key].last = msg;
    return acc;
  }, {});

  const list = Object.values(threads).map((thread) => {
    const latestIncomingAt = thread.messages
      .filter((message) => !isMessageFromUser(message, user))
      .reduce((latest, message) => {
        const messageMs = Date.parse(String(message?.createdAt || ''));
        return Number.isFinite(messageMs) && messageMs > latest ? messageMs : latest;
      }, 0);
    const readAtMs = Date.parse(String(reads[String(thread.id)] || ''));
    return {
      id: thread.id,
      last: thread.last,
      title: getConversationTitle(thread.participant, thread.last),
      participant: thread.participant,
      threadIds: Array.from(thread.threadIds),
      activeThreadId: String(thread.last?.threadId || thread.last?.id || '').trim() || Array.from(thread.threadIds)[0] || '',
      isUnread: latestIncomingAt > 0 && (!Number.isFinite(readAtMs) || latestIncomingAt > readAtMs),
    };
  });

  const visibleList = isAdminLikeRole(user?.role)
    ? list
    : list.filter((thread) => canViewThread(threads[thread.id]?.messages || [], user));

  return visibleList
    .filter((thread) => !archived.has(String(thread.id)))
    .slice()
    .sort((a, b) => {
      if (!!a?.isUnread !== !!b?.isUnread) return a?.isUnread ? -1 : 1;
      const aTs = Date.parse(String(a?.last?.createdAt || ''));
      const bTs = Date.parse(String(b?.last?.createdAt || ''));
      if (!Number.isFinite(aTs) && !Number.isFinite(bTs)) return 0;
      if (!Number.isFinite(aTs)) return 1;
      if (!Number.isFinite(bTs)) return -1;
      return bTs - aTs;
    });
}

function countUnreadVisibleThreads(messages, threadReads, user, archivedThreads) {
  return buildVisibleThreads(messages, threadReads, user, archivedThreads).filter((thread) => thread.isUnread).length;
}

module.exports = {
  buildVisibleThreads,
  canViewThread,
  countUnreadVisibleThreads,
  getConversationParticipant,
  getUserParticipantTokens,
  getConversationKey,
  isMessageFromUser,
};