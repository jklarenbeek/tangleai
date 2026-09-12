import { createStudioAdapter, createDataAdapter, createFlowAdapter } from '@tangleai/jaren';
import { mountStudioEditor } from '@jarenjs/studio/component';
import { mountDataEditor } from '@jarenjs/studio/data';
import { mountFlowEditor } from '@jarenjs/studio/flow';
declare const studio: ReturnType<typeof mountStudioEditor>;
declare const data: ReturnType<typeof mountDataEditor>;
declare const flow: ReturnType<typeof mountFlowEditor>;
const s = createStudioAdapter({ editor: studio }), d = createDataAdapter({ editor: data }), f = createFlowAdapter({ editor: flow });
const proposal = await f.propose({ prompt: 'An FSM', kind: 'fsm' });
if (proposal.ok) await f.accept(proposal);
const dp = await d.propose({ member: 'query', prompt: 'Select rows' });
if (dp.ok) await d.accept(dp);
const sp = await s.propose({ name: 'a.query', kind: 'query', prompt: 'Sum' });
if (sp.ok) await s.accept(sp);
// @ts-expect-error unknown Flow grammar
f.propose({ kind: 'invented', prompt: 'bad' });
// @ts-expect-error wrong revision type
s.write({ name: 'a', text: '{}', expectedRevision: 42 });
// @ts-expect-error only explicit Data operations are supported
d.run({ operation: 'migrate' });
// @ts-expect-error unknown Data member
d.propose({ member: 'credentials', prompt: 'bad' });
// @ts-expect-error a failed proposal has no publishable candidate
f.accept({ ok: false });
