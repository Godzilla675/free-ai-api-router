import { describe, expect, it } from 'vitest';
import { toSseErrorEvent } from '../src/streaming/errors.js';

describe('streaming error helpers', () => {
  it('normalizes errors to SSE error event bytes', () => {
    const event = toSseErrorEvent(new Error('boom'));
    expect(event).toContain('event: error');
    expect(event).toContain('"message":"boom"');
  });
});
