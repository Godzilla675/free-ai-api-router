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
  return {
    ...request,
    input: request.messages.map((message) => ({
      role: message.role,
      content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: stringifyContent(message.content) }]
    })),
    max_output_tokens: request.max_tokens,
    messages: undefined
  };
}

export function responsesToChatResponse(response: OpenAIResponsesResponse): OpenAIChatResponse {
  const content = typeof response.output_text === 'string' ? response.output_text : JSON.stringify(response.output ?? '');
  return {
    id: response.id.startsWith('resp_') ? `chatcmpl_${response.id}` : response.id,
    object: 'chat.completion',
    created: response.created_at ?? Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...(response.usage ? { usage: response.usage as OpenAIChatResponse['usage'] } : {})
  };
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '').join('\n');
  }
  return content === undefined ? '' : String(content);
}
