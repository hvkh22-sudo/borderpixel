# Google Play Data safety: DRAFT answers

> **Status:** proposal for founder and legal review, prepared 2026-10-20 from the code at that date.
> Nothing has been entered in Play Console. The data flows are the same as in `app-privacy-ios.md` §1.
> Read that table first. Items marked **ASSUMPTION** need confirmation.

## 1. Key definitions used (Google)

- **Collected** means data transmitted off the device by the app or its SDKs. It does *not* need to be shown when it is "only stored in the server memory and retained for no longer than necessary to execute a specific request in real time" (ephemeral processing).
- **Shared** means a transfer to a third party. Transfers to a **service provider** that processes data on the developer's behalf are not "sharing". **ASSUMPTION (from memory of Google's help text; the page could not be fetched):** RevenueCat, Cloudflare and Anthropic qualify as service providers, provided the contracts or DPAs say so. Confirm each DPA.
- Data handled by **another app** (the Google speech recognizer service, `com.google.android.googlequicksearchbox` / `com.google.android.as`, configured in the `expo-speech-recognition` plugin) is processed by that app under Google's policy. Promptly itself transmits no audio. **ASSUMPTION:** this is not collection by Promptly. Note: Voice Follow passes `requiresOnDeviceRecognition: o.onDevice` (`src/services/speechEngine.ts`), so the Google service may use the network on some devices. The privacy policy already says this (item 3).

## 2. Top-level questions

| Question | Proposed answer | Basis |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | RevenueCat purchase history + anonymous ID; AI text; AI counters. |
| Is all of the user data collected by your app encrypted in transit? | **Yes**, provided `EXPO_PUBLIC_AI_BASE_URL` is `https://` (the Worker is HTTPS-only on `*.workers.dev` / custom domain) and RevenueCat uses HTTPS. | `src/services/config.ts`. **Fixed 2026-10-30:** `secureAiBaseUrl` (`src/services/config.ts`) accepts only `https://` (plain http only for a localhost / emulator dev server in development builds); any other URL disables the AI Studio instead of sending text unencrypted. |
| Do you provide a way for users to request that their data is deleted? | **Yes**, via the support email (manual deletion of the Worker counters for an ID, and a RevenueCat customer delete). | **GAP:** there is no procedure and no tooling yet. The local "Delete all my data" does not touch server data. Also the user would need to send their anonymous ID, but the ID is not shown anywhere in the app. Add "Copy support ID" in Settings › Help. |
| Account creation | **The app does not allow users to create an account.** So the account-deletion URL requirement does not apply. | No login anywhere. Purchases use an anonymous ID. |
| Independent security review (MASA) | No (optional). | — |
| Families / target audience | Not designed for children. Choose 13+ or 18+ in Target audience (privacy policy item 7 says "not directed to children under 13"). | Founder decision. |

## 3. Data types

| Category → type | Collected | Shared | Ephemeral? | Required / Optional | Purposes | Notes |
|---|---|---|---|---|---|---|
| **Financial info → Purchase history** | Yes | No (RevenueCat is a service provider) | No | Required (the SDK syncs for all users at launch) | App functionality, Analytics | RevenueCat's Data safety guidance: it collects purchase history, so you must declare it. Payment card data is handled by Google Play and is not ours to declare. |
| **Device or other IDs** | Yes | No | No | Required | App functionality, Fraud prevention, security & compliance | The anonymous RevenueCat app user ID, stored by RevenueCat and by the Worker (`user:<id>`). It is used for entitlements and AI quota, and as an abuse limit. A RevenueCat community thread reports Play flagging "Device or other IDs" after an SDK upgrade even though RevenueCat's own page lists only purchase history. Declaring it avoids that rejection. |
| **App activity → Other actions** (or "App interactions") | Yes | No | No | Optional (only when AI is used) | App functionality | Monthly or lifetime AI request counters per ID (`server/src/handler.ts`). |
| **App activity → Other user-generated content** | Yes, **if the AI Studio ships enabled** | No (Anthropic as service provider: **ASSUMPTION**, confirm under commercial terms or DPA) | **No**, because Anthropic keeps inputs for up to 30 days by default. Could change to "processed ephemerally" with a zero-retention agreement. | Optional | App functionality | Script, topic, key points and audience text sent through `/v1/studio`. |
| Location (approximate / precise) | No | — | — | — | — | The IP is used only as a rate-limit key (`ip:<addr>`), never to derive location. **ASSUMPTION**, confirm with legal. Location permissions are blocked in `app.json`. |
| Audio → Voice or sound recordings | No | — | — | — | — | On-device / OS recognizer (see §1). Recordings stay in app storage. |
| Photos and videos | No | — | — | — | — | The user exports through MediaStore or the share sheet. Nothing is uploaded. |
| Personal info (name, email, …) | No | — | — | — | — | No account. Support email is outside the app (mailto). |
| App info and performance (crash logs, diagnostics) | No (v1) | — | — | — | — | No crash SDK. Revisit when an analytics or crash provider is chosen. |
| Messages, Contacts, Calendar, Health, Files and docs, Web browsing | No | — | — | — | — | — |

**When an analytics provider is added:** declare App activity → App interactions (Analytics), probably Device or other IDs (an SDK install ID), and App info and performance if it reports crashes. The settings toggle defaults to **on** (`src/state/settings.ts:68`). Make it opt-in, or at minimum show a consent prompt where GDPR applies.

## 4. Permissions (Play policy review)

`app.json` → `android.permissions`: `CAMERA`, `RECORD_AUDIO`. Blocked: `ACCESS_*_LOCATION`, `READ_MEDIA_AUDIO/IMAGES/VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `SYSTEM_ALERT_WINDOW`.

- **Photo and Video Permissions policy** (enforced since 2025). `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` are kept only for apps with a core need for broad access; others must use the photo picker or remove the permissions from **all** version codes, testing tracks included. Promptly writes only through `MediaLibrary.Asset.create` (MediaStore insert, which needs no read permission on API 29+) and blocks all `READ_MEDIA_*`. So **no declaration should be needed**. The library manifests still merge `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` with `maxSdkVersion=32` (`node_modules/expo-media-library`, `expo-file-system`). These are not in scope of the photo/video policy, but they appear in the Play permissions list. **To verify:** run `npx expo prebuild -p android` and inspect the merged manifest (`app/build/intermediates/merged_manifests/release/…`) for any `READ_MEDIA_*`, `AD_ID` or `FOREGROUND_SERVICE_*`.
- `RECORD_AUDIO` / `CAMERA`: core functionality. The prominent in-context rationale already exists (requested when the camera opens; see `app-review-notes.md`).
- **AD_ID:** not requested by our code. Confirm that RevenueCat 10.15 / purchases-hybrid-common 19.12.0 does not merge `com.google.android.gms.permission.AD_ID`. If it does, answer the Advertising ID declaration accordingly, or remove it with `tools:node="remove"` through a config plugin.
- `<queries>` for the speech service packages come from the expo-speech-recognition plugin. They are fine because they are package-specific (no `QUERY_ALL_PACKAGES`).

## 5. Other Play declarations to fill

- **AI-Generated Content policy:** apps that generate content with AI *"must contain in-app user reporting or flagging features"* so users can report offensive output without leaving the app. **GAP:** `src/app/studio.tsx` has no report or flag control. A minimal option is a "Report this draft" action that sends tool + output (with consent) or opens mailto with the draft attached.
- **Subscriptions** (see checklist): the offer terms (duration, price, trial conversion, how to cancel) must be clear, and the app must explain how to manage or cancel. `Purchases.showManageSubscriptions()` is wired in `src/app/settings/subscription.tsx`.
- **Privacy policy URL** in Play Console and inside the app. The in-app link shows only when `EXPO_PUBLIC_PRIVACY_URL` is set.
- **Content rating questionnaire, Target audience, Ads (No ads), App access (no login → "All functionality available without special access").**
- **Financial features / Health / Government / News:** none.

## 6. Verification log (2026-10-20)

| Source | URL | Result |
|---|---|---|
| Play Console Help, Data safety form | https://support.google.com/googleplay/android-developer/answer/10787469 | **Blocked** (proxy 403). The definitions above come from SDK vendor pages that quote Google (AppsFlyer, Yandex AppMetrica, Unity) and from memory. **Re-check in Play Console.** |
| Play photo/video permissions | https://support.google.com/googleplay/android-developer/answer/14115180 | Blocked for direct fetch. Content taken from search snippets (broad-access-only rule, declaration-or-remove, enforcement Jan 22 2025, extension to May 28 2025). |
| Play subscriptions policy | https://support.google.com/googleplay/android-developer/answer/9900533 | Search snippet only: "clearly and accurately describe the terms of your offer, including the duration, pricing, and description of accessible content", explain how a trial converts and that users can cancel, disclose how to manage or cancel, and provide an easy online cancel method. |
| Play AI-generated content | https://support.google.com/googleplay/android-developer/answer/13985936 | Search snippet only (in-app reporting or flagging requirement, effective early 2024). |
| RevenueCat, Google Play Data Safety | https://www.revenuecat.com/docs/platform-resources/google-platform-resources/google-plays-data-safety | **Blocked**. Only search snippets: purchase history (Financial info) required. Community thread: https://community.revenuecat.com/sdks-51/data-safety-violation-after-upgrading-purchases-flutter-4962 |
| developer.android.com | — | Reachable but not needed. |
