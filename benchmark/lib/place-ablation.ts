/** Paired correctness is exhaustive; observed refusals are overlapping subsets. */
import { createHashEmbedder } from '@tangleai/models/embed';
import type { Ablation, AblationPair, Report } from './place-report.types.ts';

export function placeAblation(report: Pick<Report, 'registration' | 'census' | 'rows'>): Ablation {
  const { registration, rows, census } = report;
  const embedder = createHashEmbedder({ dims: registration.dims });
  const methods = [['meaning-time', 'meaning-only'], ['meaning-time-place', 'meaning-only'], ['meaning-time-place', 'meaning-time']] as const;
  const pairs = methods.flatMap(([left, right]) => (Object.keys(census.byKind) as AblationPair['kind'][]).map(kind => {
    const l = rows.filter(row => row.row === left && row.backend === 'memory' && row.kind === kind);
    const r = new Map(rows.filter(row => row.row === right && row.backend === 'memory' && row.kind === kind).map(row => [row.questionId, row]));
    const pair: AblationPair = { left, right, backend: 'memory', kind,
      comparison: ['movement-distance', 'nearby', 'false-proximity'].includes(kind) ? 'structural' : 'paired-exactness',
      questions: census.byKind[kind], paired: 0, unpaired: 0, wins: 0, losses: 0, ties: 0, refusedLeft: 0, refusedRight: 0 };
    for (const a of l) {
      const b = r.get(a.questionId);
      if (a.status !== 'measured' || b?.status !== 'measured') continue;
      if (a.projectionId !== b.projectionId) throw Error('place ablation projection differs between paired methods');
      pair.paired++;
      if (a.passed === b.passed) pair.ties++; else if (a.passed) pair.wins++; else pair.losses++;
      if (a.actual && 'refused' in a.actual) pair.refusedLeft++;
      if (b.actual && 'refused' in b.actual) pair.refusedRight++;
    }
    pair.unpaired = pair.questions - pair.paired;
    return pair;
  }));
  return { embeddedBy: { model: embedder.model, dims: embedder.dims }, candidatePool: registration.candidatePool,
    k: registration.k, minScore: registration.minScore,
    projectionIds: [...new Set(rows.flatMap(row => row.projectionId === null ? [] : [row.projectionId]))].sort(), pairs };
}
