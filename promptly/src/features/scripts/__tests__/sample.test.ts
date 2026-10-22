import { SAMPLE_SCRIPT, sampleScriptFor } from '../sample';

describe('sampleScriptFor', () => {
  it('returns the Hebrew sample for a Hebrew UI', () => {
    const he = sampleScriptFor('he');
    expect(he.body).toMatch(/טלפרומפטר/);
    expect(he.title).not.toBe(SAMPLE_SCRIPT.title);
  });

  it('falls back to English for languages without a sample', () => {
    expect(sampleScriptFor('en')).toBe(SAMPLE_SCRIPT);
    expect(sampleScriptFor('fr')).toBe(SAMPLE_SCRIPT);
  });
});
