/** Host capability assembly; profiles remain immutable data and never resolve I/O. */
import { bindDomainProfile, computationalDomainProfile, COMPUTATIONAL_PLAN_POLICY, COMPUTATIONAL_RUBRIC,
  RESEARCH_MARKDOWN_EXPORT_POLICY, validateComputationalPlan, researchArtifacts, researchValue,
  researchRevisionOf, renderMarkdownBundle, type ResearchEvaluator } from '@tangleai/research';
import { TABULAR_STATISTICS_PROFILE, TABULAR_CONTEXT_PROMPT, TABULAR_PLAN_POLICY, TABULAR_EVALUATOR, TABULAR_RUBRIC,
  validateTabularPlan, createTabularStatisticsEvaluator } from '@tangleai/research';

export async function bindComputationalResearchDomain<Labels>(evaluator: ResearchEvaluator<Labels>,
  options: Omit<NonNullable<Parameters<typeof computationalDomainProfile>[0]>, 'evaluator'> = {}) {
  const identity = { id: evaluator.id, version: evaluator.version };
  const captured = { ...identity, evaluate: evaluator.evaluate };
  const profile = researchValue(await computationalDomainProfile({ ...options, evaluator: identity }));
  return bindDomainProfile(profile, {
    prompts: Object.fromEntries(researchArtifacts.prompts.map(row => [row.id, row])),
    planValidators: { [COMPUTATIONAL_PLAN_POLICY.id]: { revision: await researchRevisionOf(COMPUTATIONAL_PLAN_POLICY), validate: validateComputationalPlan } },
    evaluators: { [identity.id]: { revision: await researchRevisionOf(identity), evaluator: captured } },
    rubrics: { [COMPUTATIONAL_RUBRIC.id]: { revision: await researchRevisionOf(COMPUTATIONAL_RUBRIC), document: COMPUTATIONAL_RUBRIC } },
    exporters: { [RESEARCH_MARKDOWN_EXPORT_POLICY.id]: { revision: await researchRevisionOf(RESEARCH_MARKDOWN_EXPORT_POLICY), render: renderMarkdownBundle } },
  });
}

export async function bindTabularResearchDomain(datasets: Readonly<Record<string, string>>) {
  const evaluator = createTabularStatisticsEvaluator({ datasets });
  return bindDomainProfile(TABULAR_STATISTICS_PROFILE, {
    prompts: Object.fromEntries([...researchArtifacts.prompts, TABULAR_CONTEXT_PROMPT].map(row => [row.id, row])),
    planValidators: { [TABULAR_PLAN_POLICY.id]: { revision: await researchRevisionOf(TABULAR_PLAN_POLICY), validate: validateTabularPlan } },
    evaluators: { [TABULAR_EVALUATOR.id]: { revision: await researchRevisionOf({ ...TABULAR_EVALUATOR, policy: TABULAR_PLAN_POLICY, rubric: TABULAR_RUBRIC }), evaluator } },
    rubrics: { [TABULAR_RUBRIC.id]: { revision: await researchRevisionOf(TABULAR_RUBRIC), document: TABULAR_RUBRIC } },
    exporters: { [RESEARCH_MARKDOWN_EXPORT_POLICY.id]: { revision: await researchRevisionOf(RESEARCH_MARKDOWN_EXPORT_POLICY), render: renderMarkdownBundle } },
  });
}
