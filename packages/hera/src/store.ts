/** Domain persistence shared by memory and database adapters; every write is guarded. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { HeraRefusal, heraIssue, type HeraOutcome } from './errors.ts';
import { assertLearningWrite, isHeraLearningKind, type HeraAuthority } from './modes.ts';
import { validateHeraRecord } from './schema.ts';
import { planHeraHeadTransition, planPromptActivation, planPromptRollback, planSnapshotActivation, planHeraLibraryTransition, type HeraHeadPlan } from './heads.ts';
import type { HeraAgentDefinition, HeraPromptVersion, HeraExperience, HeraTopology, HeraRolloutGroup,
  HeraTrajectory, HeraTrajectoryStep, HeraOperation, HeraSemanticAdvantage, HeraPromptTrial, HeraLearningSnapshot, HeraHead,HeraFailureBuffer,HeraMutation } from './contracts.gen.ts';
export interface HeraRecords {
  operation: HeraOperation; agent: HeraAgentDefinition; promptVersion: HeraPromptVersion; experience: HeraExperience;
  topology: HeraTopology; rolloutGroup: HeraRolloutGroup; trajectory: HeraTrajectory;
  trajectoryStep: HeraTrajectoryStep; advantage: HeraSemanticAdvantage; promptTrial: HeraPromptTrial;
  snapshot: HeraLearningSnapshot; head: HeraHead;failureBuffer:HeraFailureBuffer;mutation:HeraMutation;
}
export type HeraRecordKind = keyof HeraRecords;
type HeraMutableKind = Exclude<HeraRecordKind, 'head'>;
export type HeraRecordMethods = {
  [K in HeraMutableKind as `put${Capitalize<K>}`]: (value: HeraRecords[K], authority: HeraAuthority) => Promise<HeraOutcome<{value: HeraRecords[K]; written: boolean}>>;
} & {
  [K in HeraRecordKind as `get${Capitalize<K>}`]: (id: string) => Promise<HeraRecords[K] | undefined>;
};
export const HERA_RECORD_KINDS: readonly HeraRecordKind[] = ['operation','agent','promptVersion','experience','topology','rolloutGroup','trajectory','trajectoryStep','advantage','promptTrial','snapshot','head','failureBuffer','mutation'];
export interface HeraQuery { scope?: string; status?: string; agentId?: string; groupId?: string; taskId?: string; limit?: number; }
export interface HeraPersistenceView {
  get<K extends HeraRecordKind>(kind: K, id: string): Promise<HeraRecords[K] | undefined>;
  put<K extends HeraRecordKind>(kind: K, record: HeraRecords[K]): Promise<void>;
  query<K extends HeraRecordKind>(kind: K, query: HeraQuery): Promise<HeraRecords[K][]>;
}
/** Trusted host seam; a throw must discard every write, including prior successful puts. */
export interface HeraPersistence { transaction<T>(fn: (view: HeraPersistenceView) => Promise<T>): Promise<T>; }
export interface HeraTransaction extends Omit<HeraPersistenceView, 'put'> {
  put<K extends Exclude<HeraRecordKind, 'head'>>(kind: K, record: HeraRecords[K]): Promise<{ value: HeraRecords[K]; written: boolean }>;
  transitionHead(plan: HeraHeadPlan): Promise<HeraHead>;
}
export interface HeraStore extends HeraRecordMethods {
  readonly scope: string;
  get<K extends HeraRecordKind>(kind: K, id: string): Promise<HeraRecords[K] | undefined>;
  put<K extends Exclude<HeraRecordKind, 'head'>>(kind: K, record: HeraRecords[K], authority: HeraAuthority): Promise<HeraOutcome<{ value: HeraRecords[K]; written: boolean }>>;
  query<K extends HeraRecordKind>(kind: K, query: HeraQuery): Promise<HeraRecords[K][]>;
  readHead(id: string): Promise<HeraHead | undefined>;
  transitionHead(plan: HeraHeadPlan, authority: HeraAuthority): Promise<HeraOutcome<HeraHead>>;
  transaction<T>(authority: HeraAuthority, fn: (view: HeraTransaction) => Promise<T>): Promise<HeraOutcome<T>>;
  listOperations(query: HeraQuery & {groupId: string}): Promise<HeraOperation[]>;
  listExperiences(query: HeraQuery & {scope: string}): Promise<HeraExperience[]>;
  listPromptVersions(query: HeraQuery & {agentId: string}): Promise<HeraPromptVersion[]>;
  listTrajectories(query: HeraQuery & {groupId: string}): Promise<HeraTrajectory[]>;
  listSnapshots(query: HeraQuery & {scope: string}): Promise<HeraLearningSnapshot[]>;
  counters(): { learningWrites: number; refusedLearningWrites: number };
}
const must = <T>(value: HeraOutcome<T>): T => { if (!value.valid) throw new HeraRefusal(value.issues); return value.value; };
const refuse = (code: Parameters<typeof heraIssue>[0], path: string, detail: string): never => { throw new HeraRefusal([heraIssue(code, path, detail)]); };
export function checkedHeraQuery(query: HeraQuery): HeraQuery {
  const limit = query.limit ?? 1000;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10000) throw new RangeError('HERA queries require a limit between 0 and 10000.');
  return { ...query, limit };
}
export function createHeraStoreAdapter(persistence: HeraPersistence, scope: string): HeraStore {
  if (typeof scope !== 'string' || !scope) throw new TypeError('A HERA store requires an explicit scope.');
  let learningWrites = 0, refusedLearningWrites = 0;
  const transaction: HeraStore['transaction'] = async (authority, fn) => {
    let applied = 0;
    try {
      if (authority.scope !== scope) refuse('THERA1004', '/scope', 'The authority differs from the store scope.');
      const value = await persistence.transaction(async raw => {
        let invalid: HeraRefusal | undefined;
        const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
          try { return await operation(); }
          catch (error) { if (error instanceof HeraRefusal) invalid = error; throw error; }
        };
        const checkAuthority = (kind: HeraRecordKind, scope: string) => {
          if (scope !== authority.scope) refuse('THERA1004', '/scope', 'The record crosses the host authority scope.');
          must(assertLearningWrite(authority.mode, kind));
        };
        const write = async <K extends HeraRecordKind>(kind: K, record: HeraRecords[K]) => {
          const value = must(await validateHeraRecord(kind, record));
          checkAuthority(kind, value.scope);
          await raw.put(kind, value);
          if (isHeraLearningKind(kind)) applied++;
        };
        const view: HeraTransaction = {
          get: (kind, id) => raw.get(kind, id),
          query: (kind, query) => raw.query(kind, checkedHeraQuery(query)),
          async put(kind, record) {
            if ((kind as HeraRecordKind) === 'head') return refuse('THERA1006', '/kind', 'Heads can only change through a fenced transition.');
            const value = must(await validateHeraRecord(kind, record));
            checkAuthority(kind, value.scope);
            const prior = await raw.get(kind, value.id);
            if (prior) {
              if (!equalsJson(prior, value)) refuse('THERA1002', '/id', 'An immutable address already contains different bytes.');
              return { value: cloneJson(prior), written: false };
            }
            // Active prompt/snapshot status is earned by a fenced activation only.
            if ((kind === 'promptVersion' || kind === 'snapshot') && 'status' in value && value.status === 'active')
              refuse('THERA1006', '/status', 'Stage a candidate and activate it through its head.');
            await write(kind, value);
            return { value: cloneJson(value), written: true };
          },
          async transitionHead(plan) {
            checkAuthority('head', plan.expected.scope);
            const actual = await raw.get('head', plan.expected.id) ?? { ...plan.expected, versionId: null, revision: 0 };
            const fenced = must(planHeraHeadTransition(actual, plan.expected, plan.next.versionId!));
            if (!equalsJson(fenced.next, plan.next)) refuse('THERA1006', '/next', 'The proposed head differs from its transition.');
            let expected = fenced;
            if (actual.kind === 'prompt') {
              const candidate = await raw.get('promptVersion', plan.next.versionId!);
              if (!candidate) return refuse('THERA1002', '/versionId', 'The prompt version is missing.');
              const agent = await raw.get('agent', candidate.agentId);
              if (!agent || agent.envelopeRevision !== candidate.envelopeRevision || agent.scope !== candidate.scope)
                return refuse('THERA1002', '/envelopeRevision', 'The prompt does not bind a stored agent envelope.');
              const previous=actual.versionId?await raw.get('promptVersion',actual.versionId):undefined;
              expected = must(candidate.status==='archived'&&previous?planPromptRollback(actual,plan.expected,candidate,previous):planPromptActivation(actual, plan.expected, candidate,previous));
            } else if (actual.kind === 'snapshot') {
              const candidate = await raw.get('snapshot', plan.next.versionId!);
              if (!candidate) return refuse('THERA1002', '/versionId', 'The snapshot is missing.');
              for (const [agentId, id] of Object.entries(candidate.activePromptVersionIds)) {
                const prompt = await raw.get('promptVersion', id);
                if (!prompt || prompt.agentId !== agentId || prompt.scope !== candidate.scope || prompt.status !== 'active')
                  return refuse('THERA1002', '/activePromptVersionIds/' + agentId, 'The frozen prompt is missing or belongs to another role.');
              }
              for (const id of candidate.experienceIds) {
                const entry = await raw.get('experience', id);
                if (!entry || entry.scope !== candidate.scope) return refuse('THERA1002', '/experienceIds', 'A frozen experience is missing.');
              }
              for(const [agentId,id] of Object.entries(candidate.failureBufferIds??{})){
                const buffer=await raw.get('failureBuffer',id);
                if(!buffer||buffer.agentId!==agentId||buffer.scope!==candidate.scope)return refuse('THERA1002','/failureBufferIds/'+agentId,'The frozen role buffer is missing or foreign.');
              }
              for(const [bucket,id] of Object.entries(candidate.preferredTopologyIds??{})){
                const topology=await raw.get('topology',id),mutationId=candidate.preferredMutationIds?.[bucket],mutation=mutationId?await raw.get('mutation',mutationId):undefined;
                if(!topology||topology.scope!==candidate.scope||!mutation||mutation.scope!==candidate.scope||mutation.profileBucket!==bucket||mutation.candidateTopologyId!==id||mutation.decision!=='accepted')
                  return refuse('THERA1002','/preferredTopologyIds/'+bucket,'A topology hint requires its scoped accepted mutation.');
              }
              expected = must(planSnapshotActivation(actual, plan.expected, candidate, actual.versionId ? await raw.get('snapshot', actual.versionId) : undefined));
            } else if(actual.kind==='library'&&plan.membership){
              const before=await Promise.all(plan.membership.previousIds.map(id=>raw.get('experience',id))),after=await Promise.all(plan.membership.nextIds.map(id=>raw.get('experience',id)));
              if(before.some(e=>!e)||after.some(e=>!e))return refuse('THERA1006','/membership','A library version disappeared before activation.');
              expected=must(await planHeraLibraryTransition(actual,plan.expected,before as HeraExperience[],after as HeraExperience[]));
              if(!equalsJson(expected.membership,plan.membership)||!equalsJson(expected.next,plan.next))return refuse('THERA1006','/membership','The proposed library membership changed.');
            }
            if (!equalsJson(expected.changes, plan.changes)) refuse('THERA1006', '/changes', 'Activation metadata differs from its pure plan.');
            for (const change of expected.changes) {
              const record = await raw.get(change.kind, change.id);
              if (!record || record.status !== change.from) return refuse('THERA1006', '/changes', 'An activation member changed.');
              await write(change.kind, { ...record, status: change.to } as HeraRecords[typeof change.kind]);
            }
            await write('head', expected.next);
            return cloneJson(expected.next);
          },
        };
        const put = view.put, transition = view.transitionHead;
        view.put = (kind, record) => guarded(() => put(kind, record));
        view.transitionHead = plan => guarded(() => transition(plan));
        const value = await fn(view);
        if (invalid) throw invalid;
        return value;
      });
      learningWrites += applied;
      return { valid: true, value };
    } catch (error) {
      if (!(error instanceof HeraRefusal)) throw error;
      if (error.issues.some(i => i.code === 'THERA1004')) refusedLearningWrites++;
      return { valid: false, issues: cloneJson(error.issues) };
    }
  };
  const query: HeraStore['query'] = (kind, q) => persistence.transaction(tx => tx.query(kind, checkedHeraQuery(q)));
  const store: HeraStore = {
    ...Object.fromEntries(HERA_RECORD_KINDS.flatMap(kind => {
      const suffix = kind[0].toUpperCase() + kind.slice(1);
      return [[`get${suffix}`, (id: string) => persistence.transaction(tx => tx.get(kind, id))],
        ...(kind === 'head' ? [] : [[`put${suffix}`, (value: HeraRecords[typeof kind], authority: HeraAuthority) => transaction(authority, tx => tx.put(kind, value))]])];
    })) as HeraRecordMethods,
    scope,
    get: (kind, id) => persistence.transaction(tx => tx.get(kind, id)),
    put: (kind, value, authority) => transaction(authority, tx => tx.put(kind, value)),
    query, transaction,
    readHead: id => persistence.transaction(tx => tx.get('head', id)),
    transitionHead: (plan, authority) => transaction(authority, tx => tx.transitionHead(plan)),
    listOperations: q => query('operation', q),
    listExperiences: q => query('experience', q), listPromptVersions: q => query('promptVersion', q),
    listTrajectories: q => query('trajectory', q), listSnapshots: q => query('snapshot', q),
    counters: () => ({ learningWrites, refusedLearningWrites }),
  };
  return Object.freeze(store);
}
export interface MemoryHeraStoreOptions { scope: string; applyProbe?: (step: string) => void; }
export function createMemoryHeraStore(options: MemoryHeraStoreOptions): HeraStore {
  let state = Object.fromEntries(HERA_RECORD_KINDS.map(k => [k, new Map()])) as { [K in HeraRecordKind]: Map<string, HeraRecords[K]> };
  let pending: Promise<unknown> = Promise.resolve();
  return createHeraStoreAdapter({ transaction<T>(fn: (view: HeraPersistenceView) => Promise<T>): Promise<T> {
    const result = pending.then(async () => {
      const staged = Object.fromEntries(HERA_RECORD_KINDS.map(k => [k, new Map([...state[k]].map(([id,v]) => [id, cloneJson(v)]))])) as typeof state;
      const view: HeraPersistenceView = {
        async get(kind, id) { const value = staged[kind].get(id); return value === undefined ? undefined : cloneJson(value) as never; },
        async put(kind, value) { (staged[kind] as Map<string, HeraRecords[typeof kind]>).set(value.id, cloneJson(value)); options.applyProbe?.('put:' + kind); },
        async query(kind, query) {
          const { limit, ...filters } = checkedHeraQuery(query);
          const rows = [...staged[kind].values()].filter(row => Object.entries(filters).every(([key,value]) => value === undefined || (row as unknown as Record<string,unknown>)[key] === value));
          rows.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
          return cloneJson(rows.slice(0, limit)) as never;
        },
      };
      const value = await fn(view); options.applyProbe?.('commit'); state = staged; return value;
    });
    pending = result.then(() => undefined, () => undefined);
    return result;
  } }, options.scope);
}
