/** Registered native interventions; the production workflow and its guards remain the full method. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { createMasRegistrySnapshot, masWorkflowVersionIdOf, validateMasWorkflow, planMasWorkflow, taskInvocation, masMessage, type MasWorkflow } from '@tangleai/mas';
import { createTradingDecisionHostBindings, createTradingRecord, reportsToEvidence, tradingRevisionOf, validateTradingShape,
  type AnalystReport, type ResearchVerdict, type TradeProposal, type TradingSpend, type TradingRiskState, type RiskVerdictOutput, type MaterializedTradingDecision } from '@tangleai/trading';
import { materializeScriptedTradingDecision, type ScriptedTradingAgentOptions } from './trading-agent-runner.ts';
import { checked } from './trading-research-runner.ts';
import { checkTradingArtifactScope } from '../../packages/trading/src/evidence.ts';

export type TradingAblationKind = 'no-research-debate' | 'no-risk-team';
const zero: TradingSpend = { calls: 0, tokens: 0, toolCalls: 0, usd: 0, retries: 0, repairs: 0, ms: 0 };

export function tradingAblationOptions(kind: TradingAblationKind): ScriptedTradingAgentOptions {
  const originals = new Map<string, MaterializedTradingDecision>();
  const revision = tradingRevisionOf({ kind, version: 1, semantics: 'Explicit deterministic omission; retain evidence and final financial policy' });
  return {
    materialize: async (manifest, catalog) => {
      const base = await materializeScriptedTradingDecision(manifest, catalog), workflow = cloneJson(base.workflow), registry = cloneJson(base.snapshot.document);
      originals.set(manifest.id, base);
      workflow.workflowId = `trading-ablation-${kind}`; workflow.title = `Registered ${kind} intervention`;
      if (kind === 'no-research-debate') {
        const original = workflow.nodes.find(n => n.id === 'check-research')!;
        const removed = new Set(['prepare-research', 'research']);
        workflow.nodes = workflow.nodes.filter(n => !removed.has(n.id)).map(n => n.id === original.id
          ? taskInvocation({ id: n.id, handler: 'trading-ablation-research', input: { reports: original.input.ports.reports.schema },
            output: Object.fromEntries(Object.entries(original.output.ports).map(([k, v]) => [k, v.schema])) }) : n);
        workflow.messages = workflow.messages.filter(m => !removed.has(m.from.node) && !removed.has(m.to.node) && m.to.node !== original.id);
        workflow.messages.push(masMessage(['evidence-project', 'reports'], ['check-research', 'reports']),
          masMessage(['evidence-project', 'reports'], ['prepare-trader', 'reports']));
        registry.handlers.push({ id: 'trading-ablation-research', title: 'Retain unreviewed analyst evidence', effect: 'pure', idempotency: 'not-required' });
        registry.handlers.push({ id: 'trading-ablation-risk-initialize', title: 'Risk input with an explicit omitted research bridge', effect: 'pure', idempotency: 'not-required' });
        const subgraph = registry.subgraphs.find(s => s.id === base.riskMaterialized.workflow.workflowId)!;
        const child = subgraph.workflow as unknown as MasWorkflow, initialize = child.nodes.find(n => n.id === 'risk-initialize')!;
        if (initialize.kind !== 'task') throw Error('Registered risk initialization is no longer a native task');
        initialize.handler = 'trading-ablation-risk-initialize';
        child.versionId = await masWorkflowVersionIdOf(subgraph.workflow); subgraph.versionId = child.versionId;
      } else {
        workflow.nodes = workflow.nodes.map(n => n.id === 'risk' ? taskInvocation({ id: n.id, handler: 'trading-ablation-risk',
          input: Object.fromEntries(Object.entries(n.input.ports).map(([k, v]) => [k, v.schema])),
          output: Object.fromEntries(Object.entries(n.output.ports).map(([k, v]) => [k, v.schema])) }) : n);
        registry.handlers.push({ id: 'trading-ablation-risk', title: 'Preserve proposal for final hard policy', effect: 'pure', idempotency: 'not-required' });
      }
      const snapshot = checked(await createMasRegistrySnapshot(registry)); workflow.registry.revision = snapshot.revision;
      workflow.versionId = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>);
      const validated = checked(await validateMasWorkflow(workflow, snapshot, base.catalog)), plan = checked(await planMasWorkflow(validated));
      return { ...base, workflow, validated, plan, snapshot };
    },
    bindings: async input => {
      const original = originals.get(input.manifest.id); if (!original) throw Error('Ablation has no materialized predecessor');
      const bound = await createTradingDecisionHostBindings({ ...input, materialized: original }); if (!bound.valid) return bound;
      const snapshot = input.snapshot.snapshot, promptRevision = await revision;
      const model = { profile: `analytic:${kind}`, identityId: promptRevision };
      const key = { manifestId: snapshot.manifestId, asset: snapshot.asset, sessionId: snapshot.sessionId };
      const unreviewed = async (reports: AnalystReport[]) => {
        checked(await checkTradingArtifactScope(reports, snapshot));
        const evidence = checked(await reportsToEvidence(reports));
        const summary = 'Research debate omitted; the trader receives the unchanged analyst evidence without a consensus judgment.';
        const claims = evidence.map(e => ({ text: e.text, citations: [{ id: e.id, digest: e.digest }] }));
        const verdict = checked(await createTradingRecord('research-verdict', { manifestId: snapshot.manifestId, key: { ...key, stage: 'research-verdict' },
          role: 'trading-research-verdict', snapshotId: snapshot.id, citations: reports.map(r => r.id), model, spend: zero, promptRevision,
          claims: reports.flatMap(r => r.claims.map(c => ({ text: c.text, citations: [r.id] }))), disposition: 'no-consensus', summary,
          historyIds: [], result: { answer: summary, disposition: 'no-consensus', claims, findings: [] } }));
        return { verdict, turns: [] };
      };
      bound.value.taskHandlers['trading-ablation-research'] = ({ value }) => unreviewed(value.reports as AnalystReport[]);
      bound.value.taskHandlers['trading-ablation-risk-initialize'] = async ({ value }) => {
        const chain = value.input as { reports: AnalystReport[]; verdict: ResearchVerdict; proposal: TradeProposal };
        checked(await checkTradingArtifactScope([...chain.reports, chain.verdict, chain.proposal], snapshot));
        const expected = await unreviewed(chain.reports);
        if (!equalsJson(chain.verdict, expected.verdict) || chain.proposal.researchVerdictId !== chain.verdict.id
          || chain.proposal.assumedPortfolioId !== snapshot.portfolioId
          || [...chain.reports, chain.proposal].some(a => input.catalog.prompt(a.role)?.revision !== a.promptRevision)
          || chain.proposal.citations.some(id => ![...chain.reports, chain.verdict].some(a => a.id === id)))
          throw Error('Ablated research input lost its exact analytic bridge, compiled reports or proposal chain');
        const artifacts = [...chain.reports, chain.verdict, chain.proposal];
        return { state: checked(validateTradingShape<TradingRiskState>('tradingRiskState', { round: 1, maxRounds: input.manifest.rounds.risk,
          done: false, disposition: null, proposal: chain.proposal,
          evidence: artifacts.map(a => ({ id: a.id, digest: a.revision, text: a.claims.map(c => c.text).join('\n') || ('summary' in a ? a.summary : a.rationale) })),
          turns: [], currentTurns: [], findings: [], history: [] })) };
      };
      bound.value.taskHandlers['trading-ablation-risk'] = async ({ value, path }) => {
        const proposal = (value.input as { proposal: TradeProposal }).proposal;
        checked(await checkTradingArtifactScope([proposal], snapshot));
        const adjustedIntent = proposal.action === 'hold' ? { action: 'hold' as const } : proposal.quantity === undefined
          ? { action: proposal.action, targetWeight: proposal.targetWeight! } : { action: proposal.action, quantity: proposal.quantity };
        const summary = 'Risk team omitted; preserve the proposal unchanged for the fund manager and the shared deterministic hard policy.';
        const output: RiskVerdictOutput = { action: 'continue', adjustedIntent, acceptedClaims: [], rejectedClaims: [], findings: [], recommendations: [], summary };
        const attempt = [...(await input.trace()).attempts].reverse().find(a => a.path === path && a.kind === 'task');
        if (!attempt) throw Error('The deterministic risk bridge has no native task attempt');
        const verdict = checked(await createTradingRecord('risk-verdict', { manifestId: snapshot.manifestId, snapshotId: snapshot.id,
          role: 'trading-ablation-risk-policy', key: { ...key, stage: 'risk-verdict' }, citations: [proposal.id], model, spend: zero, promptRevision,
          claims: [], disposition: 'no-consensus', summary, historyIds: [], proposalId: proposal.id,
          maxQuantity: proposal.quantity ?? 0, adjustedIntent, unadjusted: true, findings: [], acceptedClaims: [], rejectedClaims: [], recommendations: [],
          judgments: [{ round: 1, output, model, spend: zero, attemptKey: attempt.idempotencyKey, attemptNumber: attempt.attempt }] }));
        return { verdict, turns: [] };
      };
      return bound;
    },
  };
}
