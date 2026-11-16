/** A framed application: joins the desktop that frames it and serves one contract, counting its connections. */
import { connectToOs } from '../../../components/os/src/module.ts';

export const ECHO = { $contract: '0.1', id: 'echo', operations: { 'echo.say': { kind: 'read', input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, output: { type: 'object' } } } };
const loaded = Number(sessionStorage.getItem('loads') ?? 0) + 1;
sessionStorage.setItem('loads', String(loaded));
connectToOs({ origins: 'parent', presentation: 'none', serve: [{ contract: ECHO, handlers: { 'echo.say': ({ text }: any) => ({ text, loaded }) } }] })
  .then(() => { document.body.dataset.joined = 'yes'; });
