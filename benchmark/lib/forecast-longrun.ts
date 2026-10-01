/** Generation accounting comes from complete, independently replayed lifecycle records. */
import { equalsJson } from '@jarenjs/core/object';
import { forecastRevision, forecastBytes, combineForecastSpend, type HarnessDocument, type RetrospectiveCheck } from '@tangleai/forecast';
import type { ArtifactVersion } from '@tangleai/outcomes';
import { measureEvolvingForecast } from './forecast-evolving.ts';
import { scoreForecast } from './forecast-oracle.ts';
import type { ForecastGeneration } from './forecast.types.ts';
import type { ForecastFixtures } from './forecast-fixtures.ts';

export async function forecastGenerations(fixture: ForecastFixtures, measured: Awaited<ReturnType<typeof measureEvolvingForecast>>) {
  const generations: ForecastGeneration[] = [], active = new Map<string,{ versionId: string | null;document: HarnessDocument;digest: string }>(), cumulative = new Map<string,ReturnType<typeof combineForecastSpend>>();
  for (const [index,q] of fixture.questions.entries()) {
    const retained = measured.retained.filter(r => r.question.scopeKey === q.scopeKey && r.question.prompt === q.prompt && r.question.issuedAt === q.issuedAt);
    if (retained.length !== q.checkpoints.length) throw Error('Generation accounting lost a registered checkpoint.');
    const runtimeQuestion = retained[0].question, retrospective = measured.lifecycle.records.retrospectives.find(r => r.questionId === runtimeQuestion.id) as unknown as RetrospectiveCheck | undefined;
    const before = active.get(q.scopeKey) ?? { versionId: null,document: fixture.seed,digest: fixture.manifest.seedHarnessDigest };
    if (runtimeQuestion.startedFromCheckedVersionId !== before.versionId) throw Error('Generation does not start from its measured checked predecessor.');
    let after = before;
    if (retrospective?.promotion) {
      const version = measured.lifecycle.records.outcomes.find(r => r.id === retrospective.promotion!.head.versionId);
      if (version?.kind !== 'artifactVersion') throw Error('A generation lacks its activated outcome artifact.');
      const document = (version as unknown as ArtifactVersion).payload as unknown as HarnessDocument;
      after = { versionId: version.id as string,document,digest: await forecastRevision(document) };
    }
    active.set(q.scopeKey,after);
    const spend = combineForecastSpend(...retained.map(r => r.checkpoint.spend),...(retrospective?.receipt ? [retrospective.receipt.spend] : []));
    cumulative.set(q.scopeKey,combineForecastSpend(...(cumulative.has(q.scopeKey) ? [cumulative.get(q.scopeKey)!] : []),spend));
    const next = fixture.questions.slice(index+1).find(n => n.scopeKey === q.scopeKey), outcome = next ? fixture.resolutions.find(r => r.questionId === next.id) : null;
    const transferCases: { checkpointId: string;utility: number;seedUtility: number;delta: number }[] = [], missing: string[] = [];
    if (next && outcome) for (const checkpoint of next.checkpoints) {
      const bank = fixture.predictions[checkpoint.id], predicted = bank?.[after.digest], seed = bank?.[fixture.manifest.seedHarnessDigest];
      if (predicted === undefined || seed === undefined) { missing.push(checkpoint.id);continue; }
      const utility = scoreForecast(next.adapter,predicted,outcome.outcome).utility, seedUtility = scoreForecast(next.adapter,seed,outcome.outcome).utility;
      transferCases.push({ checkpointId: checkpoint.id,utility,seedUtility,delta: utility-seedUtility });
    }
    const available = !!next && !!outcome && missing.length === 0 && transferCases.length === next.checkpoints.length;
    const mean = (key: 'utility' | 'seedUtility' | 'delta') => transferCases.reduce((sum,c) => sum+c[key],0)/transferCases.length;
    generations.push({ scopeKey: q.scopeKey,questionId: q.id,generation: generations.filter(g => g.scopeKey === q.scopeKey).length+1,startedFromDigest: before.digest,harnessDigest: after.digest,checkedVersionId: after.versionId,harnessBytes: forecastBytes(after.document),componentsChanged: (Object.keys(after.document) as (keyof HarnessDocument)[]).filter(k => after.document[k] !== before.document[k]),patchOperations: retained.reduce((n,r) => n+(r.revision?.patch.length ?? 0),0),guidanceCarried: retrospective?.verdicts.filter(v => v.verdict === 'validate').length ?? 0,guidanceRefined: retrospective?.verdicts.filter(v => v.verdict === 'refine').length ?? 0,guidanceDropped: retrospective?.verdicts.filter(v => v.verdict === 'reject').length ?? 0,outcome: retrospective?.outcome ?? 'pending',spend,cumulative: cumulative.get(q.scopeKey)!,transfer: { status: available ? 'measured' as const : 'not-run' as const,nextQuestionId: next?.id ?? null,harnessDigest: after.digest,cases: transferCases,missingCheckpointIds: missing,utility: available ? mean('utility') : null,seedUtility: available ? mean('seedUtility') : null,delta: available ? mean('delta') : null,reason: available ? null : !next ? 'No related successor is registered.' : !outcome ? 'The successor remains unresolved.' : 'No registered prediction for harness digest ' + after.digest + '.' } });
  }
  return generations;
}
export async function measureForecastLongRun(fixture: ForecastFixtures, primary: Awaited<ReturnType<typeof measureEvolvingForecast>>) {
  const second = await measureEvolvingForecast(fixture), generations = await forecastGenerations(fixture,primary), repeated = await forecastGenerations(fixture,second);
  if (!equalsJson(primary,second) || !equalsJson(generations,repeated)) throw Error('Independent long-run replay changed its retained lifecycle, generations, cost or heads.');
  return { generations,checkedHeads: primary.lifecycle.checkedHeads,independentReplays: 2 as const,artifactDigest: await forecastRevision(primary),generationDigest: await forecastRevision(generations),physicalRequests: 0 as const };
}
