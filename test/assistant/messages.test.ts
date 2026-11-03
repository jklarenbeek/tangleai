import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assistantMessagesEn, createAssistantMessages, type AssistantMessageKey } from '@tangleai/assistant/messages';
import { nl } from '@tangleai/assistant/messages/nl';
import { NL_COGNATES } from './visible-text.ts';
import { createAssistantController } from '@tangleai/assistant';
import { mountAssistant, createAssistantWidget } from '@tangleai/assistant/component';

const store = () => ({ read: () => null, write: () => undefined });

it('a host catalogue renders its own text and English for every key it leaves out', () => {
  const messages = createAssistantMessages({ 'composer/send': 'Verstuur', 'ledger/storage-failed': 'Opslag mislukt: {detail}', 'goal/more': ({ count }: { count: number }) => `…en nog ${count}` });
  assert.equal(messages['composer/send'](), 'Verstuur');
  assert.equal(messages['ledger/storage-failed']({ detail: 'vol' }), 'Opslag mislukt: vol');
  assert.equal(messages['goal/more']({ count: 3 }), '…en nog 3');
  assert.equal(messages['composer/cancel'](), 'Cancel');
  assert.deepEqual(Object.keys(messages).sort(), Object.keys(assistantMessagesEn).sort());
});

it('an unknown message key is refused where the catalogue is built', () => {
  const messages = { 'composer/sned': 'Send' } as any, refused = { name: 'TypeError', message: 'unknown assistant message key: composer/sned' };
  assert.throws(() => createAssistantMessages(messages), refused);
  assert.throws(() => createAssistantController({ toolbox: {}, getApp: () => null, aiStorage: store(), aiChat: store(), ledger: {}, messages }), refused);
  assert.throws(() => mountAssistant(null, { messages }), refused);
  const widget = createAssistantWidget({ messages });
  assert.throws(() => widget.mount(null, {}), refused);
});

it('the English catalogue is compiled once and a built catalogue passes through', () => {
  const english = createAssistantMessages(), built = createAssistantMessages({ 'composer/send': 'Verstuur' });
  assert.equal(createAssistantMessages(), english);
  assert.equal(createAssistantMessages(built), built);
  assert.ok(Object.isFrozen(english) && Object.isFrozen(built));
  assert.deepEqual((english['activity/running'] as any).parameters, ['tool']);
  assert.equal(english['activity/running']({ tool: 'search' }), 'Running search');
});

it('counted messages read singular at one and as before at every other count', () => {
  const english = createAssistantMessages();
  const counted: Record<string, [string, string, string]> = {
    'activity/thinking-count': ['Thinking… (0 characters of reasoning)', 'Thinking… (1 character of reasoning)', 'Thinking… (2 characters of reasoning)'],
    'goal/more': ['…and 0 earlier entries', '…and 1 earlier entry', '…and 2 earlier entries'],
    'goal/checkpoint': ['0 earlier progress entries retained with their evidence.', '1 earlier progress entry retained with its evidence.', '2 earlier progress entries retained with their evidence.'],
    'ledger/memories': ['0 remembered facts', '1 remembered fact', '2 remembered facts'],
    'ledger/evicted': ['0 earlier archive address(es) evicted under the storage budget.', '1 earlier archive address evicted under the storage budget.', '2 earlier archive address(es) evicted under the storage budget.'],
    'ledger/archived': ['0 earlier rounds archived — the assistant can fetch any of them back with recall.', '1 earlier round archived — the assistant can fetch it back with recall.', '2 earlier rounds archived — the assistant can fetch any of them back with recall.'],
    'note/remembered': ['Remembered 0 evidenced items.', 'Remembered 1 evidenced item.', 'Remembered 2 evidenced items.'],
    'settings/probe-connected': ['Connected — 0 models available.', 'Connected — 1 model available.', 'Connected — 2 models available.'],
  };
  for (const [key, texts] of Object.entries(counted))
    assert.deepEqual([0, 1, 2].map(count => english[key as keyof typeof english]({ count })), texts, key);
});

it('the Dutch pack has exactly the English keys and differs from English except the pinned cognates', () => {
  assert.deepEqual(Object.keys(nl).sort(), Object.keys(assistantMessagesEn).sort());
  const english = createAssistantMessages(), dutch = createAssistantMessages(nl);
  const same = (Object.keys(assistantMessagesEn) as AssistantMessageKey[]).filter(key =>
    [0, 1, 2].some(count => dutch[key]({ count, detail: '‹detail›', tool: '‹tool›' }) === english[key]({ count, detail: '‹detail›', tool: '‹tool›' })));
  assert.deepEqual(same.sort(), Object.keys(NL_COGNATES).sort());
});

it('every Dutch message uses the parameters its English message uses', () => {
  const english = createAssistantMessages(), dutch = createAssistantMessages(nl);
  for (const key of Object.keys(assistantMessagesEn) as AssistantMessageKey[]) {
    const template = (english[key] as any).parameters;
    if (template !== undefined && (dutch[key] as any).parameters !== undefined) assert.deepEqual((dutch[key] as any).parameters, template, key);
    for (const count of [0, 1, 2, 7]) {
      const params = { count, detail: '‹detail›', tool: '‹tool›' }, en = english[key](params), text = dutch[key](params);
      assert.doesNotMatch(text, /[{}]|undefined|NaN/, key);
      for (const value of [String(count), params.detail, params.tool]) if (en.includes(value)) assert.ok(text.includes(value), `${key} renders ${value}`);
    }
  }
});

it('Dutch counts take the Dutch plural and digits', () => {
  const dutch = createAssistantMessages(nl);
  assert.deepEqual([1, 2].map(count => dutch['ledger/memories']({ count })), ['1 onthouden feit', '2 onthouden feiten']);
  assert.equal(dutch['activity/thinking-count']({ count: 1234 }), 'Aan het nadenken… (1.234 tekens aan redenering)');
  assert.equal(dutch['ledger/archived']({ count: 1 }), '1 eerdere ronde gearchiveerd — de assistent kan die terughalen met recall.');
  assert.deepEqual((dutch['activity/running'] as any).parameters, ['tool']);
});
