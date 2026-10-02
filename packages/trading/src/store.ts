/** Content-addressed records and one transaction owner for simulated financial writes. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { toEpoch } from '@jarenjs/core/series';
import { tradingRevisionOf } from './identity.ts';
import { createTradingRecord, validateTradingRecord } from './records.ts';
import { validateTradingShape } from './schema.ts';
import { accountTradingFills, validateInitialTradingPortfolio, validateTradingLedger } from './accounting.ts';
import { tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingRunManifest, MarketSession, Observation, MarketSnapshot, Artifact, TradingDecision, OrderIntent, Fill,
  LedgerEntry, PortfolioSnapshot, TradingDayResult, BacktestResult, TradingCommit, TradingCommitMarker, TradingDecisionKey, TradingRecord } from './contracts.gen.ts';

export interface TradingTables {
  manifests: TradingRunManifest; sessions: MarketSession; observations: Observation; snapshots: MarketSnapshot; artifacts: Artifact;
  decisions: TradingDecision | TradingCommitMarker; orders: OrderIntent; fills: Fill; ledger: LedgerEntry; portfolios: PortfolioSnapshot;
  results: TradingDayResult | BacktestResult;
}
export const TRADING_TABLES = ['manifests', 'sessions', 'observations', 'snapshots', 'artifacts', 'decisions', 'orders', 'fills', 'ledger', 'portfolios', 'results'] as const;
export interface TradingQuery { manifestId?: string; kind?: string; key?: TradingDecisionKey; }
export interface TradingTransaction {
  get<K extends keyof TradingTables>(table: K, id: string): Promise<TradingTables[K] | undefined>;
  put<K extends keyof TradingTables>(table: K, record: TradingTables[K]): Promise<void>;
  delete<K extends keyof TradingTables>(table: K, id: string): Promise<void>;
  query<K extends keyof TradingTables>(table: K, query: TradingQuery): Promise<TradingTables[K][]>;
}
export interface TradingPersistence { transaction<T>(task: (view: TradingTransaction) => Promise<T>): Promise<T>; }
export type TradingInputTable = 'manifests' | 'sessions' | 'observations' | 'snapshots' | 'results';
export interface TradingWriteReceipt { changed: boolean; id: string; writes: number; }
export interface TradingStore {
  readonly atomic: true;
  put<K extends TradingInputTable>(table: K, record: TradingTables[K]): Promise<TradingOutcome<TradingWriteReceipt>>;
  get<K extends keyof TradingTables>(table: K, id: string): Promise<TradingTables[K] | undefined>;
  list<K extends keyof TradingTables>(table: K, query?: TradingQuery): Promise<TradingTables[K][]>;
  initializePortfolio(portfolio: PortfolioSnapshot): Promise<TradingOutcome<TradingWriteReceipt>>;
  stageArtifact(key: TradingDecisionKey, artifact: Artifact): Promise<TradingOutcome<TradingWriteReceipt>>;
  commitDecision(plan: TradingCommit): Promise<TradingOutcome<TradingWriteReceipt>>;
  readDecision(key: TradingDecisionKey): Promise<TradingDecision | undefined>;
  listPortfolios(manifestId: string): Promise<PortfolioSnapshot[]>;
  latestPortfolio(manifestId: string): Promise<PortfolioSnapshot | undefined>;
}
export interface TradingStoreOptions { applyProbe?: (step: string) => void; }
const TABLE_FOR: Record<TradingRecord['kind'], keyof TradingTables> = {
  manifest: 'manifests', session: 'sessions', bar: 'observations', fundamental: 'observations', news: 'observations', social: 'observations', insider: 'observations', profile: 'observations', 'corporate-action': 'observations',
  snapshot: 'snapshots', 'analyst-report': 'artifacts', 'debate-turn': 'artifacts', 'research-verdict': 'artifacts', 'trade-proposal': 'artifacts', 'risk-turn': 'artifacts', 'risk-verdict': 'artifacts', 'fund-manager-decision': 'artifacts',
  decision: 'decisions', 'decision-commit': 'decisions', order: 'orders', fill: 'fills', ledger: 'ledger', portfolio: 'portfolios', 'day-result': 'results', 'backtest-result': 'results',
};

export function tradingMatches(record: TradingRecord, query: TradingQuery): boolean {
  return (query.manifestId === undefined || ('manifestId' in record ? record.manifestId : record.id) === query.manifestId)
    && (query.kind === undefined || record.kind === query.kind) && (query.key === undefined || 'key' in record && equalsJson(record.key, query.key));
}
const orderRecords = (a: TradingRecord, b: TradingRecord): number => ('sequence' in a && 'sequence' in b ? a.sequence - b.sequence : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
async function checked<T extends TradingRecord>(value: T): Promise<TradingOutcome<T>> { return await validateTradingRecord(value) as TradingOutcome<T>; }
async function immutablePut<K extends keyof TradingTables>(tx: TradingTransaction, table: K, record: TradingTables[K]): Promise<TradingOutcome<TradingWriteReceipt>> {
  const existing = await tx.get(table, record.id);
  if (existing) return equalsJson(existing, record) ? { valid: true, value: { changed: false, id: record.id, writes: 0 } }
    : tradingRefuse('TTRD1006', '/id', 'Different bytes cannot reuse an immutable address');
  await tx.put(table, record); return { valid: true, value: { changed: true, id: record.id, writes: 1 } };
}
async function retainedPortfolio(tx: TradingTransaction, manifestId: string): Promise<PortfolioSnapshot | undefined> {
  return (await tx.query('portfolios', { manifestId })).sort(orderRecords).at(-1);
}

async function inputReferences(tx: TradingTransaction, record: TradingRecord, manifest: TradingRunManifest): Promise<TradingOutcome<true>> {
  if ('asset' in record && !manifest.assets.includes(record.asset)) return tradingRefuse('TTRD1002', '/asset', 'Asset is outside the run manifest');
  if (record.kind === 'session') {
    if (record.calendar !== manifest.calendar) return tradingRefuse('TTRD1003', '/calendar', 'Session belongs to a different calendar');
    const sameKey = (await tx.query('sessions', { manifestId: manifest.id })).find(s => s.key === record.key);
    if (sameKey && !equalsJson(sameKey, record)) return tradingRefuse('TTRD1006', '/key', 'A calendar key already identifies different session bytes');
  }
  if (record.kind === 'snapshot') {
    const sessions = await tx.query('sessions', { manifestId: manifest.id }), session = sessions.find(s => s.key === record.sessionId);
    if (!session || toEpoch(record.cutoffAt) !== toEpoch(session.closeAt)) return tradingRefuse('TTRD1003', '/cutoffAt', 'Snapshot cutoff must be its retained session close');
    const portfolio = await tx.get('portfolios', record.portfolioId);
    if (!portfolio || portfolio.manifestId !== manifest.id) return tradingRefuse('TTRD1002', '/portfolioId', 'Snapshot portfolio is not retained in this run');
    if (portfolio.asOfSessionId !== null) {
      const marked = sessions.find(s => s.key === portfolio.asOfSessionId);
      if (!marked || toEpoch(marked.closeAt) > toEpoch(session.closeAt)) return tradingRefuse('TTRD1003', '/portfolioId', 'Snapshot cannot use a future portfolio');
    }
    const refused = new Set(record.refused.map(r => r.id));
    for (const id of record.observationIds) {
      const observation = await tx.get('observations', id);
      if (!observation || observation.manifestId !== manifest.id || observation.asset !== record.asset || refused.has(id))
        return tradingRefuse('TTRD1004', '/observationIds', 'Snapshot evidence must be retained, admitted and scoped to this asset');
      if (toEpoch(observation.availableAt) > toEpoch(record.cutoffAt)) return tradingRefuse('TTRD1003', '/observationIds', 'Snapshot evidence was published after its cutoff');
    }
  }
  return { valid: true, value: true };
}

export function createTradingStoreAdapter(persistence: TradingPersistence, options: TradingStoreOptions = {}): TradingStore {
  if (typeof persistence?.transaction !== 'function') throw new TypeError('An atomic trading persistence adapter is required');
  const probe = (step: string) => options.applyProbe?.(step);
  return Object.freeze<TradingStore>({
    atomic: true as const,
    async put<K extends TradingInputTable>(table: K, input: TradingTables[K]): Promise<TradingOutcome<TradingWriteReceipt>> {
      const valid = await checked(input); if (!valid.valid) return valid;
      if (!['manifests', 'sessions', 'observations', 'snapshots', 'results'].includes(table) || TABLE_FOR[valid.value.kind] !== table)
        return tradingRefuse('TTRD1001', '/table', 'Record kind does not belong to an input table');
      return persistence.transaction(async tx => {
        if (valid.value.kind !== 'manifest') {
          const manifest = await tx.get('manifests', valid.value.manifestId);
          if (!manifest) return tradingRefuse('TTRD1002', '/manifestId', 'Run manifest is not retained');
          const references = await inputReferences(tx, valid.value, manifest); if (!references.valid) return references;
        }
        return immutablePut(tx, table, valid.value);
      });
    },
    get: <K extends keyof TradingTables>(table: K, id: string) => persistence.transaction(async tx => cloneJson(await tx.get(table, id))),
    list: <K extends keyof TradingTables>(table: K, query: TradingQuery = {}) => persistence.transaction(async tx => cloneJson((await tx.query(table, query)).sort(orderRecords))),
    initializePortfolio: async input => {
      const valid = await checked(input); if (!valid.valid) return valid;
      return persistence.transaction(async tx => {
        const manifest = await tx.get('manifests', valid.value.manifestId);
        if (!manifest) return tradingRefuse('TTRD1002', '/manifestId', 'Run manifest is not retained');
        const seed = validateInitialTradingPortfolio(manifest, valid.value); if (!seed.valid) return seed;
        const existing = await retainedPortfolio(tx, manifest.id);
        if (existing && !await tx.get('portfolios', valid.value.id)) return tradingRefuse('TTRD1006', '/portfolio', 'A run already has a different initial portfolio');
        return immutablePut(tx, 'portfolios', valid.value);
      });
    },
    stageArtifact: async (key, input) => {
      const valid = await checked(input); if (!valid.valid) return valid;
      if (!equalsJson(key, valid.value.key) || key.manifestId !== valid.value.manifestId) return tradingRefuse('TTRD1006', '/key', 'Artifact staging key differs');
      return persistence.transaction(async tx => {
        const snapshot = await tx.get('snapshots', valid.value.snapshotId);
        if (!snapshot || snapshot.manifestId !== key.manifestId || snapshot.asset !== key.asset || snapshot.sessionId !== key.sessionId)
          return tradingRefuse('TTRD1004', '/snapshotId', 'Artifact has no matching retained snapshot');
        if (valid.value.citations.some(id => !snapshot.observationIds.includes(id)) || valid.value.claims.some(c => c.citations.some(id => !valid.value.citations.includes(id))))
          return tradingRefuse('TTRD1004', '/citations', 'Artifact cites information outside its snapshot');
        const existing = await tx.query('artifacts', { key });
        if (existing.length && !equalsJson(existing[0], valid.value)) return tradingRefuse('TTRD1006', '/key', 'Artifact stage is already committed with different bytes');
        return immutablePut(tx, 'artifacts', valid.value);
      });
    },
    commitDecision: input => commitTradingDecision(persistence, input, probe),
    readDecision: key => persistence.transaction(async tx => {
      const marker = (await tx.query('decisions', { key, kind: 'decision-commit' }))[0] as TradingCommitMarker | undefined;
      return marker ? cloneJson(await tx.get('decisions', marker.decisionId)) as TradingDecision | undefined : undefined;
    }),
    listPortfolios: manifestId => persistence.transaction(async tx => cloneJson((await tx.query('portfolios', { manifestId })).sort(orderRecords))),
    latestPortfolio: manifestId => persistence.transaction(async tx => cloneJson(await retainedPortfolio(tx, manifestId))),
  });
}

export function planTradingCommit(plan: TradingCommit, manifest: TradingRunManifest, previous: PortfolioSnapshot, session: MarketSession): TradingOutcome<true> {
  if (!equalsJson(plan.key, plan.decision.key) || plan.key.manifestId !== manifest.id || plan.decision.manifestId !== manifest.id
    || !manifest.assets.includes(plan.key.asset) || session.manifestId !== manifest.id || session.key !== plan.key.sessionId)
    return tradingRefuse('TTRD1006', '/key', 'Decision scope does not match the retained manifest and session');
  if (manifest.mode === 'shadow') return tradingRefuse('TTRD1009', '/mode', 'Shadow execution is not enabled');
  if (plan.expectedPortfolioId !== previous.id || plan.portfolio.parentId !== previous.id)
    return tradingRefuse('TTRD1006', '/expectedPortfolioId', 'Portfolio advanced before this decision committed');
  const target = session.next ?? session.key;
  if (plan.portfolio.asOfSessionId !== target) return tradingRefuse('TTRD1006', '/portfolio/asOfSessionId', 'The portfolio must mark the next execution session');
  if (plan.intent && (plan.intent.manifestId !== manifest.id || plan.intent.decisionId !== plan.decision.id || plan.intent.asset !== plan.key.asset
    || plan.intent.decisionSessionId !== session.key || plan.intent.fillSessionId !== session.next)) return tradingRefuse('TTRD1006', '/intent', 'Intent does not follow the decision session');
  if (plan.decision.disposition === 'approved') {
    if (!plan.intent || plan.fills.length !== 1 || plan.fills[0].quantity !== plan.intent.quantity) return tradingRefuse('TTRD1006', '/fills', 'An approved market intent must have exactly one complete fill');
    if (plan.intent.orderKind !== 'market' || plan.intent.limitPrice !== null || plan.intent.stopPrice !== null) return tradingRefuse('TTRD1005', '/intent/orderKind', 'Only next-open market execution is supported');
  } else if (plan.fills.length || plan.ledgerEntries.length) return tradingRefuse('TTRD1006', '/fills', 'An unapproved decision cannot move money');
  for (const fill of plan.fills) if (!plan.intent || fill.intentId !== plan.intent.id || fill.decisionId !== plan.decision.id || fill.asset !== plan.key.asset
    || fill.side !== plan.intent.side || fill.sessionId !== target) return tradingRefuse('TTRD1006', '/fills', 'Fill does not belong to the approved intent');
  const ledger = validateTradingLedger(plan.fills, plan.ledgerEntries); if (!ledger.valid) return ledger;
  const accounted = accountTradingFills(manifest, previous, plan.fills, plan.portfolio.marks, target); if (!accounted.valid) return accounted;
  const { id: _id, revision: _revision, ...body } = plan.portfolio;
  if (!equalsJson(body, accounted.value)) return tradingRefuse('TTRD1006', '/portfolio', 'Portfolio does not equal the retained state plus committed fills');
  return { valid: true, value: true };
}

async function commitTradingDecision(persistence: TradingPersistence, input: TradingCommit, probe: (step: string) => void): Promise<TradingOutcome<TradingWriteReceipt>> {
  const shape = validateTradingShape<TradingCommit>('tradingCommit', input); if (!shape.valid) return shape;
  const plan = shape.value;
  const records: Array<{ table: keyof TradingTables; record: TradingRecord }> = [
    { table: 'decisions', record: plan.decision }, ...(plan.intent ? [{ table: 'orders' as const, record: plan.intent }] : []),
    ...plan.fills.map(record => ({ table: 'fills' as const, record })), ...plan.ledgerEntries.map(record => ({ table: 'ledger' as const, record })), { table: 'portfolios', record: plan.portfolio },
  ];
  for (const [i, row] of records.entries()) {
    const valid = await checked(row.record);
    if (!valid.valid) return { valid: false, issues: valid.issues.map(issue => ({ ...issue, path: `/records/${i}${issue.path}` })) };
  }
  const balanced = validateTradingLedger(plan.fills, plan.ledgerEntries); if (!balanced.valid) return balanced;
  const commitRevision = await tradingRevisionOf(plan);
  const marker = await createTradingRecord('decision-commit', { manifestId: plan.key.manifestId, key: plan.key, commitRevision, expectedPortfolioId: plan.expectedPortfolioId,
    decisionId: plan.decision.id, intentId: plan.intent?.id ?? null, fillIds: plan.fills.map(f => f.id), ledgerEntryIds: plan.ledgerEntries.map(e => e.id), portfolioId: plan.portfolio.id });
  if (!marker.valid) return marker;
  return persistence.transaction(async tx => {
    const existing = await tx.query('decisions', { key: plan.key, kind: 'decision-commit' });
    if (existing.length) {
      const prior = existing[0];
      if (existing.length !== 1 || prior.kind !== 'decision-commit' || !equalsJson(prior, marker.value)) return tradingRefuse('TTRD1006', '/key', 'Decision key is already committed with different bytes');
    }
    const manifest = await tx.get('manifests', plan.key.manifestId);
    const previous = existing.length ? await tx.get('portfolios', plan.expectedPortfolioId) : await retainedPortfolio(tx, plan.key.manifestId);
    if (!manifest || !previous) return tradingRefuse('TTRD1002', '/manifestId', 'Manifest and initial portfolio must be retained before a decision');
    for (const record of [manifest, previous]) { const valid = await checked(record); if (!valid.valid) return valid; }
    const session = (await tx.query('sessions', { manifestId: manifest.id })).find(s => s.key === plan.key.sessionId);
    if (!session) return tradingRefuse('TTRD1003', '/key/sessionId', 'Decision session is not retained');
    const sessionValid = await checked(session); if (!sessionValid.valid) return sessionValid;
    const target = session.next ?? session.key, sessions = await tx.query('sessions', { manifestId: manifest.id });
    const execution = sessions.find(s => s.key === target), priorSession = sessions.find(s => s.key === previous.asOfSessionId);
    if (!execution || previous.asOfSessionId !== null && (!priorSession || toEpoch(priorSession.openAt) > toEpoch(execution.openAt)))
      return tradingRefuse('TTRD1003', '/portfolio/asOfSessionId', 'Execution session is missing or precedes the retained portfolio');
    for (const record of [execution, ...(priorSession ? [priorSession] : [])]) { const valid = await checked(record); if (!valid.valid) return valid; }
    for (const id of plan.decision.artifactIds) {
      const artifact = await tx.get('artifacts', id);
      if (!artifact || artifact.manifestId !== manifest.id || artifact.key.asset !== plan.key.asset || artifact.key.sessionId !== plan.key.sessionId)
        return tradingRefuse('TTRD1004', '/decision/artifactIds', 'Decision artifact is not retained for this asset and session');
      const valid = await checked(artifact); if (!valid.valid) return valid;
    }
    const valid = planTradingCommit(plan, manifest, previous, session); if (!valid.valid) return valid;
    if (existing.length) {
      for (const row of records) if (!equalsJson(await tx.get(row.table, row.record.id), row.record)) return tradingRefuse('TTRD1006', '/key', 'Committed decision has missing or altered retained records');
      return { valid: true, value: { changed: false, id: marker.value.id, writes: 0 } };
    }
    for (const row of records) if (await tx.get(row.table, row.record.id)) return tradingRefuse('TTRD1006', '/id', 'Financial record is already assigned outside this commit');
    await tx.put('decisions', plan.decision); await tx.put('decisions', marker.value); probe('decision');
    if (plan.intent) await tx.put('orders', plan.intent); probe('intent');
    for (const fill of plan.fills) { await tx.put('fills', fill); probe('fill'); }
    for (const entry of plan.ledgerEntries) { await tx.put('ledger', entry); probe('ledger'); }
    await tx.put('portfolios', plan.portfolio); probe('portfolio'); probe('commit');
    return { valid: true, value: { changed: true, id: marker.value.id, writes: records.length + 1 } };
  });
}

export function createMemoryTradingStore(options: TradingStoreOptions = {}): TradingStore {
  let state = Object.fromEntries(TRADING_TABLES.map(table => [table, new Map<string, TradingRecord>()])) as Record<keyof TradingTables, Map<string, TradingRecord>>;
  let pending: Promise<unknown> = Promise.resolve();
  const persistence: TradingPersistence = { transaction<T>(task: (view: TradingTransaction) => Promise<T>): Promise<T> {
    const result = pending.then(async () => {
      const staged = Object.fromEntries(TRADING_TABLES.map(table => [table, new Map([...state[table]].map(([id, value]) => [id, cloneJson(value)]))])) as typeof state;
      const view: TradingTransaction = {
        async get(table, id) { return cloneJson(staged[table].get(id)) as never; },
        async put(table, record) { staged[table].set(record.id, cloneJson(record)); },
        async delete(table, id) { staged[table].delete(id); },
        async query(table, query) { return cloneJson([...staged[table].values()].filter(r => tradingMatches(r, query)).sort(orderRecords)) as never; },
      };
      const value = await task(view); state = staged; return value;
    });
    pending = result.then(() => undefined, () => undefined); return result;
  } };
  return createTradingStoreAdapter(persistence, options);
}
