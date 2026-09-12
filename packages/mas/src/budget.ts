/**
 * One shared budget account around every effective model client.
 *
 * `createBudgetAccount`'s `stop()` and synchronous `reserve()` run
 * BEFORE the provider call is awaited, so concurrent branches cannot
 * all spend the last turn; `settle(usage, text)` runs after success
 * with the provider's usage winning and the suite's 4-chars-per-token
 * estimate only when a token limit exists. A failed call still consumed
 * its reserved turn — reserve is not refunded. The honest bound stays
 * the suite's: token overshoot under concurrency may be up to the other
 * in-flight calls' usage, and this wrapper never claims stronger.
 */

export interface MasBudgetAccount {
  reserve: () => void;
  settle: (usage: unknown, text?: string) => void;
  stop: () => string | null;
  spent: () => { turns: number, tokens: number, ms: number };
  remaining: () => Record<string, number | null>;
}

export interface MasChatCompletion {
  message: { role?: string, content: string, toolCalls?: Array<{ id: string, name: string, arguments: string }>, reasoning?: string };
  finishReason?: string;
  usage?: unknown;
  model?: string;
}

export interface MasChatClient {
  endpoint?: { provider: string };
  complete(request: unknown): Promise<MasChatCompletion>;
}

/** The workflow budget said no: a value-shaped stop, raised to unwind one node. */
export class MasBudgetStop extends Error {
  reason: string;
  constructor(reason: string) {
    super(`the shared workflow budget is spent (${reason})`);
    this.reason = reason;
  }
}

export interface SharedBudgetClientOptions {
  /** Called once per dispatched provider request, including rejected requests; absent usage stays unknown. */
  maxContextChars?: number;
  onCall?: (record: { usage: unknown, replayed: boolean, chargedTokens: number }) => void;
}

/**
 * Wrap one effective client so every call — agent turns and structured
 * normalization alike — reserves on the one shared account first.
 */
export function createSharedBudgetClient(
  client: MasChatClient,
  account: MasBudgetAccount,
  options: SharedBudgetClientOptions = {},
): MasChatClient {
  return {
    ...(client.endpoint !== undefined ? { endpoint: client.endpoint } : {}),
    async complete(request: unknown): Promise<MasChatCompletion> {
      const messages = (request as { messages?: Array<{ content?: unknown }> }).messages ?? [];
      const chars = messages.reduce((n, message) => n + (typeof message.content === 'string' ? message.content.length : JSON.stringify(message.content ?? '').length), 0);
      if (options.maxContextChars !== undefined && chars > options.maxContextChars) throw new MasBudgetStop('contextChars');
      const stop = account.stop();
      if (stop !== null) throw new MasBudgetStop(stop);
      account.reserve();
      let completion: MasChatCompletion | undefined;
      let chargedTokens = 0;
      try {
        completion = await client.complete(request);
        const text = `${JSON.stringify((request as { messages?: unknown }).messages ?? '')}${completion.message?.content ?? ''}`;
        const before = account.spent().tokens;
        account.settle(completion.usage, text);
        chargedTokens = account.spent().tokens - before;
        return completion;
      } finally {
        options.onCall?.({ chargedTokens, usage: completion?.usage, replayed: completion !== undefined && (completion as { replayed?: unknown }).replayed !== undefined });
      }
    },
  };
}
