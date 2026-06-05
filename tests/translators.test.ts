import { describe, expect, it } from 'vitest';
import { normalizeProtocolFormat } from '../src/translators/types.js';

describe('translator framework', () => {
  it('normalizes known protocol format names', () => {
    expect(normalizeProtocolFormat('OpenAI')).toBe('openai');
    expect(normalizeProtocolFormat('claude')).toBe('claude');
    expect(normalizeProtocolFormat('gemini')).toBe('gemini');
  });

  it('rejects unknown protocol format names', () => {
    expect(() => normalizeProtocolFormat('wat')).toThrow('Unknown protocol format');
  });
});
