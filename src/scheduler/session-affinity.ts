import { createHash } from 'node:crypto';

interface SessionEntry {
  deploymentId: string;
  createdAt: number;
  lastAccessed: number;
}

export class SessionAffinityTracker {
  private readonly cache = new Map<string, SessionEntry>();

  constructor(
    private readonly ttlMs: number = 3_600_000,
    private readonly maxEntries: number = 10_000
  ) {}

  get(sessionKey: string, now = Date.now()): string | undefined {
    this.evictExpired(now);
    const entry = this.cache.get(sessionKey);
    if (!entry) {
      return undefined;
    }
    // Update LRU access timestamp
    entry.lastAccessed = now;
    return entry.deploymentId;
  }

  set(sessionKey: string, deploymentId: string, now = Date.now()): void {
    this.evictExpired(now);

    const existing = this.cache.get(sessionKey);
    if (existing) {
      existing.deploymentId = deploymentId;
      existing.createdAt = now; // Reset TTL on rewrite
      existing.lastAccessed = now;
      return;
    }

    if (this.cache.size >= this.maxEntries) {
      // Find the LRU entry
      let lruKey: string | undefined = undefined;
      let minLastAccessed = Infinity;
      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastAccessed < minLastAccessed) {
          minLastAccessed = entry.lastAccessed;
          lruKey = key;
        }
      }
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
      }
    }

    this.cache.set(sessionKey, {
      deploymentId,
      createdAt: now,
      lastAccessed: now
    });
  }

  private evictExpired(now: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export function extractSessionKey(
  headers: Record<string, string | string[] | undefined>,
  body: unknown
): string | undefined {
  // Helper to extract non-empty trimmed string
  const getHeader = (key: string): string | undefined => {
    const val = headers[key] ?? headers[key.toLowerCase()];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
    if (Array.isArray(val) && val[0] && typeof val[0] === 'string' && val[0].trim().length > 0) {
      return val[0].trim();
    }
    return undefined;
  };

  // 1. X-Session-ID
  const xSessionId = getHeader('X-Session-ID');
  if (xSessionId) return xSessionId;

  // 2. Session-Id
  const sessionId = getHeader('Session-Id');
  if (sessionId) return sessionId;

  // 3. Session_id
  const sessionIdUnderscore = getHeader('Session_id');
  if (sessionIdUnderscore) return sessionIdUnderscore;

  if (body && typeof body === 'object') {
    const bodyObj = body as Record<string, unknown>;

    // 4. body conversation_id
    if (typeof bodyObj.conversation_id === 'string' && bodyObj.conversation_id.trim().length > 0) {
      return bodyObj.conversation_id.trim();
    }

    // 5. hash of first 3 user/assistant message contents
    if (Array.isArray(bodyObj.messages)) {
      const messages = bodyObj.messages.filter(
        (m): m is { role: string; content?: unknown } =>
          m !== null &&
          typeof m === 'object' &&
          (m.role === 'user' || m.role === 'assistant')
      );
      if (messages.length > 0) {
        const firstThree = messages.slice(0, 3);
        const contents = firstThree
          .map((m) => {
            if (typeof m.content === 'string') {
              return m.content;
            }
            return JSON.stringify(m.content ?? '');
          })
          .join('|');
        return createHash('sha256').update(contents).digest('hex');
      }
    }
  }

  return undefined;
}
