/**
 * The assistant's sentences in Dutch, formal (`u`), key for key with the
 * English catalogue: pass it as `messages` and every key renders Dutch. The
 * setting examples and product names stay as written; text another package
 * wrote still arrives verbatim inside `error/detail`.
 */
import type { AssistantCatalogue } from '../messages.ts';

const plural = new Intl.PluralRules('nl');
const number = new Intl.NumberFormat('nl-NL');
/** A count in Dutch digits with the noun form it takes. */
const count = (value: number, one: string, other: string) => `${number.format(value)} ${plural.select(value) === 'one' ? one : other}`;

export const nl = {
  'launcher/label': ' Assistent',
  'launcher/title': 'Assistent openen',
  'panel/title': 'Assistent',
  'panel/settings-title': 'Instellingen',
  'panel/settings-label': 'Instellingen van de assistent',
  'panel/clear-title': 'Het gesprek wissen',
  'panel/clear-label': 'Gesprek wissen',
  'panel/close-title': 'Sluiten',
  'panel/close-label': 'Assistent sluiten',
  'settings/hint': 'Verzoeken aan de provider gebruiken uw instellingen. Deze host bepaalt wat er lokaal wordt bewaard.',
  'settings/provider': 'Provider',
  'settings/api-key': 'API-sleutel',
  'settings/api-key-example': 'sk-…',
  'settings/base-url': 'Basis-URL',
  'settings/base-url-example': 'http://localhost:11434 · https://…/v1',
  'settings/model': 'Model',
  'settings/model-example': 'qwen/qwen3-4b · llama3.2 · …',
  'settings/save': 'Opslaan',
  'settings/test': 'Verbinding testen',
  'settings/testing': 'Bezig met testen…',
  'settings/probe-connected': (p: { count: number }) => `Verbonden — ${count(p.count, 'model', 'modellen')} beschikbaar.`,
  'provider/openrouter': 'OpenRouter',
  'provider/ollama': 'Ollama',
  'provider/lmstudio': 'LM Studio',
  'provider/custom': 'OpenAI-compatibel',
  'intro/text': 'Beschrijf wat u gedaan wilt krijgen. De assistent kan de tools gebruiken die deze host aanbiedt.',
  'intro/setup': 'Kies hierboven een provider, voeg een model toe (en een sleutel voor OpenRouter) en sla op — de chat opent dan meteen hier. Er gaat niets uw browser uit behalve de verzoeken aan de provider die u kiest.',
  'composer/placeholder': 'Vraag het de assistent…',
  'composer/send': 'Versturen',
  'composer/cancel': 'Annuleren',
  'activity/running': '{tool} wordt uitgevoerd',
  'activity/thinking': 'Aan het nadenken…',
  'activity/thinking-count': (p: { count: number }) => `Aan het nadenken… (${count(p.count, 'teken', 'tekens')} aan redenering)`,
  'goal/placeholder': 'Stel een doel in dat de assistent over sessies heen vasthoudt…',
  'goal/set': 'Instellen',
  'goal/objective': 'Doel',
  'goal/clear-title': 'Het doel wissen',
  'goal/clear-label': 'Het doel wissen',
  'goal/more': (p: { count: number }) => `…en nog ${count(p.count, 'eerdere vermelding', 'eerdere vermeldingen')}`,
  'goal/checkpoint': (p: { count: number }) => `${count(p.count, 'eerdere voortgangsvermelding', 'eerdere voortgangsvermeldingen')} bewaard met bijbehorend bewijs.`,
  'goal/remember': 'Deze sessie onthouden',
  'goal/remembering': 'Bezig met onthouden…',
  'ledger/memories': (p: { count: number }) => count(p.count, 'onthouden feit', 'onthouden feiten'),
  'ledger/storage-failed': 'Opslag mislukt: {detail}',
  'ledger/single-writer': 'Gebruik één tabblad tegelijk om onthouden gegevens bij te werken.',
  'ledger/evicted': (p: { count: number }) => `${count(p.count, 'eerder archiefadres', 'eerdere archiefadressen')} verwijderd vanwege het opslagbudget.`,
  'ledger/archived': (p: { count: number }) => plural.select(p.count) === 'one'
    ? `${count(p.count, 'eerdere ronde', 'eerdere rondes')} gearchiveerd — de assistent kan die terughalen met recall.`
    : `${count(p.count, 'eerdere ronde', 'eerdere rondes')} gearchiveerd — de assistent kan ze allemaal terughalen met recall.`,
  'note/send-unconfigured': 'Voeg eerst in de instellingen een provider, een model en (voor OpenRouter) een API-sleutel toe.',
  'note/reasoning-only': '*Het model heeft de hele beurt geredeneerd zonder eindantwoord — stuur nog een bericht om verder te gaan.*',
  'note/empty-reply': '*Het model beëindigde zijn beurt zonder antwoord — wat het heeft geladen staat op het scherm; stuur nog een bericht om verder te gaan.*',
  'note/remember-no-run': 'Er valt nog niets te onthouden — stuur eerst een bericht.',
  'note/remember-unconfigured': 'Voeg eerst in de instellingen een provider, een model en een sleutel toe.',
  'note/remember-refused': 'Er is niets opgeslagen — {detail}',
  'note/remember-nothing': 'De assistent vond in deze sessie niets wat het onthouden waard is.',
  'note/remembered': (p: { count: number }) => `${count(p.count, 'onderbouwd item', 'onderbouwde items')} onthouden.`,
  'note/settings-not-saved': 'De instellingen van de assistent konden niet worden opgeslagen.',
  'note/transcript-not-saved': 'Het gesprek met de assistent kon niet worden opgeslagen.',
  'error/detail': 'Fout: {detail}',
  'md/footnotes': 'Voetnoten',
  'view/status/idle': 'Klaar voor een nieuw verzoek.',
  'view/status/starting': 'Verzoek wordt verstuurd…',
  'view/status/running': 'Bezig…',
  'view/status/cancelling': 'Verzoek wordt geannuleerd…',
  'view/status/succeeded': 'De assistent heeft dit verzoek afgerond.',
  'view/status/failed': 'De assistent kon dit verzoek niet afronden.',
  'view/status/cancelled': 'Dit verzoek is geannuleerd.',
  'view/progress': (p: { step?: number, stage?: string }) => p.step === undefined ? p.stage ?? ''
    : p.stage ? `Stap ${number.format(p.step)} — ${p.stage}` : `Stap ${number.format(p.step)}`,
  'view/start-failed': (p: { detail?: string }) => p.detail ? `Het verzoek kon niet worden verstuurd: ${p.detail}` : 'Het verzoek kon niet worden verstuurd.',
  'view/cancel-failed': (p: { detail?: string }) => p.detail ? `Het verzoek kon niet worden geannuleerd: ${p.detail}` : 'Het verzoek kon niet worden geannuleerd.',
} satisfies Required<AssistantCatalogue>;
