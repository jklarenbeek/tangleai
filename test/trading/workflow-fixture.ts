import { createMasRegistrySnapshot, createMasConfigCatalog, type MasStore } from '@tangleai/mas';
import { materializeResearch, materializeTradingRisk, buildTradingDecisionWorkflow, createTradingDecisionHostBindings, TRADING_READ_TOOLS } from '@tangleai/trading';
import { analystFixture } from './analyst-fixture.ts';
import { checked, attemptProvenance } from '../../benchmark/lib/trading-research-runner.ts';
import { driveGmplWorkflow, type ScriptedDriveOptions } from '../../benchmark/lib/gmpl-runner.ts';
import { tradingDecisionScript } from '../../benchmark/lib/trading-scripts.ts';
export async function workflowFixture() {
  const f = await analystFixture(60, { rolesByProfile: { analyst: 'scripted', research: 'scripted', trader: 'scripted', risk: 'scripted', 'fund-manager': 'scripted' } });
  const registry = checked(await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'trading-fixture', roles: [], handlers: [], tools: [], messageAdapters: [], contextAdapters: [], templates: [], subgraphs: [] }));
  const config = checked(await createMasConfigCatalog({ profiles: ['scripted'], tools: [...TRADING_READ_TOOLS], contexts: [], limits: f.manifest.limits }));
  const host = { registry, config, profile: 'scripted' };
  const researchMaterialized = checked(await materializeResearch({ host, catalog: f.catalog, manifest: f.manifest }));
  const riskMaterialized = checked(await materializeTradingRisk({ host, catalog: f.catalog, manifest: f.manifest }));
  const materialized = checked(await buildTradingDecisionWorkflow({ catalog: f.catalog, manifest: f.manifest, researchMaterialized, riskMaterialized, profile: 'scripted' }));
  const run = async (options: Partial<ScriptedDriveOptions> = {}) => {
    let store: Pick<MasStore, 'readTrace'>;
    const bindings = checked(await createTradingDecisionHostBindings({ ...f, providers: f.fixture.providers, materialized,
      trace: async () => { const trace = await store.readTrace('gmpl-measurement'); if (!trace) throw Error('Missing decision trace'); return trace; }, provenance: attemptProvenance }));
    return driveGmplWorkflow(materialized, { ...options, input: { request: bindings.request }, response: options.response ?? tradingDecisionScript(),
      onStore: value => { store = value; options.onStore?.(value); }, bindings: { ...bindings, ...options.bindings } });
  };
  return { ...f, materialized, run };
}
