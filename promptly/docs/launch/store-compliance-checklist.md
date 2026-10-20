# Store compliance checklist (iOS + Android): DRAFT

> Prepared 2026-10-20 from the code at that date. **DONE** means it is present in code or docs and was
> checked by reading them, *not* tested on a device. **GAP** means work is needed before submission.
> **DECISION** means a founder or legal call is needed. **VERIFY** means it is probably fine but must be checked on
> a real build. Store submission itself needs founder approval (CLAUDE.md).
> Companion docs: `app-privacy-ios.md`, `data-safety-android.md`.

## A. Paywall review: `src/app/paywall.tsx` + `src/localization/en.ts` (`paywall.*`)

Requirements checked against these:
- Apple Guideline 3.1.2(c): describe what the user gets for the price, and meet Schedule 2 of the DPLA.
- Apple "Auto-renewable subscriptions" page: the sign-up screen must show the subscription name and duration, what it provides, the **full renewal price clearly and prominently**, and restore. App and metadata must link to Terms of Use and Privacy Policy. The **billed amount must be the most prominent price element**. For a trial, state its length and the price billed after it.
- Google Play subscriptions policy: clear offer terms (duration, price, content), how a trial converts and that users can cancel, and how to manage or cancel.

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| A1 | Price per period shown for each plan | **DONE** | `paywall.perYear` "{price}/year", `paywall.perMonth` "{price}/month", `paywall.once` "{price} once", all from the store's `priceString` (localized). The billed amount is the only price shown, so it is the most prominent. |
| A2 | Subscription name and duration | **DONE (weak)** | Labels are "Yearly" / "Monthly" under the title "Promptly Pro". Suggest "Pro Yearly: {price}/year, auto-renews" so name, duration and renewal sit together in each option. |
| A3 | What the user gets for the price, accurate per plan | **GAP** | The benefits list is static for every plan. `benefit3` "150 AI script requests every month" is wrong when **Lifetime** is selected (Lifetime gets 300 one-time credits, `LIMITS.lifetimeAiCreditGrant`). It is also provisional (pricing-model.md: "allowance depends on the model decision"). `benefit4` "Advanced display and recording options" is vague. Name them (for example "4K recording", "script folders"), matching the `Feature` gates in `entitlements.ts`. Voice Follow on Android is behind a feature flag. Don't advertise "Unlimited Voice Follow" on a device where `support.voiceFollow()` is unsupported. |
| A4 | Auto-renew and cancellation terms | **DONE (partial)** | `paywall.legal`: "renew automatically until cancelled. Cancel anytime … at least 24 hours before renewal." **Missing:** that payment is charged to the Apple ID / Google account at confirmation of purchase, that the account is charged for renewal within 24 h before the period ends, and the renewal price. The text should be platform-specific ("Apple ID account settings" / "Google Play › Subscriptions"). The text also shows when only Lifetime is offered. Hide or adapt it then. |
| A5 | Free trial / intro offer terms | **GAP (conditional)** | The paywall ignores `product.introPrice` / `subscriptionOptions` (RevenueCat). If any trial or intro offer is set up in App Store Connect or Play (pricing-model open question 2), the paywall must show its length, the price after the trial, the date the charge happens, and that the user can cancel before it. The CTA should change from "Continue". **Until then: do not configure any intro offer in either store.** |
| A6 | CTA clarity | **DECISION** | The button is "Continue" (`paywall.subscribe`) for all plans. Apple and Google both police "misleading" purchase buttons. Suggest "Subscribe" / "Buy Lifetime" based on `selected`. |
| A7 | Restore purchases | **DONE** | "Restore purchases" button → `restore()` (`src/services/purchases.ts`). Feedback messages exist. |
| A8 | Terms of Use (EULA) and Privacy Policy links on the paywall | **GAP** | The links render **only if** `EXPO_PUBLIC_TERMS_URL` / `EXPO_PUBLIC_PRIVACY_URL` are set (`paywall.tsx` footer). `.env.example` leaves them empty and `eas.json` production sets neither. A production build could ship with no links, which is a common 3.1.2 rejection. Fix: fail the production build when they are empty, or fall back to hard-coded URLs. A Terms page does not exist yet. Either use Apple's standard EULA (and link it), or write custom terms (legal). |
| A9 | Close / dismiss | **DONE** | Close `IconButton` at the top. No forced paywall. |
| A10 | Avoid overlapping purchases (3.1.2(b)) | **DONE** | `paywallPlan()` hides subscriptions for subscribers and shows `cancelSubAfterLifetime` before a Lifetime upgrade. Lifetime owners see `ownsLifetime`. **VERIFY** that all subscriptions sit in one subscription group in App Store Connect. |
| A11 | Lifetime terms | **DONE (needs legal)** | `paywall.lifetimeNote` is shown when Lifetime is selected. The full wording is in pricing-model.md ("needs legal review"). The phrase "Cloud-based features introduced later may require a subscription" should appear on the paywall too, not only in docs. |
| A12 | Annual "Best value" badge | **DONE** | Acceptable. If a savings % or per-month equivalent is ever added, keep it smaller than the annual billed price (Apple). |
| A13 | Pending and failed purchase states | **DONE** | `paywall.pending`, `paywall.failed`, `paywall.unavailable`. |
| A14 | Manage / cancel subscription in app | **DONE** | `src/app/settings/subscription.tsx` → `Purchases.showManageSubscriptions()`. Billing-issue notice is shown. Satisfies Play's "disclose how to manage or cancel". |

## B. In-app purchases (3.1.1) and products

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| B1 | All unlocks go through IAP | **DONE** | Entitlement comes only from RevenueCat CustomerInfo (`entitlements.ts` `deriveAccess`). No license keys. |
| B2 | AI credit pack product type is consistent | **GAP** | `app-review-notes.md` and pricing-model.md say **consumable**. `server/src/types.ts` says "non-consumable product purchases". The server counts every non-refunded transaction in `non_subscriptions` (`server/src/entitlements.ts`). Pick one type. If consumable, 3.1.1 says *"credits … purchased via in-app purchase may not expire"*, and restore must work. With anonymous RevenueCat IDs, a reinstall or new device gets a new ID, so credits survive only if restore re-attaches the receipt (consumables are not in the iOS receipt after they are finished). Decide and test. |
| B3 | Credit-pack quota math | **GAP (business bug, compliance-adjacent)** | `quotaFor()` adds `creditPacks * creditPackSize` to a **monthly** key for free and subscription users. A pack therefore re-grants 100 requests every month instead of 100 once. That is the opposite of expiring, so it is not a rule violation, but it is not what was sold. |
| B4 | Credit pack purchase UI | **GAP / DECISION** | `PRODUCT_IDS.credits100` exists, but nothing in the UI sells it. Either remove it from App Store Connect / Play for v1 or build the purchase flow. `paywall.lifetimeNote` says "Extra AI credits can be purchased", which promises a product the app does not sell. |
| B5 | Subscriptions work across the user's devices (3.1.2(a)) | **DONE (by restore)** | Anonymous IDs + Restore. Document this in the review notes. |
| B6 | Products configured, with localized names and descriptions, and review screenshot of the paywall | **GAP** | Store-side work. Prices still need founder approval (pricing-model.md). |

## C. Privacy (Apple 5.1.1 / 5.1.2, Play User Data policy)

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| C1 | Privacy policy published at a public URL, in store metadata and in the app | **GAP** | `docs/launch/privacy-policy-draft.md` is a draft with placeholders. The in-app link depends on `EXPO_PUBLIC_PRIVACY_URL` (settings/privacy.tsx, paywall). |
| C2 | Privacy policy content is accurate | **GAP** | It must add or fix the following. (a) Item 4 says "We do not store the text after processing". Anthropic keeps API inputs for up to 30 days by default unless zero data retention is agreed, so the sentence must name the provider's retention. (b) It does not mention Cloudflare (hosting) or **IP-address rate limiting**. (c) It does not say the anonymous ID + AI usage counters are stored on Promptly's server, or for how long (no TTL today). (d) Data retention and deletion-request procedure (5.1.1(i) requires it). (e) Third parties give "the same or equal protection" (5.1.1(i)). (f) Contact email and controller identity. (g) Item 6 (analytics) is premature while no provider exists. |
| C3 | Third-party AI: clear disclosure **and explicit permission** (5.1.2(i): "including with third-party AI, and obtain explicit permission before doing so") | **GAP** | `studio.disclosure` is a passive caption and says "Promptly's AI service" without naming Anthropic. Add a one-time consent sheet before the first AI request. It should name Anthropic, say what is sent and the retention, and offer Allow / Not now. Store the consent in `kv` and let the user revoke it in Settings › Privacy. |
| C4 | Analytics consent | **GAP (before any provider)** | `analyticsEnabled: true` by default (`src/state/settings.ts:68`), so analytics is opt-out. 5.1.1(ii) requires consent "even if … anonymous". Default to off or add an opt-in prompt. Today nothing is sent (no-op sink), so this blocks only once a provider is wired. |
| C5 | App Privacy label (ASC) | **GAP** | Answers drafted in `app-privacy-ios.md` §2. **DECISION** on "linked" (Note L). |
| C6 | Privacy manifest (`PrivacyInfo.xcprivacy`) | **GAP** | `app.json` has no `ios.privacyManifests`. Several dependencies (vision-camera, expo-video, expo-sqlite, expo-modules-core) use required-reason APIs with no bundled manifest, and React Native aggregation does not cover them. Proposed block in `app-privacy-ios.md` §3.3. **VERIFY** by uploading to TestFlight and checking for Apple's email. |
| C7 | Play Data safety form | **GAP** | Answers drafted in `data-safety-android.md` §3. |
| C8 | Purpose strings | **DONE** | Camera, Microphone and SpeechRecognition in `app.json` `ios.infoPlist`. Photo add / read in the expo-media-library plugin. Consider dropping the read `photosPermission`: export uses add-only (`requestPermissionsAsync(true)`). |
| C9 | Permissions minimised (Android) | **DONE / VERIFY** | Only CAMERA and RECORD_AUDIO requested. READ_MEDIA_*, location and overlay are blocked, so no Photo/Video Permissions declaration should be needed. Verify the merged release manifest: legacy storage permissions `maxSdkVersion=32` come from Expo libs, and check whether AD_ID is present. |
| C10 | Account deletion (5.1.1(v)) | **N/A (DONE)** | No account creation anywhere ("If your app supports account creation, you must also offer account deletion"). Play: answer "no account creation". Keep "Delete all my data" (`settings/privacy.tsx`). |
| C11 | Local "Delete all my data" completeness | **GAP (minor)** | It does not clear `exports/` (cache, cleaned after 24 h) or recognizer-persisted audio files. It does not reset the RevenueCat anonymous ID or request deletion of server counters. Either state this in the confirm text and privacy policy, or extend the deletion. |
| C12 | User can find their support ID for deletion requests | **GAP** | The anonymous ID is never shown, so server-side data cannot be located for a deletion or access request. Add "Copy support ID" in Help. |
| C13 | Tracking / ATT | **DONE (N/A)** | No tracking, no IDFA, no ATT prompt needed. `NSPrivacyTracking: false`. |
| C14 | Encryption export compliance | **DONE** | `ITSAppUsesNonExemptEncryption: false` (HTTPS only). |

## D. AI-generated content

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| D1 | Play AI-Generated Content policy: in-app report or flag for AI output | **GAP** | Nothing in `src/app/studio.tsx`. Add a "Report draft" action. |
| D2 | Safety of generated content | **DONE (server prompt)** | `server/src/prompts.ts`: no fabricated facts, injection-resistant wrapping. Refusals map to 422. `studio.draftNote` warns users to check facts. |
| D3 | Age rating questionnaire (Apple + IARC) | **GAP** | Answer the AI or user-generated-content questions honestly. The policy says not for under-13. |
| D4 | Free AI abuse controls before enabling | **GAP (server)** | `server/src/entitlements.ts` note: device attestation (App Attest / Play Integrity) is required before free AI goes to production. `AI_ENABLED=false` today. Enabling it needs founder approval. |

## E. Metadata and review

| # | Item | Status | Evidence / gap |
|---|---|---|---|
| E1 | Bundle ID / package | **GAP** | `app.promptly.placeholder` in `app.json`. The final name is not decided (store-listing-draft.md). |
| E2 | Review notes | **DONE (draft)** | `docs/launch/app-review-notes.md`. Add: AI Studio state (enabled or disabled), credit-pack status, that Voice Follow may be unavailable on some Android devices, and a demo path to the paywall. |
| E3 | Store description claims | **VERIFY** | "follows your voice", "on your device", "Unlimited Voice Follow" need device evidence (store-listing-draft.md). "Your scripts and videos stay on your phone" is false for AI text. Qualify it: "except text you send to AI Script Studio". |
| E4 | Subscription disclosure in the store description (Apple places it in the description or EULA field) | **GAP** | Draft line exists in store-listing-draft.md. The final text needs prices, period, renewal, and the Terms and Privacy URLs. |
| E5 | Support URL and contact | **GAP** | `EXPO_PUBLIC_SUPPORT_EMAIL` is empty. App Store Connect requires a Support URL. |
| E6 | Screenshots are real captures | **DECISION / GAP** | Planned in store-listing-draft.md. Don't show AI Studio if it ships disabled. |

## F. Verification status of external requirements (2026-10-20)

- **Fetched and quoted:** Apple App Review Guidelines (page says "Last Updated: October 16, 2026"), Apple App Privacy Details page, Apple Auto-renewable Subscriptions page, Apple required-reason API docs and reason codes (through the developer.apple.com doc JSON), Expo privacy guide **source** on GitHub `main`, and RevenueCat's iOS `PrivacyInfo.xcprivacy` on GitHub `main`.
- **Blocked by network policy (proxy 403), so only search snippets were used:** docs.expo.dev, revenuecat.com docs, support.google.com (Play Data safety, Photo/Video Permissions, Subscriptions, AI-Generated Content), and privacy.claude.com (Anthropic retention). Re-read each one manually before submission. The URLs are in the verification logs of the two companion docs.
- **Not checked at all:** the text of Schedule 2 of the Apple DPLA (developer.apple.com/support/terms). The A4 wording follows common practice and must be confirmed by legal.
