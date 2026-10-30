import { ScriptAligner } from '../aligner';
import { tokenize } from '../text';

const SCRIPT = `Hey everyone, welcome back to the channel.
Today I want to show you three simple habits that changed the way I record videos.
First, write your script before you hit record. It sounds obvious, but most creators skip it.
Second, read it out loud once. You will hear the parts that feel awkward.
Third, keep your takes short. Short takes are easier to fix and easier to edit.
If this helped, follow for more tips like this.`;

/** Simulates a recognizer emitting a growing partial hypothesis word by word. */
function speak(aligner: ScriptAligner, words: string[], prefix: string[] = []) {
  const results = [];
  const hyp = [...prefix];
  for (const w of words) {
    hyp.push(w);
    results.push(aligner.update(hyp.join(' ')));
  }
  return { results, hyp };
}

function scriptWords(from: number, to: number): string[] {
  return tokenize(SCRIPT)
    .slice(from, to)
    .map((t) => SCRIPT.slice(t.start, t.end));
}

describe('ScriptAligner', () => {
  it('follows a speaker reading the script exactly', () => {
    const a = new ScriptAligner(SCRIPT);
    const words = scriptWords(0, 30);
    const { results } = speak(a, words);
    expect(a.cursor).toBe(29);
    // Monotonic: never moves backwards while reading normally.
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.cursor).toBeGreaterThanOrEqual(results[i - 1]!.cursor);
    }
    // Never more than 2 words behind the speaker after warm-up.
    results.forEach((r, i) => {
      if (i >= 2) expect(i - r.cursor).toBeLessThanOrEqual(2);
    });
  });

  it('reacts on the first spoken word', () => {
    const a = new ScriptAligner(SCRIPT);
    const r = a.update('hey');
    expect(r.kind).toBe('advance');
    expect(r.cursor).toBe(0);
  });

  it('tolerates recognition errors', () => {
    const a = new ScriptAligner(SCRIPT);
    const words = scriptWords(0, 20);
    words[5] = 'chanel'; // misspelling
    words[9] = 'wanna'; // wrong word
    words[14] = 'symbol'; // wrong word
    speak(a, words);
    expect(a.cursor).toBeGreaterThanOrEqual(18);
  });

  it('holds position during silence and repeated hypotheses', () => {
    const a = new ScriptAligner(SCRIPT);
    const { hyp } = speak(a, scriptWords(0, 10));
    const before = a.cursor;
    for (let i = 0; i < 5; i++) expect(a.update(hyp.join(' ')).kind).toBe('hold');
    expect(a.cursor).toBe(before);
  });

  it('does not jump backward when the speaker repeats a phrase', () => {
    const a = new ScriptAligner(SCRIPT);
    const { hyp } = speak(a, scriptWords(0, 22));
    const before = a.cursor;
    // Speaker stumbles and repeats the last three words.
    const { results } = speak(a, scriptWords(19, 22), hyp);
    results.forEach((r) => expect(r.cursor).toBeGreaterThanOrEqual(before));
  });

  it('jumps forward when the speaker skips a sentence, after confirmation', () => {
    const a = new ScriptAligner(SCRIPT);
    const tokens = tokenize(SCRIPT);
    const secondIdx = tokens.findIndex((t) => t.norm === 'second');
    const { hyp } = speak(a, scriptWords(0, 20));
    expect(a.cursor).toBe(19);
    // Skip directly to "Second, read it out loud once…"
    const { results } = speak(a, scriptWords(secondIdx, secondIdx + 6), hyp);
    expect(a.cursor).toBe(secondIdx + 5);
    expect(results.some((r) => r.kind === 'jump')).toBe(true);
  });

  it('ignores a single coincidental far match', () => {
    const a = new ScriptAligner(SCRIPT);
    speak(a, scriptWords(0, 12));
    const before = a.cursor;
    // "short" appears far ahead; one word must not trigger a jump.
    a.update('um short');
    expect(a.cursor).toBe(before);
  });

  it('moves back only when the speaker clearly restarts an earlier passage', () => {
    const a = new ScriptAligner(SCRIPT);
    const { hyp } = speak(a, scriptWords(0, 40));
    expect(a.cursor).toBe(39);
    a.resetUtterance();
    const { results } = speak(a, scriptWords(14, 22));
    expect(results.some((r) => r.kind === 'back')).toBe(true);
    expect(a.cursor).toBe(21);
    expect(hyp.length).toBe(40);
  });

  it('prefers the nearest occurrence of a phrase repeated in the script', () => {
    const script = 'easier to fix and easier to edit and then easier to fix again';
    const a = new ScriptAligner(script);
    speak(a, ['easier', 'to', 'fix']);
    expect(a.cursor).toBe(2);
  });

  it('handles an empty script and empty hypotheses', () => {
    const a = new ScriptAligner('');
    expect(a.update('hello there').kind).toBe('hold');
    const b = new ScriptAligner(SCRIPT);
    expect(b.update('').kind).toBe('hold');
    expect(b.cursor).toBe(-1);
  });

  it('supports manual override and maps characters to words', () => {
    const a = new ScriptAligner(SCRIPT);
    const idx = a.wordIndexAtChar(SCRIPT.indexOf('Second'));
    a.setCursor(idx);
    expect(a.tokens[a.cursor]!.norm).toBe('second');
    expect(a.charOffsetForCursor()).toBe(SCRIPT.indexOf('Second') + 'Second'.length);
  });

  it('works with non-Latin scripts (Hebrew)', () => {
    const script = 'שלום לכולם וברוכים הבאים לערוץ שלי היום נדבר על הקלטה';
    const a = new ScriptAligner(script);
    speak(a, ['שלום', 'לכולם', 'וברוכים', 'הבאים']);
    expect(a.cursor).toBe(3);
  });

  it('completes the full script under a noisy simulation', () => {
    const a = new ScriptAligner(SCRIPT);
    const all = scriptWords(0, a.wordCount);
    // Deterministic noise: drop every 9th word, corrupt every 7th.
    const noisy = all
      .filter((_, i) => i % 9 !== 8)
      .map((w, i) => (i % 7 === 6 ? `${w}x` : w));
    let hyp: string[] = [];
    // Recognizer restarts its utterance every 25 words.
    for (let i = 0; i < noisy.length; i++) {
      if (i % 25 === 0) {
        hyp = [];
        a.resetUtterance();
      }
      hyp.push(noisy[i]!);
      a.update(hyp.join(' '));
    }
    expect(a.cursor).toBeGreaterThanOrEqual(a.wordCount - 3);
  });

  it('accepts a large chunk delivered at once (final-only recognizers)', () => {
    const a = new ScriptAligner(SCRIPT);
    a.update(scriptWords(0, 12).join(' '));
    expect(a.cursor).toBe(11);
  });

  it('keeps per-update cost low on a long script', () => {
    const long = Array.from({ length: 60 }, () => SCRIPT).join('\n');
    const a = new ScriptAligner(long);
    const words = long.split(/\s+/).slice(0, 600);
    const t0 = Date.now();
    const hyp: string[] = [];
    for (const w of words) {
      hyp.push(w);
      if (hyp.length > 30) hyp.shift();
      a.update(hyp.join(' '));
    }
    const perUpdateMs = (Date.now() - t0) / words.length;
    expect(a.wordCount).toBeGreaterThan(4000);
    // Generous bound for CI machines; on-device budget is ~5 ms per update.
    expect(perUpdateMs).toBeLessThan(10);
    expect(a.cursor).toBeGreaterThan(550);
  });

  it('does not widen the step when the recognizer revises to fewer words', () => {
    const a = new ScriptAligner(SCRIPT);
    speak(a, scriptWords(0, 10));
    expect(a.cursor).toBe(9);
    // iOS resends a shorter, revised transcript whose tail is 9 words ahead:
    // that is a jump and must be confirmed, not accepted as normal progress.
    const revised = scriptWords(10, 19).join(' ');
    const first = a.update(revised);
    expect(first.kind).toBe('hold');
    expect(a.cursor).toBe(9);
    // A fresh utterance with the same words is a legitimate final-only chunk.
    a.resetUtterance();
    a.update(revised);
    expect(a.cursor).toBe(18);
  });

  describe('performance on a 10,000-word script', () => {
    const VOCAB = Array.from({ length: 1500 }, (_, i) => `w${i.toString(36)}x${(i * 7919).toString(36)}`);
    const words = Array.from({ length: 10000 }, (_, i) => VOCAB[(i * 7919) % VOCAB.length]!);
    const script = words.join(' ');

    it('bounds the cost of unrelated speech (far search)', () => {
      const a = new ScriptAligner(script);
      const unrelated = ['totally', 'unrelated', 'speech', 'about', 'weather', 'tomorrow', 'morning', 'coffee'];
      const hyp: string[] = [];
      const t0 = performance.now();
      for (let k = 0; k < 40; k++) {
        hyp.push(`${unrelated[k % unrelated.length]}${k}`);
        a.update(hyp.join(' '));
      }
      const perUpdateMs = (performance.now() - t0) / 40;
      expect(a.cursor).toBe(-1);
      // Before the vocabulary/similarity cache this was ~240 ms per update in Jest.
      expect(perUpdateMs).toBeLessThan(40);
    });

    it('still finds a far skipped section quickly', () => {
      const a = new ScriptAligner(script);
      speak(a, words.slice(0, 5));
      const far = words.slice(7000, 7008);
      const t0 = performance.now();
      speak(a, far, words.slice(0, 5));
      const ms = performance.now() - t0;
      // The vocabulary repeats every 1,500 words; the nearest copy ahead wins.
      expect(a.cursor).toBe(7007 % 1500);
      expect(ms / far.length).toBeLessThan(40);
    });
  });
});

describe('tokenize with combining marks', () => {
  it('keeps Hebrew niqqud and decomposed accents inside their word', () => {
    expect(tokenize('שָׁלוֹם עוֹלָם').map((t) => t.norm)).toEqual(['שלום', 'עולם']);
    expect(tokenize('re\u0301sume\u0301 ready').map((t) => t.norm)).toEqual(['resume', 'ready']);
  });
});
