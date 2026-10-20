import { createIntegrityClient, integrity, type IntegrityEnv, type IntegrityTransport } from '../integrity';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    map: m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
    remove: async (k: string) => void m.delete(k),
  };
}

function transport(overrides: Partial<IntegrityTransport> = {}) {
  let n = 0;
  const t = {
    challenge: jest.fn(async () => `nonce${++n}`),
    attest: jest.fn(async () => true),
    ...overrides,
  };
  return t;
}

function nativeMock() {
  return {
    isSupported: true,
    generateKeyAsync: jest.fn(async () => 'KEY='),
    attestKeyAsync: jest.fn(async () => 'ATTESTATION'),
    generateAssertionAsync: jest.fn(async (_k: string, c: string) => `ASSERT(${c})`),
    prepareIntegrityTokenProviderAsync: jest.fn(async () => {}),
    requestIntegrityCheckAsync: jest.fn(async (h: string) => `TOKEN(${h})`),
  };
}

const env = (over: Partial<IntegrityEnv>): IntegrityEnv => ({
  platform: 'ios',
  native: nativeMock(),
  storage: memoryStorage(),
  sha256Hex: async (d) => `sha(${d})`,
  cloudProjectNumber: '123456789',
  ...over,
});

describe('integrity client', () => {
  it('sends no headers and makes no calls when the native module is missing (tests, Expo Go)', async () => {
    const t = transport();
    expect(await integrity.headersFor('{}', t)).toEqual({});
    expect(await createIntegrityClient(env({ native: null })).headersFor('{}', t)).toEqual({});
    expect(t.challenge).not.toHaveBeenCalled();
  });

  it('iOS: generates and attests a key once, then asserts over body + challenge per request', async () => {
    const native = nativeMock();
    const client = createIntegrityClient(env({ native }));
    const t = transport();
    const h1 = await client.headersFor('{"a":1}', t);
    const h2 = await client.headersFor('{"a":2}', t);
    expect(native.generateKeyAsync).toHaveBeenCalledTimes(1);
    expect(native.attestKeyAsync).toHaveBeenCalledWith('KEY=', 'nonce1');
    expect(t.attest).toHaveBeenCalledWith('KEY=', 'ATTESTATION', 'nonce1');
    expect(h1).toEqual({
      'x-integrity-platform': 'ios',
      'x-integrity-challenge': 'nonce2',
      'x-integrity-key-id': 'KEY=',
      'x-integrity-assertion': 'ASSERT({"a":1}nonce2)',
    });
    expect(h2['x-integrity-assertion']).toBe('ASSERT({"a":2}nonce3)');
  });

  it('iOS: unsupported devices and rejected attestations degrade to no headers', async () => {
    expect(await createIntegrityClient(env({ native: { ...nativeMock(), isSupported: false } })).headersFor('{}', transport())).toEqual({});
    const client = createIntegrityClient(env({}));
    expect(await client.headersFor('{}', transport({ attest: jest.fn(async () => false) }))).toEqual({});
  });

  it('iOS: reset forces a new key and attestation', async () => {
    const native = nativeMock();
    const storage = memoryStorage();
    const client = createIntegrityClient(env({ native, storage }));
    await client.headersFor('{}', transport());
    await client.reset();
    expect(storage.map.size).toBe(0);
    await client.headersFor('{}', transport());
    expect(native.generateKeyAsync).toHaveBeenCalledTimes(2);
  });

  it('Android: prepares the provider once and binds requestHash = sha256(body + challenge)', async () => {
    const native = nativeMock();
    const client = createIntegrityClient(env({ platform: 'android', native }));
    const h = await client.headersFor('{"b":1}', transport());
    await client.headersFor('{"b":2}', transport());
    expect(native.prepareIntegrityTokenProviderAsync).toHaveBeenCalledTimes(1);
    expect(native.prepareIntegrityTokenProviderAsync).toHaveBeenCalledWith('123456789');
    expect(h).toEqual({ 'x-integrity-platform': 'android', 'x-integrity-challenge': 'nonce1', 'x-integrity-token': 'TOKEN(sha({"b":1}nonce1))' });
  });

  it('Android: missing project number or native failures send no headers', async () => {
    expect(await createIntegrityClient(env({ platform: 'android', cloudProjectNumber: '' })).headersFor('{}', transport())).toEqual({});
    const native = { ...nativeMock(), requestIntegrityCheckAsync: jest.fn(async () => Promise.reject(new Error('play down'))) };
    expect(await createIntegrityClient(env({ platform: 'android', native })).headersFor('{}', transport())).toEqual({});
  });

  it('gives up after the timeout instead of delaying the AI request', async () => {
    const native = { ...nativeMock(), generateKeyAsync: jest.fn(() => new Promise<string>(() => {})) };
    expect(await createIntegrityClient(env({ native, timeoutMs: 20 })).headersFor('{}', transport())).toEqual({});
  });
});
