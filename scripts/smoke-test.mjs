import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const tempDir = await mkdtemp(join(tmpdir(), 'free-ai-router-smoke-'));
const configPath = join(tempDir, 'config.json');
const port = 18_080 + Math.floor(Math.random() * 1000);
const token = 'smoke-token';

await mkdir(join(tempDir, 'state'), { recursive: true });
await writeFile(configPath, JSON.stringify({
  server: {
    host: '127.0.0.1',
    port,
    authTokens: [token],
    adminToken: 'smoke-admin-token',
    requestTimeoutMs: 30_000,
    maxBodyBytes: 65_536
  },
  routing: {
    strategy: 'priority',
    maxFallbacks: 0,
    modelRefreshTtlMs: 0,
    debugHeaders: false
  },
  storage: {
    usageLogPath: join(tempDir, 'state', 'usage.jsonl')
  },
  limits: {
    users: {
      default: { rpm: 10, tpm: 10000, maxParallel: 2 }
    }
  },
  providers: [],
  models: []
}, null, 2));

const child = spawn(process.execPath, [join(root, 'dist', 'cli.js'), 'start', '--config', configPath], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk.toString('utf8');
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString('utf8');
});

try {
  await waitForServer(`http://127.0.0.1:${port}/health`);

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert(health.ok, `/health returned ${health.status}`);
  const healthBody = await health.json();
  assert(healthBody.status === 'ok', `/health returned unexpected body ${JSON.stringify(healthBody)}`);

  const unauthorized = await fetch(`http://127.0.0.1:${port}/v1/models`);
  assert(unauthorized.status === 401, `/v1/models without auth returned ${unauthorized.status}`);

  const models = await fetch(`http://127.0.0.1:${port}/v1/models`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert(models.ok, `/v1/models returned ${models.status}`);
  const modelsBody = await models.json();
  assert(modelsBody.object === 'list' && Array.isArray(modelsBody.data), `/v1/models returned unexpected body ${JSON.stringify(modelsBody)}`);
} finally {
  child.kill('SIGTERM');
  await onceExit(child);
  await rm(tempDir, { recursive: true, force: true });
}

console.log('Smoke test passed');

async function waitForServer(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}: ${output}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready. Output: ${output}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function onceExit(childProcess) {
  if (childProcess.exitCode !== null) {
    return;
  }
  await new Promise((resolve) => childProcess.once('exit', resolve));
}
