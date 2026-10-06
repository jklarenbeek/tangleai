import { EXPERIENTIAL_EXAMPLE_TEMPLATE, type ExperientialDatasetOptions } from '@tangleai/experiential';
import { SELECTION_TIME } from './selection-fixtures.ts';

export const datasetOptions = (changes: Partial<ExperientialDatasetOptions> = {}): ExperientialDatasetOptions => ({
  seed: 17753, splitRatios: { validation: .2, replay: .2 },
  groupKeyOf: e => ({ sourceEpisodeId: e.sourceRefs[0].sourceId, duplicateFamilyId: e.contentDigest }),
  holdoutPairsOf: () => [], conceptsOf: e => [e.sourceRefs[0].sourceId], template: EXPERIENTIAL_EXAMPLE_TEMPLATE,
  tokenizerIdentity: 'fixture-tokenizer/v1', chatTemplateIdentity: 'fixture-chat/v1', recordedAt: SELECTION_TIME, ...changes,
});
