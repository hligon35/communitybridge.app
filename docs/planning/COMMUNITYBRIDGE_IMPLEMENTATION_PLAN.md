# CommunityBridge Implementation Plan

## Source Of Truth

This plan maps the attached CommunityBridge edits document onto the current BuddyBoard workspace and records what is already implemented versus what still needs follow-through.

## Completed In This Slice

- Added a document-aligned admin workspace split in `AdminControlsScreen` for:
  - Office Operations
  - Clinical Operations
- Promoted document-matching entry points already present in the app:
  - User Roles & Permissions
  - Scheduling
  - Export Center
  - Compliance & Alerts
  - Organization Settings
  - Broadcast Center
  - Data & Reports
  - Tap Tracker
  - Summary Review
  - Attendance
  - Programs & Goals
  - Communication Threads
- Updated `ManagePermissionsScreen` to present the permission matrix as grouped admin permissions:
  - Office
  - Clinical
  - Family
- Added office-managed password reset guidance inside user management so the admin permissions workflow matches the document’s reset-account expectations.

## Completed In This Follow-Up Slice

- Added a dedicated `ImportCenterScreen` route with:
  - JSON payload guidance
  - file selection
  - import execution via existing directory merge API
  - import-related audit activity preview
- Expanded `AdminAlertsScreen` into document-aligned tabs for:
  - urgent alerts
  - compliance review
  - audit activity
- Expanded `FacultyDirectoryScreen` into a staff roster with search, role filters, and caseload counts.
- Expanded `ProgramDirectoryScreen` into three BCBA-facing work modes:
  - Library
  - Student Programs
  - Editor
- Expanded `ScheduleCalendarScreen` with day, week, staff, and student scheduling views.
- Split `ReportsScreen` into:
  - Clinical Reports
  - Operational Reports
- Expanded `InsuranceBillingScreen` with authorization, session verification, and role-aware billing access messaging.

## Completed In This Persistence Slice

- Added persistent staff workspace APIs for:
  - credentials
  - availability
  - documents
- Expanded `FacultyDetailScreen` into a tabbed staff profile with persistent:
  - overview
  - credentials
  - caseload
  - availability
  - documents
- Persisted BCBA program editor drafts in `ProgramDirectoryScreen` using local storage keyed to organization and program context.
- Added Firestore-backed export job APIs and connected them to:
  - `ExportDataScreen`
  - `InsuranceBillingScreen`
- Added recent export-job history so export and billing workflows now share a persistent audit trail at the app level.

## Completed In This Finalization Slice

- Export Center now generates deliverable artifacts, uploads them, stores artifact metadata, and exposes recent job download links.
- Billing workflow now surfaces completed and failed export status directly from the shared job history.
- Program editor now saves to both local draft storage and shared Firestore-backed program workspaces for cross-session continuity.
- Compliance status now propagates into the staff roster and alert center from persistent staff workspace records.
- Firestore rules and composite index configuration were added for:
  - `staffWorkspaces`
  - `exportJobs`
  - `programEditorWorkspaces`

## Completed In The Current Product State

- Added canonical role handling for:
  - Parent
  - Faculty
  - Therapist / ABA Tech
  - BCBA
  - Office
  - Reception
  - Admin / Campus Admin / Org Admin / Super Admin
- Removed Google sign-in from the login flow and related client or server wiring.
- Added managed-access auth flows for:
  - invite login
  - approval-link login
  - first-login password completion
- Updated parent billing access so parent users now see:
  - a digital insurance card for the linked child
  - a billing action
  - a contact action
- Updated scheduling workflows so authorized roles can:
  - add sessions
  - assign ABA techs
  - save learner schedule changes through the API
- Updated reporting workflows so authorized users can:
  - filter child reports individually
  - filter by room
  - view collective reporting
- Split operational access more clearly between BCBA, office, and reception permissions in the admin workspace.

## Already Implemented Before This Slice

- Dedicated therapist workflow screens:
  - Tap Tracker
  - Summary Review
  - Reports
- Shared therapy session workspace and reporting engine.
- Tablet navigation shell and iPad support flag.
- Parent reports entry point from `MyChildScreen`.
- Admin alerts, memos, privacy defaults, chat monitor, and export screen routes.

## Remaining Work

### Mobile role access redesign

- Phone-specific role and data policy is approved in `docs/planning/MOBILE_ROLE_ACCESS_POLICY.md` and is the source of truth for Step 2 and Step 3.
- Keep communications available on phone for all roles while moving non-parent staff and admin phone access to masked, aggregate-first views.
- Implement ABA phone as a caseload workspace, BCBA phone as masked summaries plus dashboards and insights, and office or admin phone as strictly aggregate and queue based.
- Limit staff phone scheduling to the signed-in user's own scheduled sessions and work schedule.
- Keep ABA tap and session tools tablet-only.
- Use the approved policy as the gate for route blocking, phone dashboard design, and field-level masking work.

#### Current phone status

- Parent: implemented for dashboard, chats, My Child, care team, schedule, billing summary, and parent-safe reports.
- Therapist / ABA: implemented for dashboard, chats, items needed, assigned-schedule view, and phone-safe reports. Tap Tracker, Tap Logs, Session Report, and full child detail remain tablet-only or blocked.
- BCBA: implemented for masked dashboard access, chats, phone-safe reports, phone-safe schedule, documentation dashboard, insights, and compliance.
- Office: implemented for aggregate dashboard access, chats, student summary, staff summary, family summary, queue-oriented reports, aggregate schedule, and compliance.
- Reception: implemented for aggregate dashboard access, chats, student summary, staff summary, family summary, and aggregate schedule. Reception still stays narrower than office and admin on phone.
- Admin: implemented for aggregate dashboard access, chats, student summary, staff summary, family summary, queue-oriented reports, aggregate schedule, insights, and compliance.

#### Remaining mobile follow-through

- Disallowed phone routes currently rely on `ScreenWrapper` fallback messaging rather than dedicated mobile-safe replacements where no phone module exists yet.
- Field-level masking is covered in the dedicated phone-safe reports and schedule views, but future allowed phone modules should continue moving from route blocking to explicit masked view-models.
- Continue validating real-device role switching and entry flows so phone users always land on an allowed root workspace after role changes.
- Remaining blocked-by-design phone routes are still `ParentDetail`, `ChildDetail`, `FacultyDetail`, `InsuranceBilling` detail views for staff or admin, `TapTracker`, `TapLogs`, `SummaryReview`, `AdminChatMonitor`, `AdminSettings`, `ProgramDirectory`, `ImportCenter`, `ExportData`, `CampusDirectory`, `ProgramDocuments`, and `CampusDocuments`.

### Admin redesign follow-through

- Expand admin hub cards into deeper destination screens for:
  - Staff roster and profile tabs
  - Compliance credential tracker
  - Billing and authorizations
  - Import center with import history and validation receipts
- Add route-level badges or summaries for pending compliance, expiring credentials, and export jobs.

### Therapist and BCBA path changes

- Continue refining therapist-facing launcher language and card order where product copy still lags the role terminology.
- Expand BCBA-specific program/goals editing depth beyond the currently restored program and reporting surfaces.
- Extend scheduling views further where additional staff, learner, and room-specific operational detail is still needed.

### Import/export engine

- Extend import beyond raw directory merge to:
  - validation summary
  - duplicate detection
  - import receipt/audit trail

### Reset password experience

- Restyle the login-side forgot-password surface to match the office-managed recovery language used in admin tools.
- Add clearer handoff between self-service reset and office-assisted reset.

### Reporting and operational modules

- Continue deepening BCBA clinical reports versus office operational reporting detail now that the split exists in the UI.
- Expand billing/authorization and compliance dashboards beyond the current surfaced workflows where additional operational summaries are needed.

## Guardrails

- Preserve dev/demo/reviewer access and the existing dev role switcher behavior.
- Reuse current routes and screens where possible instead of creating duplicate admin flows.
- Keep new behavior compatible with tablet navigation and current Expo native config.
