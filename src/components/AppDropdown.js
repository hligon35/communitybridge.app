import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

export default function AppDropdown({
  accessibilityLabel,
  activeItemStyle,
  activeItemTextStyle,
  buttonStyle,
  containerStyle,
  disabled = false,
  fallbackAnchor,
  height = 46,
  iconColor = '#475569',
  iconSize = 18,
  itemStyle,
  itemTextStyle,
  minMenuWidth,
  onOpenChange,
  onSelect,
  options = [],
  placeholder = '',
  placeholderTextStyle,
  selectedValue,
  textStyle,
  value,
  width,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const buttonRef = useRef(null);
  const items = Array.isArray(options) ? options.filter(Boolean) : [];
  const resolvedDisabled = disabled || !items.length;

  function closeMenu() {
    setMenuOpen(false);
    onOpenChange?.(false);
  }

  function openMenu() {
    if (resolvedDisabled) return;
    if (menuOpen) {
      closeMenu();
      return;
    }
    if (buttonRef.current?.measureInWindow) {
      buttonRef.current.measureInWindow((x, y, measuredWidth, measuredHeight) => {
        setMenuAnchor({ x, y, width: measuredWidth, height: measuredHeight });
        setMenuOpen(true);
        onOpenChange?.(true);
      });
      return;
    }
    setMenuAnchor(fallbackAnchor || { x: 12, y: 56, width: width || minMenuWidth || 136, height });
    setMenuOpen(true);
    onOpenChange?.(true);
  }

  const displayedValue = value || placeholder;
  const resolvedMenuWidth = Math.max(menuAnchor?.width ?? width ?? minMenuWidth ?? 136, minMenuWidth ?? 0);

  return (
    <View style={containerStyle}>
      <TouchableOpacity
        accessibilityLabel={accessibilityLabel || placeholder || value || 'Open menu'}
        activeOpacity={0.9}
        disabled={resolvedDisabled}
        onPress={openMenu}
        ref={buttonRef}
        style={[
          styles.button,
          { height },
          width != null ? { width } : null,
          buttonStyle,
          resolvedDisabled ? styles.buttonDisabled : null,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.buttonText,
            !value ? styles.placeholderText : null,
            textStyle,
            !value ? placeholderTextStyle : null,
          ]}
        >
          {displayedValue}
        </Text>
        {!resolvedDisabled ? <MaterialIcons color={iconColor} name={menuOpen ? 'arrow-drop-up' : 'arrow-drop-down'} size={iconSize} /> : null}
      </TouchableOpacity>

      {menuOpen ? (
        <Modal animationType="none" transparent visible onRequestClose={closeMenu}>
          <Pressable style={styles.backdrop} onPress={closeMenu}>
            <View
              style={[
                styles.menu,
                {
                  left: menuAnchor?.x ?? fallbackAnchor?.x ?? 12,
                  top: (menuAnchor?.y ?? fallbackAnchor?.y ?? 56) + (menuAnchor?.height ?? fallbackAnchor?.height ?? height) + 6,
                  width: resolvedMenuWidth,
                },
              ]}
            >
              {items.map((option, index) => {
                const optionValue = option?.value;
                const active = optionValue === selectedValue;
                return (
                  <TouchableOpacity
                    key={`${String(optionValue)}-${index}`}
                    onPress={() => {
                      onSelect?.(optionValue);
                      closeMenu();
                    }}
                    style={[styles.item, itemStyle, active ? styles.itemActive : null, active ? activeItemStyle : null]}
                  >
                    <Text numberOfLines={1} style={[styles.itemText, itemTextStyle, active ? styles.itemTextActive : null, active ? activeItemTextStyle : null]}>
                      {option?.label || String(optionValue || '')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  button: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  buttonDisabled: { opacity: 0.72 },
  buttonText: {
    flex: 1,
    marginRight: 8,
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '600',
  },
  placeholderText: {
    color: '#64748b',
    fontWeight: '500',
  },
  menu: {
    position: 'absolute',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingVertical: 4,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  item: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  itemActive: {
    backgroundColor: '#eff6ff',
  },
  itemText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  itemTextActive: {
    color: '#1d4ed8',
  },
});