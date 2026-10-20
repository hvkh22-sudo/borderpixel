import { PromptlyMedia } from '../nativeMedia';

const mockCalls: boolean[] = [];
const mockListeners: ((e: { key: string; repeat: boolean }) => void)[] = [];
let mockHasApi = true;

jest.mock('expo', () => ({
  requireOptionalNativeModule: () => ({
    get setRemoteKeysEnabled() {
      return mockHasApi
        ? (on: boolean) => {
            mockCalls.push(on);
            return Promise.reject(new Error('ignored'));
          }
        : undefined;
    },
    addListener: (_name: string, cb: (e: { key: string; repeat: boolean }) => void) => {
      mockListeners.push(cb);
      return { remove: () => mockListeners.splice(mockListeners.indexOf(cb), 1) };
    },
  }),
}));
jest.mock('../files', () => ({ exportsDir: () => ({ uri: 'file:///cache/exports/' }) }));

describe('PromptlyMedia.listenRemoteKeys', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockListeners.length = 0;
    mockHasApi = true;
  });

  it('enables forwarding, delivers keys and disables on cleanup', async () => {
    const keys: string[] = [];
    const stop = PromptlyMedia.listenRemoteKeys((e) => keys.push(e.key));
    expect(PromptlyMedia.remoteKeysAvailable()).toBe(true);
    expect(mockCalls).toEqual([true]);
    mockListeners[0]!({ key: 'PageDown', repeat: false });
    expect(keys).toEqual(['PageDown']);
    stop();
    expect(mockCalls).toEqual([true, false]);
    expect(mockListeners).toHaveLength(0);
    await Promise.resolve(); // rejected native promises are swallowed
  });

  it('is a no-op on builds without the native API', () => {
    mockHasApi = false;
    expect(PromptlyMedia.remoteKeysAvailable()).toBe(false);
    PromptlyMedia.listenRemoteKeys(() => {})();
    expect(mockCalls).toEqual([]);
    expect(mockListeners).toHaveLength(0);
  });
});
