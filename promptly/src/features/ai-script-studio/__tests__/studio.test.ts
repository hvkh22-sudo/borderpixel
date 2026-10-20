import {
  MAX_VERSIONS,
  applyHook,
  createHistory,
  currentText,
  diffWords,
  pushVersion,
  redo,
  undo,
  validateStudioRequest,
} from '../studio';

describe('validateStudioRequest', () => {
  it('requires a topic for generate and a script otherwise', () => {
    expect(validateStudioRequest({ tool: 'generate' })).toBe('topic_required');
    expect(validateStudioRequest({ tool: 'generate', topic: 'Morning routine' })).toBeNull();
    expect(validateStudioRequest({ tool: 'shorten', script: '  ' })).toBe('script_required');
    expect(validateStudioRequest({ tool: 'shorten', script: 'x'.repeat(12_001) })).toBe('script_too_long');
  });

  it('checks tool-specific fields and duration range', () => {
    expect(validateStudioRequest({ tool: 'tone', script: 'hi' })).toBe('tone_required');
    expect(validateStudioRequest({ tool: 'platform', script: 'hi' })).toBe('platform_required');
    expect(validateStudioRequest({ tool: 'improve', script: 'hi', durationSec: 5 })).toBe('duration_out_of_range');
    expect(validateStudioRequest({ tool: 'nope' as never })).toBe('unknown_tool');
  });
});

describe('version history', () => {
  it('supports undo/redo and keeps the original', () => {
    let h = createHistory('original', 0);
    h = pushVersion(h, 'shorter', 'shorten', 1);
    h = pushVersion(h, 'punchier', 'hook', 2);
    expect(currentText(h)).toBe('punchier');
    h = undo(undo(undo(h)));
    expect(currentText(h)).toBe('original');
    h = redo(h);
    expect(currentText(h)).toBe('shorter');
    // New edit drops redo branch.
    h = pushVersion(h, 'manual edit', 'manual', 3);
    expect(h.versions.map((v) => v.text)).toEqual(['original', 'shorter', 'manual edit']);
  });

  it('caps history size without dropping the original', () => {
    let h = createHistory('original', 0);
    for (let i = 0; i < MAX_VERSIONS + 10; i++) h = pushVersion(h, `v${i}`, 'improve', i);
    expect(h.versions).toHaveLength(MAX_VERSIONS);
    expect(h.versions[0]!.text).toBe('original');
    expect(new Set(h.versions.map((v) => v.id)).size).toBe(MAX_VERSIONS);
  });

  it('ignores no-op versions', () => {
    const h = createHistory('same', 0);
    expect(pushVersion(h, 'same', 'improve', 1)).toBe(h);
  });
});

describe('diffWords', () => {
  it('marks added and removed words', () => {
    const d = diffWords('the quick brown fox', 'the slow brown fox jumps');
    expect(d.filter((p) => p.kind === 'removed').map((p) => p.text.trim())).toEqual(['quick']);
    expect(d.filter((p) => p.kind === 'added').map((p) => p.text.trim()).join(' ')).toContain('slow');
    expect(d.map((p) => (p.kind === 'removed' ? '' : p.text)).join('')).toBe('the slow brown fox jumps');
  });
});

describe('applyHook', () => {
  it('replaces only the opening line or sentence', () => {
    expect(applyHook('Old opening.\n\nBody here.', 'New hook!')).toBe('New hook!\n\nBody here.');
    expect(applyHook('First line\nsecond line', 'Hook')).toBe('Hook\nsecond line');
    expect(applyHook('First sentence. Second sentence.', 'Hook!')).toBe('Hook! Second sentence.');
    expect(applyHook('Wow?! Then more.', 'Hook.')).toBe('Hook. Then more.');
    expect(applyHook('大家好。今天我们聊聊', '注意！')).toBe('注意！今天我们聊聊');
  });

  it('prepends when the script is a single unbroken opening, and uses the hook for an empty script', () => {
    expect(applyHook('Just one line without an end', 'Hook')).toBe('Hook\n\nJust one line without an end');
    expect(applyHook('Only one sentence.', 'Hook')).toBe('Hook\n\nOnly one sentence.');
    expect(applyHook('   ', 'Hook')).toBe('Hook');
  });
});
