/** Stable assignment uses the deployment identity and run identity alone. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import type { ExperientialDeployment } from './contracts.gen.ts';

export async function canaryShareOf(deploymentId: string, runId: string): Promise<number> {
  if (typeof deploymentId !== 'string' || !/^[a-f0-9]{64}$/.test(deploymentId)
    || typeof runId !== 'string' || !runId.trim() || runId.length > 256)
    throw new TypeError('Canary assignment requires a deployment address and a bounded run id.');
  return Number.parseInt((await canonicalSha256([deploymentId, runId])).slice(0, 13), 16) / 2 ** 52;
}

export async function routesToCanary(deployment: Pick<ExperientialDeployment, 'id' | 'canaryArtifactId' | 'rolloutFraction'>, runId: string): Promise<boolean> {
  if (!Number.isFinite(deployment.rolloutFraction) || deployment.rolloutFraction < 0 || deployment.rolloutFraction > 1
    || deployment.canaryArtifactId === null && deployment.rolloutFraction !== 0)
    throw new TypeError('Canary routing requires a registered fraction in [0, 1].');
  const share = await canaryShareOf(deployment.id, runId);
  return deployment.canaryArtifactId !== null && share < deployment.rolloutFraction;
}
