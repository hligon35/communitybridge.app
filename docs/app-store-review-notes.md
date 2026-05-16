# App Store Review Notes

## Reviewer Account

Use a dedicated review account, not a personal account.

- Email: `appreview@communitybridge.app`
- Password: rotate to a temporary review-only password before submission
- Role access: parent, caregiver/staff therapist, BCBA, office, and admin via the in-app review switcher
- Display name: `App Reviewer`
- Linked learners: `Boy Reviewer` and `Girl Reviewer`

Source references:

- Review account email is reserved in src/utils/authState.js
- Seed script currently provisions `appreview@communitybridge.app` in `scripts/seed-prod-auth-users.js`

Important:

- Do not leave a long-lived review password in source control.
- Update the password in App Store Connect after rotation.
- The dedicated review account is exempt from OTP / MFA prompts in the review build.

## Suggested Review Notes

Reviewer test account:

- Username: `appreview@communitybridge.app`
- Password: [temporary review password]

How to review the app:

- Sign in with the review account above.
- After login, the seeded parent experience should show two linked learners: `Boy Reviewer` and `Girl Reviewer`.
- A floating `DEMO` / role button appears in the lower-right corner for the dedicated review account only.
- Tap that button to open App Review Demo Mode, then switch between Parent, Therapist / Staff, BCBA, Office, and Admin workspaces.
- Use `Demo View` first if you want to reload the local seeded walkthrough data.
- Parent / caregiver review path: announcements, chats, urgent memos, learner schedule, billing/insurance views, and settings.
- Therapist / staff review path: assigned learner schedule, session workflow, staff activity, chats, memos, and documentation surfaces.
- BCBA / office / admin review path: care-team management, staff management, directory, scheduling, controls, and operational dashboards.
- To test messaging, open Chats in any role, tap the add button, choose the destination role/contact, enter a message, and send.
- No OTP / MFA step is required for the dedicated review account.
- Push notifications are used only for operational messages such as chats, urgent memos, reminders, and schedule-related updates.
- Location access is used only for arrival detection / location-based program features, not for advertising or cross-app tracking.
- Background location is user-triggered and can be disabled by the user in the app/device settings.
- Account deletion is available in Settings.

## Current Review Risk Assessment

## Likely Strengths

- Public privacy page exists.
- Public terms page exists.
- Account deletion flow exists.
- iOS usage-description strings are present for Face ID, location, camera, and photo library.
- Reviewer/test-account guidance is already implied in the repo checklist.

## Highest Risk / Likely Rejection Trigger

- iOS privacy manifest support is now configured in `app.json`.
- `expo-build-properties` is enabled with `privacyManifestAggregationEnabled`, and app-level `privacyManifests` reasons are declared for the native API categories currently surfaced by installed Expo / React Native packages.
- This still needs one real iOS build and Apple submission check because Apple is the final parser and may still report additional required reasons.

## Additional Review Risks

- Background location must be justified clearly in App Store Connect review notes.
- App Store Connect privacy answers must match actual behavior for notifications, location, uploaded media, and account data.
- The review account password should be rotated out of source before submission.
- The review switcher must stay enabled in the submitted review build, but it should remain gated to the dedicated review account so normal users never see it.

## Recommended Next Steps Before Submission

1. Rotate the review account password and update App Store Connect with the temporary credential.
2. Confirm the submission build has `EXPO_PUBLIC_ENABLE_DEV_SWITCHER=1` so the review account can open all role workspaces.
3. Build a fresh iOS submission artifact and watch for any Apple privacy-manifest follow-up email after upload.
4. Double-check App Store Connect privacy questionnaire answers against the live feature set.
5. Paste the suggested review notes into the App Review Information field.

## Expo / Native Config Observed In This Repo

Current Expo config and resolved native surface indicate:

- expo-notifications is enabled
- expo-location background location is enabled on iOS
- expo-file-system is present
- expo-secure-store is present
- expo-updates is present

These dependencies increase the chance that Apple will expect a correct PrivacyInfo.xcprivacy / aggregated privacy manifest path for the submitted iOS build.
