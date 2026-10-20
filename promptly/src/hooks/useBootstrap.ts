/**
 * App start-up: open DB, hydrate settings, configure purchases, recover
 * orphaned recordings. Each step fails independently — a purchase or storage
 * problem must never block recording. `ready` waits only for settings; orphan
 * recovery, export cleanup and purchases finish after the first screen
 * (docs/architecture/performance.md).
 */
import { getLocales } from 'expo-localization';
import { useEffect, useState } from 'react';

import { deriveAccess } from '../features/monetization/entitlements';
import { setLanguage } from '../localization/i18n';
import { syncLayoutDirection } from '../localization/layoutDirection';
import { setAnalyticsEnabled, track } from '../services/analytics';
import { getRepositories } from '../services/db';
import { cleanExports, findOrphanRecordings } from '../services/files';
import { PromptlyMedia } from '../services/nativeMedia';
import { fetchCustomerInfo, subscribeCustomerInfo } from '../services/purchases';
import { useAccess } from '../state/access';
import { useSession } from '../state/session';
import { persistableSettings, useSettings, type SettingsState } from '../state/settings';
import { SPEAKING_RATE_KEY, useSpeakingRate } from '../state/speakingRate';

const SETTINGS_KEY = 'settings.v1';
export const USAGE_VF_KEY = 'usage.voiceFollowSessions';

/**
 * Recordings written but never registered (app killed while finalizing).
 * Video probes run in parallel; DB inserts stay sequential.
 */
async function recoverOrphans(repos: Awaited<ReturnType<typeof getRepositories>>): Promise<number> {
  const orphans = findOrphanRecordings(await repos.recordings.knownFileNames());
  if (orphans.length === 0) return 0;
  // Best effort: a file cut off mid-write may not be readable; register it anyway
  // so the user decides what to do with it.
  const infos = await Promise.all(
    orphans.map((f) => (PromptlyMedia.isAvailable() ? PromptlyMedia.getVideoInfo(f.uri).catch(() => null) : Promise.resolve(null))),
  );
  for (let i = 0; i < orphans.length; i++) {
    const info = infos[i];
    await repos.recordings.add({
      scriptId: null,
      fileName: orphans[i]!.name,
      durationMs: Math.round(info?.durationMs ?? 0),
      width: info?.width ?? null,
      height: info?.height ?? null,
      status: 'recovered',
    });
  }
  return orphans.length;
}

export function useBootstrap(): { ready: boolean; recovered: number } {
  const [ready, setReady] = useState(false);
  const [recovered, setRecovered] = useState(0);

  useEffect(() => {
    let unsubscribePurchases = () => {};
    let unsubscribeSettings = () => {};
    (async () => {
      const locale = getLocales()[0];
      setLanguage(locale?.languageCode ?? 'en');
      // Layout mirroring follows the UI language; a mismatch is fixed for the next launch.
      if (syncLayoutDirection() && __DEV__) console.info('layout direction updated; restart the app to apply');
      let repos: Awaited<ReturnType<typeof getRepositories>> | null = null;
      try {
        repos = await getRepositories();
        const r = repos;
        // Independent reads: one round of async SQLite hops instead of three in a row.
        const [saved, vfUsed, speakingRate] = await Promise.all([
          r.kv.get<Partial<SettingsState>>(SETTINGS_KEY, {}),
          r.kv.get(USAGE_VF_KEY, 0),
          r.kv.get<unknown>(SPEAKING_RATE_KEY, null),
        ]);
        useSettings.getState().hydrate({
          speechLocale: locale?.languageTag ?? 'en-US',
          ...saved,
        });
        setAnalyticsEnabled(useSettings.getState().analyticsEnabled);
        useAccess.getState().setUsage({ voiceFollowSessionsUsed: vfUsed });
        useSpeakingRate.getState().hydrate(speakingRate);

        // Persist settings on change (debounced).
        let timer: ReturnType<typeof setTimeout> | null = null;
        unsubscribeSettings = useSettings.subscribe((s) => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void r.kv.set(SETTINGS_KEY, persistableSettings(s)), 400);
        });
      } catch (e) {
        if (__DEV__) console.warn('bootstrap storage failed', e);
        useSettings.getState().hydrate({});
      }
      setReady(true);
      track({ name: 'app_open' });
      // Purchases (SDK configure + network/cache) overlap orphan recovery
      // instead of running after it; neither blocks the first screen.
      const customerInfo = fetchCustomerInfo().then(
        (info) => ({ ok: true as const, info }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      // After first paint: the recovery banner and the Takes list read the
      // session store reactively, so this no longer delays the first screen.
      if (repos) {
        try {
          const recoveredCount = await recoverOrphans(repos);
          setRecovered(recoveredCount);
          useSession.getState().setRecoveredTakes(recoveredCount);
        } catch (e) {
          if (__DEV__) console.warn('orphan recovery failed', e);
        }
        try {
          cleanExports(24 * 60 * 60 * 1000);
        } catch (e) {
          if (__DEV__) console.warn('export cleanup failed', e);
        }
      }

      const purchases = await customerInfo;
      if (purchases.ok) {
        useAccess.getState().setAccess(deriveAccess(purchases.info));
        try {
          unsubscribePurchases = subscribeCustomerInfo((info) => useAccess.getState().setAccess(deriveAccess(info)));
        } catch (e) {
          if (__DEV__) console.warn('purchases unavailable', e);
        }
      } else if (__DEV__) {
        // Offline / store unavailable: the SDK cache is used next time; stay on current state.
        console.warn('purchases unavailable', purchases.error);
      }
    })();
    return () => {
      unsubscribePurchases();
      unsubscribeSettings();
    };
  }, []);

  return { ready, recovered };
}
