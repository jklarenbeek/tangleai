import { Embeddings, type EmbeddingsParams } from '@langchain/core/embeddings';
import { chunkArray } from '@langchain/core/utils/chunk_array';

import logger from '../../utils/logger';

interface HuggingFaceTransformersEmbeddingsParams
  extends EmbeddingsParams {
  modelName: string;

  model: string;

  timeout?: number;

  batchSize?: number;

  stripNewLines?: boolean;
}

class HuggingFaceTransformersEmbeddings
  extends Embeddings
  implements HuggingFaceTransformersEmbeddingsParams
{
  modelName = 'Xenova/all-MiniLM-L6-v2';

  model = 'Xenova/all-MiniLM-L6-v2';

  batchSize = 512;

  stripNewLines = true;

  timeout?: number;

  private pipelinePromise: Promise<any>;

  constructor(fields?: Partial<HuggingFaceTransformersEmbeddingsParams>) {
    super(fields ?? {});

    this.modelName = fields?.modelName ?? fields?.model ?? this.modelName ?? this.model;
    this.model = fields?.model ?? this.model ?? this.modelName;
    this.stripNewLines = fields?.stripNewLines ?? this.stripNewLines;
    this.timeout = fields?.timeout;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const batches = chunkArray(
      this.stripNewLines ? texts.map((t) => t.replace(/\n/g, ' ')) : texts,
      this.batchSize,
    );

    const batchRequests = batches.map((batch) => this.runEmbedding(batch));
    const batchResponses = await Promise.all(batchRequests);
    const embeddings: number[][] = [];

    for (let i = 0; i < batchResponses.length; i += 1) {
      const batchResponse = batchResponses[i];
      for (let j = 0; j < batchResponse.length; j += 1) {
        embeddings.push(batchResponse[j]);
      }
    }

    return embeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    const data = await this.runEmbedding([
      this.stripNewLines ? text.replace(/\n/g, ' ') : text,
    ]);
    return data[0];
  }

  private async runEmbedding(texts: string[]) {
    const { pipeline } = await import('@xenova/transformers');

    const pipe = await (this.pipelinePromise ??= pipeline(
      'feature-extraction',
      this.model,
    ));

    return this.caller.call(async () => {
      const output = await pipe(texts, { pooling: 'mean', normalize: true });
      return output.tolist();
    });
  }
}

export const loadTransformersEmbeddingsModels = async () => {
  try {
    const embeddingModels = {
      'all-MiniLM-L6-v2': {
        displayName: 'Huggingface Default',
        model: new HuggingFaceTransformersEmbeddings()
      },
      'xenova-bge-small-en-v1.5': {
        displayName: 'BGE Small',
        model: new HuggingFaceTransformersEmbeddings({
          modelName: 'Xenova/bge-small-en-v1.5',
        }),
      },
      'xenova-gte-small': {
        displayName: 'GTE Small',
        model: new HuggingFaceTransformersEmbeddings({
          modelName: 'Xenova/gte-small',
        }),
      },
      'xenova-bert-base-multilingual-uncased': {
        displayName: 'Bert Multilingual',
        model: new HuggingFaceTransformersEmbeddings({
          modelName: 'Xenova/bert-base-multilingual-uncased',
        }),
      },
    };

    return embeddingModels;
  } catch (err) {
    logger.error(`Error loading Transformers embeddings model: ${err}`);
    return {};
  }
};
