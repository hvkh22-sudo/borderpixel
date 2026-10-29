# AI proxy (server/)

Cloudflare Worker, `POST /v1/studio`, `GET /v1/balance`, `POST /v1/integrity/challenge`, `POST /v1/integrity/attest`. Header `x-app-user-id` = RevenueCat app user ID.

Pipeline: validate (body ≤ 64 KB read with a byte cap — chunked bodies too; field limits, enums, language tag) →
per-IP daily limit (IPv6 keyed on its /64) → entitlement (RevenueCat REST, cached 10 min) → device integrity (see below) →
atomic quota consume (Durable Object) → **budget reservation**: the request's worst-case cost (input bounded by
characters, output by `max_tokens`) is atomically reserved against the daily cap before the call, and for free-tier
requests also against the free share (`FREE_BUDGET_SHARE`, default 50 %), so concurrent requests can't overshoot and
free traffic can't lock out payers → Claude call via `@anthropic-ai/sdk` `messages.parse` with a Zod schema
(`{script, alternatives}`), `effort: low`, `max_tokens` 4000 (hook: 800), 40 s timeout, **no SDK retry** → the
reservation is settled to the billed usage. Unknown bill (timeout, connection loss): the worst case stays counted;
rejected before generation (429/overloaded): released. Provider failures refund the user's quota; a refused or unusable
answer, or a request the client abandoned, keeps its charge. `/v1/balance` and `/v1/integrity/*` are also IP-limited.

Quotas (env, provisional): free 5/month, subscription 150/month, lifetime 300 total, +100 per credit pack.
Errors: 400 invalid, 401 bad id, 402 quota, 403 integrity required (enforce, free tier), 413 too large, 429 rate limited, 422 refused, 502 upstream,
503 budget exhausted / disabled / entitlement lookup failed.

Prompt-injection hardening: creator text wrapped in `<creator_input>` tags (a tag inside the text is neutralized so it
can't close the data block) and declared as data in the system prompt; output is plain text shown as an editable draft (no tools, no actions).

Privacy: logs contain tool, plan, token counts, latency — never content. Anthropic API data handling per
Anthropic's commercial terms (to be disclosed in the privacy policy).

## Device integrity

Binds AI requests to genuine installs: Apple App Attest (iOS) and Google Play Integrity standard
requests (Android). Code: `server/src/integrity.ts` (protocol + policy), `appAttest.ts`, `x509.ts`,
`cbor.ts`, `playIntegrity.ts`; client `src/services/integrity.ts` (wraps `@expo/app-integrity` 58.0.2).

### Endpoints (all require `x-app-user-id`)
- `POST /v1/integrity/challenge` → `{challenge, expiresAt}`. 32 random bytes (base64url), stored in the
  user's Durable Object with a 5-minute TTL, **single use** (atomic take on verification), bound to the
  user id that requested it. Max 300 per user per day. 404 when `INTEGRITY_MODE=off`.
- `POST /v1/integrity/attest` (iOS, once per install) body `{keyId, attestation, challenge}` → 200 / 400.

### iOS — App Attest
1. App: `generateKeyAsync()` once; key id kept in expo-secure-store. `attestKeyAsync(keyId, challenge)`
   (the module passes `clientDataHash = SHA256(challenge)`), then `/v1/integrity/attest`.
2. Server verifies per Apple's "Validating apps that connect to your server": CBOR `fmt = apple-appattest`;
   `x5c` chain → pinned **Apple App Attestation Root CA** (ECDSA P-384, valid to 2045); nonce
   `SHA256(authData || clientDataHash)` equals the octet string in credCert extension
   `1.2.840.113635.100.8.2`; `SHA256(credCert public key, X9.62 uncompressed) == keyId`;
   `rpIdHash == SHA256("<APPLE_TEAM_ID>.<IOS_BUNDLE_ID>")`; counter 0; aaguid `appattest\0…` (production)
   or `appattestdevelop` (accepted only if `APP_ATTEST_ALLOW_DEVELOPMENT=true`); credentialId == keyId.
   Stores `{publicKeySpki, environment}` under the user (400-day TTL) and binds keyId → user id (a key
   can never be registered to a second user).
3. Per request: headers `x-integrity-platform: ios`, `x-integrity-challenge`, `x-integrity-key-id`,
   `x-integrity-assertion` = `generateAssertionAsync(keyId, rawBody + challenge)`, i.e.
   `clientDataHash = SHA256(rawBody + challenge)`. Server: ES256 signature over
   `SHA256(authenticatorData || clientDataHash)` with the stored key, RP ID, and counter strictly greater
   than the stored one (atomic compare-and-advance in the Durable Object → replays rejected).
- Tested against Apple's own published example (Attestation Object Validation Guide) in
  `server/test/appAttest.test.ts`; assertions with ES256 keys generated in the test.
- Apple's extensions `apple_bundle_version_01` / `apple_validation_category_01` are parsed but not
  enforced (Apple does not publish the category value table). Fraud-metric receipts are not used yet.
- Note: Apple's example authData carries the extensions map with flags `0x40` (ED bit unset); the parser
  accepts that.

### Android — Play Integrity (standard request)
1. App: `prepareIntegrityTokenProviderAsync(EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER)` once per process;
   per request `requestIntegrityCheckAsync(requestHash)` with `requestHash = hex(SHA256(rawBody + challenge))`.
   (Including the challenge in addition to the body adds single-use freshness on our side; Play also
   applies its own replay protection to standard tokens.)
2. Server: `POST https://playintegrity.googleapis.com/v1/{ANDROID_PACKAGE}:decodeIntegrityToken`
   `{integrity_token}` with an OAuth token from a service-account JWT (RS256 signed with WebCrypto,
   scope `https://www.googleapis.com/auth/playintegrity`, cached ~1 h). Secret: `PLAY_INTEGRITY_SA_JSON`.
3. Verdict accepted only if: `requestDetails.requestPackageName == ANDROID_PACKAGE`, `requestHash` matches,
   `timestampMillis` within the challenge TTL; `appIntegrity.appRecognitionVerdict == PLAY_RECOGNIZED`,
   `packageName == ANDROID_PACKAGE`, `certificateSha256Digest` ∩ `ANDROID_CERT_SHA256` ≠ ∅;
   `deviceIntegrity.deviceRecognitionVerdict` contains `MEETS_DEVICE_INTEGRITY`. Licensing verdict is
   not required.

### Enforcement (`INTEGRITY_MODE`, default `report`)
Runs after entitlement lookup and **before quota is consumed**; outcome is logged as
`{event: integrity, mode, status: verified|missing|failed, platform, reason, plan, decision}` (no ids, no content).

| Mode | Free tier, not verified | Paying (subscription, lifetime or credit packs), not verified |
|------|-------------------------|-------------------------------------------------------------|
| `off` | allowed, nothing checked | allowed |
| `report` | allowed, outcome logged | allowed, outcome logged |
| `enforce` | **403 `integrity_required`** | allowed, logged, capped at `UNVERIFIED_PAID_PER_DAY` (default 30) → 429 |

Policy: **paying users are never hard-blocked by integrity failures** (Apple/Google outages, rooted but
paying devices, sideloads after purchase) — they are logged and rate-limited instead. Free tier is only
blocked under `enforce`. Verification errors (e.g. Google API down) count as "not verified" (fail closed
for free tier under `enforce`). The client never blocks: if the native module is missing (Jest, Expo Go,
unsupported device) or anything fails/times out (10 s), it sends no integrity headers; on a 403
`integrity_required` it discards its App Attest key and re-attests next time.

### Configuration
`wrangler.toml` vars: `INTEGRITY_MODE="report"`, `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`,
`APP_ATTEST_ALLOW_DEVELOPMENT="false"`, `ANDROID_PACKAGE`, `ANDROID_CERT_SHA256` (Play **app-signing**
certificate SHA-256, base64url, comma-separated), `UNVERIFIED_PAID_PER_DAY`. Secret:
`PLAY_INTEGRITY_SA_JSON`. App: `EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER`.
Native setup (no config plugin exists in `@expo/app-integrity` 58.0.2, so nothing in `app.json`):
- iOS: enable the **App Attest** capability for the App ID; the entitlement
  `com.apple.developer.devicecheck.appattest-environment` (`development` / `production`) must end up
  in the signed app. EAS managed signing syncs capabilities from entitlements; if it is not present after
  prebuild, add it via `ios.entitlements` in `app.json`. Not yet verified on a build.
- Android: link a Google Cloud project in Play Console → App integrity, enable the Play Integrity API,
  create a service account with access, put its JSON in `PLAY_INTEGRITY_SA_JSON`.

### Not verified yet
Real-device attestation/assertion from this app on iOS, real Play tokens and the Google decode response
shape (`tokenPayloadExternal`) against the live API (developers.google.com was unreachable from the build
environment; field names come from developer.android.com), entitlement presence in an EAS build.

## Before production (required)
- Device integrity: configure Team ID / package / cert digests / service account, verify on real
  devices, then switch `INTEGRITY_MODE` to `enforce` before free-tier AI goes live.
- Founder approval of model, allowances, budget; set `AI_ENABLED=true`.
- Quality eval across models (see docs/business/ai-unit-economics.md).
