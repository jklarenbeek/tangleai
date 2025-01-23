import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import toml from './prompt.toml';

const prompt = toml as any;

const system = prompt.system.content;
const history = prompt.system.history as { role: string, content: string }[];

const messages = history.map((item) => {
  switch (item.role) {
    case "human":
    case "user":
      return new HumanMessage(item.content);
    case "ai":
    case "assistant":
      return new AIMessage(item.content);
    default:
      return null;
  }
}).filter((item) => item != null);

export default {
  system,
  history: messages
}
