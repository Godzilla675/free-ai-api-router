import type { OpenAIChatResponse } from '../types.js';

export function claudeToOpenAIResponse(response: {
  id: string;
  model: string;
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}): OpenAIChatResponse {
  const content = (response.content ?? []).filter((part) => part.type === 'text' || part.text).map((part) => part.text ?? '').join('');
  const usage: Record<string, number> = {};
  if (response.usage?.input_tokens !== undefined) {
    usage.prompt_tokens = response.usage.input_tokens;
  }
  if (response.usage?.output_tokens !== undefined) {
    usage.completion_tokens = response.usage.output_tokens;
  }
  usage.total_tokens = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  return {
    id: response.id.startsWith('msg_') ? `chatcmpl_${response.id}` : response.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: response.stop_reason ?? 'stop' }],
    usage
  };
}
