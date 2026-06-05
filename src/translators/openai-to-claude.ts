import type { ChatRequest } from '../types.js';

export function openAIToClaudeRequest(request: ChatRequest): Record<string, unknown> {
  const system = request.messages.filter((m) => m.role === 'system').map((m) => text(m.content)).join('\n');
  const messages = request.messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: text(m.content)
  }));
  return {
    model: request.model,
    ...(system ? { system } : {}),
    messages,
    max_tokens: request.max_tokens ?? 4096,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {})
  };
}

function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '').join('\n');
  return content === undefined ? '' : String(content);
}
