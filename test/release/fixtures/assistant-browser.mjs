import { mountAssistant } from '@tangleai/assistant/component';
import { mountAssistantView } from '@tangleai/assistant/view';
import { nl } from '@tangleai/assistant/messages/nl';
import '@tangleai/assistant/styles/assistant.css';
import '@jarenjs/md/styles/md.css';
import { createToolbox } from '@tangleai/agents';
const settings = { provider: 'custom', baseUrl: 'https://fixture.invalid/v1', model: 'packed', apiKey: '' };
globalThis.packedAssistants = ['Research', 'Workshop'].map((title, i) => mountAssistant(document.getElementById('host-' + i), {
  title, open: true, settings, toolbox: createToolbox(), capabilities: [title + ' tools'],
  transcript: { messages: [{ role: 'assistant', content: '**Installed package** in ' + title }] },
}));
globalThis.packedAssistantView = mountAssistantView(document.getElementById('host-2'), {
  open: true, messages: nl, title: 'Bestellingen', transport: { start: () => 'packed-run', cancel: () => {} },
  state: { status: 'running', runId: 'packed-run', messages: [{ role: 'user', content: 'Plan de week' }], progress: { step: 2, stage: 'Orders lezen' }, links: [{ id: 'orders', label: 'Orders openen' }] },
});
