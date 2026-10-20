/**
 * AI Script Studio — client-side request model, validation and version
 * history. Prompts live on the server (server/src/prompts.ts) so they can be
 * improved without app releases and never ship provider secrets.
 */

export type StudioTool = 'generate' | 'improve' | 'shorten' | 'conversational' | 'hook' | 'tone' | 'platform';

export type Platform = 'tiktok' | 'reels' | 'shorts' | 'youtube';
export type Tone = 'professional' | 'friendly' | 'energetic' | 'educational' | 'persuasive' | 'humorous';

export const PLATFORMS: Platform[] = ['tiktok', 'reels', 'shorts', 'youtube'];
export const TONES: Tone[] = ['professional', 'friendly', 'energetic', 'educational', 'persuasive', 'humorous'];
export const TOOLS: StudioTool[] = ['generate', 'improve', 'shorten', 'conversational', 'hook', 'tone', 'platform'];

export interface StudioRequest {
  tool: StudioTool;
  /** Existing script (all tools except generate). */
  script?: string;
  topic?: string;
  keyPoints?: string;
  audience?: string;
  platform?: Platform;
  tone?: Tone;
  /** Target spoken duration in seconds. */
  durationSec?: number;
  /** BCP-47 language for the output; defaults to the script language. */
  language?: string;
}

export const LIMITS = {
  maxScriptChars: 12_000,
  maxTopicChars: 300,
  maxKeyPointsChars: 1_500,
  maxAudienceChars: 200,
  minDurationSec: 10,
  maxDurationSec: 600,
} as const;

export type ValidationError =
  | 'script_required'
  | 'script_too_long'
  | 'topic_required'
  | 'topic_too_long'
  | 'key_points_too_long'
  | 'audience_too_long'
  | 'duration_out_of_range'
  | 'tone_required'
  | 'platform_required'
  | 'unknown_tool';

export function validateStudioRequest(r: StudioRequest): ValidationError | null {
  if (!TOOLS.includes(r.tool)) return 'unknown_tool';
  if (r.tool === 'generate') {
    if (!r.topic?.trim()) return 'topic_required';
    if (r.topic.length > LIMITS.maxTopicChars) return 'topic_too_long';
    if ((r.keyPoints?.length ?? 0) > LIMITS.maxKeyPointsChars) return 'key_points_too_long';
    if ((r.audience?.length ?? 0) > LIMITS.maxAudienceChars) return 'audience_too_long';
  } else {
    if (!r.script?.trim()) return 'script_required';
    if (r.script.length > LIMITS.maxScriptChars) return 'script_too_long';
  }
  if (r.durationSec != null && (r.durationSec < LIMITS.minDurationSec || r.durationSec > LIMITS.maxDurationSec)) {
    return 'duration_out_of_range';
  }
  if (r.tool === 'tone' && !r.tone) return 'tone_required';
  if (r.tool === 'platform' && !r.platform) return 'platform_required';
  return null;
}

/** Hook tool returns alternatives; other tools return a full script. */
export interface StudioResponse {
  text: string;
  alternatives?: string[];
  /** Remaining AI requests/credits as reported by the server. */
  remaining: number;
}

// ---------- Version history (never lose the original) ----------

export interface ScriptVersion {
  id: string;
  text: string;
  source: 'original' | 'manual' | StudioTool;
  createdAt: number;
}

export interface VersionHistory {
  versions: ScriptVersion[];
  /** Index of the version currently applied to the script. */
  current: number;
}

export function createHistory(original: string, now: number): VersionHistory {
  return { versions: [{ id: 'v1', text: original, source: 'original', createdAt: now }], current: 0 };
}

export const MAX_VERSIONS = 30;

/** Applying a new version drops any redo branch but always keeps the original. */
export function pushVersion(h: VersionHistory, text: string, source: ScriptVersion['source'], now: number): VersionHistory {
  const currentText = h.versions[h.current]?.text;
  if (currentText === text) return h;
  let versions = h.versions.slice(0, h.current + 1);
  const id = `v${Math.max(...h.versions.map((v) => Number(v.id.slice(1)) || 0)) + 1}`;
  versions.push({ id, text, source, createdAt: now });
  if (versions.length > MAX_VERSIONS) {
    versions = [versions[0]!, ...versions.slice(versions.length - (MAX_VERSIONS - 1))];
  }
  return { versions, current: versions.length - 1 };
}

export function undo(h: VersionHistory): VersionHistory {
  return h.current > 0 ? { ...h, current: h.current - 1 } : h;
}

export function redo(h: VersionHistory): VersionHistory {
  return h.current < h.versions.length - 1 ? { ...h, current: h.current + 1 } : h;
}

export function currentText(h: VersionHistory): string {
  return h.versions[h.current]?.text ?? '';
}

/** Simple word-level diff for the compare view (LCS on words). */
export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string };

export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter((s) => s.length > 0);
  const b = after.split(/(\s+)/).filter((s) => s.length > 0);
  const m = a.length;
  const n = b.length;
  // Guard against pathological sizes on-device.
  if (m * n > 4_000_000) {
    return [
      { kind: 'removed', text: before },
      { kind: 'added', text: after },
    ];
  }
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      push('same', a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push('removed', a[i++]!);
    } else {
      push('added', b[j++]!);
    }
  }
  while (i < m) push('removed', a[i++]!);
  while (j < n) push('added', b[j++]!);
  return parts;
}
