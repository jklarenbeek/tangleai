/** Hypothesis-owned searches report coverage and identity overlap, never novelty authority. */
import type { HypothesisSet, QueryPlan, DiscoveryQuery, LiteratureRecord, NoveltyReport } from '../contracts.gen.ts';
import type { ResearchProviderHost } from '../adapters/runtime.ts';
import { dedupeLiterature } from '../adapters/normalize.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchFail, researchValue } from '../workflow-contract.ts';
import { validateResearchShape } from '../schema.ts';
import { createQueryPlan, executeScholarlyDiscovery } from './discovery.ts';

export interface ResearchNoveltyPolicy extends Omit<QueryPlan, 'id' | 'projectId' | 'queries'> {
  query: Omit<DiscoveryQuery, 'id' | 'text'>;
}
export async function createResearchNoveltyPlan(set: HypothesisSet, policy: ResearchNoveltyPolicy): Promise<QueryPlan> {
  const hypotheses = researchValue(validateResearchShape<HypothesisSet>('HypothesisSet', set));
  const { query, ...limits } = immutableResearchJson(policy);
  const texts = [...new Set(hypotheses.queries.map(row => row.query))].sort();
  const queries = await Promise.all(texts.map(async text => ({ ...query, text,
    id: 'novelty-query-' + await researchRevisionOf({ provider: query.provider, text }) })));
  return createQueryPlan({ ...limits, projectId: hypotheses.projectId, queries });
}
export async function executeResearchNovelty(set: HypothesisSet, policy: ResearchNoveltyPolicy, existing: readonly LiteratureRecord[],
  host: { provider: ResearchProviderHost; admitPlan(plan: QueryPlan): Promise<void>; searxngBaseUrl?: string }, signal: AbortSignal) {
  const hypotheses = researchValue(validateResearchShape<HypothesisSet>('HypothesisSet', set)), plan = await createResearchNoveltyPlan(hypotheses, policy);
  const literature = immutableResearchJson(existing);
  for (const row of literature) researchValue(validateResearchShape('LiteratureRecord', row));
  const { id, ...body } = hypotheses;
  if (id !== 'hypotheses-' + await researchRevisionOf(body)) researchFail('TRSH1002', '/hypothesisSet/id', 'Hypothesis-set identity changed before novelty search.');
  // The enclosing store owner persists this exact plan before any provider can run.
  await host.admitPlan(plan);
  const discovered = await executeScholarlyDiscovery(plan, host.provider, signal, host.searxngBaseUrl ?? null);
  const overlapLiteratureIds: string[] = [];
  for (const old of literature) {
    for (const found of discovered.literature) {
      const combined = await dedupeLiterature([old, found]);
      if (combined.records.length === 1 && combined.dedupe.identityMerges > 0) { overlapLiteratureIds.push(old.id); break; }
    }
  }
  const value = { projectId: hypotheses.projectId, hypothesisSetId: hypotheses.id, queryPlanId: plan.id, receipt: discovered.receipt,
    coverage: { attempted: discovered.receipt.outcomes.filter(row => row.attempts > 0).length,
      complete: discovered.receipt.outcomes.filter(row => row.state === 'complete').length, total: plan.queries.length },
    overlapLiteratureIds: [...new Set(overlapLiteratureIds)].sort(), advisory: hypotheses.advisory, gating: false as const };
  const report = researchValue(validateResearchShape<NoveltyReport>('NoveltyReport', { id: 'novelty-' + await researchRevisionOf(value), ...value }));
  return { report, plan, ...discovered };
}
