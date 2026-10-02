/** Scripted client bindings for the public analyst region; MAS owns execution and repair. */
import { createMasRegistrySnapshot, createMasConfigCatalog, defineMasWorkflow, validateMasWorkflow, planMasWorkflow } from '@tangleai/mas';
import { createTradingHostBindings, buildAnalystRegion, TRADING_READ_TOOLS, TRADING_ANALYST_ROLES } from '@tangleai/trading';
import type { TradingAnalystRole, AnalystReportOutput, TradingAnalystProvenance, TradingSpend, TradingOutcome, TradingHostInput } from '@tangleai/trading';
import { driveGmplWorkflow } from './gmpl-runner.ts';
import type { ScriptedDriveOptions } from './gmpl-runner.ts';
function value<T>(outcome: TradingOutcome<T>): T { if (!outcome.valid) throw Error(JSON.stringify(outcome.issues)); return outcome.value; }
export const scriptedSpend = (): TradingSpend => ({ calls: 0, toolCalls: 0, tokens: 0, usd: 0, retries: 0, repairs: 0, ms: 0 });
export const scriptedModel = { profile: 'scripted', identityId: '3'.repeat(64) };
export async function prepareTradingAnalystDrive(input: Omit<TradingHostInput, 'provenance'>) {
  const { catalog, manifest, snapshot, portfolio, providers } = input;
  const spends = Object.fromEntries(TRADING_ANALYST_ROLES.map(role => [role, scriptedSpend()])) as Record<TradingAnalystRole, TradingSpend>;
  const provenance = (role: TradingAnalystRole) => ({ valid: true as const, value: { model: scriptedModel, spend: spends[role] } satisfies TradingAnalystProvenance });
  const host = value(await createTradingHostBindings({ catalog, manifest, snapshot, portfolio, providers, provenance }));
  const toolBindings = Object.fromEntries(Object.entries(host.toolBindings).map(([id, binding]) => [id, { ...binding, handler: (args: Parameters<typeof binding.handler>[0], context: Parameters<typeof binding.handler>[1]) => {
    const role = TRADING_ANALYST_ROLES.find(r => context.invocation?.node === `analyst-${r}`);
    if (role) spends[role].toolCalls++;
    return binding.handler(args, context);
  } }]));
  const region = value(await buildAnalystRegion({ catalog, profile: 'scripted', limits: manifest.limits }));
  const registry = await createMasRegistrySnapshot(host.registry), config = await createMasConfigCatalog({ profiles: ['scripted'], tools: [...TRADING_READ_TOOLS], contexts: [] });
  if (!registry.valid || !config.valid) throw Error(JSON.stringify({ registry, config }));
  const workflow = await defineMasWorkflow({ workflowId: 'trading-analyst-fixture', title: 'Scripted analyst lanes', description: 'One admitted snapshot and four concurrent analyst roles.',
    ...region, registryRevision: registry.value.revision, configRegistryRevision: config.value.revision, profile: 'scripted', limits: manifest.limits });
  const validated = await validateMasWorkflow(workflow, registry.value, config.value); if (!validated.valid) throw Error(JSON.stringify(validated.issues));
  const plan = await planMasWorkflow(validated.value); if (!plan.valid) throw Error(JSON.stringify(plan.issues));
  const prepared = { validated: validated.value, plan: plan.value, snapshot: registry.value, catalog: config.value };
  const report = (role: TradingAnalystRole): AnalystReportOutput => {
    const visible = host.context.projections[role].evidence[0];
    return { findings: visible ? [{ text: `Synthetic ${role} finding`, citations: [{ id: visible.id, digest: visible.digest }] }] : [],
      signal: 'neutral', confidence: visible ? 0.5 : 0, horizon: 'Next session', limitations: visible ? ['Scripted mechanism proof only'] : ['No admitted evidence'] };
  };
  const run = async (options: Partial<ScriptedDriveOptions> = {}) => {
    for (const role of TRADING_ANALYST_ROLES) Object.assign(spends[role], scriptedSpend());
    const beforeCall: NonNullable<ScriptedDriveOptions['beforeCall']> = async (node, iteration, phase) => {
      const role = node.replace('analyst-', '') as TradingAnalystRole, spend = spends[role];
      spend.calls++; spend.tokens += 10; if (phase === 'repair') spend.repairs++;
      await options.beforeCall?.(node, iteration, phase);
    };
    const response: ScriptedDriveOptions['response'] = (node, iteration, phase, messages) => options.response ? options.response(node, iteration, phase, messages) : report(node.replace('analyst-', '') as TradingAnalystRole);
    return driveGmplWorkflow(prepared, { ...options, input: { snapshot: snapshot.snapshot }, response, beforeCall, bindings: { taskHandlers: host.taskHandlers, messageAdapters: host.messageAdapters, toolBindings, ...options.bindings } });
  };
  return { host, region, prepared, report, spends, run };
}
