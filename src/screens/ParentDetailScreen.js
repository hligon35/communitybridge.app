import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Linking, Modal, TouchableWithoutFeedback, Alert, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import AppIconButton from '../components/AppIconButton';
import { useData } from '../DataContext';
import { useAuth } from '../AuthContext';
import { useNavigation, useRoute } from '@react-navigation/native';
import ScreenWrapper from '../components/ScreenWrapper';
import { avatarSourceFor, formatIdForDisplay } from '../utils/idVisibility';
import { THERAPY_ROLE_LABELS, getDisplayRoleLabel } from '../utils/roleTerminology';
import { childHasParent } from '../utils/directoryLinking';

export default function ParentDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { parentId } = route.params || {};
  const { parents = [], children = [], therapists = [], sendTimeUpdateAlert, sendMessage, messages = [] } = useData();
  const { user } = useAuth();

  const parent = (parents || []).find((p) => p.id === parentId) || null;
  if (!parent) return (<View style={styles.empty}><Text style={{ color: '#666' }}>Parent not found</Text></View>);

  // children of this parent
  const myChildren = (children || []).filter((child) => childHasParent(child, parent.id));

  const [showTimeModal, setShowTimeModal] = useState(false);
  const [selectedChild, setSelectedChild] = useState(myChildren[0] || null);
  const [timeType, setTimeType] = useState('pickup');
  const [timeDate, setTimeDate] = useState(new Date());

  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [meetingDate, setMeetingDate] = useState(new Date());
  const isWeb = Platform.OS === 'web';

  function openPhone(phone) {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Unable to place call', 'Your device could not open the phone app.');
    });
  }

  function openEmail(email) {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() => {
      Alert.alert('Unable to open email', 'Your device could not open the email app.');
    });
  }

  async function submitTimeUpdate() {
    if (!selectedChild) { Alert.alert('Select child'); return; }
    try {
      await sendTimeUpdateAlert(selectedChild.id, timeType, new Date(timeDate).toISOString(), `Requested by ${parent.firstName || parent.name}`);
      Alert.alert('Sent', 'Urgent time update sent to administration.');
      setShowTimeModal(false);
    } catch (e) {
      console.warn(e);
      Alert.alert('Failed', 'Could not send time update');
    }
  }

  async function submitMeetingRequest() {
    try {
      // Pick a recipient for meeting requests: prefer an admin-role if present, else a BCBA, else first therapist
      const adminLike = (therapists || []).find((t) => (t.role || '').toLowerCase().includes('admin'))
        || (therapists || []).find((t) => (t.role || '').toLowerCase().includes('bcba'))
        || (therapists || [])[0] || { id: 'admin-1', name: 'Office Admin' };
      const payload = { threadId: `meeting-${Date.now()}`, body: `Request meeting on ${formatDateTimeNoSeconds(meetingDate)} for ${parent.firstName || parent.name}`, to: [{ id: adminLike.id, name: adminLike.name }] };
      await sendMessage(payload);
      Alert.alert('Requested', 'Meeting request sent to administration');
      setShowMeetingModal(false);
    } catch (e) {
      console.warn(e);
      Alert.alert('Failed', 'Could not send meeting request');
    }
  }

  const therapistsList = React.useMemo(() => {
    const map = new Map();
    (myChildren || []).forEach((c) => {
      ['amTherapist', 'pmTherapist', 'bcaTherapist'].forEach((k) => {
        const t = c && c[k];
        if (t && t.id) map.set(t.id, t);
      });
    });
    return Array.from(map.values());
  }, [myChildren]);

  

  const getDisplayName = (t) => {
    if (!t) return 'TBA';
    if (t.name) return t.name;
    if (t.firstName || t.lastName) return `${t.firstName || ''} ${t.lastName || ''}`.trim();
    return 'TBA';
  };

  const formatDateTimeNoSeconds = (dateOrIso) => {
    if (!dateOrIso) return '—';
    const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
    if (!d || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const multipleChildren = (myChildren || []).length > 1;
  const dropoffSame = multipleChildren && myChildren.every((c) => c.dropoffTimeISO && c.dropoffTimeISO === myChildren[0].dropoffTimeISO);
  const pickupSame = multipleChildren && myChildren.every((c) => c.pickupTimeISO && c.pickupTimeISO === myChildren[0].pickupTimeISO);
  const shareSchedule = dropoffSame && pickupSame;

  return (
    <ScreenWrapper bannerTitle="Parent Profile" style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={styles.header}>
          <Image source={avatarSourceFor(parent)} style={styles.avatar} />
          <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={styles.name}>{parent.firstName ? `${parent.firstName} ${parent.lastName}` : parent.name}</Text>
             <Text style={styles.meta}>{formatIdForDisplay(parent.id)}</Text>
          </View>
          <View style={styles.headerActionsRight}>
            {parent.phone ? (
              <AppIconButton accessibilityLabel="Call parent" name="call" iconSize={18} size={36} style={styles.profileIconBtn} onPress={() => openPhone(parent.phone)} />
            ) : null}
            {parent.email ? (
              <AppIconButton accessibilityLabel="Email parent" name="email" iconSize={18} size={36} style={styles.profileIconBtn} onPress={() => openEmail(parent.email)} />
            ) : null}
          </View>
        </View>

          <View style={styles.iconActionsRow}>
          <View style={styles.iconCol}>
            <AppIconButton accessibilityLabel="Chat with parent" name="chat" style={styles.iconButton} onPress={async () => {
              try {
                const adminId = user?.id || (user?.name || 'admin');
                // find existing thread where both admin and parent are participants
                const threadMatch = (messages || []).find(m => {
                  const senderId = m.sender?.id || m.sender?.name;
                  const toIds = (m.to || []).map(t => t.id || t.name).filter(Boolean);
                  const participants = new Set([String(senderId), ...toIds.map(String)]);
                  return participants.has(String(adminId)) && participants.has(String(parent.id));
                });
                if (threadMatch && (threadMatch.threadId || threadMatch.threadId === 0)) {
                  navigation.navigate('ChatThread', { threadId: threadMatch.threadId });
                } else if (threadMatch && threadMatch.id) {
                  // fallback when threadId absent
                  navigation.navigate('ChatThread', { threadId: threadMatch.id });
                } else {
                  // no existing thread — create a new thread id and open it so admin can send the first message
                  const newThreadId = `t-${Date.now()}`;
                  navigation.navigate('ChatThread', { threadId: newThreadId });
                }
              } catch (e) { console.warn('open chat failed', e); }
            }} />
            <Text style={styles.iconLabel}>Chat</Text>
          </View>
          <View style={styles.iconCol}>
            <AppIconButton accessibilityLabel="Open urgent memo" name="notification-important" style={styles.iconButton} onPress={() => setShowTimeModal(true)} />
            <Text style={styles.iconLabel}>Urgent Memo</Text>
          </View>
          <View style={styles.iconCol}>
            <AppIconButton accessibilityLabel="Manage parent" name="manage-account" style={styles.iconButton} onPress={() => navigation.navigate('UserMonitor', { initialUserId: parent.id })} />
            <Text style={styles.iconLabel}>Manage</Text>
          </View>
        </View>

        {/* Top-level therapist summary removed - therapists are shown per-child below */}

        {/* Shared schedule is rendered inside the Children container when applicable */}

        <View style={[styles.sectionContainer, { marginTop: 16 }] }>
          <Text style={styles.sectionTitle}>Children</Text>
          {/* If multiple children share the same drop/pick times, show the shared tiles once at the top */}
          {shareSchedule && multipleChildren ? (
            <View style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row' }}>
                <View style={styles.scheduleTileSmall}>
                  <Text style={styles.scheduleLabel}>Drop-off</Text>
                  <View style={styles.scheduleDivider} />
                  <Text style={styles.scheduleTime}>{myChildren[0] && myChildren[0].dropoffTimeISO ? formatDateTimeNoSeconds(myChildren[0].dropoffTimeISO) : '—'}</Text>
                </View>
                <View style={styles.scheduleTileSmall}>
                  <Text style={styles.scheduleLabel}>Pick-up</Text>
                  <View style={styles.scheduleDivider} />
                  <Text style={styles.scheduleTime}>{myChildren[0] && myChildren[0].pickupTimeISO ? formatDateTimeNoSeconds(myChildren[0].pickupTimeISO) : '—'}</Text>
                </View>
              </View>
            </View>
          ) : null}
          {myChildren.length ? myChildren.map((c) => (
            <View key={c.id} style={styles.childCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => { try { navigation.push('ChildDetail', { childId: c.id }); } catch (e) { navigation.navigate('ChildDetail', { childId: c.id }); } }}>
                  <Image source={avatarSourceFor(c)} style={styles.smallAvatar} />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={{ fontWeight: '700' }}>{c.name}</Text>
                    <Text style={{ color: '#6b7280' }}>{c.age} • {c.room}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { try { navigation.push('ChildDetail', { childId: c.id }); } catch (e) { navigation.navigate('ChildDetail', { childId: c.id }); } }} style={{ padding: 8 }}>
                  <MaterialIcons name="open-in-new" size={20} color="#2563eb" />
                </TouchableOpacity>
              </View>

              <View style={[styles.sectionContainer, { marginTop: 10 }] }>
                <Text style={{ fontWeight: '700' }}>{THERAPY_ROLE_LABELS.therapists}</Text>
                {(() => {
                  const bca = c.bcaTherapist || null;
                  const abas = [c.amTherapist, c.pmTherapist].filter((t) => t && !((t.role || '').toLowerCase().includes('bcba')));
                  if (!bca && (!abas || !abas.length)) return null;

                  return (
                    <View style={{ marginTop: 8 }}>
                      {/* BCBA full-width */}
                      {bca ? (
                        <TouchableOpacity key={bca.id} style={[styles.therapistGridItem, styles.therapistGridItemFull, { marginBottom: 8 }]} onPress={() => { try { navigation.push('FacultyDetail', { facultyId: bca.id }); } catch (e) { navigation.navigate('FacultyDetail', { facultyId: bca.id }); } }}>
                          <Image source={avatarSourceFor(bca)} style={{ width: 56, height: 56, borderRadius: 28 }} />
                          <View style={{ marginLeft: 12, flex: 1, overflow: 'hidden' }}>
                            <Text style={styles.nameText} numberOfLines={1} ellipsizeMode="tail">{getDisplayName(bca)}</Text>
                            <Text style={styles.roleText} numberOfLines={1} ellipsizeMode="tail">{getDisplayRoleLabel(bca.role)}</Text>
                          </View>
                          <View style={styles.contactIconsRight}>
                            {bca.phone ? (
                              <TouchableOpacity style={styles.contactIconTouch} onPress={() => openPhone(bca.phone)}>
                                <MaterialIcons name="call" size={18} color="#2563eb" />
                              </TouchableOpacity>
                            ) : null}
                            {bca.email ? (
                              <TouchableOpacity style={styles.contactIconTouch} onPress={() => openEmail(bca.email)}>
                                <MaterialIcons name="email" size={18} color="#2563eb" />
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </TouchableOpacity>
                      ) : null}

                      {/* ABA Techs in rows of two */}
                      {abas.length ? abas.reduce((rows, item, idx) => {
                        if (idx % 2 === 0) rows.push([item]);
                        else rows[rows.length - 1].push(item);
                        return rows;
                      }, []).map((row, rIdx) => (
                        <View key={`row-${rIdx}`} style={{ flexDirection: 'row', marginTop: rIdx === 0 ? 0 : 8 }}>
                          {row.map((t, i) => (
                            <TouchableOpacity key={t.id} style={[styles.therapistGridItem, { flex: 1, marginRight: i === 0 && row.length === 2 ? 8 : 0 }]} onPress={() => { try { navigation.push('FacultyDetail', { facultyId: t.id }); } catch (e) { navigation.navigate('FacultyDetail', { facultyId: t.id }); } }}>
                              <Image source={avatarSourceFor(t)} style={{ width: 44, height: 44, borderRadius: 22 }} />
                              <View style={{ marginLeft: 10, flex: 1, overflow: 'hidden' }}>
                                  <Text style={styles.nameText} numberOfLines={1} ellipsizeMode="tail">{getDisplayName(t)}</Text>
                                  <Text style={styles.roleText} numberOfLines={1} ellipsizeMode="tail">{getDisplayRoleLabel(t.role)}</Text>
                                  <View style={styles.contactIconsCentered}>
                                    {t.phone ? (
                                      <TouchableOpacity style={styles.contactIconTouch} onPress={() => openPhone(t.phone)}>
                                        <MaterialIcons name="call" size={16} color="#2563eb" />
                                      </TouchableOpacity>
                                    ) : null}
                                    {t.email ? (
                                      <TouchableOpacity style={styles.contactIconTouch} onPress={() => openEmail(t.email)}>
                                        <MaterialIcons name="email" size={16} color="#2563eb" />
                                      </TouchableOpacity>
                                    ) : null}
                                  </View>
                                </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )) : null}
                    </View>
                  );
                })()}
              </View>
            </View>
          )) : (
            <Text style={{ color: '#6b7280' }}>No children associated with this parent.</Text>
          )}
        </View>

        <View style={{ height: 40 }} />

      </ScrollView>

      {/* Time update modal */}
      {showTimeModal && (
        <Modal transparent visible animationType="fade">
          <TouchableWithoutFeedback onPress={() => setShowTimeModal(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' }}>
              <TouchableWithoutFeedback>
                <View style={{ width: '90%', backgroundColor: '#fff', padding: 12, borderRadius: 8 }}>
                  <Text style={{ fontWeight: '700', marginBottom: 8 }}>Send Time Update</Text>
                  <Text style={{ marginBottom: 8 }}>Choose child and updated time to send an urgent memo to admin.</Text>
                  <View style={{ marginBottom: 8 }}>
                    <View style={{ marginBottom: 8 }}>
                      {myChildren.map((mc) => (
                        <TouchableOpacity key={mc.id} style={{ padding: 8, backgroundColor: (selectedChild && selectedChild.id === mc.id) ? '#eef2ff' : 'transparent' }} onPress={() => setSelectedChild(mc)}>
                          <Text>{mc.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={{ marginBottom: 6 }}>Selected: {formatDateTimeNoSeconds(timeDate)}</Text>
                    <DateTimePicker value={timeDate} mode="datetime" display={Platform.OS === 'android' ? 'default' : 'inline'} onChange={(e, d) => d && setTimeDate(d)} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <TouchableOpacity onPress={() => setShowTimeModal(false)} style={{ marginRight: 8, padding: 8 }}><Text>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity onPress={submitTimeUpdate} style={{ padding: 8, backgroundColor: '#2563eb', borderRadius: 8 }}><Text style={{ color: '#fff' }}>Send</Text></TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}

      {/* Meeting request modal */}
      {showMeetingModal && (
        <Modal transparent visible animationType="fade">
          <TouchableWithoutFeedback onPress={() => setShowMeetingModal(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' }}>
              <TouchableWithoutFeedback>
                <View style={{ width: '90%', backgroundColor: '#fff', padding: 12, borderRadius: 8 }}>
                  <Text style={{ fontWeight: '700', marginBottom: 8 }}>Request Meeting</Text>
                  <Text style={{ marginBottom: 8 }}>Choose a preferred meeting time and send a meeting request to administration.</Text>
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ marginBottom: 6 }}>Selected: {formatDateTimeNoSeconds(meetingDate)}</Text>
                    <DateTimePicker value={meetingDate} mode="datetime" display={Platform.OS === 'android' ? 'default' : 'inline'} onChange={(e, d) => d && setMeetingDate(d)} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <TouchableOpacity onPress={() => setShowMeetingModal(false)} style={{ marginRight: 8, padding: 8 }}><Text>Cancel</Text></TouchableOpacity>
                    <TouchableOpacity onPress={submitMeetingRequest} style={{ padding: 8, backgroundColor: '#2563eb', borderRadius: 8 }}><Text style={{ color: '#fff' }}>Send</Text></TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}

      

    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#eee' },
  name: { fontSize: 20, fontWeight: '700' },
  meta: { color: '#374151', marginTop: 6, fontSize: 13, fontWeight: '700', backgroundColor: '#f3f4f6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2563eb', padding: 10, borderRadius: 8, marginRight: 8 },
  actionLabel: { color: '#fff', marginLeft: 8, fontWeight: '700' },
  sectionTitle: { fontWeight: '700', marginBottom: 8 },
  sectionContainer: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#eef2f7', backgroundColor: '#fff' },
  childCard: { marginTop: 8, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#eef2f7', backgroundColor: '#fff' },
  smallAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#eee' },
  scheduleTileSmall: { flex: 1, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#eef2f7', alignItems: 'center', marginRight: 8 },
  scheduleLabel: { fontWeight: '700' },
  scheduleDivider: { height: 1, backgroundColor: '#f3f4f6', width: '100%', marginVertical: 8 },
  scheduleTime: { fontWeight: '700', textAlign: 'center' },
  personRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  iconActionsRow: { flexDirection: 'row', marginTop: 12, justifyContent: 'space-between', alignItems: 'center' },
  iconCol: { alignItems: 'center', flex: 1 },
  iconButton: { width: 48, height: 48 },
  iconLabel: { marginTop: 6, fontWeight: '700', fontSize: 12 },
  therapistRow: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#eef2f7', marginTop: 8 },
  therapistGridItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#eef2f7' },
  therapistGridItemFull: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e6f0ff', backgroundColor: '#fff' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  nameText: { fontWeight: '700', fontSize: 14 },
  roleText: { color: '#6b7280', fontSize: 13 },
  contactIconsRight: { flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  contactIconsCentered: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  contactIconTouch: {
    padding: 8,
    marginHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    ...Platform.select({
      web: {
        borderRadius: 8,
        backgroundColor: '#f1f5f9',
        borderWidth: 1,
        borderColor: '#e6eef8',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2,
        elevation: 2,
      },
      default: null,
    }),
  },
  headerActionsRight: { alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  profileIconBtn: { marginVertical: 6 },
});
