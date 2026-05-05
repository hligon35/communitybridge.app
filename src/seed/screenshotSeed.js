const raw = {
  organization: {
    id: 'org-demo-001',
    name: 'CommunityBridge Therapy Center',
  },
  programs: [
    {
      id: 'program-aba-001',
      organizationId: 'org-demo-001',
      name: 'Center-Based ABA',
      type: 'centerBasedAba',
    },
  ],
  campuses: [
    {
      id: 'campus-main-001',
      organizationId: 'org-demo-001',
      programId: 'program-aba-001',
      name: 'Main Campus',
      enrollmentCode: 'DEMO2026',
    },
  ],
  rooms: ['Blue-1', 'Blue-2', 'Green-1', 'Green-2', 'Yellow-1', 'Yellow-2', 'Red-1', 'Red-2', 'Orange-1', 'Purple-1'],
  users: [
    { id: 'user-parent-001', name: 'Alicia Cook', email: 'parent.demo@communitybridge.app', role: 'parent' },
    { id: 'user-therapist-001', name: 'Jordan Ellis', email: 'therapist.demo@communitybridge.app', role: 'therapist' },
    { id: 'user-bcba-001', name: 'Dr. Marissa Bennett', email: 'bcba.demo@communitybridge.app', role: 'bcba' },
    { id: 'user-office-001', name: 'Linda Carter', email: 'office.demo@communitybridge.app', role: 'office' },
    { id: 'user-reception-001', name: 'Tom Richards', email: 'reception.demo@communitybridge.app', role: 'reception' },
    { id: 'user-admin-001', name: 'Jordan Admin', email: 'admin.demo@communitybridge.app', role: 'admin' },
  ],
  parents: [
    { id: 'par-001', userId: 'user-parent-001', name: 'Alicia Cook', phone: '317-555-5101', email: 'parent.demo@communitybridge.app', avatar: '', childIds: ['child-001', 'child-002'] },
    { id: 'par-002', name: 'Brian Thompson', phone: '317-555-5102', email: 'brian.thompson@example.com', avatar: '', childIds: ['child-003'] },
    { id: 'par-003', name: 'Danielle Moore', phone: '317-555-5103', email: 'danielle.moore@example.com', avatar: '', childIds: ['child-004', 'child-005'] },
    { id: 'par-004', name: 'Eric Johnson', phone: '317-555-5104', email: 'eric.johnson@example.com', avatar: '', childIds: ['child-006'] },
    { id: 'par-005', name: 'Felicia Grant', phone: '317-555-5105', email: 'felicia.grant@example.com', avatar: '', childIds: ['child-007'] },
    { id: 'par-006', name: 'George Ramirez', phone: '317-555-5106', email: 'george.ramirez@example.com', avatar: '', childIds: ['child-008', 'child-009', 'child-010'] },
  ],
  therapists: [
    { id: 'bcba-001', userId: 'user-bcba-001', name: 'Dr. Marissa Bennett', role: 'bcba', title: 'Supervising Clinician', email: 'bcba.demo@communitybridge.app', phone: '317-555-4101', avatar: '' },
    { id: 'aba-101', userId: 'user-therapist-001', name: 'Jordan Ellis', role: 'therapist', title: 'ABA Therapist', email: 'therapist.demo@communitybridge.app', phone: '317-555-4102', avatar: '', supervisedBy: 'bcba-001' },
    { id: 'aba-102', name: 'Samantha Reyes', role: 'therapist', title: 'ABA Therapist', email: 'samantha.reyes@example.com', phone: '317-555-4103', avatar: '', supervisedBy: 'bcba-001' },
    { id: 'aba-103', name: 'Marcus Hill', role: 'therapist', title: 'ABA Therapist', email: 'marcus.hill@example.com', phone: '317-555-4104', avatar: '', supervisedBy: 'bcba-001' },
    { id: 'office-001', userId: 'user-office-001', name: 'Linda Carter', role: 'office', title: 'Operations Director', email: 'office.demo@communitybridge.app', phone: '317-555-4105', avatar: '' },
    { id: 'frontdesk-001', userId: 'user-reception-001', name: 'Tom Richards', role: 'reception', title: 'Front Desk', email: 'reception.demo@communitybridge.app', phone: '317-555-4106', avatar: '' },
  ],
  children: [
    { id: 'child-001', name: 'Zahari Cook', age: '5', room: 'Blue-2', parents: [{ id: 'par-001', name: 'Alicia Cook' }], assignedABA: ['aba-101', 'aba-102'], session: 'AM', dropoffTimeISO: '2026-04-27T09:15:00', pickupTimeISO: '2026-04-27T12:30:00', notes: 'Improving transitions and communication.', carePlan: 'Increase independent communication during transitions.', monthlyGoal: 'Use functional communication during 80% of transitions.', successCriteria: '4 of 5 transition opportunities completed with one prompt.', curriculum: 'Functional Communication, Transitions, Matching', behaviorNotes: 'Low task refusal, redirected quickly.', moodScore: 14, mood: 14, insurance: { provider: 'Demo Health Plan', memberId: '120990673299', groupNumber: 'GRP-001', subscriberName: 'Zahari Cook', relationToSubscriber: 'Self', expirationDate: null, authorizationStatus: 'active', approvedHours: 120, remainingHours: 48, billingContact: 'billing@communitybridge.app' }, programDocs: [{ title: 'Transition Support Plan', url: 'https://example.com/transition-support-plan.pdf' }] },
    { id: 'child-002', name: 'Aubrey Cook', age: '7', room: 'Blue-1', parents: [{ id: 'par-001', name: 'Alicia Cook' }], assignedABA: ['aba-101'], session: 'PM', dropoffTimeISO: '2026-04-27T13:00:00', pickupTimeISO: '2026-04-27T16:00:00', notes: 'Working on communication goals.', carePlan: 'Increase spontaneous requests.', monthlyGoal: 'Request preferred items independently.', successCriteria: 'Completed 5 of 6 communication trials.', curriculum: 'Mand Training, Peer Play, Visual Schedule', behaviorNotes: 'No major interfering behaviors.', moodScore: 13, mood: 13, insurance: { provider: 'Demo Health Plan', memberId: '120990673300', groupNumber: 'GRP-001', subscriberName: 'Aubrey Cook', relationToSubscriber: 'Self', expirationDate: '2026-12-31', authorizationStatus: 'active', approvedHours: 100, remainingHours: 52, billingContact: '317-555-6000' } },
    { id: 'child-003', name: 'Mason Thompson', age: '6', room: 'Green-1', parents: [{ id: 'par-002', name: 'Brian Thompson' }], assignedABA: ['aba-102'], session: 'AM', dropoffTimeISO: '2026-04-28T09:00:00', pickupTimeISO: '2026-04-28T12:00:00', notes: 'Practicing peer interaction.', carePlan: 'Increase cooperative play.', monthlyGoal: 'Participate in group activity for 10 minutes.', successCriteria: 'Stayed in group for 8 minutes.', curriculum: 'Peer Play, Group Instruction', behaviorNotes: 'Moderate elopement attempt, redirected.', moodScore: 9, mood: 9, insurance: { provider: 'CareFirst Demo', memberId: '120990673301', groupNumber: 'GRP-003', subscriberName: 'Mason Thompson', relationToSubscriber: 'Child', expirationDate: '2026-08-31', authorizationStatus: 'pending', approvedHours: 80, remainingHours: 12 } },
    { id: 'child-004', name: 'Harper Moore', age: '8', room: 'Green-2', parents: [{ id: 'par-003', name: 'Danielle Moore' }], assignedABA: ['aba-103'], session: 'PM', dropoffTimeISO: '2026-04-28T13:00:00', pickupTimeISO: '2026-04-28T16:00:00', notes: 'Reduced prompting during table work.', carePlan: 'Build independent work stamina.', monthlyGoal: 'Complete table work for 12 minutes.', successCriteria: 'Completed 10 minutes with two prompts.', curriculum: 'Independent Work, Visual Matching', behaviorNotes: 'Low refusal.', moodScore: 12, mood: 12 },
    { id: 'child-005', name: 'Lakelynn Moore', age: '4', room: 'Yellow-1', parents: [{ id: 'par-003', name: 'Danielle Moore' }], assignedABA: ['aba-102'], session: 'AM', dropoffTimeISO: '2026-04-29T09:00:00', pickupTimeISO: '2026-04-29T12:00:00', notes: 'Sensory integration focus.', carePlan: 'Tolerate transitions with visual schedule.', monthlyGoal: 'Follow visual schedule across 4 transitions.', successCriteria: 'Completed 3 of 4 transitions.', curriculum: 'Visual Schedule, Sensory Breaks', behaviorNotes: 'Some crying during transition.', moodScore: 10, mood: 10 },
    { id: 'child-006', name: 'Eli Johnson', age: '5', room: 'Yellow-2', parents: [{ id: 'par-004', name: 'Eric Johnson' }], assignedABA: ['aba-101'], session: 'PM', dropoffTimeISO: '2026-04-29T13:00:00', pickupTimeISO: '2026-04-29T16:00:00', notes: 'Practicing imitation and play routines.', carePlan: 'Increase imitation accuracy.', monthlyGoal: 'Imitate 10 motor actions.', successCriteria: 'Imitated 7 of 10 actions.', curriculum: 'Motor Imitation, Play Skills', behaviorNotes: 'No major interfering behaviors.', moodScore: 11, mood: 11 },
    { id: 'child-007', name: 'Sofia Grant', age: '6', room: 'Red-1', parents: [{ id: 'par-005', name: 'Felicia Grant' }], assignedABA: ['aba-103'], session: 'AM', dropoffTimeISO: '2026-04-30T09:00:00', pickupTimeISO: '2026-04-30T12:00:00', notes: 'Transitions were smooth today.', carePlan: 'Maintain transition tolerance.', monthlyGoal: 'Transition with one prompt or less.', successCriteria: 'Met transition goal across session.', curriculum: 'Transitions, Social Greeting', behaviorNotes: 'Low interfering behavior.', moodScore: 15, mood: 15 },
    { id: 'child-008', name: 'Noah Ramirez', age: '4', room: 'Red-2', parents: [{ id: 'par-006', name: 'George Ramirez' }], assignedABA: ['aba-102'], session: 'PM', dropoffTimeISO: '2026-04-30T13:00:00', pickupTimeISO: '2026-04-30T16:00:00', notes: 'Needs extra supplies next session.', carePlan: 'Increase receptive language responses.', monthlyGoal: 'Respond to 8 receptive instructions.', successCriteria: 'Responded to 6 of 8 instructions.', curriculum: 'Receptive Language, Matching', behaviorNotes: 'Moderate task refusal.', moodScore: 8, mood: 8 },
    { id: 'child-009', name: 'Mila Ramirez', age: '5', room: 'Orange-1', parents: [{ id: 'par-006', name: 'George Ramirez' }], assignedABA: ['aba-101'], session: 'AM', dropoffTimeISO: '2026-05-01T09:00:00', pickupTimeISO: '2026-05-01T12:00:00', notes: 'Working on functional play.', carePlan: 'Increase reciprocal play.', monthlyGoal: 'Engage in turn-taking for 5 minutes.', successCriteria: 'Completed 4 minutes of turn-taking.', curriculum: 'Play Skills, Turn Taking', behaviorNotes: 'No major interfering behaviors.', moodScore: 12, mood: 12 },
    { id: 'child-010', name: 'Leo Ramirez', age: '3', room: 'Purple-1', parents: [{ id: 'par-006', name: 'George Ramirez' }], assignedABA: [], session: '', dropoffTimeISO: '', pickupTimeISO: '', notes: '', carePlan: '', monthlyGoal: '', successCriteria: '', curriculum: '', behaviorNotes: '', moodScore: null, mood: null },
  ],
  sessionSummaries: [
    { id: 'summary-001', sessionId: 'session-001', childId: 'child-001', therapistId: 'aba-101', status: 'approved', generatedAt: '2026-04-24T12:15:00', approvedAt: '2026-04-24T12:30:00', summary: { moodScore: { selectedValue: 14, selectedLabel: 'Happy' }, dailyRecap: { therapistNarrative: 'Zahari had a positive session and made moderate progress with transitions and functional communication.', progressLevel: 'moderate', independenceLevel: 'partial independence', interferingBehaviorLevel: 'low' }, monthlyGoal: { description: 'Use functional communication during transitions with fewer prompts.' }, successCriteriaMet: ['Used communication card in 4 of 5 opportunities', 'Transitioned with one verbal prompt'], programsWorkedOn: ['Functional Communication', 'Transitions', 'Visual Schedule'], interferingBehaviors: [{ behavior: 'Task refusal', frequency: 1, intensity: 'low' }], meals: [{ type: 'Snack', status: 'Ate most of snack' }], toileting: [{ status: 'Successful bathroom trip' }], pleaseBringIn: ['Extra shirt', 'Preferred snack'] } },
    { id: 'summary-002', sessionId: 'session-002', childId: 'child-002', therapistId: 'aba-101', status: 'approved', generatedAt: '2026-04-24T16:10:00', approvedAt: '2026-04-24T16:30:00', summary: { moodScore: { selectedValue: 13, selectedLabel: 'Positive' }, dailyRecap: { therapistNarrative: 'Aubrey completed communication targets and maintained strong engagement.', progressLevel: 'high', independenceLevel: 'mostly independent', interferingBehaviorLevel: 'none' }, monthlyGoal: { description: 'Increase spontaneous requests.' }, successCriteriaMet: ['Completed 5 of 6 communication trials'], programsWorkedOn: ['Mand Training', 'Peer Play'], interferingBehaviors: [], meals: [{ type: 'Lunch', status: 'Ate all lunch' }], toileting: [{ status: 'No toileting data logged' }], pleaseBringIn: [] } },
    { id: 'summary-003', sessionId: 'session-003', childId: 'child-003', therapistId: 'aba-102', status: 'draft', generatedAt: '2026-04-25T12:05:00', summary: { moodScore: { selectedValue: 9, selectedLabel: 'Neutral' }, dailyRecap: { therapistNarrative: 'Mason practiced peer interaction and group activities.', progressLevel: 'moderate', independenceLevel: 'prompted', interferingBehaviorLevel: 'moderate' }, monthlyGoal: { description: 'Participate in group activity for 10 minutes.' }, successCriteriaMet: ['Stayed in group for 8 minutes'], programsWorkedOn: ['Peer Play', 'Group Instruction'], interferingBehaviors: [{ behavior: 'Elopement attempt', frequency: 1, intensity: 'moderate' }], meals: [], toileting: [] } },
  ],
  moodScores: [
    { id: 'mood-001', childId: 'child-001', scores: [{ date: '2026-04-23', score: 11 }, { date: '2026-04-24', score: 12 }, { date: '2026-04-25', score: 13 }, { date: '2026-04-26', score: 14 }, { date: '2026-04-27', score: 14 }] },
    { id: 'mood-002', childId: 'child-002', scores: [{ date: '2026-04-23', score: 10 }, { date: '2026-04-24', score: 11 }, { date: '2026-04-25', score: 12 }, { date: '2026-04-26', score: 13 }, { date: '2026-04-27', score: 13 }] },
    { id: 'mood-003', childId: 'child-003', scores: [{ date: '2026-04-23', score: 7 }, { date: '2026-04-24', score: 8 }, { date: '2026-04-25', score: 9 }, { date: '2026-04-26', score: 9 }, { date: '2026-04-27', score: 10 }] },
  ],
  messageThreads: {
    parent: [
      { threadId: 'thread-parent-careteam-001', participants: ['par-001', 'aba-101'], messages: [{ from: 'par-001', text: 'How did Zahari do with transitions today?', time: '2026-04-24T15:05:00' }, { from: 'aba-101', text: 'He made moderate progress and used his communication card during transitions.', time: '2026-04-24T15:08:00' }] },
      { threadId: 'thread-parent-billing-001', participants: ['par-001', 'office-001'], messages: [{ from: 'par-001', text: 'Can you confirm our authorization is still active?', time: '2026-04-24T10:10:00' }, { from: 'office-001', text: 'Yes, Zahari has 48 authorized hours remaining.', time: '2026-04-24T10:18:00' }] },
    ],
    therapist: [
      { threadId: 'thread-therapist-bcba-001', participants: ['aba-101', 'bcba-001'], messages: [{ from: 'aba-101', text: 'Can you review Zahari\'s transition goal update?', time: '2026-04-24T12:40:00' }, { from: 'bcba-001', text: 'Yes, please send the session summary after approval.', time: '2026-04-24T12:45:00' }] },
    ],
    admin: [
      { threadId: 'thread-office-reception-001', participants: ['office-001', 'frontdesk-001'], messages: [{ from: 'frontdesk-001', text: 'Blue-2 pickup list is updated.', time: '2026-04-24T08:00:00' }, { from: 'office-001', text: 'Thanks, I will notify families if anything changes.', time: '2026-04-24T08:04:00' }] },
    ],
  },
  urgentMemos: [
    { id: 'memo-001', type: 'admin_memo', title: 'Room Change', message: 'Blue-2 will meet in Green-1 today.', priority: 'urgent', status: 'pending', time: '2026-04-24T07:30:00' },
    { id: 'memo-002', type: 'admin_memo', title: 'Health Reminder', message: 'Please send an extra change of clothes this week.', priority: 'normal', status: 'pending', time: '2026-04-25T07:30:00' },
    { id: 'memo-003', type: 'time_update', childId: 'child-001', updateType: 'pickup', proposedISO: '2026-04-27T12:45:00', note: 'Parent requested 15 minute late pickup.', status: 'pending', time: '2026-04-26T15:30:00' },
  ],
  timeChangeProposals: [
    { id: 'proposal-001', childId: 'child-001', type: 'pickup', proposedISO: '2026-04-27T12:45:00', note: 'Parent requested 15 minute late pickup.', proposerId: 'par-001', scope: 'temporary', status: 'pending', createdAt: '2026-04-26T15:30:00' },
    { id: 'proposal-002', childId: 'child-003', type: 'dropoff', proposedISO: '2026-04-28T09:30:00', note: 'Accepted test case.', proposerId: 'par-002', scope: 'temporary', status: 'accepted', createdAt: '2026-04-25T09:30:00' },
    { id: 'proposal-003', childId: 'child-004', type: 'pickup', proposedISO: '2026-04-28T16:30:00', note: 'Rejected test case.', proposerId: 'par-003', scope: 'temporary', status: 'rejected', createdAt: '2026-04-25T10:30:00' },
  ],
  progressReports: [
    { id: 'pr-001', childId: 'child-001', therapistId: 'aba-101', summary: 'Zahari made moderate progress with transitions and functional communication.', date: '2026-04-24' },
    { id: 'pr-002', childId: 'child-002', therapistId: 'aba-101', summary: 'Aubrey completed 5 of 6 communication trials.', date: '2026-04-24' },
    { id: 'pr-003', childId: 'child-003', therapistId: 'aba-102', summary: 'Mason practiced group play and responded well to redirection.', date: '2026-04-25' },
    { id: 'pr-004', childId: 'child-004', therapistId: 'aba-103', summary: 'Harper reduced prompting during table work.', date: '2026-04-26' },
    { id: 'pr-005', childId: 'child-007', therapistId: 'aba-103', summary: 'Sofia transitioned smoothly between activities.', date: '2026-04-27' },
  ],
  nextSessions: [
    { id: 'ns-001', childId: 'child-001', therapistId: 'aba-101', date: '2026-04-27', time: '09:15' },
    { id: 'ns-002', childId: 'child-002', therapistId: 'aba-101', date: '2026-04-27', time: '13:00' },
    { id: 'ns-003', childId: 'child-003', therapistId: 'aba-102', date: '2026-04-28', time: '09:00' },
    { id: 'ns-004', childId: 'child-005', therapistId: 'aba-102', date: '2026-04-29', time: '09:00' },
    { id: 'ns-005', childId: 'child-007', therapistId: 'aba-103', date: '2026-04-30', time: '09:00' },
    { id: 'ns-006', childId: 'child-009', therapistId: 'aba-101', date: '2026-05-01', time: '09:00' },
  ],
  invoices: [
    { id: 'invoice-001', childId: 'child-001', amountDue: 0, status: 'paid', description: 'April services' },
    { id: 'invoice-002', childId: 'child-002', amountDue: 45, status: 'open', description: 'Copay balance' },
    { id: 'invoice-003', childId: 'child-003', amountDue: 120, status: 'overdue', description: 'Prior balance' },
  ],
  exportJobs: [
    { id: 'export-001', title: 'Billing Export', category: 'billing', format: 'csv', status: 'completed', recordsCount: 10, artifactUrl: 'https://example.com/billing-export.csv', createdAt: '2026-04-24T09:00:00' },
    { id: 'export-002', title: 'Reports Export', category: 'reports', format: 'pdf', status: 'queued', recordsCount: 5, createdAt: '2026-04-24T09:15:00' },
  ],
  auditLogs: [
    { id: 'audit-001', action: 'billing.export.completed', summary: 'Billing export completed.', createdAt: '2026-04-24T09:10:00' },
    { id: 'audit-002', action: 'authorization.reviewed', summary: 'Authorization reviewed by BCBA.', createdAt: '2026-04-24T09:15:00' },
    { id: 'audit-003', action: 'schedule.updated', summary: 'Session schedule updated.', createdAt: '2026-04-24T09:20:00' },
  ],
  programDocuments: [
    { id: 'program-doc-001', programId: 'program-aba-001', title: 'Functional Communication Plan', url: 'https://example.com/functional-communication-plan.pdf', type: 'pdf' },
    { id: 'program-doc-002', programId: 'program-aba-001', title: 'Transition Support Plan', url: 'https://example.com/transition-support-plan.pdf', type: 'pdf' },
  ],
  campusDocuments: [
    { id: 'campus-doc-001', campusId: 'campus-main-001', title: 'Pickup Policy', url: 'https://example.com/pickup-policy.pdf', type: 'pdf' },
    { id: 'campus-doc-002', campusId: 'campus-main-001', title: 'Health Policy', url: 'https://example.com/health-policy.pdf', type: 'pdf' },
  ],
  parentResources: [
    { id: 'resource-001', title: 'What to Bring to Session', category: 'Getting Started', url: 'https://example.com/what-to-bring' },
    { id: 'resource-002', title: 'Understanding ABA Progress Notes', category: 'ABA Basics', url: 'https://example.com/aba-progress-notes' },
  ],
};

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

function normalizeIso(value, fallback) {
  const input = value || fallback;
  if (!input) return null;
  const date = new Date(String(input || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function buildAvatar(seed, supplied, size) {
  const value = String(supplied || '').trim();
  if (value) return value;
  return `https://i.pravatar.cc/${size}?u=${encodeURIComponent(String(seed || 'screenshot'))}`;
}

function normalizeRoleName(role, fallback) {
  const value = String(role || fallback || '').trim();
  return value || fallback || '';
}

const organization = raw.organization || {};
const firstProgram = (Array.isArray(raw.programs) ? raw.programs : [])[0] || {};
const firstCampus = (Array.isArray(raw.campuses) ? raw.campuses : [])[0] || {};
const usersRaw = Array.isArray(raw.users) ? raw.users : [];
const parentsRaw = Array.isArray(raw.parents) ? raw.parents : [];
const therapistsRaw = Array.isArray(raw.therapists) ? raw.therapists : [];
const childrenRaw = Array.isArray(raw.children) ? raw.children : [];
const progressReportsRaw = Array.isArray(raw.progressReports) ? raw.progressReports : [];
const nextSessionsRaw = Array.isArray(raw.nextSessions) ? raw.nextSessions : [];
const moodScoresRaw = Array.isArray(raw.moodScores) ? raw.moodScores : [];
const sessionSummariesRaw = Array.isArray(raw.sessionSummaries) ? raw.sessionSummaries : [];

const usersById = new Map(usersRaw.map((user) => [String(user?.id || ''), user]));

const seededScreenshotParents = parentsRaw.map((parent) => {
  const user = usersById.get(String(parent?.userId || '')) || null;
  const { firstName, lastName } = splitName(parent?.name || user?.name);
  return {
    id: String(parent?.id || parent?.userId || ''),
    userId: String(parent?.userId || ''),
    firstName,
    lastName,
    name: String(parent?.name || user?.name || '').trim(),
    role: 'parent',
    phone: String(parent?.phone || '').trim(),
    email: String(parent?.email || user?.email || '').trim(),
    avatar: buildAvatar(parent?.id || parent?.userId, parent?.avatar, 100),
    childIds: Array.isArray(parent?.childIds) ? parent.childIds.map((id) => String(id)) : [],
    organizationId: String(organization?.id || ''),
    programIds: firstProgram?.id ? [String(firstProgram.id)] : [],
    campusIds: firstCampus?.id ? [String(firstCampus.id)] : [],
  };
});

const seededScreenshotTherapists = therapistsRaw.map((therapist) => {
  const user = usersById.get(String(therapist?.userId || '')) || null;
  const { firstName, lastName } = splitName(therapist?.name || user?.name);
  return {
    id: String(therapist?.id || therapist?.userId || ''),
    userId: String(therapist?.userId || ''),
    firstName,
    lastName,
    name: String(therapist?.name || user?.name || '').trim(),
    role: normalizeRoleName(therapist?.role || user?.role, 'therapist'),
    title: String(therapist?.title || '').trim(),
    phone: String(therapist?.phone || '').trim(),
    email: String(therapist?.email || user?.email || '').trim(),
    avatar: buildAvatar(therapist?.id || therapist?.userId, therapist?.avatar, 80),
    supervisedBy: String(therapist?.supervisedBy || '').trim(),
    organizationId: String(organization?.id || ''),
    programIds: firstProgram?.id ? [String(firstProgram.id)] : [],
    campusIds: firstCampus?.id ? [String(firstCampus.id)] : [],
  };
});

const therapistIds = new Set(seededScreenshotTherapists.map((entry) => String(entry.id)));
const userIdsCoveredByTherapists = new Set(seededScreenshotTherapists.map((entry) => String(entry.userId || '')).filter(Boolean));
const extraStaffEntries = usersRaw
  .filter((user) => String(user?.role || '').trim().toLowerCase() !== 'parent')
  .filter((user) => !therapistIds.has(String(user?.id || '')) && !userIdsCoveredByTherapists.has(String(user?.id || '')))
  .map((user) => {
    const { firstName, lastName } = splitName(user?.name);
    return {
      id: String(user?.id || ''),
      userId: String(user?.id || ''),
      firstName,
      lastName,
      name: String(user?.name || '').trim(),
      role: normalizeRoleName(user?.role, 'staff'),
      title: '',
      phone: '',
      email: String(user?.email || '').trim(),
      avatar: buildAvatar(user?.id, '', 80),
      supervisedBy: '',
      organizationId: String(organization?.id || ''),
      programIds: firstProgram?.id ? [String(firstProgram.id)] : [],
      campusIds: firstCampus?.id ? [String(firstCampus.id)] : [],
    };
  });

const seededScreenshotStaff = [...seededScreenshotTherapists, ...extraStaffEntries];
const peopleById = new Map();
seededScreenshotParents.forEach((entry) => peopleById.set(String(entry.id), entry));
seededScreenshotStaff.forEach((entry) => peopleById.set(String(entry.id), entry));
extraStaffEntries.forEach((entry) => peopleById.set(String(entry.userId || ''), entry));

function toParticipant(id) {
  const key = String(id || '').trim();
  const entity = peopleById.get(key);
  if (entity) {
    return {
      id: entity.id,
      name: entity.name || `${entity.firstName || ''} ${entity.lastName || ''}`.trim(),
      email: entity.email || '',
      role: entity.role || '',
      avatar: entity.avatar || null,
    };
  }
  const user = usersById.get(key);
  if (user) {
    return {
      id: String(user.id || ''),
      name: String(user.name || '').trim(),
      email: String(user.email || '').trim(),
      role: normalizeRoleName(user.role, ''),
      avatar: buildAvatar(user.id, '', 80),
    };
  }
  return { id: key, name: key, email: '', role: '', avatar: null };
}

const latestProgressByChildId = new Map();
progressReportsRaw.forEach((report) => {
  const childId = String(report?.childId || '').trim();
  if (!childId) return;
  const current = latestProgressByChildId.get(childId);
  const currentTs = Date.parse(String(current?.date || ''));
  const reportTs = Date.parse(String(report?.date || ''));
  if (!current || (Number.isFinite(reportTs) && (!Number.isFinite(currentTs) || reportTs >= currentTs))) {
    latestProgressByChildId.set(childId, report);
  }
});

const latestMoodByChildId = new Map();
moodScoresRaw.forEach((entry) => {
  const childId = String(entry?.childId || '').trim();
  const scores = Array.isArray(entry?.scores) ? entry.scores : [];
  const latestScore = scores.reduce((best, score) => {
    const scoreTs = Date.parse(String(score?.date || ''));
    const bestTs = Date.parse(String(best?.date || ''));
    if (!best) return score;
    if (Number.isFinite(scoreTs) && (!Number.isFinite(bestTs) || scoreTs >= bestTs)) return score;
    return best;
  }, null);
  if (childId && latestScore) latestMoodByChildId.set(childId, latestScore);
});

const nextSessionByChildId = new Map();
nextSessionsRaw.forEach((session) => {
  const childId = String(session?.childId || '').trim();
  if (!childId) return;
  const iso = normalizeIso(`${session?.date || ''}T${session?.time || '00:00'}:00`, session?.date);
  const current = nextSessionByChildId.get(childId);
  const currentTs = Date.parse(String(current?.whenISO || ''));
  const sessionTs = Date.parse(String(iso || ''));
  if (!current || (Number.isFinite(sessionTs) && (!Number.isFinite(currentTs) || sessionTs <= currentTs))) {
    nextSessionByChildId.set(childId, {
      id: String(session?.id || `${childId}-session`),
      whenISO: iso,
      title: 'Next Session',
      therapistId: session?.therapistId ? String(session.therapistId) : '',
      time: session?.time || '',
      date: session?.date || '',
    });
  }
});

const sessionSummaryByChildId = new Map();
sessionSummariesRaw.forEach((item) => {
  const childId = String(item?.childId || '').trim();
  if (!childId) return;
  const existing = sessionSummaryByChildId.get(childId);
  const existingTs = Date.parse(String(existing?.generatedAt || existing?.approvedAt || ''));
  const itemTs = Date.parse(String(item?.generatedAt || item?.approvedAt || ''));
  if (!existing || (Number.isFinite(itemTs) && (!Number.isFinite(existingTs) || itemTs >= existingTs))) {
    sessionSummaryByChildId.set(childId, item);
  }
});

const seededScreenshotChildren = childrenRaw.map((child) => {
  const { firstName, lastName } = splitName(child?.name);
  const latestProgress = latestProgressByChildId.get(String(child?.id || ''));
  const latestMood = latestMoodByChildId.get(String(child?.id || ''));
  const nextSession = nextSessionByChildId.get(String(child?.id || ''));
  const latestSummary = sessionSummaryByChildId.get(String(child?.id || ''));
  const parents = (Array.isArray(child?.parents) ? child.parents : []).map((entry) => {
    const parent = peopleById.get(String(entry?.id || ''));
    if (!parent) {
      return {
        id: String(entry?.id || ''),
        name: String(entry?.name || '').trim(),
        avatar: buildAvatar(entry?.id || entry?.name, entry?.avatar, 100),
        phone: String(entry?.phone || '').trim(),
        email: String(entry?.email || '').trim(),
      };
    }
    return {
      id: parent.id,
      name: parent.name,
      firstName: parent.firstName,
      lastName: parent.lastName,
      avatar: parent.avatar,
      phone: parent.phone,
      email: parent.email,
    };
  });
  return {
    id: String(child?.id || ''),
    organizationId: String(organization?.id || ''),
    organizationName: String(organization?.name || ''),
    programId: String(firstProgram?.id || ''),
    programName: String(firstProgram?.name || ''),
    campusId: String(firstCampus?.id || ''),
    campusName: String(firstCampus?.name || ''),
    enrollmentCode: String(firstCampus?.enrollmentCode || ''),
    firstName,
    lastName,
    name: String(child?.name || '').trim(),
    age: String(child?.age || '').trim(),
    room: String(child?.room || '').trim(),
    avatar: buildAvatar(child?.id, child?.avatar, 120),
    parents,
    assignedABA: Array.isArray(child?.assignedABA) ? child.assignedABA.map((id) => String(id)) : [],
    session: String(child?.session || '').trim(),
    dropoffTimeISO: child?.dropoffTimeISO ? normalizeIso(child.dropoffTimeISO, child.dropoffTimeISO) : '',
    pickupTimeISO: child?.pickupTimeISO ? normalizeIso(child.pickupTimeISO, child.pickupTimeISO) : '',
    notes: String(child?.notes || latestProgress?.summary || latestSummary?.summary?.dailyRecap?.therapistNarrative || '').trim(),
    carePlan: String(child?.carePlan || latestProgress?.summary || '').trim(),
    goalProgress: String(latestProgress?.summary || '').trim(),
    monthlyGoal: String(child?.monthlyGoal || latestSummary?.summary?.monthlyGoal?.description || latestProgress?.summary || '').trim(),
    successCriteria: String(child?.successCriteria || '').trim(),
    successCriteriaMet: Array.isArray(latestSummary?.summary?.successCriteriaMet) ? latestSummary.summary.successCriteriaMet : [],
    curriculum: String(child?.curriculum || '').trim(),
    programCurriculum: String(child?.curriculum || '').trim(),
    programsWorkedOn: Array.isArray(latestSummary?.summary?.programsWorkedOn) ? latestSummary.summary.programsWorkedOn : [],
    behaviorNotes: String(child?.behaviorNotes || '').trim(),
    insurance: child?.insurance && typeof child.insurance === 'object' ? { ...child.insurance } : null,
    programDocs: Array.isArray(child?.programDocs) ? child.programDocs.map((doc) => ({ ...doc })) : [],
    moodScore: child?.moodScore != null ? Number(child.moodScore) : (latestMood?.score != null ? Number(latestMood.score) : null),
    mood: child?.mood != null ? Number(child.mood) : (latestMood?.score != null ? Number(latestMood.score) : null),
    nextSessionISO: nextSession?.whenISO || null,
    upcoming: nextSession ? [nextSession] : [],
  };
});

const seededScreenshotMessages = Object.values(raw?.messageThreads || {}).flatMap((threads) => {
  if (!Array.isArray(threads)) return [];
  return threads.flatMap((thread) => {
    const participants = Array.isArray(thread?.participants) ? thread.participants.map((id) => String(id)) : [];
    const messages = Array.isArray(thread?.messages) ? thread.messages : [];
    return messages.map((message, index) => {
      const senderId = String(message?.from || '').trim();
      return {
        id: `${thread?.threadId || 'thread'}-${index + 1}`,
        threadId: String(thread?.threadId || `thread-${index + 1}`),
        body: String(message?.text || '').trim(),
        sender: toParticipant(senderId),
        to: participants.filter((participantId) => participantId !== senderId).map((participantId) => toParticipant(participantId)),
        createdAt: normalizeIso(message?.time, new Date().toISOString()) || new Date().toISOString(),
      };
    });
  });
});

const seededScreenshotUrgentMemos = (Array.isArray(raw?.urgentMemos) ? raw.urgentMemos : []).map((memo, index) => ({
  id: String(memo?.id || `memo-${index + 1}`),
  type: String(memo?.type || 'admin_memo').trim(),
  title: String(memo?.title || memo?.subject || '').trim(),
  subject: String(memo?.title || memo?.subject || '').trim(),
  body: String(memo?.message || memo?.body || memo?.note || '').trim(),
  message: String(memo?.message || memo?.body || memo?.note || '').trim(),
  note: String(memo?.note || memo?.message || '').trim(),
  childId: String(memo?.childId || '').trim(),
  updateType: String(memo?.updateType || '').trim(),
  proposedISO: String(memo?.proposedISO || '').trim(),
  priority: String(memo?.priority || 'normal').trim(),
  recipients: [...seededScreenshotParents, ...seededScreenshotStaff].map((entry) => ({ id: entry.id, name: entry.name })),
  recipientIds: [...seededScreenshotParents, ...seededScreenshotStaff].map((entry) => entry.id),
  proposerId: memo?.type === 'time_update' ? 'par-001' : 'office-001',
  status: String(memo?.status || 'pending').trim(),
  time: normalizeIso(memo?.time, new Date().toISOString()) || new Date().toISOString(),
  createdAt: normalizeIso(memo?.time, new Date().toISOString()) || new Date().toISOString(),
}));

const seededScreenshotPosts = progressReportsRaw.map((report) => {
  const child = seededScreenshotChildren.find((entry) => entry.id === String(report?.childId || ''));
  const therapist = toParticipant(report?.therapistId);
  return {
    id: String(report?.id || `${report?.childId || 'child'}-progress`),
    title: child?.name ? `${child.name} Update` : 'Progress Update',
    body: String(report?.summary || '').trim(),
    author: therapist,
    createdAt: normalizeIso(`${report?.date || ''}T12:00:00`, report?.date) || new Date().toISOString(),
    likes: 0,
    shares: 0,
    comments: [],
  };
});

const seededScreenshotTimeChangeProposals = (Array.isArray(raw?.timeChangeProposals) ? raw.timeChangeProposals : []).map((proposal, index) => ({
  id: String(proposal?.id || `proposal-${index + 1}`),
  childId: String(proposal?.childId || '').trim(),
  type: String(proposal?.type || '').trim(),
  proposedISO: String(proposal?.proposedISO || '').trim(),
  note: String(proposal?.note || '').trim(),
  proposerId: String(proposal?.proposerId || '').trim(),
  scope: String(proposal?.scope || 'temporary').trim(),
  status: String(proposal?.status || 'pending').trim(),
  createdAt: normalizeIso(proposal?.createdAt, new Date().toISOString()) || new Date().toISOString(),
}));

const seededScreenshotSessionSummaries = sessionSummariesRaw
  .map((item, index) => ({
    id: String(item?.id || `summary-${index + 1}`),
    sessionId: String(item?.sessionId || `${item?.childId || 'child'}-session-${index + 1}`),
    childId: String(item?.childId || '').trim(),
    therapistId: String(item?.therapistId || '').trim(),
    status: String(item?.status || 'draft').trim(),
    generatedAt: normalizeIso(item?.generatedAt, item?.approvedAt || new Date().toISOString()) || new Date().toISOString(),
    approvedAt: normalizeIso(item?.approvedAt, item?.generatedAt || '') || '',
    updatedAt: normalizeIso(item?.approvedAt, item?.generatedAt || new Date().toISOString()) || new Date().toISOString(),
    summary: item?.summary && typeof item.summary === 'object' ? { ...item.summary } : {},
    summaryText: String(item?.summary?.dailyRecap?.therapistNarrative || '').trim(),
  }))
  .filter((item) => item.childId);

const seededScreenshotOrgSettings = {
  id: String(organization?.id || 'org-demo-001'),
  name: String(organization?.name || 'CommunityBridge Therapy Center'),
  billing: {
    paymentPortalUrl: 'https://example.com/payments/communitybridge-demo',
    contactEmail: 'billing@communitybridge.app',
    contactPhone: '(317) 555-6000',
    showContactEmail: true,
    showContactPhone: true,
  },
};

const seededScreenshotExportJobs = (Array.isArray(raw?.exportJobs) ? raw.exportJobs : []).map((job, index) => ({
  id: String(job?.id || `export-${index + 1}`),
  title: String(job?.title || 'Export Job').trim(),
  category: String(job?.category || 'reports').trim(),
  format: String(job?.format || 'csv').trim(),
  status: String(job?.status || 'queued').trim(),
  recordsCount: Number(job?.recordsCount || 0),
  artifactUrl: String(job?.artifactUrl || '').trim(),
  summary: String(job?.summary || '').trim(),
  createdAt: normalizeIso(job?.createdAt, new Date().toISOString()) || new Date().toISOString(),
}));

const seededScreenshotAuditLogs = (Array.isArray(raw?.auditLogs) ? raw.auditLogs : []).map((item, index) => ({
  id: String(item?.id || `audit-${index + 1}`),
  action: String(item?.action || 'audit.event').trim(),
  summary: String(item?.summary || '').trim(),
  createdAt: normalizeIso(item?.createdAt, new Date().toISOString()) || new Date().toISOString(),
}));

module.exports = {
  seededScreenshotParents,
  seededScreenshotTherapists: seededScreenshotStaff,
  seededScreenshotChildren,
  seededScreenshotMessages,
  seededScreenshotPosts,
  seededScreenshotUrgentMemos,
  seededScreenshotTimeChangeProposals,
  seededScreenshotSessionSummaries,
  seededScreenshotOrgSettings,
  seededScreenshotExportJobs,
  seededScreenshotAuditLogs,
};
