import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { AnthropicLlm, LlmError } from '../src/llm';

function llmReturning(parse: () => Promise<unknown>) {
  const llm = new AnthropicLlm('test-key', 'model');
  (llm as unknown as { client: unknown }).client = { messages: { parse } };
  return llm;
}

const usage = { input_tokens: 900, output_tokens: 40 };

describe('AnthropicLlm', () => {
  it('carries the billed usage on a refusal', async () => {
    const llm = llmReturning(async () => ({ stop_reason: 'refusal', usage, parsed_output: null }));
    const err = await llm.complete('s', 'u', false, 1000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ kind: 'refused', usage: { inputTokens: 900, outputTokens: 40 } });
  });

  it('carries the billed usage on unusable output', async () => {
    const llm = llmReturning(async () => ({ stop_reason: 'end_turn', usage, parsed_output: { script: '  ', alternatives: [] } }));
    await expect(llm.complete('s', 'u', false, 1000)).rejects.toMatchObject({ kind: 'bad_output', usage: { inputTokens: 900, outputTokens: 40 } });
  });

  it('maps a client abort to an aborted error without usage', async () => {
    const llm = llmReturning(async () => {
      throw new Anthropic.APIUserAbortError();
    });
    await expect(llm.complete('s', 'u', false, 1000)).rejects.toMatchObject({ kind: 'aborted', usage: undefined });
  });
});
