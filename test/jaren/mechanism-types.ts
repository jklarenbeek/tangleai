import { compileJsonQuery } from '@jarenjs/json/query';
// @jarenjs/ai — the ledger: durable state over an injected storage
// adapter. Both entry points are exercised (the index re-export and the
// ./ledger subpath), because a subpath that resolves at runtime but not
// under `moduleResolution: nodenext` is a bug a consumer finds first.
import { createLedger } from '@tangleai/context/ledger';
import { createMemoryStorage } from '@tangleai/context/storage/memory';
import { createLedger as createLedgerSubpath } from '@tangleai/context/ledger';
import { MEMORY_SCHEMA } from '@tangleai/context/schemas/ledger';
import { createMemoryStorage as memoryStorageSubpath } from '@tangleai/context/storage/memory';

void [createLedgerSubpath, memoryStorageSubpath, MEMORY_SCHEMA];

// The identity rule, reachable. A storage adapter's optional `rank`
// selects the records whose `embeddedBy` is the query's, and a host
// keeping its own vector store beside the ledger refuses the same
// mixtures — both need the predicate the ledger applies, typed against
// the same `LedgerEmbeddedBy` the records carry.
import { sameIdentity, describeIdentity } from '@tangleai/context/ledger';
import { sameIdentity as sameIdentitySubpath } from '@tangleai/context/ledger';
import type { LedgerEmbeddedBy } from '@tangleai/context/schemas/ledger';

function identityBlock(stored: LedgerEmbeddedBy | undefined, query: LedgerEmbeddedBy) {
  // total on both sides: what a store hands back may carry no identity
  const comparable: boolean = sameIdentity(stored, query);
  const bothAbsent: boolean = sameIdentity(undefined, undefined);
  const named: string = describeIdentity(query);
  void [comparable, bothAbsent, named, sameIdentitySubpath];
  // @ts-expect-error — a width is not an identity
  void sameIdentity(768, query);
}
void identityBlock;

async function ledgerBlock() {
  // no arguments at all: in-memory storage, no query seam
  const bare = createLedger();
  const memory = await bare.addMemory({ text: 'a fact', evidence: 'a source', tags: ['t'] });
  void memory;

  // and the wired shape a host injects
  const ledger = createLedger({
    storage: createMemoryStorage(),
    compileQuery: compileJsonQuery,
    now: () => new Date().toISOString(),
  });
  const goal = await ledger.setGoal({ objective: 'finish the campaign' });
  void goal;
  const recalled = await ledger.recall({ tags: ['t'], limit: 5 });
  void recalled;
  const token: string = await ledger.snapshot();
  void (await ledger.rollback(token));
  const slot = await ledger.putSlot('transcript', 'text', { kind: 'transcript' });
  void slot;
  const content = await ledger.readSlot('transcript');
  void content;
}
void ledgerBlock;

// The ledger's record typedefs are the compiler-facing half of its
// schemas — added after the first strict-TS consumer (the tangleai
// rebuild, 2026-08-24) had to cast `addMemory`'s former `{}` return to
// read its own record back. This block is the promise that no consumer
// needs that cast again: the write unions narrow on `'error' in`, the
// reads carry the record shape, and a rejection is readable as itself.
import type { LedgerMemory, LedgerSkill, LedgerRejection } from '@tangleai/context/schemas/ledger';

async function ledgerTypedBlock() {
  const ledger = createLedger();

  const stored = await ledger.addMemory({ text: 'a fact', evidence: 'a source' });
  if ('errors' in stored) {
    const rejection: LedgerRejection = stored;
    const why: string = rejection.error;
    void why;
  }
  else {
    const record: LedgerMemory = stored;
    const evidence: string | import('@tangleai/context/schemas/evidence').ClaimEvidenceEnvelope = record.evidence;
    void evidence;
    // the vector pair is both-or-neither in the TYPE: narrowing on one
    // member settles the other, the way the schema's dependencies rule
    // settles it at the write
    if (record.embedding !== undefined) {
      const width: number = record.embeddedBy.dims;
      void width;
    }
  }
  // @ts-expect-error — an orphan vector does not type, just as the ledger refuses it
  void ledger.addMemory({ text: 'a fact', evidence: 'a source', embedding: [1, 2] });
  void ledger.addMemory({ text: 'a fact', evidence: 'a source', embedding: [1, 2], embeddedBy: { model: 'm', dims: 2 } });

  const recalled = await ledger.recall({ tags: ['t'] });
  if (Array.isArray(recalled)) {
    const newest: LedgerMemory | undefined = recalled[0];
    void newest?.at;
  }
  else if ('error' in recalled) {
    const why: string = recalled.error;
    void why;
  }
  else {
    // the ranked shape a `near` recall answers: memories, scores, skipped
    const scores: number[] = recalled.scores;
    const skipped: number = recalled.skipped;
    const exhaustive: boolean = recalled.ranking.exhaustive;
    const algorithm: string = recalled.ranking.algorithm;
    const candidateCount: number = recalled.ranking.candidateCount;
    void exhaustive; void algorithm; void candidateCount;
    void scores; void skipped;
  }

  const one = await ledger.getMemory('memory-1');
  const text: string | undefined = one?.text;
  void text;

  const skills = await ledger.listSkills();
  const firstSkill: LedgerSkill | undefined = skills[0];
  void firstSkill?.instructions;
}
void ledgerTypedBlock;

// Refinement policy is an explicit, closed option; arbitrary similarity policies refuse.
import { createRefiner as createQualityRefiner } from '@tangleai/agents/refine';
function qualityRefinerTypes(ledger: Parameters<typeof createQualityRefiner>[0]['ledger']) {
  createQualityRefiner({ ledger, client: {}, deduplicate: 'exact-evidence' });
  // @ts-expect-error — similarity alone cannot select a production deletion policy
  createQualityRefiner({ ledger, client: {}, deduplicate: 'cosine' });
}
void qualityRefinerTypes;


// @jarenjs/ai — compaction that moves: the agent takes the ledger, and
// the address scheme it writes is public so a host can read one back
// without re-deriving the syntax.
import { createAgent } from '@tangleai/agents/agent';
import { createRecallTool, slotAddressesIn } from '@tangleai/context/recall';
import { roundSlotName } from '@tangleai/context/recall';

async function recallBlock() {
  const ledger = createLedger();
  const agent = createAgent({
    client: { complete: async () => ({ message: { role: 'assistant', content: 'ok' } }) },
    historyBudget: 4000,
    ledger,
  });
  const sent = await agent.send([{ role: 'user', content: 'go' }]);
  const names: string[] = slotAddressesIn(String(sent.message.content));
  const name: string = roundSlotName('[]');
  const tool = createRecallTool(ledger);
  void (await tool.execute({ slot: names[0] ?? name }));
}
void recallBlock;


// @jarenjs/ai — the replay seam on both clients: a Map-backed adapter
// types as the option, sync or async, and a replay marks itself.
import { createChatClient } from '@tangleai/models/client';
import { createEmbeddingClient } from '@tangleai/models/embed';

async function replays(): Promise<number | undefined> {
  const store = new Map<string, unknown>();
  const cache = { get: (key: string) => store.get(key), set: async (key: string, value: unknown) => { store.set(key, value); } };
  const chat = createChatClient({ provider: 'ollama', model: 'qwen3:4b', cache });
  const embedder = createEmbeddingClient({ provider: 'ollama', model: 'nomic-embed-text', cache });
  const reply = await chat.complete({ messages: [{ role: 'user', content: 'hi' }] });
  const vectors: Float32Array[] = await embedder.embed(['hi']);
  void vectors;
  return reply.replayed?.ms;
}
void replays;

// The public client selects one token field without changing request budgets.
import { createChatClient as createWireChatClient } from '@tangleai/models/client';
const completionClient = createWireChatClient({
  provider: 'custom', baseUrl: 'https://api.openai.com/v1', model: 'fixture-model',
  maxTokens: 3000, maxTokensField: 'max_completion_tokens',
});
void completionClient.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 27 });
void createChatClient({ maxTokensField: 'max_tokens' });
// @ts-expect-error Responses API fields do not belong to Chat Completions.
void createWireChatClient({ maxTokensField: 'max_output_tokens' });


import { createProgramSession, questionFingerprint } from '@tangleai/agents/program-session';
import { createGrammarAuthor } from '@tangleai/models/grammar';
import { createRoutedClient } from '@tangleai/models/routing';
async function typedVerifiedProgram() {
  const ledger = createLedger();
  const fingerprint: string = await questionFingerprint('total');
  await ledger.addSkill({ name: 'total', when: 'total', instructions: 'run checked program',
    program: { version: 1, question: 'total', fingerprint, environmentId: 'env-v1',
      schemaVersion: 'program-v1', document: { steps: [] }, evidence: 'host outcome check', checked: true } });
  const session = createProgramSession({ environment: { ledger },
    author: { author: async () => ({ value: { steps: [] } }) },
    reuse: { environmentId: 'env-v1', schemaVersion: 'program-v1', check: () => true } });
  await session.run('total');
  // @ts-expect-error reuse must name the environment and full schema identity
  createProgramSession({ environment: { ledger }, reuse: { check: () => true } });
}
void [typedVerifiedProgram, createGrammarAuthor, createRoutedClient];


// Atomic lifecycle seams must remain available from packed declarations.
import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { validateClaimEvidence, createClaimRefiner } from '@tangleai/context/evidence';
import { ledgerFootprint, checkpointProgress } from '@tangleai/context/retention';
void createClaimRefiner; void checkpointProgress;
const guardedConsumer = createGuardedRefiner({ read: async () => ({ count: 1 }),
  validateProposal: () => true, apply: (doc, value) => ({ ...doc, count: value }),
  validateCandidate: () => true, planCommit: (doc) => doc, commit: async (doc) => doc });
void guardedConsumer.commit(2);
void validateClaimEvidence({});
void ledgerFootprint({});
const boundedLedger = createLedger({ archiveLimits: { maxItems: 10, maxBytes: 16384 },
  goalLimits: { maxEntries: 4, maxChars: 2048, maxBytes: 8192 } });
void boundedLedger.composeGoal(); void boundedLedger.retentionReport(); void boundedLedger.clearArchives();
void createMemoryStorage().mutate('test/', (current) => ({ next: current, result: 1 }));
// @ts-expect-error — an async callback is not an atomic storage transform
void createMemoryStorage().mutate('test/', async (current) => ({ next: current }));
// @ts-expect-error — limits are numbers, never a silent unlimited string
void createLedger({ goalLimits: { maxChars: '100' } });

void createLedger({ artifacts: [{ id: 'source', kind: 'slot', locator: 'round-1' }] });



import * as s from '@jarenjs/linq/schema';
import type { Infer } from '@jarenjs/linq/schema';
import type { ToolDef } from '@tangleai/agents/toolbox';
const User = s.object({ id: s.string().uuid(), name: s.string().min(1), age: s.integer().optional() });
const userTool: ToolDef = {
  name: 'user.create', description: 'Create a user', inputSchema: User.schema,
  execute: (input: Infer<typeof User>) => ({ created: input.id, name: input.name.toUpperCase() }),
};
void userTool;
