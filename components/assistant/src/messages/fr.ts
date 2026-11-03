/**
 * The assistant's sentences in French, formal (`vous`), key for key with the
 * English catalogue: pass it as `messages` and every key renders French. The
 * setting examples and product names stay as written; text another package
 * wrote still arrives verbatim inside `error/detail`. A no-break space
 * precedes the colon, as French typography sets it.
 */
import type { AssistantCatalogue } from '../messages.ts';

const plural = new Intl.PluralRules('fr');
const number = new Intl.NumberFormat('fr-FR');
/** A count in French digits with the noun form it takes (French counts 0 and 1 as singular). */
const count = (value: number, one: string, other: string) => `${number.format(value)} ${plural.select(value) === 'one' ? one : other}`;

export const fr = {
  'launcher/label': ' Assistant',
  'launcher/title': 'Ouvrir l’assistant',
  'panel/title': 'Assistant',
  'panel/settings-title': 'Paramètres',
  'panel/settings-label': 'Paramètres de l’assistant',
  'panel/clear-title': 'Effacer la conversation',
  'panel/clear-label': 'Effacer la conversation',
  'panel/close-title': 'Fermer',
  'panel/close-label': 'Fermer l’assistant',
  'settings/hint': 'Les requêtes au fournisseur utilisent vos paramètres. Cet hôte décide de ce qui est conservé localement.',
  'settings/provider': 'Fournisseur',
  'settings/api-key': 'Clé d’API',
  'settings/api-key-example': 'sk-…',
  'settings/base-url': 'URL de base',
  'settings/base-url-example': 'http://localhost:11434 · https://…/v1',
  'settings/model': 'Modèle',
  'settings/model-example': 'qwen/qwen3-4b · llama3.2 · …',
  'settings/save': 'Enregistrer',
  'settings/test': 'Tester la connexion',
  'settings/testing': 'Test en cours…',
  'settings/probe-connected': (p: { count: number }) => `Connecté — ${count(p.count, 'modèle disponible', 'modèles disponibles')}.`,
  'provider/openrouter': 'OpenRouter',
  'provider/ollama': 'Ollama',
  'provider/lmstudio': 'LM Studio',
  'provider/custom': 'Compatible OpenAI',
  'intro/text': 'Décrivez ce que vous souhaitez accomplir. L’assistant peut utiliser les outils que fournit cet hôte.',
  'intro/setup': 'Choisissez un fournisseur ci-dessus, ajoutez un modèle (et une clé pour OpenRouter), puis enregistrez — la discussion s’ouvre alors ici même. Rien ne quitte votre navigateur, hormis les appels au fournisseur que vous choisissez.',
  'composer/placeholder': 'Posez votre question à l’assistant…',
  'composer/send': 'Envoyer',
  'composer/cancel': 'Annuler',
  'activity/running': 'Exécution de {tool}',
  'activity/thinking': 'Réflexion…',
  'activity/thinking-count': (p: { count: number }) => `Réflexion… (${count(p.count, 'caractère', 'caractères')} de raisonnement)`,
  'goal/placeholder': 'Définissez un objectif que l’assistant conserve d’une session à l’autre…',
  'goal/set': 'Définir',
  'goal/objective': 'Objectif',
  'goal/clear-title': 'Effacer l’objectif',
  'goal/clear-label': 'Effacer l’objectif',
  'goal/more': (p: { count: number }) => `…et ${count(p.count, 'entrée précédente', 'entrées précédentes')}`,
  'goal/checkpoint': (p: { count: number }) => plural.select(p.count) === 'one'
    ? `${count(p.count, 'entrée de progression précédente conservée', 'entrées de progression précédentes conservées')} avec ses preuves.`
    : `${count(p.count, 'entrée de progression précédente conservée', 'entrées de progression précédentes conservées')} avec leurs preuves.`,
  'goal/remember': 'Mémoriser cette session',
  'goal/remembering': 'Mémorisation…',
  'ledger/memories': (p: { count: number }) => count(p.count, 'fait mémorisé', 'faits mémorisés'),
  'ledger/storage-failed': 'Échec de l’enregistrement : {detail}',
  'ledger/single-writer': 'Utilisez un seul onglet à la fois pour mettre à jour les données mémorisées.',
  'ledger/evicted': (p: { count: number }) => `${count(p.count, 'ancienne adresse d’archive supprimée', 'anciennes adresses d’archive supprimées')} en raison du budget de stockage.`,
  'ledger/archived': (p: { count: number }) => plural.select(p.count) === 'one'
    ? `${count(p.count, 'tour précédent archivé', 'tours précédents archivés')} — l’assistant peut le récupérer avec recall.`
    : `${count(p.count, 'tour précédent archivé', 'tours précédents archivés')} — l’assistant peut récupérer chacun d’eux avec recall.`,
  'note/send-unconfigured': 'Ajoutez d’abord un fournisseur, un modèle et (pour OpenRouter) une clé d’API dans les paramètres.',
  'note/reasoning-only': '*Le modèle a passé tout son tour à raisonner sans réponse finale — envoyez un autre message pour continuer.*',
  'note/empty-reply': '*Le modèle a terminé son tour sans réponse — ce qu’il a chargé est affiché à l’écran ; envoyez un autre message pour continuer.*',
  'note/remember-no-run': 'Rien à mémoriser pour l’instant — envoyez d’abord un message.',
  'note/remember-unconfigured': 'Ajoutez d’abord un fournisseur, un modèle et une clé dans les paramètres.',
  'note/remember-refused': 'Rien n’a été enregistré — {detail}',
  'note/remember-nothing': 'L’assistant n’a rien trouvé dans cette session qui mérite d’être mémorisé.',
  'note/remembered': (p: { count: number }) => `${count(p.count, 'élément étayé mémorisé', 'éléments étayés mémorisés')}.`,
  'note/settings-not-saved': 'Les paramètres de l’assistant n’ont pas pu être enregistrés.',
  'note/transcript-not-saved': 'La transcription de l’assistant n’a pas pu être enregistrée.',
  'error/detail': 'Erreur : {detail}',
  'md/footnotes': 'Notes de bas de page',
  'view/status/idle': 'Prêt pour une nouvelle tâche.',
  'view/status/starting': 'Démarrage de la tâche…',
  'view/status/running': 'Travail en cours…',
  'view/status/cancelling': 'Annulation de la tâche…',
  'view/status/succeeded': 'L’assistant a terminé cette tâche.',
  'view/status/failed': 'L’assistant n’a pas pu terminer cette tâche.',
  'view/status/cancelled': 'Cette tâche a été annulée.',
  'view/progress': (p: { step?: number, stage?: string }) => p.step === undefined ? p.stage ?? ''
    : p.stage ? `Étape ${number.format(p.step)} — ${p.stage}` : `Étape ${number.format(p.step)}`,
  'view/start-failed': (p: { detail?: string }) => p.detail ? `La tâche n’a pas pu être démarrée : ${p.detail}` : 'La tâche n’a pas pu être démarrée.',
  'view/cancel-failed': (p: { detail?: string }) => p.detail ? `La tâche n’a pas pu être annulée : ${p.detail}` : 'La tâche n’a pas pu être annulée.',
} satisfies Required<AssistantCatalogue>;
