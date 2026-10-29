import type { StudioRequest } from './types';

/** Same limits as the app; the server is the enforcement point. */
export const LIMITS = {
  maxScriptChars: 12_000,
  maxTopicChars: 300,
  maxKeyPointsChars: 1_500,
  maxAudienceChars: 200,
  minDurationSec: 10,
  maxDurationSec: 600,
  // 12,000 script chars × up to 3 UTF-8 bytes (CJK) + other fields + JSON overhead.
  maxBodyBytes: 64_000,
} as const;

const TOOLS = new Set(['generate', 'improve', 'shorten', 'conversational', 'hook', 'tone', 'platform']);
const PLATFORMS = new Set(['tiktok', 'reels', 'shorts', 'youtube']);
const TONES = new Set(['professional', 'friendly', 'energetic', 'educational', 'persuasive', 'humorous']);

const isStr = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max);

/** Returns a validated request or an error code. Unknown fields are dropped. */
export function parseStudioRequest(body: unknown): StudioRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'invalid_body' };
  const b = body as Record<string, unknown>;
  if (typeof b.tool !== 'string' || !TOOLS.has(b.tool)) return { error: 'unknown_tool' };
  if (!isStr(b.script, LIMITS.maxScriptChars)) return { error: 'script_too_long' };
  if (!isStr(b.topic, LIMITS.maxTopicChars)) return { error: 'topic_too_long' };
  if (!isStr(b.keyPoints, LIMITS.maxKeyPointsChars)) return { error: 'key_points_too_long' };
  if (!isStr(b.audience, LIMITS.maxAudienceChars)) return { error: 'audience_too_long' };
  // A language tag (e.g. "he", "en-US"): it is placed in the prompt outside the data tags.
  if (b.language !== undefined && (typeof b.language !== 'string' || !/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,2}$/.test(b.language))) {
    return { error: 'invalid_language' };
  }
  if (b.platform !== undefined && (typeof b.platform !== 'string' || !PLATFORMS.has(b.platform))) return { error: 'invalid_platform' };
  if (b.tone !== undefined && (typeof b.tone !== 'string' || !TONES.has(b.tone))) return { error: 'invalid_tone' };
  if (
    b.durationSec !== undefined &&
    (typeof b.durationSec !== 'number' || !Number.isFinite(b.durationSec) || b.durationSec < LIMITS.minDurationSec || b.durationSec > LIMITS.maxDurationSec)
  ) {
    return { error: 'duration_out_of_range' };
  }
  const req = {
    tool: b.tool,
    script: b.script,
    topic: b.topic,
    keyPoints: b.keyPoints,
    audience: b.audience,
    platform: b.platform,
    tone: b.tone,
    durationSec: b.durationSec,
    language: b.language,
  } as StudioRequest;
  if (req.tool === 'generate' && !req.topic?.trim()) return { error: 'topic_required' };
  if (req.tool !== 'generate' && !req.script?.trim()) return { error: 'script_required' };
  if (req.tool === 'tone' && !req.tone) return { error: 'tone_required' };
  if (req.tool === 'platform' && !req.platform) return { error: 'platform_required' };
  return req;
}
