/**
 * Every sentence the assistant shows a person, keyed by where it renders. A host
 * catalogue merges over the English one with the suite's message contract: a
 * missing key renders English, an unknown key is refused when the catalogue is
 * built. Text another package wrote reaches the screen through `error/detail`.
 */
import { compileMessageCatalog } from '@jarenjs/core/message';

type Entry = string | ((params: any) => string);
export type AssistantCatalogue = Partial<Record<AssistantMessageKey, Entry>>;
export type AssistantMessageKey = keyof typeof assistantMessagesEn;
export type AssistantMessages = Readonly<Record<AssistantMessageKey, (params?: any) => string>>;

const plural = new Intl.PluralRules('en');
const one = (count: number) => plural.select(count) === 'one';

export const assistantMessagesEn = {
  'launcher/label': ' Assistant',
  'launcher/title': 'Open assistant',
  'panel/title': 'Assistant',
  'panel/settings-title': 'Settings',
  'panel/settings-label': 'Assistant settings',
  'panel/clear-title': 'Clear the conversation',
  'panel/clear-label': 'Clear conversation',
  'panel/close-title': 'Close',
  'panel/close-label': 'Close assistant',
  'settings/hint': 'Provider requests use your settings. This host controls local persistence.',
  'settings/provider': 'Provider',
  'settings/api-key': 'API key',
  'settings/api-key-example': 'sk-…',
  'settings/base-url': 'Base URL',
  'settings/base-url-example': 'http://localhost:11434 · https://…/v1',
  'settings/model': 'Model',
  'settings/model-example': 'qwen/qwen3-4b · llama3.2 · …',
  'settings/save': 'Save',
  'settings/test': 'Test connection',
  'settings/testing': 'Testing…',
  'settings/probe-connected': ({ count }: { count: number }) => `Connected — ${count} model${one(count) ? '' : 's'} available.`,
  'provider/openrouter': 'OpenRouter',
  'provider/ollama': 'Ollama',
  'provider/lmstudio': 'LM Studio',
  'provider/custom': 'OpenAI-compatible',
  'intro/text': 'Describe what you want to get done. The assistant can use the tools this host provides.',
  'intro/setup': 'Pick a provider above, add a model (and a key for OpenRouter), then save — the chat opens right here. Nothing leaves your browser except the calls to the provider you choose.',
  'composer/placeholder': 'Ask the assistant…',
  'composer/send': 'Send',
  'composer/cancel': 'Cancel',
  'activity/running': 'Running {tool}',
  'activity/thinking': 'Thinking…',
  'activity/thinking-count': ({ count }: { count: number }) => `Thinking… (${count} character${one(count) ? '' : 's'} of reasoning)`,
  'goal/placeholder': 'Set an objective the assistant keeps across sessions…',
  'goal/set': 'Set',
  'goal/objective': 'Objective',
  'goal/clear-title': 'Clear the objective',
  'goal/clear-label': 'Clear the objective',
  'goal/more': ({ count }: { count: number }) => `…and ${count} earlier ${one(count) ? 'entry' : 'entries'}`,
  'goal/checkpoint': ({ count }: { count: number }) => one(count)
    ? `${count} earlier progress entry retained with its evidence.`
    : `${count} earlier progress entries retained with their evidence.`,
  'goal/remember': 'Remember this session',
  'goal/remembering': 'Remembering…',
  'ledger/memories': ({ count }: { count: number }) => `${count} remembered fact${one(count) ? '' : 's'}`,
  'ledger/storage-failed': 'Storage failed: {detail}',
  'ledger/single-writer': 'Use one tab at a time to update remembered state.',
  'ledger/evicted': ({ count }: { count: number }) => `${count} earlier archive ${one(count) ? 'address' : 'address(es)'} evicted under the storage budget.`,
  'ledger/archived': ({ count }: { count: number }) => one(count)
    ? `${count} earlier round archived — the assistant can fetch it back with recall.`
    : `${count} earlier rounds archived — the assistant can fetch any of them back with recall.`,
  'note/send-unconfigured': 'Add a provider, model and (for OpenRouter) an API key in settings first.',
  'note/reasoning-only': '*The model spent the whole turn reasoning without a final reply — send another message to continue.*',
  'note/empty-reply': '*The model ended its turn without a reply — whatever it loaded is on screen; send another message to continue.*',
  'note/remember-no-run': 'Nothing to remember yet — send a message first.',
  'note/remember-unconfigured': 'Add a provider, model and key in settings first.',
  'note/remember-refused': 'Nothing was stored — {detail}',
  'note/remember-nothing': 'The assistant found nothing worth remembering from this session.',
  'note/remembered': ({ count }: { count: number }) => `Remembered ${count} evidenced item${one(count) ? '' : 's'}.`,
  'note/settings-not-saved': 'Assistant settings could not be saved.',
  'note/transcript-not-saved': 'The assistant transcript could not be saved.',
  'error/detail': '{detail}',
  'md/footnotes': 'Footnotes',
  'view/status/idle': 'Ready for a new run.',
  'view/status/starting': 'Starting the run…',
  'view/status/running': 'Working…',
  'view/status/cancelling': 'Cancelling the run…',
  'view/status/succeeded': 'The assistant finished this run.',
  'view/status/failed': 'The assistant could not finish this run.',
  'view/status/cancelled': 'This run was cancelled.',
  'view/progress': ({ step, stage }: { step?: number, stage?: string }) => step === undefined ? stage ?? ''
    : stage ? `Step ${step} — ${stage}` : `Step ${step}`,
  'view/start-failed': (p: { detail?: string }) => p.detail ? `The run could not be started: ${p.detail}` : 'The run could not be started.',
  'view/cancel-failed': (p: { detail?: string }) => p.detail ? `The run could not be cancelled: ${p.detail}` : 'The run could not be cancelled.',
};

const built = new WeakSet<object>();
function build(catalogue: AssistantCatalogue) {
  const messages = compileMessageCatalog({ ...assistantMessagesEn, ...catalogue } as Record<string, Entry>) as AssistantMessages;
  built.add(messages);
  return messages;
}
const english = build({});

/** Compile a host catalogue over English once; a built catalogue passes through unchanged. */
export function createAssistantMessages(catalogue?: AssistantCatalogue | AssistantMessages): AssistantMessages {
  if (catalogue === undefined) return english;
  if (built.has(catalogue)) return catalogue as AssistantMessages;
  for (const key of Object.keys(catalogue))
    if (!Object.hasOwn(assistantMessagesEn, key)) throw new TypeError(`unknown assistant message key: ${key}`);
  return build(catalogue as AssistantCatalogue);
}
