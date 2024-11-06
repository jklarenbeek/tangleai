import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Embeddings } from '@langchain/core/embeddings';

import AbstractAgent, { AgentFactoryType, OptimizationMode } from "./AbstractAgent";
import WebSearchAgent from "./WebSearchAgent";

import { VectorStore } from '@langchain/core/vectorstores';
import { BaseMessage } from '@langchain/core/messages';

import eventEmitter from 'events';

class AgentFactory {
    static createAgent(type: AgentFactoryType, llm: BaseChatModel, embeddings: Embeddings, optimizationMode: OptimizationMode, vectorStore: VectorStore | null): AbstractAgent {
        switch (type) {
            case 'web':
                return new WebSearchAgent(llm, embeddings, optimizationMode, vectorStore);
            default:
                throw new Error('Invalid agent type');
        }
    }
}

export async function handleSearch(type: AgentFactoryType, message: string, history: BaseMessage[], llm: BaseChatModel, embeddings: Embeddings, vectorStore: VectorStore, optimizationMode: OptimizationMode): Promise<eventEmitter> {
    const agent = AgentFactory.createAgent(type, llm, embeddings, optimizationMode, vectorStore);
    return agent.handle(message, history);
}
