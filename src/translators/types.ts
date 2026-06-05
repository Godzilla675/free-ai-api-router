export type ProtocolFormat = 'openai' | 'claude' | 'gemini' | 'codex';

export interface TranslationContext {
  model: string;
  stream: boolean;
}

export interface Translator {
  readonly from: ProtocolFormat;
  readonly to: ProtocolFormat;
  translateRequest(input: unknown, context: TranslationContext): unknown;
  translateResponse(input: unknown, context: TranslationContext): unknown;
}

export function normalizeProtocolFormat(value: string): ProtocolFormat {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'claude' || normalized === 'gemini' || normalized === 'codex') {
    return normalized;
  }
  throw new Error(`Unknown protocol format: ${value}`);
}
