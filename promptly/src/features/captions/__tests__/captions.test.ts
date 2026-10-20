import {
  Cue,
  TimedWord,
  assessTranscript,
  correctWithScript,
  cueAt,
  estimateWordsFromTranscript,
  formatSrtTime,
  hasWordLevelTiming,
  mergeWithNext,
  parseSrt,
  retimeCue,
  segmentWords,
  segmentsToWords,
  shiftAll,
  splitCue,
  toSrt,
  updateCueText,
} from '../captions';

function words(text: string, startMs = 0, wordMs = 300, gapMs = 50): TimedWord[] {
  let t = startMs;
  return text.split(' ').map((w) => {
    const word = { text: w, startMs: t, endMs: t + wordMs, confidence: 0.9 };
    t += wordMs + gapMs;
    return word;
  });
}

describe('segmentsToWords', () => {
  it('keeps word-level segments and splits phrase segments proportionally', () => {
    const out = segmentsToWords([
      { text: 'hello', startMs: 0, endMs: 400, confidence: 0.9 },
      { text: 'big world', startMs: 500, endMs: 1300, confidence: 0.8 },
    ]);
    expect(out.map((w) => w.text)).toEqual(['hello', 'big', 'world']);
    expect(out[1]!.startMs).toBe(500);
    expect(out[2]!.endMs).toBe(1300);
    expect(out[1]!.confidence).toBe(-1);
    expect(hasWordLevelTiming(out)).toBe(false);
    expect(hasWordLevelTiming(out.slice(0, 1))).toBe(true);
  });
});

describe('segmentWords', () => {
  it('breaks on sentence end, max words and pauses', () => {
    const w = [
      ...words('Hey everyone, welcome back.'),
      ...words('Today I want to show you three simple habits', 2000),
    ];
    const cues = segmentWords(w);
    expect(cues[0]!.text).toBe('Hey everyone,');
    expect(cues[1]!.text).toBe('welcome back.');
    cues.forEach((c) => {
      expect(c.text.split(' ').length).toBeLessThanOrEqual(5);
      expect(c.text.length).toBeLessThanOrEqual(28);
      expect(c.endMs).toBeGreaterThan(c.startMs);
    });
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.startMs).toBeGreaterThanOrEqual(cues[i - 1]!.endMs);
  });

  it('returns no cues for no speech', () => {
    expect(segmentWords([])).toEqual([]);
    expect(assessTranscript([]).hasSpeech).toBe(false);
  });

  it('pads very short cues without overlapping the next', () => {
    const w: TimedWord[] = [
      { text: 'Hi.', startMs: 0, endMs: 100, confidence: 1 },
      { text: 'There.', startMs: 300, endMs: 500, confidence: 1 },
    ];
    const cues = segmentWords(w);
    expect(cues[0]!.endMs).toBe(300);
    expect(cues[1]!.endMs).toBe(900);
  });
});

describe('correctWithScript', () => {
  const script = 'Write your script before you hit record. Most creators skip it.';

  it('replaces misrecognized words with script spelling and keeps timing', () => {
    const recognized = words('right your script before you hit recorded most creator skip it');
    const fixed = correctWithScript(recognized, script);
    expect(fixed.map((w) => w.text).join(' ')).toBe('right your script before you hit record. Most creators skip it.');
    expect(fixed.map((w) => w.startMs)).toEqual(recognized.map((w) => w.startMs));
  });

  it('keeps ad-libbed words that are not in the script', () => {
    const recognized = words('okay so write your script before you hit record');
    const fixed = correctWithScript(recognized, script);
    expect(fixed[0]!.text).toBe('okay');
    expect(fixed[1]!.text).toBe('so');
    expect(fixed[2]!.text).toBe('Write');
  });

  it('is a no-op without a script', () => {
    const recognized = words('hello there');
    expect(correctWithScript(recognized, '')).toEqual(recognized);
  });
});

describe('cue editing', () => {
  const base: Cue[] = [
    { id: 'c1', startMs: 0, endMs: 1000, text: 'one two three four' },
    { id: 'c2', startMs: 1000, endMs: 2000, text: 'five six' },
  ];

  it('edits text and normalizes whitespace', () => {
    expect(updateCueText(base, 'c2', '  five   SIX ')[1]!.text).toBe('five SIX');
  });

  it('retimes within neighbours and rejects too-short cues', () => {
    expect(retimeCue(base, 'c2', 500, 2500)[1]).toMatchObject({ startMs: 1000, endMs: 2500 });
    expect(retimeCue(base, 'c1', 0, 50)).toBe(base);
  });

  it('splits and merges', () => {
    const split = splitCue(base, 'c1', 2);
    expect(split.map((c) => c.text)).toEqual(['one two', 'three four', 'five six']);
    expect(split[0]!.endMs).toBe(split[1]!.startMs);
    expect(new Set(split.map((c) => c.id)).size).toBe(3);
    const merged = mergeWithNext(split, split[0]!.id);
    expect(merged[0]!.text).toBe('one two three four');
    expect(merged[0]!.endMs).toBe(1000);
  });

  it('shifts all cues and drops ones pushed before zero', () => {
    const shifted = shiftAll(base, -1500);
    expect(shifted).toHaveLength(1);
    expect(shifted[0]).toMatchObject({ startMs: 0, endMs: 500 });
  });

  it('finds the active cue', () => {
    expect(cueAt(base, 1500)?.id).toBe('c2');
    expect(cueAt(base, 2500)).toBeUndefined();
  });
});

describe('SRT', () => {
  it('formats timestamps', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(3_723_456)).toBe('01:02:03,456');
  });

  it('round-trips cues', () => {
    const cues: Cue[] = [
      { id: 'c1', startMs: 0, endMs: 1200, text: 'Hello world' },
      { id: 'c2', startMs: 1300, endMs: 2500, text: 'Second line' },
      { id: 'c3', startMs: 2600, endMs: 2700, text: '   ' },
    ];
    const srt = toSrt(cues);
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,200\nHello world\n\n2\n00:00:01,300 --> 00:00:02,500\nSecond line\n');
    const parsed = parseSrt(srt);
    expect(parsed.map(({ startMs, endMs, text }) => ({ startMs, endMs, text }))).toEqual([
      { startMs: 0, endMs: 1200, text: 'Hello world' },
      { startMs: 1300, endMs: 2500, text: 'Second line' },
    ]);
  });

  it('parses CRLF files', () => {
    expect(parseSrt('1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n')).toHaveLength(1);
  });
});

describe('estimateWordsFromTranscript', () => {
  it('spreads words over the span and flags them as estimated', () => {
    const w = estimateWordsFromTranscript('one two three', 0, 3000);
    expect(w.map((x) => x.text)).toEqual(['one', 'two', 'three']);
    expect(w[2]!.endMs).toBe(3000);
    expect(hasWordLevelTiming(w)).toBe(false);
    expect(estimateWordsFromTranscript('', 0, 1000)).toEqual([]);
  });
});
