# Mobile Role Access Policy

## Purpose

This document defines the phone-specific access policy for CommunityBridge before any phone UI restructuring work begins.

It is the approval artifact for:

- Step 1: mobile role and data policy
- Step 2: phone navigation and screen restructuring
- Step 3: masked mobile view-models and field enforcement

This policy assumes:

- communications must remain available on mobile for all roles
- parent mobile remains a first-class product path
- admin, ABA, BCBA, and office phone access must not expose sensitive child or family data outside a work setting

## Product Direction

Phone access for staff and admin roles is not a reduced version of the desktop app. It is a separate restricted workspace built around:

- overview
- trends
- insights
- work queues
- communication
- program and documentation status

Phone access for parents remains a family-facing operational experience built around:

- child updates
- progress
- schedule
- billing visibility
- communication

## Mobile Safety Rules

### Rule 1: Aggregate first

For non-parent staff roles on phone, default to:

- counts
- trends
- statuses
- due dates
- queues
- summaries
- masked learner references

Do not default to full record views.

### Rule 2: Communications is the universal exception

The following stay available on phone for all roles:

- chat inbox
- thread view
- compose/new thread
- unread counts
- notification-driven deep links into a thread

Communications must still respect mobile field masking. Chat cannot become a backdoor into restricted records.

### Rule 3: Sensitive detail is desktop or tablet only for staff and admin phone paths

The following are blocked on phone for admin, ABA, BCBA, office, and reception:

- parent phone numbers
- parent home addresses
- child home addresses
- insurance member IDs
- subscriber IDs
- claims and payment detail
- billing balances and payment history detail
- full audit payloads
- unrestricted directory detail
- pickup identity verification detail
- full document payloads containing protected details

### Rule 4: If a field is ambiguous, block it until explicitly approved

Any field not clearly categorized below is treated as blocked for staff and admin phone access.

## Mobile Sensitivity Levels

### Mobile-safe

Allowed for relevant roles on phone:

- unread communication count
- message thread list
- participant display name
- participant avatar
- session counts
- attendance counts and trend lines
- documentation completion counts
- overdue note counts
- credential expiration status
- program status summaries
- caseload counts
- campus and program rollups
- behavior trend summaries without narrative PHI
- export job status summaries
- compliance alert counts
- operational alerts
- assigned room or campus label
- session block such as AM or PM
- assigned staff title or name when work-related

### Mobile-limited

Allowed only in masked or scoped form:

- learner display name as first name plus last initial, or internal alias
- learner roster within the signed-in user's own caseload or assigned scope
- due dates for documentation, review, authorizations, or credentials
- learner status labels such as active, paused, submitted, approved
- program names and mastery summaries
- behavior categories and counts
- attendance status
- schedule status
- assigned staff references

### Desktop-only sensitive

Blocked on non-parent phone paths:

- direct contact data
- address data
- insurance policy and member detail
- billing and payment detail
- pickup verification detail
- unrestricted learner and family profile detail
- open-ended clinical narrative when it includes sensitive detail beyond operational summary
- raw audit entries with protected metadata
- full documents or forms unless a mobile-safe summary is explicitly created

## Role Intents On Phone

### Parent

Primary mobile job:

- family coordination and child visibility

Allowed modules:

- Dashboard
- Chats
- My Child
- Schedule
- Billing and insurance summary
- Progress and reports appropriate for guardians
- Resources and care-team summaries

### Therapist / ABA

Primary mobile job:

- caseload overview and work execution without sensitive family detail

Allowed modules:

- Dashboard
- Chats
- My Caseload Overview
- Documentation Status
- Program Progress
- Schedule Overview
- Trends and insights
- Items Needed

Blocked modules:

- full child profile detail
- parent directory
- billing detail
- insurance detail
- pickup verification

### BCBA

Primary mobile job:

- clinical oversight and approvals without unrestricted learner or family records

Allowed modules:

- Dashboard
- Chats
- Documentation Dashboard
- Organization or campus insights
- Program and goal oversight
- Schedule Overview
- Clinical trends
- Compliance summary

Blocked modules:

- full parent contacts
- insurance detail
- payment detail
- unrestricted directory detail outside a masked clinical summary

### Office

Primary mobile job:

- operations monitoring and communication

Allowed modules:

- Dashboard
- Chats
- Scheduling Overview
- Attendance Overview
- Export and job status summary
- Compliance summary
- Credential tracker summary
- Organization alerts

Blocked modules:

- full child and parent profile detail on phone
- billing detail beyond queue status and counts
- insurance member detail
- unrestricted directory detail

### Reception

Primary mobile job:

- communication and front-desk overview only

Allowed modules:

- Chats
- Attendance overview
- Scheduling overview
- high-level alerts

Blocked modules:

- reports
- compliance detail
- billing and insurance detail
- directory detail beyond roster-safe summary

### Admin / Campus Admin / Org Admin / Super Admin

Primary mobile job:

- executive and operational oversight

Allowed modules:

- Dashboard
- Chats
- Reports and insights summary
- Compliance summary
- Credential tracker summary
- Staffing and attendance overview
- Program and campus trends
- export and import job summary

Blocked modules:

- direct child or parent contact details
- home addresses
- insurance and billing detail
- unrestricted learner profile views
- full audit payload detail on phone

## Module-Level Phone Policy

This section maps the current product surfaces to the intended phone policy.

| Surface | Parent | ABA | BCBA | Office | Admin | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Chats | allow | allow | allow | allow | allow | Universal mobile-safe exception with field masking |
| Dashboard | allow | allow | allow | allow | allow | Role-specific dashboard content only |
| My Child | allow | block | block | block | block | Parent-first module |
| Student Directory | block | masked subset later | masked subset later | block | block | Replace with caseload or roster-safe summary on phone |
| Parent Directory | block | block | block | block | block | Desktop or tablet only |
| Faculty Directory | block | scoped summary | scoped summary | scoped summary | scoped summary | Phone version should be roster-safe only |
| Schedule | allow | allow | allow | allow | allow | Phone-safe if sensitive fields are masked |
| Reports | guardian-safe only | allow masked | allow masked | operational only | operational plus aggregate | No unrestricted detailed records on staff phone |
| Insurance Billing | allow family-safe version | block | block | queue summary only | queue summary only | Staff and admin phone path cannot expose billing detail |
| Compliance | block | summary only | summary only | summary only | summary only | Counts, due dates, status, no raw payloads |
| Export Center | block | block | summary only | summary only | summary only | Queue and job status only on phone |
| Import Center | block | block | block | summary only | summary only | Job status only, no raw payload review |
| Programs and Goals | child-facing summary | allow masked | allow masked | block | summary only | Phone-safe version must avoid unrestricted child record detail |
| Tap Tracker / Session Tools | block | allow only if explicitly approved later | allow scoped | block | block | Separate decision after policy approval |

## Current Repo Implications

These current surfaces are the main inputs for Steps 2 and 3:

- `src/components/BottomNav.js`
- `src/components/TabletNavigationShell.js`
- `App.js`
- `src/screens/RoleDashboardScreen.js`
- `src/screens/ReportsScreen.js`
- `src/screens/InsuranceBillingScreen.js`
- `src/screens/StudentDirectoryScreen.js`
- `src/screens/ParentDirectoryScreen.js`
- `src/screens/AdminAlertsScreen.js`
- `src/features/sessionInsights/screens/TherapistDocumentationDashboardScreen.js`
- `src/features/sessionInsights/screens/OrganizationInsightsDashboardScreen.js`

## Field-Level Policy For Step 3

Step 3 should enforce a field matrix, not just route blocking.

### Always allowed in communications

- display name
- avatar
- role label
- message body
- timestamp
- thread unread state

### Always blocked in communications on non-parent phone paths

- phone number
- address
- insurance fields
- billing fields
- direct links into restricted detail screens

### Always blocked on non-parent phone paths

- `phone`
- `address`
- `memberId`
- `subscriberId`
- `groupNumber`
- `groupId`
- `billingContact`
- `amountDue`
- `paymentHistory`
- `authorizedPickup`
- `pickupPerson` when identity verification detail is involved
- unrestricted `programDocs`
- unrestricted audit log metadata

### Preferred masked replacements

- learner display name -> first name plus last initial
- family details -> guardian role label only
- insurance detail -> authorization risk badge only
- billing detail -> export or billing queue status only
- address detail -> campus or room only

## Approval Questions Before Step 2

The following should be approved before UI work starts:

- Should ABA phone users see masked learner lists, or only aggregate caseload cards?
- Should BCBA phone users be able to open a masked learner detail summary, or only dashboards and trends?
- Should office phone users see any learner list at all, or only operational queues?
- Should admin phone users ever see named learner rows, even if masked?
- Should schedule on phone show learner names for staff roles, or only room plus session plus assigned staff?
- Should parent phone retain billing detail exactly as-is, or move to a simpler family-safe summary?
- Should tap and session tools remain available on phone for ABA, or move to tablet-only later?

## Approved Decisions

The following decisions are approved for implementation:

- ABA phone should use a caseload view rather than aggregate-only cards.
- BCBA phone should include all three of these surfaces: masked learner summaries, dashboards, and insights or trends.
- Office and admin phone access should stay strictly aggregate and queue based, with no named learner detail lists.
- Staff phone schedule should show only the signed-in user's scheduled sessions and work schedule.
- Tap and session tools should move to tablet-only for ABA phone use.

## Recommended Default Decisions

If no separate product decision is made, use these defaults:

- ABA phone: signed-in caseload view allowed
- BCBA phone: masked learner summary plus dashboards and insights allowed
- office phone: no learner detail list, only queues and counts
- admin phone: no learner detail list, only aggregate and exception views
- schedule phone: show only the signed-in staff user's own scheduled sessions and work schedule
- parent billing: keep available, but simplify presentation where possible
- tap and session tools: tablet-only

## Deliverables For Step 2 And Step 3

### Step 2 should produce

- a phone-only navigation model for non-parent staff roles
- blocked-route redirects for restricted screens
- mobile-safe dashboard entry points per role
- communication preserved as a primary tab for every role

### Step 3 should produce

- role-aware mobile-safe selectors or mappers
- masked entity view-models
- field-level stripping for restricted roles on phone
- regression checks so restricted fields cannot leak through reused components

## Sign-Off

Step 1 is approved. Step 2 and Step 3 should implement the decisions above without reopening the policy unless a new role or data exception is introduced.
