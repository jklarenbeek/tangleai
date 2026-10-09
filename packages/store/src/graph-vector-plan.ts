/** Narrow native explain once; a column declaration alone is never a rank proof. */
import { immutableLightRagJson, type LightRagEmbeddedBy } from '@tangleai/lightrag';
import { GraphVectorRefusal } from './graph-vector-model.ts';

export interface GraphVectorPlanProof {
  mode: 'knn';
  dims: number;
  column: string;
  explain: unknown;
}
export function graphVectorRankQuery(identity: LightRagEmbeddedBy, limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('A native graph rank requires a positive bounded window.');
  return { $subsequence: [{ $for: { r: '$[*]' }, $where: { $and: [
    { $eq: ['$r.status', 'active'] }, { $eq: ['$r.payload.embeddedBy.model', { $const: identity.model }] },
    { $eq: ['$r.payload.embeddedBy.dims', identity.dims] },
  ] }, $orderby: [{ $key: { $similarity: ['$r.payload.embedding', '$q'] }, $dir: 'desc', $empty: 'least' }, '$r.id'], $return: '$r' }, 0, limit] };
}
export function verifyVectorPlan(explain: unknown, dims: number): GraphVectorPlanProof {
  const plan = explain as { mode?: unknown; rank?: { selected?: unknown; decides?: unknown;
    alternatives?: Array<{ column?: unknown; dims?: unknown }> }; residual?: { mode?: unknown; reasons?: Array<{ construct?: unknown }> } } | null;
  const column = 'gx_payload_embedding_v' + dims;
  if (!Number.isSafeInteger(dims) || dims < 1 || dims > 8192 || plan?.mode !== 'knn'
    || plan.rank?.selected !== dims || plan.rank.decides !== 'engine'
    || !Array.isArray(plan.rank.alternatives) || !plan.rank.alternatives.some(row => row && row.dims === dims && row.column === column)
    || plan.residual?.mode !== 'knn' || !Array.isArray(plan.residual.reasons) || plan.residual.reasons.length !== 1
    || plan.residual.reasons[0]?.construct !== '$orderby')
    throw new GraphVectorRefusal('TVEC1002', 'The native graph plan must prove the declared column and only rank residual work.');
  return immutableLightRagJson({ mode: 'knn', dims, column, explain });
}
