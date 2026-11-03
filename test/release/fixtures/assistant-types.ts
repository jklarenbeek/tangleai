import { createAssistantState, createAssistantController } from '@tangleai/assistant';
import { mountAssistant, createAssistantWidget } from '@tangleai/assistant/component';
import { mountAssistantView, createAssistantViewWidget, type AssistantViewState } from '@tangleai/assistant/view';
import { nl } from '@tangleai/assistant/messages/nl';
const host = mountAssistant(null, { title: 'Typed host', capabilities: ['Run a project'] });
host.dispatch('ai/toggle'); host.update({ intro: 'Ready' });
const close: Promise<void> = host.dispose(); void close;
// @ts-expect-error capabilities are a string list
host.update({ capabilities: 7 });
// @ts-expect-error updates change presentation only
host.update({ aiStorage: {} });
const widget = createAssistantWidget({ title: 'Typed widget' }); void widget;
const state = createAssistantState(); const open: boolean = state.open; void open;
void createAssistantController;
const report: AssistantViewState = { status: 'running', runId: 'run-1', messages: [{ role: 'user', content: 'Plan' }], progress: { step: 1, stage: 'Reading' } };
const view = mountAssistantView(null, {
  state: report, messages: nl, title: 'Typed view',
  transport: { start: async (message, { conversation, signal }) => { void conversation; void signal; return message; }, cancel: () => {} },
  onIntent: intent => { if (intent.type === 'link') { const id: string = intent.id; void id; } },
});
view.update({ ...report, status: 'succeeded', links: [{ id: 'orders', label: 'Open orders' }] });
const viewClosed: Promise<void> = view.dispose(); void viewClosed;
const refusedReports = () => {
  // @ts-expect-error the view reports a closed set of statuses
  view.update({ status: 'done', messages: [] });
  // @ts-expect-error a transport answers a start with the run id
  mountAssistantView(null, { state: report, transport: { start: () => 7, cancel: () => {} } });
}; void refusedReports;
const viewWidget = createAssistantViewWidget({ transport: { start: () => 'run', cancel: () => {} } }); void viewWidget;
