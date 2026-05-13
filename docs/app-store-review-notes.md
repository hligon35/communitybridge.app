# App Store Review Notes

## Reviewer Account

Use a dedicated review account, not a personal account.

- Email: `appreview@communitybridge.app`
- Password: rotate to a temporary review-only password before submission
- Role: Parent
- Display name: `App Reviewer`
- Linked learners: `Boy Reviewer` and `Girl Reviewer`

Source references:

- Review account email is reserved in src/utils/authState.js
- Seed script currently provisions `appreview@communitybridge.app` in `scripts/seed-prod-auth-users.js`

Important:

- Do not leave a long-lived review password in source control.
- Update the password in App Store Connect after rotation.
- In review notes, state whether OTP / MFA is expected. This repo checklist already expects reviewer notes to mention OTP / 2FA expectations.

## Suggested Review Notes

Reviewer test account:

- Username: `appreview@communitybridge.app`
- Password: [temporary review password]

How to review the app:

- Sign in with the review account above.
- The review account is a parent-role account.
- The seeded parent experience should show two linked learners: `Boy Reviewer` and `Girl Reviewer`.
- After login, you can test announcements, chats, urgent memos, schedule views, billing/insurance views, and settings.
- To test messaging, open Chats, tap the add button, choose BCBA or Office / Admin, enter a message, and send.
- Push notifications are used only for operational messages such as chats, urgent memos, reminders, and schedule-related updates.
- Location access is used only for arrival detection / location-based program features, not for advertising or cross-app tracking.
- Background location is user-triggered and can be disabled by the user in the app/device settings.
- Account deletion is available in Settings.

If MFA / OTP is enabled for the review build, add:

- If prompted for OTP / MFA, use the code delivered to the review inbox configured for `appreview@communitybridge.app`.

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
- If a dev/reviewer role switcher is visible in production submission builds, that may create review confusion; disable it for submission if not intentionally part of the product.

## Recommended Next Steps Before Submission

1. Rotate the review account password and update App Store Connect with the temporary credential.
2. Confirm whether the submission build has EXPO_PUBLIC_ENABLE_DEV_SWITCHER set to 0.
3. Build a fresh iOS submission artifact and watch for any Apple privacy-manifest follow-up email after upload.
4. Double-check App Store Connect privacy questionnaire answers against the live feature set.
5. Paste the suggested review notes into the App Review Information field and adjust for the final OTP / MFA behavior.

## Expo / Native Config Observed In This Repo

Current Expo config and resolved native surface indicate:

- expo-notifications is enabled
- expo-location background location is enabled on iOS
- expo-file-system is present
- expo-secure-store is present
- expo-updates is present

These dependencies increase the chance that Apple will expect a correct PrivacyInfo.xcprivacy / aggregated privacy manifest path for the submitted iOS build.
