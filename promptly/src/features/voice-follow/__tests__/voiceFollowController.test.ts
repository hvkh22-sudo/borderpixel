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
    expect(c.snapshot()).toMatchObject({ status: 'listening', cursor: 7 });
  });

  it('preserves position on error', () => {
    const c = new VoiceFollowController(SCRIPT);
    c.markStarted(0);
    c.handleResult({ transcript: 'write your script before', isFinal: false }, 100);
    c.handleError('audio-capture');
    expect(c.snapshot()).toMatchObject({ status: 'error', cursor: 3, error: 'audio-capture' });
  });
});
