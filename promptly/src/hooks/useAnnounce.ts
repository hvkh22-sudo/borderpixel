/**
 * Screen-reader announcements for async status (recording state, caption
 * generation, export progress, AI results).
 *
 * Convention: the visible status text carries `accessibilityLiveRegion`, which
 * TalkBack honours but VoiceOver ignores. `useAnnounce` fills the iOS gap by
 * announcing the same message when it changes. Pass `'all'` only when there is
 * no live-region text to rely on (e.g. throttled progress milestones), because
 * Android discourages programmatic announcements.
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export type AnnouncePlatforms = 'ios' | 'all';

export function announce(message: string, platforms: AnnouncePlatforms = 'ios'): void {
  if (!message) return;
  if (platforms === 'ios' && Platform.OS !== 'ios') return;
  AccessibilityInfo.announceForAccessibility(message);
}

/** Announces `message` whenever it changes to a new non-empty value. */
export function useAnnounce(message: string | null | undefined, platforms: AnnouncePlatforms = 'ios'): void {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!message) {
      last.current = null;
      return;
    }
    if (message === last.current) return;
    last.current = message;
    announce(message, platforms);
  }, [message, platforms]);
}
