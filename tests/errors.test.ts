import { describe, expect, it } from 'vitest';
import { toOpenAIError } from '../src/errors.js';

describe('toOpenAIError', () => {
  it('handles generic Error objects', () => {
    const error = new Error('test message');
    const result = toOpenAIError(error);

    expect(result).toEqual({
      status: 500,
      body: {
        error: {
          message: 'test message',
          type: 'server_error',
          code: 'upstream_error'
        }
      }
    });
  });

  it('handles non-Error objects (e.g. strings)', () => {
    const error = 'string error message';
    const result = toOpenAIError(error);

    expect(result).toEqual({
      status: 500,
      body: {
        error: {
          message: 'string error message',
          type: 'server_error',
          code: 'upstream_error'
        }
      }
    });
  });
});
