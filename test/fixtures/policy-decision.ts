/** Synthetic complete paired decision; never written to benchmark/results. */
import { readFile } from 'node:fs/promises';
import {
  approvedInference, comparisonOf, chooseChallenger, decisionOf, transitionOf, registrationIdOf,
  questionSetOf, runIdOf, reportIdOf, RESPONSE_SCHEMA_REVISION, type LocomoPolicy, type Attempt,
} from '../../benchmark/lib/locomo-policy.ts';
import { scriptedEnv } from './scripted-wire.ts';

export async function syntheticPolicyDecision(): Promise<LocomoPolicy> {
  const report = JSON.parse(await readFile('benchmark/results/locomo-policy-screen.json', 'utf8')) as LocomoPolicy;
  const env = scriptedEnv();
  const controls = { provider: env.provider, endpoint: 'https://openrouter.ai/api/v1', answerModel: env.model, judgeModel: env.modelStrong,
    embedder: { model: env.embedModel, dims: 8 }, thinking: 'default' as const, responseSchema: RESPONSE_SCHEMA_REVISION,
    retry: { attempts: 1, baseMs: 3000, maxMs: 60000 }, deadlineMs: 120000, concurrency: env.maxConcurrency,
    perRunCeiling: env.maxCalls, campaignCeiling: 900, keySource: env.keySource };
  report.registration.inference = await approvedInference(controls);
  report.registration.registrationId = await registrationIdOf(report.registration);
  const inert = report.registration.cells.find(c => c.role === 'inert')!.cellId;
  const shipped = report.registration.cells.find(c => c.role === 'shipped')!.cellId;
  const challenger = report.selection.shortlist.find(id => id !== inert && id !== shipped)!;
  const template = report.attempts.find(a => a.cellId === inert)!;
  report.census = { embedRequests: 0, chatCalls: 0, embedder: controls.embedder, rows: [] };
  for (const phase of ['selection', 'confirmation'] as const) {
    const cells = phase === 'selection' ? report.selection.shortlist : [inert, shipped, challenger];
    const split = report.registration.splits[phase];
    const categories = [1, 2, 3, 4].flatMap(c => Array.from({ length: split.perCategory[String(c) as '1'] }, () => c));
    const ids = categories.map((_, i) => `${phase}:${i}`);
    const questionSet = await questionSetOf(ids);
    const attempts: Attempt[] = [];
    for (const cellId of cells) {
      const score = cellId === challenger ? 0.75 : 0.5;
      const a = structuredClone(template);
      a.cellId = cellId; a.phase = phase;
      a.run = { ...a.run, tier: 'live', ...controls, questionSet, sampleIds: ids, source: report.source.sha256, budgetCeiling: controls.perRunCeiling };
      delete (a.run as unknown as Record<string, unknown>).perRunCeiling;
      delete (a.run as unknown as Record<string, unknown>).campaignCeiling;
      a.runId = await runIdOf(cellId, a.run);
      a.denominators = { planned: ids.length, answered: ids.length, unanswered: { wire: 0, budget: 0 }, invalid: 0, questionSet };
      a.causes = null;
      a.results = ids.map((id, i) => ({ id, category: categories[i] as 1, score, f1: score, ceiling: 1, promptSha256: (cellId === inert ? 'a' : 'b').repeat(64), tokens: 100, calls: 1 }));
      a.cost = { calls: ids.length, replayed: 0, tokens: ids.length * 100, promptTokens: ids.length * 90, completionTokens: ids.length * 10, tokensPerAnswer: 100, callsPerAnswer: 1 };
      a.prompts = { unchanged: cellId === inert ? ids.length : 0, changed: cellId === inert ? 0 : ids.length, changedIds: cellId === inert ? [] : ids, tokenProxy: ids.length * 90, proxy: 'provider-prompt-tokens', against: inert };
      a.eligibility = { eligible: true, reasons: [] };
      attempts.push(a);
    }
    report.attempts.push(...attempts);
    const control = attempts.find(a => a.cellId === inert)!;
    const comparisons = attempts.filter(a => a.cellId !== inert).map(a => comparisonOf(a, control, report.registration.objective, 'locomo-f1'));
    report.comparisons.push(...comparisons);
    if (phase === 'selection') {
      const choice = chooseChallenger(comparisons, cells.filter(id => id !== inert && id !== shipped), report.registration.objective);
      report.selection.transition = await transitionOf(choice, report.registration, report.selection.frozen!.identity);
      report.selection.finalist = choice.challenger;
    } else report.selection.decision = decisionOf(comparisons.find(c => c.treatment === challenger)!, inert, report.registration.objective);
  }
  report.selection.state = 'confirmed';
  report.reportId = await reportIdOf(report);
  return report;
}
