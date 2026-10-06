/** Resolve exact host capabilities before creating any model request or execution. */
import { equalsJson } from '@jarenjs/core/object';
import { isThenable } from '@jarenjs/core/function';
import { validateGmplPromptArtifact, type GmplPromptArtifact } from '@tangleai/gmpl';
import type { ExperimentPlan, ResearchContract, ResearchDomainProfile, ResearchDomainBindingManifest, ResearchIssue } from '../contracts.gen.ts';
import type { ResearchEvaluator } from '../execution/registry.ts';
import type { ResearchExecutionPolicy } from '../execution-contract.ts';
import { researchExecutionRevisionOf } from '../execution-contract.ts';
import { RESEARCH_EXECUTOR_CONTRACT } from '../execution/executor.ts';
import type { renderMarkdownBundle } from '../export/markdown.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';
import { validateDomainProfile } from './profile.ts';

export interface ResearchDomainBindings<Labels = unknown> {
  prompts: Readonly<Record<string, GmplPromptArtifact>>;
  planValidators: Readonly<Record<string, { revision: string; validate(contract: ResearchContract, plan: ExperimentPlan): ResearchIssue[] }>>;
  evaluators: Readonly<Record<string, { revision: string; evaluator: ResearchEvaluator<Labels> }>>;
  rubrics: Readonly<Record<string, { revision: string; document: unknown }>>;
  exporters: Readonly<Record<string, { revision: string; render: typeof renderMarkdownBundle }>>;
}
export interface BoundDomainProfile<Labels = unknown> {
  profile: ResearchDomainProfile;
  manifest: ResearchDomainBindingManifest;
  prompts: readonly GmplPromptArtifact[];
  rubric: unknown;
  evaluator: ResearchEvaluator<Labels>;
  export: typeof renderMarkdownBundle;
  validatePlan(contract: ResearchContract, plan: ExperimentPlan): ResearchOutcome<null>;
}
export type ResearchStageDomain = Pick<BoundDomainProfile, 'profile' | 'manifest' | 'validatePlan' | 'prompts' | 'rubric' | 'export'>;
const admitted = new WeakSet<object>();
const refusal = (path: string, detail: string, cause?: unknown) => researchRefuse('TRSH2008', path,
  detail + ' Model calls: 0; runner invocations: 0 at binding.', cause);
export function isBoundDomainProfile(value: unknown): value is BoundDomainProfile {
  return typeof value === 'object' && value !== null && admitted.has(value);
}

export async function bindDomainProfile<Labels>(input: unknown, supplied: ResearchDomainBindings<Labels>): Promise<ResearchOutcome<BoundDomainProfile<Labels>>> {
  let bindings: ResearchDomainBindings<Labels>;
  try {
    // Capture values and callable references before the first asynchronous hash.
    bindings = {
      prompts: immutableResearchJson(supplied.prompts), rubrics: immutableResearchJson(supplied.rubrics),
      planValidators: Object.fromEntries(Object.entries(supplied.planValidators).map(([id, row]) => [id, { revision: row.revision, validate: row.validate }])),
      evaluators: Object.fromEntries(Object.entries(supplied.evaluators).map(([id, row]) => [id, { revision: row.revision,
        evaluator: { id: row.evaluator.id, version: row.evaluator.version, evaluate: row.evaluator.evaluate } }])),
      exporters: Object.fromEntries(Object.entries(supplied.exporters).map(([id, row]) => [id, { revision: row.revision, render: row.render }])),
    };
  } catch (cause) { return refusal('/bindings', 'Host capability registries are incomplete or malformed.', cause); }
  const checked = await validateDomainProfile(input); if (!checked.valid) return checked;
  const profile = checked.value;
  if (profile.runnerManifestTemplate.executorContractHash !== await researchRevisionOf(RESEARCH_EXECUTOR_CONTRACT))
    return refusal('/runnerManifestTemplate', 'The profile does not bind the shipped executor contract.');
  const prompts: GmplPromptArtifact[] = [];
  for (const reference of profile.bindingRevisions) {
    const path = '/bindings/' + reference.kind + '/' + reference.id;
    if (reference.kind === 'prompt') {
      const value = Object.hasOwn(bindings.prompts, reference.id) ? bindings.prompts[reference.id] : null;
      if (!value || value.id !== reference.id || value.revision !== reference.revision) return refusal(path, 'Missing or revision-mismatched prompt.');
      const prompt = await validateGmplPromptArtifact(value);
      if (!prompt.valid) return refusal(path, 'The prompt artifact does not reproduce.', prompt.issues[0]);
      prompts.push(prompt.value);
    } else if (reference.kind === 'plan-validator') {
      const value = Object.hasOwn(bindings.planValidators, reference.id) ? bindings.planValidators[reference.id] : null;
      if (!value || value.revision !== reference.revision || typeof value.validate !== 'function') return refusal(path, 'Missing or revision-mismatched plan validator.');
    } else if (reference.kind === 'evaluator') {
      const value = Object.hasOwn(bindings.evaluators, reference.id) ? bindings.evaluators[reference.id] : null;
      if (!value || value.revision !== reference.revision || value.evaluator.id !== profile.evaluatorId
        || value.evaluator.version !== profile.evaluatorVersion || typeof value.evaluator.evaluate !== 'function')
        return refusal(path, 'Missing or revision-mismatched evaluator.');
    } else if (reference.kind === 'rubric') {
      const value = Object.hasOwn(bindings.rubrics, reference.id) ? bindings.rubrics[reference.id] : null;
      if (!value || value.revision !== reference.revision || await researchRevisionOf(value.document) !== reference.revision)
        return refusal(path, 'Missing or revision-mismatched rubric.');
    } else {
      const value = Object.hasOwn(bindings.exporters, reference.id) ? bindings.exporters[reference.id] : null;
      if (!value || value.revision !== reference.revision || typeof value.render !== 'function') return refusal(path, 'Missing or revision-mismatched exporter.');
    }
  }
  const validators = profile.planValidatorIds.map(id => bindings.planValidators[id].validate);
  const value: BoundDomainProfile<Labels> = Object.freeze({ profile,
    manifest: immutableResearchJson({ profileId: profile.id, profileRevision: profile.revision, bindings: profile.bindingRevisions }),
    prompts: Object.freeze(prompts), rubric: bindings.rubrics[profile.rubricId].document,
    evaluator: Object.freeze(bindings.evaluators[profile.evaluatorId].evaluator), export: bindings.exporters[profile.exportTemplateId].render,
    validatePlan(rawContract: ResearchContract, rawPlan: ExperimentPlan): ResearchOutcome<null> {
      const contract = validateResearchShape<ResearchContract>('ResearchContract', rawContract), plan = validateResearchShape<ExperimentPlan>('ExperimentPlan', rawPlan);
      if (!contract.valid) return contract; if (!plan.valid) return plan;
      if (!equalsJson(plan.value.evaluator, { id: profile.evaluatorId, version: profile.evaluatorVersion })
        || contract.value.metrics.some(metric => !profile.units.some(unit => metric.id === unit.metricId && metric.unit === unit.unit && metric.direction === unit.direction)))
        return refusal('/plan', 'The preregistered evaluator, metric unit or direction differs from the bound profile.');
      for (const [i, validate] of validators.entries()) {
        let result: unknown;
        try {
          result = validate(contract.value, plan.value);
          if (isThenable(result)) {
            // Refuse synchronously, while observing a rejected host promise.
            void Promise.resolve(result).then(() => undefined, () => undefined);
            return refusal('/planValidators/' + profile.planValidatorIds[i], 'A plan validator must return synchronous issue values.');
          }
        } catch (cause) { return refusal('/planValidators/' + profile.planValidatorIds[i], 'The independent plan validator failed.', cause); }
        if (!Array.isArray(result))
          return refusal('/planValidators/' + profile.planValidatorIds[i], 'A plan validator must return synchronous issue values.');
        const issues: ResearchIssue[] = [];
        for (const raw of result) {
          const issue = validateResearchShape<ResearchIssue>('ResearchIssue', raw);
          if (!issue.valid) return refusal('/planValidators/' + profile.planValidatorIds[i], 'The plan validator returned an invalid issue.');
          issues.push(issue.value);
        }
        if (issues.length) return { valid: false, issues };
      }
      return { valid: true, value: null };
    },
  });
  admitted.add(value); return { valid: true, value };
}

/** Fill only host-owned placeholders, then consume the existing execution-policy validator. */
export async function domainExecutionPolicy<Labels>(bound: BoundDomainProfile<Labels>, fields: Pick<ResearchExecutionPolicy,
  'imageDigest' | 'dependencyLockHash' | 'datasetPaths' | 'codeFiles'>): Promise<ResearchOutcome<ResearchExecutionPolicy>> {
  if (!isBoundDomainProfile(bound)) return refusal('/profile', 'Execution needs an admitted domain binding.');
  try {
    if (!equalsJson(Object.keys(fields).sort(), ['codeFiles', 'datasetPaths', 'dependencyLockHash', 'imageDigest']))
      return refusal('/runnerManifestTemplate', 'Execution placeholders have exactly the four host-owned fields.');
    const template = bound.profile.runnerManifestTemplate;
    const policy = immutableResearchJson({ ...fields, mode: template.mode, resources: template.resources,
      maxSeeds: template.maxSeeds, maxConditions: template.maxConditions });
    await researchExecutionRevisionOf(policy);
    return { valid: true, value: policy };
  } catch (cause) { return refusal('/runnerManifestTemplate', 'Host placeholders do not produce an admitted execution policy.', cause); }
}
