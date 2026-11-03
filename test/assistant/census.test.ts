import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assistantMessagesEn } from '@tangleai/assistant/messages';
import { createAssistantRules } from '../../components/assistant/src/views.ts';
import { stringLiterals } from '../import-specifiers.ts';
import { ASSISTANT_STATES } from './state-matrix.ts';
import { classify, ruleLiterals, sentinelMessages, textRuns, visibleStrings, type VisibleString } from './visible-text.ts';

/** The English render as first pinned (its classes are that census's), and each reviewed change since. */
const FIXTURE: { states: Record<string, VisibleString[]>, deltas: { name: string, state: string, reason: string, was: VisibleString, now: VisibleString }[] }
  = JSON.parse(readFileSync(new URL('../fixtures/assistant-visible-en.json', import.meta.url), 'utf8'));
const KEYS = Object.keys(assistantMessagesEn);
/** Text another package writes that reaches the screen as a message's detail, with its owner. */
const FOREIGN: Record<string, string> = {
  'AI0002: HTTP 400 from http://localhost:11434/v1/chat/completions: ': '@tangleai/models transport failure',
  "AI0001: unknown provider 'unknown' (openrouter, ollama, lmstudio, custom)": '@tangleai/models provider resolution',
  'the model did not produce an applicable refinement': '@tangleai/agents refinement outcome',
};
/** The controller's only prose outside the catalogue: it is written to the model, never shown. */
const MODEL_FACING = ['The assistant turn was cancelled.', 'Help the user complete their task using the available tools.'];

async function render(messages?: object) {
  const states: Record<string, VisibleString[]> = {};
  for (const state of ASSISTANT_STATES) {
    const mounted = await state.render(messages);
    try { states[state.name] = visibleStrings(mounted.container); }
    finally { await mounted.handle.dispose(); }
  }
  return states;
}
let sentinelRender: Promise<Record<string, VisibleString[]>> | undefined;
const sentinel = async () => Object.values(await (sentinelRender ??= render(sentinelMessages(KEYS)))).flat()
  .map(seen => ({ ...seen, ...classify(seen.text) }));

it('the panel rules write glyphs only', () => {
  assert.deepEqual(ruleLiterals(createAssistantRules('census')), ['✦', '⚙', '⌫', '✕', '✕', '…', '…']);
});

it('the English render of every pinned state is the parity fixture with its reviewed changes', async () => {
  const first = await render(), second = await render();
  assert.equal(JSON.stringify(second), JSON.stringify(first), 'rendering is deterministic');
  const expected = Object.fromEntries(Object.entries(FIXTURE.states).map(([name, strings]) => [name, textRuns(strings)]));
  for (const delta of FIXTURE.deltas) {
    const runs = expected[delta.state]!, at = runs.map((run, index) => run.text === delta.was.text && run.where === delta.was.where ? index : -1).filter(index => index >= 0);
    assert.equal(at.length, 1, `${delta.name}: the pinned text appears once in ${delta.state}`);
    runs[at[0]!] = delta.now;
  }
  assert.deepEqual(Object.fromEntries(Object.entries(first).map(([name, strings]) => [name, textRuns(strings)])), expected);
});

it('with a key-sentinel catalogue no text outside the catalogue remains', async t => {
  const census = await sentinel();
  assert.deepEqual(census.filter(seen => seen.class === 'unframed').map(seen => `${seen.where}: ${seen.text}`), []);
  const totals: Record<string, { distinct: Set<string>, occurrences: number }> = {};
  for (const seen of census) {
    const total = totals[seen.class] ??= { distinct: new Set(), occurrences: 0 };
    total.distinct.add(seen.text); total.occurrences++;
  }
  for (const [name, total] of Object.entries(totals).sort()) t.diagnostic(`${name}: ${total.distinct.size} distinct, ${total.occurrences} occurrences`);
});

it('every catalogue message renders in some pinned state', async () => {
  const seen = new Set((await sentinel()).flatMap(entry => entry.keys));
  assert.deepEqual(KEYS.filter(key => !seen.has(key)), []);
  assert.deepEqual([...seen].filter(key => !KEYS.includes(key)), []);
});

it('text another package writes is shown inside a message and named with its owner', async () => {
  const details = (await sentinel()).flatMap(entry => entry.details).map(text => text.replace(/‹h:[^›]+›/g, ''));
  assert.deepEqual([...new Set(details.filter(text => text !== ''))].sort(), Object.keys(FOREIGN).sort());
});

it('the controller, projection and component keep no prose outside the catalogue', () => {
  const prose = ['controller.ts', 'viewmodel.ts', 'component.ts']
    .flatMap(name => stringLiterals(fileURLToPath(new URL(`../../components/assistant/src/${name}`, import.meta.url))))
    .filter(text => /\p{L} \p{L}/u.test(text));
  assert.deepEqual(prose, MODEL_FACING);
});
