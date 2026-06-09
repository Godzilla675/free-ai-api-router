import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { JsonlUsageRecorder, MemoryUsageRecorder } from '../src/usage.js';
import type { UsageEvent } from '../src/types.js';

describe('UsageRecorders', () => {
  const testDir = './tests/fixtures';
  const testFile = `${testDir}/usage.jsonl`;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {}
    vi.restoreAllMocks();
  });

  describe('JsonlUsageRecorder', () => {
    it('returns empty array when no path provided', async () => {
      const recorder = new JsonlUsageRecorder();
      expect(await recorder.recent()).toEqual([]);
    });

    it('returns empty array when file does not exist', async () => {
      const recorder = new JsonlUsageRecorder(testFile);
      expect(await recorder.recent()).toEqual([]);
    });

    it('records and retrieves usage events', async () => {
      const recorder = new JsonlUsageRecorder(testFile);
      const event: UsageEvent = {
                timestamp: new Date().toISOString(),
        providerId: 'test',
        requestedModel: 'test-model',
        userId: 'user1',
        modelGroup: 'group1',
        fallbackIndex: 0,
        requestId: 'req1',
        deploymentId: 'dep1',
        upstreamModel: 'up-model',
        status: 'success',
        retryable: false,
        latencyMs: 100,
      };

      await recorder.record(event);
      const recent = await recorder.recent();
      expect(recent).toHaveLength(1);
      expect(recent[0]).toEqual(event);
    });

    it('handles invalid JSON gracefully', async () => {
      const recorder = new JsonlUsageRecorder(testFile);
      const validEvent: UsageEvent = {
                timestamp: new Date().toISOString(),
        providerId: 'test',
        requestedModel: 'test-model',
        userId: 'user1',
        modelGroup: 'group1',
        fallbackIndex: 0,
        requestId: 'req1',
        deploymentId: 'dep1',
        upstreamModel: 'up-model',
        status: 'success',
        retryable: false,
        latencyMs: 100,
      };

      await writeFile(testFile, `${JSON.stringify(validEvent)}\n`);
      await writeFile(testFile, `invalid json\n`, { flag: 'a' });
      await writeFile(testFile, `{"incomplete": "json"\n`, { flag: 'a' });

      const anotherValidEvent: UsageEvent = {
                timestamp: new Date().toISOString(),
        providerId: 'test2',
        requestedModel: 'test-model2',
        userId: 'user1',
        modelGroup: 'group1',
        fallbackIndex: 0,
        requestId: 'req1',
        deploymentId: 'dep1',
        upstreamModel: 'up-model',
        status: 'success',
        retryable: false,
        latencyMs: 100,
      };
      await writeFile(testFile, `${JSON.stringify(anotherValidEvent)}\n`, { flag: 'a' });

      const recent = await recorder.recent();

      expect(recent).toHaveLength(2);
      expect(recent[0]).toEqual(validEvent);
      expect(recent[1]).toEqual(anotherValidEvent);

      expect(console.warn).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenCalledWith('Failed to parse usage line:', expect.any(Error));
    });

    it('respects limit parameter', async () => {
      const recorder = new JsonlUsageRecorder(testFile);
      for (let i = 0; i < 5; i++) {
        await recorder.record({
                    timestamp: new Date().toISOString(),
          providerId: `test-${i}`,
          requestedModel: 'test-model',
        userId: 'user1',
        modelGroup: 'group1',
        fallbackIndex: 0,
        requestId: 'req1',
        deploymentId: 'dep1',
        upstreamModel: 'up-model',
        status: 'success',
        retryable: false,
        latencyMs: 100,
        });
      }

      const recent = await recorder.recent(2);
      expect(recent).toHaveLength(2);
      expect(recent[0]?.providerId).toBe('test-3');
      expect(recent[1]?.providerId).toBe('test-4');
    });
  });

  describe('MemoryUsageRecorder', () => {
    it('records and retrieves usage events', async () => {
      const recorder = new MemoryUsageRecorder();
      const event: UsageEvent = {
                timestamp: new Date().toISOString(),
        providerId: 'test',
        requestedModel: 'test-model',
        userId: 'user1',
        modelGroup: 'group1',
        fallbackIndex: 0,
        requestId: 'req1',
        deploymentId: 'dep1',
        upstreamModel: 'up-model',
        status: 'success',
        retryable: false,
        latencyMs: 100,
      };

      await recorder.record(event);
      const recent = await recorder.recent();
      expect(recent).toHaveLength(1);
      expect(recent[0]).toEqual(event);
    });

    it('respects limit parameter', async () => {
      const recorder = new MemoryUsageRecorder();
      for (let i = 0; i < 5; i++) {
        await recorder.record({
                    timestamp: new Date().toISOString(),
          providerId: `test-${i}`,
          requestedModel: 'test-model',
        userId: 'user1',
        modelGroup: 'group1',
        fallbackIndex: 0,
        requestId: 'req1',
        deploymentId: 'dep1',
        upstreamModel: 'up-model',
        status: 'success',
        retryable: false,
        latencyMs: 100,
        });
      }

      const recent = await recorder.recent(2);
      expect(recent).toHaveLength(2);
      expect(recent[0]?.providerId).toBe('test-3');
      expect(recent[1]?.providerId).toBe('test-4');
    });
  });
});
