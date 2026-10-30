# iOS App Privacy details and privacy manifest: DRAFT

> **Status:** proposal for founder and legal review. Nothing here has been entered in App Store Connect,
> and `app.json` has **not** been changed. Prepared 2026-10-20 from the code at that date.
> Items marked **ASSUMPTION** depend on decisions that have not been made yet or on vendor terms nobody has confirmed.

## 1. What actually leaves the device (from the code)

| Flow | Code | Destination | What is sent | Retained? |
|---|---|---|---|---|
| Purchases and entitlement | `src/services/purchases.ts` (`Purchases.configure` with no `appUserID`, so the SDK makes an anonymous `$RCAnonymousID:…`) | RevenueCat (and Apple StoreKit) | Anonymous app user ID, store receipts and transactions, product IDs, plus the device/app metadata the SDK sends itself (locale, currency, app version, OS) | Yes. RevenueCat keeps a subscriber record. |
| AI quota / balance | `src/services/ai.ts` → `GET /v1/balance` with an `x-app-user-id` header | Promptly Worker (Cloudflare) → RevenueCat REST (`server/src/entitlements.ts`) | Anonymous RevenueCat ID | Yes. A Durable Object named `user:<id>` stores monthly counters (`m:YYYY-MM`), `lifetime_total` and a 10-minute entitlement cache (`server/src/index.ts`, `handler.ts`). **No TTL and no deletion path.** |
| AI Script Studio | `src/services/ai.ts` → `POST /v1/studio` | Promptly Worker → Anthropic API (`server/src/llm.ts`) | The text the user typed or pasted (`script`, `topic`, `keyPoints`, `audience`, up to 12,000 chars), tool, tone, platform, duration, language, the anonymous ID (header) and the IP (Cloudflare) | The Worker does not log the text (`handler.ts` logs only tool, plan, token counts and ms). **Anthropic keeps API inputs and outputs for up to 30 days by default** (see §6). The ID is **not** forwarded to Anthropic. |
| IP rate limit | `handler.ts`: `consume('ip:' + cf-connecting-ip, 'd:'+day)` | Cloudflare Durable Object | IP address, used as the object name | One Durable Object per IP, with day counters and no cleanup. Treat the IP as stored. |
| Speech recognition (Voice Follow and captions) | `src/services/speechEngine.ts`, `transcription.ts` | Apple Speech framework | Microphone audio, and the audio track of the recording for captions | Captions force `requiresOnDeviceRecognition: true`. Voice Follow passes `o.onDevice` and may use Apple's **server** recognizer when on-device recognition is not available. Apple's guidance: *"You are not responsible for disclosing data collected by Apple."* |
| Camera, mic, recordings, scripts, captions, settings | VisionCamera, `files.ts`, `db.ts` (SQLite) | Stay on the device | — | Not "collected" ("Data that is processed only on device is not 'collected'"). |
| Export / share | `src/app/export/[id].tsx` (`MediaLibrary.Asset.create`, `Sharing.shareAsync`) | Photos library / iOS share sheet, chosen by the user | — | Not collected by Promptly. |
| Analytics | `src/services/analytics.ts` | **No provider.** The sink logs to the console in `__DEV__` and does nothing in release. | — | Nothing today. See §4. |
| Crash reporting | none | — | — | None. |

No ads SDK, no IDFA, no `AppTrackingTransparency`, no location (location permissions are blocked on Android, and no iOS location key is set).

## 2. Proposed App Store Connect answers (v1, analytics provider NOT wired)

"Do you or your third-party partners collect data from this app?" → **Yes**

| Apple data type | Collected? | Linked to user? | Tracking? | Purposes | Basis and notes |
|---|---|---|---|---|---|
| **Purchases → Purchase History** | Yes | **Yes** (conservative), see note L | No | App Functionality, Analytics | RevenueCat says every RevenueCat app must declare Purchase History with at least App Functionality and Analytics (receipt validation and entitlements, plus dashboard charts). |
| **Identifiers → User ID** | Yes | **Yes** (conservative), see note L | No | App Functionality | The anonymous RevenueCat app user ID is an "assigned user ID". It is stored by RevenueCat and by the Promptly Worker (quota counters). |
| **Usage Data → Other Usage Data** | Yes | Yes | No | App Functionality | The Worker counts AI requests per user ID per month or lifetime. Optional to drop if legal judges counters to be "not usage data", but declaring is safer. |
| **User Content → Other User Content** | Yes, **only if the AI Studio ships enabled** (`flags.aiStudio`, server `AI_ENABLED`) | **No** | No | App Functionality | Free-form script text sent to Anthropic. Anthropic keeps it for up to 30 days, which is longer than "the time it takes … to service the request", so it counts as "collected". With a zero-data-retention agreement it could arguably be left out. **ASSUMPTION:** not linked, because the Worker does not store it and does not pass the ID to Anthropic. |
| Audio Data | **No** | — | — | — | Audio is recorded and transcribed on the device. Apple's own server recognition is Apple's to disclose. |
| Photos or Videos | **No** | — | — | — | Recordings never leave the device unless the user shares them through the system share sheet. |
| Coarse / Precise Location | **No** | — | — | — | The IP is used only for rate limiting, never to derive location. Apple: "Declare the relevant data types based on how you use IP address". **ASSUMPTION:** a counter keyed by IP for abuse prevention needs no location declaration. Legal should confirm. Optionally add it under User ID or Other Data with the purpose App Functionality. |
| Device ID | **No** | — | — | — | No IDFA or IDFV is sent by our code. RevenueCat's guidance requires Device ID only when IDFA or ad IDs are collected. |
| Diagnostics (Crash, Performance) | **No** (v1) | — | — | — | No crash SDK. Apple-collected crash logs are Apple's to disclose. |
| Contact Info, Health, Financial Info, Sensitive Info, Contacts, Browsing, Search History | No | — | — | — | — |

**Note L (Linked).** RevenueCat's guidance says apps that use only anonymous IDs may answer "No" for linked. Apple's page says *"'Personal Information' and 'Personal Data', as defined under relevant privacy laws, are considered linked to the user"*, and under GDPR a persistent online identifier counts as personal data. **Recommendation: answer Linked = Yes** for User ID, Purchase History and Other Usage Data. The App Store page would then read "Data Linked to You: Purchases, Identifiers, Usage Data". **Founder/legal decision.** Whatever is chosen, keep the label and the `NSPrivacyCollectedDataTypes` in §3 consistent with each other.

**Resulting label (recommended):**
- *Data Linked to You:* Purchases, Identifiers, Usage Data
- *Data Not Linked to You:* User Content (only when AI is enabled)
- *Data Used to Track You:* none

## 3. Privacy manifest (`PrivacyInfo.xcprivacy`)

### 3.1 Required-reason APIs found in the dependency tree

Bundled manifests found in `node_modules` (only these ship a `PrivacyInfo.xcprivacy`):

| Package | Category → reasons |
|---|---|
| react-native (React-Core, cxxreact, timing, boost, glog, RCT-Folly) | FileTimestamp C617.1; UserDefaults CA92.1; SystemBootTime 35F9.1 |
| expo-file-system | FileTimestamp 0A2A.1, 3B52.1; DiskSpace E174.1, 85F4.1 |
| expo-media-library | FileTimestamp 0A2A.1 |
| expo-application | FileTimestamp C617.1 |
| expo-constants, expo-localization, expo-system-ui | UserDefaults CA92.1 |
| RevenueCat iOS SDK (CocoaPods `RevenueCat`, pulled in by `PurchasesHybridCommon 19.12.0`; **not** in node_modules) | UserDefaults CA92.1; collected Purchase History (not linked, no tracking, App Functionality). Checked against `purchases-ios` **main** on GitHub, not the pinned tag. **Verify** the pinned version after `pod install`. |

**No** bundled manifest, but the code uses required-reason APIs (found by grepping the native sources):

| Package | API found | Proposed reason |
|---|---|---|
| react-native-vision-camera 5.2.3 | `FileManager.attributesOfItem` (`HybridFrameRecorder.swift:82`, file size of a recording in the app container) | FileTimestamp C617.1 |
| expo-video 58.0.12 | `UserDefaults.standard` (`VideoCacheManager.swift`), `attributesOfItem`, `.contentModificationDateKey` | UserDefaults CA92.1; FileTimestamp C617.1 |
| expo-sharing | `UserDefaults(suiteName: appGroupId)`, only on the share-into path, which Promptly does not configure | none needed while no app group is configured. Re-check if share-extension is enabled. |
| expo-modules-core | `attributesOfItem` (`PersistentFileLog.swift`) | FileTimestamp C617.1 |
| expo-sqlite (vendored `sqlite3.c`) | `stat`/`fstat` on the database in the app container | FileTimestamp C617.1 |
| expo-speech-recognition 58.0.0, react-native-purchases (JS bridge), nitro-modules, nitro-image, modules/promptly-media | none found | — |
| expo-dev-launcher / expo-dev-menu | many hits | dev-client only, not in release builds |

App code: `Paths.availableDiskSpace` (`src/services/files.ts`) blocks recording when space is low (E174.1). The `record.lowStorageSoon` string *"About {n} minutes of storage left"* shows disk space to the user as time of video (85F4.1). Both reasons are therefore accurate for Promptly.

### 3.2 How Expo SDK 58 / RN 0.88 handle it

- Expo's guide (`docs/pages/guides/apple-privacy.mdx` on expo/expo `main`) says: *"Apple does not correctly parse all the PrivacyInfo files included by static CocoaPods dependencies (such as Expo SDK packages…). You may need to include the required reasons … in … the configuration in the app.json"*. The config key is `expo.ios.privacyManifests`. Its type in `@expo/config-types` accepts `NSPrivacyAccessedAPITypes`, `NSPrivacyTracking`, `NSPrivacyTrackingDomains` and `NSPrivacyCollectedDataTypes`.
- React Native's `scripts/cocoapods/privacy_manifest_utils.rb` (`privacy_file_aggregation_enabled: true` by default) merges **only `NSPrivacyAccessedAPITypes`**, and only from pods that ship a `PrivacyInfo.xcprivacy` resource bundle, into the app-level file at `pod install`. It does **not** cover vision-camera, expo-video, expo-sqlite or expo-modules-core, which have no manifest. It never merges `NSPrivacyCollectedDataTypes`.
- So we should declare everything at app level and not rely on aggregation.

### 3.3 Proposed `ios.privacyManifests` block (paste under `expo.ios` in `app.json`; NOT applied)

```json
"privacyManifests": {
  "NSPrivacyTracking": false,
  "NSPrivacyTrackingDomains": [],
  "NSPrivacyAccessedAPITypes": [
    {
      "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp",
      "NSPrivacyAccessedAPITypeReasons": ["C617.1", "0A2A.1", "3B52.1"]
    },
    {
      "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
      "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]
    },
    {
      "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategorySystemBootTime",
      "NSPrivacyAccessedAPITypeReasons": ["35F9.1"]
    },
    {
      "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryDiskSpace",
      "NSPrivacyAccessedAPITypeReasons": ["E174.1", "85F4.1"]
    }
  ],
  "NSPrivacyCollectedDataTypes": [
    {
      "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypePurchaseHistory",
      "NSPrivacyCollectedDataTypeLinked": true,
      "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality",
        "NSPrivacyCollectedDataTypePurposeAnalytics"
      ]
    },
    {
      "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeUserID",
      "NSPrivacyCollectedDataTypeLinked": true,
      "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]
    },
    {
      "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherUsageData",
      "NSPrivacyCollectedDataTypeLinked": true,
      "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]
    },
    {
      "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherUserContent",
      "NSPrivacyCollectedDataTypeLinked": false,
      "NSPrivacyCollectedDataTypeTracking": false,
      "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]
    }
  ]
}
```

Notes on the block:
- `0A2A.1` ("third-party SDK wrapper", for SDKs only) and `3B52.1` (user-granted files) are copied from the Expo package manifests, as Expo's guide recommends. If Apple rejects SDK-only codes at app level, remove `0A2A.1`. `C617.1` alone covers Promptly's own container access.
- If Note L is decided as "not linked", flip the three `Linked` values to `false`.
- Drop the `OtherUserContent` entry if the AI Studio ships disabled.
- **Verify after prebuild:** `npx expo prebuild -p ios && cd ios && pod install`, then inspect `ios/Promptly/PrivacyInfo.xcprivacy` and check that RN aggregation merged instead of duplicating entries. Then upload to TestFlight: Apple emails within minutes if any reason is missing (Expo's recommended test).

## 4. When an analytics provider is chosen (blocking before any provider is wired)

- **Updated 2026-10-30:** `analyticsEnabled` now defaults to `false`, and the analytics service itself starts disabled and follows the setting through every change (hydrate, failed settings read, the toggle, Delete all), so it is **opt-in**. Earlier text for reference: the setting defaulted to `true`, which made it **opt-out**. Guideline 5.1.1(ii): *"Apps that collect user or usage data must secure user consent for the collection, even if such data is considered to be anonymous"*. Apple's "Product Improvement Programs" exemption from disclosure needs an explicit **opt-in** with two clear choices. Recommendation: default the toggle to off, or show an opt-in prompt, before turning on any sink.
- Expected new label rows: Usage Data → Product Interaction (Analytics), Diagnostics (if crash or performance data is sent), Identifiers → Device ID or User ID if the SDK assigns an install ID. Linked or not depends on whether events carry the RevenueCat ID (they should not). Add the SDK's own `PrivacyInfo.xcprivacy` and any `NSPrivacyTrackingDomains`.
- `recording_failed.code` / `voice_follow_failed.code` / `paywall_viewed.trigger` / `ai_request.tool` are free `string` fields. Restrict them to enums so no content can leak into analytics.

## 5. Other iOS privacy items

- Purpose strings are present for camera, microphone and speech recognition (`app.json`) and for photo add and photo read (expo-media-library plugin). Export uses `requestPermissionsAsync(true)`, which asks for add-only access. `photosPermission` (full read) may not be needed. Consider removing it to minimise permissions under 5.1.1(iii).
- No accounts → 5.1.1(v) account deletion **does not apply**. (Guideline text: *"If your app supports account creation, you must also offer account deletion within the app."*) The local "Delete all my data" exists (`src/app/settings/privacy.tsx`). It does not delete server-side data (Worker counters, RevenueCat subscriber). **Updated 2026-10-30:** it now also deletes the `exports/` cache, scratch files (including recognizer WAVs left in scratch), imported-backup copies and leftover take files (`wipeLocalFiles`), and reports a failure instead of a silent partial wipe. The privacy policy must say how users can request deletion of that data (5.1.1(i)).
- 5.1.2(i) now says: *"You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so."* The Studio shows only a passive caption (`studio.disclosure`) that names "Promptly's AI service", not Anthropic, and there is no consent step. **GAP.** See the checklist.

## 6. Verification log (2026-10-20)

| Source | URL | Result |
|---|---|---|
| Apple, App Privacy Details | https://developer.apple.com/app-store/app-privacy-details/ | Fetched. Quoted for the definition of "collect", optional disclosure, IP, on-device processing and free-form text. |
| Apple, Required reason API + reason codes | https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api (and the `…/nsprivacyaccessedapitypereasons` JSON) | Fetched through the doc JSON endpoint. All codes used above checked against it. |
| Apple, App Review Guidelines (Last Updated Oct 16, 2026) | https://developer.apple.com/app-store/review/guidelines/ | Fetched. 3.1.1, 3.1.2, 5.1.1, 5.1.2 quoted. |
| Expo, Privacy manifests guide | https://docs.expo.dev/guides/apple-privacy/ | **Blocked** (proxy 403). Read the source instead: https://raw.githubusercontent.com/expo/expo/main/docs/pages/guides/apple-privacy.mdx (main branch; not confirmed to be the SDK 58 version). |
| RevenueCat, Apple App Privacy | https://www.revenuecat.com/docs/platform-resources/apple-platform-resources/apple-app-privacy | **Blocked** for direct fetch. Content known only through web-search snippets: Purchase History required, App Functionality + Analytics, anonymous IDs may be "not linked", User ID needed if a custom app user ID is used. |
| RevenueCat iOS manifest | https://raw.githubusercontent.com/RevenueCat/purchases-ios/main/Sources/PrivacyInfo.xcprivacy | Fetched (main, not the pinned version). |
| Anthropic API retention | https://privacy.claude.com/en/articles/7996866 | Search snippet only: "automatically removes API inputs and outputs … within 30 days" unless zero data retention is agreed. A secondary source claims 7 days since Sept 2025; **not verified**. Confirm against the actual commercial terms. |
