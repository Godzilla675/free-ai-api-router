import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/config.js';

describe('config.example.json', () => {
  it('normalizes documented optional free provider entries', async () => {
    const previousEnv = snapshotEnv([
      'GROQ_API_KEY',
      'CEREBRAS_API_KEY',
      'OPENROUTER_API_KEY',
      'NVIDIA_API_KEY',
      'GEMINI_API_KEY',
      'OPENCODE_SERVER_PASSWORD',
      'HF_TOKEN',
      'GITHUB_TOKEN',
      'SAMBANOVA_API_KEY',
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_WORKERS_AI_BASE_URL',
      'IFLOW_API_KEY',
      'OPENAI_API_KEY',
      'OPENAI_RESPONSES_BASE_URL'
    ]);
    Object.assign(process.env, {
      GROQ_API_KEY: 'groq',
      CEREBRAS_API_KEY: 'cerebras',
      OPENROUTER_API_KEY: 'openrouter',
      NVIDIA_API_KEY: 'nvidia',
      GEMINI_API_KEY: 'gemini',
      OPENCODE_SERVER_PASSWORD: 'opencode',
      HF_TOKEN: 'hf',
      GITHUB_TOKEN: 'github',
      SAMBANOVA_API_KEY: 'sambanova',
      CLOUDFLARE_API_TOKEN: 'cloudflare',
      CLOUDFLARE_WORKERS_AI_BASE_URL: 'https://api.cloudflare.com/client/v4/accounts/example/ai',
      IFLOW_API_KEY: 'iflow',
      OPENAI_API_KEY: 'openai-test',
      OPENAI_RESPONSES_BASE_URL: 'https://api.openai.com/v1'
    });
    try {
      const config = normalizeConfig(JSON.parse(await readFile('config.example.json', 'utf8')));

      expect(config.providers?.map((provider) => provider.id)).toEqual(expect.arrayContaining([
        'huggingface',
        'github-models',
        'sambanova',
        'cloudflare-workers-ai'
      ]));
      expect(config.providers?.find((provider) => provider.id === 'cloudflare-workers-ai')).toMatchObject({
        baseUrl: 'https://api.cloudflare.com/client/v4/accounts/example/ai',
        modelsPath: '/models/search?format=openrouter',
        chatPath: '/v1/chat/completions'
      });
      expect(config.models?.find((model) => model.name === 'free-coding')?.routes.map((route) => route.provider)).toEqual(expect.arrayContaining([
        'huggingface',
        'github-models',
        'sambanova',
        'cloudflare-workers-ai'
      ]));
    } finally {
      restoreEnv(previousEnv);
    }
  });

  it('normalizes optional OpenAI Responses provider when key is present', () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    try {
      const config = normalizeConfig({
        server: { authTokens: ['token'], adminToken: 'admin' },
        providers: [{
          id: 'openai-responses',
          type: 'openai-responses',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
          optional: true
        }]
      });

      expect(config.providers?.[0]?.type).toBe('openai-responses');
      expect(config.providers?.[0]?.apiKey).toBe('test-openai-key');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
});

function snapshotEnv(names: string[]): Record<string, string | undefined> {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
