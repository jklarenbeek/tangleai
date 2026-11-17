/** A framed application: joins the desktop that frames it and serves one contract, counting its connections. */
import { connectToOs } from '../../../components/os/src/module.ts';

export const ECHO = { $contract: '0.1', id: 'echo', operations: { 'echo.say': { kind: 'read', input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, output: { type: 'object' } } } };
const loaded = Number(sessionStorage.getItem('loads') ?? 0) + 1;
sessionStorage.setItem('loads', String(loaded));
// two proposals for the person: one it carries out, one whose revision moved
connectToOs({
  origins: 'parent', presentation: 'none', serve: [{ contract: ECHO, handlers: { 'echo.say': ({ text }: any) => ({ text, loaded }) } }],
  onDecision: ({ id, decision }) => {
    if (id === 'echo-2' && decision === 'accept') return { refused: 'the echo moved' };
    document.body.dataset.decided = `${id}:${decision}`;
  },
}).then(async (desktop) => {
  document.body.dataset.joined = 'yes';
  // a settings page joins too, but files nothing: proposals belong to the application's window
  if (window.name === 'settings' || new URLSearchParams(location.search).has('settings')) return;
  await desktop.propose({ id: 'echo-1', kind: 'echo.reply', title: 'Send the echo', summary: 'Answer the last call with its own words.', evidence: [{ label: 'The call', href: 'https://example.com/call' }], revision: 'r1' });
  await desktop.propose({ id: 'echo-2', kind: 'echo.reply', title: 'Send the second echo', revision: 'r1' });
});
