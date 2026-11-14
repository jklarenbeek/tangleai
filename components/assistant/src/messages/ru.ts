/**
 * The assistant's sentences in Russian, formal (`вы`), key for key with the
 * English catalogue: pass it as `messages` with `lang: 'ru'`, and every key
 * renders Russian. Russian counts split one/few/many (1 факт, 2 факта,
 * 5 фактов, 21 факт) and the words around a count agree with it, so a counted
 * message is written whole for each category; digits group with a no-break
 * space, as the suite's own Russian pack does. The setting examples and
 * product names stay as written; text another package wrote still arrives
 * verbatim inside `error/detail`.
 */
import type { AssistantCatalogue } from '../messages.ts';

const plural = new Intl.PluralRules('ru');
const number = new Intl.NumberFormat('ru-RU');
const num = (value: number) => number.format(value);
type Forms = { one: (n: string) => string, few: (n: string) => string, many: (n: string) => string };
/** The text for the count's plural category; a fraction reads like `few`, as Russian writes `1,5 факта`. */
const counted = (value: number, forms: Forms) => {
  const category = plural.select(value);
  return (category === 'one' ? forms.one : category === 'many' ? forms.many : forms.few)(num(value));
};

export const ru = {
  'launcher/label': ' Ассистент',
  'launcher/title': 'Открыть ассистента',
  'panel/title': 'Ассистент',
  'panel/settings-title': 'Настройки',
  'panel/settings-label': 'Настройки ассистента',
  'panel/clear-title': 'Очистить беседу',
  'panel/clear-label': 'Очистить беседу',
  'panel/close-title': 'Закрыть',
  'panel/close-label': 'Закрыть ассистента',
  'settings/hint': 'Запросы к провайдеру используют ваши настройки. Что хранится локально, решает этот хост.',
  'settings/provider': 'Провайдер',
  'settings/api-key': 'API-ключ',
  'settings/api-key-example': 'sk-…',
  'settings/base-url': 'Базовый URL',
  'settings/base-url-example': 'http://localhost:11434 · https://…/v1',
  'settings/model': 'Модель',
  'settings/model-example': 'qwen/qwen3-4b · llama3.2 · …',
  'settings/save': 'Сохранить',
  'settings/test': 'Проверить подключение',
  'settings/testing': 'Проверка…',
  'settings/probe-connected': (p: { count: number }) => counted(p.count, {
    one: n => `Подключено — доступна ${n} модель.`,
    few: n => `Подключено — доступны ${n} модели.`,
    many: n => `Подключено — доступно ${n} моделей.`,
  }),
  'provider/openrouter': 'OpenRouter',
  'provider/ollama': 'Ollama',
  'provider/lmstudio': 'LM Studio',
  'provider/custom': 'Совместимый с OpenAI',
  'intro/text': 'Опишите, что вы хотите сделать. Ассистент может использовать инструменты, которые предоставляет этот хост.',
  'intro/setup': 'Выберите провайдера выше, добавьте модель (и ключ для OpenRouter) и сохраните — чат откроется прямо здесь. Из вашего браузера ничего не уходит, кроме запросов к выбранному вами провайдеру.',
  'composer/placeholder': 'Спросите ассистента…',
  'composer/send': 'Отправить',
  'composer/cancel': 'Отмена',
  'activity/running': 'Выполняется {tool}',
  'activity/thinking': 'Размышляет…',
  'activity/thinking-count': (p: { count: number }) => counted(p.count, {
    one: n => `Размышляет… (${n} символ рассуждений)`,
    few: n => `Размышляет… (${n} символа рассуждений)`,
    many: n => `Размышляет… (${n} символов рассуждений)`,
  }),
  'goal/placeholder': 'Задайте цель, которую ассистент сохранит между сеансами…',
  'goal/set': 'Задать',
  'goal/objective': 'Цель',
  'goal/clear-title': 'Очистить цель',
  'goal/clear-label': 'Очистить цель',
  'goal/more': (p: { count: number }) => counted(p.count, {
    one: n => `…и ещё ${n} предыдущая запись`,
    few: n => `…и ещё ${n} предыдущие записи`,
    many: n => `…и ещё ${n} предыдущих записей`,
  }),
  'goal/checkpoint': (p: { count: number }) => counted(p.count, {
    one: n => `${n} предыдущая запись о ходе работы сохранена вместе со своими подтверждениями.`,
    few: n => `${n} предыдущие записи о ходе работы сохранены вместе со своими подтверждениями.`,
    many: n => `${n} предыдущих записей о ходе работы сохранено вместе со своими подтверждениями.`,
  }),
  'goal/remember': 'Запомнить этот сеанс',
  'goal/remembering': 'Запоминание…',
  'ledger/memories': (p: { count: number }) => counted(p.count, {
    one: n => `${n} запомненный факт`,
    few: n => `${n} запомненных факта`,
    many: n => `${n} запомненных фактов`,
  }),
  'ledger/storage-failed': 'Ошибка хранилища: {detail}',
  'ledger/single-writer': 'Чтобы обновить запомненные данные, используйте только одну вкладку за раз.',
  'ledger/evicted': (p: { count: number }) => counted(p.count, {
    one: n => `${n} прежний адрес архива удалён из-за ограничения хранилища.`,
    few: n => `${n} прежних адреса архива удалены из-за ограничения хранилища.`,
    many: n => `${n} прежних адресов архива удалено из-за ограничения хранилища.`,
  }),
  'ledger/archived': (p: { count: number }) => counted(p.count, {
    // 'one' also holds 21, 31…: only a single round is "его"
    one: n => `${n} предыдущий раунд заархивирован — ассистент может вернуть ${p.count === 1 ? 'его' : 'любой из них'} с помощью recall.`,
    few: n => `${n} предыдущих раунда заархивированы — ассистент может вернуть любой из них с помощью recall.`,
    many: n => `${n} предыдущих раундов заархивировано — ассистент может вернуть любой из них с помощью recall.`,
  }),
  'note/send-unconfigured': 'Сначала добавьте в настройках провайдера, модель и (для OpenRouter) API-ключ.',
  'note/reasoning-only': '*Модель потратила весь ход на рассуждения и не дала окончательного ответа — отправьте ещё одно сообщение, чтобы продолжить.*',
  'note/empty-reply': '*Модель завершила ход без ответа — всё, что она загрузила, показано на экране; отправьте ещё одно сообщение, чтобы продолжить.*',
  'note/remember-no-run': 'Пока нечего запоминать — сначала отправьте сообщение.',
  'note/remember-unconfigured': 'Сначала добавьте в настройках провайдера, модель и ключ.',
  'note/remember-refused': 'Ничего не сохранено — {detail}',
  'note/remember-nothing': 'Ассистент не нашёл в этом сеансе ничего, что стоило бы запомнить.',
  'note/remembered': (p: { count: number }) => counted(p.count, {
    one: n => `Запомнен ${n} подтверждённый элемент.`,
    few: n => `Запомнено ${n} подтверждённых элемента.`,
    many: n => `Запомнено ${n} подтверждённых элементов.`,
  }),
  'note/settings-not-saved': 'Не удалось сохранить настройки ассистента.',
  'note/transcript-not-saved': 'Не удалось сохранить переписку с ассистентом.',
  'error/detail': 'Ошибка: {detail}',
  'md/footnotes': 'Сноски',
  'md/page-break': 'Разрыв страницы',
  'md/permalink': 'Постоянная ссылка на раздел "{text}"',
  'md/permalink-section': 'Постоянная ссылка на этот раздел',
  'md/backref': 'Вернуться к месту ссылки {number}',
  'md/backref-occurrence': 'Вернуться к месту ссылки {number}, вхождение {occurrence}',
  'view/status/idle': 'Готов к новому запуску.',
  'view/status/starting': 'Запуск…',
  'view/status/running': 'Выполняется…',
  'view/status/cancelling': 'Отмена запуска…',
  'view/status/succeeded': 'Ассистент завершил этот запуск.',
  'view/status/failed': 'Ассистенту не удалось завершить этот запуск.',
  'view/status/cancelled': 'Этот запуск отменён.',
  'view/progress': (p: { step?: number, stage?: string }) => p.step === undefined ? p.stage ?? ''
    : p.stage ? `Шаг ${num(p.step)} — ${p.stage}` : `Шаг ${num(p.step)}`,
  'view/start-failed': (p: { detail?: string }) => p.detail ? `Не удалось запустить выполнение: ${p.detail}` : 'Не удалось запустить выполнение.',
  'view/cancel-failed': (p: { detail?: string }) => p.detail ? `Не удалось отменить выполнение: ${p.detail}` : 'Не удалось отменить выполнение.',
} satisfies Required<AssistantCatalogue>;
