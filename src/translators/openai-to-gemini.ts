import type { ChatMessage, ChatRequest } from '../types.js';

export function openAIToGeminiRequest(request: ChatRequest): Record<string, unknown> {
  const systemMessages = request.messages.filter((message) => message.role === 'system');
  const conversationMessages = request.messages.filter((message) => message.role !== 'system');
  return {
    contents: conversationMessages.map(toGeminiContent),
    ...(systemMessages.length > 0 ? { systemInstruction: { parts: systemMessages.map((message) => ({ text: text(message.content) })) } } : {}),
    generationConfig: {
      ...(request.max_tokens !== undefined ? { maxOutputTokens: request.max_tokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.top_p !== undefined ? { topP: request.top_p } : {})
    }
  };
}

function toGeminiContent(message: ChatMessage): Record<string, unknown> {
  return {
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: text(message.content) }]
  };
}

function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '').join('\n');
  }
  return content === undefined ? '' : String(content);
}
