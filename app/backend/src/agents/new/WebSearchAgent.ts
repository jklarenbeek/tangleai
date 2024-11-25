import {
  PromptTemplate,
  SystemMessagePromptTemplate
} from "@langchain/core/prompts";
import { Document } from '@langchain/core/documents';

import AbstractAgent from "./AbstractAgent";
import { searchSearxng } from "../../lib/searxng";
import { getDocumentsFromLinks } from "../../lib/linkDocument";
import LineOutputParser from "../../lib/outputParsers/lineOutputParser";
import LineListOutputParser from "../../lib/outputParsers/listLineOutputParser";
import { query } from "express";

const retrieverPrompt = SystemMessagePromptTemplate.fromTemplate(
`You are an search engine rephraser. You will be given a conversation history and a follow-up question that you need to rephrase as a standalone search engine query that can be used to search the web for information to answer the users follow-up question.

The following rules apply:

1) If the user follow-up message is to asks some question, information about a topic or anything that you can search for, rephrase that message inside a single \`question\` XML block.
2) If the user's follow-up message asks some question about a PDF or webpage and includes a link or multiple links too it, you need to return all the links you find inside a single \`links\` XML block, but do NOT include URL's from the \`conversation\` XML block (if available!).
3) You must always return the rephrased search engine query inside the \`question\` XML block, if there are no links in the follow-up message then don't insert a \`links\` XML block in your response.
4) If the follow-up message is not a topic that needs to be searched the internet for, you need to return \`not_needed\` inside the \`question\` XML block as the response.
5) If the follow-up message is to summarize the \'links\' provided by the user, then simply respond with the links in the XML block and \`summarize\` inside the \`question\` XML block.

There are several examples attached for your reference inside the next markdown text code block, each representing a conversation between a user and the rephrasing assistant.

\`\`\`txt
USER: Follow up question: What is the capital of France
ASSISTANT: Rephrased question:\`
<question>
Capital of france
</question>
\`

USER: Hi, how are you?
ASSISTANT: Rephrased question\`
<question>
not_needed
</question>
\`

USER: Follow up question: What is Docker?
Rephrased question: \`
<question>
What is Docker
</question>
\`

USER: Follow up question: Can you tell me what is X from https://twitter.com
ASSISTANT: Rephrased question: \`
<question>
Can you tell me what is X?
</question>

<links>
https://twitter.com
</links>
\`

USER: Follow up question: Get me the main content from https://nytimes.com
ASSISTANT: Rephrased question: \`
<question>
summarize
</question>

<links>
https://nytimes.com
</links>
\`
\`\`\`

Anything below is the part of the actual conversation and you need to use the conversation and the follow-up question to rephrase the follow-up question as a standalone question based on the guidelines shared above.

<conversation>
{chat_history}
</conversation>

Follow up question: {query}
Rephrased question:
`);

const responsePrompt = SystemMessagePromptTemplate.fromTemplate(
`You are Perplexica, an expert at searching the web and answering user's queries. You are also an expert at summarizing web pages and documents in such a way it reflects the users message. Because of this you are the most popular research assistant alive! I need your help, otherwise I will loose my job!

Generate a response that is informative and relevant to the user's query based on provided context (the context consits of search engine results containing a brief description of the content of that page, or a summary of a webpage or document).

**The following rules apply**:

1) Your responses should be medium to long in length and be informative and relevant to the user's query. You can use markdown to format your response. You should use bullet points to list the information. Make sure the answer is not short and is informative.
2) You must use the provided context to answer the user's query in the best way possible. Use an unbaised and journalistic tone in your response. Do not repeat the text!
3) If the query contains some links and the user asks to get an answer from those links you will be provided the entire content of the page inside the \`context\` XML block. You can then use this content to answer the user's query. 
4) You must not tell the user to open any link or visit any website to get the answer. You must provide the answer in the response itself. If the user asks for links you can provide them.
5) If the user asks to summarize the content from some links, you will be provided the entire content of the page inside the \`context\` XML block. You can then use this content to summarize the text. The content provided inside the \`context\` block will be already summarized by another assistant, so you just need to use that context to answer the user's query.
6) You have to cite the answer using [number] notation as defined in markdown. 

**About citations**:

You must cite the sentences with their relevent context number. You must cite each and every part of the answer so the user can know where the information is coming from. Place these citations at the end of that particular sentence. You can cite the same sentence multiple times if it is relevant to the user's query like [number1][number2]. However you do not need to cite it using the same number. You can use different numbers to cite the same sentence multiple times. The number refers to the number of the search result (passed in the context) used to generate that part of the answer.

**Conversation History**

Anything inside the following \`conversation\` XML block provided below is a summary of the conversation between the user and assistant in order to better clarify the content context that follows the conversation. If the \`conversation\` XML block is empty, it just means that there has been no conversation before.

<conversation>
{chat_history}
</conversation>

**Content Context**:

Anything inside the following \`context\` XML block provided below, is the knowledge returned by the search engine or document retriever and is not shared by the user. You have to answer question on the basis of the context and cite the relevant information from it but you do not have to talk about the context in your response.

<context>
{context}
</context>

If you think there's nothing relevant in the search results, you can say: 'Hmm, sorry I could not find any relevant information on this topic. Would you like me to search again or ask something else?'. You do not need to do this for summarization tasks.

Anything between the \`context\` is retrieved from a search engine or document retriever and is not a part of the conversation with the user.

Today's ISO date is ${new Date().toISOString()}.
`);

const getSummarizePrompt = (question: string, doc: Document<Record<string, any>>) => `
You are a web search summarizer, tasked with summarizing a piece of text retrieved from a web search or document. Your job is to summarize the 
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
 
export default class WebSearchAgent extends AbstractAgent {

  constructor(llm, embeddings, optimizationMode, vectorStore) {
    super(llm, embeddings, optimizationMode, vectorStore);
  }
  protected getRetrieverPrompt = () => retrieverPrompt;
  protected getResponsePrompt = () => responsePrompt;
  protected getSummarizePrompt = (question: string, doc: Document<Record<string, any>>) => getSummarizePrompt(question, doc);

  protected async retrieveDocuments(question: string, links: string[]) {
    if (question === 'not_needed') {
      return { query: '', docs: [] };
    }

    if (links.length > 0) {
      if (question.length === 0) {
        question = 'summarize';
      }

      const docs: Document[] = [];

      // TODO: wait? how?
      const linkDocs = await getDocumentsFromLinks({ links });

      const docGroups: Document[] = [];

      linkDocs.map((doc) => {
        const URLDocExists = docGroups.find(
          (d) => d.metadata.url === doc.metadata.url 
            && d.metadata.totalDocs < 10,
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
          (d) => d.metadata.url === doc.metadata.url 
            && d.metadata.totalDocs < 10,
        );

        if (docIndex !== -1) {
          docGroups[docIndex].pageContent =
            docGroups[docIndex].pageContent + `\n\n` + doc.pageContent;
          docGroups[docIndex].metadata.totalDocs += 1;
        }
      });

      const llm = this.llm;
      await Promise.all(
        docGroups.map(async (doc) => {
          const res = await llm.invoke(this.getSummarizePrompt(question, doc));

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

      return { query: question, docs: docs };
    }
    else {
      const res = await searchSearxng(question, {
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

      return { query: question, docs: documents };

    }
  }
}
