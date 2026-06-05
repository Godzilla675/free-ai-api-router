import { describe, expect, it } from 'vitest';
import { chatToResponsesRequest, responsesToChatResponse } from '../src/translators/responses.js';

describe('responses translators', () => {
  it('converts chat requests to OpenAI Responses input', () => {
    const converted = chatToResponsesRequest({
      model: 'gpt-5-codex',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2
    });

    expect(converted.model).toBe('gpt-5-codex');
    expect(converted.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }]);
  });

  it('converts Responses output_text to chat completion shape', () => {
    const chat = responsesToChatResponse({
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      model: 'gpt-5-codex',
      output_text: 'hello back'
    });

    expect(chat.id).toBe('chatcmpl_resp_1');
    expect(chat.choices[0]?.message.content).toBe('hello back');
  });
});
