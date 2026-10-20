export type StudioTool = 'generate' | 'improve' | 'shorten' | 'conversational' | 'hook' | 'tone' | 'platform';

/** Mirrors the app's StudioRequest (src/features/ai-script-studio/studio.ts). */
export interface StudioRequest {
  tool: StudioTool;
  script?: string;
  topic?: string;
  keyPoints?: string;
  audience?: string;
  platform?: 'tiktok' | 'reels' | 'shorts' | 'youtube';
  tone?: 'professional' | 'friendly' | 'energetic' | 'educational' | 'persuasive' | 'humorous';
  durationSec?: number;
  language?: string;
}

export interface StudioResponse {
  text: string;
  alternatives?: string[];
  remaining: number;
}

export type Plan = 'free' | 'subscription' | 'lifetime';

export interface Entitlement {
  plan: Plan;
  /** Number of AI credit packs purchased (non-consumable product purchases). */
  creditPacks: number;
}

export interface LlmResult {
  text: string;
  alternatives?: string[];
  inputTokens: number;
  outputTokens: number;
}

export interface LlmClient {
  complete(system: string, user: string, wantsAlternatives: boolean, signal?: AbortSignal): Promise<LlmResult>;
}
