import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
  PromptTemplate,
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import {
  RunnableSequence,
  RunnableMap,
  RunnableLambda,
} from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Document } from '@langchain/core/documents';
import { searchSearxng } from '../lib/fetchers/searxng';
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import formatChatHistoryAsString from '../utils/format';
import eventEmitter from 'events';
import { computeSimilarity } from '@tangleai/utils';
import { logger } from '@tangleai/utils';
import LineListOutputParser from '../lib/outputParsers/listLineOutputParser';
import { getDocumentsFromLinks } from '../lib/linkDocument';
import LineOutputParser from '../lib/outputParsers/lineOutputParser';
import { IterableReadableStream } from '@langchain/core/utils/stream';
import { ChatOpenAI } from '@langchain/openai';
import { RunnableConfig } from '@langchain/core/runnables';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch/web';

import { getSimilarityMeasure } from '../config';

const basicSearchRetrieverPrompt = () => `You are a specialized search engine rephraser and knowledge summarizer assistant for a fact checking user portal on the web. You are an expert at fact checking the user's queries against a given context. Because of this you are the most popular research and fact checking assistant alive! Today's ISO date is ${new Date().toISOString()}.

There are several examples attached for your reference inside the next markdown text code block, each representing a conversation between an user and the assistant. For brevity, these examples contain no context and no conversation history and is assumed to be self evident.

\`\`\`txt
USER: Follow up question: Paris is the capital of France
ASSISTANT: Rephrased search query:\`
<search>
Capital of France
</search>

<thoughts>
Paris was founded in France between 250 and 225 BC. That is more then 1800 years ago.
</thoughts>

<thoughtClaim>
true
</throughtClaim>
\`

USER: Hi, how are you?
ASSISTANT: Rephrased search query\`
<search>
irrelevant
</search>

<thoughts>
I cannot fact-check how I feel, since I'm a Artificial Inteligence.
</thoughts>

<thoughtClaim>
undefined
</thoughtClaim>
\`

USER: Follow up question: Docker is a application to make music
Rephrased search query: \`
<search>
What is Docker
</search>

<thoughts>
Docker is a platform designed to help developers build, share, and run container applications.
</thoughts>

<thoughtClaim>
false
</thoughtClaim>
\`

USER: Follow up question: X is the new name for https://twitter.com
ASSISTANT: Rephrased search query: \`
<search>
What is X in twitter
</search>

<thoughts>
X is the rebrand of twitter after Elon Musk bought twitter.
</thoughts>

<thoughtClaim>
true
</thoughtClaim>

<links>
https://twitter.com
</links>
\`

USER: Follow up question: Get me the main content from https://nytimes.com
ASSISTANT: Rephrased search query: \`
<search>
summarize
</search>

<thoughts>
Getting the information from nytimes.com is not a question that I can fact-check!
</thoughts>

<thoughtClaim>
undefined
</thoughtClaim>

<links>
https://nytimes.com
</links>
\`
\`\`\`

Your job is to generate a response with 3 separate XML blocks at the root of your response, called \`search\`, \`thoughts\` and \`links\` and it's values based on the user's query and the given context.

You can add another XML block \`thoughtClaim\` where the value is your ahead of time evaluation of the users claim.

\`\`\`txt
Rephrased search query:
<search>
  <!-- single line search query, for a search engine related to the users query and knowledge base -->
</search>

<thoughts>
  <!-- Explanation of the claim in 30-60 words, avoiding bias and using journalistic tone -->
</thoughts>

<thoughtClaim>
  <!-- enum: ['irrelevant', 'true', 'false', 'undetermined', 'information'] -->
</thoughtClaim>

<links>
  <!-- an array of single lined URL's from the user's query -->
</links>
\`\`\`

You MUST respond with ONE \`search\` XML block and ONE \`thoughts\' XML block at the root of your response! If the user's query against the context is irrelevant, subjective or is about personal feelings, the \`search\` XML block MUST contain \`irrelevant\`.

Beware of double speak! For example in "The Democratic People's Republic of Korea" (ie. North Korea) there is no democratic system at play that reflects the majority of the will of the people.

Only provide fact-checking about FACTUAL information based on verifiable EVIDENCE in the context! If that means 'verifying it through ancient records' then request for information in the \`search\` XML block! If not, the response result MUST be irrelevant in the \`search\` XML block! **DO NOT MAKE UP FACTS!** If you return an incorrect response, I loose my job! Please Help!

Read that again!`;

const basicSummarizePrompt = (question: string, doc: Document) => `
            You are a web search summarizer, tasked with summarizing a piece of text retrieved from a web search. Your job is to summarize the 
            text into a detailed, 2-4 paragraph explanation that captures the main ideas and provides a comprehensive answer to the query.
            If the query is \"summarize\", you should provide a detailed summary of the text. If the query is a specific question, you should answer it in the summary.
            
            - **Journalistic tone**: The summary should sound professional and journalistic, not too casual or vague.
            - **Thorough and detailed**: Ensure that every key point from the text is captured and that the summary directly answers the query.
            - **Not too lengthy, but detailed**: The summary should be informative but not excessively long. Focus on providing detailed information in a concise format.

            The text will be shared inside the \`text\` XML tag, and the query inside the \`query\` XML tag.

            <example>
            1. \`<text>
            Docker is a set of platform-as-a-service products that use OS-level virtualization to deliver software in packages called containers. 
            It was first released in 2013 and is developed by Docker, Inc. Docker is designed to make it easier to create, deploy, and run applications 
            by using containers.
            </text>

            <query>
            What is Docker and how does it work?
            </query>

            Response:
            Docker is a revolutionary platform-as-a-service product developed by Docker, Inc., that uses container technology to make application 
            deployment more efficient. It allows developers to package their software with all necessary dependencies, making it easier to run in 
            any environment. Released in 2013, Docker has transformed the way applications are built, deployed, and managed.
            \`
            2. \`<text>
            The theory of relativity, or simply relativity, encompasses two interrelated theories of Albert Einstein: special relativity and general
            relativity. However, the word "relativity" is sometimes used in reference to Galilean invariance. The term "theory of relativity" was based
            on the expression "relative theory" used by Max Planck in 1906. The theory of relativity usually encompasses two interrelated theories by
            Albert Einstein: special relativity and general relativity. Special relativity applies to all physical phenomena in the absence of gravity.
            General relativity explains the law of gravitation and its relation to other forces of nature. It applies to the cosmological and astrophysical
            realm, including astronomy.
            </text>

            <query>
            summarize
            </query>

            Response:
            The theory of relativity, developed by Albert Einstein, encompasses two main theories: special relativity and general relativity. Special
            relativity applies to all physical phenomena in the absence of gravity, while general relativity explains the law of gravitation and its
            relation to other forces of nature. The theory of relativity is based on the concept of "relative theory," as introduced by Max Planck in
            1906. It is a fundamental theory in physics that has revolutionized our understanding of the universe.
            \`
            </example>

            Everything below is the actual data you will be working with. Good luck!

            <query>
            ${question}
            </query>

            <text>
            ${doc.pageContent}
            </text>

            Make sure to answer the query in the summary.
          `;

const basicFactCheckResponsePrompt = () => `You are an expert at fact checking the user's queries against a given context within certain boundaries; you think deep, step by step against universal ethics and global morals! Because of this you are the most popular research and fact checking assistant alive! Today's ISO date is ${new Date().toISOString()}.

Anything inside the following \`context\` XML block provided below, is the knowledge returned by a search engine or document retriever and is not shared by the user. You have to fact check the user's query on the basis of that context, but you do not have to talk about the context or show any links from the context or conversation history in your response. Remember that!

<context>
{context}
</context>

There are several examples attached for your reference inside the next markdown text code block, each representing a conversation between an user and the assistant. For brevity these examples contain no context and is assumed to be self evident.

\`\`\`txt
USER: Follow up question: Paris is the capital of France
ASSISTANT: Conclusion Response:\`
<result>
true
</result>

<conclusion>
Paris was founded in France between 250 and 225 BC. That is more then 1800 years ago.
</conclusion>
\`

USER: Follow up question: Hi, how are you?
ASSISTANT: Conclusion Response:\`
<result>
irrelevant
</result>

<conclusion>
I cannot fact-check how I feel, since I'm a Artificial Inteligence.
</conclusion>
\`

USER: Follow up question: Docker is an application to make music.
ASSISTANT: Conclusion Response: \`
<result>
false
</result>

<conclusion>
Docker is a platform designed to help developers build, share, and run container applications.
</conclusion>
\`

USER: Follow up question: Why is the sky blue?
ASSISTANT: Conclusion Response: \`
<result>
irrelevant
</result>

<conclusion>
I'm unable to provide a fact-check for questions about subjective opinions or personal feelings. I can only provide factual information based on verifiable evidence.
</conclusion>
\`

USER: Follow up question: X is the new name for https://twitter.com
ASSISTANT: Conclusion Response: \`
<result>
true
</result>

<conclusion>
X is the rebrand of twitter after Elon Musk bought twitter.
</conclusion>
\`

USER: Follow up question: Get me the main content from https://nytimes.com
ASSISTANT: Conclusion Response: \`
<result>
irrelevant
</result>

<conclusion>
Getting the information from nytimes.com is not a question that I can fact-check!
</conclusion>
\`
\`\`\`

Your job is to generate a response with 2 separate XML blocks called \`result\` and \`conclusion\` and it's value based on the user's query and the given context.

\`\`\`txt
Conclusion Response:
<result>
    <!-- oneOf: ['irrelevant', 'true', 'false', 'undetermined', 'information'] -->
</result>

<conclusion>
    <!-- Explanation of the result in 30-60 words, avoiding bias and using journalistic tone -->
</conclusion>
\`\`\`

Beware of double speak! For example in "The Democratic People's Republic of Korea" (ie. North Korea) there is no democratic system at play that reflects the majority of the will of the people.

Only provide fact-checking about FACTUAL information based on verifiable EVIDENCE in the context! If that means 'verifying it through ancient records' then request for information in the result! If not, the response result MUST be irrelevant! **DO NOT MAKE UP FACTS!**.

You MUST respond with ONE \`result\` XML block and ONE \`conclusion\' XML block at the root of your response! If the user's query against the context is irrelevant, subjective or is about personal feelings, the \`result\` XML block MUST contain \`irrelevant\`. If the users query is false the \`result\` XML block MUST contain \`false\`, if the users query is true the \`result\` XML block MUST contain \`true\`. If you return an incorrect response, I loose my job! Please Help!

Read that again!`;

const strParser = new StringOutputParser();

const handleStream = async (
  stream: IterableReadableStream<StreamEvent>,
  emitter: eventEmitter,
) => {
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
      // else
      //   console.log(event);
    }
    else if (type === 'on_chain_end') {
      if (name === 'FinalSourceRetriever')
        emitter.emit(
          'data',
          JSON.stringify({ type: 'sources', data: event.data.output }),
        );
      else if (name === 'FinalResponseGenerator')
        emitter.emit('end');
      // else
      //   console.log(event);
    }
    // else {
    //   console.log(event);
    // }
  }
};

type BasicChainInput = {
  chat_history: BaseMessage[];
  query: string;
};

const createBasicFactCheckRetrieverChain = (llm: BaseChatModel) => {
  (llm as unknown as ChatOpenAI).temperature = 0;

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', basicSearchRetrieverPrompt()],
    new MessagesPlaceholder('chat_history'),
    ['user', 'Follow up question: {query}\nRephrased search query:']
  ]);

  return RunnableSequence.from([
    prompt,
    llm,
    strParser,
    RunnableLambda.from(async (input: string, config?: RunnableConfig) => {
      const linksOutputParser = new LineListOutputParser({
        key: 'links',
      });

      const searchOutputParser = new LineOutputParser({
        key: 'search',
      });

      const thoughtsOutputParser = new LineOutputParser({
        key: 'thoughts',
      });

      const thoughtClaimOutputParser = new LineOutputParser({
        key: 'thoughtClaim',
      });

      const links = await linksOutputParser.parse(input);
      const search = await searchOutputParser.parse(input);
      const thoughts = await thoughtsOutputParser.parse(input);
      const claim = await thoughtClaimOutputParser.parse(input);

      return { search, thoughts, claim, links };
    }),
    RunnableLambda.from(async ({search, thoughts, claim, links} : {search:string, thoughts:string, claim:string, links:string[]}, config?: RunnableConfig) => {

      await dispatchCustomEvent("progress", { description: 'rephrasing', search, thoughts, claim, links}, config);

      if (search === 'irrelevant') {
        return { query: search, docs: [] };
      }

      if (search === 'summarize' && links.length > 0) {
        await dispatchCustomEvent("progress", { description: "retrieving documents"}, config);
        if (search.length === 0) {
          search = 'summarize';
        }

        let docs = [];

        const linkDocs = await getDocumentsFromLinks({ links });

        const docGroups: Document[] = [];

        linkDocs.map((doc) => {
          const URLDocExists = docGroups.find(
            (d) =>
              d.metadata.url === doc.metadata.url && d.metadata.totalDocs < 10,
          );

          if (!URLDocExists) {
            docGroups.push({
              ...doc,
              metadata: {
                ...doc.metadata,
                totalDocs: 1,
              },
            });
          }

          const docIndex = docGroups.findIndex(
            (d) =>
              d.metadata.url === doc.metadata.url && d.metadata.totalDocs < 10,
          );

          if (docIndex !== -1) {
            docGroups[docIndex].pageContent =
              docGroups[docIndex].pageContent + `\n\n` + doc.pageContent;
            docGroups[docIndex].metadata.totalDocs += 1;
          }
        });

        await Promise.all(
          docGroups.map(async (doc) => {
            const res = await llm.invoke(basicSummarizePrompt(search, doc));

            const document = new Document({
              pageContent: res.content as string,
              metadata: {
                title: doc.metadata.title,
                url: doc.metadata.url,
              },
            });

            docs.push(document);
          }),
        );

        return { query: search, docs: docs };
      } else {
        const res = await searchSearxng(search, {
          language: 'en',
        });

        const documents = res.results.map(
          (result) =>
            new Document({
              pageContent: result.content,
              metadata: {
                title: result.title,
                url: result.url,
                ...(result.img_src && { img_src: result.img_src }),
              },
            }),
        );

        return { query: search, docs: documents };
      }
    }),
  ], "FactCheckRetrieverChain");
};

const createBasicFactCheckAnsweringChain = (
  llm: BaseChatModel,
  embeddings: Embeddings,
  optimizationMode: 'speed' | 'balanced' | 'quality',
) => {
  const basicFactCheckRetrieverChain = createBasicFactCheckRetrieverChain(llm);

  const processDocs = async (docs: Document[]) => {
    return docs
      .map((_, index) => `${index + 1}. ${docs[index].pageContent}`)
      .join('\n');
  };

  const rerankDocs = async ({
    query,
    docs,
  }: {
    query: string;
    docs: Document[];
  }) => {
    if (docs.length === 0) {
      return docs;
    }

    if (query.toLocaleLowerCase() === 'summarize') {
      return docs;
    }

    const docsWithContent = docs.filter(
      (doc) => doc.pageContent && doc.pageContent.length > 0,
    );

    if (optimizationMode === 'speed') {
      return docsWithContent.slice(0, 15);
    } else if (optimizationMode === 'balanced') {
      const [docEmbeddings, queryEmbedding] = await Promise.all([
        embeddings.embedDocuments(
          docsWithContent.map((doc) => doc.pageContent),
        ),
        embeddings.embedQuery(query),
      ]);

      const similarity = docEmbeddings.map((docEmbedding, i) => {
        const sim = computeSimilarity(queryEmbedding, docEmbedding, getSimilarityMeasure());

        return {
          index: i,
          similarity: sim,
        };
      });

      const sortedDocs = similarity
        .filter((sim) => sim.similarity > 0.3)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 15)
        .map((sim) => docsWithContent[sim.index]);

      return sortedDocs;
    }
  };

  return RunnableSequence.from([
    RunnableMap.from({
      query: (input: BasicChainInput) => input.query,
      chat_history: (input: BasicChainInput) => input.chat_history,
      context: RunnableSequence.from([
        (input) => ({
          query: input.query,
          chat_history: input.chat_history,
          //formatChatHistoryAsString(input.chat_history),
        }),
        basicFactCheckRetrieverChain
          .pipe(rerankDocs)
          .withConfig({
            runName: 'FinalSourceRetriever',
          })
          .pipe(processDocs),
      ]),
    }),
    ChatPromptTemplate.fromMessages([
      ['system', basicFactCheckResponsePrompt()],
      ['user', 'Follow up question: {query}\nConclusion Response:'],
    ]),
    llm,
    strParser,
    RunnableLambda.from(async (input: string, config?: RunnableConfig) => {
      const resultOutputParser = new LineOutputParser({
        key: 'result',
      });

      const conclusionOutputParser = new LineOutputParser({
        key: 'conclusion',
      });

      const result = await resultOutputParser.parse(input);
      const conclusion = await conclusionOutputParser.parse(input);

      return { result, conclusion };
    }),
  ], "FactCheckAnswerChain").withConfig({
    runName: 'FinalResponseGenerator',
  });
};

const basicFactCheck = (
  query: string,
  history: BaseMessage[],
  llm: BaseChatModel,
  embeddings: Embeddings,
  optimizationMode: 'speed' | 'balanced' | 'quality',
) => {
  const emitter = new eventEmitter();

  try {
    const basicFactCheckAnsweringChain = createBasicFactCheckAnsweringChain(
      llm,
      embeddings,
      optimizationMode,
    );

    const stream = basicFactCheckAnsweringChain.streamEvents(
      {
        chat_history: history || [],
        query: query,
      },
      {
        version: 'v2',
      },
    );

    handleStream(stream, emitter);
  } catch (err) {
    emitter.emit(
      'error',
      JSON.stringify({ data: 'An error has occurred please try again later' }),
    );
    logger.error(`Error in websearch: ${err}`);
  }

  return emitter;
};

const handleFactCheck = (
  message: string,
  history: BaseMessage[],
  llm: BaseChatModel,
  embeddings: Embeddings,
  optimizationMode: 'speed' | 'balanced' | 'quality',
) => {
  const emitter = basicFactCheck(
    message,
    history,
    llm,
    embeddings,
    optimizationMode,
  );
  return emitter;
};

export default handleFactCheck;
