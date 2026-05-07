import { useEffect, useState } from 'react';
import { useData } from '../../../DataContext';
import { getOrganizationInsights } from '../services/sessionInsightsApi';

export function useOrganizationInsights(options = {}) {
  const { activeSeedPreset = '', seededOrganizationInsights = null } = useData() || {};
  const [state, setState] = useState({ loading: false, error: '', data: null });

  useEffect(() => {
    let disposed = false;
    async function load() {
      if (activeSeedPreset === 'screenshot' && seededOrganizationInsights && typeof seededOrganizationInsights === 'object') {
        if (!disposed) setState({ loading: false, error: '', data: seededOrganizationInsights });
        return;
      }
      if (!disposed) setState((current) => ({ ...current, loading: true, error: '' }));
      try {
        const result = await getOrganizationInsights(options);
        if (!disposed) setState({ loading: false, error: '', data: result || null });
      } catch (error) {
        if (!disposed) setState({ loading: false, error: String(error?.message || error || 'Could not load organization insights.'), data: null });
      }
    }
    load();
    return () => {
      disposed = true;
    };
  }, [activeSeedPreset, seededOrganizationInsights, JSON.stringify(options || {})]);

  return state;
}

export default useOrganizationInsights;