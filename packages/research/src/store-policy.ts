import { cloneJson, equalsJson } from '@jarenjs/core/object';
import type { ArtifactAdmission, ResearchProject, ResearchState, StageArtifactDescriptor, StageAttemptKey, StageCommitReceipt } from './contracts.gen.ts';
import { researchIssue, type ResearchCode, type ResearchOutcome } from './errors.ts';
import { artifactAdmissionIdOf, copyResearchBytes, immutableResearchJson, researchArtifactIdOf, researchRevisionOf } from './identity.ts';
import { researchRecordIdOf, validateResearchRecord, type ResearchRecordEntry, type ResearchRecordKind, type ResearchRecordWrite } from './records.ts';
import { validateResearchShape, type ResearchSchemaName } from './schema.ts';
import type { ResearchPersistence, ResearchStore, ResearchStoreOutcome, ResearchTransaction } from './store.ts';
import { planAmendment, planContractFreeze, planProjectCreate, planStageCommit, planStateTransition } from './transitions.ts';

class ResearchRollback extends Error {
  readonly issue;
  constructor(code: ResearchCode, path: string, detail: string) { super(detail); this.issue = researchIssue(code, path, detail); }
}
function refuse(code: ResearchCode, path: string, detail: string): never { throw new ResearchRollback(code, path, detail); }
function checked<T>(outcome: ResearchOutcome<T>): T {
  if (outcome.valid) return outcome.value;
  const issue = outcome.issues[0];
  throw new ResearchRollback(issue.code as ResearchCode, issue.path, issue.detail);
}
const shape = <T>(name: ResearchSchemaName, value: unknown): T => checked(validateResearchShape<T>(name, value));
const result = <T>(value: T, replayed = false) => ({ value, ...(replayed ? { replayed: true } : {}) });
const recordKey = (kind: ResearchRecordKind, id: string) => JSON.stringify([kind, id]);
const terminal = (state: ResearchState) => state.status === 'COMPLETE' || state.status === 'STOPPED';
const sorted = (items: readonly string[]) => [...items].sort();
const attemptKey = (value: StageAttemptKey): StageAttemptKey => ({ projectId: value.projectId, stage: value.stage,
  attemptOrdinal: value.attemptOrdinal, inputManifestHash: value.inputManifestHash });
const managed = new Set<ResearchRecordKind>(['ResearchProject', 'StageAttempt', 'ResearchArtifact', 'ArtifactAdmission', 'Amendment']);

/** Shared admission policy; persistence only supplies one atomic scope and native projections. */
export function createResearchStoreAdapter(persistence: ResearchPersistence): ResearchStore {
  async function apply<I, T>(input: I, body: (tx: ResearchTransaction, value: I) => Promise<{ value: T; replayed?: boolean }>): Promise<ResearchStoreOutcome<T>> {
    let value: I;
    try { value = immutableResearchJson(input); }
    catch (cause) { return { ok: false, issue: researchIssue('TRSH1001', '', 'Store input must be finite JSON.', cause) }; }
    try { return { ok: true, ...cloneJson(await persistence.transaction(tx => body(tx, value))) }; }
    catch (cause) {
      return { ok: false, issue: cause instanceof ResearchRollback ? cause.issue
        : researchIssue('TRSH1008', '', 'Research persistence transaction failed.', cause) };
    }
  }
  async function project(tx: ResearchTransaction, projectId: string, required = true): Promise<ResearchProject | null> {
    shape('ResearchId', projectId);
    const row = await tx.get('projects', projectId, projectId);
    if (row === undefined) {
      if (required) refuse('TRSH1003', '/projectId', 'Unknown research project.');
      return null;
    }
    const value = shape<ResearchProject>('ResearchProject', row);
    if (value.id !== projectId) refuse('TRSH1005', '/projectId', 'Stored project scope differs from its address.');
    return value;
  }
  async function state(tx: ResearchTransaction, projectId: string): Promise<ResearchState> {
    const value = await tx.get('state', projectId, 'control');
    if (value === undefined) refuse('TRSH1003', '/state', 'Project control state is missing.');
    const row = shape<ResearchState>('ResearchState', value);
    if (row.projectId !== projectId) refuse('TRSH1005', '/state/projectId', 'Stored control scope differs from its address.');
    return row;
  }
  async function expect(tx: ResearchTransaction, expected: ResearchState): Promise<ResearchState> {
    const planState = shape<ResearchState>('ResearchState', expected);
    await project(tx, planState.projectId);
    const current = await state(tx, planState.projectId);
    if (!equalsJson(current, planState)) refuse('TRSH1004', '/expectedState', 'Research control state changed; re-plan from the current revision.');
    return current;
  }
  function samePlan(actual: unknown, planned: unknown) {
    if (!equalsJson(actual, planned)) refuse('TRSH1004', '/plan', 'Plan differs from its validated transition.');
  }
  async function entry(projectId: string, write: ResearchRecordWrite): Promise<ResearchRecordEntry> {
    if (!write || typeof write !== 'object' || !equalsJson(Object.keys(write).sort(), ['kind', 'value']))
      refuse('TRSH1001', '/record', 'A record write contains only kind and value.');
    const value = checked(validateResearchRecord(write.kind, write.value));
    if (!Array.isArray(value) && 'projectId' in value && value.projectId !== projectId)
      refuse('TRSH1005', '/record/projectId', 'Record belongs to another project.');
    const id = await researchRecordIdOf(write.kind, value);
    if (write.kind === 'ResearchProject' && id !== projectId) refuse('TRSH1005', '/record/id', 'Project id differs from the record scope.');
    // Self-hashed contracts may be stored as history; activating them is a separate CAS operation.
    const hashes: Partial<Record<ResearchRecordKind, string>> = { ResearchContract: 'contractHash', ExperimentPlan: 'planHash', ResearchManifest: 'manifestHash',
      WorkspaceManifest: 'workspaceHash', ExecutionManifest: 'executionManifestHash', ResearchHypothesis: 'hypothesisHash' };
    const hashKey = hashes[write.kind];
    if (hashKey) {
      const body = { ...value } as Record<string, unknown>, digest = body[hashKey]; delete body[hashKey];
      if (digest !== await researchRevisionOf(body)) refuse('TRSH1002', '/record/' + hashKey, 'Record content hash does not recompute.');
    }
    return { kind: write.kind, value, id, projectId } as ResearchRecordEntry;
  }
  async function readEntry(tx: ResearchTransaction, projectId: string, kind: ResearchRecordKind, id: string): Promise<ResearchRecordEntry | null> {
    const raw = await tx.get('records', projectId, recordKey(kind, id));
    if (raw === undefined) return null;
    const row = await entry(projectId, { kind: raw.kind, value: raw.value } as ResearchRecordWrite);
    if (row.id !== id || row.kind !== kind || !equalsJson(raw, row)) refuse('TRSH1002', '/record', 'Stored record address does not match its immutable payload.');
    return row;
  }
  async function entries(tx: ResearchTransaction, projectId: string): Promise<ResearchRecordEntry[]> {
    const rows: ResearchRecordEntry[] = [];
    for (const raw of await tx.list('records', projectId)) {
      const row = await entry(projectId, { kind: raw.kind, value: raw.value } as ResearchRecordWrite);
      if (!equalsJson(raw, row)) refuse('TRSH1002', '/record', 'Stored record scope or identity is invalid.');
      rows.push(row);
    }
    return rows;
  }
  async function put(tx: ResearchTransaction, row: ResearchRecordEntry): Promise<boolean> {
    const prior = await readEntry(tx, row.projectId, row.kind, row.id);
    if (prior) {
      if (!equalsJson(prior, row)) refuse('TRSH1002', '/record/id', 'Immutable record id already names different content.');
      return true;
    }
    await tx.put('records', row.projectId, recordKey(row.kind, row.id), row); return false;
  }
  async function admission(tx: ResearchTransaction, projectId: string, id: string): Promise<ArtifactAdmission> {
    const raw = await tx.get('artifacts', projectId, id);
    if (!raw || raw.kind !== 'admission') refuse('TRSH1003', '/artifactAdmissionId', 'Unknown artifact admission in this project.');
    const value = shape<ArtifactAdmission>('ArtifactAdmission', raw.admission);
    const { id: address, ...body } = value;
    if (value.projectId !== projectId || value.attempt.projectId !== projectId) refuse('TRSH1005', '/artifact/projectId', 'Artifact admission belongs to another project.');
    if (address !== id || address !== await artifactAdmissionIdOf(body) || value.artifact.storage.address !== value.artifact.id
      || value.artifact.producingStage !== value.attempt.stage
      || !equalsJson(sorted(value.artifact.parentIds), sorted([...new Set(value.parents.map(parent => parent.artifactId))])) )
      refuse('TRSH1002', '/artifact', 'Artifact admission identity or provenance does not recompute.');
    return value;
  }
  async function blob(tx: ResearchTransaction, value: ArtifactAdmission): Promise<Uint8Array> {
    const raw = await tx.get('artifacts', '@content', value.artifact.id);
    if (!raw || raw.kind !== 'blob') refuse('TRSH1003', '/artifact/storage', 'Artifact bytes are missing.');
    if (raw.id !== value.artifact.id || raw.data.length !== value.artifact.bytes
      || raw.data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255))
      refuse('TRSH1002', '/artifact/bytes', 'Stored artifact byte envelope is invalid.');
    const bytes = new Uint8Array(raw.data);
    if (await researchArtifactIdOf(bytes) !== value.artifact.id) refuse('TRSH1002', '/artifact/id', 'Stored bytes differ from their content address.');
    return bytes;
  }
  async function receipts(tx: ResearchTransaction, projectId: string): Promise<StageCommitReceipt[]> {
    return (await tx.list('attempts', projectId)).map(raw => {
      const value = shape<StageCommitReceipt>('StageCommitReceipt', raw);
      if (value.attempt.projectId !== projectId || value.nextState.projectId !== projectId)
        refuse('TRSH1005', '/attempt/projectId', 'Stored attempt belongs to another project.');
      return value;
    });
  }
  const committed = (rows: readonly StageCommitReceipt[]) => new Set(rows.flatMap(row => row.artifactAdmissionIds));
  async function references(tx: ResearchTransaction, row: ResearchRecordEntry, pending: readonly ResearchRecordEntry[] = [], outputs: readonly ArtifactAdmission[] = []) {
    async function reference(kind: ResearchRecordKind, id: string) {
      if (!pending.some(item => item.kind === kind && item.id === id) && !(await readEntry(tx, row.projectId, kind, id)))
        refuse('TRSH1003', '/record/' + kind, `Unknown ${kind} reference ${id}.`);
    }
    if (row.kind === 'ScreeningDecision') await reference('LiteratureRecord', row.value.literatureId);
    if (row.kind === 'EvidenceCard') {
      await reference('LiteratureRecord', row.value.literatureId);
      const artifactId = row.value.artifactId;
      let found = outputs.some(item => item.artifact.id === artifactId);
      for (const id of committed(await receipts(tx, row.projectId))) {
        if ((await admission(tx, row.projectId, id)).artifact.id === artifactId) { found = true; break; }
      }
      if (!found) refuse('TRSH1003', '/record/artifactId', 'Evidence must bind a committed or atomically admitted artifact.');
    }
    if (row.kind === 'Synthesis') for (const id of row.value.evidenceIds) await reference('EvidenceCard', id);
    if (row.kind === 'ResearchHypothesis') {
      await reference('Synthesis', row.value.synthesisId);
      for (const id of row.value.evidenceIds) await reference('EvidenceCard', id);
    }
    if (row.kind === 'MetricObservation') await reference('ExperimentRun', row.value.experimentRunId);
    if (row.kind === 'ResearchClaim') {
      for (const id of row.value.literatureIds) await reference('LiteratureRecord', id);
      for (const id of row.value.evidenceIds) await reference('EvidenceCard', id);
      for (const id of row.value.observationIds) await reference('MetricObservation', id);
    }
    if (row.kind === 'ResearchManifest') {
      for (const id of row.value.runIds) await reference('ExperimentRun', id);
      for (const id of row.value.observationIds) await reference('MetricObservation', id);
      for (const id of row.value.searchedLiterature) await reference('LiteratureRecord', id);
    }
  }
  async function finish(tx: ResearchTransaction, next: ResearchState, status: 'ok' | 'error' | 'cancelled' = 'ok') {
    if (terminal(next)) await tx.finishProjection(next.projectId, next, status);
  }
  return {
    createProject: input => apply(input, async (tx, plan) => {
      const valid = checked(planProjectCreate(plan.project)); samePlan(plan, valid);
      const prior = await project(tx, valid.project.id, false);
      if (prior) {
        if (!equalsJson(prior, valid.project)) refuse('TRSH1002', '/project/id', 'Project id already names different immutable content.');
        return result(await state(tx, prior.id), true);
      }
      await tx.put('projects', valid.project.id, valid.project.id, valid.project);
      await tx.put('state', valid.project.id, 'control', valid.state);
      await tx.createProjection(valid.project.id); return result(valid.state);
    }),
    getProject: projectId => apply({ projectId }, async (tx, value) => result(await project(tx, value.projectId, false))),
    getState: projectId => apply({ projectId }, async (tx, value) => result(await project(tx, value.projectId, false) ? await state(tx, value.projectId) : null)),
    putRecord: (projectId, record) => apply({ projectId, record }, async (tx, value) => {
      await project(tx, value.projectId);
      const row = await entry(value.projectId, value.record);
      if (managed.has(row.kind)) refuse('TRSH1004', '/record/kind', 'This record is admitted through its atomic lifecycle operation.');
      await references(tx, row);
      return result(row, await put(tx, row));
    }),
    getRecord: (projectId, kind, id) => apply({ projectId, kind, id }, async (tx, value) => {
      await project(tx, value.projectId);
      const row = await readEntry(tx, value.projectId, value.kind, value.id);
      return result((row?.value ?? null) as never);
    }),
    listRecords: (projectId, kind) => apply({ projectId, kind }, async (tx, value) => {
      await project(tx, value.projectId);
      return result((await entries(tx, value.projectId)).filter(row => row.kind === value.kind).map(row => row.value) as never);
    }),
    async stageArtifact(bytes, descriptor) {
      let copied: Uint8Array;
      try { copied = copyResearchBytes(bytes); }
      catch (cause) { return { ok: false, issue: researchIssue('TRSH1001', '/bytes', 'Expected an exact byte view.', cause) }; }
      return apply(descriptor, async (tx, input) => {
        const value = shape<StageArtifactDescriptor>('StageArtifactDescriptor', input);
        await project(tx, value.projectId);
        if (value.attempt.projectId !== value.projectId) refuse('TRSH1005', '/attempt/projectId', 'Artifact attempt belongs to another project.');
        for (const parent of value.parents) {
          if (parent.admissionId === null) {
            if (parent.artifactId !== value.projectId) refuse('TRSH1003', '/parents', 'Only the project record is a root parent.');
          } else if ((await admission(tx, value.projectId, parent.admissionId)).artifact.id !== parent.artifactId)
            refuse('TRSH1002', '/parents', 'Parent admission and artifact address differ.');
        }
        const id = await researchArtifactIdOf(copied);
        const body: Omit<ArtifactAdmission, 'id'> = { projectId: value.projectId, attempt: value.attempt,
          artifact: { id, mediaType: value.mediaType, producingStage: value.attempt.stage,
            parentIds: [...new Set(value.parents.map(parent => parent.artifactId))], storage: { kind: 'content', address: id },
            bytes: copied.byteLength, verification: value.verification }, parents: value.parents };
        const row = shape<ArtifactAdmission>('ArtifactAdmission', { ...body, id: await artifactAdmissionIdOf(body) });
        const prior = await tx.get('artifacts', value.projectId, row.id);
        if (prior !== undefined) {
          if (!equalsJson(prior, { kind: 'admission', admission: row })) refuse('TRSH1002', '/artifact/id', 'Immutable artifact admission changed.');
          await blob(tx, row); return result(row, true);
        }
        const content = await tx.get('artifacts', '@content', id);
        if (content === undefined) await tx.put('artifacts', '@content', id, { kind: 'blob', id, data: [...copied] });
        else await blob(tx, row);
        await tx.put('artifacts', value.projectId, row.id, { kind: 'admission', admission: row }); return result(row);
      });
    },
    async readArtifact(projectId, admissionId) {
      const outcome = await apply({ projectId, admissionId }, async (tx, value) => {
        await project(tx, value.projectId); const row = await admission(tx, value.projectId, value.admissionId);
        return result({ admission: row, bytes: [...await blob(tx, row)] });
      });
      return outcome.ok ? { ...outcome, value: { admission: outcome.value.admission, bytes: new Uint8Array(outcome.value.bytes) } } : outcome;
    },
    commitStage: input => apply(input, async (tx, plan) => {
      const valid = checked(await planStageCommit({ state: plan.expectedState, attempt: plan.attempt, manifest: plan.manifest,
        nextStatus: plan.nextState.status, artifactAdmissionIds: plan.artifactAdmissionIds, records: plan.records }));
      samePlan(plan, valid);
      const projectId = valid.attempt.projectId, owner = (await project(tx, projectId))!;
      const rows = await receipts(tx, projectId);
      const operationHash = await researchRevisionOf({ attempt: valid.attempt, manifest: valid.manifest, artifactAdmissionIds: valid.artifactAdmissionIds,
        records: valid.records, projection: valid.projection, nextStatus: valid.nextState.status });
      const prior = rows.find(row => row.attempt.id === valid.attempt.id);
      if (prior) {
        if (prior.operationHash !== operationHash) refuse('TRSH1002', '/attempt/id', 'Committed attempt already names another result.');
        return result(prior, true);
      }
      await expect(tx, valid.expectedState);
      for (const row of rows) {
        if (row.attempt.masPath === valid.attempt.masPath || row.attempt.stage === valid.attempt.stage && row.attempt.attemptOrdinal >= valid.attempt.attemptOrdinal)
          refuse('TRSH1004', '/attempt', 'MAS path or stage ordinal has already been committed.');
      }
      for (const key of ['calls', 'tokens', 'ms', 'physical'] as const) {
        if (rows.reduce((sum, row) => sum + row.attempt.spend[key], valid.attempt.spend[key]) > owner.budget[key])
          refuse('TRSH1006', '/attempt/spend/' + key, 'Committed spend would exceed the project budget.');
      }
      const previousIds = committed(rows), available = new Set([...previousIds, ...valid.artifactAdmissionIds]);
      const outputs: ArtifactAdmission[] = [];
      for (const id of valid.artifactAdmissionIds) {
        const row = await admission(tx, projectId, id);
        if (!equalsJson(row.attempt, attemptKey(valid.attempt))) refuse('TRSH1005', '/artifact/attempt', 'Output belongs to another producing attempt.');
        if (row.artifact.verification !== 'verified') refuse('TRSH1005', '/artifact/verification', 'Only verified artifacts may become committed evidence.');
        await blob(tx, row);
        for (const parent of row.parents) if (parent.admissionId !== null) {
          if (!available.has(parent.admissionId))
            refuse('TRSH1003', '/artifact/parents', 'Parent admission is neither committed nor selected in this atomic commit.');
          if (previousIds.has(parent.admissionId) && !valid.manifest.inputs.some(input => input.artifactId === parent.artifactId))
            refuse('TRSH1005', '/artifact/parents', 'Upstream artifact is absent from this stage input manifest.');
        }
        outputs.push(row);
      }
      if (!equalsJson(sorted([...new Set(outputs.map(row => row.artifact.id))]), sorted(valid.attempt.outputArtifactIds)))
        refuse('TRSH1002', '/attempt/outputArtifactIds', 'Attempt outputs differ from the selected artifact admissions.');
      const previousArtifacts = new Set<string>();
      for (const id of previousIds) previousArtifacts.add((await admission(tx, projectId, id)).artifact.id);
      for (const item of valid.manifest.inputs) if (!previousArtifacts.has(item.artifactId))
        refuse('TRSH1003', '/manifest/inputs', 'Input artifact has no committed admission in this project.');
      const records: ResearchRecordEntry[] = [];
      for (const write of valid.records) {
        const row = await entry(projectId, write);
        if (managed.has(row.kind)) refuse('TRSH1004', '/records/kind', 'Stage writes cannot replace lifecycle-managed records.');
        if (records.some(other => other.kind === row.kind && other.id === row.id)) refuse('TRSH1002', '/records', 'Stage record addresses must be unique.');
        records.push(row);
      }
      for (const row of records) await references(tx, row, records, outputs);
      for (const id of valid.attempt.interventions) if (!records.some(row => row.kind === 'Intervention' && row.id === id)
        && !(await readEntry(tx, projectId, 'Intervention', id))) refuse('TRSH1003', '/attempt/interventions', 'Unknown intervention.');
      records.push(await entry(projectId, { kind: 'InputManifest', value: valid.manifest }));
      records.push(await entry(projectId, { kind: 'StageAttempt', value: valid.attempt }));
      for (const row of records) await put(tx, row);
      const receipt = shape<StageCommitReceipt>('StageCommitReceipt', { attempt: valid.attempt, artifactAdmissionIds: valid.artifactAdmissionIds,
        recordIds: [...new Set(records.map(row => row.id))].sort(), nextState: valid.nextState, operationHash });
      await tx.put('attempts', projectId, valid.attempt.id, receipt);
      await tx.put('state', projectId, 'control', valid.nextState);
      await tx.appendProjection(projectId, valid.projection);
      await finish(tx, valid.nextState, valid.projection.status); return result(receipt);
    }),
    transition: input => apply(input, async (tx, plan) => {
      const current = await expect(tx, plan.expectedState), valid = checked(planStateTransition(current, plan.nextState.status));
      samePlan(plan, valid);
      await tx.put('state', current.projectId, 'control', valid.nextState);
      await finish(tx, valid.nextState); return result(valid.nextState);
    }),
    freezeContract: input => apply(input, async (tx, plan) => {
      const current = await expect(tx, plan.expectedState);
      const observations = (await entries(tx, current.projectId)).filter(row => row.kind === 'MetricObservation').map(row => row.id);
      const valid = checked(await planContractFreeze(current, plan.contract, plan.plan, observations)); samePlan(plan, valid);
      await put(tx, await entry(current.projectId, { kind: 'ResearchContract', value: valid.contract }));
      await put(tx, await entry(current.projectId, { kind: 'ExperimentPlan', value: valid.plan }));
      if (equalsJson(current, valid.nextState)) return result(current, true);
      await tx.put('state', current.projectId, 'control', valid.nextState); return result(valid.nextState);
    }),
    amendContract: input => apply(input, async (tx, plan) => {
      const current = await expect(tx, plan.expectedState), known = await entries(tx, current.projectId);
      const observations = known.filter(row => row.kind === 'MetricObservation').map(row => row.id);
      const valid = checked(await planAmendment(current, plan.amendment, plan.contract, plan.plan, observations)); samePlan(plan, valid);
      if (valid.amendment.marksExploratory.some(id => !known.some(row => row.id === id)))
        refuse('TRSH1003', '/amendment/marksExploratory', 'Amendment names an unknown record.');
      for (const write of [{ kind: 'Amendment', value: valid.amendment }, { kind: 'ResearchContract', value: valid.contract },
        { kind: 'ExperimentPlan', value: valid.plan }] satisfies ResearchRecordWrite[]) await put(tx, await entry(current.projectId, write));
      await tx.put('state', current.projectId, 'control', valid.nextState); return result(valid.nextState);
    }),
    getAttempt: (projectId, attemptId) => apply({ projectId, attemptId }, async (tx, value) => {
      await project(tx, value.projectId); return result((await receipts(tx, value.projectId)).find(row => row.attempt.id === value.attemptId) ?? null);
    }),
    collectUnreferenced: (projectId, before) => apply({ projectId, before }, async (tx, value) => {
      await project(tx, value.projectId); shape('ResearchLifecycle', value.before.stage);
      if (!Number.isSafeInteger(value.before.attemptOrdinal) || value.before.attemptOrdinal < 1) refuse('TRSH1001', '/before/attemptOrdinal', 'Expected a positive safe ordinal.');
      const used = committed(await receipts(tx, value.projectId)), found: ArtifactAdmission[] = [];
      for (const row of await tx.list('artifacts', value.projectId)) if (row.kind === 'admission') {
        const item = await admission(tx, value.projectId, row.admission.id);
        if (!used.has(item.id) && item.attempt.stage === value.before.stage && item.attempt.attemptOrdinal < value.before.attemptOrdinal) found.push(item);
      }
      return result(found);
    }),
    snapshot: projectId => apply({ projectId }, async (tx, value) => {
      const owner = await project(tx, value.projectId, false); if (!owner) return result(null);
      const attempts = await receipts(tx, value.projectId), artifacts: ArtifactAdmission[] = [];
      for (const row of await tx.list('artifacts', value.projectId)) if (row.kind === 'admission') artifacts.push(await admission(tx, value.projectId, row.admission.id));
      return result({ project: owner, state: await state(tx, value.projectId), records: await entries(tx, value.projectId),
        artifacts, attempts, committedAdmissionIds: sorted([...committed(attempts)]) });
    }),
  };
}
