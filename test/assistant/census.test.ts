import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createAssistantRules } from '../../components/assistant/src/views.ts';
import { ASSISTANT_STATES } from './state-matrix.ts';
import { INVENTORY, classify, isInventoried, ruleLiterals, visibleStrings, type TextClass } from './visible-text.ts';

const FIXTURE = new URL('../fixtures/assistant-visible-en.json', import.meta.url);
/** Visible text another package writes, with its owner. */
const FOREIGN: Record<string, string> = {
  'OpenRouter': '@tangleai/models provider label', 'Ollama': '@tangleai/models provider label',
  'LM Studio': '@tangleai/models provider label', 'OpenAI-compatible': '@tangleai/models provider label',
  'AI0002: HTTP 400 from http://localhost:11434/v1/chat/completions: ': '@tangleai/models transport failure',
  "AI0001: unknown provider 'unknown' (openrouter, ollama, lmstudio, custom)": '@tangleai/models provider resolution',
};

async function census() {
  const states: Record<string, { text: string, where: string, class: TextClass }[]> = {};
  for (const state of ASSISTANT_STATES) {
    const mounted = await state.render();
    try { states[state.name] = visibleStrings(mounted.container).map(seen => ({ ...seen, class: classify(seen.text) })); }
    finally { await mounted.handle.dispose(); }
  }
  return states;
}

it('the panel rules write 30 letter-bearing literals and 7 glyphs', () => {
  const literals = ruleLiterals(createAssistantRules('census'));
  assert.deepEqual(literals, [
    '✦', 'Settings', 'Assistant settings', '⚙', 'Clear the conversation', 'Clear conversation', '⌫', 'Close', 'Close assistant', '✕',
    'Provider', 'API key', 'sk-…', 'Base URL', 'http://localhost:11434 · https://…/v1', 'Model', 'qwen/qwen3-4b · llama3.2 · …',
    'Save', 'Testing…', 'Test connection', 'Objective', 'Clear the objective', 'Clear the objective', '✕', '…and ', ' earlier entries',
    'Remembering…', 'Remember this session', 'Set an objective the assistant keeps across sessions…', 'Set',
    'Pick a provider above, add a model (and a key for OpenRouter), then save — the chat opens right here. Nothing leaves your browser except the calls to the provider you choose.',
    'Running ', '…', 'Ask the assistant…', '…', 'Send', 'Cancel',
  ]);
  const lettered = literals.filter(text => /\p{L}/u.test(text));
  assert.deepEqual([lettered.length, literals.length - lettered.length], [30, 7]);
  assert.deepEqual(lettered.map(classify).filter(name => name === 'technical').length, 3);
});

it('the English render of every pinned state is the parity fixture', async t => {
  const first = await census(), second = await census();
  assert.equal(JSON.stringify(second), JSON.stringify(first), 'rendering is deterministic');
  if (process.env.TANGLE_WRITE_FIXTURES === '1') writeFileSync(FIXTURE, JSON.stringify(first, null, 2) + '\n');
  assert.deepEqual(first, JSON.parse(readFileSync(FIXTURE, 'utf8')));
  const totals: Record<string, { distinct: Set<string>, occurrences: number }> = {};
  for (const strings of Object.values(first)) for (const seen of strings) {
    const total = totals[seen.class] ??= { distinct: new Set(), occurrences: 0 };
    total.distinct.add(seen.text); total.occurrences++;
  }
  for (const [name, total] of Object.entries(totals).sort()) t.diagnostic(`${name}: ${total.distinct.size} distinct, ${total.occurrences} occurrences`);
});

it('every assistant-written literal appears in some pinned state', async () => {
  const seen = Object.values(await census()).flat();
  assert.equal(INVENTORY.length, 52);
  assert.deepEqual(INVENTORY.filter(entry => !seen.some(text => isInventoried(entry, text))).map(entry => entry.source), []);
});

it('visible text another package writes is named with its owner', async () => {
  const foreign = Object.values(await census()).flat().filter(seen => seen.class === 'foreign').map(seen => seen.text.replace(/‹h:[^›]+›/g, ''));
  assert.deepEqual([...new Set(foreign.filter(text => text !== ''))].sort(), Object.keys(FOREIGN).sort());
});
