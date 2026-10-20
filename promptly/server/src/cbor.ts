/**
 * Minimal CBOR (RFC 8949) decoder: only what App Attest attestation/assertion
 * objects and WebAuthn authenticator-data extensions need. Definite lengths
 * only; indefinite-length items, floats and big integers are rejected.
 */
export type CborValue = number | string | boolean | null | undefined | Uint8Array | CborValue[] | CborMap;
export type CborMap = Map<string | number, CborValue>;

export class CborError extends Error {}

const MAX_DEPTH = 16;

/** Decodes one item starting at `offset`; returns the value and the offset just after it. */
export function decodeCborItem(data: Uint8Array, offset = 0, depth = 0): { value: CborValue; end: number } {
  if (depth > MAX_DEPTH) throw new CborError('too deep');
  let pos = offset;
  const need = (n: number) => {
    if (pos + n > data.length) throw new CborError('truncated');
  };
  need(1);
  const initial = data[pos++]!;
  const major = initial >> 5;
  const info = initial & 0x1f;

  const readArg = (): number => {
    if (info < 24) return info;
    const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
    if (!size) throw new CborError(`unsupported additional info ${info}`);
    need(size);
    let v = 0;
    for (let i = 0; i < size; i++) v = v * 256 + data[pos++]!;
    if (!Number.isSafeInteger(v)) throw new CborError('integer too large');
    return v;
  };

  switch (major) {
    case 0:
      return { value: readArg(), end: pos };
    case 1:
      return { value: -1 - readArg(), end: pos };
    case 2: {
      const len = readArg();
      need(len);
      return { value: data.slice(pos, pos + len), end: pos + len };
    }
    case 3: {
      const len = readArg();
      need(len);
      const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data.subarray(pos, pos + len));
      return { value, end: pos + len };
    }
    case 4: {
      const len = readArg();
      const arr: CborValue[] = [];
      for (let i = 0; i < len; i++) {
        const item = decodeCborItem(data, pos, depth + 1);
        arr.push(item.value);
        pos = item.end;
      }
      return { value: arr, end: pos };
    }
    case 5: {
      const len = readArg();
      const map: CborMap = new Map();
      for (let i = 0; i < len; i++) {
        const k = decodeCborItem(data, pos, depth + 1);
        if (typeof k.value !== 'string' && typeof k.value !== 'number') throw new CborError('unsupported map key');
        const v = decodeCborItem(data, k.end, depth + 1);
        map.set(k.value, v.value);
        pos = v.end;
      }
      return { value: map, end: pos };
    }
    case 6: {
      readArg(); // tag number ignored; the tagged item is returned as-is
      return decodeCborItem(data, pos, depth + 1);
    }
    default: {
      if (info === 20) return { value: false, end: pos };
      if (info === 21) return { value: true, end: pos };
      if (info === 22) return { value: null, end: pos };
      if (info === 23) return { value: undefined, end: pos };
      throw new CborError(`unsupported simple/float ${info}`);
    }
  }
}

/** Decodes exactly one item spanning the whole buffer. */
export function decodeCbor(data: Uint8Array): CborValue {
  const { value, end } = decodeCborItem(data, 0);
  if (end !== data.length) throw new CborError('trailing bytes');
  return value;
}

export const isMap = (v: CborValue): v is CborMap => v instanceof Map;
export const isBytes = (v: CborValue): v is Uint8Array => v instanceof Uint8Array;
