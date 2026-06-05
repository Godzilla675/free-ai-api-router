import type { OpenAIChatResponse } from '../types.js';

export function geminiToOpenAIResponse(response: {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}, model: string): OpenAIChatResponse {
  const candidate = response.candidates?.[0];
  const content = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';

  const usage: Record<string, number> = {};
  if (response.usageMetadata?.promptTokenCount !== undefined) {
    usage.prompt_tokens = response.usageMetadata.promptTokenCount;
  }
  if (response.usageMetadata?.candidatesTokenCount !== undefined) {
    usage.completion_tokens = response.usageMetadata.candidatesTokenCount;
  }
  if (response.usageMetadata?.totalTokenCount !== undefined) {
    usage.total_tokens = response.usageMetadata.totalTokenCount;
  }

  return {
    id: `chatcmpl_gemini_${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: candidate?.finishReason?.toLowerCase() ?? 'stop' }],
    ...(Object.keys(usage).length > 0 ? { usage } : {})
  };
}
