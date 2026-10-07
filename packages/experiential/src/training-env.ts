/** One injected environment reader; only its credential-free plan is serializable. */
import { deepFreeze } from '@jarenjs/core/object';
import { refuseExperiential, type ExperientialResult } from './errors.ts';
import type { ExperientialMethod } from './contracts.gen.ts';

export function trainingServiceBase(value: unknown): ExperientialResult<string> {
  try {
    if (typeof value !== 'string') throw Error();
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error();
    return { ok: true, value: url.href.replace(/\/$/, '') };
  } catch { return refuseExperiential('TEXP1001', '/base', 'A training service base must be an HTTP URL without credentials, query or fragment.'); }
}

export interface TrainingEnvironmentPlan {
  base: string;
  datasetId: string;
  manifestDigest: string;
  baseArtifactId: string;
  baseChecksum: string;
  method: ExperientialMethod;
  maxSpend: number;
  maxWallMs: number;
}
export interface TrainingEnvironment {
  configured: boolean;
  missing: string[];
  plan: TrainingEnvironmentPlan | null;
  credential(): Promise<string | null>;
}
const names = {
  base: 'TANGLE_TRAINING_BASE', credential: 'TANGLE_TRAINING_API_KEY', datasetId: 'TANGLE_TRAINING_DATASET_ID',
  manifestDigest: 'TANGLE_TRAINING_MANIFEST_DIGEST', baseArtifactId: 'TANGLE_TRAINING_BASE_ARTIFACT_ID',
  baseChecksum: 'TANGLE_TRAINING_BASE_CHECKSUM', method: 'TANGLE_TRAINING_METHOD',
  maxSpend: 'TANGLE_TRAINING_MAX_SPEND', maxWallMs: 'TANGLE_TRAINING_MAX_WALL_MS',
} as const;

export function readTrainingEnv(env: Readonly<Record<string, string | undefined>> = {}): ExperientialResult<TrainingEnvironment> {
  const values = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, env[name]?.trim() ?? ''])) as Record<keyof typeof names, string>;
  const missing = Object.entries(names).filter(([key]) => !values[key as keyof typeof names]).map(([, name]) => name);
  const base = values.base ? trainingServiceBase(values.base) : null;
  if (base && !base.ok) return base;
  if (missing.length) return { ok: true, value: { configured: false, missing, plan: null, credential: async () => null } };
  const digest = /^[a-f0-9]{64}$/;
  if (/[\r\n]/.test(values.credential)
    || ['datasetId', 'manifestDigest', 'baseArtifactId', 'baseChecksum'].some(key => !digest.test(values[key as keyof typeof names]))
    || !['lora', 'full', 'knowledge-edit'].includes(values.method)
    || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(values.maxSpend) || !Number.isFinite(Number(values.maxSpend))
    || !/^[1-9][0-9]*$/.test(values.maxWallMs) || !Number.isSafeInteger(Number(values.maxWallMs)) || Number(values.maxWallMs) > 2147483647)
    return refuseExperiential('TEXP1001', '/training', 'Training configuration requires exact digests, a supported method and finite spend and wall bounds.');
  const plan = deepFreeze({ base: base!.value, datasetId: values.datasetId, manifestDigest: values.manifestDigest,
    baseArtifactId: values.baseArtifactId, baseChecksum: values.baseChecksum, method: values.method as ExperientialMethod,
    maxSpend: Number(values.maxSpend), maxWallMs: Number(values.maxWallMs) });
  return { ok: true, value: { configured: true, missing: [], plan, credential: async () => values.credential } };
}
