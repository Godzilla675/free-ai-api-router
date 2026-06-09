import { describe, expect, it } from 'vitest';
import { toSseErrorEvent } from '../src/streaming/errors.js';

describe('streaming error helpers', () => {
  it('normalizes Error instances to SSE error event bytes', () => {
    const event = toSseErrorEvent(new Error('boom'));
    expect(event).toBe('event: error\ndata: {"error":{"message":"boom","type":"server_error","code":"stream_error"}}\n\n');
  });

  it('normalizes string errors to SSE error event bytes', () => {
    const event = toSseErrorEvent('string error');
    expect(event).toBe('event: error\ndata: {"error":{"message":"string error","type":"server_error","code":"stream_error"}}\n\n');
  });

  it('normalizes object errors to SSE error event bytes', () => {
    const event = toSseErrorEvent({ some: 'object' });
    expect(event).toBe('event: error\ndata: {"error":{"message":"[object Object]","type":"server_error","code":"stream_error"}}\n\n');
  });

  it('normalizes null errors to SSE error event bytes', () => {
    const event = toSseErrorEvent(null);
    expect(event).toBe('event: error\ndata: {"error":{"message":"null","type":"server_error","code":"stream_error"}}\n\n');
  });

  it('normalizes undefined errors to SSE error event bytes', () => {
    const event = toSseErrorEvent(undefined);
    expect(event).toBe('event: error\ndata: {"error":{"message":"undefined","type":"server_error","code":"stream_error"}}\n\n');
  });

  it('normalizes numeric errors to SSE error event bytes', () => {
    const event = toSseErrorEvent(404);
    expect(event).toBe('event: error\ndata: {"error":{"message":"404","type":"server_error","code":"stream_error"}}\n\n');
  });
});
