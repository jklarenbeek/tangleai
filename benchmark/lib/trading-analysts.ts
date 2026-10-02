/** Every registered asset/session executes the public analyst region through the durable MAS host. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { cloneJson } from '@jarenjs/core/object';
import { createGmplCatalog } from '@tangleai/gmpl';
import { createTradingRecord, createFixtureProviders, buildSnapshot, tradingArtifacts, TRADING_ANALYST_ROLES } from '@tangleai/trading';
import type { TradingRecord, TradingOutcome, TradingAnalystRole, AnalystReport, TradingSpend, MarketSession, Observation, TradingRunManifest, PortfolioSnapshot, TradingSnapshotBundle } from '@tangleai/trading';
import type { TradingFixture } from './trading.ts';
import type { AnalystMeasurement } from './trading.types.ts';
import { tradingExecutionInput } from './trading-execution.ts';
import { prepareTradingAnalystDrive } from './trading-analyst-runner.ts';

const value = <T>(outcome: TradingOutcome<T>): T => { if (!outcome.valid) throw Error(JSON.stringify(outcome.issues)); return outcome.value; };
export interface TradingAnalystExecution {
  measurement: AnalystMeasurement; manifest: TradingRunManifest; portfolio: PortfolioSnapshot; sessions: MarketSession[]; observations: Observation[];
  cases: Array<{ snapshot: TradingSnapshotBundle; reports: AnalystReport[] }>;
}
async function executeAnalysts(fixture: TradingFixture): Promise<TradingAnalystExecution> {
  const source = await tradingExecutionInput(fixture, 'analysts-scripted'), compiled = await createGmplCatalog(tradingArtifacts);
  if (!compiled.valid) throw Error(JSON.stringify(compiled.issues));
  const catalog = compiled.value, { id: _id, revision: _revision, kind: _kind, ...body } = source.manifest;
  const manifest = value(await createTradingRecord('manifest', { ...body, promptCatalogRevision: catalog.document.revision,
    rolesByProfile: { ...Object.fromEntries(TRADING_ANALYST_ROLES.map(r => [`trading-analyst-${r}`, 'scripted'])), research: 'scripted', trader: 'scripted' },
    limits: { calls: 128, tokens: 262144, ms: 600000, toolRounds: 4, fanOut: 8, concurrency: 4, iterations: 10, contextChars: 65536, traceBytes: 2097152 } }));
  const rebind = async <T extends TradingRecord>(record: T): Promise<T> => {
    const { id: _id, revision: _revision, kind, ...data } = record;
    return value(await createTradingRecord(kind, { ...data, manifestId: manifest.id } as never)) as T;
  };
  const sessions: MarketSession[] = await Promise.all(source.sessions.map(rebind));
  const observations: Observation[] = await Promise.all([...source.bars, ...source.actions, ...source.observations].map(rebind));
  const portfolio = value(await createTradingRecord('portfolio', { manifestId: manifest.id, parentId: null, sequence: 0, cash: manifest.initialCapital,
    positions: manifest.assets.map(asset => ({ asset, quantity: 0, costBasis: 0, cashFlow: 0, realizedPnl: 0 })), marks: manifest.assets.map(asset => ({ asset, price: source.bars.find(b => b.asset === asset)!.open })),
    equity: manifest.initialCapital, grossExposure: 0, netExposure: 0, concentration: manifest.assets.map(asset => ({ asset, fraction: 0 })), realizedPnl: 0, unrealizedPnl: 0, asOfSessionId: null }));
  const captured = value(await createFixtureProviders({ manifestId: manifest.id, sessions, observations, eventAt: '2024-12-31T00:00:00Z', availableAt: '2024-12-31T12:00:00Z' }));
  const row: AnalystMeasurement = { id: 'analysts-scripted', status: 'measured', reason: null, total: 0, reproduced: 0, reports: 0, citations: 0, resolved: 0,
    manifestId: manifest.id, catalogRevision: catalog.document.revision, limits: manifest.limits,
    physicalCalls: 0, normalizations: 0, repairs: 0, toolRequests: 0, refusedToolRequests: 0, cases: [], probes: [] };
  const cases: TradingAnalystExecution['cases'] = [];
  for (const session of sessions) for (const asset of manifest.assets) {
    const snapshot = value(await buildSnapshot({ manifest, asset, session, portfolio, providers: captured.providers }));
    const drive = await prepareTradingAnalystDrive({ catalog, manifest, snapshot, portfolio, providers: captured.providers });
    const entered = new Set<string>(), requested = new Set<string>();
    let release!: () => void; const concurrent = new Promise<void>(resolve => { release = resolve; });
    const run = await drive.run({ beforeCall: async (node, _iteration, phase) => {
      if (phase !== 'completion' || entered.has(node)) return;
      entered.add(node); if (entered.size === 4) release(); await concurrent;
    }, complete: async (node, _iteration, phase) => {
      const role = node.replace('analyst-', '') as TradingAnalystRole;
      if (role === 'news' && !requested.has(node)) {
        requested.add(node);
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: 'future-read', name: 'news-items', arguments: JSON.stringify({ cutoffAt: '2026-01-01T00:00:00Z' }) }] }, finishReason: 'tool_calls', usage: { prompt_tokens: 7, completion_tokens: 3 } };
      }
      return { message: { role: 'assistant', content: JSON.stringify(role === 'news' && phase === 'normalization' ? {} : drive.report(role)) }, finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } };
    } });
    if (run.status !== 'completed') throw Error(`Registered analysts failed at ${asset}/${session.key}: ` + JSON.stringify(run.trace.attempts.filter(a => a.status !== 'completed')));
    const reports = run.output as Record<TradingAnalystRole, AnalystReport>, firstSettle = run.events.findIndex(e => /^analyst-[^/]+:completed$/.test(e));
    const starts = TRADING_ANALYST_ROLES.map(role => run.events.indexOf(`analyst-${role}:enter`));
    let citations = 0, resolved = 0;
    for (const role of TRADING_ANALYST_ROLES) {
      const report = reports[role]; if (!report?.analysis) throw Error('Analyst report output is absent');
      for (const finding of report.analysis.findings) for (const citation of finding.citations) {
        citations++; if (drive.host.context.projections[role].evidence.some(e => e.id === citation.id && e.digest === citation.digest)) resolved++;
      }
    }
    const sums = (key: keyof TradingSpend) => Object.values(reports).reduce((sum, report) => sum + report.spend[key], 0);
    if (sums('calls') !== run.usage.physical || sums('tokens') !== run.usage.promptTokens + run.usage.completionTokens || sums('toolCalls') !== run.usage.tools || sums('repairs') !== run.usage.repair)
      throw Error('Analyst artifact usage differs from the observed durable host');
    const measured = { asset, sessionId: session.key, reports: Object.keys(reports).length, citations, resolved, physicalCalls: run.usage.physical,
      normalizations: run.usage.normalization, repairs: run.usage.repair, toolRequests: run.usage.tools, refusedToolRequests: drive.host.audit.refusals.filter(i => i.code === 'TTRD1003').length,
      concurrent: firstSettle >= 0 && starts.every(i => i >= 0 && i < firstSettle), outputSha256: await canonicalSha256(reports), reproduced: false };
    measured.reproduced = measured.reports === 4 && citations === resolved && measured.concurrent && measured.physicalCalls === 10 && measured.normalizations === 4
      && measured.repairs === 1 && measured.toolRequests === 1 && measured.refusedToolRequests === 1;
    row.cases.push(measured);
    cases.push({ snapshot, reports: TRADING_ANALYST_ROLES.map(role => reports[role]) });
    for (const key of ['reports', 'citations', 'resolved', 'physicalCalls', 'normalizations', 'repairs', 'toolRequests', 'refusedToolRequests'] as const) row[key] += measured[key];
    if (session === sessions.at(-1) && asset === manifest.assets[0]) {
      for (const id of ['invented-citation', 'invalid-after-repair', 'shared-budget', 'context-budget'] as const) {
        const result = await drive.run({ ...(id === 'shared-budget' ? { runLimits: { calls: 3 } } : id === 'context-budget' ? { runLimits: { contextChars: 64 } } : {}), response: (node, _invocation, _phase) => {
          const report = drive.report(node.replace('analyst-', '') as TradingAnalystRole);
          if (node === 'analyst-news' && id === 'invalid-after-repair') return {};
          if (node === 'analyst-news' && id === 'invented-citation') report.findings[0].citations[0].id = 'invented-evidence';
          return report;
        } });
        const expected = id === 'invented-citation' ? 'TTRD1004' : id === 'shared-budget' || id === 'context-budget' ? 'TMAS2009' : 'permanently invalid after one repair';
        const passed = result.status === 'failed' && JSON.stringify(result.trace).includes(expected)
          && (id !== 'shared-budget' || result.usage.physical === 3 && result.usage.roles < 4)
          && (id !== 'invalid-after-repair' || result.visibility.filter(v => v.node === 'analyst-news' && v.phase === 'repair').length === 1);
        row.probes.push({ id, passed, physicalCalls: result.usage.physical, repairs: result.usage.repair, refusals: result.trace.attempts.filter(a => a.status === 'failed').length });
      }
    }
  }
  row.total = row.cases.length; row.reproduced = row.cases.filter(c => c.reproduced).length;
  if (row.total !== sessions.length * manifest.assets.length || row.reproduced !== row.total || row.probes.some(p => !p.passed)) throw Error('Analyst mechanism acceptance failed');
  return { measurement: row, manifest, portfolio, sessions, observations, cases };
}
let cached: { identity: string; result: Promise<TradingAnalystExecution> } | undefined;
async function cachedAnalystExecution(fixture: TradingFixture): Promise<TradingAnalystExecution> {
  const identity = await canonicalSha256(fixture);
  if (cached?.identity !== identity) cached = { identity, result: executeAnalysts(cloneJson(fixture)) };
  return cached.result;
}
export async function measureTradingAnalysts(fixture: TradingFixture): Promise<AnalystMeasurement> {
  return cloneJson((await cachedAnalystExecution(fixture)).measurement);
}
export async function tradingAnalystExecution(fixture: TradingFixture): Promise<TradingAnalystExecution> {
  return cloneJson(await cachedAnalystExecution(fixture));
}
