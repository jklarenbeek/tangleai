/** Keyless risk composition through the public MAS authoring and durable execution seams. */
import { createMasRegistrySnapshot, createMasConfigCatalog, defineMasWorkflow, validateMasWorkflow, planMasWorkflow, type MasStore } from '@tangleai/mas';
import { materializeTradingRisk, createTradingRiskHostBindings, buildRiskAndDecisionRegion, createTradingRiskDecisionHostBindings } from '@tangleai/trading';
import type { TradingHostInput, TradingRiskWorkflowInput, RiskVerdictOutput, TradeProposal, RiskVerdict, Observation } from '@tangleai/trading';
import type { GmplEvidenceUnit, GmplFinding } from '@tangleai/gmpl';
import { driveGmplWorkflow, type ScriptedDriveOptions } from './gmpl-runner.ts';
import { checked, promptJson, attemptProvenance } from './trading-research-runner.ts';

export async function prepareTradingRiskDrive(input: Pick<TradingHostInput, 'manifest' | 'catalog' | 'snapshot' | 'portfolio'> & TradingRiskWorkflowInput) {
  const registry = checked(await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'trading-risk-fixture', roles: [], handlers: [], tools: [],
    messageAdapters: [], contextAdapters: [], templates: [], subgraphs: [] }));
  const config = checked(await createMasConfigCatalog({ profiles: ['scripted'], tools: [], contexts: [], limits: input.manifest.limits }));
  const materialized = checked(await materializeTradingRisk({ manifest: input.manifest, catalog: input.catalog, host: { registry, config, profile: 'scripted' } }));
  const response = tradingRiskScript;
  const run = async (options: Partial<ScriptedDriveOptions> = {}) => {
    let store: Pick<MasStore, 'readTrace'>;
    const bindings = checked(await createTradingRiskHostBindings({ ...input, materialized,
      trace: async () => { const trace = await store.readTrace('gmpl-measurement'); if (!trace) throw Error('Missing active risk trace'); return trace; }, provenance: attemptProvenance }));
    return driveGmplWorkflow(materialized, { ...options, input: { input: { reports: input.reports, verdict: input.verdict, proposal: input.proposal } },
      response: options.response ?? response(), onStore: value => { store = value; options.onStore?.(value); },
      bindings: { taskHandlers: bindings.taskHandlers, messageAdapters: bindings.messageAdapters, ...options.bindings } });
  };
  return { materialized, response, run };
}

export async function prepareTradingRiskDecisionDrive(input: Pick<TradingHostInput, 'manifest' | 'catalog' | 'snapshot' | 'portfolio'> & TradingRiskWorkflowInput & { valuationObservations?: readonly Observation[] }) {
  const risk = await prepareTradingRiskDrive(input), materialized = risk.materialized;
  const region = checked(await buildRiskAndDecisionRegion({ riskMaterialized: materialized, catalog: input.catalog, profile: 'scripted' }));
  const snapshot = checked(await createMasRegistrySnapshot(region.registry)), { registry: _registry, ...fragment } = region;
  const workflow = await defineMasWorkflow({ workflowId: 'trading-risk-decision-fixture', title: 'Risk and fund-manager mechanism',
    description: 'Read-only model stages and deterministic cutoff-bound order admission.', ...fragment, registryRevision: snapshot.revision,
    configRegistryRevision: materialized.catalog.revision, profile: 'scripted', limits: input.manifest.limits });
  const validated = checked(await validateMasWorkflow(workflow, snapshot, materialized.catalog)), plan = checked(await planMasWorkflow(validated));
  const prepared = { validated, plan, snapshot, catalog: materialized.catalog };
  const response = tradingRiskDecisionScript;
  const run = async (options: Partial<ScriptedDriveOptions> = {}) => {
    let store: Pick<MasStore, 'readTrace'>;
    const bindings = checked(await createTradingRiskDecisionHostBindings({ ...input, materialized,
      trace: async () => { const trace = await store.readTrace('gmpl-measurement'); if (!trace) throw Error('Missing active decision trace'); return trace; }, provenance: attemptProvenance }));
    return driveGmplWorkflow(prepared, { ...options, input: { input: { reports: input.reports, verdict: input.verdict, proposal: input.proposal } },
      response: options.response ?? response(), onStore: value => { store = value; options.onStore?.(value); },
      bindings: { taskHandlers: bindings.taskHandlers, messageAdapters: bindings.messageAdapters, ...options.bindings } });
  };
  return { region, materialized, prepared, response, run };
}

export const tradingRiskScript = (action: RiskVerdictOutput['action'] = 'continue'): ScriptedDriveOptions['response'] => (node, _round, _phase, messages) => {
    const evidence = promptJson(messages, 'evidence', 'turns') as GmplEvidenceUnit[], citation = evidence.at(-1)!;
    if (node !== 'risk-facilitator') return { position: `Synthetic ${node} view`, claims: [{ id: 'position', text: `Synthetic ${node} supported claim`,
      citations: [{ id: citation.id, digest: citation.digest }] }], recommendations: ['Record limits as advisory; execute only through the hard gate.'] };
    const findings = promptJson(messages, 'findings') as GmplFinding[];
    return { action, adjustedIntent: action === 'hold' || action === 'reject' ? { action: 'hold' } : { action: 'buy', quantity: 1 },
      acceptedClaims: findings.map(f => ({ id: f.id, reason: 'The delivered evidence supports this claim.' })), rejectedClaims: [], findings,
      recommendations: ['Synthetic stop recommendation is not an executable stop.'], summary: 'Synthetic risk review retains every perspective.' };
  };

export const tradingRiskDecisionScript = (action: RiskVerdictOutput['action'] = 'continue'): ScriptedDriveOptions['response'] => {
    const script = tradingRiskScript(action);
    return (node, i, phase, messages) => {
      if (node !== 'fund-manager') return script(node, i, phase, messages);
      const proposal = promptJson(messages, 'proposal', 'risk_verdict') as TradeProposal, verdict = promptJson(messages, 'risk_verdict', 'policy') as RiskVerdict;
      return { decision: verdict.disposition === 'rejected' ? 'rejected' : 'approved', finalIntent: verdict.adjustedIntent,
        reasons: ['Synthetic fund-manager decision follows the delivered risk verdict.'], inputProposalId: proposal.id, inputRiskVerdictId: verdict.id,
        citations: [{ id: proposal.id, digest: proposal.revision }, { id: verdict.id, digest: verdict.revision }] };
    };
  };
