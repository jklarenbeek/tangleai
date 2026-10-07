/** Read-only inspection over one retained snapshot and the native local dispatcher. */
import { compileContract, type Contract } from '@jarenjs/contract';
import { openLocalClient, type LocalClient } from '@jarenjs/contract/local';
import type { Handler } from '@jarenjs/contract/http';
import { deepFreeze } from '@jarenjs/core/object';
import { experientialSchema } from './schema.ts';
import { resolveExperientialLineage } from './lineage.ts';
import { planExperientialRetention } from './retention.ts';
import { redactExperientialView, experientialViewSchema } from './redact.ts';
import { refuseExperiential, experientialNativeCause, type ExperientialResult } from './errors.ts';
import type { ExperientialStore, ExperientialTable, ExperientialTables } from './store-types.ts';
import type { ExperientialExperience, ExperientialRetentionPolicy } from './contracts.gen.ts';

const ref = (name: string) => ({ $ref: '#/$defs/' + name });
const view = (name: string) => ref(name + 'View');
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (name: string) => ({ type: 'array', items: view(name), maxItems: 4096 });
const nullable = (shape: unknown) => ({ anyOf: [shape, { type: 'null' }] });
const result = (shape: unknown) => ({ anyOf: [object({ ok: { const: true }, value: shape }), object({ ok: { const: false }, issues: array('ExperientialIssue') })] });
const scope = experientialSchema.$defs.ExperientialExperience.properties.scope;
const address = experientialSchema.$defs.ExperientialExperience.properties.id;
const input = object({ scope });
const lineage = object({ artifact: view('ExperientialArtifact'), artifacts: array('ExperientialArtifact'), trainingRuns: array('ExperientialTrainingRun'),
  datasets: array('ExperientialDataset'), assessments: array('ExperientialAssessment'), experiences: array('ExperientialExperience'),
  sourceRefs: array('ExperientialRef'), producingIdentityIds: { type: 'array', items: address }, externalBytes: { const: 'not-resolved' } });
const preview = object({ episodeIds: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 256 }, minItems: 1, maxItems: 4096, uniqueItems: true },
  deploymentId: address, now: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, policy: ref('ExperientialRetentionPolicy') });
const views = Object.fromEntries(Object.entries(experientialSchema.$defs).map(([name, value]) => [name + 'View', experientialViewSchema(value, name === 'ExperientialEvent')]));

export const experientialContractDocument = deepFreeze({
  $contract: '0.1', id: 'tangle-experiential', version: '1', $defs: { ...experientialSchema.$defs, ...views },
  operations: {
    'experiential.lineage': { kind: 'read', input: object({ scope, artifactId: address }), output: result(lineage) },
    'experiential.experiences': { kind: 'read', input: object({ scope, state: nullable(experientialSchema.$defs.ExperientialExperience.properties.state) }),
      output: result(object({ experiences: array('ExperientialExperience'), assessments: array('ExperientialAssessment') })) },
    'experiential.datasets': { kind: 'read', input, output: result(array('ExperientialDataset')) },
    'experiential.trainingruns': { kind: 'read', input, output: result(object({ runs: array('ExperientialTrainingRun'),
      logDigests: { type: 'array', maxItems: 4096, items: object({ trainingRunId: address, digests: { type: 'array', items: address } }) } })) },
    'experiential.artifacts': { kind: 'read', input, output: result(array('ExperientialArtifact')) },
    'experiential.evaluations': { kind: 'read', input, output: result(array('ExperientialEvaluation')) },
    'experiential.deployments': { kind: 'read', input, output: result(object({ deployments: array('ExperientialDeployment'), heads: array('ExperientialHead'), history: array('ExperientialEvent') })) },
    'experiential.retention': { kind: 'read', input: object({ scope, preview: nullable(preview) }),
      output: result(object({ decisions: array('ExperientialRetentionDecision'), events: array('ExperientialEvent'),
        preview: nullable(result(array('ExperientialRetentionDecision'))) })) },
  },
});
export function createExperientialContract(): Contract { return compileContract(experientialContractDocument); }
interface InspectionInput {
  scope: string; artifactId?: string; state?: ExperientialExperience['state'] | null;
  preview?: { episodeIds: string[]; deploymentId: string; now: number; policy: ExperientialRetentionPolicy } | null;
}
export function createExperientialHandlers(store: ExperientialStore): Record<string, Handler> {
  const handler = (operation: keyof typeof experientialContractDocument.operations): Handler => async (raw, context) => {
    try {
      context.signal?.throwIfAborted();
      const input = raw as InspectionInput, snapshot = await store.snapshot(input.scope);
      if (!snapshot.ok) return redactExperientialView(snapshot);
      const rows = snapshot.value;
      if (Object.values(rows).some(values => values.length > 4096)) return refuseExperiential('TEXP1009', '/scope', 'The inspection census exceeds its bounded view.');
      if (Object.values(rows).some(values => values.some(row => row.scope !== input.scope))) return refuseExperiential('TEXP1005', '/scope', 'The inspection snapshot contains another scope.');
      context.signal?.throwIfAborted();
      const reader: Pick<ExperientialStore, 'get'> = { async get<K extends ExperientialTable>(table: K, id: string) {
        return { ok: true, value: (rows[table] as ExperientialTables[K][]).find(row => row.id === id) ?? null, writes: 0, replayed: true };
      } };
      let value: unknown;
      if (operation === 'experiential.lineage') return redactExperientialView(await resolveExperientialLineage(reader, input.artifactId!));
      if (operation === 'experiential.experiences') {
        const experiences = rows.experiences.filter(row => input.state === null || row.state === input.state), ids = new Set(experiences.map(row => row.id));
        value = { experiences, assessments: rows.assessments.filter(row => ids.has(row.experienceId)) };
      } else if (operation === 'experiential.datasets') value = rows.datasets;
      else if (operation === 'experiential.trainingruns') value = { runs: rows.training_runs,
        logDigests: rows.training_runs.map(row => ({ trainingRunId: row.id, digests: row.logRefs.map(ref => ref.digest) })) };
      else if (operation === 'experiential.artifacts') value = rows.artifacts;
      else if (operation === 'experiential.evaluations') value = rows.evaluations;
      else if (operation === 'experiential.deployments') value = { deployments: rows.deployments, heads: rows.heads,
        history: rows.events.filter(row => ['artifact-canaried', 'artifact-activated', 'artifact-rolled-back'].includes(row.kind)) };
      else {
        let planned: ExperientialResult<unknown> | null = null;
        if (input.preview) {
          const request = input.preview, deployment = rows.deployments.find(row => row.id === request.deploymentId);
          if (!deployment) planned = refuseExperiential('TEXP1004', '/deploymentId', 'The scoped deployment is missing.');
          else {
            const plan = await planExperientialRetention({ episodeIds: request.episodeIds, deployment, artifacts: rows.artifacts,
              lineage: { experiences: rows.experiences, assessments: rows.assessments, datasets: rows.datasets, trainingRuns: rows.training_runs, events: rows.events },
              now: request.now, policy: request.policy });
            planned = plan.ok ? { ok: true, value: plan.value.decisions } : plan;
          }
        }
        value = { decisions: rows.retention_decisions, events: rows.events.filter(row => row.kind === 'retention-applied'), preview: planned };
      }
      return redactExperientialView({ ok: true, value });
    } catch (error) { return refuseExperiential('TEXP1009', '/inspection', 'The read could not complete; no mutation was requested.', experientialNativeCause(error)); }
  };
  return Object.fromEntries(Object.keys(experientialContractDocument.operations).map(operation => [operation, handler(operation as keyof typeof experientialContractDocument.operations)]));
}
export type ExperientialOperations = Readonly<Pick<LocalClient, 'invoke' | 'describe' | 'contract'> & { close(): Promise<void> }>;
export function createExperientialOperations(store: ExperientialStore): ExperientialOperations {
  const client = openLocalClient(createExperientialContract(), createExperientialHandlers(store));
  return Object.freeze({ invoke: client.invoke, describe: client.describe, contract: client.contract, async close() { client.close(); } });
}
