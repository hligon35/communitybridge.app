export function normalizeEmail(input) {
  const e = String(input || '').trim().toLowerCase();
  return e.includes('@') ? e : '';
}

export function normalizeName(input) {
  return String(input || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function sameEmail(a, b) {
  const ea = normalizeEmail(a);
  const eb = normalizeEmail(b);
  return !!ea && !!eb && ea === eb;
}

export function sameName(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return !!na && !!nb && na === nb;
}

export function fullNameFromParent(p) {
  if (!p) return '';
  if (p.name) return String(p.name);
  const first = p.firstName || p.first_name || p.first || '';
  const last = p.lastName || p.last_name || p.last || '';
  const out = `${String(first || '').trim()} ${String(last || '').trim()}`.trim();
  return out;
}

export function findLinkedParentId(user, parents) {
  const uid = user?.id != null ? String(user.id) : '';
  if (uid) {
    const hit = (parents || []).find((p) => p && String(p.id) === uid);
    if (hit && hit.id != null) return String(hit.id);
  }
  const uEmail = user?.email;
  const byEmail = (parents || []).find((p) => p && sameEmail(p.email, uEmail));
  if (byEmail && byEmail.id != null) return String(byEmail.id);

  const uName = user?.name;
  const byName = (parents || []).find((p) => p && sameName(fullNameFromParent(p), uName));
  if (byName && byName.id != null) return String(byName.id);

  return null;
}

export function findLinkedTherapistId(user, therapists) {
  const uid = user?.id != null ? String(user.id) : '';
  if (uid) {
    const hit = (therapists || []).find((t) => t && String(t.id) === uid);
    if (hit && hit.id != null) return String(hit.id);
  }

  const uEmail = user?.email;
  const byEmail = (therapists || []).find((t) => t && sameEmail(t.email, uEmail));
  if (byEmail && byEmail.id != null) return String(byEmail.id);

  const uName = user?.name;
  const byName = (therapists || []).find((t) => t && sameName(t.name, uName));
  if (byName && byName.id != null) return String(byName.id);

  return null;
}

export function childHasParent(child, parentId) {
  const pid = parentId != null ? String(parentId) : '';
  if (!pid) return false;
  const inlineParents = Array.isArray(child?.parents) ? child.parents : [];
  const parentIds = Array.isArray(child?.parentIds) ? child.parentIds : [];
  if (parentIds.some((value) => String(value) === pid)) return true;
  return inlineParents.some((p) => {
    if (!p) return false;
    if (typeof p === 'string' || typeof p === 'number') return String(p) === pid;
    if (typeof p === 'object' && p.id != null) return String(p.id) === pid;
    return false;
  });
}
