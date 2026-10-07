import { experientialArtifactChecksum, trainingSpecDigest, type TrainingSpec, type ArtifactReceipt,
  type BackendJob, type TrainingCapabilities } from '@tangleai/experiential';
import { experientialSchemaFixtures } from './schema-fixtures.ts';
import { accepted } from './identity-fixtures.ts';

export async function backendFixture() {
  const f = experientialSchemaFixtures(), t = f.trainingRun;
  const spec: TrainingSpec = { datasetId: t.datasetId, manifestDigest: f.dataset.manifestDigest,
    baseArtifactId: t.baseArtifactId, baseChecksum: f.artifact.checksum, method: t.method,
    hyperparameters: t.hyperparameters, seed: 17753, precision: 'fp32', tokenizerIdentity: f.dataset.tokenizerIdentity,
    chatTemplateIdentity: f.dataset.chatTemplateIdentity, budget: t.budget };
  const job: BackendJob = { id: 'fixture-job', specDigest: accepted(await trainingSpecDigest(spec)) };
  const bytes = new TextEncoder().encode('bounded artifact bytes');
  const receipt: ArtifactReceipt = { jobId: job.id, specDigest: job.specDigest, datasetId: spec.datasetId,
    baseArtifactId: spec.baseArtifactId, baseChecksum: spec.baseChecksum, method: spec.method, kind: 'adapter',
    storageUri: 'memory:fixture/artifact', sha256: await experientialArtifactChecksum(bytes), sizeBytes: bytes.length,
    runtime: f.artifact.runtime, deterministic: true, logRefs: [], metricsRef: null };
  const capabilities: TrainingCapabilities = { methods: ['lora'], baseModels: [spec.baseArtifactId], resumable: true,
    artifactKinds: ['adapter'], trainable: true };
  return { spec, job, bytes, receipt, capabilities };
}
