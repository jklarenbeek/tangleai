import { createAssistantState, createAssistantController } from '@tangleai/assistant';
import { mountAssistant, createAssistantWidget } from '@tangleai/assistant/component';
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
