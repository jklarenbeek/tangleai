/**
 * The assistant's sentences in Spanish, formal (`usted`) and neutral across
 * Spain and Latin America, key for key with the English catalogue: pass it as
 * `messages` and every key renders Spanish. The setting examples and product
 * names stay as written; text another package wrote still arrives verbatim
 * inside `error/detail`.
 */
import type { AssistantCatalogue } from '../messages.ts';

const plural = new Intl.PluralRules('es');
const number = new Intl.NumberFormat('es');
/** A count in Spanish digits with the noun form it takes. */
const count = (value: number, one: string, other: string) => `${number.format(value)} ${plural.select(value) === 'one' ? one : other}`;

export const es = {
  'launcher/label': ' Asistente',
  'launcher/title': 'Abrir el asistente',
  'panel/title': 'Asistente',
  'panel/settings-title': 'Configuración',
  'panel/settings-label': 'Configuración del asistente',
  'panel/clear-title': 'Borrar la conversación',
  'panel/clear-label': 'Borrar conversación',
  'panel/close-title': 'Cerrar',
  'panel/close-label': 'Cerrar el asistente',
  'settings/hint': 'Las solicitudes al proveedor usan su configuración. Este host decide qué se guarda localmente.',
  'settings/provider': 'Proveedor',
  'settings/api-key': 'Clave de API',
  'settings/api-key-example': 'sk-…',
  'settings/base-url': 'URL base',
  'settings/base-url-example': 'http://localhost:11434 · https://…/v1',
  'settings/model': 'Modelo',
  'settings/model-example': 'qwen/qwen3-4b · llama3.2 · …',
  'settings/save': 'Guardar',
  'settings/test': 'Probar la conexión',
  'settings/testing': 'Probando…',
  'settings/probe-connected': (p: { count: number }) => `Conectado — ${count(p.count, 'modelo disponible', 'modelos disponibles')}.`,
  'provider/openrouter': 'OpenRouter',
  'provider/ollama': 'Ollama',
  'provider/lmstudio': 'LM Studio',
  'provider/custom': 'Compatible con OpenAI',
  'intro/text': 'Describa lo que desea hacer. El asistente puede usar las herramientas que ofrece este host.',
  'intro/setup': 'Elija un proveedor arriba, agregue un modelo (y una clave para OpenRouter) y guarde — el chat se abre aquí mismo. Nada sale de su navegador, salvo las llamadas al proveedor que elija.',
  'composer/placeholder': 'Pregúntele al asistente…',
  'composer/send': 'Enviar',
  'composer/cancel': 'Cancelar',
  'activity/running': 'Ejecutando {tool}',
  'activity/thinking': 'Pensando…',
  'activity/thinking-count': (p: { count: number }) => `Pensando… (${count(p.count, 'carácter', 'caracteres')} de razonamiento)`,
  'goal/placeholder': 'Defina un objetivo que el asistente mantenga entre sesiones…',
  'goal/set': 'Definir',
  'goal/objective': 'Objetivo',
  'goal/clear-title': 'Borrar el objetivo',
  'goal/clear-label': 'Borrar el objetivo',
  'goal/more': (p: { count: number }) => `…y ${count(p.count, 'entrada anterior', 'entradas anteriores')}`,
  'goal/checkpoint': (p: { count: number }) => `${count(p.count, 'entrada de progreso anterior conservada', 'entradas de progreso anteriores conservadas')} con su evidencia.`,
  'goal/remember': 'Recordar esta sesión',
  'goal/remembering': 'Recordando…',
  'ledger/memories': (p: { count: number }) => count(p.count, 'dato recordado', 'datos recordados'),
  'ledger/storage-failed': 'Error de almacenamiento: {detail}',
  'ledger/single-writer': 'Use una sola pestaña a la vez para actualizar los datos recordados.',
  'ledger/evicted': (p: { count: number }) => `${count(p.count, 'dirección de archivo anterior eliminada', 'direcciones de archivo anteriores eliminadas')} por el límite de almacenamiento.`,
  'ledger/archived': (p: { count: number }) => plural.select(p.count) === 'one'
    ? `${count(p.count, 'ronda anterior archivada', 'rondas anteriores archivadas')} — el asistente puede recuperarla con recall.`
    : `${count(p.count, 'ronda anterior archivada', 'rondas anteriores archivadas')} — el asistente puede recuperar cualquiera de ellas con recall.`,
  'note/send-unconfigured': 'Primero agregue un proveedor, un modelo y (para OpenRouter) una clave de API en la configuración.',
  'note/reasoning-only': '*El modelo dedicó todo el turno a razonar sin una respuesta final — envíe otro mensaje para continuar.*',
  'note/empty-reply': '*El modelo terminó su turno sin respuesta — lo que cargó está en pantalla; envíe otro mensaje para continuar.*',
  'note/remember-no-run': 'Todavía no hay nada que recordar — envíe primero un mensaje.',
  'note/remember-unconfigured': 'Primero agregue un proveedor, un modelo y una clave en la configuración.',
  'note/remember-refused': 'No se guardó nada — {detail}',
  'note/remember-nothing': 'El asistente no encontró en esta sesión nada que valga la pena recordar.',
  'note/remembered': (p: { count: number }) => plural.select(p.count) === 'one'
    ? `Se recordó ${count(p.count, 'elemento respaldado', 'elementos respaldados')}.`
    : `Se recordaron ${count(p.count, 'elemento respaldado', 'elementos respaldados')}.`,
  'note/settings-not-saved': 'No se pudo guardar la configuración del asistente.',
  'note/transcript-not-saved': 'No se pudo guardar la transcripción del asistente.',
  'error/detail': 'Error: {detail}',
  'md/footnotes': 'Notas al pie',
  'view/status/idle': 'Listo para una nueva tarea.',
  'view/status/starting': 'Iniciando la tarea…',
  'view/status/running': 'Trabajando…',
  'view/status/cancelling': 'Cancelando la tarea…',
  'view/status/succeeded': 'El asistente terminó esta tarea.',
  'view/status/failed': 'El asistente no pudo terminar esta tarea.',
  'view/status/cancelled': 'Esta tarea se canceló.',
  'view/progress': (p: { step?: number, stage?: string }) => p.step === undefined ? p.stage ?? ''
    : p.stage ? `Paso ${number.format(p.step)} — ${p.stage}` : `Paso ${number.format(p.step)}`,
  'view/start-failed': (p: { detail?: string }) => p.detail ? `No se pudo iniciar la tarea: ${p.detail}` : 'No se pudo iniciar la tarea.',
  'view/cancel-failed': (p: { detail?: string }) => p.detail ? `No se pudo cancelar la tarea: ${p.detail}` : 'No se pudo cancelar la tarea.',
} satisfies Required<AssistantCatalogue>;
