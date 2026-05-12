import React, { useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenWrapper, CenteredContainer } from '../components/ScreenWrapper';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { logPress } from '../utils/logger';
import { buildVisibleThreads } from '../utils/chatThreads';
import { USER_ROLES, isAdminRole, isBcbaRole, normalizeUserRole } from '../core/tenant/models';
import { THERAPY_ROLE_LABELS, getDisplayRoleLabel } from '../utils/roleTerminology';
import { childHasParent, findLinkedParentId } from '../utils/directoryLinking';

function normalizeName(s) {
  return (s || '').toString().trim();
}

function fullNameFromParent(p) {
  const n = normalizeName(p?.name);
  if (n) return n;
  return normalizeName(`${p?.firstName || ''} ${p?.lastName || ''}`);
}

function sameName(a, b) {
  if (!a || !b) return false;
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
}

function normalizeEmail(email) {
  const e = (email || '').toString().trim().toLowerCase();
  return e.includes('@') ? e : '';
}

function sameEmail(a, b) {
  const ea = normalizeEmail(a);
  const eb = normalizeEmail(b);
  return !!(ea && eb && ea === eb);
}

function RoleSection({ title, items, selectedId, onPick }) {
  if (!items || items.length === 0) return null;

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: '#6b7280', marginBottom: 8 }}>{title}</Text>
      <View style={{ borderWidth: 1, borderColor: '#eef2f7', borderRadius: 12, overflow: 'hidden' }}>
        {items.map((u, idx) => {
          const selected = selectedId === u.id;
          const top = idx === 0;
          return (
            <TouchableOpacity
              key={u.id}
              onPress={() => onPick(u)}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 12,
                flexDirection: 'row',
                alignItems: 'center',
                borderTopWidth: top ? 0 : 1,
                borderTopColor: '#eef2f7',
                backgroundColor: selected ? '#eff6ff' : '#fff',
              }}
              accessibilityLabel={`Select ${u.name}`}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Text style={{ fontWeight: '800', color: '#111827' }}>{(u.name || '?').slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', color: '#111827' }}>{u.name}</Text>
                {u.subtitle ? <Text style={{ color: '#6b7280', marginTop: 2 }}>{u.subtitle}</Text> : null}
              </View>
              <MaterialIcons name={selected ? 'radio-button-checked' : 'radio-button-unchecked'} size={22} color={selected ? '#2563eb' : '#9ca3af'} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function NewThreadScreen({ navigation }) {
  const { user } = useAuth();
  const { parents = [], therapists = [], children = [], messages = [] } = useData();
  const [selected, setSelected] = useState(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          style={{ marginLeft: 12, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eff6ff' }}
        >
          <MaterialIcons name="arrow-back" size={20} color="#1d4ed8" />
        </TouchableOpacity>
      ),
      headerRight: () => null,
    });
  }, [navigation]);

  const role = normalizeUserRole(user?.role);
  const isAdmin = isAdminRole(role);
  const isTherapist = role === USER_ROLES.THERAPIST;
  const isParent = role === USER_ROLES.PARENT;

  const { admins, connectedTherapists, connectedParents, note } = useMemo(() => {
    const normalizedStaff = (therapists || [])
      .map((t) => {
        const normalizedRole = normalizeUserRole(t.role);
        return {
          id: t.id,
          name: normalizeName(t.name),
          subtitle: getDisplayRoleLabel(normalizedRole) || THERAPY_ROLE_LABELS.therapist,
          role: normalizedRole,
        };
      })
      .filter((t) => t.id && t.name);

    const adminContacts = normalizedStaff
      .filter((t) => isAdminRole(t.role) || t.role === USER_ROLES.OFFICE);

    const normalizedTherapists = normalizedStaff
      .filter((t) => t.role === USER_ROLES.THERAPIST || t.role === USER_ROLES.BCBA);

    const normalizedParents = (parents || [])
      .map((p) => ({ id: p.id, name: fullNameFromParent(p), subtitle: 'Parent', familyId: p.familyId }))
      .filter((p) => p.id && p.name);

    // ADMIN can message everyone.
    if (isAdmin) {
      return {
        admins: adminContacts.filter((a) => a.id !== user?.id),
        connectedTherapists: normalizedTherapists,
        connectedParents: normalizedParents,
        note: null,
      };
    }

    // Parent connections: family parents + child therapists.
    if (isParent) {
      const rawParents = Array.isArray(parents) ? parents : [];
      const myParentId = findLinkedParentId(user, rawParents);

      const me = myParentId
        ? (normalizedParents.find((p) => p.id === myParentId) || null)
        : null;
      if (!me) {
        return {
          admins: adminContacts,
          connectedTherapists: [],
          connectedParents: [],
          note: 'Your account is not linked to a parent record yet; only office admin messaging is available.',
        };
      }

      const myChildren = (children || []).filter((c) => childHasParent(c, me.id));
      const therapistIds = new Set();
      myChildren.forEach((c) => {
        if (c?.bcaTherapist?.id) therapistIds.add(c.bcaTherapist.id);
      });

      const myTherapists = normalizedTherapists.filter((t) => therapistIds.has(t.id) && isBcbaRole(t.role));

      return {
        admins: adminContacts,
        connectedTherapists: myTherapists,
        connectedParents: [],
        note: null,
      };
    }

    // Therapist connections: parents of assigned children + therapist supervisor/team.
    if (isTherapist) {
      const rawTherapists = Array.isArray(therapists) ? therapists : [];
      const myTherapistId = rawTherapists.find((t) => t && (t.id === user?.id))?.id
        || rawTherapists.find((t) => t && sameEmail(t.email, user?.email))?.id
        || rawTherapists.find((t) => t && sameName(t.name, user?.name))?.id
        || null;

      const me = myTherapistId
        ? (normalizedTherapists.find((t) => t.id === myTherapistId) || null)
        : null;
      if (!me) {
        return {
          admins: adminContacts,
          connectedTherapists: normalizedTherapists,
          connectedParents: normalizedParents,
          note: `Your account is not linked to an ${THERAPY_ROLE_LABELS.therapist} record yet; showing all contacts.`,
        };
      }

      const assignedChildren = (children || []).filter((c) => {
        const assigned = c.assignedABA || c.assigned_ABA || [];
        const direct = (assigned || []).includes(me.id);
        const attached = [c.amTherapist?.id, c.pmTherapist?.id, c.bcaTherapist?.id].filter(Boolean);
        const indirect = attached.includes(me.id);
        return direct || indirect;
      });

      const parentIds = new Set();
      assignedChildren.forEach((c) => (c.parents || []).forEach((p) => { if (p?.id) parentIds.add(p.id); }));
      const myParents = normalizedParents.filter((p) => parentIds.has(p.id));

      // Build therapist connections: if ABA -> include supervisor BCBA; if BCBA -> include ABAs supervised by them.
      const rawMe = (therapists || []).find((t) => t.id === me.id);
      const therapistIdSet = new Set();
      if (rawMe?.supervisedBy) therapistIdSet.add(rawMe.supervisedBy);
      (therapists || []).forEach((t) => {
        if (t?.supervisedBy && t.supervisedBy === rawMe?.id) therapistIdSet.add(t.id);
      });

      const myTeam = normalizedTherapists
        .filter((t) => therapistIdSet.has(t.id))
        .filter((t) => t.id !== me.id);

      return {
        admins: adminContacts,
        connectedTherapists: myTeam,
        connectedParents: myParents,
        note: null,
      };
    }

    // Fallback: show everyone
    return {
      admins: adminContacts,
      connectedTherapists: normalizedTherapists,
      connectedParents: normalizedParents,
      note: null,
    };
  }, [parents, therapists, children, isAdmin, isParent, isTherapist, user?.id, user?.name]);

  const pick = (u) => {
    logPress('NewThread:PickRecipient', { id: u.id, name: u.name });
    setSelected(u);
  };

  const start = () => {
    if (!selected) return;
    const existingThread = buildVisibleThreads(messages, {}, user, [])
      .find((thread) => String(thread?.participant?.id || '').trim() === String(selected.id || '').trim());

    if (existingThread?.activeThreadId) {
      logPress('NewThread:Resume', { threadId: existingThread.activeThreadId, to: selected.id });
      navigation.navigate('ChatThread', {
        threadId: existingThread.id,
        threadIds: existingThread.threadIds,
        activeThreadId: existingThread.activeThreadId,
        conversationTitle: existingThread.title || selected.name,
      });
      return;
    }

    const threadId = `t-${Date.now()}`;
    logPress('NewThread:Start', { threadId, to: selected.id });
    navigation.navigate('ChatThread', { threadId, isNew: true, to: [{ id: selected.id, name: selected.name }], conversationTitle: selected.name });
  };

  return (
    <ScreenWrapper bannerTitle="New Message">
      <ScrollView
        style={{ flex: 1, width: '100%' }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <CenteredContainer>
          {isAdmin ? (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              accessibilityLabel="Cancel new message"
              style={{ alignSelf: 'flex-start', marginBottom: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center' }}
            >
              <MaterialIcons name="arrow-back" size={18} color="#334155" />
              <Text style={{ marginLeft: 6, color: '#334155', fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#111827' }}>Choose who to message</Text>
          {note ? <Text style={{ marginTop: 8, color: '#6b7280' }}>{note}</Text> : null}

          <RoleSection title="Admin" items={admins} selectedId={selected?.id} onPick={pick} />
          <RoleSection title={isParent ? 'BCBA' : THERAPY_ROLE_LABELS.therapists} items={connectedTherapists} selectedId={selected?.id} onPick={pick} />
          {!isParent ? <RoleSection title="Parents" items={connectedParents} selectedId={selected?.id} onPick={pick} /> : null}

          <TouchableOpacity
            onPress={start}
            disabled={!selected}
            style={{
              marginTop: 18,
              paddingVertical: 12,
              borderRadius: 10,
              alignItems: 'center',
              backgroundColor: selected ? '#2563eb' : '#9ca3af',
            }}
            accessibilityLabel="Start new message"
          >
            <Text style={{ color: '#fff', fontWeight: '800' }}>{selected ? `Message ${selected.name}` : 'Select a recipient'}</Text>
          </TouchableOpacity>
        </CenteredContainer>
      </ScrollView>
    </ScreenWrapper>
  );
}
