/** Checked training commands; operational progress never changes immutable ancestry. */
import { deepFreeze, equalsJson } from '@jarenjs/core/object';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { checkExperientialRecord, sealExperientialRecord } from './identity.ts';
import { validateExperientialShape } from './schema.ts';
import { experientialIssue, refuseExperiential, type ExperientialResult } from './errors.ts';
import type { ExperientialArtifact, ExperientialDataset, ExperientialTrainingCommand,
  ExperientialTrainingProgress, ExperientialTrainingRun } from './contracts.gen.ts';

export const trainingTerminal = (run: ExperientialTrainingRun) => ['complete', 'failed', 'cancelled'].includes(run.state);
export function initialTrainingProgress(at: string): ExperientialTrainingProgress {
  return { revision: 0, stage: 'queued', dispatch: 'none', job: null, polls: 0, observations: 0, observedPoll: 0,
    backendState: null, renderedBytes: 0, renderedDigest: null, receipt: null, verifiedBytes: null,
    artifactId: null, updatedAt: at, issues: [] };
}

/** Managed runs retain every configured input and the exact dataset and base bindings. */
export async function checkTrainingBindings(run: ExperientialTrainingRun, dataset: ExperientialDataset,
  base: ExperientialArtifact): Promise<ExperientialResult<ExperientialTrainingRun>> {
  const [r, d, b] = await Promise.all([checkExperientialRecord('trainingRun', run),
    checkExperientialRecord('dataset', dataset), checkExperientialRecord('artifact', base)]);
  if (!r.ok) return r; if (!d.ok) return d; if (!b.ok) return b;
  const spec = r.value.spec;
  if (!spec || !r.value.pipelineRevision || !r.value.runtime || !r.value.progress)
    return refuseExperiential('TEXP1002', '/spec', 'A managed run requires its complete specification, runtime, pipeline and progress.');
  if (d.value.scope !== r.value.scope || b.value.scope !== r.value.scope
    || b.value.kind !== 'base' && (!b.value.evaluationRegistration || !['active', 'archived'].includes(b.value.state))
    || spec.datasetId !== d.value.id || spec.baseArtifactId !== b.value.id || spec.baseChecksum !== b.value.checksum
    || spec.manifestDigest !== d.value.manifestDigest || spec.tokenizerIdentity !== d.value.tokenizerIdentity
    || spec.chatTemplateIdentity !== d.value.chatTemplateIdentity || r.value.datasetId !== spec.datasetId
    || r.value.baseArtifactId !== spec.baseArtifactId || r.value.method !== spec.method
    || !equalsJson(r.value.hyperparameters, spec.hyperparameters) || !equalsJson(r.value.budget, spec.budget)
    || r.value.idempotencyKey !== await canonicalSha256(spec))
    return refuseExperiential('TEXP1002', '/spec', 'The training specification does not reproduce its retained ancestry and configuration.');
  return r;
}

export interface ExperientialTrainingUpdate {
  before: ExperientialTrainingRun;
  after: ExperientialTrainingRun;
  artifact: ExperientialArtifact | null;
}

/** The store independently rederives this plan under its transaction and lease fence. */
export async function planExperientialTrainingUpdate(input: ExperientialTrainingRun, raw: ExperientialTrainingCommand,
  at: string): Promise<ExperientialResult<ExperientialTrainingUpdate>> {
  const command = validateExperientialShape<ExperientialTrainingCommand>('ExperientialTrainingCommand', raw); if (!command.ok) return command;
  const checked = await checkExperientialRecord('trainingRun', input); if (!checked.ok) return checked;
  const before = checked.value, spec = before.spec, retained = before.progress;
  if (!spec || !retained || !before.runtime || !before.pipelineRevision)
    return refuseExperiential('TEXP1006', '/spec', 'This command requires a managed training run.');
  if (trainingTerminal(before)) return refuseExperiential('TEXP1006', '/state', 'Terminal training cannot perform another effect.');
  const p = structuredClone(retained), after = { ...before, progress: p }, c = command.value;
  const refuse = () => refuseExperiential('TEXP1006', '/progress', 'The command does not follow the retained training stage.');
  const finish = (state: 'failed' | 'cancelled', reason: string) => {
    after.state = state; after.stopReason = reason; after.finishedAt = at; p.stage = 'terminal';
  };
  let artifact: ExperientialArtifact | null = null;
  switch (c.kind) {
    case 'begin':
      if (p.stage !== 'queued') return refuse();
      after.startedAt = at; p.stage = 'selecting'; break;
    case 'selected':
      if (p.stage !== 'selecting') return refuse();
      p.stage = 'selected'; break;
    case 'rendered':
      if (p.stage !== 'selected' || c.bytes > spec.budget.maxBytes) return refuse();
      p.renderedBytes = c.bytes; p.renderedDigest = c.digest; p.stage = 'rendered'; break;
    case 'reserve':
      if (p.stage !== 'rendered' || p.dispatch !== 'none' || before.submissions !== 0) return refuse();
      after.submissions = 1; after.state = 'preparing'; p.dispatch = 'reserved'; p.stage = 'submitting'; break;
    case 'submitted':
      if (p.stage !== 'submitting' || !['reserved', 'unknown'].includes(p.dispatch)
        || c.job.specDigest !== before.idempotencyKey || p.job !== null) return refuse();
      p.job = c.job; p.dispatch = 'accepted'; p.stage = 'submitted'; after.state = 'training'; break;
    case 'uncertain':
      if (p.stage !== 'submitting' || p.dispatch !== 'reserved') return refuse();
      p.dispatch = 'unknown'; break;
    case 'poll-reserve':
      if (p.stage !== 'submitted' || p.dispatch !== 'accepted' || !p.job) return refuse();
      if (p.polls >= spec.budget.maxPolls) return refuseExperiential('TEXP1009', '/polls', 'The retained poll budget is exhausted.');
      p.polls++; break;
    case 'observed': {
      if (p.stage !== 'submitted' || !p.job || c.poll !== p.polls || c.poll <= p.observedPoll
        || c.observation.jobId !== p.job.id) return refuse();
      p.observations++; p.observedPoll = c.poll; p.backendState = c.observation;
      after.logRefs = c.observation.logRefs; after.metricsRef = c.observation.metricsRef;
      const state = c.observation.state;
      if (state === 'failed' || state === 'cancelled') finish(state, c.observation.stopReason ?? 'backend-' + state);
      else if (state === 'complete') { p.stage = 'polled'; after.state = 'materializing'; }
      break;
    }
    case 'materialized':
      if (p.stage !== 'polled' || !p.job || c.receipt.jobId !== p.job.id || c.receipt.specDigest !== before.idempotencyKey
        || c.receipt.datasetId !== spec.datasetId || c.receipt.baseArtifactId !== spec.baseArtifactId
        || c.receipt.baseChecksum !== spec.baseChecksum || c.receipt.method !== spec.method
        || c.receipt.kind !== (spec.method === 'lora' ? 'adapter' : 'weights')
        || c.receipt.runtime.provider !== before.runtime.provider || c.receipt.runtime.base !== before.runtime.base
        || c.receipt.sizeBytes > spec.budget.maxBytes) return refuseExperiential('TEXP1008', '/receipt', 'The materialized receipt differs from its retained submission or configured bounds.');
      p.receipt = c.receipt; p.stage = 'materialized'; after.logRefs = c.receipt.logRefs; after.metricsRef = c.receipt.metricsRef; break;
    case 'verified':
      if (p.stage !== 'materialized' || !p.receipt || !equalsJson(c.verification.receipt, p.receipt)
        || c.verification.verifiedBytes !== p.receipt.sizeBytes) return refuse();
      p.verifiedBytes = c.verification.verifiedBytes; p.stage = 'verified'; break;
    case 'register': {
      if (p.stage !== 'verified' || !p.receipt || p.verifiedBytes !== p.receipt.sizeBytes) return refuse();
      const receipt = p.receipt;
      const sealed = await sealExperientialRecord('artifact', { document: 'experiential-artifact', schemaVersion: 1,
        scope: before.scope, recordedAt: at, checksum: receipt.sha256, baseArtifactId: spec.baseArtifactId,
        kind: receipt.kind, method: spec.method, storageUri: receipt.storageUri, runtime: receipt.runtime,
        trainingRunId: before.id, state: 'staged', sizeBytes: receipt.sizeBytes });
      if (!sealed.ok) return sealed;
      artifact = sealed.value; p.artifactId = artifact.id; p.stage = 'registered'; after.state = 'complete'; after.finishedAt = at; break;
    }
    case 'fail':
      finish('failed', c.reason); p.issues = [experientialIssue(c.code, '/training', 'Training refused: ' + c.reason + '.')]; break;
    case 'cancel': finish('cancelled', 'cancelled'); break;
  }
  p.revision++; p.updatedAt = at;
  const validated = await checkExperientialRecord('trainingRun', after); if (!validated.ok) return validated;
  return { ok: true, value: deepFreeze({ before, after: validated.value, artifact }) };
}
