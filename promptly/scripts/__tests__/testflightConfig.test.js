const { applyTestflightConfig, validBundleId } = require('../testflightConfig');

const appJson = { expo: { name: 'Promptly', ios: { bundleIdentifier: 'app.promptly.placeholder', supportsTablet: false } } };
const easJson = { submit: { testflight: { ios: {} } } };

describe('testflight config', () => {
  it('sets the chosen bundle id and keeps the rest of the iOS config', () => {
    const { app } = applyTestflightConfig(appJson, easJson, 'com.example.teleprompter');
    expect(app.expo.ios).toEqual({ bundleIdentifier: 'com.example.teleprompter', supportsTablet: false });
    expect(appJson.expo.ios.bundleIdentifier).toBe('app.promptly.placeholder'); // input untouched
  });

  it('adds the App Store Connect app id only when given', () => {
    expect(applyTestflightConfig(appJson, easJson, 'com.example.app').eas.submit.testflight.ios).toEqual({});
    expect(applyTestflightConfig(appJson, easJson, 'com.example.app', '6451234567').eas.submit.testflight.ios).toEqual({ ascAppId: '6451234567' });
    expect(() => applyTestflightConfig(appJson, easJson, 'com.example.app', 'abc')).toThrow(/app id/);
  });

  it('rejects malformed or placeholder bundle ids', () => {
    for (const bad of ['', 'promptly', 'com..app', '1com.app', 'app.promptly.placeholder', 'com.example.app ', 'com/example']) {
      expect(validBundleId(bad)).toBe(false);
    }
    expect(validBundleId('com.my-company.teleprompter')).toBe(true);
  });
});
