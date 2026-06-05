export type AuthStatus = 'available' | 'cooldown' | 'disabled' | 'expired' | 'error';

export interface AuthQuotaState {
  exceeded?: boolean;
  reason?: string;
  nextRecoverAt?: string;
  backoffLevel?: number;
}

export interface AuthModelState {
  status: AuthStatus;
  unavailable?: boolean;
  nextRetryAfter?: string;
  lastError?: AuthErrorInfo;
  quota?: AuthQuotaState;
  updatedAt: string;
}

export interface AuthErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
  updatedAt: string;
}

export interface AuthRecord {
  id: string;
  provider: string;
  label?: string;
  prefix?: string;
  status: AuthStatus;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt?: string;
  nextRefreshAfter?: string;
  nextRetryAfter?: string;
  attributes?: Record<string, string>;
  metadata?: Record<string, unknown>;
  secrets?: Record<string, string>;
  quota?: AuthQuotaState;
  modelStates?: Record<string, AuthModelState>;
}

export type RedactedAuthRecord = Omit<AuthRecord, 'secrets'> & {
  secrets?: Record<string, '[REDACTED]'>;
};

export function redactAuthRecord(record: AuthRecord): RedactedAuthRecord {
  const { secrets, ...rest } = record;
  const redactedSecrets = secrets
    ? Object.fromEntries(Object.keys(secrets).map((key) => [key, '[REDACTED]' as const]))
    : undefined;

  return {
    ...rest,
    ...(redactedSecrets ? { secrets: redactedSecrets } : {})
  };
}
