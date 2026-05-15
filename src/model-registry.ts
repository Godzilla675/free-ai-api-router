import type { Deployment, ModelGroup, ProviderAdapter, RouterConfig } from './types.js';

export interface ModelRegistry {
  refresh(): Promise<ModelGroup[]>;
  list(): ModelGroup[];
  resolve(model: string): Deployment[];
}

export function createModelRegistry(providers: ProviderAdapter[], config: RouterConfig): ModelRegistry {
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  let groups = new Map<string, ModelGroup>();
  let aliases = new Map<string, string>();

  async function refresh(): Promise<ModelGroup[]> {
    const nextGroups = new Map<string, ModelGroup>();
    const nextAliases = new Map<string, string>();
    let successfulProviders = 0;

    for (const provider of providers) {
      try {
        const models = await provider.listModels();
        successfulProviders += 1;
        for (const model of models) {
          const group = ensureGroup(nextGroups, model.id);
          group.deployments.push({
            id: `${provider.id}:${model.id}`,
            providerId: provider.id,
            providerType: provider.type,
            upstreamModel: model.id,
            modelGroup: model.id,
            priority: provider.priority,
            weight: provider.weight ?? 1,
            metadata: model
          });
        }
      } catch {
        // Keep the last successful snapshot if every provider refresh fails.
      }
    }

    const baseGroups = successfulProviders === 0 && groups.size > 0 ? cloneGroups(groups) : nextGroups;
    applyConfiguredGroups(baseGroups, nextAliases, providerMap, config);

    if (successfulProviders > 0 || groups.size === 0 || (config.models ?? []).length > 0) {
      groups = baseGroups;
      aliases = nextAliases;
    }

    return list();
  }

  function list(): ModelGroup[] {
    return [...groups.values()].map((group) => ({
      ...group,
      deployments: [...group.deployments].sort(compareDeployments)
    })).sort((a, b) => a.id.localeCompare(b.id));
  }

  function resolve(model: string): Deployment[] {
    const groupId = aliases.get(model) ?? model;
    return [...(groups.get(groupId)?.deployments ?? [])].sort(compareDeployments);
  }

  return { refresh, list, resolve };
}

function cloneGroups(groups: Map<string, ModelGroup>): Map<string, ModelGroup> {
  return new Map([...groups.entries()].map(([id, group]) => [id, { ...group, aliases: [...group.aliases], deployments: [...group.deployments] }]));
}

function ensureGroup(groups: Map<string, ModelGroup>, id: string): ModelGroup {
  const existing = groups.get(id);
  if (existing) {
    return existing;
  }
  const group = { id, aliases: [], deployments: [] };
  groups.set(id, group);
  return group;
}

function applyConfiguredGroups(
  groups: Map<string, ModelGroup>,
  aliases: Map<string, string>,
  providerMap: Map<string, ProviderAdapter>,
  config: RouterConfig
): void {
  for (const configured of config.models ?? []) {
    const group = ensureGroup(groups, configured.name);
    group.aliases = [...new Set([...(group.aliases ?? []), ...(configured.aliases ?? [])])];
    aliases.set(configured.name, configured.name);
    for (const alias of group.aliases) {
      aliases.set(alias, configured.name);
    }

    for (const route of configured.routes) {
      const provider = providerMap.get(route.provider);
      if (!provider) {
        continue;
      }
      const deploymentId = `${route.provider}:${route.model}`;
      if (group.deployments.some((deployment) => deployment.id === deploymentId)) {
        continue;
      }
      group.deployments.push({
        id: deploymentId,
        providerId: route.provider,
        providerType: provider.type,
        upstreamModel: route.model,
        modelGroup: configured.name,
        priority: route.priority ?? provider.priority,
        weight: route.weight ?? provider.weight ?? 1
      });
    }
  }
}

function compareDeployments(a: Deployment, b: Deployment): number {
  return a.priority - b.priority || a.providerId.localeCompare(b.providerId) || a.upstreamModel.localeCompare(b.upstreamModel);
}
