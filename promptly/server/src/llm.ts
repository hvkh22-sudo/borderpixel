import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type { LlmClient, LlmResult } from './types';

const OutputSchema = z.object({
  script: z.string(),
  alternatives: z.array(z.string()),
});

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export class LlmError extends Error {
  constructor(
    readonly kind: 'rate_limited' | 'overloaded' | 'refused' | 'bad_output' | 'aborted' | 'upstream',
    message?: string,
    /** Tokens billed for the failed call, when the provider reported them. */
    readonly usage?: LlmUsage,
  ) {
    super(message ?? kind);
  }
}

/** Claude-backed implementation. Model is configuration so it can change without a deploy. */
export class AnthropicLlm implements LlmClient {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    // No SDK retries: a retried call can be billed twice and outlast the app's 45 s timeout.
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: 40_000 });
  }

  async complete(system: string, user: string, _wantsAlternatives: boolean, maxTokens: number, signal?: AbortSignal): Promise<LlmResult> {
    try {
      const response = await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { effort: 'low', format: zodOutputFormat(OutputSchema) },
        },
        { signal },
      );
      // Refused and unusable completions are still billed: report their usage.
      const usage: LlmUsage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
      if (response.stop_reason === 'refusal') throw new LlmError('refused', undefined, usage);
      const out = response.parsed_output;
      if (!out || !out.script.trim()) throw new LlmError('bad_output', undefined, usage);
      return {
        text: out.script.trim(),
        alternatives: out.alternatives.map((a) => a.trim()).filter(Boolean).slice(0, 3),
        ...usage,
      };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (e instanceof Anthropic.APIUserAbortError) throw new LlmError('aborted');
      if (e instanceof Anthropic.RateLimitError) throw new LlmError('rate_limited');
      if (e instanceof Anthropic.InternalServerError) throw new LlmError('overloaded');
      if (e instanceof Anthropic.APIConnectionError) throw new LlmError('upstream', 'connection');
      if (e instanceof Anthropic.APIError) throw new LlmError('upstream', `status ${e.status}`);
      throw new LlmError('upstream');
    }
  }
}
