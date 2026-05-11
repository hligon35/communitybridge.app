import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GOOGLE_PLACES_API_KEY } from '../config';

const MIN_QUERY_LENGTH = 3;
const SEARCH_DELAY_MS = 250;
const GOOGLE_MAPS_SCRIPT_ID = 'buddyboard-google-maps-places';

let googleMapsScriptPromise = null;

function normalizePredictions(payload) {
  const items = Array.isArray(payload?.predictions) ? payload.predictions : [];
  return items
    .map((item) => ({
      id: String(item?.place_id || '').trim(),
      primaryText: String(item?.structured_formatting?.main_text || item?.description || '').trim(),
      secondaryText: String(item?.structured_formatting?.secondary_text || '').trim(),
      description: String(item?.description || '').trim(),
    }))
    .filter((item) => item.id && item.description);
}

function normalizeWebPredictions(items) {
  const predictions = Array.isArray(items) ? items : [];
  return predictions
    .map((item) => ({
      id: String(item?.place_id || '').trim(),
      primaryText: String(item?.structured_formatting?.main_text || item?.description || '').trim(),
      secondaryText: String(item?.structured_formatting?.secondary_text || '').trim(),
      description: String(item?.description || '').trim(),
    }))
    .filter((item) => item.id && item.description);
}

function getWebGoogleMaps() {
  return globalThis?.google?.maps?.places ? globalThis.google.maps : null;
}

function loadGoogleMapsPlacesScript() {
  if (Platform.OS !== 'web') return Promise.resolve(null);
  const maps = getWebGoogleMaps();
  if (maps) return Promise.resolve(maps);
  if (!String(GOOGLE_PLACES_API_KEY || '').trim()) {
    return Promise.reject(new Error('Google Places API key is missing.'));
  }
  if (googleMapsScriptPromise) return googleMapsScriptPromise;
  googleMapsScriptPromise = new Promise((resolve, reject) => {
    const doc = globalThis?.document;
    if (!doc?.createElement) {
      reject(new Error('Document is not available for address autocomplete.'));
      return;
    }

    const existing = doc.getElementById(GOOGLE_MAPS_SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve(getWebGoogleMaps()), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load Google Maps script.')), { once: true });
      return;
    }

    const script = doc.createElement('script');
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(String(GOOGLE_PLACES_API_KEY || '').trim())}&libraries=places`;
    script.onload = () => {
      const nextMaps = getWebGoogleMaps();
      if (nextMaps) {
        resolve(nextMaps);
        return;
      }
      reject(new Error('Google Maps Places library did not initialize.'));
    };
    script.onerror = () => reject(new Error('Could not load Google Maps script.'));
    doc.head?.appendChild(script);
  }).catch((error) => {
    googleMapsScriptPromise = null;
    throw error;
  });
  return googleMapsScriptPromise;
}

async function fetchAddressPredictions(query) {
  if (Platform.OS === 'web') {
    const maps = await loadGoogleMapsPlacesScript();
    return new Promise((resolve, reject) => {
      const service = new maps.places.AutocompleteService();
      service.getPlacePredictions(
        {
          input: String(query || '').trim(),
          types: ['address'],
        },
        (items, status) => {
          if (status === maps.places.PlacesServiceStatus.OK || status === maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            resolve(normalizeWebPredictions(items));
            return;
          }
          reject(new Error(`Address lookup returned ${status || 'an unknown error'}.`));
        }
      );
    });
  }
  const params = new URLSearchParams({
    input: String(query || '').trim(),
    types: 'address',
    key: String(GOOGLE_PLACES_API_KEY || '').trim(),
  });
  const resp = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`);
  const json = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(String(json?.error_message || resp.statusText || 'Could not load address suggestions.'));
  if (json?.status && json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
    throw new Error(String(json?.error_message || `Address lookup returned ${json.status}.`));
  }
  return normalizePredictions(json);
}

async function fetchAddressDetails(placeId, fallbackText) {
  if (Platform.OS === 'web') {
    const maps = await loadGoogleMapsPlacesScript();
    return new Promise((resolve, reject) => {
      const doc = globalThis?.document;
      const host = doc?.createElement ? doc.createElement('div') : null;
      const service = new maps.places.PlacesService(host || undefined);
      service.getDetails(
        {
          placeId: String(placeId || '').trim(),
          fields: ['formatted_address'],
        },
        (result, status) => {
          if (status === maps.places.PlacesServiceStatus.OK) {
            resolve(String(result?.formatted_address || fallbackText || '').trim());
            return;
          }
          reject(new Error(`Address lookup returned ${status || 'an unknown error'}.`));
        }
      );
    });
  }
  const params = new URLSearchParams({
    place_id: String(placeId || '').trim(),
    fields: 'formatted_address',
    key: String(GOOGLE_PLACES_API_KEY || '').trim(),
  });
  const resp = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`);
  const json = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(String(json?.error_message || resp.statusText || 'Could not load the selected address.'));
  if (json?.status && json.status !== 'OK') {
    throw new Error(String(json?.error_message || `Address lookup returned ${json.status}.`));
  }
  return String(json?.result?.formatted_address || fallbackText || '').trim();
}

function PlainField({ label, value, onChangeText, placeholder, multiline, keyboardType, autoCapitalize, maxLength }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        maxLength={maxLength}
        style={[styles.input, multiline ? styles.inputMultiline : null]}
      />
    </View>
  );
}

export default function AddressAutocompleteField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  maxLength,
}) {
  const enabled = Boolean(String(GOOGLE_PLACES_API_KEY || '').trim());
  const [predictions, setPredictions] = React.useState([]);
  const [focused, setFocused] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [selectionLoading, setSelectionLoading] = React.useState(false);
  const [lookupError, setLookupError] = React.useState('');
  const requestIdRef = React.useRef(0);

  React.useEffect(() => {
    if (!enabled || !focused) {
      setPredictions([]);
      setLoading(false);
      return undefined;
    }
    const query = String(value || '').trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setPredictions([]);
      setLoading(false);
      setLookupError('');
      return undefined;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setLookupError('');
    const timer = setTimeout(() => {
      fetchAddressPredictions(query)
        .then((items) => {
          if (requestIdRef.current !== requestId) return;
          setPredictions(items);
        })
        .catch((error) => {
          if (requestIdRef.current !== requestId) return;
          setPredictions([]);
          setLookupError(String(error?.message || error || 'Could not load address suggestions.'));
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false);
        });
    }, SEARCH_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [enabled, focused, value]);

  const handleSelectPrediction = React.useCallback(async (item) => {
    const placeId = String(item?.id || '').trim();
    const fallbackText = String(item?.description || '').trim();
    if (!placeId) {
      onChangeText(fallbackText);
      setPredictions([]);
      setFocused(false);
      return;
    }
    setSelectionLoading(true);
    setLookupError('');
    try {
      const nextValue = await fetchAddressDetails(placeId, fallbackText);
      onChangeText(nextValue || fallbackText);
      setPredictions([]);
      setFocused(false);
    } catch (error) {
      onChangeText(fallbackText);
      setPredictions([]);
      setFocused(false);
      setLookupError(String(error?.message || error || 'Could not fill the selected address.'));
    } finally {
      setSelectionLoading(false);
    }
  }, [onChangeText]);

  if (!enabled) {
    return (
      <PlainField
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
      />
    );
  }

  const showPredictions = focused && predictions.length > 0;
  const showHint = focused && String(value || '').trim().length < MIN_QUERY_LENGTH;

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#94a3b8"
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          multiline={false}
          maxLength={maxLength}
          onFocus={() => setFocused(true)}
          style={styles.input}
        />
        {loading || selectionLoading ? <ActivityIndicator size="small" color="#2563eb" style={styles.inputSpinner} /> : null}
      </View>
      <Text style={styles.fieldHint}>Start typing a street address to search and auto-fill the full address.</Text>
      {showHint ? <Text style={styles.lookupHint}>Enter at least {MIN_QUERY_LENGTH} characters to load suggestions.</Text> : null}
      {lookupError ? <Text style={styles.lookupError}>{lookupError}</Text> : null}
      {showPredictions ? (
        <View style={styles.predictionsCard}>
          {predictions.map((item) => (
            <Pressable key={item.id} style={styles.predictionRow} onPress={() => handleSelectPrediction(item)}>
              <Text style={styles.predictionTitle}>{item.primaryText || item.description}</Text>
              {item.secondaryText ? <Text style={styles.predictionSubtitle}>{item.secondaryText}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { width: '100%', marginTop: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  inputWrap: { position: 'relative' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#dbe2ea',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingRight: 40,
    backgroundColor: '#fff',
    color: '#0f172a',
  },
  inputMultiline: { minHeight: 92, textAlignVertical: 'top' },
  inputSpinner: { position: 'absolute', right: 12, top: 12 },
  fieldHint: { marginTop: 8, color: '#64748b', lineHeight: 18 },
  lookupHint: { marginTop: 8, color: '#475569', fontSize: 12 },
  lookupError: { marginTop: 8, color: '#b91c1c', fontSize: 12, fontWeight: '600' },
  predictionsCard: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  predictionRow: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  predictionTitle: { color: '#0f172a', fontWeight: '700' },
  predictionSubtitle: { marginTop: 4, color: '#64748b' },
});