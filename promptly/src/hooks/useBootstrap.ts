/**
 * App start-up: open DB, hydrate settings, configure purchases, recover
 * orphaned recordings. Each step fails independently — a purchase or storage
 * problem must never block recording.
 */
import { getLocales } from 'expo-localization';
import { useEffect, useState } from 'react';

import { deriveAccess } from '../features/monetization/entitlements';
import { recoverOrphanRecordings } from '../features/recording/orphanRecovery';
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

export function useBootstrap(): { ready: boolean; recovered: number } {
  const [ready, setReady] = useState(false);
  const [recovered, setRecovered] = useState(0);

  useEffect(() => {
    let alive = true;
    let unsubscribePurchases = () => {};
    let unsubscribeSettings = () => {};
    (async () => {
      const locale = getLocales()[0];
      setLanguage(locale?.languageCode ?? 'en');
      // Layout mirroring follows the UI language; a mismatch is fixed for the next launch.
      if (syncLayoutDirection() && __DEV__) console.info('layout direction updated; restart the app to apply');
      try {
        const repos = await getRepositories();
        const saved = await repos.kv.get<Partial<SettingsState>>(SETTINGS_KEY, {});
        useSettings.getState().hydrate({
          speechLocale: locale?.languageTag ?? 'en-US',
          ...saved,
        });
        setAnalyticsEnabled(useSettings.getState().analyticsEnabled);
        useAccess.getState().setUsage({ voiceFollowSessionsUsed: await repos.kv.get(USAGE_VF_KEY, 0) });
        useSpeakingRate.getState().hydrate(await repos.kv.get<unknown>(SPEAKING_RATE_KEY, null));

        // Persist settings on change (debounced).
        let timer: ReturnType<typeof setTimeout> | null = null;
        unsubscribeSettings = useSettings.subscribe((s) => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void repos.kv.set(SETTINGS_KEY, persistableSettings(s)), 400);
        });

        // Recordings written but never registered (app killed while recording or finalizing).
        // Single-flight + dedupe inside: StrictMode's double effect cannot register a file twice.
        const recoveredCount = await recoverOrphanRecordings({
          knownFileNames: () => repos.recordings.knownFileNames(),
          findOrphans: (known) => findOrphanRecordings(known),
          videoInfo: (uri) => (PromptlyMedia.isAvailable() ? PromptlyMedia.getVideoInfo(uri) : Promise.resolve(null)),
          add: (rec) => repos.recordings.add(rec),
        });
        if (alive) setRecovered(recoveredCount);
        if (recoveredCount > 0) useSession.getState().setRecoveredTakes(recoveredCount);
        cleanExports(24 * 60 * 60 * 1000);
      } catch (e) {
        if (__DEV__) console.warn('bootstrap storage failed', e);
        useSettings.getState().hydrate({});
      }
      if (alive) setReady(true);
      track({ name: 'app_open' });

      try {
        useAccess.getState().setAccess(deriveAccess(await fetchCustomerInfo()));
        unsubscribePurchases = subscribeCustomerInfo((info) => useAccess.getState().setAccess(deriveAccess(info)));
        if (!alive) unsubscribePurchases(); // unmounted while fetching
      } catch (e) {
        // Offline / store unavailable: the SDK cache is used next time; stay on current state.
        if (__DEV__) console.warn('purchases unavailable', e);
      }
    })();
    return () => {
      alive = false;
      unsubscribePurchases();
      unsubscribeSettings();
    };
  }, []);

  return { ready, recovered };
}
