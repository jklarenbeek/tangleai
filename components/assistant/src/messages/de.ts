/**
 * The assistant's sentences in German, formal (`Sie`), key for key with the
 * English catalogue: pass it as `messages` and every key renders German. The
 * setting examples and product names stay as written; text another package
 * wrote still arrives verbatim inside `error/detail`.
 */
import type { AssistantCatalogue } from '../messages.ts';

const plural = new Intl.PluralRules('de');
const number = new Intl.NumberFormat('de-DE');
/** A count in German digits with the noun form it takes. */
const count = (value: number, one: string, other: string) => `${number.format(value)} ${plural.select(value) === 'one' ? one : other}`;

export const de = {
  'launcher/label': ' Assistent',
  'launcher/title': 'Assistenten öffnen',
  'panel/title': 'Assistent',
  'panel/settings-title': 'Einstellungen',
  'panel/settings-label': 'Einstellungen des Assistenten',
  'panel/clear-title': 'Die Unterhaltung löschen',
  'panel/clear-label': 'Unterhaltung löschen',
  'panel/close-title': 'Schließen',
  'panel/close-label': 'Assistenten schließen',
  'settings/hint': 'Anfragen an den Anbieter verwenden Ihre Einstellungen. Dieser Host legt fest, was lokal gespeichert wird.',
  'settings/provider': 'Anbieter',
  'settings/api-key': 'API-Schlüssel',
  'settings/api-key-example': 'sk-…',
  'settings/base-url': 'Basis-URL',
  'settings/base-url-example': 'http://localhost:11434 · https://…/v1',
  'settings/model': 'Modell',
  'settings/model-example': 'qwen/qwen3-4b · llama3.2 · …',
  'settings/save': 'Speichern',
  'settings/test': 'Verbindung testen',
  'settings/testing': 'Wird getestet…',
  'settings/probe-connected': (p: { count: number }) => `Verbunden — ${count(p.count, 'Modell', 'Modelle')} verfügbar.`,
  'provider/openrouter': 'OpenRouter',
  'provider/ollama': 'Ollama',
  'provider/lmstudio': 'LM Studio',
  'provider/custom': 'OpenAI-kompatibel',
  'intro/text': 'Beschreiben Sie, was Sie erledigen möchten. Der Assistent kann die Werkzeuge nutzen, die dieser Host bereitstellt.',
  'intro/setup': 'Wählen Sie oben einen Anbieter, fügen Sie ein Modell hinzu (und für OpenRouter einen Schlüssel) und speichern Sie — der Chat öffnet sich dann direkt hier. Ihr Browser sendet nichts außer den Anfragen an den Anbieter, den Sie wählen.',
  'composer/placeholder': 'Fragen Sie den Assistenten…',
  'composer/send': 'Senden',
  'composer/cancel': 'Abbrechen',
  'activity/running': '{tool} wird ausgeführt',
  'activity/thinking': 'Denkt nach…',
  'activity/thinking-count': (p: { count: number }) => `Denkt nach… (${count(p.count, 'Zeichen', 'Zeichen')} an Überlegungen)`,
  'goal/placeholder': 'Legen Sie ein Ziel fest, das der Assistent über Sitzungen hinweg beibehält…',
  'goal/set': 'Festlegen',
  'goal/objective': 'Ziel',
  'goal/clear-title': 'Das Ziel löschen',
  'goal/clear-label': 'Das Ziel löschen',
  'goal/more': (p: { count: number }) => `…und ${count(p.count, 'früherer Eintrag', 'frühere Einträge')}`,
  'goal/checkpoint': (p: { count: number }) => plural.select(p.count) === 'one'
    ? `${count(p.count, 'früherer Fortschrittseintrag', 'frühere Fortschrittseinträge')} mit seinen Belegen aufbewahrt.`
    : `${count(p.count, 'früherer Fortschrittseintrag', 'frühere Fortschrittseinträge')} mit ihren Belegen aufbewahrt.`,
  'goal/remember': 'Diese Sitzung merken',
  'goal/remembering': 'Sitzung wird gemerkt…',
  'ledger/memories': (p: { count: number }) => count(p.count, 'gemerkter Fakt', 'gemerkte Fakten'),
  'ledger/storage-failed': 'Speichern fehlgeschlagen: {detail}',
  'ledger/single-writer': 'Verwenden Sie jeweils nur einen Tab, um gemerkte Daten zu aktualisieren.',
  'ledger/evicted': (p: { count: number }) => `${count(p.count, 'frühere Archivadresse', 'frühere Archivadressen')} wegen des Speicherbudgets entfernt.`,
  'ledger/archived': (p: { count: number }) => plural.select(p.count) === 'one'
    ? `${count(p.count, 'frühere Runde', 'frühere Runden')} archiviert — der Assistent kann sie mit recall zurückholen.`
    : `${count(p.count, 'frühere Runde', 'frühere Runden')} archiviert — der Assistent kann jede davon mit recall zurückholen.`,
  'note/send-unconfigured': 'Fügen Sie zuerst in den Einstellungen einen Anbieter, ein Modell und (für OpenRouter) einen API-Schlüssel hinzu.',
  'note/reasoning-only': '*Das Modell hat die ganze Runde mit Überlegen verbracht, ohne endgültige Antwort — senden Sie eine weitere Nachricht, um fortzufahren.*',
  'note/empty-reply': '*Das Modell hat seine Runde ohne Antwort beendet — was es geladen hat, ist auf dem Bildschirm zu sehen; senden Sie eine weitere Nachricht, um fortzufahren.*',
  'note/remember-no-run': 'Noch nichts zu merken — senden Sie zuerst eine Nachricht.',
  'note/remember-unconfigured': 'Fügen Sie zuerst in den Einstellungen einen Anbieter, ein Modell und einen Schlüssel hinzu.',
  'note/remember-refused': 'Es wurde nichts gespeichert — {detail}',
  'note/remember-nothing': 'Der Assistent hat in dieser Sitzung nichts gefunden, das es wert wäre, gemerkt zu werden.',
  'note/remembered': (p: { count: number }) => `${count(p.count, 'belegter Eintrag', 'belegte Einträge')} gemerkt.`,
  'note/settings-not-saved': 'Die Einstellungen des Assistenten konnten nicht gespeichert werden.',
  'note/transcript-not-saved': 'Das Gesprächsprotokoll des Assistenten konnte nicht gespeichert werden.',
  'error/detail': 'Fehler: {detail}',
  'md/footnotes': 'Fußnoten',
  'view/status/idle': 'Bereit für einen neuen Auftrag.',
  'view/status/starting': 'Auftrag wird gestartet…',
  'view/status/running': 'Wird bearbeitet…',
  'view/status/cancelling': 'Auftrag wird abgebrochen…',
  'view/status/succeeded': 'Der Assistent hat diesen Auftrag abgeschlossen.',
  'view/status/failed': 'Der Assistent konnte diesen Auftrag nicht abschließen.',
  'view/status/cancelled': 'Dieser Auftrag wurde abgebrochen.',
  'view/progress': (p: { step?: number, stage?: string }) => p.step === undefined ? p.stage ?? ''
    : p.stage ? `Schritt ${number.format(p.step)} — ${p.stage}` : `Schritt ${number.format(p.step)}`,
  'view/start-failed': (p: { detail?: string }) => p.detail ? `Der Auftrag konnte nicht gestartet werden: ${p.detail}` : 'Der Auftrag konnte nicht gestartet werden.',
  'view/cancel-failed': (p: { detail?: string }) => p.detail ? `Der Auftrag konnte nicht abgebrochen werden: ${p.detail}` : 'Der Auftrag konnte nicht abgebrochen werden.',
} satisfies Required<AssistantCatalogue>;
