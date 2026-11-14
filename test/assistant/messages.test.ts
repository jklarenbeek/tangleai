import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assistantMessagesEn, createAssistantMessages, type AssistantMessageKey } from '@tangleai/assistant/messages';
import { compileMessageCatalog } from '@jarenjs/core/message';
import { nl } from '@tangleai/assistant/messages/nl';
import { de } from '@tangleai/assistant/messages/de';
import { fr } from '@tangleai/assistant/messages/fr';
import { es } from '@tangleai/assistant/messages/es';
import { pt } from '@tangleai/assistant/messages/pt';
import { ar } from '@tangleai/assistant/messages/ar';
import { ja } from '@tangleai/assistant/messages/ja';
import { ko } from '@tangleai/assistant/messages/ko';
import { ru } from '@tangleai/assistant/messages/ru';
import { tr } from '@tangleai/assistant/messages/tr';
import { zhTW } from '@tangleai/assistant/messages/zh-tw';
import * as jarenPacks from '@jarenjs/locales';
import { mdMessagesEn } from '@jarenjs/md';
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
const parameters = (count: number) => ({ count, detail: '‹detail›', tool: '‹tool›', step: count, stage: '‹stage›', text: '‹text›', number: count, occurrence: count + 1 });

const PACKS = { nl, de, fr, es, pt, ar, ja, ko, ru, tr, zhTW };

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
        for (const value of [String(count), params.detail, params.tool, params.stage, params.text]) if (en.includes(value)) assert.ok(text.includes(value), `${key} renders ${value}`);
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
  assert.doesNotMatch(text(ru), words('ты|тебя|тебе|тобой|твой|твоя|твоё|твои|твоего|твоей|твоих', 'iu'));
  assert.match(text(ru), words('вы|вас|вам|ваш|ваши|вашего|вашей|ваших|вами', 'iu'));
  assert.doesNotMatch(text(tr), words('sen|seni|sana|senin|sende|senden|seninle', 'iu'));
  assert.match(text(tr), /\p{L}(?:ınız|iniz|unuz|ünüz)/u, 'Turkish says "your" with the formal plural');
  // Japanese, Korean and Chinese mark the register in endings and pronouns rather than in a word list
  assert.match(text(ja), /ください/); assert.match(text(ja), /ます。/);
  assert.doesNotMatch(text(ja), /君|お前|だよ|してね|しろ。/);
  assert.match(text(ko), /니다\./); assert.match(text(ko), /세요/);
  assert.doesNotMatch(text(ko), /너|해라|한다\.|했다\./);
  assert.match(text(zhTW), /您/);
  assert.doesNotMatch(text(zhTW), /你/);
});

it('Russian counts agree with the one, few and many forms', () => {
  const russian = createAssistantMessages(ru), at = (key: AssistantMessageKey) => [1, 2, 5, 11, 21, 22].map(count => russian[key]({ count }));
  assert.deepEqual(at('ledger/memories'), ['1 запомненный факт', '2 запомненных факта', '5 запомненных фактов', '11 запомненных фактов', '21 запомненный факт', '22 запомненных факта']);
  assert.deepEqual(at('note/remembered'), ['Запомнен 1 подтверждённый элемент.', 'Запомнено 2 подтверждённых элемента.', 'Запомнено 5 подтверждённых элементов.',
    'Запомнено 11 подтверждённых элементов.', 'Запомнен 21 подтверждённый элемент.', 'Запомнено 22 подтверждённых элемента.']);
  assert.deepEqual(at('settings/probe-connected').slice(0, 3), ['Подключено — доступна 1 модель.', 'Подключено — доступны 2 модели.', 'Подключено — доступно 5 моделей.']);
  assert.equal(russian['ledger/archived']({ count: 1 }), '1 предыдущий раунд заархивирован — ассистент может вернуть его с помощью recall.');
  assert.equal(russian['ledger/archived']({ count: 21 }), '21 предыдущий раунд заархивирован — ассистент может вернуть любой из них с помощью recall.', '21 is one in form, many in meaning');
});

it('each Markdown label reads as Jaren writes it in the same language', () => {
  const MD_KEYS = Object.keys(mdMessagesEn) as AssistantMessageKey[];
  const JAREN: Record<string, object> = { en: {}, nl: jarenPacks.nl, de: jarenPacks.de, fr: jarenPacks.fr, es: jarenPacks.es, pt: jarenPacks.pt, ar: jarenPacks.ar,
    ja: jarenPacks.ja, ko: jarenPacks.ko, ru: jarenPacks.ru, tr: jarenPacks.tr, zhTW: jarenPacks.zhTW };
  assert.deepEqual(Object.keys(JAREN).filter(lang => lang !== 'en'), Object.keys(PACKS), 'every Jaren pack has an assistant pack');
  for (const [lang, jaren] of Object.entries(JAREN)) {
    const ours = createAssistantMessages(lang === 'en' ? undefined : PACKS[lang as keyof typeof PACKS]);
    const theirs = compileMessageCatalog({ ...mdMessagesEn, ...Object.fromEntries(MD_KEYS.map(key => [key, (jaren as any)[key] ?? (mdMessagesEn as any)[key]])) }) as any;
    for (const key of MD_KEYS) assert.equal(ours[key](parameters(3)), theirs[key](parameters(3)), `${lang} ${key}`);
  }
});

it('each pack counts in its own plural and digits', () => {
  const counted = (pack: object, key: AssistantMessageKey, ...counts: number[]) => counts.map(count => createAssistantMessages(pack)[key]({ count }));
  assert.deepEqual(counted(de, 'ledger/memories', 1, 2), ['1 gemerkter Fakt', '2 gemerkte Fakten']);
  assert.deepEqual(counted(fr, 'ledger/memories', 0, 2), ['0 fait mémorisé', '2 faits mémorisés'], 'French counts 0 as singular');
  assert.deepEqual(counted(es, 'ledger/memories', 1, 2), ['1 dato recordado', '2 datos recordados']);
  assert.deepEqual(counted(pt, 'ledger/memories', 1, 2), ['1 fato lembrado', '2 fatos lembrados']);
  assert.deepEqual(counted(ar, 'ledger/memories', 1, 2, 11), ['عدد الحقائق المحفوظة: 1', 'عدد الحقائق المحفوظة: 2', 'عدد الحقائق المحفوظة: 11'], 'Arabic never agrees a noun with a number');
  assert.deepEqual([de, fr, es, pt, ar, ja, ko, ru, tr, zhTW].map(pack => counted(pack, 'activity/thinking-count', 1234)[0]), [
    'Denkt nach… (1.234 Zeichen an Überlegungen)', 'Réflexion… (1\u202f234 caractères de raisonnement)',
    'Pensando… (1234 caracteres de razonamiento)', 'Pensando… (1.234 caracteres de raciocínio)', 'جارٍ التفكير… (عدد أحرف الاستدلال: 1,234)',
    '考えています…（推論 1,234 文字）', '생각하는 중… (추론 1,234자)', 'Размышляет… (1\u00a0234 символа рассуждений)',
    'Düşünüyor… (1.234 karakterlik akıl yürütme)', '思考中…（推理 1,234 個字元）',
  ]);
  assert.deepEqual(counted(tr, 'ledger/memories', 1, 2), ['Hatırlanan 1 bilgi', 'Hatırlanan 2 bilgi'], 'Turkish keeps the noun singular after a number');
  assert.deepEqual([ja, ko, zhTW].map(pack => counted(pack, 'ledger/memories', 2)[0]), ['記憶した事実: 2 件', '기억된 사실 2개', '已記住 2 項事實'], 'counters, not plurals');
});

it('Dutch counts take the Dutch plural and digits', () => {
  const dutch = createAssistantMessages(nl);
  assert.deepEqual([1, 2].map(count => dutch['ledger/memories']({ count })), ['1 onthouden feit', '2 onthouden feiten']);
  assert.equal(dutch['activity/thinking-count']({ count: 1234 }), 'Aan het nadenken… (1.234 tekens aan redenering)');
  assert.equal(dutch['ledger/archived']({ count: 1 }), '1 eerdere ronde gearchiveerd — de assistent kan die terughalen met recall.');
  assert.deepEqual((dutch['activity/running'] as any).parameters, ['tool']);
});
