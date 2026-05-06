import React, { useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { logger } from '../utils/logger';
import { MobileAdminShellContext } from './TabletNavigationShell';

export default function ScreenHeader({ title, showBack = true, left, right, titleLeft }) {
  const navigation = useNavigation();
  const mobileAdminShell = useContext(MobileAdminShellContext);
  const mobileTopInset = mobileAdminShell?.showMobileAdminShell ? Math.max(mobileAdminShell.topInset || 0, 0) : 0;
  const headerStyle = mobileTopInset ? [styles.header, { height: 56 + mobileTopInset, paddingTop: mobileTopInset }] : styles.header;
  const leftTop = 10 + mobileTopInset;
  const logEvent = (ev) => {
    logger.debug('ui', `ScreenHeader:${ev}`, { title });
  };

  return (
    <View style={headerStyle}>
      {showBack ? (
        <TouchableOpacity
          onPress={() => { logEvent('onPress'); navigation.goBack(); }}
          onPressIn={() => logEvent('onPressIn')}
          onPressOut={() => logEvent('onPressOut')}
          onLongPress={() => logEvent('onLongPress')}
          delayLongPress={600}
          style={[styles.back, { top: leftTop }]}
          accessibilityLabel="Go back"
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        >
          <View style={styles.backInner}>
            <MaterialIcons name="chevron-left" size={26} color="#111827" />
          </View>
        </TouchableOpacity>
      ) : left ? (
        <View style={[styles.left, { top: leftTop }]}>{left}</View>
      ) : (
        <View style={[styles.backPlaceholder, { top: leftTop }]} />
      )}

      {titleLeft ? <View style={styles.titleLeft}>{titleLeft}</View> : null}

      {title ? <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail" pointerEvents="none">{title}</Text> : <View style={styles.titlePlaceholder} />}

      <View style={[styles.right, { top: leftTop }]}>{right || null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { position: 'relative', height: 56, justifyContent: 'center', paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#eee' },
  back: { position: 'absolute', left: 6, top: 10, width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  left: { position: 'absolute', left: 6, top: 10 },
  backInner: {
    width: 40,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  backPlaceholder: { width: 84, position: 'absolute', left: 6, top: 10 },
  titleLeft: {
    position: 'absolute',
    right: '50%',
    marginRight: 12,
    transform: [{ translateX: -150 }],
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  title: { fontSize: 16, lineHeight: 18, fontWeight: '700', textAlign: 'center', marginHorizontal: 64 },
  titlePlaceholder: { height: 0 },
  right: { position: 'absolute', right: 6, top: 10, minWidth: 34, alignItems: 'flex-end' },
});
