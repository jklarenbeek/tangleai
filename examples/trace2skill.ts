/** Keyless direct use of an active skill directory: preloaded whole, with no retrieval index. */
import { createAgent, createToolbox } from '@tangleai/agents';
import {
  EMPTY_SKILL_HEAD, activeBundle, composeSkillSystem, createMemoryTrace2SkillStore, importS0,
  skillReadTool, type ImportedFile, type Trace2SkillOutcome,
} from '@tangleai/trace2skill';

const SCOPE = 'tabular-extract-example';
const QUESTION = 'How many rows does inventory.csv carry?';

const must = <T>(outcome: Trace2SkillOutcome<T>): T => {
  if (!outcome.valid) throw new Error(JSON.stringify(outcome.issues));
  return outcome.value;
};

/** A two-page directory: the root page a request carries, and one reference it can read. */
function directory(): ImportedFile[] {
  const encoder = new TextEncoder();
  const root = [
    '# Reading a small table',
    '',
    '## When to use',
    '',
    'Use this whenever a question counts or reads values out of a delimited table.',
    '',
    '## Reading the table',
    '',
    'The first line is a header and is never a row. Count the remaining non-empty lines.',
    'See `references/csv-conventions.md` for the separator rules.',
    '',
    '## Answer format',
    '',
    'Reply with the bare value: no sentence, no units, no restatement of the question.',
    '',
  ].join('\n');
  const reference = [
    '# Separator conventions',
    '',
    '- A decimal uses a period separator and no thousands separator.',
    '- A field containing the separator is quoted and counts as one field.',
    '',
  ].join('\n');
  return [
    { path: 'SKILL.md', bytes: encoder.encode(root) },
    { path: 'references/csv-conventions.md', bytes: encoder.encode(reference) },
  ];
}

export interface ExampleClient {
  endpoint?: { provider: string };
  complete(request: unknown): Promise<{ message: { role: string, content: string }, finishReason: string, usage: { total_tokens: number } }>;
}

/** Answers the one question from the table the tool hands it. No provider is constructed. */
function scriptedClient(): ExampleClient {
  return {
    endpoint: { provider: 'scripted' },
    async complete() {
      return { message: { role: 'assistant', content: '3' }, finishReason: 'stop', usage: { total_tokens: 32 } };
    },
  };
}

export interface ExampleResult {
  bundleId: string;
  headRevision: number;
  /** Exactly what the request's system slot carried, so a caller can prove what the model saw. */
  system: string;
  tools: string[];
  answer: string;
}

/**
 * Store a directory, make it the active one, and answer one question with it.
 *
 * The whole directory reaches the model two ways and no other: its root page
 * is composed into the system text as data, and the rest is behind one
 * read-only tool. Nothing is recalled, retrieved or ranked — there is no
 * index between the directory and the question, which is the point.
 */
export async function runTrace2SkillExample(client: ExampleClient = scriptedClient()): Promise<ExampleResult> {
  const store = createMemoryTrace2SkillStore();
  const imported = must(await importS0(store, directory(), { scopeKey: SCOPE }));

  // A directory serves a scope only after an explicit activation; storing one
  // never promotes it.
  must(await store.markBundle(imported.bundle.id, 'eligible'));
  const head = must(await store.activate(SCOPE, EMPTY_SKILL_HEAD, imported.bundle.id));

  const active = must(await activeBundle(store, SCOPE));
  const system = must(composeSkillSystem('You answer one question about the table named in the request.', active));

  const toolbox = createToolbox();
  toolbox.add({
    name: 'read_table',
    description: 'Read the one table this request names.',
    inputSchema: { type: 'object', required: ['path'], additionalProperties: false, properties: { path: { type: 'string', minLength: 1 } } },
    execute: ({ path }: { path: string }) => ({ path, content: 'sku,count\na-1,4\na-2,9\na-3,2\n' }),
  });
  toolbox.add(skillReadTool(active));

  const agent = createAgent({ client, toolbox, system, maxToolRounds: 2, budget: { turns: 4, tokens: 4096, ms: 10_000 } });
  const result = await agent.send([{ role: 'user', content: `${QUESTION}\n\nFiles named by this task:\n- inventory.csv` }]);

  return {
    bundleId: active.bundle.id,
    headRevision: head.revision,
    system,
    tools: toolbox.list().map((tool: { name: string }) => tool.name),
    answer: String(result.message?.content ?? '').trim(),
  };
}

if (import.meta.filename === process.argv[1]) {
  const result = await runTrace2SkillExample();
  process.stdout.write(JSON.stringify({
    bundleId: result.bundleId, headRevision: result.headRevision,
    tools: result.tools, systemChars: result.system.length, answer: result.answer,
  }) + '\n');
}
