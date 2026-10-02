/** Content-addressed records and one transaction owner for simulated financial writes. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { toEpoch } from '@jarenjs/core/series';
import { tradingRevisionOf } from './identity.ts';
import { createTradingRecord, validateTradingRecord } from './records.ts';
import { validateTradingShape } from './schema.ts';
import { accountTradingMovements, validateInitialTradingPortfolio, validateTradingPostings, tradingActionKey } from './accounting.ts';
import { tradingFillEconomics } from './broker.ts';
import { checkRiskPolicy } from './risk.ts';
import { tradingRefuse } from './errors.ts';
import { toOrderIntent } from './order.ts';
import { snapshotBarStaleness } from './time.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingRunManifest, MarketSession, Observation, MarketSnapshot, Artifact, TradingDecision, OrderIntent, Fill,
  LedgerEntry, PortfolioSnapshot, TradingDayResult, BacktestResult, TradingDecisionResult, TradingCommit, TradingCommitMarker, TradingDecisionKey, TradingRecord, BarObservation, CorporateActionObservation } from './contracts.gen.ts';

export interface TradingTables {
  manifests: TradingRunManifest; sessions: MarketSession; observations: Observation; snapshots: MarketSnapshot; artifacts: Artifact;
  decisions: TradingDecision | TradingCommitMarker; orders: OrderIntent; fills: Fill; ledger: LedgerEntry; portfolios: PortfolioSnapshot;
  results: TradingDayResult | BacktestResult | TradingDecisionResult;
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
  decision: 'decisions', 'decision-commit': 'decisions', order: 'orders', fill: 'fills', ledger: 'ledger', portfolio: 'portfolios', 'day-result': 'results', 'backtest-result': 'results', 'decision-result': 'results',
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
  if (record.kind === 'decision-result') {
    const snapshot = record.snapshotId ? await tx.get('snapshots', record.snapshotId) : undefined;
    const portfolio = await tx.get('portfolios', record.portfolioId), sessions = await tx.query('sessions', { manifestId: manifest.id });
    if (record.key.manifestId !== manifest.id || !manifest.assets.includes(record.key.asset) || record.key.stage !== 'model-decision'
      || !sessions.some(s => s.key === record.key.sessionId)
      || !portfolio || portfolio.manifestId !== manifest.id || record.snapshotId && (!snapshot || snapshot.manifestId !== manifest.id || snapshot.portfolioId !== record.portfolioId
        || snapshot.asset !== record.key.asset || snapshot.sessionId !== record.key.sessionId))
      return tradingRefuse('TTRD1004', '/decision-result', 'Decision receipt must bind its retained portfolio, snapshot and session');
    const artifacts: Artifact[] = [];
    for (const id of record.artifactIds) {
      const artifact = await tx.get('artifacts', id);
      if (!artifact || artifact.manifestId !== manifest.id || artifact.snapshotId !== record.snapshotId)
        return tradingRefuse('TTRD1004', '/artifactIds', 'Decision receipt references an unretained or foreign artifact');
      artifacts.push(artifact);
    }
    if (record.status === 'completed') {
      const proposal = artifacts.find(a => a.kind === 'trade-proposal'), riskVerdict = artifacts.find(a => a.kind === 'risk-verdict'), decision = artifacts.find(a => a.kind === 'fund-manager-decision');
      if (!snapshot || !proposal || !riskVerdict || !decision) return tradingRefuse('TTRD1004', '/artifactIds', 'Completed receipts require their retained proposal, risk verdict and manager');
      const observations: Observation[] = [], valuationObservations: Observation[] = [];
      for (const [ids, rows] of [[snapshot.observationIds, observations], [record.valuationObservationIds, valuationObservations]] as const) for (const id of ids) {
        const observation = await tx.get('observations', id);
        if (!observation || observation.manifestId !== manifest.id) return tradingRefuse('TTRD1004', '/valuationObservationIds', 'Decision price evidence must be retained in this manifest');
        rows.push(observation);
      }
      const admitted = await toOrderIntent({ manifest, snapshot: { snapshot, observations, sessions }, portfolio, valuationObservations, proposal, riskVerdict, decision });
      if (!admitted.valid || !equalsJson(admitted.value, record.admission))
        return tradingRefuse('TTRD1005', '/admission', 'Decision receipt must preserve its deterministic admission and complete artifact chain');
    }
    const previous = await tx.query('results', { kind: 'decision-result', key: record.key });
    if (previous.some(r => !equalsJson(r, record))) return tradingRefuse('TTRD1006', '/key', 'An immutable model decision already occupies this session key');
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
    const refused = new Set(record.refused.map(r => r.id)), observations: Observation[] = [];
    for (const id of record.observationIds) {
      const observation = await tx.get('observations', id);
      if (!observation || observation.manifestId !== manifest.id || observation.asset !== record.asset || refused.has(id))
        return tradingRefuse('TTRD1004', '/observationIds', 'Snapshot evidence must be retained, admitted and scoped to this asset');
      if (toEpoch(observation.availableAt) > toEpoch(record.cutoffAt)) return tradingRefuse('TTRD1003', '/observationIds', 'Snapshot evidence was published after its cutoff');
      observations.push(observation);
    }
    const staleness = snapshotBarStaleness(sessions, record.sessionId, observations); if (!staleness.valid) return staleness;
    if (record.staleness !== staleness.value) return tradingRefuse('TTRD1003', '/staleness', 'Snapshot bar staleness differs from its retained observations and calendar');
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
        const snapshotValid = await checked(snapshot); if (!snapshotValid.valid) return snapshotValid;
        if (valid.value.claims.some(c => c.citations.some(id => !valid.value.citations.includes(id))))
          return tradingRefuse('TTRD1004', '/claims', 'A claim cites information absent from its artifact');
        const predecessors = [
          ...('previousTurnIds' in valid.value ? valid.value.previousTurnIds : []),
          ...('historyIds' in valid.value ? valid.value.historyIds : []),
          ...('researchVerdictId' in valid.value ? [valid.value.researchVerdictId] : []),
          ...('proposalId' in valid.value ? [valid.value.proposalId] : []),
          ...('riskVerdictId' in valid.value ? [valid.value.riskVerdictId] : []),
        ];
        for (const id of new Set([...valid.value.citations, ...predecessors])) {
          if (!predecessors.includes(id) && snapshot.observationIds.includes(id)) continue;
          const prior = await tx.get('artifacts', id);
          if (!prior || prior.id === valid.value.id || prior.snapshotId !== snapshot.id || prior.manifestId !== key.manifestId
            || prior.key.asset !== key.asset || prior.key.sessionId !== key.sessionId)
            return tradingRefuse('TTRD1004', '/citations', 'Artifact predecessor is not retained in the same snapshot');
          const priorValid = await checked(prior); if (!priorValid.valid) return priorValid;
        }
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

export interface TradingCommitEvidence { execution: MarketSession; bars: readonly BarObservation[]; actions: readonly CorporateActionObservation[]; }
export function planTradingCommit(plan: TradingCommit, manifest: TradingRunManifest, previous: PortfolioSnapshot, session: MarketSession,
  evidence: TradingCommitEvidence): TradingOutcome<true> {
  if (!equalsJson(plan.key, plan.decision.key) || plan.key.manifestId !== manifest.id || plan.decision.manifestId !== manifest.id
    || !manifest.assets.includes(plan.key.asset) || session.manifestId !== manifest.id || session.key !== plan.key.sessionId)
    return tradingRefuse('TTRD1006', '/key', 'Decision scope does not match the retained manifest and session');
  if (manifest.mode === 'shadow') return tradingRefuse('TTRD1009', '/mode', 'Shadow execution is not enabled');
  if (plan.expectedPortfolioId !== previous.id || plan.portfolio.parentId !== previous.id)
    return tradingRefuse('TTRD1006', '/expectedPortfolioId', 'Portfolio advanced before this decision committed');
  const stage = plan.mode === 'trade' || plan.mode === 'terminal' ? 'broker' : plan.mode === 'settlement' ? 'corporate-action' : 'valuation';
  if (plan.key.stage !== stage) return tradingRefuse('TTRD1006', '/key/stage', 'Commit mode has a different reserved execution stage');
  const target = plan.mode === 'trade' ? session.next ?? session.key : session.key;
  if (plan.portfolio.asOfSessionId !== target || evidence.execution.key !== target || evidence.execution.manifestId !== manifest.id
    || plan.mode === 'trade' && session.next !== null && evidence.execution.prev !== session.key)
    return tradingRefuse('TTRD1006', '/portfolio/asOfSessionId', 'The portfolio must mark the declared execution session');
  if (plan.intent && (plan.intent.manifestId !== manifest.id || plan.intent.decisionId !== plan.decision.id || plan.intent.asset !== plan.key.asset
    || plan.intent.decisionSessionId !== session.key || plan.intent.fillSessionId !== session.next)) return tradingRefuse('TTRD1006', '/intent', 'Intent does not follow the decision session');
  if (plan.mode === 'terminal') {
    if (session.next !== null || session.key !== manifest.sessionRange.last || previous.asOfSessionId !== session.key || manifest.executionPolicy?.kind !== 'agent'
      || plan.intent || plan.fills.length || plan.ledgerEntries.length || plan.markBarIds.length || plan.actionIds.length || plan.decision.disposition === 'approved')
      return tradingRefuse('TTRD1006', '/mode', 'Terminal decisions follow the final close and cannot execute or move money');
  } else if (plan.mode !== 'trade') {
    if (plan.intent || plan.fills.length || plan.decision.disposition !== 'hold' || plan.decision.artifactIds.length)
      return tradingRefuse('TTRD1006', '/mode', 'Corporate settlement and valuation cannot carry role approval or orders');
    if (plan.mode === 'valuation' && (plan.key.asset !== manifest.assets[0] || plan.actionIds.length))
      return tradingRefuse('TTRD1006', '/mode', 'A valuation is one run-wide close mark without corporate actions');
    if (plan.mode === 'settlement' && (!plan.actionIds.length || plan.markBarIds.length))
      return tradingRefuse('TTRD1006', '/actionIds', 'Corporate settlement requires actions and preserves their adjusted prior marks');
  } else {
    if (plan.actionIds.length) return tradingRefuse('TTRD1006', '/actionIds', 'A role decision cannot settle corporate entitlements');
    if (plan.decision.disposition === 'approved') {
      if (!plan.intent || plan.fills.length !== 1 || plan.fills[0].quantity !== plan.intent.quantity) return tradingRefuse('TTRD1006', '/fills', 'An approved market intent must have exactly one complete fill');
      if (plan.intent.orderKind !== 'market' || plan.intent.limitPrice !== null || plan.intent.stopPrice !== null) return tradingRefuse('TTRD1005', '/intent/orderKind', 'Only next-open market execution is supported');
    } else if (plan.fills.length || plan.ledgerEntries.length || plan.markBarIds.length) return tradingRefuse('TTRD1006', '/fills', 'An unapproved decision cannot move money or introduce marks');
  }
  if (!equalsJson(evidence.actions.map(a => a.id), plan.actionIds)) return tradingRefuse('TTRD1006', '/actionIds', 'Settlement evidence differs from its bound identities');
  for (const action of evidence.actions) if (action.manifestId !== manifest.id || action.asset !== plan.key.asset || action.sessionId !== target
    || toEpoch(action.eventAt) !== toEpoch(evidence.execution.openAt) || toEpoch(action.availableAt) > toEpoch(evidence.execution.openAt))
    return tradingRefuse('TTRD1003', '/actionIds', 'Corporate action must be available by its retained ex-session open');
  const markBars = plan.markBarIds.map(id => evidence.bars.find(b => b.id === id));
  if (markBars.some(b => !b || b.manifestId !== manifest.id || b.sessionId !== target || !manifest.assets.includes(b.asset)
    || toEpoch(b.eventAt) !== toEpoch(evidence.execution.closeAt)) || new Set(markBars.map(b => b?.asset)).size !== markBars.length)
    return tradingRefuse('TTRD1003', '/markBarIds', 'Marks require one retained execution bar per selected asset');
  for (const fill of plan.fills) {
    if (!plan.intent || fill.intentId !== plan.intent.id || fill.decisionId !== plan.decision.id || fill.asset !== plan.key.asset
      || fill.side !== plan.intent.side || fill.sessionId !== target) return tradingRefuse('TTRD1006', '/fills', 'Fill does not belong to the approved intent');
    const bar = evidence.bars.find(b => b.id === fill.sourceBarId);
    if (!bar || bar.asset !== fill.asset || !equalsJson(plan.markBarIds, [bar.id])) return tradingRefuse('TTRD1003', '/fills/sourceBarId', 'Fill must bind its retained next-open bar and mark');
    const quote = tradingFillEconomics(manifest, bar.open, fill.side, fill.quantity);
    for (const field of ['price', 'notional', 'commission', 'slippage'] as const) if (quote[field] !== fill[field])
      return tradingRefuse('TTRD1006', `/fills/${field}`, 'Execution economics differ from the retained bar and immutable manifest');
  }
  const marks = plan.mode === 'settlement' ? undefined : previous.marks.map(m => {
    const bar = markBars.find(b => b?.asset === m.asset); return { asset: m.asset, price: bar ? plan.mode === 'trade' ? bar.open : bar.close : m.price };
  });
  const accounted = accountTradingMovements(manifest, previous, plan.fills, marks, target, evidence.actions); if (!accounted.valid) return accounted;
  const ledger = validateTradingPostings(accounted.value.postings, plan.ledgerEntries); if (!ledger.valid) return ledger;
  const { id: _id, revision: _revision, ...body } = plan.portfolio;
  if (!equalsJson(body, accounted.value.portfolio)) return tradingRefuse('TTRD1006', '/portfolio', 'Portfolio does not equal the retained state and bound financial movements');
  if (plan.fills.length && plan.intent) {
    const issues = checkRiskPolicy({ manifest, portfolioAfter: plan.portfolio, intent: plan.intent, sessionBar: evidence.bars.find(b => b.id === plan.fills[0].sourceBarId)! });
    if (issues.length) return { valid: false, issues };
  }
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
  if (new Set(plan.fills.map(f => f.id)).size !== plan.fills.length || new Set(plan.ledgerEntries.map(e => e.id)).size !== plan.ledgerEntries.length)
    return tradingRefuse('TTRD1006', '/ledgerEntries', 'A posting or fill identity is repeated');
  const commitRevision = await tradingRevisionOf(plan);
  const marker = await createTradingRecord('decision-commit', { manifestId: plan.key.manifestId, key: plan.key, commitRevision, expectedPortfolioId: plan.expectedPortfolioId,
    mode: plan.mode, markBarIds: plan.markBarIds, actionIds: plan.actionIds, portfolioSequence: plan.portfolio.sequence, decisionId: plan.decision.id, intentId: plan.intent?.id ?? null, fillIds: plan.fills.map(f => f.id), ledgerEntryIds: plan.ledgerEntries.map(e => e.id), portfolioId: plan.portfolio.id });
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
    const target = plan.mode === 'trade' ? session.next ?? session.key : session.key, sessions = await tx.query('sessions', { manifestId: manifest.id });
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
    if (previous.asOfSessionId !== null && previous.asOfSessionId !== execution.key && previous.asOfSessionId !== execution.prev
      || previous.asOfSessionId === null && execution.key !== manifest.sessionRange.first && !(plan.mode === 'trade' && session.key === manifest.sessionRange.first))
      return tradingRefuse('TTRD1003', '/portfolio/asOfSessionId', 'Execution cannot skip an unvalued session');
    const markers = (await tx.query('decisions', { manifestId: manifest.id, kind: 'decision-commit' })) as TradingCommitMarker[];
    const preceding = markers.filter(m => m.portfolioSequence <= previous.sequence);
    const closed = preceding.some(m => m.mode === 'valuation' && m.key.sessionId === target);
    if (plan.mode === 'terminal' ? !closed : closed)
      return tradingRefuse('TTRD1006', '/key/sessionId', 'A closed session cannot accept another execution');
    if (plan.mode === 'settlement' && preceding.some(m => m.mode === 'trade' && m.key.asset === plan.key.asset && sessions.find(s => s.key === m.key.sessionId)?.next === target))
      return tradingRefuse('TTRD1006', '/actionIds', 'Opening entitlements must precede same-asset execution');
    const observations = await tx.query('observations', { manifestId: manifest.id });
    const applied = new Set(preceding.flatMap(m => m.actionIds));
    if (plan.actionIds.some(id => applied.has(id))) return tradingRefuse('TTRD1006', '/actionIds', 'Corporate action has already settled');
    const appliedKeys = new Set<string>();
    for (const id of applied) {
      const action = observations.find(o => o.id === id);
      if (!action || action.kind !== 'corporate-action') return tradingRefuse('TTRD1004', '/actionIds', 'Prior settlement evidence is missing');
      appliedKeys.add(tradingActionKey(action));
    }
    for (const id of plan.actionIds) {
      const action = observations.find(o => o.id === id);
      if (action?.kind === 'corporate-action' && appliedKeys.has(tradingActionKey(action)))
        return tradingRefuse('TTRD1006', '/actionIds', 'A different revision cannot settle an economic action twice');
    }
    const due = observations.filter((o): o is CorporateActionObservation => o.kind === 'corporate-action' && o.sessionId === target
      && toEpoch(o.availableAt) <= toEpoch(execution.openAt) && (plan.mode === 'valuation' || o.asset === plan.key.asset));
    const outstanding = due.filter(a => !applied.has(a.id));
    if (plan.mode === 'settlement' ? !equalsJson([...plan.actionIds].sort(), outstanding.map(a => a.id).sort()) : outstanding.length > 0)
      return tradingRefuse('TTRD1006', '/actionIds', 'Every available opening entitlement must settle before its fill and the close');
    const bars: BarObservation[] = [], actions: CorporateActionObservation[] = [];
    for (const id of [...new Set([...plan.markBarIds, ...plan.fills.map(f => f.sourceBarId), ...plan.actionIds])]) {
      const record = observations.find(o => o.id === id);
      if (!record || record.kind !== (plan.actionIds.includes(id) ? 'corporate-action' : 'bar'))
        return tradingRefuse('TTRD1004', '/evidence', 'Execution evidence is not retained with its required kind');
      const valid = await checked(record); if (!valid.valid) return valid;
      if (record.kind === 'bar') bars.push(record); else if (record.kind === 'corporate-action') actions.push(record);
    }
    const valid = planTradingCommit(plan, manifest, previous, session, { execution, bars, actions }); if (!valid.valid) return valid;
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
      const staged = Object.fromEntries(TRADING_TABLES.map(table => [table, new Map(state[table])])) as typeof state;
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
