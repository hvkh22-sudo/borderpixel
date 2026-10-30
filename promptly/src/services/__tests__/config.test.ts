import { secureAiBaseUrl } from '../config';

describe('secureAiBaseUrl', () => {
  it('accepts only https in release builds', () => {
    expect(secureAiBaseUrl('https://ai.example.com/', false)).toBe('https://ai.example.com');
    expect(secureAiBaseUrl('http://ai.example.com', false)).toBe('');
    expect(secureAiBaseUrl('http://localhost:8787', false)).toBe('');
    expect(secureAiBaseUrl('ftp://x', false)).toBe('');
    expect(secureAiBaseUrl(undefined, false)).toBe('');
  });

  it('allows a local http dev server only in development', () => {
    expect(secureAiBaseUrl('http://localhost:8787', true)).toBe('http://localhost:8787');
    expect(secureAiBaseUrl('http://10.0.2.2:8787/', true)).toBe('http://10.0.2.2:8787');
    expect(secureAiBaseUrl('http://ai.example.com', true)).toBe('');
    expect(secureAiBaseUrl('http://localhost.evil.com', true)).toBe('');
  });
});
