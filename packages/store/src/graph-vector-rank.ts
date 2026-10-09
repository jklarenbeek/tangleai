/** Optional native candidate reads, with explicit plan refusals and physical statistics. */
import { equalsJson, cloneJson } from '@jarenjs/core/object';
import { isVector } from '@jarenjs/core/vector';
import type { TransactionStore } from '@jarenjs/db';
import type { LightRagRankRequest, GraphEntity, GraphRelation } from '@tangleai/lightrag';
import type { TangleDb } from './db.ts';
import { assertGraphVectorDeclaration, GraphVectorRefusal, type GraphVectorDeclaration } from './graph-vector-model.ts';
import { graphVectorRankQuery, verifyVectorPlan, type GraphVectorPlanProof } from './graph-vector-plan.ts';
import { readGraphVectorState } from './graph-vector-state.ts';

export interface GraphVectorNativeStats { queries: number; rows: number; candidates: number; fullFetches: number; diverted: number }
export interface GraphVectorRankDiagnostics {
  calls: number; native: GraphVectorNativeStats; fallback: number; refused: number; unrankable: number;
  proofs: GraphVectorPlanProof[]; refusals: Array<{ code: string; message: string }>;
}
const emptyNative = (): GraphVectorNativeStats => ({ queries: 0, rows: 0, candidates: 0, fullFetches: 0, diverted: 0 });
function stats(value: unknown): GraphVectorNativeStats {
  const knn = (value as { knn?: GraphVectorNativeStats } | null)?.knn;
  if (!knn || Object.keys(emptyNative()).some(key => !Number.isSafeInteger(knn[key as keyof GraphVectorNativeStats]) || knn[key as keyof GraphVectorNativeStats] < 0))
    throw new GraphVectorRefusal('TVEC1002', 'Native graph query statistics are unavailable.');
  return cloneJson(knn);
}
export function createGraphVectorRank(db: TangleDb | TransactionStore, declaration: GraphVectorDeclaration) {
  const declared = assertGraphVectorDeclaration(declaration);
  let observed: GraphVectorRankDiagnostics;
  const reset = () => { observed = { calls: 0, native: emptyNative(), fallback: 0, refused: 0, unrankable: 0, proofs: [], refusals: [] }; };
  reset();
  const refuse = (error: GraphVectorRefusal) => { observed.refused++; if (observed.refusals.length < 64) observed.refusals.push({ code: error.code, message: error.message }); };
  async function rank(request: LightRagRankRequest, limit?: number): Promise<Array<GraphEntity | GraphRelation> | null> {
    observed.calls++;
    const kind = request.kind, identity = declared.active;
    const vector = Array.isArray(request.vector) || request.vector instanceof Float32Array || request.vector instanceof Float64Array ? Array.from(request.vector) : [];
    if (!['entity', 'relation'].includes(kind) || !equalsJson(request.identity, identity) || !isVector(vector, identity.dims)) {
      const error = new GraphVectorRefusal('TVEC1001', 'The native graph probe differs from its declared settled identity or width.');
      refuse(error); throw error;
    }
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new TypeError('A native rank window must be positive.');
    return db.transaction(async scope => {
      const state = await readGraphVectorState(scope);
      if (state && !equalsJson(state.active, identity)) throw new GraphVectorRefusal('TVEC1001', 'The settled graph identity changed before native ranking.');
      const collection = scope.collection<{ id: string; payload: GraphEntity | GraphRelation }>(kind === 'entity' ? 'lightrag_entities' : 'lightrag_relations');
      const active = { $for: { r: '$[*]' }, $where: { $eq: ['$r.status', 'active'] }, $return: '$r' };
      const count = Number(await collection.execute({ $count: active }));
      if (!Number.isSafeInteger(count) || count < 0) throw new GraphVectorRefusal('TVEC1002', 'The active graph census is invalid.');
      const query = graphVectorRankQuery(identity, limit ?? Math.max(1, count));
      try {
        const proof = verifyVectorPlan(await collection.explain(query, { externals: { q: vector } }), identity.dims);
        if (observed.proofs.length < 64 && !observed.proofs.some(row => equalsJson(row, proof))) observed.proofs.push(proof);
      } catch (cause) {
        const error = cause instanceof GraphVectorRefusal ? cause : new GraphVectorRefusal('TVEC1002', 'Native graph planning refused.', { cause });
        refuse(error); observed.fallback++; return null;
      }
      const before = stats(collection.stats());
      const rows: Array<GraphEntity | GraphRelation> = [];
      try { for await (const row of collection.query<{ payload: GraphEntity | GraphRelation }>(query, { externals: { q: vector } })) rows.push(row.payload); }
      finally {
        const after = stats(collection.stats());
        for (const key of Object.keys(before) as Array<keyof GraphVectorNativeStats>) observed.native[key] += after[key] - before[key];
      }
      // Matching vectors and the foreign-identity rejection rows are disjoint.
      // A complete trace includes both. A caller asking for a bounded native
      // rank receives only the native window, for qualification and inspection.
      if (limit === undefined) for await (const row of collection.query<{ payload: GraphEntity | GraphRelation }>({ ...active, $where: { $and: [
        active.$where, { $not: { $and: [
          { $eq: ['$r.payload.embeddedBy.model', { $const: identity.model }] },
          { $eq: ['$r.payload.embeddedBy.dims', identity.dims] },
        ] } },
      ] } })) rows.push(row.payload);
      observed.unrankable += rows.filter(row => !equalsJson(row.embeddedBy, identity) || !isVector(row.embedding, identity.dims)).length;
      return rows;
    }, { mode: 'deferred' }).catch(cause => {
      const error = cause instanceof GraphVectorRefusal ? cause : new GraphVectorRefusal('TVEC1002', 'Native graph execution refused; its cause is retained.', { cause });
      refuse(error); throw error;
    });
  }
  return { rank, rows: (request: LightRagRankRequest) => rank(request), diagnostics: () => cloneJson(observed), reset };
}
