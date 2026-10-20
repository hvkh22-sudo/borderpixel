/* Global mocks for screen render tests: native modules unavailable in Node. */
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(() => Promise.resolve('')) }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }] }));
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: () => true,
    supportsRecording: () => true,
    supportsOnDeviceRecognition: () => true,
    getPermissionsAsync: () => Promise.resolve({ granted: true }),
    addListener: () => ({ remove() {} }),
  },
  AVAudioSessionCategory: {},
  AVAudioSessionCategoryOptions: {},
  AVAudioSessionMode: {},
  AudioEncodingAndroid: { ENCODING_PCM_16BIT: 2 },
}));
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: { configure: jest.fn(), PURCHASES_ERROR_CODE: {} },
  LOG_LEVEL: { WARN: 'WARN' },
}));
jest.mock('@expo/vector-icons', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  const Ionicons = ({ name }: { name: string }) => React.createElement(Text, null, `icon:${name}`);
  Ionicons.glyphMap = {};
  return { Ionicons };
});
// Gesture Handler binds to the Reanimated UI runtime on import; there is no UI runtime under Jest.
jest.mock('react-native-worklets', () => ({
  ...jest.requireActual('react-native-worklets'),
  getUIRuntimeHolder: () => ({}),
}));
