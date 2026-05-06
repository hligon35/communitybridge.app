import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export default function AppIconButton({
  name,
  onPress,
  accessibilityLabel,
  active = false,
  disabled = false,
  size = 40,
  iconSize = 20,
  style,
  hitSlop,
}) {
  const palette = active
    ? { backgroundColor: '#dbeafe', borderColor: '#93c5fd', color: '#1d4ed8' }
    : { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', color: '#2563eb' };

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      activeOpacity={0.9}
      style={[
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
          opacity: disabled ? 0.55 : 1,
        },
        style,
      ]}
    >
      <MaterialIcons name={name} size={iconSize} color={palette.color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
});