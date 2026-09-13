/** Corpus boundary to public temporal records. Evaluator data is never an argument. */
import { createSourceOccurrence, temporalStamp, temporalValue, type SourceOccurrence, type Knowledge } from '@tangleai/memory/temporal';
import { validateLmeRuntime, type LmeRuntimeQuestion } from './longmemeval.ts';
export async function materializeLongMemEval(runtime: LmeRuntimeQuestion) {
  if (!validateLmeRuntime(runtime)) throw Error('invalid or privileged LongMemEval runtime view');
  const sources: SourceOccurrence[] = [], runtimeIds: Record<string, string> = {};
  for (const occurrence of runtime.occurrences) {
    const source = temporalValue(await createSourceOccurrence({ scope: runtime.scope, sessionOrdinal: occurrence.sessionOrdinal, turnOrdinal: occurrence.turnOrdinal,
      role: occurrence.role, text: occurrence.text, sourceLocator: `longmemeval:${occurrence.sessionId}:${occurrence.turnOrdinal}`,
      observedAt: temporalValue(temporalStamp(occurrence.observed.at, { raw: occurrence.observed.raw, precision: 'minute', offsetMinutes: 0, provenance: 'synthetic-UTC' })), knownAt: occurrence.knownAt }));
    sources.push(source); runtimeIds[source.id] = occurrence.id;
  }
  const knowledge: Knowledge = runtime.profile === 'provided-history' ? { mode: 'provided-history' } : { mode: 'strict-as-of', cutoff: runtime.anchor.at };
  return { sources, runtimeIds, knowledge, sourceIdentity: runtime.viewId };
}
