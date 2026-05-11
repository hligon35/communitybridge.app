import React, { useMemo } from 'react';
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useAuth } from '../AuthContext';
import { useData } from '../DataContext';
import { useTenant } from '../core/tenant/TenantContext';
import { USER_ROLES, isBcbaRole, isOfficeAdminRole, normalizeUserRole } from '../core/tenant/models';
import { avatarSourceFor } from '../utils/idVisibility';
import { maskEmailDisplay, maskPhoneDisplay } from '../utils/inputFormat';
import { THERAPY_ROLE_LABELS, getAssignmentRoleLabel, getDisplayRoleLabel } from '../utils/roleTerminology';
import { childHasParent, findLinkedParentId } from '../utils/directoryLinking';

function getRelevantChildren(parentId, children) {
  const all = Array.isArray(children) ? children : [];
  if (!parentId) return [];
  return all.filter((child) => childHasParent(child, parentId));
}

function addMember(map, entry, role, childLabel) {
  if (!entry || typeof entry === 'string') return;
  const id = entry.id || entry.email || entry.name;
  if (!id) return;
  const existing = map.get(id);
  const roles = new Set(existing?.roles || []);
  roles.add(getAssignmentRoleLabel(entry.role || role));
  const childrenLabels = new Set(existing?.childrenLabels || []);
  if (childLabel) childrenLabels.add(childLabel);
  map.set(id, {
    id,
    name: entry.name || 'Care Team Member',
    avatar: entry.avatar || entry.photoURL,
    phone: entry.phone,
    email: entry.email,
    roles: Array.from(roles),
    childrenLabels: Array.from(childrenLabels),
    raw: entry,
  });
}

function dedupeMembers(children, therapists, options = {}) {
  const parentScoped = options.parentScoped === true;
  const therapistById = new Map((Array.isArray(therapists) ? therapists : []).map((item) => [String(item?.id || '').trim(), item]));
  const map = new Map();
  children.forEach((child) => {
    const childLabel = child?.name || child?.firstName || '';
    const campusId = String(child?.campusId || '').trim();
    const slots = parentScoped
      ? [{ entry: child?.bcaTherapist, role: 'BCBA' }]
      : [
        { entry: child?.amTherapist, role: THERAPY_ROLE_LABELS.amTherapist },
        { entry: child?.pmTherapist, role: THERAPY_ROLE_LABELS.pmTherapist },
        { entry: child?.bcaTherapist, role: 'BCBA' },
      ];
    slots.forEach(({ entry, role }) => {
      addMember(map, entry, role, childLabel);
    });

    if (!parentScoped) {
      (Array.isArray(child?.assignedABA) ? child.assignedABA : []).forEach((staffId) => {
        const resolved = therapistById.get(String(staffId || '').trim());
        addMember(map, resolved, THERAPY_ROLE_LABELS.therapist, childLabel);
      });
    }

    const officeMatches = (Array.isArray(therapists) ? therapists : [])
      .filter((staff) => (parentScoped ? isOfficeAdminRole(staff?.role) : ['office', 'admin', 'reception', 'campusAdmin'].includes(String(staff?.role || '').trim())))
      .filter((staff) => matchesCampus(staff, campusId));

    if (parentScoped) {
      const officeContact = officeMatches[0] || null;
      if (officeContact) addMember(map, officeContact, officeContact.role, childLabel);
    } else {
      officeMatches.forEach((staff) => addMember(map, staff, staff.role, childLabel));
    }
  });
  return Array.from(map.values());
}

function matchesCampus(staff, campusId) {
  const normalizedCampusId = String(campusId || '').trim();
  if (!normalizedCampusId) return true;
  const directCampusId = String(staff?.campusId || '').trim();
  if (directCampusId && directCampusId === normalizedCampusId) return true;
  return Array.isArray(staff?.campusIds) && staff.campusIds.map(String).includes(normalizedCampusId);
}

function buildCampusContacts(children, tenant) {
  const campuses = Array.isArray(tenant?.campuses) ? tenant.campuses : [];
  const campusById = new Map(campuses.map((campus) => [String(campus?.id || '').trim(), campus]));
  const contacts = new Map();

  (Array.isArray(children) ? children : []).forEach((child) => {
    const campusId = String(child?.campusId || '').trim();
    const campus = campusById.get(campusId) || (String(tenant?.currentCampus?.id || '').trim() === campusId ? tenant.currentCampus : null);
    const key = String(campus?.id || campusId || child?.campusName || '').trim();
    if (!key || contacts.has(key)) return;
    contacts.set(key, {
      id: key,
      name: String(campus?.name || child?.campusName || 'Campus').trim(),
      phone: String(campus?.phone || '').trim(),
      email: String(campus?.email || '').trim(),
      address: [
        campus?.address1,
        campus?.address2,
        [campus?.city, campus?.state].filter(Boolean).join(', '),
        campus?.zipCode,
      ].filter(Boolean).join(' '),
      roles: ['Campus Contact'],
      childrenLabels: [],
      raw: { name: String(campus?.name || child?.campusName || 'Campus').trim() },
    });
  });

  if (!contacts.size && tenant?.currentCampus) {
    const campus = tenant.currentCampus;
    contacts.set(String(campus?.id || 'current-campus').trim(), {
      id: String(campus?.id || 'current-campus').trim(),
      name: String(campus?.name || 'Campus').trim(),
      phone: String(campus?.phone || '').trim(),
      email: String(campus?.email || '').trim(),
      address: [
        campus?.address1,
        campus?.address2,
        [campus?.city, campus?.state].filter(Boolean).join(', '),
        campus?.zipCode,
      ].filter(Boolean).join(' '),
      roles: ['Campus Contact'],
      childrenLabels: [],
      raw: { name: String(campus?.name || 'Campus').trim() },
    });
  }

  return Array.from(contacts.values());
}

function ContactCard({ member, showContactInfo = true, showChildrenLabel = true }) {
  const phone = member.phone;
  const email = member.email;
  const onCall = () => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Unable to place call', 'Your device could not open the phone app.');
    });
  };
  const onEmail = () => {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() => {
      Alert.alert('Unable to open email', 'Your device could not open the email app.');
    });
  };
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Image source={avatarSourceFor(member.raw)} style={styles.avatar} />
        <View style={styles.headerText}>
          <Text style={styles.name} numberOfLines={1}>{member.name}</Text>
          {member.roles.length ? (
            <Text style={styles.role} numberOfLines={1}>{member.roles.join(' • ')}</Text>
          ) : null}
          {showChildrenLabel && member.childrenLabels.length ? (
            <Text style={styles.subtle} numberOfLines={1}>For {member.childrenLabels.join(', ')}</Text>
          ) : null}
          {showContactInfo && member.address ? (
            <Text style={styles.subtle}>{member.address}</Text>
          ) : null}
        </View>
      </View>
      {showContactInfo ? <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, !phone && styles.actionBtnDisabled]}
          onPress={onCall}
          disabled={!phone}
          accessibilityRole="button"
          accessibilityLabel={`Call ${member.name}`}
        >
          <MaterialIcons name="phone" size={20} color={phone ? '#1d4ed8' : '#9ca3af'} />
          <Text style={[styles.actionText, !phone && styles.actionTextDisabled]} numberOfLines={1}>
            {maskPhoneDisplay(phone) || 'No phone'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, !email && styles.actionBtnDisabled]}
          onPress={onEmail}
          disabled={!email}
          accessibilityRole="button"
          accessibilityLabel={`Email ${member.name}`}
        >
          <MaterialIcons name="email" size={20} color={email ? '#1d4ed8' : '#9ca3af'} />
          <Text style={[styles.actionText, !email && styles.actionTextDisabled]} numberOfLines={1}>
            {maskEmailDisplay(email) || 'No email'}
          </Text>
        </TouchableOpacity>
      </View> : null}
    </View>
  );
}

export default function CareTeamScreen() {
  const route = useRoute();
  const { user } = useAuth();
  const { children = [], parents = [], therapists = [], fetchAndSync } = useData();
  const tenant = useTenant() || {};
  const isParent = normalizeUserRole(user?.role) === USER_ROLES.PARENT;
  const linkedParentId = findLinkedParentId(user, parents) || user?.id || null;

  useFocusEffect(
    React.useCallback(() => {
      fetchAndSync?.({ force: true }).catch(() => {});
    }, [fetchAndSync])
  );

  const relevantChildren = useMemo(() => {
    const linkedChildren = getRelevantChildren(linkedParentId, children);
    const requestedChildId = route?.params?.childId;
    if (!requestedChildId) return isParent ? linkedChildren.slice(0, 1) : linkedChildren;
    const matchedChildren = linkedChildren.filter((child) => child?.id === requestedChildId);
    if (matchedChildren.length) return matchedChildren;
    return isParent ? linkedChildren.slice(0, 1) : linkedChildren;
  }, [children, linkedParentId, route?.params?.childId]);
  const members = useMemo(() => dedupeMembers(relevantChildren, therapists, { parentScoped: isParent }), [isParent, relevantChildren, therapists]);
  const campusContacts = useMemo(() => (isParent ? [] : buildCampusContacts(relevantChildren, tenant)), [isParent, relevantChildren, tenant]);

  return (
    <ScreenWrapper bannerTitle="My Care Team" style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {members.length === 0 && campusContacts.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcons name="groups" size={36} color="#9ca3af" />
            <Text style={styles.emptyTitle}>No care team yet</Text>
            <Text style={styles.emptyText}>
              {isParent
                ? 'Your linked BCBA and office admin will appear here once they are connected to your child.'
                : `${THERAPY_ROLE_LABELS.therapists}, BCBA, and campus contacts connected to your child will appear here with their contact info.`}
            </Text>
          </View>
        ) : (
          <>
            {members.length ? <Text style={styles.sectionTitle}>Staff</Text> : null}
            {members.map((m) => <ContactCard key={m.id} member={m} showContactInfo={!isParent} showChildrenLabel={!isParent} />)}
            {campusContacts.length ? <Text style={styles.sectionTitle}>Campus Contact</Text> : null}
            {campusContacts.map((contact) => <ContactCard key={contact.id} member={contact} />)}
          </>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#f5f6f8' },
  content: { padding: 16, paddingBottom: 16 },
  sectionTitle: { marginBottom: 10, fontSize: 15, fontWeight: '700', color: '#334155' },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#e5e7eb',
    marginRight: 14,
  },
  headerText: {
    flex: 1,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
  },
  role: {
    marginTop: 2,
    fontSize: 13,
    color: '#1d4ed8',
    fontWeight: '500',
  },
  subtle: {
    marginTop: 2,
    fontSize: 12,
    color: '#6b7280',
  },
  actions: {
    flexDirection: 'row',
    marginTop: 14,
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  actionBtnDisabled: {
    borderColor: '#e5e7eb',
    backgroundColor: '#f3f4f6',
  },
  actionText: {
    color: '#1d4ed8',
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
  },
  actionTextDisabled: {
    color: '#9ca3af',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 16,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  emptyText: {
    marginTop: 6,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});
