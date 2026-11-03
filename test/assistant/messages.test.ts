import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assistantMessagesEn, createAssistantMessages, type AssistantMessageKey } from '@tangleai/assistant/messages';
import { nl } from '@tangleai/assistant/messages/nl';
import { de } from '@tangleai/assistant/messages/de';
import { fr } from '@tangleai/assistant/messages/fr';
import { es } from '@tangleai/assistant/messages/es';
import { pt } from '@tangleai/assistant/messages/pt';
import { ar } from '@tangleai/assistant/messages/ar';
import { COGNATES } from './visible-text.ts';
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

/** Every parameter some message reads, so no message renders empty in both languages. @param count */
const parameters = (count: number) => ({ count, detail: '‹detail›', tool: '‹tool›', step: count, stage: '‹stage›' });

const PACKS = { nl, de, fr, es, pt, ar };

for (const [lang, pack] of Object.entries(PACKS) as [keyof typeof PACKS, object][]) {
  it(`the ${lang} pack has exactly the English keys and differs from English except its pinned cognates`, () => {
    assert.deepEqual(Object.keys(pack).sort(), Object.keys(assistantMessagesEn).sort());
    const english = createAssistantMessages(), translated = createAssistantMessages(pack);
    const same = (Object.keys(assistantMessagesEn) as AssistantMessageKey[]).filter(key =>
      [0, 1, 2].some(count => translated[key](parameters(count)) === english[key](parameters(count))));
    assert.deepEqual(same.sort(), Object.keys(COGNATES[lang]).sort());
  });

  it(`every ${lang} message uses the parameters its English message uses`, () => {
    const english = createAssistantMessages(), translated = createAssistantMessages(pack);
    for (const key of Object.keys(assistantMessagesEn) as AssistantMessageKey[]) {
      const template = (english[key] as any).parameters;
      if (template !== undefined && (translated[key] as any).parameters !== undefined) assert.deepEqual((translated[key] as any).parameters, template, key);
      for (const count of [0, 1, 2, 7]) {
        const params = parameters(count), en = english[key](params), text = translated[key](params);
        assert.doesNotMatch(text, /[{}]|undefined|NaN/, key);
        for (const value of [String(count), params.detail, params.tool, params.stage]) if (en.includes(value)) assert.ok(text.includes(value), `${key} renders ${value}`);
      }
    }
  });
}

it('every pack addresses the person formally', () => {
  const text = (pack: object) => Object.values(createAssistantMessages(pack)).map(message => message(parameters(2))).join('\n');
  // whole words only: an accented letter is part of a word (`requêtes` holds no `tes`)
  const words = (list: string, flags = 'u') => new RegExp(`(?<!\\p{L})(?:${list})(?!\\p{L})`, flags);
  assert.doesNotMatch(text(nl), words('je|jij|jou|jouw', 'iu'));
  assert.match(text(nl), words('u|uw'));
  assert.doesNotMatch(text(de), words('du|dich|dir|dein|deine|deinen|deiner'));
  assert.match(text(de), words('Sie|Ihr|Ihre|Ihren'));
  assert.doesNotMatch(text(fr), words('tu|toi|ton|ta|tes'));
  assert.match(text(fr), words('vous|votre'));
  assert.doesNotMatch(text(es), words('tú|tu|tus|ti|te', 'iu'));
  assert.match(text(es), words('su|usted'));
});

it('each pack counts in its own plural and digits', () => {
  const counted = (pack: object, key: AssistantMessageKey, ...counts: number[]) => counts.map(count => createAssistantMessages(pack)[key]({ count }));
  assert.deepEqual(counted(de, 'ledger/memories', 1, 2), ['1 gemerkter Fakt', '2 gemerkte Fakten']);
  assert.deepEqual(counted(fr, 'ledger/memories', 0, 2), ['0 fait mémorisé', '2 faits mémorisés'], 'French counts 0 as singular');
  assert.deepEqual(counted(es, 'ledger/memories', 1, 2), ['1 dato recordado', '2 datos recordados']);
  assert.deepEqual(counted(pt, 'ledger/memories', 1, 2), ['1 fato lembrado', '2 fatos lembrados']);
  assert.deepEqual(counted(ar, 'ledger/memories', 1, 2, 11), ['عدد الحقائق المحفوظة: 1', 'عدد الحقائق المحفوظة: 2', 'عدد الحقائق المحفوظة: 11'], 'Arabic never agrees a noun with a number');
  assert.deepEqual([de, fr, es, pt, ar].map(pack => counted(pack, 'activity/thinking-count', 1234)[0]), [
    'Denkt nach… (1.234 Zeichen an Überlegungen)', 'Réflexion… (1\u202f234 caractères de raisonnement)',
    'Pensando… (1234 caracteres de razonamiento)', 'Pensando… (1.234 caracteres de raciocínio)', 'جارٍ التفكير… (عدد أحرف الاستدلال: 1,234)',
  ]);
});

it('Dutch counts take the Dutch plural and digits', () => {
  const dutch = createAssistantMessages(nl);
  assert.deepEqual([1, 2].map(count => dutch['ledger/memories']({ count })), ['1 onthouden feit', '2 onthouden feiten']);
  assert.equal(dutch['activity/thinking-count']({ count: 1234 }), 'Aan het nadenken… (1.234 tekens aan redenering)');
  assert.equal(dutch['ledger/archived']({ count: 1 }), '1 eerdere ronde gearchiveerd — de assistent kan die terughalen met recall.');
  assert.deepEqual((dutch['activity/running'] as any).parameters, ['tool']);
});
