/** Keyless end-to-end host over the public decision runner and native store queue. */
import { createMasRegistrySnapshot, createMasConfigCatalog, type MasStore, type MasChatClient, type MasRuntimeObserver, type WorkflowLimits } from '@tangleai/mas';
import { createMasStore, createMasSegmentDriver, type TangleDb } from '@tangleai/store';
import { createDecisionRunner, tradingDecisionRunId, buildTradingDecisionWorkflow, createTradingDecisionHostBindings,
  materializeResearch, materializeTradingRisk, TRADING_READ_TOOLS } from '@tangleai/trading';
import type { TradingBacktestDecisionInput, TradingRunManifest, TradingSpend, TradingDecisionSegments } from '@tangleai/trading';
import type { GmplCatalog } from '@tangleai/gmpl';
import { checked, attemptProvenance } from './trading-research-runner.ts';
import { tradingDecisionScript } from './trading-scripts.ts';

export async function materializeScriptedTradingDecision(manifest: TradingRunManifest, catalog: GmplCatalog) {
  const registry = checked(await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'trading-agent-fixture', roles: [], handlers: [], tools: [], messageAdapters: [], contextAdapters: [], templates: [], subgraphs: [] }));
  const config = checked(await createMasConfigCatalog({ profiles: ['scripted'], tools: [...TRADING_READ_TOOLS], contexts: [], limits: manifest.limits }));
  const host = { registry, config, profile: 'scripted' };
  const researchMaterialized = checked(await materializeResearch({ host, catalog, manifest })), riskMaterialized = checked(await materializeTradingRisk({ host, catalog, manifest }));
  return checked(await buildTradingDecisionWorkflow({ manifest, catalog, researchMaterialized, riskMaterialized, profile: 'scripted' }));
}
export interface ScriptedTradingAgentOptions {
  store?: MasStore; limits?: Partial<WorkflowLimits>; signal?: AbortSignal; invalidRole?: string; fullRounds?: boolean;
  census?: { physical: number; completion: number; normalization: number; repair: number; restores: number; replays: number };
  observer?: (runId: string) => MasRuntimeObserver;
  segments?: TradingDecisionSegments;
}
export function createScriptedTradingAgent(db: TangleDb, catalog: GmplCatalog, options: ScriptedTradingAgentOptions = {}) {
  const now = () => 'scripted-tick', store = options.store ?? createMasStore(db, { now });
  const prepared = new Map<string, ReturnType<typeof materializeScriptedTradingDecision>>(), contexts = new Map<string, TradingBacktestDecisionInput>();
  const census = options.census ?? { physical: 0, completion: 0, normalization: 0, repair: 0, restores: 0, replays: 0 };
  const events: Array<{ runId: string; path: string; event: string }> = [], response = tradingDecisionScript({ fullRounds: options.fullRounds });
  const phases = new Map<string, { invocation: number; phase: 'completion' | 'normalization' | 'repair' }>();
  const signal = options.signal ?? new AbortController().signal;
  const decide = async (context: TradingBacktestDecisionInput) => {
    if (!prepared.has(context.manifest.id)) prepared.set(context.manifest.id, materializeScriptedTradingDecision(context.manifest, catalog));
    const materialized = await prepared.get(context.manifest.id)!;
    const snapshot = context.snapshot.snapshot;
    const request = { manifestId: context.manifest.id, asset: snapshot.asset, sessionId: snapshot.sessionId, snapshotId: snapshot.id, portfolioId: context.portfolio.id };
    const runId = await tradingDecisionRunId(request, materialized.workflow.versionId); contexts.set(runId, context);
    const runner = createDecisionRunner({ materialized, masStore: store, segments: options.segments ?? createMasSegmentDriver(db, store, { owner: 'trading-script', leaseMs: 700000 }), limits: options.limits,
      signalFor: () => signal, spendFor: trace => ({ valid: true, value: {
        calls: trace.attempts.reduce((n, a) => n + a.usage.calls, 0), toolCalls: trace.attempts.reduce((n, a) => n + a.usage.toolCalls, 0),
        tokens: trace.attempts.reduce((n, a) => n + a.usage.promptTokens + a.usage.completionTokens + (a.usage.estimatedTokens ?? 0), 0),
        usd: 0, retries: 0, repairs: trace.attempts.filter(a => a.kind === 'agent' && a.usage.calls === 3).length, ms: trace.run.budget.spent.ms } satisfies TradingSpend }),
      hostFor: async (input, activeRunId) => {
        const bound = contexts.get(activeRunId); if (!bound) throw Error('The scripted host has no context for this queued decision');
        const bindings = checked(await createTradingDecisionHostBindings({ ...bound, materialized, catalog,
          trace: async () => { const trace = await store.readTrace(activeRunId); if (!trace) throw Error('Missing native decision trace'); return trace; }, provenance: attemptProvenance }));
        if (bindings.request.snapshotId !== input.snapshotId) throw Error('The scripted host request differs from its snapshot');
        const clientFor = (node: { id: string }): MasChatClient => ({ endpoint: { provider: 'scripted' }, complete: async raw => {
          const messages = (raw as { messages: Array<{ role: string; content: unknown }> }).messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));
          const key = `${activeRunId}/${node.id}`, state = phases.get(key) ?? { invocation: 0, phase: 'completion' as const }, fresh = !messages.some(m => m.role === 'assistant');
          if (fresh) { state.invocation++; state.phase = 'completion'; }
          const phase = fresh || messages.at(-1)?.role === 'tool' ? 'completion' : state.phase;
          census.physical++; census[phase]++;
          const result = options.invalidRole === node.id ? 'invalid scripted output' : await response(node.id, state.invocation, phase, messages);
          state.phase = phase === 'completion' ? 'normalization' : 'repair'; phases.set(key, state);
          return { message: { role: 'assistant', content: typeof result === 'string' ? result : JSON.stringify(result) }, finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } };
        } });
        const observer = options.observer?.(activeRunId);
        return { valid: true, value: { ...bindings, clientFor, now, clock: () => 1000000, contextProviders: {}, observer: {
          onNodeEnter: path => { events.push({ runId: activeRunId, path, event: 'enter' }); observer?.onNodeEnter?.(path); },
          onNodeSettle: (path, status) => { events.push({ runId: activeRunId, path, event: status }); observer?.onNodeSettle?.(path, status); },
          onRegionRestored: paths => { census.restores += paths.length; observer?.onRegionRestored?.(paths); },
          onNodeRestored: path => { census.restores++; observer?.onNodeRestored?.(path); }, onNodeReplay: path => { census.replays++; observer?.onNodeReplay?.(path); },
        } } };
      } });
    return runner.run(request, signal);
  };
  return { decide, store, census, events };
}
