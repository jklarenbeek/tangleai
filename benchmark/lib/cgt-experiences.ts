/** Observed CGT sessions become experiences; withheld questions remain references. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { sealExperientialRecord, type ExperientialExperience, type ExperientialTrustView,
  type ExperientialEvaluationReferences, type ExperientialExampleVariables } from '@tangleai/experiential';
import { validateCgtFixture } from './cgt-fixture.ts';
import type { CgtFixture } from './cgt.types.ts';

export async function experiencesFromCgt(fixture: CgtFixture, sessions: number, recordedAt = '2026-09-13T00:00:00.000Z') {
  const stable = structuredClone(fixture);
  await validateCgtFixture(stable);
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > stable.sessions.length) throw new RangeError('CGT observation horizon is outside its registered sessions.');
  const scope = stable.manifest.scope, producer = { identityId: await canonicalSha256({ fixtureId: stable.fixtureId, producer: 'cgt-observation' }), producerId: 'cgt-observer' };
  const trustView: ExperientialTrustView = { sources: [], producers: [producer] };
  const experiences: ExperientialExperience[] = [], examples: ExperientialExampleVariables[] = [];
  const concepts: Record<string, string[]> = {}, itemIds: Record<string, string> = {};
  for (const session of stable.sessions.filter(session => session.ordinal <= sessions)) {
    const episode = { sourceId: session.id, digest: await canonicalSha256(session), kind: 'episode' };
    trustView.sources.push({ ...episode, scope, producerId: 'cgt-fixture-host', trust: 'verified', privacy: 'public', parents: [], outcome: null });
    for (const item of session.experiences) {
      const contentDigest = await canonicalSha256({ question: item.question, answer: item.truth });
      const outcome = { sourceId: 'cgt-oracle-' + item.id, digest: await canonicalSha256({ fixtureId: stable.fixtureId, itemId: item.id, truth: item.truth }), kind: 'independent-outcome' };
      trustView.sources.push({ ...outcome, scope, producerId: 'cgt-independent-oracle', trust: 'verified', privacy: 'public', parents: [], outcome: { contentDigest, value: 1 } });
      const sealed = await sealExperientialRecord('experience', { document: 'experiential-experience', schemaVersion: 1, scope, recordedAt,
        taskRef: episode, inputRef: episode, outputRef: episode, sourceRefs: [episode],
        observedOutcome: { kind: 'outcome', sourceId: outcome.sourceId, digest: outcome.digest, value: 1 },
        producingIdentityId: producer.identityId, trust: 'verified', privacy: 'public', state: 'observed', contentDigest });
      if (!sealed.ok) throw Error('CGT observation refused: ' + JSON.stringify(sealed.issues));
      experiences.push(sealed.value); concepts[sealed.value.id] = [...item.conceptIds]; itemIds[sealed.value.id] = item.id;
      examples.push({ experienceId: sealed.value.id, question: item.question, answer: item.truth });
    }
  }
  const evaluationReferences: ExperientialEvaluationReferences = { compositionalHoldout: [], replay: [] };
  for (const item of stable.questions) if (item.partition === 'novel' || item.partition === 'retention') {
    const partition = item.partition === 'novel' ? 'compositionalHoldout' : 'replay';
    evaluationReferences[partition].push({ id: item.id, digest: await canonicalSha256(item), scope,
      partition: partition === 'replay' ? 'replay' : 'compositional-holdout', conceptIds: [...item.conceptIds], experienceIds: [...item.experienceIds] });
  }
  return { experiences, trustView, examples, concepts, itemIds, evaluationReferences, fixtureId: stable.fixtureId, sessions };
}
