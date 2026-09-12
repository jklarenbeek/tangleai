import { program as pen, LinqBuildError } from '@tangleai/linq';
import { createStudioFileAuthor, createDataAdapter, createFlowAdapter } from '@tangleai/jaren';
import { estimateTokens } from '@tangleai/core';
import { createMemoryUnitStore } from '@tangleai/memory';
import { createOfflineEmbedder, dagToMermaid, PIPELINE_DAG } from '@tangleai/pipeline';

globalThis.tangleConsumer = {
  program: pen.program(['data']).stat('data', 'meta').answer('meta').toJSON(),
  LinqBuildError,
  adapters: [createStudioFileAuthor, createDataAdapter, createFlowAdapter],
  tokens: estimateTokens('12345678'),
  store: createMemoryUnitStore(),
  embedder: createOfflineEmbedder(),
  mermaid: dagToMermaid(PIPELINE_DAG),
};
