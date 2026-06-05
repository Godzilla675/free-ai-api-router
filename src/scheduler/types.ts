export interface SelectionResult {
  deploymentId: string;
  providerId: string;
  reason: string;
  retryAfterMs?: number;
}

export interface AuthSnapshot {
  id: string;
  providerId: string;
  enabled: boolean;
}
