/** One native model role supplies analysis, proposal and final decision for the registered ablation. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { agentInvocation, taskInvocation, masMessage, masRevisionOf, masWorkflowVersionIdOf,
  createMasRegistrySnapshot, validateMasWorkflow, planMasWorkflow } from '@tangleai/mas';
import { createTradingDecisionHostBindings, prepareTradingAnalystContext, createTradingReadTools, TRADING_ANALYST_ROLES, TRADING_READ_TOOLS,
  createTradingRecord, tradingSchemaOf, toOrderIntent, tradingRevisionOf,
  type AnalystReportOutput, type TradingProposedIntent, type TradingSpend, type TradingAnalystView, type TradingVisiblePortfolio,
  type MaterializedTradingDecision } from '@tangleai/trading';
import { tradingAnalystView } from '../../packages/trading/src/analysts.ts';
import { checkedTradingAttempt } from '../../packages/trading/src/research.ts';
import { validateTradingShape } from '@tangleai/trading';
import { createReportValidator } from './validate.ts';
import { materializeScriptedTradingDecision, type ScriptedTradingAgentOptions } from './trading-agent-runner.ts';
import { checked, promptJson } from './trading-research-runner.ts';

const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const instructions = 'Act as the sole analyst, trader and final decision maker. Use only the four supplied point-in-time views and the read tools. Return cited analysis, a bounded next-open intent, its rationale and the exact assumed portfolio id. There is no independent research or risk review. The deterministic broker enforces the unchanged hard policy.';
const variablesSchema = object({ asset: { type: 'string' }, cutoffAt: { type: 'string' },
  views: { type: 'array', items: tradingSchemaOf('tradingAnalystView'), minItems: 4, maxItems: 4 },
  portfolio: tradingSchemaOf('tradingVisiblePortfolio'), policy: tradingSchemaOf('riskPolicy') });
const outputSchema = object({ analysis: tradingSchemaOf('analystReportOutput'), intent: tradingSchemaOf('tradingProposedIntent'),
  rationale: { type: 'string', minLength: 1 }, assumedPortfolioId: tradingSchemaOf('tradingId') });
const validateOutput = createReportValidator(outputSchema);
const zero: TradingSpend = { calls: 0, tokens: 0, toolCalls: 0, usd: 0, retries: 0, repairs: 0, ms: 0 };
type SingleOutput = { analysis: AnalystReportOutput; intent: TradingProposedIntent; rationale: string; assumedPortfolioId: string };

export function singleAgentTradingOptions(): ScriptedTradingAgentOptions {
  const originals = new Map<string, MaterializedTradingDecision>();
  const revision = tradingRevisionOf({ instructions, variablesSchema, outputSchema });
  return {
    materialize: async (manifest, catalog) => {
      const base = await materializeScriptedTradingDecision(manifest, catalog), workflow = cloneJson(base.workflow), registry = cloneJson(base.snapshot.document);
      originals.set(manifest.id, base);
      const role = registry.roles.find(r => r.id === 'trading-fund-manager')!;
      role.title = 'Single analyst and trader with final decision authority'; role.instructions = instructions; role.instructionsRevision = await masRevisionOf(instructions);
      registry.messageAdapters.push({ id: 'trading-single-agent', version: await revision });
      for (const id of ['prepare-single', 'check-single']) registry.handlers.push({ id, title: id, effect: 'pure', idempotency: 'not-required' });
      workflow.workflowId = 'trading-ablation-single-agent'; workflow.title = 'Single analyst and trader';
      workflow.nodes = [workflow.nodes.find(n => n.id === 'snapshot-project')!,
        taskInvocation({ id: 'prepare-single', handler: 'prepare-single', input: { snapshot: tradingSchemaOf('marketSnapshot') }, output: { variables: variablesSchema } }),
        agentInvocation({ id: 'fund-manager', role: role.id, profile: manifest.rolesByProfile['fund-manager'], instructionsRevision: role.instructionsRevision,
          input: { variables: variablesSchema }, output: { out: outputSchema }, messageAdapter: 'trading-single-agent', tools: [...TRADING_READ_TOOLS] }),
        taskInvocation({ id: 'check-single', handler: 'check-single', input: { variables: variablesSchema, out: outputSchema }, output: { output: tradingSchemaOf('tradingDecisionOutput') } })];
      workflow.messages = [masMessage(['snapshot-project', 'snapshot'], ['prepare-single', 'snapshot']),
        masMessage(['prepare-single', 'variables'], ['fund-manager', 'variables']), masMessage(['prepare-single', 'variables'], ['check-single', 'variables']),
        masMessage(['fund-manager', 'out'], ['check-single', 'out'])];
      workflow.exit = [{ port: 'output', from: { node: 'check-single', port: 'output' } }];
      const snapshot = checked(await createMasRegistrySnapshot(registry)); workflow.registry.revision = snapshot.revision;
      workflow.versionId = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>);
      const validated = checked(await validateMasWorkflow(workflow, snapshot, base.catalog)), plan = checked(await planMasWorkflow(validated));
      return { ...base, workflow, validated, plan, snapshot };
    },
    bindings: async input => {
      const original = originals.get(input.manifest.id); if (!original) throw Error('Single agent has no materialized predecessor');
      const bound = await createTradingDecisionHostBindings({ ...input, materialized: original }); if (!bound.valid) return bound;
      const context = checked(await prepareTradingAnalystContext({ manifest: input.manifest, snapshot: input.snapshot, portfolio: input.portfolio })), snapshot = context.snapshot, promptRevision = await revision;
      const variables = { asset: snapshot.asset, cutoffAt: snapshot.cutoffAt, views: TRADING_ANALYST_ROLES.map(r => tradingAnalystView(context.projections[r])),
        portfolio: context.portfolio, policy: input.manifest.riskPolicy };
      const tools = createTradingReadTools({ context, providers: input.providers, rolesByInvocation: { 'fund-manager': TRADING_ANALYST_ROLES } });
      bound.value.toolBindings = tools.toolBindings; bound.value.audit = tools.audit;
      bound.value.messageAdapters.set('trading-single-agent', { id: 'trading-single-agent', version: promptRevision,
        render: ({ value }) => `variables:\n${JSON.stringify(value.variables)}` });
      bound.value.taskHandlers['prepare-single'] = ({ value }) => {
        if (!equalsJson(value.snapshot, snapshot)) throw Error('Single-agent preparation substituted its snapshot');
        return { variables };
      };
      bound.value.taskHandlers['check-single'] = async ({ value }) => {
        if (!equalsJson(value.variables, variables)) throw Error('Single-agent variables changed after preparation');
        if (!validateOutput(value.out).valid) throw Error('Single-agent output violates its closed contract');
        const output = value.out as SingleOutput, analysis = checked(validateTradingShape<AnalystReportOutput>('analystReportOutput', output.analysis));
        if (output.assumedPortfolioId !== context.portfolio.id) throw Error('Single-agent output assumed another portfolio');
        const visible = variables.views.flatMap(v => v.evidence);
        for (const finding of analysis.findings) for (const cite of finding.citations)
          if (!visible.some(v => v.id === cite.id && v.digest === cite.digest)) throw Error('Single-agent citation is hidden or altered');
        if (!analysis.findings.length && (analysis.signal !== 'neutral' || analysis.confidence !== 0 || !analysis.limitations.length)) throw Error('Evidence-free single-agent analysis must abstain explicitly');
        const attempt = (await input.trace()).attempts.find(a => a.path === 'fund-manager' && a.status === 'completed');
        if (!attempt) throw Error('Single-agent output has no completed native attempt');
        const observed = checked(await checkedTradingAttempt(attempt, input.manifest.rolesByProfile['fund-manager'], input.provenance));
        const key = { manifestId: snapshot.manifestId, asset: snapshot.asset, sessionId: snapshot.sessionId };
        const shared = { manifestId: snapshot.manifestId, snapshotId: snapshot.id, model: observed.model, promptRevision, spend: zero };
        const analytic = { ...shared, model: { profile: 'analytic:single-agent', identityId: promptRevision } };
        const claims = analysis.findings.map(f => ({ text: f.text, citations: [...new Set(f.citations.map(c => c.id))] }));
        // The one physical attempt is charged once, on the final decision. These records are projections of that same output.
        const report = checked(await createTradingRecord('analyst-report', { ...shared, role: 'trading-single-analyst-trader', key: { ...key, stage: 'single-analysis' },
          citations: [...new Set(claims.flatMap(c => c.citations))], claims, summary: claims.map(c => c.text).join('\n') || 'Explicit abstention',
          signals: [{ name: analysis.signal, value: analysis.confidence, reason: analysis.horizon }], gaps: analysis.limitations, analysis }));
        const research = checked(await createTradingRecord('research-verdict', { ...analytic, role: 'trading-single-unreviewed', key: { ...key, stage: 'research-verdict' },
          citations: [report.id], claims: [], disposition: 'no-consensus', summary: 'Single-agent output; no independent research debate occurred.', historyIds: [] }));
        const proposal = checked(await createTradingRecord('trade-proposal', { ...shared, role: 'trading-single-analyst-trader', key: { ...key, stage: 'trade-proposal' },
          ...output.intent, asset: snapshot.asset, timing: 'next-open', horizon: analysis.horizon, rationale: output.rationale, researchVerdictId: research.id,
          assumedPortfolioId: context.portfolio.id, exceedsPosition: output.intent.action === 'sell' && (output.intent.quantity ?? 0) > context.portfolio.positions.find(p => p.asset === snapshot.asset)!.quantity,
          citations: [report.id, research.id], claims: [{ text: output.rationale, citations: [report.id] }] }));
        const risk = checked(await createTradingRecord('risk-verdict', { ...analytic, role: 'trading-single-unreviewed', key: { ...key, stage: 'risk-verdict' },
          citations: [proposal.id], claims: [], disposition: 'no-consensus', summary: 'No independent risk team; unchanged proposal reaches the shared hard policy.',
          historyIds: [], proposalId: proposal.id, maxQuantity: proposal.quantity ?? 0, adjustedIntent: output.intent, unadjusted: true, judgments: [], findings: [] }));
        const decision = checked(await createTradingRecord('fund-manager-decision', { ...shared, spend: observed.spend, role: 'trading-fund-manager', key: { ...key, stage: 'fund-manager-decision' },
          citations: [proposal.id, risk.id], claims: [{ text: output.rationale, citations: [proposal.id] }], action: output.intent.action === 'hold' ? 'hold' : 'approve',
          quantity: output.intent.quantity ?? 0, proposalId: proposal.id, riskVerdictId: risk.id, violations: [], rationale: output.rationale,
          decision: 'approved', finalIntent: output.intent, reasons: [output.rationale], inputProposalId: proposal.id, inputRiskVerdictId: risk.id }));
        const admission = checked(await toOrderIntent({ manifest: input.manifest, snapshot: input.snapshot, portfolio: input.portfolio,
          valuationObservations: input.valuationObservations ?? [], proposal, riskVerdict: risk, decision }));
        return { output: { admission, artifacts: [report, research, proposal, risk, decision] } };
      };
      return bound;
    },
    response: (_node, _iteration, _phase, messages) => {
      const variables = promptJson(messages, 'variables') as { asset: string; views: TradingAnalystView[]; portfolio: TradingVisiblePortfolio };
      const first = variables.views.flatMap(v => v.evidence)[0], held = variables.portfolio.positions.find(p => p.asset === variables.asset)!.quantity;
      return { analysis: { findings: first ? [{ text: 'Synthetic combined finding', citations: [{ id: first.id, digest: first.digest }] }] : [],
        signal: 'neutral', confidence: first ? 0.5 : 0, horizon: 'Next session', limitations: ['Single scripted model; no independent debate or review.'] },
        intent: held ? { action: 'hold' } : { action: 'buy', quantity: 2 }, rationale: 'The registered two-share policy uses the supplied causal views.', assumedPortfolioId: variables.portfolio.id };
    },
  };
}
