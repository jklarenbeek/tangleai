import { estimateTokens } from '@tangleai/core';
import { createMemoryUnitStore } from '@tangleai/memory';
import { createOfflineEmbedder, dagToMermaid, PIPELINE_DAG } from '@tangleai/pipeline';

globalThis.tangleConsumer = {
  tokens: estimateTokens('12345678'),
  store: createMemoryUnitStore(),
  embedder: createOfflineEmbedder(),
  mermaid: dagToMermaid(PIPELINE_DAG),
};
