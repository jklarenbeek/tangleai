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
import { HEADER_SCHEMA } from './header.ts';

const text = { type: 'string', maxLength: 20000 };
const json = {};
/**
 * A proposal a module files for the person to accept or reject. Plain JSON,
 * bounded: the desktop shows it as text, links only to http(s) pages, and
 * never runs anything from it. The module keeps the proposal and decides what
 * accepting it does; `revision` is what it expects to still be true then.
 */
export const PROPOSAL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['id', 'kind', 'title'],
  properties: {
    id: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' },
    kind: { type: 'string', pattern: '^[a-z][a-z0-9.-]{0,63}$' },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    summary: { type: 'string', maxLength: 2000 },
    payload: json,
    evidence: {
      type: 'array', maxItems: 12,
      items: { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { type: 'string', minLength: 1, maxLength: 200 }, href: { type: 'string', maxLength: 2000, pattern: '^https?://' } } },
    },
    revision: { type: 'string', maxLength: 128 },
    /** Who proposes: a person, a rule, an import or the assistant (`ai`). */
    origin: { enum: ['human', 'rule', 'import', 'ai'] },
    /**
     * A proposal that asks the person something (a paused run, say): the
     * JSON Schema of the answer, drawn as a form, and the button's words.
     */
    answer: {
      type: 'object', additionalProperties: false, required: ['schema'],
      properties: { schema: { anyOf: [{ type: 'object' }, { type: 'boolean' }] }, label: { type: 'string', minLength: 1, maxLength: 64 } },
    },
  },
} as const;
/** What the desktop carries back to the module that filed a proposal. */
export const DECISION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['id', 'kind', 'decision'],
  properties: { id: PROPOSAL_SCHEMA.properties.id, kind: PROPOSAL_SCHEMA.properties.kind, decision: { enum: ['accept', 'reject', 'answer'] }, revision: { type: 'string', maxLength: 128 }, payload: json, response: json,
    /** The roles the kind's review policy names: the module checks the person against them before it applies. */
    roles: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 64 } } },
} as const;

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
    'window.header': {
      kind: 'command',
      doc: 'Set the header bar of this module\'s window: its buttons, toggles, menus, tabs and search field, drawn by the desktop. null takes it away.',
      input: { type: 'object', additionalProperties: false, required: ['header'], properties: { header: { anyOf: [HEADER_SCHEMA, { type: 'null' }] } } },
      // a refusal is answered, not thrown, so the page learns its code and reason
      output: { type: 'object', properties: { refused: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
    },
    'mail.propose': {
      kind: 'command',
      doc: 'File a proposal in the desktop\'s inbox for the person to accept or reject; filing the same id again replaces it.',
      input: PROPOSAL_SCHEMA,
      output: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
    'mail.withdraw': {
      kind: 'command',
      doc: 'Take back one of this module\'s proposals that is still pending.',
      input: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: PROPOSAL_SCHEMA.properties.id } },
      output: { type: 'object' },
    },
    'settings.get': {
      kind: 'read',
      doc: 'This module\'s settings as the person set them in the desktop\'s Settings (a form module\'s values; empty for one that keeps its own).',
      input: { type: 'object', additionalProperties: false, properties: {} },
      output: { type: 'object', properties: { values: json } },
    },
    'settings.open': {
      kind: 'command',
      doc: 'Open the desktop\'s Settings at this module\'s own section.',
      input: { type: 'object', additionalProperties: false, properties: {} },
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
    'module.settings': {
      kind: 'command',
      doc: 'The module\'s settings changed in the desktop\'s Settings: its new values.',
      input: { type: 'object', additionalProperties: false, properties: { values: json } },
      output: { type: 'object' },
    },
    'module.decide': {
      kind: 'command',
      doc: 'The person accepted or rejected one of the module\'s proposals. The module carries it out, or refuses with the reason (`refused`), for example when the revision moved.',
      input: DECISION_SCHEMA,
      output: { type: 'object', properties: { refused: { type: 'string', maxLength: 400 } } },
    },
    'module.header': {
      kind: 'command',
      doc: 'An item of the window\'s header bar was used: by the person (`by: person`) or by a caller the desktop granted it (`assistant`, a module id). Carry it out, or refuse with the reason.',
      input: {
        type: 'object', additionalProperties: false, required: ['item', 'by'],
        properties: { item: { type: 'string', maxLength: 64 }, value: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'boolean' }] }, by: { type: 'string', maxLength: 64 } },
      },
      output: { type: 'object', properties: { refused: { type: 'string', maxLength: 400 } } },
    },
    'module.open': {
      kind: 'command',
      doc: 'The person opened a file with this module (from the desktop\'s Files): its name, its type, and its bytes (base64) or an https address. Open it, or refuse with the reason.',
      input: {
        type: 'object', additionalProperties: false, required: ['name', 'type'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 }, type: { type: 'string', maxLength: 255 },
          data: { type: 'string', maxLength: 14_000_000 }, url: { type: 'string', maxLength: 4096 },
          source: { type: 'object', additionalProperties: false, required: ['location', 'id'], properties: { location: { type: 'string', maxLength: 128 }, id: { type: 'string', maxLength: 1024 } } },
        },
      },
      output: { type: 'object', properties: { refused: { type: 'string', maxLength: 400 } } },
    },
    'module.screen': {
      kind: 'command',
      doc: 'The person opened one of the module\'s launch entries while its window was open: show that screen.',
      input: { type: 'object', additionalProperties: false, required: ['screen'], properties: { screen: { type: 'string', minLength: 1, maxLength: 200 } } },
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
  /** The screen of the launch entry the window was opened from, for a module with entries. */
  screen?: string;
  /** Only for a document module: what the module host boots. */
  document?: { app: Record<string, unknown>, styles?: string, provides?: unknown[] };
};
