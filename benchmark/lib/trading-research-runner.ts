/** Keyless composition over public trading content and the existing durable MAS host. */
import { createMasRegistrySnapshot, createMasConfigCatalog, defineMasWorkflow, validateMasWorkflow, planMasWorkflow, type MasStore } from '@tangleai/mas';
import { materializeResearch, buildResearchAndTraderRegion, createTradingResearchHostBindings } from '@tangleai/trading';
import type { AnalystReport, TradingAttemptProvenance, TradingHostInput } from '@tangleai/trading';
import type { GmplFinding, GmplPatternResult, GmplEvidenceUnit } from '@tangleai/gmpl';
import { scriptedModel } from './trading-analyst-runner.ts';
import { driveGmplWorkflow, type ScriptedDriveOptions } from './gmpl-runner.ts';
export function checked<T>(outcome: { valid: true; value: T } | { valid: false; issues: unknown }): T {
  if (!outcome.valid) throw Error(JSON.stringify(outcome.issues)); return outcome.value;
}
export const attemptProvenance: TradingAttemptProvenance = attempt => ({ valid: true, value: { model: scriptedModel,
  spend: { calls: attempt.usage.calls, toolCalls: attempt.usage.toolCalls, tokens: attempt.usage.promptTokens + attempt.usage.completionTokens + (attempt.usage.estimatedTokens ?? 0),
    usd: 0, retries: 0, repairs: 0, ms: attempt.spend.ms } } });

export function promptJson(messages: Array<{ role: string; content: string }>, field: string, next?: string): unknown {
  const content = messages.find(m => m.role === 'user')!.content, start = content.indexOf(`${field}:\n`) + field.length + 2;
  const end = next ? content.indexOf(`\n${next}:\n`, start) : -1;
  return JSON.parse(content.slice(start, end === -1 ? undefined : end).trim());
}
export async function prepareTradingResearchDrive(input: Pick<TradingHostInput, 'manifest' | 'catalog' | 'snapshot' | 'portfolio'> & { reports: AnalystReport[] }) {
  const { reports } = input;
  const registry = checked(await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'trading-research-fixture', roles: [], handlers: [], tools: [],
    messageAdapters: [], contextAdapters: [], templates: [], subgraphs: [] }));
  const config = checked(await createMasConfigCatalog({ profiles: ['scripted'], tools: [], contexts: [], limits: input.manifest.limits }));
  const research = checked(await materializeResearch({ host: { registry, config, profile: 'scripted' }, manifest: input.manifest, catalog: input.catalog }));
  const region = checked(await buildResearchAndTraderRegion({ materialized: research, catalog: input.catalog, profile: 'scripted' }));
  const snapshot = checked(await createMasRegistrySnapshot(region.registry));
  const { registry: _registry, ...fragment } = region;
  const workflow = await defineMasWorkflow({ workflowId: 'trading-research-trader-fixture', title: 'Research and trader mechanism', description: 'Native debate and a read-only proposal.',
    ...fragment, registryRevision: snapshot.revision, configRegistryRevision: config.revision, profile: 'scripted', limits: input.manifest.limits });
  const validated = checked(await validateMasWorkflow(workflow, snapshot, config)), plan = checked(await planMasWorkflow(validated));
  const prepared = { validated, plan, snapshot, catalog: config };
  const response = tradingResearchScript;
  const run = async (options: Partial<ScriptedDriveOptions> = {}) => {
    let store: Pick<MasStore, 'readTrace'>;
    const bindings = checked(await createTradingResearchHostBindings({ manifest: input.manifest, snapshot: input.snapshot, portfolio: input.portfolio, catalog: input.catalog, materialized: research,
      trace: async () => { const trace = await store.readTrace('gmpl-measurement'); if (!trace) throw Error('Missing active trace'); return trace; }, provenance: attemptProvenance }));
    return driveGmplWorkflow(prepared, { ...options, input: { reports }, response: options.response ?? response(), onStore: value => { store = value; options.onStore?.(value); },
      bindings: { taskHandlers: bindings.taskHandlers, messageAdapters: bindings.messageAdapters, ...options.bindings } });
  };
  return { reports, research, region, prepared, response, run };
}

export const tradingResearchScript = (options: { action?: 'accept' | 'continue' | 'reject' | 'escalate'; contradiction?: boolean } = {}): ScriptedDriveOptions['response'] => (node, _round, _phase, messages) => {
    if (node === 'trader') {
      const verdict = promptJson(messages, 'verdict', 'portfolio') as { id: string; revision: string };
      const portfolio = promptJson(messages, 'portfolio') as { id: string };
      return { action: 'buy', quantity: 2, timing: 'next-open', horizon: 'Next session', rationale: 'Synthetic proposal based on the retained research.',
        citations: [{ id: verdict.id, digest: verdict.revision }], assumedPortfolioId: portfolio.id };
    }
    const context = promptJson(messages, 'context') as { participant?: string; findings: GmplFinding[]; positions?: Array<{ claimIds: string[] }>; history?: unknown[] };
    const evidence = promptJson(messages, 'evidence', 'context') as GmplEvidenceUnit[];
    const side = node.endsWith('-2') ? 'bear' : 'bull', citation = evidence[side === 'bear' ? Math.min(1, evidence.length - 1) : 0];
    const findings = [...context.findings];
    if (node.startsWith('position') && citation && !findings.some(f => f.id === `${side}-thesis`)) findings.push({ id: `${side}-thesis`,
      origin: node, disposition: 'supported', critical: false, contradictory: side === 'bear' && !!options.contradiction,
      reason: 'The cited analyst finding supports this synthetic test.', citations: [{ id: citation.id, digest: citation.digest }] });
    const result: GmplPatternResult = { answer: `Synthetic ${node} conclusion`, disposition: 'completed', findings,
      claims: citation ? [{ text: `Synthetic ${side} claim`, citations: [{ id: citation.id, digest: citation.digest }] }] : [] };
    return node.startsWith('position') ? { result, stance: side } : node.startsWith('rebuttal') ? { result, addresses: context.positions!.flatMap(p => p.claimIds).slice(0, 1) }
      : node === 'judge' ? { result, action: options.action ?? 'continue' } : { result };
  };
