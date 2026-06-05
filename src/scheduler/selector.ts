import type { Deployment } from '../types.js';

export class RoundRobinSelector {
  private readonly cursors = new Map<string, number>();

  getCursor(modelGroup: string): number {
    return this.cursors.get(modelGroup) ?? 0;
  }

  increment(modelGroup: string): void {
    const current = this.cursors.get(modelGroup) ?? 0;
    this.cursors.set(modelGroup, current + 1);
  }

  select(deployments: Deployment[]): Deployment[] {
    if (deployments.length === 0) {
      return [];
    }
    const modelGroup = deployments[0]!.modelGroup;
    const cursor = this.getCursor(modelGroup);

    const n = deployments.length;
    const rotated: Deployment[] = [];
    for (let i = 0; i < n; i++) {
      rotated.push(deployments[(cursor + i) % n]!);
    }

    // Increment cursor for next selection
    this.increment(modelGroup);

    return rotated;
  }
}
