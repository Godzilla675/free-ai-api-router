import { describe, expect, it } from 'vitest';
import { normalizeProtocolFormat } from '../src/translators/types.js';
import { openAIToClaudeRequest } from '../src/translators/openai-to-claude.js';
import { claudeToOpenAIResponse } from '../src/translators/claude-to-openai.js';
import { openAIToGeminiRequest } from '../src/translators/openai-to-gemini.js';
import { geminiToOpenAIResponse } from '../src/translators/gemini-to-openai.js';

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

  it('maps generation config properties (max_tokens, temperature, top_p) to Gemini request', () => {
    const result = openAIToGeminiRequest({
      model: 'gemini-3-pro',
      messages: [
        { role: 'user', content: 'hello' }
      ],
      max_tokens: 150,
      temperature: 0.7,
      top_p: 0.9
    });

    expect(result.generationConfig).toEqual({
      maxOutputTokens: 150,
      temperature: 0.7,
      topP: 0.9
    });
  });

  it('translates OpenAI chat request to Gemini generateContent request', () => {
    const result = openAIToGeminiRequest({
      model: 'gemini-3-pro',
      messages: [
        { role: 'system', content: 'be concise' },
        { role: 'user', content: 'hello' }
      ],
      max_tokens: 100
    });

    expect(result).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      systemInstruction: { parts: [{ text: 'be concise' }] },
      generationConfig: { maxOutputTokens: 100 }
    });
  });

  it('translates Gemini text response to OpenAI chat response', () => {
    const result = geminiToOpenAIResponse({
      candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 }
    }, 'gemini-3-pro');

    expect(result.model).toBe('gemini-3-pro');
    expect(result.choices[0]?.message.content).toBe('hi');
    expect(result.usage?.prompt_tokens).toBe(1);
    expect(result.usage?.completion_tokens).toBe(2);
    expect(result.usage?.total_tokens).toBe(3);
  });

  it('handles Gemini response with missing usageMetadata', () => {
    const result = geminiToOpenAIResponse({
      candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }]
    }, 'gemini-3-pro');

    expect(result.model).toBe('gemini-3-pro');
    expect(result.choices[0]?.message.content).toBe('hi');
    expect(result.usage).toBeUndefined();
  });

  it('handles Gemini response with partial usageMetadata', () => {
    const result = geminiToOpenAIResponse({
      candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10 }
    }, 'gemini-3-pro');

    expect(result.usage).toBeDefined();
    expect(result.usage?.prompt_tokens).toBe(10);
    expect(result.usage?.completion_tokens).toBeUndefined();
    expect(result.usage?.total_tokens).toBeUndefined();
  });
});
