import { useEffect, useState } from 'react';
import { useData } from '../../../DataContext';
import { getTherapistDocumentationInsights } from '../services/sessionInsightsApi';

export function useTherapistDocumentationInsights(options = {}) {
  const { activeSeedPreset = '', seededTherapistDocumentationInsights = null } = useData() || {};
  const [state, setState] = useState({ loading: false, error: '', data: null });

  useEffect(() => {
    let disposed = false;
    async function load() {
      if (activeSeedPreset === 'screenshot' && seededTherapistDocumentationInsights && typeof seededTherapistDocumentationInsights === 'object') {
        if (!disposed) setState({ loading: false, error: '', data: seededTherapistDocumentationInsights });
        return;
      }
      if (!disposed) setState((current) => ({ ...current, loading: true, error: '' }));
      try {
        const result = await getTherapistDocumentationInsights(options);
        if (!disposed) setState({ loading: false, error: '', data: result || null });
      } catch (error) {
        if (!disposed) setState({ loading: false, error: String(error?.message || error || 'Could not load documentation insights.'), data: null });
      }
    }
    load();
    return () => {
      disposed = true;
    };
  }, [activeSeedPreset, seededTherapistDocumentationInsights, JSON.stringify(options || {})]);

  return state;
}

export default useTherapistDocumentationInsights;