export function formatAddressInput(input) {
  let value = String(input || '');
  value = value.replace(/[\t ]{2,}/g, ' ');
  value = value.replace(/\s*,\s*/g, ', ');
  value = value.replace(/^\s+/g, '');
  return value;
}