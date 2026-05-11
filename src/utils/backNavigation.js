export const MAIN_NAV_ROUTES = new Set([
  'CommunityMain',
  'ChatsList',
  'MyChildMain',
  'SettingsMain',
  'MyClassMain',
  'ControlsMain',
]);

export function isMainNavRoute(routeName) {
  return MAIN_NAV_ROUTES.has(routeName);
}

export function shouldShowSubscreenBack(navigation, routeName) {
  if (!navigation?.canGoBack?.() || isMainNavRoute(routeName)) return false;

  const state = navigation?.getState?.();
  const routes = Array.isArray(state?.routes) ? state.routes : [];
  const index = Number.isInteger(state?.index) ? state.index : routes.findIndex((route) => route?.name === routeName);
  return index > 0;
}