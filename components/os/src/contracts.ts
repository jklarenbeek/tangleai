/**
 * The two contracts every module connection carries.
 *
 * `tangle_os` is served by the kernel to one module over that module's own
 * port, so the caller's identity is the port, never a claim in the input:
 * a module cannot call as another. `tangle_os_module` is served by every
 * framed module back to the shell, for what the shell pushes to it (theme,
 * language) and what it reports (its compact context row).
 */
import { compileContract } from '@jarenjs/contract';

const text = { type: 'string', maxLength: 20000 };
const json = {};

export const OS_CONTRACT = {
  $contract: '0.1',
  id: 'tangle_os',
  operations: {
    'os.call': {
      kind: 'command',
      doc: 'Call an operation another module serves. Refused unless this module was granted it.',
      input: {
        type: 'object', additionalProperties: false, required: ['contract', 'op'],
        properties: { contract: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' }, op: { type: 'string', minLength: 1, maxLength: 128 }, input: json },
      },
      output: json,
    },
    'mail.send': {
      kind: 'command',
      doc: 'Send a message to the person, or to another module, through the desktop mail.',
      input: {
        type: 'object', additionalProperties: false, required: ['subject'],
        properties: {
          to: { type: 'string', pattern: '^(person|[a-z][a-z0-9-]{0,63})$' },
          subject: { type: 'string', minLength: 1, maxLength: 200 },
          body: text,
          data: json,
        },
      },
      output: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
    'window.title': {
      kind: 'command',
      doc: 'Set the title of this module\'s window.',
      input: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string', maxLength: 200 } } },
      output: { type: 'object' },
    },
  },
} as const;

export const MODULE_CONTRACT = {
  $contract: '0.1',
  id: 'tangle_os_module',
  operations: {
    'module.theme': {
      kind: 'command',
      doc: 'The desktop theme: token values to set on the module\'s root.',
      input: {
        type: 'object', additionalProperties: false, required: ['tokens'],
        properties: { tokens: { type: 'object', additionalProperties: { type: 'string', maxLength: 400 } }, scheme: { enum: ['light', 'dark'] } },
      },
      output: { type: 'object' },
    },
    'module.locale': {
      kind: 'command',
      doc: 'The person\'s language and writing direction.',
      input: { type: 'object', additionalProperties: false, required: ['locale', 'dir'], properties: { locale: { type: 'string', maxLength: 16 }, dir: { enum: ['ltr', 'rtl'] } } },
      output: { type: 'object' },
    },
    'module.context': {
      kind: 'read',
      doc: 'A compact description of what the module shows now, for the assistant.',
      input: { type: 'object', additionalProperties: false, properties: {} },
      output: { type: 'object' },
    },
  },
} as const;

let compiled: { os: any, module: any } | null = null;
/** Compiled once on first use, so importing the package compiles nothing. */
export function systemContracts() {
  compiled ??= { os: compileContract(OS_CONTRACT as any), module: compileContract(MODULE_CONTRACT as any) };
  return compiled;
}

/** The message a host posts with the ports, and the module side checks. */
export const CONNECT = 'tangle-os.connect';
/** What a framed page posts to its parent when it is ready for the ports. */
export const HELLO = 'tangle-os.hello';
/** A pointer pressed inside a frame: raise its window. */
export const FOCUS = 'tangle-os.focus';
/** A desktop shortcut pressed inside a frame. */
export const KEY = 'tangle-os.key';
export const PROTOCOL = 1;
export type ConnectMessage = {
  type: typeof CONNECT;
  protocol: typeof PROTOCOL;
  module: string;
  /** Names of the transferred ports, in transfer order: `os`, `module`, then one per provided contract id. */
  ports: string[];
  theme: { tokens: Record<string, string>, scheme: 'light' | 'dark' };
  locale: { locale: string, dir: 'ltr' | 'rtl' };
  /** Only for a document module: what the module host boots. */
  document?: { app: Record<string, unknown>, styles?: string, provides?: unknown[] };
};
