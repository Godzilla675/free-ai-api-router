import type { AuthRecord } from '../types.js';

export interface AuthProviderHandler {
  refresh?(record: AuthRecord): Promise<AuthRecord>;
}
