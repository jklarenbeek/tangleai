import { mountAssistant } from '@tangleai/assistant/component';
import '@tangleai/assistant/styles/assistant.css';
import '@jarenjs/md/styles/md.css';
import { createToolbox } from '@tangleai/agents';
const settings = { provider: 'custom', baseUrl: 'https://fixture.invalid/v1', model: 'packed', apiKey: '' };
globalThis.packedAssistants = ['Research', 'Workshop'].map((title, i) => mountAssistant(document.getElementById('host-' + i), {
  title, open: true, settings, toolbox: createToolbox(), capabilities: [title + ' tools'],
  transcript: { messages: [{ role: 'assistant', content: '**Installed package** in ' + title }] },
}));
