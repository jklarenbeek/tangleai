
import { createChatClient } from '@tangleai/models/client';
import { createToolbox, registerModelContext } from '@tangleai/agents/toolbox';
import { createAgent } from '@tangleai/agents/agent';
import { resolveEndpoint } from '@tangleai/models/providers';
import { createLedger } from '@tangleai/context/ledger';
import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { validateClaimEvidence } from '@tangleai/context/evidence';
import { ledgerFootprint } from '@tangleai/context/retention';
void validateClaimEvidence({}); void ledgerFootprint({});
void createGuardedRefiner({ read: async () => ({}), validateProposal: () => true, apply: (d: any) => d, validateCandidate: () => true, planCommit: (d: any) => d, commit: async (d: any) => d });
void createLedger({ goalLimits: { maxChars: 2048 }, archiveLimits: { maxItems: 8 } }).retentionReport();
const endpoint = resolveEndpoint({ provider: 'ollama', model: 'm' });
void endpoint.url;
const client = createChatClient({ provider: 'ollama', model: 'm', fetch: (globalThis.fetch), maxTokens: 3000, maxTokensField: 'max_completion_tokens' });
// @ts-expect-error only Chat Completions token fields are accepted
createChatClient({ maxTokensField: 'max_output_tokens' });
const toolbox = createToolbox();
toolbox.add({
  name: 'echo', description: 'echo', inputSchema: { type: 'object' },
  execute: (input: any) => input,
});
void toolbox.toFunctionTools();
void toolbox.execute('echo', {});
void registerModelContext(toolbox, undefined);
const agent = createAgent({ client, toolbox, system: 'x', maxToolRounds: 3 });
void agent.send([{ role: 'user', content: 'hi' }]);
