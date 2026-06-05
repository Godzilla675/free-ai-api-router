import { describe, expect, it } from 'vitest';
import { normalizeProtocolFormat } from '../src/translators/types.js';
import { openAIToClaudeRequest } from '../src/translators/openai-to-claude.js';
import { claudeToOpenAIResponse } from '../src/translators/claude-to-openai.js';

describe('translator framework', () => {
  it('normalizes known protocol format names', () => {
    expect(normalizeProtocolFormat('OpenAI')).toBe('openai');
    expect(normalizeProtocolFormat('claude')).toBe('claude');
    expect(normalizeProtocolFormat('gemini')).toBe('gemini');
  });

  it('rejects unknown protocol format names', () => {
    expect(() => normalizeProtocolFormat('wat')).toThrow('Unknown protocol format');
  });

  it('translates OpenAI chat request to Claude messages request', () => {
    const result = openAIToClaudeRequest({
      model: 'claude-sonnet',
      messages: [
        { role: 'system', content: 'be concise' },
        { role: 'user', content: 'hello' }
      ],
      max_tokens: 100
    });

    expect(result).toEqual({
      model: 'claude-sonnet',
      system: 'be concise',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 100
    });
  });

  it('translates Claude text response to OpenAI chat response', () => {
    const result = claudeToOpenAIResponse({
      id: 'msg_1',
      model: 'claude-sonnet',
      content: [{ type: 'text', text: 'hi' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 2 }
    });

    expect(result.id).toBe('chatcmpl_msg_1');
    expect(result.choices[0]?.message.content).toBe('hi');
    expect(result.usage?.prompt_tokens).toBe(1);
  });
});
