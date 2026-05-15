export class RouterError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(message: string, options: { status?: number; code?: string; retryable?: boolean; details?: unknown } = {}) {
    super(message);
    this.name = 'RouterError';
    this.status = options.status ?? 500;
    this.code = options.code ?? 'router_error';
    this.retryable = options.retryable ?? isRetryableStatus(this.status);
    this.details = options.details;
  }
}

export function getRetryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof RouterError) || typeof error.details !== 'object' || error.details === null) {
    return undefined;
  }
  const retryAfterMs = (error.details as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) ? retryAfterMs : undefined;
}

export function isRetryableStatus(status: number | undefined): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function getErrorStatus(error: unknown): number | undefined {
  if (error instanceof RouterError) {
    return error.status;
  }
  if (typeof error === 'object' && error !== null) {
    const maybeStatus = (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
    if (typeof maybeStatus === 'number') {
      return maybeStatus;
    }
  }
  return undefined;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof RouterError) {
    return error.retryable;
  }
  const status = getErrorStatus(error);
  if (status !== undefined) {
    return isRetryableStatus(status);
  }
  return error instanceof TypeError || (error instanceof Error && /timeout|network|fetch failed|ECONNRESET|ETIMEDOUT/i.test(error.message));
}

export function toOpenAIError(error: unknown, fallbackStatus = 500): { status: number; body: { error: { message: string; type: string; code: string } } } {
  const status = getErrorStatus(error) ?? fallbackStatus;
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof RouterError ? error.code : statusToCode(status);
  return {
    status,
    body: {
      error: {
        message,
        type: status >= 500 ? 'server_error' : 'invalid_request_error',
        code
      }
    }
  };
}

function statusToCode(status: number): string {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit_exceeded';
  if (status >= 500) return 'upstream_error';
  return 'bad_request';
}
