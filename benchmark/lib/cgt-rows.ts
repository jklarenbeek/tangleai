/** Mechanical controls: lookup and retrieval receive only admitted experience. */
import { mulberry32, randomInt } from '@jarenjs/core/random';
import { createMemoryUnitStore, recallByEmbedding } from '@tangleai/memory';
import { createHashEmbedder } from '@tangleai/models/embed';
import { lookupKey, oracleCgtAnswer, parseCgtRule, questionOf, renderCgtRule, validateCgtFixture } from './cgt-fixture.ts';
import type { CgtQuestion } from './cgt-fixture.ts';
import { cgtAccuracy, observeCgtAnswer, summarizeCgt } from './cgt-scorer.ts';
import type { CgtAnswer } from './cgt-scorer.ts';
import type { CgtFixture, CgtItem, CgtRow } from './cgt.types.ts';

export const CGT_KEYLESS_ROWS = ['oracle', 'seeded-random', 'scripted-memorizer', 'scripted-retrieval', 'scripted-rule-follower'] as const;
export const CGT_LIVE_ROWS = ['frozen-none', 'frozen-retrieval', 'frozen-distilled-rule', 'active-artifact-no-retrieval', 'candidate-no-retrieval', 'candidate-retrieval'] as const;
export const CGT_ROW_IDS = [...CGT_KEYLESS_ROWS, ...CGT_LIVE_ROWS] as const;
export type CgtAnswerer = (question: CgtQuestion, experiences: readonly CgtItem[]) => CgtAnswer | Promise<CgtAnswer>;

/** This evaluator reads only its supplied document; it has no hidden-fixture reference. */
export function createCgtRuleFollower(document: string): CgtAnswerer {
  let rule: ReturnType<typeof parseCgtRule>;
  try { rule = parseCgtRule(document); } catch { return () => ({ answer: null, failure: 'refused' }); }
  return question => {
    const tokens = question.input.map(value => rule.alphabet.indexOf(value));
    if (tokens.length !== 3 || tokens.some(value => value < 0) || question.conceptIds.length < 1 || question.conceptIds.length > 2)
      return { answer: null, failure: 'refused' };
    const outputs: number[][] = [];
    for (const id of question.conceptIds) {
      const definition = rule.concepts.find(value => value.id === id);
      if (!definition) return { answer: null, failure: 'refused' };
      outputs.push(definition.positions.map(position => definition.substitution[tokens[position]]));
    }
    let index = 0;
    if (outputs.length === 1) for (let i = 0; i < 3; i++) index += outputs[0][i] * 8 ** i;
    else for (let i = 0; i < 3; i++) for (let side = 0; side < 2; side++) index += outputs[side][i] * rule.mergeWeights[i * 2 + side];
    return { answer: rule.vocabulary[rule.answerSubstitution[index % rule.vocabulary.length]] };
  };
}

export async function createCgtRetrieval(fixture: CgtFixture, fallback: ReadonlyMap<string, string>, options: { excludedIds?: readonly string[] } = {}) {
  await validateCgtFixture(fixture);
  const store = createMemoryUnitStore(), embedder = createHashEmbedder({ dims: fixture.manifest.embeddingDimensions });
  const embeddedBy = { model: embedder.model, dims: embedder.dims };
  const excluded = new Set(options.excludedIds ?? []);
  const experiences = fixture.sessions.flatMap(session => session.experiences).filter(item => !excluded.has(item.id));
  const vectors = await embedder.embed(experiences.map(lookupKey));
  for (const [i, experience] of experiences.entries()) await store.put({ id: experience.id, kind: 'fact',
    text: JSON.stringify({ key: lookupKey(experience), answer: experience.truth }), evidence: 'cgt:' + experience.id,
    at: '2026-01-01T00:00:00.000Z', tags: [fixture.manifest.scope], embedding: Array.from(vectors[i]), embeddedBy });
  const units = (await store.list()).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const queryVectors = await embedder.embed(fixture.questions.map(lookupKey));
  const queries = new Map(fixture.questions.map((query, i) => [query.id, queryVectors[i]]));
  const counters = { queries: 0, returned: 0, skipped: 0 };
  const answer: CgtAnswerer = (question, available) => {
    const admitted = new Set(available.map(value => value.id)), vector = queries.get(question.id);
    if (!vector) return { answer: null, failure: 'refused' };
    const recalled = recallByEmbedding(units.filter(unit => admitted.has(unit.id)), vector,
      { k: fixture.manifest.retrievalK, minScore: 0, identity: embeddedBy });
    counters.queries++; counters.returned += recalled.ranked.length; counters.skipped += recalled.skipped;
    const exact = recalled.ranked.map(({ unit }) => JSON.parse(unit.text) as { key: string; answer: string })
      .find(value => value.key === lookupKey(question));
    return { answer: exact?.answer ?? fallback.get(question.id) ?? null, retrievedIds: recalled.ranked.map(({ unit }) => unit.id) };
  };
  return { answer, counters, store, embeddedBy };
}

export async function measureCgtRows(fixture: CgtFixture, options: {
  answerers?: Partial<Record<typeof CGT_KEYLESS_ROWS[number], CgtAnswerer>>;
  onRow?: (id: CgtRow['rowId']) => void;
} = {}): Promise<CgtRow[]> {
  await validateCgtFixture(fixture);
  const random = mulberry32(fixture.manifest.seed + 1), vocabulary = fixture.rule.vocabulary;
  // One draw per query, shared by every prefix and both lookup fallbacks.
  const randomAnswers = new Map(fixture.questions.map(query => [query.id, vocabulary[randomInt(random, 0, vocabulary.length)]]));
  const retrieval = await createCgtRetrieval(fixture, randomAnswers);
  const answerers: Record<typeof CGT_KEYLESS_ROWS[number], CgtAnswerer> = {
    oracle: question => ({ answer: oracleCgtAnswer(fixture.rule, question) }),
    'seeded-random': question => ({ answer: randomAnswers.get(question.id) }),
    'scripted-memorizer': (question, experiences) => ({ answer: experiences.find(value => lookupKey(value) === lookupKey(question))?.truth ?? randomAnswers.get(question.id) }),
    'scripted-retrieval': retrieval.answer,
    'scripted-rule-follower': createCgtRuleFollower(renderCgtRule(fixture.rule)),
    ...options.answerers,
  };
  const experiences = fixture.sessions.flatMap(session => session.experiences);
  const shared = { experienceBudget: experiences.length, retrievalK: fixture.manifest.retrievalK,
    seeds: { fixture: fixture.manifest.seed, random: fixture.manifest.seed + 1 }, cost: null, training: null };
  const rows: CgtRow[] = [];
  for (const rowId of CGT_KEYLESS_ROWS) {
    options.onRow?.(rowId);
    const answerer = answerers[rowId];
    const observe = async (item: CgtItem, available: CgtItem[]) => {
      let result: CgtAnswer;
      try { result = await answerer(questionOf(item), structuredClone(available)); }
      catch { result = { answer: null, failure: 'refused' }; }
      return observeCgtAnswer(item, result, vocabulary);
    };
    const observations = [];
    for (const item of fixture.questions) observations.push(await observe(item, experiences));
    const bySession: CgtRow['bySession'] = [];
    for (const session of fixture.sessions) {
      const available = fixture.sessions.filter(value => value.ordinal <= session.ordinal).flatMap(value => value.experiences);
      const measured = [];
      for (const item of fixture.questions.filter(value => value.partition === 'novel')) measured.push(await observe(item, available));
      bySession.push({ session: session.ordinal, experienceBudget: available.length, cgc: cgtAccuracy(measured), observations: measured });
    }
    rows.push({ rowId, tier: rowId === 'oracle' ? 'oracle' : rowId === 'seeded-random' ? 'analytic' : 'scripted', status: 'run', reason: null,
      ...shared, ...summarizeCgt(observations), bySession, observations, retrieval: rowId === 'scripted-retrieval' ? { ...retrieval.counters } : null });
  }
  for (const rowId of CGT_LIVE_ROWS) rows.push({ rowId, tier: 'live', status: 'not-run', reason: 'No live executor or trained artifact; no provider request made.',
    ...shared, sampleCount: { exactPair: 0, paraphrase: 0, novel: 0, retention: 0 }, cgc: null, seenPair: null, paraphrase: null, retention: null,
    failures: { unanswered: 0, malformed: 0, rateLimited: 0, refused: 0 }, bySession: [], observations: [], retrieval: null });
  return rows;
}
