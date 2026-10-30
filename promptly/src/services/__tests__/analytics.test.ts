/**
 * @jest-environment node
 */
/* Analytics stay off until settings say otherwise; Delete all keeps the device speech language. */
describe('analytics opt-out', () => {
  it('sends nothing before settings have loaded', () => {
    jest.isolateModules(() => {
      const a = require('../analytics');
      const sink = jest.fn();
      a.setAnalyticsSink(sink);
      // A fresh module instance (the test setup enabled only the shared one) is opted out.
      a.track({ name: 'app_open' });
      expect(sink).not.toHaveBeenCalled();
      a.setAnalyticsEnabled(true);
      a.track({ name: 'app_open' });
      expect(sink).toHaveBeenCalledTimes(1);
    });
  });
});

describe('settings reset', () => {
  it('keeps the device speech language instead of falling back to en-US', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'he', languageTag: 'he' }] }));
      const { useSettings } = require('../../state/settings');
      useSettings.getState().hydrate({ speechLocale: 'he-IL', analyticsEnabled: true });
      useSettings.getState().reset();
      expect(useSettings.getState().speechLocale).toBe('he-IL');
      expect(useSettings.getState().analyticsEnabled).toBe(false);
    });
  });
});
