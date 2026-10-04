/** Read-only native toolbox; invocation scope is supplied out of band by MAS. */
import type { MasHostBindings, MasRegistry, MasStore } from '@tangleai/mas';
import { masRevisionOf } from '@tangleai/mas';
import type { ResearchStore } from './store.ts';
import type { ResearchContract } from './contracts.gen.ts';
import { researchSchemaOf } from './schema.ts';
import { researchFrameInputs } from './manifest.ts';
import { researchFail, researchValue } from './workflow-contract.ts';
import { researchPreparationFor } from './reasoning-contract.ts';
import { readResearchReasoningInputs } from './reasoning-records.ts';
import { createResearchHypotheses } from './stages/hypothesis.ts';
import { resolveResearchFrame } from './frames.ts';

export const RESEARCH_READ_TOOLS = ['read_cards', 'read_synthesis', 'propose_hypotheses'] as const;
export async function researchToolDeclarations(): Promise<MasRegistry['tools']> {
  return Promise.all(RESEARCH_READ_TOOLS.map(async id => {
    const input = id === 'propose_hypotheses' ? researchSchemaOf('HypothesisSetProposal') : { type: 'object', properties: {}, additionalProperties: false };
    return { id, title: id === 'propose_hypotheses' ? 'Validate an evidence-linked proposal without storing or approving it.' : 'Read the admitted ' + id.slice(5) + '.',
      effect: 'pure' as const, input, inputRevision: await masRevisionOf(input) };
  }));
}
export function createResearchReadTools(options: { researchStore: ResearchStore; masStore: Pick<MasStore, 'readTrace'>;
  maxCards: number; contract: ResearchContract; mode: 'single-agent' | 'debate' }): MasHostBindings['toolBindings'] {
  return Object.fromEntries(RESEARCH_READ_TOOLS.map(name => [name, { handler: async (input, context) => {
    if (!context.invocation) researchFail('TRSH1005', '/invocation', 'Research tools require a native invocation scope.');
    const preparation = await researchPreparationFor(options.masStore, context.invocation), frame = await resolveResearchFrame(options.researchStore, preparation.frame);
    const snapshot = researchValue(await options.researchStore.snapshot(frame.projectId));
    if (!snapshot || snapshot.state.revision !== preparation.stateRevision || snapshot.state.status !== frame.status)
      researchFail('TRSH1004', '/invocation', 'The prepared research stage is no longer current.');
    const admitted = async (ref: { artifactId: string; admissionId: string }) => {
      if (!researchFrameInputs(frame).some(row => row.admissionId === ref.admissionId && row.artifactId === ref.artifactId)
        || !snapshot.committedAdmissionIds.includes(ref.admissionId)) researchFail('TRSH1005', '/artifact', 'Read is outside the prepared manifest.');
      const row = researchValue(await options.researchStore.readArtifact(frame.projectId, ref.admissionId));
      if (row.admission.artifact.id !== ref.artifactId) researchFail('TRSH1002', '/artifact', 'Admitted bytes differ from the requested address.');
      return row;
    };
    const visible = await readResearchReasoningInputs({ frame }, { signal: context.signal,
      readArtifact: async ref => (await admitted(ref)).bytes, describeArtifact: async ref => (await admitted(ref)).admission.artifact }, options.maxCards);
    if (name === 'read_cards') return { cards: visible.cards, available: visible.availableCards };
    if (name === 'read_synthesis') return { synthesis: visible.synthesis };
    if (!visible.synthesis) researchFail('TRSH1003', '/synthesis', 'A hypothesis proposal requires an admitted synthesis.');
    return createResearchHypotheses(visible.synthesis, input, visible.cards, options.contract.requiredBaselines.map(row => row.condition), options.mode);
  } } satisfies MasHostBindings['toolBindings'][string]]));
}
