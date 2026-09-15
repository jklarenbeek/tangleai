/**
 * Direct use of an active directory, outside a run.
 *
 * The claim under test is the method's own: at inference time the whole
 * directory is preloaded and read, and there is no index between it and the
 * task. So the request is recorded and read — what its system slot carries,
 * which tools it offers — and the direct-use path is scanned for any reach
 * into a retrieval surface, because a request that looked right while the
 * code recalled a skill bank would still be the wrong method.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  EMPTY_SKILL_HEAD, activeBundle, composeSkillSystem, createMemoryTrace2SkillStore, importS0,
  skillReadTool, type SkillSnapshot, type Trace2SkillOutcome,
} from '@tangleai/trace2skill';
import { runTrace2SkillExample, type ExampleClient } from '../../examples/trace2skill.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const must = <T>(outcome: Trace2SkillOutcome<T>): T => {
  if (!outcome.valid) throw new Error(JSON.stringify(outcome.issues));
  return outcome.value;
};

const encoder = new TextEncoder();
const ROOT_PAGE = '# Scope\n\n## When to use\n\nWhenever the table is small.\n';
const REFERENCE = '# Notes\n\n- A decimal uses a period separator.\n';

async function stored(): Promise<{ store: ReturnType<typeof createMemoryTrace2SkillStore>, snapshot: SkillSnapshot }> {
  const store = createMemoryTrace2SkillStore();
  const snapshot = must(await importS0(store, [
    { path: 'SKILL.md', bytes: encoder.encode(ROOT_PAGE) },
    { path: 'references/notes.md', bytes: encoder.encode(REFERENCE) },
  ], { scopeKey: 'consume-scope' }));
  return { store, snapshot };
}

/** A client that answers once and keeps the request, so the request itself is the evidence. */
function recording(): ExampleClient & { requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    requests,
    endpoint: { provider: 'scripted' },
    async complete(request: unknown) {
      requests.push(request);
      return { message: { role: 'assistant', content: '3' }, finishReason: 'stop', usage: { total_tokens: 8 } };
    },
  };
}

it('the inference request carries the active root page and offers one skill tool', async () => {
  const client = recording();
  const result = await runTrace2SkillExample(client);
  assert.equal(result.answer, '3');
  assert.equal(result.headRevision, 1, 'the directory was not activated before it was used');
  assert.equal(client.requests.length, 1);

  const request = client.requests[0] as { messages: Array<{ role: string, content: string }>, tools: Array<{ function: { name: string } }> };
  assert.deepEqual(Object.keys(request).filter(key => key !== 'messages' && key !== 'tools' && !key.startsWith('on') && key !== 'signal'), [],
    'the request carries a member the direct path never sets');
  const system = request.messages.find(message => message.role === 'system');
  assert.ok(system !== undefined, 'the request carried no system message');
  // The bytes themselves, not a summary of them.
  assert.ok(system.content.includes('# Reading a small table'), 'the root page did not reach the request');
  assert.ok(system.content.includes('## Answer format'), 'the root page reached the request truncated');
  assert.equal(system.content, result.system);

  const tools = request.tools.map(tool => tool.function.name).sort();
  assert.deepEqual(tools, ['read_table', 'skill_read']);
  assert.deepEqual(tools.filter(name => name.startsWith('skill')), ['skill_read'],
    'a second skill surface reached the request');
  const body = JSON.stringify(request);
  for (const forbidden of ['recall', 'retriev', 'similarity', 'topK']) {
    assert.ok(!body.toLowerCase().includes(forbidden.toLowerCase()), `the request mentions ${forbidden}`);
  }
});

it('the direct-use path never reaches a retrieval surface', async () => {
  const files = [`${ROOT}examples/trace2skill.ts`];
  const dir = `${ROOT}packages/trace2skill/src`;
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(`${current}/${entry.name}`);
      else if (entry.name.endsWith('.ts')) files.push(`${current}/${entry.name}`);
    }
  };
  await walk(dir);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const forbidden of ['recallSkills', 'retrieval.skills', 'recallMemories']) {
      assert.ok(!source.includes(forbidden), `${file.slice(ROOT.length)} names ${forbidden}`);
    }
  }
});

it('the system text is the caller\'s own with the root page appended, and a directory with no root page is refused', async () => {
  const { snapshot } = await stored();
  assert.equal(must(composeSkillSystem('base', snapshot)), `base\n\n${ROOT_PAGE}`);
  assert.equal(must(composeSkillSystem('', snapshot)), ROOT_PAGE);
  assert.equal(must(composeSkillSystem('base', null)), 'base', 'the no-skill condition changed the caller\'s text');

  const empty: SkillSnapshot = { bundle: snapshot.bundle, files: snapshot.files.map(file => ({ ...file, content: null })) };
  const refused = composeSkillSystem('base', empty);
  assert.equal(refused.valid, false);
  assert.equal((refused as { valid: false, issues: Array<{ code: string }> }).issues[0].code, 'TT2S1005');
});

it('the skill tool reads the directory and refuses anything else', async () => {
  const { snapshot } = await stored();
  const tool = skillReadTool(snapshot);
  assert.equal(tool.name, 'skill_read');
  assert.deepEqual(tool.execute({ path: 'references/notes.md' }), { path: 'references/notes.md', content: REFERENCE });
  const missing = tool.execute({ path: 'references/absent.md' }) as { code?: string };
  assert.equal(missing.code, 'TT2S1005');
  assert.equal((tool.execute({ path: '../../etc/passwd' }) as { code?: string }).code, 'TT2S1005');

  // A page stored by address answers with its receipt rather than invented bytes.
  const addressed: SkillSnapshot = {
    bundle: snapshot.bundle,
    files: snapshot.files.map(file => (file.path === 'references/notes.md' ? { ...file, content: null } : file)),
  };
  const receipt = skillReadTool(addressed).execute({ path: 'references/notes.md' }) as Record<string, unknown>;
  assert.equal(receipt.content, undefined);
  assert.equal(receipt.sha256, snapshot.files.find(file => file.path === 'references/notes.md')?.sha256);
});

it('a scope with no active directory is a refusal, and an activated one reads back', async () => {
  const { store, snapshot } = await stored();
  const before = await activeBundle(store, 'consume-scope');
  assert.equal(before.valid, false);
  assert.equal((before as { valid: false, issues: Array<{ code: string }> }).issues[0].code, 'TT2S1010');

  must(await store.markBundle(snapshot.bundle.id, 'eligible'));
  must(await store.activate('consume-scope', EMPTY_SKILL_HEAD, snapshot.bundle.id));
  const active = must(await activeBundle(store, 'consume-scope'));
  assert.equal(active.bundle.id, snapshot.bundle.id);
  assert.equal(JSON.stringify(active.files), JSON.stringify(snapshot.files));
});
