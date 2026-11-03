/**
 * The assistant's sentences in Portuguese (Brazil), formal, key for key with
 * the English catalogue: pass it as `messages` and every key renders
 * Portuguese. The setting examples and product names stay as written; text
 * another package wrote still arrives verbatim inside `error/detail`.
 */
import type { AssistantCatalogue } from '../messages.ts';

const plural = new Intl.PluralRules('pt-BR');
const number = new Intl.NumberFormat('pt-BR');
/** A count in Portuguese digits with the noun form it takes (0 and 1 are singular). */
const count = (value: number, one: string, other: string) => `${number.format(value)} ${plural.select(value) === 'one' ? one : other}`;

export const pt = {
  'launcher/label': ' Assistente',
  'launcher/title': 'Abrir o assistente',
  'panel/title': 'Assistente',
  'panel/settings-title': 'Configurações',
  'panel/settings-label': 'Configurações do assistente',
  'panel/clear-title': 'Limpar a conversa',
  'panel/clear-label': 'Limpar conversa',
  'panel/close-title': 'Fechar',
  'panel/close-label': 'Fechar o assistente',
  'settings/hint': 'As solicitações ao provedor usam as suas configurações. Este host define o que é guardado localmente.',
  'settings/provider': 'Provedor',
  'settings/api-key': 'Chave de API',
  'settings/api-key-example': 'sk-…',
  'settings/base-url': 'URL base',
  'settings/base-url-example': 'http://localhost:11434 · https://…/v1',
  'settings/model': 'Modelo',
  'settings/model-example': 'qwen/qwen3-4b · llama3.2 · …',
  'settings/save': 'Salvar',
  'settings/test': 'Testar a conexão',
  'settings/testing': 'Testando…',
  'settings/probe-connected': (p: { count: number }) => `Conectado — ${count(p.count, 'modelo disponível', 'modelos disponíveis')}.`,
  'provider/openrouter': 'OpenRouter',
  'provider/ollama': 'Ollama',
  'provider/lmstudio': 'LM Studio',
  'provider/custom': 'Compatível com OpenAI',
  'intro/text': 'Descreva o que deseja fazer. O assistente pode usar as ferramentas que este host oferece.',
  'intro/setup': 'Escolha um provedor acima, adicione um modelo (e uma chave para o OpenRouter) e salve — o chat abre aqui mesmo. Nada sai do seu navegador além das chamadas ao provedor que escolher.',
  'composer/placeholder': 'Pergunte ao assistente…',
  'composer/send': 'Enviar',
  'composer/cancel': 'Cancelar',
  'activity/running': 'Executando {tool}',
  'activity/thinking': 'Pensando…',
  'activity/thinking-count': (p: { count: number }) => `Pensando… (${count(p.count, 'caractere', 'caracteres')} de raciocínio)`,
  'goal/placeholder': 'Defina um objetivo que o assistente mantenha entre sessões…',
  'goal/set': 'Definir',
  'goal/objective': 'Objetivo',
  'goal/clear-title': 'Limpar o objetivo',
  'goal/clear-label': 'Limpar o objetivo',
  'goal/more': (p: { count: number }) => `…e mais ${count(p.count, 'entrada anterior', 'entradas anteriores')}`,
  'goal/checkpoint': (p: { count: number }) => plural.select(p.count) === 'one'
    ? `${count(p.count, 'entrada de progresso anterior mantida', 'entradas de progresso anteriores mantidas')} com a sua evidência.`
    : `${count(p.count, 'entrada de progresso anterior mantida', 'entradas de progresso anteriores mantidas')} com as suas evidências.`,
  'goal/remember': 'Lembrar esta sessão',
  'goal/remembering': 'Lembrando…',
  'ledger/memories': (p: { count: number }) => count(p.count, 'fato lembrado', 'fatos lembrados'),
  'ledger/storage-failed': 'Falha no armazenamento: {detail}',
  'ledger/single-writer': 'Use uma aba de cada vez para atualizar os dados lembrados.',
  'ledger/evicted': (p: { count: number }) => `${count(p.count, 'endereço de arquivo anterior removido', 'endereços de arquivo anteriores removidos')} pelo limite de armazenamento.`,
  'ledger/archived': (p: { count: number }) => plural.select(p.count) === 'one'
    ? `${count(p.count, 'rodada anterior arquivada', 'rodadas anteriores arquivadas')} — o assistente pode recuperá-la com recall.`
    : `${count(p.count, 'rodada anterior arquivada', 'rodadas anteriores arquivadas')} — o assistente pode recuperar qualquer uma delas com recall.`,
  'note/send-unconfigured': 'Primeiro adicione um provedor, um modelo e (para o OpenRouter) uma chave de API nas configurações.',
  'note/reasoning-only': '*O modelo passou o turno inteiro raciocinando sem uma resposta final — envie outra mensagem para continuar.*',
  'note/empty-reply': '*O modelo encerrou o turno sem resposta — o que ele carregou está na tela; envie outra mensagem para continuar.*',
  'note/remember-no-run': 'Ainda não há nada para lembrar — envie uma mensagem primeiro.',
  'note/remember-unconfigured': 'Primeiro adicione um provedor, um modelo e uma chave nas configurações.',
  'note/remember-refused': 'Nada foi guardado — {detail}',
  'note/remember-nothing': 'O assistente não encontrou nesta sessão nada que valha a pena lembrar.',
  'note/remembered': (p: { count: number }) => `${count(p.count, 'item comprovado lembrado', 'itens comprovados lembrados')}.`,
  'note/settings-not-saved': 'Não foi possível salvar as configurações do assistente.',
  'note/transcript-not-saved': 'Não foi possível salvar a transcrição do assistente.',
  'error/detail': 'Erro: {detail}',
  'md/footnotes': 'Notas de rodapé',
  'view/status/idle': 'Pronto para uma nova tarefa.',
  'view/status/starting': 'Iniciando a tarefa…',
  'view/status/running': 'Trabalhando…',
  'view/status/cancelling': 'Cancelando a tarefa…',
  'view/status/succeeded': 'O assistente concluiu esta tarefa.',
  'view/status/failed': 'O assistente não conseguiu concluir esta tarefa.',
  'view/status/cancelled': 'Esta tarefa foi cancelada.',
  'view/progress': (p: { step?: number, stage?: string }) => p.step === undefined ? p.stage ?? ''
    : p.stage ? `Etapa ${number.format(p.step)} — ${p.stage}` : `Etapa ${number.format(p.step)}`,
  'view/start-failed': (p: { detail?: string }) => p.detail ? `Não foi possível iniciar a tarefa: ${p.detail}` : 'Não foi possível iniciar a tarefa.',
  'view/cancel-failed': (p: { detail?: string }) => p.detail ? `Não foi possível cancelar a tarefa: ${p.detail}` : 'Não foi possível cancelar a tarefa.',
} satisfies Required<AssistantCatalogue>;
