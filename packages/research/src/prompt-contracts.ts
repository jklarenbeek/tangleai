/** Shared content contracts for the build and immutable installed prompt catalog. */
import { createGmplDomainBinding, gmplSchemaOf, gmplSchemaDefinition, type GmplPromptArtifact, type GmplVariables } from '@tangleai/gmpl';
import { cloneJson } from '@jarenjs/core/object';
import { researchSchemaOf, researchSchema } from './schema.ts';

export const RESEARCH_PROMPT_NAMES = ['synthesis', 'innovator', 'pragmatist', 'contrarian', 'synthesizer', 'designer', 'screener', 'result-reviewer', 'result-summarizer', 'writer', 'critic', 'attacker', 'defender', 'judge'] as const;
export type ResearchPromptName = typeof RESEARCH_PROMPT_NAMES[number];
export type ResearchPatternPurpose = 'synthesis' | 'hypothesis' | 'result-review' | 'draft-peer-review' | 'draft-red-team';
export const RESEARCH_PROMPT_VARIABLES: GmplVariables = {
  question: { schema: { type: 'string', minLength: 1 }, render: 'text' },
  cards: { schema: { type: 'array', items: gmplSchemaOf('gmplEvidenceUnit') }, render: 'json' },
  synthesis: { schema: { anyOf: [researchSchemaOf('Synthesis'), { type: 'array', items: researchSchemaOf('ResearchHypothesis') }, { type: 'null' }] }, render: 'json' },
  constraints: { schema: researchSchemaOf('ResearchReasoningConstraints'), render: 'json' },
};
export const RESEARCH_WRITER_VARIABLES: GmplVariables = {
  ledger_id: { schema: { type: 'string', minLength: 1 }, render: 'text' },
};
export const researchPromptVariables = (name: ResearchPromptName): GmplVariables => name === 'writer' ? RESEARCH_WRITER_VARIABLES : RESEARCH_PROMPT_VARIABLES;
export const researchProposalSchema = (name: ResearchPromptName) => name === 'writer' ? researchSchemaOf('ResearchDraftProposal')
  : name.startsWith('result-') || ['critic', 'attacker', 'defender', 'judge'].includes(name) ? gmplSchemaOf('gmplPatternResult') : researchSchemaOf(name === 'synthesis' ? 'SynthesisProposal'
  : name === 'designer' ? 'ResearchDesignProposal' : 'HypothesisSetProposal');
export const RESEARCH_NATIVE_PROMPTS = [
  ['synthesis', 'analysis-analyst'], ['synthesis', 'analysis-merge'],
  ['innovator', 'debate-position'], ['pragmatist', 'debate-position'], ['contrarian', 'debate-position'],
  ['innovator', 'debate-rebuttal'], ['pragmatist', 'debate-rebuttal'], ['contrarian', 'debate-rebuttal'],
  ['screener', 'debate-judge'], ['synthesizer', 'analysis-merge'],
  ['result-reviewer', 'peer-review-review'], ['result-summarizer', 'peer-review-revision'],
  ['critic', 'peer-review-review'], ['critic', 'peer-review-revision'],
  ['attacker', 'red-team-attack'], ['defender', 'red-team-defense'], ['defender', 'peer-review-revision'], ['judge', 'red-team-resilience'],
] as const;
export function researchRolePrompts(purpose: ResearchPatternPurpose): Record<string, string> {
  if (purpose === 'draft-peer-review') return { 'peer-review-review': 'research-critic-peer-review-review',
    'peer-review-revision': 'research-critic-peer-review-revision' };
  if (purpose === 'draft-red-team') return { 'red-team-attack': 'research-attacker-red-team-attack',
    'red-team-defense': 'research-defender-red-team-defense', 'red-team-resilience': 'research-judge-red-team-resilience',
    'peer-review-revision': 'research-defender-peer-review-revision' };
  if (purpose === 'result-review') return { 'peer-review-review': 'research-result-reviewer-peer-review-review',
    'peer-review-revision': 'research-result-summarizer-peer-review-revision' };
  if (purpose === 'synthesis') return { 'analysis-analyst': 'research-synthesis-analysis-analyst', 'analysis-merge': 'research-synthesis-analysis-merge' };
  return { 'debate-position': 'research-innovator-debate-position', 'debate-rebuttal': 'research-innovator-debate-rebuttal',
    ...Object.fromEntries(['innovator', 'pragmatist', 'contrarian'].flatMap((name, i) => ['position', 'rebuttal'].map(stage =>
      [`debate-${stage}-${i + 1}`, `research-${name}-debate-${stage}`]))),
    'debate-judge': 'research-screener-debate-judge', 'analysis-merge': 'research-synthesizer-analysis-merge' };
}
export function defineResearchDomainBinding(purpose: ResearchPatternPurpose, prompts: readonly GmplPromptArtifact[]) {
  const payloadSchema = cloneJson(gmplSchemaOf('gmplInput')) as { properties: Record<string, unknown>; required: string[] };
  const scoped = cloneJson(researchSchema);
  (scoped.$defs.ResearchReasoningContext.properties as Record<string, unknown>).stage = { const: purpose };
  // Project the owner before resolving references: unused design definitions must
  // not be copied into every native round state or expand participant authority.
  Reflect.deleteProperty(scoped.$defs.ResearchReasoningConstraints.properties, 'design');
  const context = gmplSchemaDefinition(scoped, 'ResearchReasoningContext', 'https://tangleai.dev/schemas/research-context/' + purpose);
  payloadSchema.properties.payload = purpose.startsWith('draft-') ? { type: 'object', additionalProperties: false,
    properties: { draftId: { type: 'string', minLength: 1 }, ledgerId: { type: 'string', minLength: 1 } }, required: ['draftId', 'ledgerId'] }
    : purpose === 'result-review' ? { type: 'object', additionalProperties: false,
    properties: { analysisId: { type: 'string' }, analystIdentityId: { type: 'string' }, reviewerIdentityId: { type: 'string' } },
    required: ['analysisId', 'analystIdentityId', 'reviewerIdentityId'] } : context;
  payloadSchema.required.push('payload');
  const rolePrompts = researchRolePrompts(purpose);
  const requiredCapabilities = [...new Set(Object.values(rolePrompts))].map(id => {
    const artifact = prompts.find(prompt => prompt.id === id);
    if (!artifact) throw new TypeError('Research role artifact is unavailable: ' + id);
    return { id: 'gmpl-' + id, version: artifact.revision };
  });
  return createGmplDomainBinding({ id: 'research-' + purpose, title: 'Evidence-bound research ' + purpose,
    payloadSchema, projection: { id: 'research-proposal', version: '1', kind: 'text', scale: null }, rolePrompts, requiredCapabilities });
}
