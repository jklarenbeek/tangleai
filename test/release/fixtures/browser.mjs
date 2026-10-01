import { qualifyGroundingBrowser } from './grounding-browser.mjs';
import { qualifyConsolidation } from './consolidation-browser.mjs';
import { qualifyGmplBrowser } from './gmpl-browser.mjs';
import { qualifyHeraBrowser } from './hera-browser.mjs';
import { qualifyForecastBrowser } from './forecast-browser.mjs';
import { qualifyTemporal } from './temporal-browser.mjs';
import { qualifyTrace2SkillBrowser } from './trace2skill-browser.mjs';
import { createMemoryOutcomeStore, createOutcomeContract } from '@tangleai/outcomes';
import { program as pen, LinqBuildError } from '@tangleai/linq';
import { createStudioFileAuthor, createDataAdapter, createFlowAdapter } from '@tangleai/jaren';
import { estimateTokens } from '@tangleai/core';
import { createMemoryUnitStore } from '@tangleai/memory';
import { createOfflineEmbedder, dagToMermaid, PIPELINE_DAG } from '@tangleai/pipeline';
import { createModelProposer, selectExperiment, EVOLVE_SELECTION_DEFAULT } from '@tangleai/evolve';

globalThis.tangleConsumer = {
  evolve: { createModelProposer, selectExperiment, selectionDefault: EVOLVE_SELECTION_DEFAULT },
  gmpl: qualifyGmplBrowser(),
  grounding: qualifyGroundingBrowser(),
  hera: qualifyHeraBrowser(),
  forecast: qualifyForecastBrowser(),
  consolidation: qualifyConsolidation(),
  temporal: qualifyTemporal(),
  trace2skill: qualifyTrace2SkillBrowser(),
  outcomeStore: createMemoryOutcomeStore(),
  outcomeContract: createOutcomeContract(),
  program: pen.program(['data']).stat('data', 'meta').answer('meta').toJSON(),
  LinqBuildError,
  adapters: [createStudioFileAuthor, createDataAdapter, createFlowAdapter],
  tokens: estimateTokens('12345678'),
  store: createMemoryUnitStore(),
  embedder: createOfflineEmbedder(),
  mermaid: dagToMermaid(PIPELINE_DAG),
};
