import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { UsageEvent } from './types.js';

export interface UsageRecorder {
  record(event: UsageEvent): Promise<void>;
  recent(limit?: number): Promise<UsageEvent[]>;
}

export class JsonlUsageRecorder implements UsageRecorder {
  constructor(private readonly path?: string) {}

  async record(event: UsageEvent): Promise<void> {
    if (!this.path) {
      return;
    }
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(event)}\n`, { flag: 'a' });
  }

  async recent(limit = 100): Promise<UsageEvent[]> {
    if (!this.path) {
      return [];
    }
    try {
      const content = await readFile(this.path, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean).slice(-limit);
      const usage: UsageEvent[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object') {
            usage.push(parsed);
          }
        } catch (e) {
          console.warn('Failed to parse usage line:', e);
        }
      }
      return usage;
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}

export class MemoryUsageRecorder implements UsageRecorder {
  private readonly events: UsageEvent[] = [];

  async record(event: UsageEvent): Promise<void> {
    this.events.push(event);
  }

  async recent(limit = 100): Promise<UsageEvent[]> {
    return this.events.slice(-limit);
  }
}
