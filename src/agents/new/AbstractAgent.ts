import { BaseMessage } from '@langchain/core/messages';
import {
  PromptTemplate,
  ChatPromptTemplate,
  MessagesPlaceholder,
  BaseMessagePromptTemplate,
} from '@langchain/core/prompts';
import {
  RunnableSequence,
  RunnableMap,
  RunnableLambda,
  RunnableConfig,
} from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Document } from '@langchain/core/documents';
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import formatChatHistoryAsString from '../../utils/formatHistory';
import eventEmitter from 'events';
import computeSimilarity from '../../utils/computeSimilarity';
import logger from '../../utils/logger';
import { IterableReadableStream } from '@langchain/core/utils/stream';
import { RedisVectorStore } from '@langchain/redis';
import { createClient } from 'redis';
import { getRedisUrl } from '../../config';
import LineListOutputParser from '../../lib/outputParsers/listLineOutputParser';
import LineOutputParser from '../../lib/outputParsers/lineOutputParser';

export type OptimizationMode = 'speed'
    | 'balanced'
    | 'quality';

export type AgentFactoryType = 'web'
    | 'academic' 
    | 'image';

type BasicChainInput = {
  chat_history: BaseMessage[];
  query: string;
};

export default abstract class AbstractAgent {
  protected llm: BaseChatModel;
  protected embeddings: Embeddings;
  protected optimizationMode: OptimizationMode;
  protected vectorStore: RedisVectorStore;
  protected sessionId: string;

  constructor(
    llm: BaseChatModel,
    embeddings: Embeddings,
    optimizationMode: OptimizationMode,
    sessionId: string
  ) {
    this.llm = llm;
    this.embeddings = embeddings;
    this.optimizationMode = optimizationMode;
    this.sessionId = sessionId;
  }

  protected async initVectorStore(): Promise<void> {
    const client = createClient({
      url: getRedisUrl(),
    });

    await client.connect();

    this.vectorStore = new RedisVectorStore(this.embeddings, {
      redisClient: client,
      indexName: this.sessionId,
    });
  }

  protected abstract getRetrieverPrompt(): BaseMessagePromptTemplate<any, any>;
  protected abstract getResponsePrompt(): BaseMessagePromptTemplate<any, any>;
  protected abstract getSummarizePrompt(question: string, doc: Document<Record<string, any>>);

  protected createRetrieverChain(): RunnableSequence {
    return RunnableSequence.from([
      this.getRetrieverPrompt(),
      this.llm,
      new StringOutputParser(),
      RunnableLambda.from(async (output: string, config?: RunnableConfig) => {
        const linksOutputParser = new LineListOutputParser({
          key: 'links',
        });
  
        const questionOutputParser = new LineOutputParser({
          key: 'question',
        });
  
        const links = await linksOutputParser.parse(output);
        const question = await questionOutputParser.parse(output);
  
        return { question, links };
      }),
      RunnableLambda.from(async ({ question, links} : { question:string, links:string[] }, config?: RunnableConfig) => {
        const docs = await this.retrieveDocuments(question, links);
        return { question, docs };
      }),
    ]);
  }


  protected abstract retrieveDocuments(question: string, links: string[]): Promise<{ query: string; docs: Document[]; }>;

  protected async rerankDocs(query: string, docs: Document[]): Promise<Document[]> {
    if (docs.length === 0) {
      return docs;
    }

    const docsWithContent = docs.filter(
      (doc) => doc.pageContent && doc.pageContent.length > 0,
    );

    if (this.optimizationMode === 'speed') {
      return docsWithContent.slice(0, 10);
    } else if (this.optimizationMode === 'balanced') {
      const [docEmbeddings, queryEmbedding] = await Promise.all([
        this.embeddings.embedDocuments(
          docsWithContent.map((doc) => doc.pageContent),
        ),
        this.embeddings.embedQuery(query),
      ]);

      const similarity = docEmbeddings.map((docEmbedding, i) => {
        const sim = computeSimilarity(queryEmbedding, docEmbedding);
        return { index: i, similarity: sim };
      });

      const sortedDocs = similarity
        .filter((sim) => sim.similarity > 0.4)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10)
        .map((sim) => docsWithContent[sim.index]);

      return sortedDocs;
    }

    return docsWithContent;
  }

  protected async processDocs(docs: Document[]): Promise<string> {
    await this.vectorStore.addDocuments(docs);
    return docs
        .map((_, index) => `${index + 1}. ${docs[index].pageContent}`)
        .join('\n');
  }

  protected async formatChatHistory(history: BaseMessage[]) {
    return formatChatHistoryAsString(history);
  }

  protected createAnsweringChain() {
    return RunnableSequence.from([
      RunnableMap.from({
        query: (input: BasicChainInput) => input.query,
        chat_history: (input: BasicChainInput) => input.chat_history,
        context: RunnableSequence.from([
          (input: BasicChainInput) => ({
            query: input.query,
            chat_history: this.formatChatHistory(input.chat_history),
          }),
          this.createRetrieverChain()
            .pipe(this.rerankDocs)
            .withConfig({ runName: 'FinalSourceRetriever' })
            .pipe(this.processDocs),
        ]),
      }),
      ChatPromptTemplate.fromMessages([
        this.getResponsePrompt(),
        new MessagesPlaceholder('chat_history'),
        ['user', '{query}'],
      ]),
      this.llm,
      new StringOutputParser(),
    ]).withConfig({
      runName: 'FinalResponseGenerator',
    });
  }

  public async handle(message: string, history: BaseMessage[]): Promise<eventEmitter> {
    const emitter = new eventEmitter();
    try {
      await this.initVectorStore();
      const answeringChain = this.createAnsweringChain();

      const stream = answeringChain.streamEvents(
        {
          chat_history: history,
          query: message,
        },
        {
          version: 'v1',
        },
      );

      AbstractAgent.handleStream(stream, emitter);
    } 
    catch (err) {
      emitter.emit(
        'error',
        JSON.stringify({ data: 'An error occurred. Please try again later.' }),
      );
      logger.error(`Error in ${this.constructor.name}: ${err}`);
    }
    finally {
      return emitter;      
    }
  }

  protected static async handleStream(
    stream: IterableReadableStream<StreamEvent>,
    emitter: eventEmitter,
  ): Promise<void> {
    for await (const event of stream) {
      const type = event.event;
      const name = event.name;
      const data = event.data;
      if (type === 'on_chain_stream') {
        if (name === 'FinalResponseGenerator')
          emitter.emit(
            'data',
            JSON.stringify({ type: 'response', data: event.data.chunk }),
          );
        else
          console.log(event);
      }
      else if (type === 'on_chain_end') {
        if (name === 'FinalSourceRetriever')
          emitter.emit(
            'data',
            JSON.stringify({ type: 'sources', data: event.data.output }),
          );
        else if (name === 'FinalResponseGenerator')
          emitter.emit('end');
        else
          console.log(event);
      }
      else {
        console.log(event);
      }
    }
  }

  public async deriveConclusion(query: string): Promise<string> {
    const relevantDocs = await this.vectorStore.similaritySearch(query, 5);
    const context = relevantDocs.map(doc => doc.pageContent).join('\n\n');

    const conclusionPrompt = PromptTemplate.fromTemplate(`
      Based on the following context, please provide a concise conclusion or summary related to the query: "{query}"

      Context:
      {context}

      Conclusion:
    `);

    const conclusionChain = RunnableSequence.from([
      conclusionPrompt,
      this.llm,
      new StringOutputParser(),
    ]);

    return conclusionChain.invoke({ query, context });
  }
}
