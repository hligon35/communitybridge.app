import React, { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const TILE_GAP = 10;
const MIN_TILE_WIDTH = 168;

export default function BehaviorTapGrid({ groups = [], queuedEvents = [], disabled = false, onQueueEvent, onUndoLast }) {
  const [variantPicker, setVariantPicker] = useState(null);
  const [textPromptState, setTextPromptState] = useState(null);
  const [textPromptValue, setTextPromptValue] = useState('');
  const [undoToast, setUndoToast] = useState('');
  const [lastQueuedId, setLastQueuedId] = useState('');
  const [gridWidth, setGridWidth] = useState(0);

  const queuedPreview = useMemo(() => queuedEvents.slice(-4).reverse(), [queuedEvents]);

  useEffect(() => {
    if (!undoToast) return undefined;
    const timer = setTimeout(() => setUndoToast(''), 5000);
    return () => clearTimeout(timer);
  }, [undoToast]);

  useEffect(() => {
    const latestQueuedEvent = queuedEvents[queuedEvents.length - 1];
    if (!latestQueuedEvent?.localId || latestQueuedEvent.localId === lastQueuedId) return;
    setLastQueuedId(latestQueuedEvent.localId);
    setUndoToast(`${latestQueuedEvent.label || 'Event'} queued`);
  }, [lastQueuedId, queuedEvents]);

  function queuePreset(preset, intensityOverride = null, variantOption = null) {
    if (!preset || typeof onQueueEvent !== 'function') return;
    const payload = {
      ...preset.payload,
      intensity: intensityOverride || preset.payload?.intensity || null,
      metadata: {
        ...(preset.payload?.metadata || {}),
        ...(variantOption?.metadata || {}),
      },
    };
    onQueueEvent(payload, preset, intensityOverride, variantOption);
  }

  function openTextPrompt(preset, variantOption) {
    const textPrompt = preset?.variantPrompt?.textPrompt;
    if (!textPrompt) {
      queuePreset(preset, null, variantOption);
      return;
    }
    setTextPromptState({ preset, variantOption, textPrompt });
    setTextPromptValue('');
  }

  function handlePress(preset) {
    if (preset?.variantPrompt?.options?.length) {
      setVariantPicker(preset);
      return;
    }
    queuePreset(preset);
  }

  function handleUndoPress() {
    if (!queuedEvents.length || disabled || typeof onUndoLast !== 'function') return;
    onUndoLast();
    setUndoToast('Last queued event removed');
  }

  function resolveTileWidth(itemCount) {
    const availableWidth = Number(gridWidth) || 0;
    if (!availableWidth) return null;
    const maxColumns = Math.min(Math.max(itemCount || 1, 1), 4);
    const columns = Math.max(1, Math.min(maxColumns, Math.floor((availableWidth + TILE_GAP) / (MIN_TILE_WIDTH + TILE_GAP)) || 1));
    return Math.floor((availableWidth - (TILE_GAP * (columns - 1))) / columns);
  }

  return (
    <View style={styles.root}>
      {undoToast ? (
        <View style={styles.toastWrap} pointerEvents="box-none">
          <View style={styles.toastCard}>
            <Text style={styles.toastText}>{undoToast}</Text>
            {queuedEvents.length ? (
              <TouchableOpacity style={styles.toastUndoButton} onPress={handleUndoPress} disabled={disabled}>
                <Text style={styles.toastUndoText}>Undo</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {queuedPreview.length ? (
        <View style={styles.queueWrap}>
          <View style={styles.queueHeaderRow}>
            <Text style={styles.queueTitle}>Queued before sync</Text>
          </View>
          <View style={styles.queueChipRow}>
            {queuedPreview.map((event) => (
              <View key={event.localId} style={styles.queueChip}>
                <Text style={styles.queueChipText} numberOfLines={1}>{event.label}</Text>
                {event.intensity ? <Text style={styles.queueChipMeta}>{event.intensity}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {groups.map((group) => (
        <View key={group.key} style={styles.section}>
          <Text style={styles.sectionTitle}>{group.title}</Text>
          <View
            style={styles.grid}
            onLayout={(event) => {
              const nextWidth = Math.floor(event?.nativeEvent?.layout?.width || 0);
              if (nextWidth && nextWidth !== gridWidth) setGridWidth(nextWidth);
            }}
          >
            {group.items.map((preset) => (
              <TouchableOpacity
                key={preset.key}
                style={[
                  styles.tile,
                  gridWidth ? { width: resolveTileWidth(group.items.length) } : (group.items.length === 4 ? styles.tileFourAcross : styles.tileThreeAcross),
                  disabled ? styles.tileDisabled : null,
                ]}
                activeOpacity={0.88}
                disabled={disabled}
                onPress={() => handlePress(preset)}
              >
                <Text style={styles.tileLabel} numberOfLines={2} ellipsizeMode="tail">{preset.label}</Text>
                <Text style={styles.tileDescription}>{preset.description}</Text>
                <Text style={styles.tileMetaHint}>Tap to choose detail</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      <Modal transparent visible={!!variantPicker} animationType="fade" onRequestClose={() => setVariantPicker(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.selectionModalCard]}>
            <Text style={styles.modalTitle}>{variantPicker?.variantPrompt?.title || variantPicker?.label || 'Choose detail'}</Text>
            <Text style={styles.modalSubtitle}>Add structured detail before the event is queued.</Text>
            <View style={styles.modalOptions}>
              {(variantPicker?.variantPrompt?.options || []).map((option) => (
                <TouchableOpacity
                  key={option.label}
                  style={styles.modalOption}
                  onPress={() => {
                    const preset = variantPicker;
                    setVariantPicker(null);
                    if (preset) openTextPrompt(preset, option);
                  }}
                >
                  <Text style={styles.modalOptionText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setVariantPicker(null)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={!!textPromptState} animationType="fade" onRequestClose={() => setTextPromptState(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{textPromptState?.textPrompt?.title || 'Add detail'}</Text>
            <Text style={styles.modalSubtitle}>Capture short structured context for this event.</Text>
            <TextInput
              value={textPromptValue}
              onChangeText={setTextPromptValue}
              placeholder={textPromptState?.textPrompt?.placeholder || 'Enter detail'}
              multiline
              style={styles.modalInput}
            />
            <View style={styles.modalActionRow}>
              <TouchableOpacity style={styles.modalSecondaryButton} onPress={() => setTextPromptState(null)}>
                <Text style={styles.modalSecondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPrimaryButton, !textPromptValue.trim() ? styles.modalPrimaryButtonDisabled : null]}
                disabled={!textPromptValue.trim()}
                onPress={() => {
                  const promptState = textPromptState;
                  setTextPromptState(null);
                  if (!promptState?.preset) return;
                  const metadataKey = promptState?.textPrompt?.metadataKey || 'noteText';
                  const variantOption = {
                    ...(promptState.variantOption || {}),
                    metadata: {
                      ...(promptState.variantOption?.metadata || {}),
                      [metadataKey]: textPromptValue.trim(),
                    },
                  };
                  queuePreset(promptState.preset, null, variantOption);
                }}
              >
                <Text style={styles.modalPrimaryButtonText}>Queue Event</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: 12 },
  toastWrap: { position: 'absolute', top: -6, left: 0, right: 0, alignItems: 'center', zIndex: 2 },
  toastCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#0f172a' },
  toastText: { color: '#ffffff', fontWeight: '700' },
  toastUndoButton: { marginLeft: 12, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' },
  toastUndoText: { color: '#ffffff', fontWeight: '800', fontSize: 12 },
  queueWrap: { marginTop: 12 },
  queueHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  queueTitle: { fontWeight: '700', color: '#334155', marginBottom: 8 },
  queueChipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  queueChip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    marginRight: 8,
    marginBottom: 8,
  },
  queueChipText: { fontWeight: '700', color: '#0f172a', maxWidth: 160 },
  queueChipMeta: { marginTop: 2, color: '#64748b', fontSize: 11 },
  section: { marginTop: 14 },
  sectionTitle: { fontWeight: '800', color: '#0f172a', marginBottom: 10, fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: {
    minHeight: 112,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    marginBottom: 10,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  tileFourAcross: { width: '23.5%' },
  tileThreeAcross: { width: '32%' },
  tileDisabled: { opacity: 0.5 },
  tileLabel: { width: '100%', fontSize: 15, lineHeight: 20, minHeight: 40, fontWeight: '800', color: '#0f172a' },
  tileDescription: { marginTop: 4, color: '#475569', lineHeight: 18, fontSize: 12, flexGrow: 1, width: '100%' },
  tileMetaHint: { marginTop: 10, color: '#2563eb', fontSize: 11, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 18,
    backgroundColor: '#ffffff',
    padding: 18,
    width: '100%',
    maxWidth: 460,
  },
  selectionModalCard: { width: 'auto', maxWidth: 320, alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 14 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  modalSubtitle: { marginTop: 4, color: '#64748b' },
  modalOptions: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', alignSelf: 'flex-start' },
  modalOption: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    marginBottom: 6,
    marginRight: 6,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  modalOptionText: { color: '#1d4ed8', fontWeight: '800', fontSize: 12 },
  modalCancel: { marginTop: 4, alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4 },
  modalCancelText: { color: '#64748b', fontWeight: '700' },
  modalInput: {
    marginTop: 14,
    minHeight: 90,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  modalActionRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  modalSecondaryButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#e2e8f0', marginRight: 8 },
  modalSecondaryButtonText: { color: '#0f172a', fontWeight: '700' },
  modalPrimaryButton: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563eb' },
  modalPrimaryButtonDisabled: { opacity: 0.45 },
  modalPrimaryButtonText: { color: '#ffffff', fontWeight: '700' },
});