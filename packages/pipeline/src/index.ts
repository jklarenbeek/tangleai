/** @tangleai/pipeline barrel. */

export { PIPELINE_DAG, PIPELINE_NODES } from './dag.ts';
export { createPipeline, DEFAULT_THRESHOLDS } from './run.ts';
export type {
  Pipeline,
  PipelineOptions,
  PipelineReport,
  PipelineThresholds,
  DagNodeRecord,
} from './run.ts';
export { dagToMermaid } from './mermaid.ts';
export {
  trigramEmbedding,
  createTrigramEmbedder,
  numericContrastJudge,
} from './embedders.ts';
export type { Embedder, Judge } from './embedders.ts';
