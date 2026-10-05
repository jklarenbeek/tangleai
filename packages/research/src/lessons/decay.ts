import type { DecayHypothesis, ResearchLessonV2 } from '../contracts.gen.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { immutableResearchJson } from '../identity.ts';
import { validateResearchShape } from '../schema.ts';

/** Registered hypotheses; weights were fixed before any lessons-on measurement. */
export const DECAY_HYPOTHESES: readonly DecayHypothesis[] = immutableResearchJson<DecayHypothesis[]>([
  { id: 'none', kind: 'none', parameters: {}, revision: 'e6cfea0216bfe3fc391819c178cc938d9b947b2c69c5995c5a1b88da3de91a63' },
  { id: 'age-linear', kind: 'age-linear', parameters: { horizon: 4, severityWeights: { low: 1, medium: 1, high: 1 } },
    revision: 'c5c22df675c0a8fcfcf773ea3482d67fc0e97aa1da91fd8a6d8c16e81732cc3b' },
  { id: 'severity-weighted-age', kind: 'severity-weighted-age', parameters: { horizon: 4, severityWeights: { low: .25, medium: .5, high: 1 } },
    revision: '3ee717f8ea9e87a69585d297b22ec86f825d75c3d1de160510545f4adcbdbf76' },
]);

export function lessonDecayWeight(lesson: ResearchLessonV2, hypothesisId: string, runId: string): ResearchOutcome<number> {
  const shape = validateResearchShape<ResearchLessonV2>('ResearchLessonV2', lesson);
  if (!shape.valid) return researchRefuse('TRSH2001', '/lesson', 'Decay requires a valid lesson record.', shape.issues[0]);
  lesson = shape.value;
  if (!validateResearchShape('ResearchId', runId).valid)
    return researchRefuse('TRSH2004', '/runId', 'Decay requires the actual target run identity.');
  const hypothesis = DECAY_HYPOTHESES.find(row => row.id === hypothesisId);
  if (!hypothesis) return researchRefuse('TRSH2011', '/decayHypothesisId', 'The decay hypothesis is not registered.');
  if (hypothesis.kind === 'none') return { valid: true, value: 1 };
  const observations = lesson.decay.relevanceRows.filter(row => row.runId === runId);
  if (observations.length !== 1) return researchRefuse('TRSH2004', '/decay/relevanceRows', 'Decay needs one retained relevance observation for this run.');
  const observation = observations[0];
  const weight = observation.relevance * Math.max(0, 1 - observation.age / hypothesis.parameters.horizon);
  return { valid: true, value: weight * (hypothesis.kind === 'severity-weighted-age' ? hypothesis.parameters.severityWeights[lesson.severity] : 1) };
}
