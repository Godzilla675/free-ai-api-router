import type { ChatRequest, OpenAIChatResponse } from '../types.js';

export interface OpenAIResponsesRequest {
  model: string;
  input: unknown;
  stream?: boolean;
  temperature?: number;
  max_output_tokens?: number;
  [key: string]: unknown;
}

export interface OpenAIResponsesResponse {
  id: string;
  object: string;
  created_at?: number;
  model: string;
  output_text?: string;
  output?: unknown;
  usage?: unknown;
  [key: string]: unknown;
}

export function chatToResponsesRequest(request: ChatRequest): OpenAIResponsesRequest {
  const result: OpenAIResponsesRequest = {
    ...request,
    input: request.messages.map((message) => ({
      role: message.role,
      content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: stringifyContent(message.content) }]
    })),
    messages: undefined
  };
  if (request.max_tokens !== undefined) {
    result.max_output_tokens = request.max_tokens;
  }
  return result;
}

export function responsesToChatResponse(response: OpenAIResponsesResponse): OpenAIChatResponse {
  const content = typeof response.output_text === 'string' ? response.output_text : JSON.stringify(response.output ?? '');
  const result: OpenAIChatResponse = {
    id: response.id.startsWith('resp_') ? `chatcmpl_${response.id}` : response.id,
    object: 'chat.completion',
    created: response.created_at ?? Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
  };
  if (response.usage) {
    result.usage = response.usage as NonNullable<OpenAIChatResponse['usage']>;
  }
  return result;
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '').join('\n');
  }
  return content === undefined ? '' : String(content);
}
