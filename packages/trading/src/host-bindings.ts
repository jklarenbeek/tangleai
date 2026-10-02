/** Pure content bindings; the host supplies clients, durable runtime, clock and usage provenance. */
import { equalsJson } from '@jarenjs/core/object';
import { masRevisionOf, type MasRegistry, type MasTaskHandlerBinding, type MasMessageAdapter } from '@tangleai/mas';
import { createGmplCatalog, renderGmplPrompt, type GmplCatalog, type GmplCatalogDocument } from '@tangleai/gmpl';
import artifacts from '../artifacts/catalog.json' with { type: 'json' };
import { prepareTradingAnalystContext, checkAnalystReport, tradingAnalystView, TRADING_ANALYST_ROLES } from './analysts.ts';
import type { TradingAnalystProvenance } from './analysts.ts';
import { createTradingReadTools, TRADING_READ_TOOLS } from './tools.ts';
import { tradingSchemaOf } from './schema.ts';
import { immutableTradingJson } from './identity.ts';
import { tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingSnapshotBundle } from './snapshot.ts';
import type { TradingProviders } from './providers.ts';
import type { TradingRunManifest, PortfolioSnapshot, TradingAnalystRole } from './contracts.gen.ts';

export const tradingArtifacts: GmplCatalogDocument = immutableTradingJson(artifacts as unknown as GmplCatalogDocument);
/** The MAS task adapter preserves a domain refusal as its failure cause. */
export function tradingTaskValue<T>(outcome: TradingOutcome<T>): T {
  if (!outcome.valid) throw new Error(`Trading content refusal: ${JSON.stringify(outcome.issues)}`, { cause: outcome.issues });
  return outcome.value;
}
export async function tradingAnalystRegistry(catalog: GmplCatalog): Promise<TradingOutcome<MasRegistry>> {
  const roles: MasRegistry['roles'] = [];
  for (const role of TRADING_ANALYST_ROLES) {
    const a = catalog.prompt(`trading-analyst-${role}`);
    if (!a) return tradingRefuse('TTRD1002', '/catalog', 'Analyst prompt artifact is missing');
    roles.push({ id: a.role.id, title: role, instructions: a.role.instructions, instructionsRevision: await masRevisionOf(a.role.instructions), capabilities: [] });
  }
  const input = tradingSchemaOf('tradingReadToolInput'), inputRevision = await masRevisionOf(input);
  return { valid: true, value: { $masRegistry: '0.1', registryId: 'trading-analysts', roles,
    handlers: TRADING_ANALYST_ROLES.flatMap(role => ['prepare', 'check'].map(stage => ({ id: `${stage}-analyst-${role}`, title: `${stage} ${role}`, effect: 'pure' as const, idempotency: 'not-required' as const }))),
    tools: TRADING_READ_TOOLS.map(id => ({ id, title: id, effect: 'read', input, inputRevision })),
    messageAdapters: [{ id: 'json-schema', version: '0.1' }, ...catalog.document.prompts.map(a => ({ id: `trading-${a.id}`, version: a.revision }))],
    contextAdapters: [], templates: [], subgraphs: [] } };
}
export interface TradingHostInput {
  catalog: GmplCatalog; manifest: TradingRunManifest; snapshot: TradingSnapshotBundle; providers: TradingProviders; portfolio: PortfolioSnapshot;
  provenance: (role: TradingAnalystRole) => TradingOutcome<TradingAnalystProvenance> | Promise<TradingOutcome<TradingAnalystProvenance>>;
}
export async function createTradingHostBindings(input: TradingHostInput) {
  let content: Pick<TradingHostInput, 'manifest' | 'snapshot' | 'portfolio'>;
  try { content = immutableTradingJson({ manifest: input.manifest, snapshot: input.snapshot, portfolio: input.portfolio }); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Host content must be finite JSON', cause); }
  const provenanceFor = input.provenance, providers = input.providers;
  const catalog = await createGmplCatalog(input.catalog.document);
  if (!catalog.valid) return tradingRefuse('TTRD1002', '/catalog', 'Prompt catalog identity is invalid', catalog.issues[0]);
  if (content.manifest.promptCatalogRevision !== catalog.value.document.revision) return tradingRefuse('TTRD1002', '/catalog', 'Manifest does not bind this prompt catalog');
  const prepared = await prepareTradingAnalystContext(content); if (!prepared.valid) return prepared;
  const context = prepared.value, registry = await tradingAnalystRegistry(catalog.value); if (!registry.valid) return registry;
  const taskHandlers: Record<string, MasTaskHandlerBinding> = {}, messageAdapters = new Map<string, MasMessageAdapter>();
  for (const a of catalog.value.document.prompts) {
    const id = `trading-${a.id}`;
    messageAdapters.set(id, { id, version: a.revision, render: ({ value }) => {
      const rendered = renderGmplPrompt(a, value.variables);
      if (!rendered.valid) return tradingTaskValue(tradingRefuse('TTRD1001', '/variables', 'Prompt variables refused', rendered.issues[0]));
      return rendered.value.user;
    } });
  }
  for (const role of TRADING_ANALYST_ROLES) {
    const artifact = catalog.value.prompt(`trading-analyst-${role}`)!;
    const profile = content.manifest.rolesByProfile[artifact.role.id] ?? content.manifest.rolesByProfile.analyst;
    if (!profile) return tradingRefuse('TTRD1002', '/rolesByProfile', 'Manifest does not declare the analyst model profile');
    const variables = immutableTradingJson({ asset: context.snapshot.asset, cutoff_at: context.snapshot.cutoffAt, snapshot: tradingAnalystView(context.projections[role]), portfolio: context.portfolio });
    taskHandlers[`prepare-analyst-${role}`] = ({ value }) => {
      if (!equalsJson(value.snapshot, context.snapshot)) return tradingTaskValue(tradingRefuse('TTRD1002', '/snapshot', 'The run substituted its bound snapshot'));
      return { variables };
    };
    taskHandlers[`check-analyst-${role}`] = async ({ value }) => {
      if (!equalsJson(value.variables, variables)) return tradingTaskValue(tradingRefuse('TTRD1002', '/variables', 'The role projection changed after preparation'));
      const provenance = tradingTaskValue(await provenanceFor(role));
      if (provenance.model?.profile !== profile) return tradingTaskValue(tradingRefuse('TTRD1002', '/model/profile', 'Observed model profile differs from the manifest role binding'));
      return { report: tradingTaskValue(await checkAnalystReport({ output: value.out, projection: context.projections[role], snapshot: context.snapshot, artifact, provenance })) };
    };
  }
  const tools = createTradingReadTools({ context, providers });
  return { valid: true as const, value: { taskHandlers, messageAdapters, toolBindings: tools.toolBindings, audit: tools.audit, context, registry: registry.value } };
}
