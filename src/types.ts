export type ProviderType = 'openai-compatible' | 'gemini' | 'fake';

export interface LimitRule {
  rpm?: number;
  tpm?: number;
  maxParallel?: number;
}

export interface LimitConfig {
  global?: LimitRule;
  users?: Record<string, LimitRule>;
  providers?: Record<string, LimitRule>;
  models?: Record<string, LimitRule>;
  deployments?: Record<string, LimitRule>;
}

export interface ServerConfig {
  host?: string;
  port?: number;
  authTokens?: string[];
  adminToken?: string;
  requestTimeoutMs?: number;
  maxBodyBytes?: number;
}

export interface RoutingConfig {
  strategy?: 'priority' | 'weighted';
  maxFallbacks?: number;
  healthCooldownMs?: number;
  debugHeaders?: boolean;
  modelRefreshTtlMs?: number;
}

export interface StorageConfig {
  usageLogPath?: string;
}

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  modelsPath?: string;
  chatPath?: string;
  priority?: number;
  weight?: number;
  optional?: boolean;
  allowLocal?: boolean;
  modelFilter?: 'free' | string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ConfiguredRoute {
  provider: string;
  model: string;
  priority?: number;
  weight?: number;
}

export interface ConfiguredModelGroup {
  name: string;
  aliases?: string[];
  routes: ConfiguredRoute[];
}

export interface RouterConfig {
  server?: ServerConfig;
  limits?: LimitConfig;
  routing?: RoutingConfig;
  storage?: StorageConfig;
  providers?: ProviderConfig[];
  models?: ConfiguredModelGroup[];
}

export interface ModelInfo {
  id: string;
  name?: string;
  contextWindow?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  raw?: unknown;
}

export interface Deployment {
  id: string;
  providerId: string;
  providerType: string;
  upstreamModel: string;
  modelGroup: string;
  priority: number;
  weight: number;
  metadata?: ModelInfo;
}

export interface ModelGroup {
  id: string;
  aliases: string[];
  deployments: Deployment[];
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole | string;
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  tools?: unknown;
  tool_choice?: unknown;
  response_format?: unknown;
  [key: string]: unknown;
}

export interface OpenAIChatChoice {
  index: number;
  message: {
    role: string;
    content: unknown;
    tool_calls?: unknown;
  };
  finish_reason: string | null;
}

export interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion' | string;
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface UsageTokens {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ProviderChatResult {
  response: OpenAIChatResponse | Response;
  usage?: UsageTokens;
  streamed?: boolean;
}

export interface ProviderAdapter {
  id: string;
  type: string;
  priority: number;
  weight?: number;
  listModels(): Promise<ModelInfo[]>;
  chat(request: ChatRequest, deployment?: Deployment): Promise<ProviderChatResult>;
}

export interface ChatContext {
  userId: string;
  apiKeyHash?: string;
  requestId?: string;
}

export interface AttemptRecord {
  requestId: string;
  providerId: string;
  deploymentId: string;
  upstreamModel: string;
  status: 'success' | 'error';
  retryable: boolean;
  latencyMs: number;
  error?: string;
  statusCode?: number;
  usage?: UsageTokens;
}

export interface RoutedChatResult {
  response: OpenAIChatResponse | Response;
  attempts: AttemptRecord[];
  deployment: Deployment;
}

export interface UsageEvent extends AttemptRecord {
  userId: string;
  requestedModel: string;
  modelGroup: string;
  timestamp: string;
  fallbackIndex: number;
}
