function attachTherapistsToChildren(childrenArr, therapistsArr, abaRel) {
  const byId = (therapistsArr || []).reduce((acc, t) => {
    if (t && t.id != null) acc[String(t.id)] = t;
    return acc;
  }, {});

  const rel = (abaRel && typeof abaRel === 'object') ? abaRel : null;
  const relAssignments = rel && Array.isArray(rel.assignments) ? rel.assignments : null;
  const relSupervision = rel && Array.isArray(rel.supervision) ? rel.supervision : null;

  const assignmentByChildSession = {};
  if (relAssignments) {
    relAssignments.forEach((a) => {
      const childId = a && a.childId != null ? String(a.childId).trim() : '';
      const session = a && a.session != null ? String(a.session).trim().toUpperCase() : '';
      const abaId = a && a.abaId != null ? String(a.abaId).trim() : '';
      if (!childId || (session !== 'AM' && session !== 'PM') || !abaId) return;
      assignmentByChildSession[`${childId}|${session}`] = abaId;
    });
  }

  const supervisionByAbaId = {};
  if (relSupervision) {
    relSupervision.forEach((s) => {
      const abaId = s && s.abaId != null ? String(s.abaId).trim() : '';
      const bcbaId = s && s.bcbaId != null ? String(s.bcbaId).trim() : '';
      if (abaId && bcbaId) supervisionByAbaId[abaId] = bcbaId;
    });
  }

  return (childrenArr || []).map((c) => {
    const childId = c && c.id != null ? String(c.id) : '';
    const explicitAmId = c && c.amTherapist != null
      ? String(typeof c.amTherapist === 'object' ? c.amTherapist.id || '' : c.amTherapist).trim()
      : '';
    const explicitPmId = c && c.pmTherapist != null
      ? String(typeof c.pmTherapist === 'object' ? c.pmTherapist.id || '' : c.pmTherapist).trim()
      : '';
    const explicitBcbaId = c && c.bcaTherapist != null
      ? String(typeof c.bcaTherapist === 'object' ? c.bcaTherapist.id || '' : c.bcaTherapist).trim()
      : '';

    const amAbaId = childId ? assignmentByChildSession[`${childId}|AM`] : null;
    const pmAbaId = childId ? assignmentByChildSession[`${childId}|PM`] : null;
    if (amAbaId || pmAbaId) {
      const amTherapist = amAbaId ? (byId[amAbaId] || null) : null;
      const pmTherapist = pmAbaId ? (byId[pmAbaId] || null) : null;
      const bcbaId = (amAbaId && supervisionByAbaId[amAbaId]) || (pmAbaId && supervisionByAbaId[pmAbaId]) || null;
      const bcaTherapist = bcbaId ? (byId[bcbaId] || null) : null;
      return { ...c, bcaTherapist, amTherapist, pmTherapist };
    }

    if (explicitAmId || explicitPmId || explicitBcbaId) {
      const amTherapist = explicitAmId ? (byId[explicitAmId] || c.amTherapist || null) : null;
      const pmTherapist = explicitPmId ? (byId[explicitPmId] || c.pmTherapist || null) : null;
      const bcaTherapist = explicitBcbaId ? (byId[explicitBcbaId] || c.bcaTherapist || null) : null;
      return { ...c, bcaTherapist, amTherapist, pmTherapist };
    }

    const assigned = c.assignedABA || c.assigned_ABA || c.assigned || [];
    const primaryId = Array.isArray(assigned) && assigned.length ? String(assigned[0]) : null;
    const aba = primaryId ? (byId[primaryId] || null) : null;

    let amTherapist = null;
    let pmTherapist = null;
    if (c.session === 'AM') amTherapist = aba;
    else if (c.session === 'PM') pmTherapist = aba;
    else {
      amTherapist = aba;
      pmTherapist = aba;
    }

    let bcaTherapist = null;
    if (aba && aba.supervisedBy) bcaTherapist = byId[aba.supervisedBy] || null;
    return { ...c, bcaTherapist, amTherapist, pmTherapist };
  });
}

function mergeById(existing, additions) {
  const out = Array.isArray(existing) ? [...existing] : [];
  const byId = new Set(out.map((x) => String(x && x.id ? x.id : '')).filter(Boolean));
  (Array.isArray(additions) ? additions : []).forEach((item) => {
    const id = item && item.id ? String(item.id) : '';
    if (!id || byId.has(id)) return;
    byId.add(id);
    out.push(item);
  });
  return out;
}

module.exports = {
  attachTherapistsToChildren,
  mergeById,
};