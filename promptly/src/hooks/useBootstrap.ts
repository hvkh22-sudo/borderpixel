/**
 * App start-up: open DB, hydrate settings, configure purchases, recover
 * orphaned recordings. Each step fails independently — a purchase or storage
 * problem must never block recording.
 */
import { getLocales } from 'expo-localization';
import { useEffect, useState } from 'react';

import { deriveAccess } from '../features/monetization/entitlements';
import { setLanguage } from '../localization/i18n';
import { setAnalyticsEnabled, track } from '../services/analytics';
import { getRepositories } from '../services/db';
import { cleanExports, findOrphanRecordings } from '../services/files';
import { fetchCustomerInfo, subscribeCustomerInfo } from '../services/purchases';
import { useAccess } from '../state/access';
import { persistableSettings, useSettings, type SettingsState } from '../state/settings';

const SETTINGS_KEY = 'settings.v1';
export const USAGE_VF_KEY = 'usage.voiceFollowSessions';

export function useBootstrap(): { ready: boolean; recovered: number } {
  const [ready, setReady] = useState(false);
  const [recovered, setRecovered] = useState(0);

  useEffect(() => {
    let unsubscribePurchases = () => {};
    let unsubscribeSettings = () => {};
    (async () => {
      const locale = getLocales()[0];
      setLanguage(locale?.languageCode ?? 'en');
      try {
        const repos = await getRepositories();
        const saved = await repos.kv.get<Partial<SettingsState>>(SETTINGS_KEY, {});
        useSettings.getState().hydrate({
          speechLocale: locale?.languageTag ?? 'en-US',
          ...saved,
        });
        setAnalyticsEnabled(useSettings.getState().analyticsEnabled);
        useAccess.getState().setUsage({ voiceFollowSessionsUsed: await repos.kv.get(USAGE_VF_KEY, 0) });

        // Persist settings on change (debounced).
        let timer: ReturnType<typeof setTimeout> | null = null;
        unsubscribeSettings = useSettings.subscribe((s) => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void repos.kv.set(SETTINGS_KEY, persistableSettings(s)), 400);
        });

        // Recordings written but never registered (app killed while finalizing).
        const orphans = findOrphanRecordings(await repos.recordings.knownFileNames());
        for (const f of orphans) {
          await repos.recordings.add({ scriptId: null, fileName: f.name, durationMs: 0, width: null, height: null, status: 'recovered' });
        }
        setRecovered(orphans.length);
        cleanExports(24 * 60 * 60 * 1000);
      } catch (e) {
        if (__DEV__) console.warn('bootstrap storage failed', e);
        useSettings.getState().hydrate({});
      }
      setReady(true);
      track({ name: 'app_open' });

      try {
        useAccess.getState().setAccess(deriveAccess(await fetchCustomerInfo()));
        unsubscribePurchases = subscribeCustomerInfo((info) => useAccess.getState().setAccess(deriveAccess(info)));
      } catch (e) {
        // Offline / store unavailable: the SDK cache is used next time; stay on current state.
        if (__DEV__) console.warn('purchases unavailable', e);
      }
    })();
    return () => {
      unsubscribePurchases();
      unsubscribeSettings();
    };
  }, []);

  return { ready, recovered };
}
