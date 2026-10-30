import { VoiceFollowController } from '../voiceFollowController';

const SCRIPT = 'Write your script before you hit record. Then read it out loud once. Keep your takes short.';

describe('VoiceFollowController', () => {
  it('moves through statuses while speaking, pausing and finishing', () => {
    const c = new VoiceFollowController(SCRIPT, { silenceAfterMs: 1000, lostAfterMs: 3000 });
    const statuses: string[] = [];
    c.subscribe((s) => statuses.push(s.status));
    c.markStarting();
    c.markStarted(0);
    c.handleResult({ transcript: 'write your script', isFinal: false }, 100);
    expect(c.snapshot()).toMatchObject({ status: 'speaking', cursor: 2 });
    c.tick(1200);
    expect(c.snapshot().status).toBe('listening');
    c.handleResult({ transcript: 'write your script before you hit record', isFinal: true }, 2000);
    c.handleResult({ transcript: 'then read it out loud once keep your takes short', isFinal: true }, 3000);
    expect(c.snapshot().status).toBe('finished');
    expect(statuses).toContain('starting');
  });

  it('reports lost when speech does not match the script', () => {
    const c = new VoiceFollowController(SCRIPT, { silenceAfterMs: 2000, lostAfterMs: 1500 });
    c.markStarted(0);
    c.handleResult({ transcript: 'write your script', isFinal: false }, 100);
    for (let t = 600; t <= 2000; t += 500) {
      c.handleResult({ transcript: `unrelated banter number ${t}`, isFinal: false }, t);
      c.tick(t);
    }
    expect(c.snapshot().status).toBe('lost');
    // User taps "Then" to resync.
    c.resyncToChar(SCRIPT.indexOf('Then'), 2100);
    // "Then" itself has not been read yet: the cursor sits on the word before it.
    expect(c.snapshot()).toMatchObject({ status: 'listening', cursor: 6 });
  });

  it('keeps a tap/restart even though the recognizer still holds the words said before it', () => {
    const words = SCRIPT.split(/\s+/);
    const c = new VoiceFollowController(SCRIPT);
    c.markStarted(0);
    // One cumulative transcript (iOS < 18, or mid-segment on Android) read up to word 8.
    let said = words.slice(0, 9).join(' ');
    for (let i = 1; i <= 9; i++) c.handleResult({ transcript: words.slice(0, i).join(' '), isFinal: false }, i * 100);
    const before = c.snapshot().cursor;
    expect(before).toBeGreaterThan(4);
    c.resyncToChar(0, 1000); // Restart from the top
    expect(c.snapshot().cursor).toBe(-1);
    said = `${said} ${words[0]}`;
    c.handleResult({ transcript: said, isFinal: false }, 1100);
    expect(c.snapshot().cursor).toBeLessThan(before);
    expect(c.snapshot().cursor).toBeLessThanOrEqual(0);
  });

  it('does not flash "lost" when speech resumes after a pause', () => {
    const c = new VoiceFollowController(SCRIPT, { silenceAfterMs: 2000, lostAfterMs: 5000 });
    c.markStarted(0);
    c.handleResult({ transcript: 'write your script', isFinal: false }, 100);
    for (let t = 500; t <= 8000; t += 500) c.tick(t);
    expect(c.snapshot().status).toBe('listening');
    c.handleResult({ transcript: 'uh', isFinal: false }, 8100);
    c.tick(8200);
    expect(c.snapshot().status).not.toBe('lost');
  });

  it('preserves position on error', () => {
    const c = new VoiceFollowController(SCRIPT);
    c.markStarted(0);
    c.handleResult({ transcript: 'write your script before', isFinal: false }, 100);
    c.handleError('audio-capture');
    expect(c.snapshot()).toMatchObject({ status: 'error', cursor: 3, error: 'audio-capture' });
  });
});

describe('VoiceFollowController after stop', () => {
  it('ignores a final result and errors delivered after stop()', () => {
    const c = new VoiceFollowController(SCRIPT);
    c.markStarted(0);
    c.handleResult({ transcript: 'write your script', isFinal: false }, 100);
    c.stop();
    const before = c.snapshot();
    c.handleResult({ transcript: 'write your script before you hit record then read it out loud once keep your takes short', isFinal: true }, 200);
    c.handleError('network');
    expect(c.snapshot()).toEqual(before);
    expect(c.snapshot().status).toBe('idle');
  });
});
