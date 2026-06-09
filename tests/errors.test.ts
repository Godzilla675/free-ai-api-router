import { describe, it, expect } from 'vitest';
import { isRetryableError, RouterError, getErrorStatus, getRetryAfterMs, toOpenAIError } from '../src/errors.js';

describe('isRetryableError', () => {
  it('should return true if error is a RouterError with retryable=true', () => {
    const error = new RouterError('Test error', { retryable: true });
    expect(isRetryableError(error)).toBe(true);
  });

  it('should return false if error is a RouterError with retryable=false', () => {
    const error = new RouterError('Test error', { retryable: false });
    expect(isRetryableError(error)).toBe(false);
  });

  it('should evaluate based on status code if not explicitly set', () => {
    const error = new RouterError('Rate limited', { status: 429 }); // 429 is retryable
    expect(isRetryableError(error)).toBe(true);
  });

  it('should return true for known retryable HTTP status objects', () => {
    expect(isRetryableError({ status: 408 })).toBe(true); // Request Timeout
    expect(isRetryableError({ status: 429 })).toBe(true); // Too Many Requests
    expect(isRetryableError({ status: 500 })).toBe(true); // Internal Server Error
    expect(isRetryableError({ status: 502 })).toBe(true); // Bad Gateway
    expect(isRetryableError({ status: 503 })).toBe(true); // Service Unavailable
    expect(isRetryableError({ status: 504 })).toBe(true); // Gateway Timeout
  });

  it('should return false for known non-retryable HTTP status objects', () => {
    expect(isRetryableError({ status: 400 })).toBe(false); // Bad Request
    expect(isRetryableError({ status: 401 })).toBe(false); // Unauthorized
    expect(isRetryableError({ status: 403 })).toBe(false); // Forbidden
    expect(isRetryableError({ status: 404 })).toBe(false); // Not Found
    expect(isRetryableError({ status: 501 })).toBe(false); // Not Implemented
  });

  it('should support statusCode property as well', () => {
    expect(isRetryableError({ statusCode: 503 })).toBe(true);
    expect(isRetryableError({ statusCode: 400 })).toBe(false);
  });

  it('should return true for TypeError (typically network issues in fetch)', () => {
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(true);
  });

  it('should return true for Errors with specific messages like timeout', () => {
    expect(isRetryableError(new Error('timeout exceeded'))).toBe(true);
    expect(isRetryableError(new Error('network error'))).toBe(true);
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
  });

  it('should return false for generic Errors without retryable messages', () => {
    expect(isRetryableError(new Error('unknown error'))).toBe(false);
    expect(isRetryableError(new Error('invalid JSON'))).toBe(false);
  });

  it('should return false for non-error primitives and objects', () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError('error string')).toBe(false);
    expect(isRetryableError(123)).toBe(false);
    expect(isRetryableError({})).toBe(false);
  });
});

describe('getErrorStatus', () => {
  it('should return status from RouterError', () => {
    const error = new RouterError('Test', { status: 418 });
    expect(getErrorStatus(error)).toBe(418);
  });

  it('should return status from plain object', () => {
    expect(getErrorStatus({ status: 429 })).toBe(429);
  });

  it('should return statusCode from plain object', () => {
    expect(getErrorStatus({ statusCode: 503 })).toBe(503);
  });

  it('should return undefined if no status is found', () => {
    expect(getErrorStatus({})).toBeUndefined();
    expect(getErrorStatus(null)).toBeUndefined();
    expect(getErrorStatus(new Error())).toBeUndefined();
  });
});

describe('getRetryAfterMs', () => {
  it('should return undefined if not RouterError', () => {
    expect(getRetryAfterMs(new Error())).toBeUndefined();
  });

  it('should return undefined if no details or retryAfterMs', () => {
    const err = new RouterError('Test');
    expect(getRetryAfterMs(err)).toBeUndefined();
  });

  it('should return retryAfterMs if present and valid', () => {
    const err = new RouterError('Test', { details: { retryAfterMs: 1000 } });
    expect(getRetryAfterMs(err)).toBe(1000);
  });

  it('should return undefined if retryAfterMs is invalid', () => {
    const err = new RouterError('Test', { details: { retryAfterMs: '1000' } });
    expect(getRetryAfterMs(err)).toBeUndefined();
  });
});

describe('toOpenAIError', () => {
  it('should convert RouterError to OpenAI error format', () => {
    const err = new RouterError('Test error', { status: 429, code: 'rate_limited' });
    const result = toOpenAIError(err);
    expect(result).toEqual({
      status: 429,
      body: {
        error: {
          message: 'Test error',
          type: 'invalid_request_error',
          code: 'rate_limited'
        }
      }
    });
  });

  it('should redact sensitive information from message', () => {
    const err = new Error('Failed with Bearer sk-1234567890abcdef and api_key=secret-key');
    const result = toOpenAIError(err, 401);
    expect(result.body.error.message).toContain('Bearer [REDACTED]');
    expect(result.body.error.message).toContain('api_key=[REDACTED]');
    expect(result.body.error.message).not.toContain('sk-1234567890abcdef');
    expect(result.body.error.message).not.toContain('secret-key');
  });

  it('should correctly determine type based on status', () => {
    expect(toOpenAIError(new Error(), 500).body.error.type).toBe('server_error');
    expect(toOpenAIError(new Error(), 400).body.error.type).toBe('invalid_request_error');
  });
});
