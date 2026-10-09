/** One settled graph identity declares both canonical vector columns. */
import { equalsJson } from '@jarenjs/core/object';
import { immutableLightRagJson, lightragMust, validateLightRagShape, type LightRagEmbeddedBy } from '@tangleai/lightrag';
import { LIGHTRAG_COLLECTIONS } from './lightrag-model.ts';

export class GraphVectorRefusal extends Error {
  readonly code: 'TVEC1001' | 'TVEC1002' | 'TVEC1003' | 'TVEC1004';
  constructor(code: GraphVectorRefusal['code'], message: string, options?: ErrorOptions) { super(message, options); this.code = code; }
}
export interface GraphVectorDeclaration {
  active: LightRagEmbeddedBy;
  retained: LightRagEmbeddedBy[];
  widths: number[];
}
export const GRAPH_VECTOR_COLLECTIONS = ['lightrag_entities', 'lightrag_relations'] as const;
export function declareGraphVectors(active: LightRagEmbeddedBy, retained: readonly LightRagEmbeddedBy[] = []): GraphVectorDeclaration {
  try {
    const checked = [active, ...retained].map(identity => lightragMust(validateLightRagShape('lightRagEmbeddedBy', identity)));
    if (checked.some(identity => identity.dims > 8192)) throw new TypeError('Native vector columns support at most 8192 dimensions.');
    const prior = checked.slice(1).filter((identity, index, values) => !equalsJson(identity, checked[0])
      && values.findIndex(other => equalsJson(identity, other)) === index);
    return immutableLightRagJson({ active: checked[0], retained: prior,
      widths: [...new Set(checked.map(identity => identity.dims))].sort((a, b) => a - b) });
  } catch (cause) { throw new GraphVectorRefusal('TVEC1001', 'Graph columns require settled embedding identities.', { cause }); }
}
export function assertGraphVectorDeclaration(declaration: GraphVectorDeclaration): GraphVectorDeclaration {
  const checked = declareGraphVectors(declaration.active, declaration.retained);
  if (!equalsJson(checked, declaration)) throw new GraphVectorRefusal('TVEC1001', 'Declared graph widths differ from their settled identities.');
  return checked;
}
export function graphVectorCollections(declaration: GraphVectorDeclaration) {
  const checked = assertGraphVectorDeclaration(declaration);
  const extend = (collection: typeof LIGHTRAG_COLLECTIONS.lightrag_entities) => ({ ...collection,
    schema: { ...collection.schema, properties: { ...collection.schema.properties,
      payload: { type: 'object', properties: { embedding: { type: 'array', items: { type: 'number' } } } } } },
    indexes: [...collection.indexes, ...checked.widths.map(dims => ({ name: 'by_graph_vector_' + dims,
      path: '$.payload.embedding', derive: 'vector', dims }))],
  });
  return { lightrag_entities: extend(LIGHTRAG_COLLECTIONS.lightrag_entities),
    lightrag_relations: extend(LIGHTRAG_COLLECTIONS.lightrag_relations) };
}
