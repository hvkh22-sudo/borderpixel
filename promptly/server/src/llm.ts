import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import type { LlmClient, LlmResult } from './types';

const OutputSchema = z.object({
  script: z.string(),
  alternatives: z.array(z.string()),
});

export class LlmError extends Error {
  constructor(
    readonly kind: 'rate_limited' | 'overloaded' | 'refused' | 'bad_output' | 'upstream',
    message?: string,
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
    private readonly maxTokens: number,
  ) {
    // SDK retries 429/5xx with backoff; keep it short so the app's 45 s timeout holds.
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 40_000 });
  }

  async complete(system: string, user: string, _wantsAlternatives: boolean, signal?: AbortSignal): Promise<LlmResult> {
    try {
      const response = await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { effort: 'low', format: zodOutputFormat(OutputSchema) },
        },
        { signal },
      );
      if (response.stop_reason === 'refusal') throw new LlmError('refused');
      const out = response.parsed_output;
      if (!out || !out.script.trim()) throw new LlmError('bad_output');
      return {
        text: out.script.trim(),
        alternatives: out.alternatives.map((a) => a.trim()).filter(Boolean).slice(0, 3),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (e instanceof Anthropic.RateLimitError) throw new LlmError('rate_limited');
      if (e instanceof Anthropic.InternalServerError) throw new LlmError('overloaded');
      if (e instanceof Anthropic.APIConnectionError) throw new LlmError('upstream', 'connection');
      if (e instanceof Anthropic.APIError) throw new LlmError('upstream', `status ${e.status}`);
      throw new LlmError('upstream');
    }
  }
}
