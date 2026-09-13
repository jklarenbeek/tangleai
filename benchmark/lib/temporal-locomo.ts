/** Optional LoCoMo comparison envelope; canonical reports omit it entirely. */
import { analyzeTemporalPairs, type TemporalPairScore, type TemporalPairIdentity } from './temporal-analysis.ts';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { sha256 } from './longmemeval-source.ts';
export interface TemporalLocomoBlock {
  profile: 'canonical-unanchored'; metric: 'locomo-f1' | 'evidence-recall'; datasetHash: string; sourceIdentity: string; registrationHash: string;
  pairs: TemporalPairScore[]; expected: TemporalPairIdentity[]; analysis: ReturnType<typeof analyzeTemporalPairs>; sha256: string;
}
export function temporalLocomoComparison(input: Omit<TemporalLocomoBlock, 'profile' | 'analysis' | 'sha256'>): TemporalLocomoBlock {
  const body = { ...input, profile: 'canonical-unanchored' as const, analysis: analyzeTemporalPairs(input.pairs,input.expected) };
  return { ...body, sha256: sha256(canonicalizeJson(body)) };
}
export function renderTemporalLocomo(block: TemporalLocomoBlock, datasetHash: string): string {
  const { sha256: hash, analysis, profile, ...input } = block;
  if (profile !== 'canonical-unanchored' || datasetHash !== block.datasetHash || canonicalizeJson(temporalLocomoComparison(input)) !== canonicalizeJson(block)) throw Error('LoCoMo temporal comparison identity or paired evidence changed');
  return ['','## Optional temporal comparison','', `Metric: ${block.metric}; profile: ${profile}; registration: \`${block.registrationHash}\`; source: \`${block.sourceIdentity}\`; comparison: \`${hash}\`.`, '',
    'Canonical questions have no QA anchor. This block adds an explicitly registered paired comparison without changing the original corpus, scorer or rows.', '',
    `Expected questions: ${analysis.expectedQuestions}; complete pairs: ${analysis.pairedQuestions}; independent groups: ${analysis.groups}; delta: ${analysis.delta ?? 'unmeasured'}; two-sided 95% interval: ${analysis.low ?? 'unmeasured'} to ${analysis.high ?? 'unmeasured'}.`, ''].join('\n');
}
