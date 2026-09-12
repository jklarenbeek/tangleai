/**
 * @file A minimal DOM stub for exercising the @jarenjs/view renderer
 * under the Node test runner: exactly the surface `createDomRenderer`
 * touches, plus `fire()` and `serialize()` helpers for assertions.
 * Deliberately not a DOM implementation — no bubbling, no namespaces
 * beyond bookkeeping, no live collections.
 */

class StubNode {
  declare ownerDocument: any;
  declare parentNode: StubElement | null;

  /** @param doc */
  constructor(doc: StubDocument) {
    this.ownerDocument = doc;

    this.parentNode = null;
  }
}

export class StubText extends StubNode {
  declare nodeValue: any;
  declare nodeType: any;
  declare ownerDocument: any;
  declare parentNode: StubElement | null;

  /**
   */
  constructor(doc: StubDocument, text: string) {
    super(doc);
    this.nodeValue = text;
    this.nodeType = 3;
  }
}

/** Tags the controlled-input reconciliation reasserts against (§3): the stub
 * gives them live `value`/`checked` properties so a test can simulate a user
 * edit by writing `node.value`/`node.checked` directly. `option` is
 * deliberately absent — the renderer writes its value through the attribute
 * path, exactly as the real DOM leaves the value *attribute* independent of
 * the value property. */
const FORM_CONTROLS = new Set(['input', 'textarea', 'select']);

export class StubElement extends StubNode {
  declare tagName: any;
  declare nodeType: any;
  declare namespaceURI: any;
  declare childNodes: (StubElement | StubText)[];
  declare attributes: Map<string, string>;
  declare listeners: Map<string, Set<Function>>;
  declare value: any;
  declare checked: any;
  declare selected: boolean;
  declare ownerDocument: any;
  declare parentNode: StubElement | null;

  /**
   * @param [ns]
   */
  constructor(doc: StubDocument, tag: string, ns: string | null = null) {
    super(doc);
    this.tagName = tag;
    this.nodeType = 1;
    this.namespaceURI = ns;

    this.childNodes = [];

    this.attributes = new Map();

    this.listeners = new Map();
    // Form controls carry live value/checked properties, exactly the surface
    // the renderer writes and reconciles against. A plain element has neither,
    // so `'value' in node` stays false for a div — matching the real DOM.
    const lower = String(tag).toLowerCase();
    if (FORM_CONTROLS.has(lower)) {
      this.value = '';
      if (lower === 'input') {
        this.checked = false;
        // `files` is a read-only FileList in the browser: assigning to it
        // throws. Modeling that is how the safe-mode attribute-only write is
        // shown to avoid a first-render crash that the trusted property write
        // would hit.
        Object.defineProperty(this, 'files', {
          get() { return null; },
          enumerable: false,
          configurable: true,
        });
      }
    }
  }

  /** The uppercase tag, as the DOM reports it — how the renderer tells a
   * form control apart when reconciling a controlled value. */
  get nodeName() {
    return String(this.tagName).toUpperCase();
  }

  /** A `<select>`'s option children, as the DOM exposes them — enough for the
   * multiple-select reconciliation to mark each option `selected`. */
  get options() {
    return this.childNodes.filter((c) => c instanceof StubElement
      && String(c.tagName).toLowerCase() === 'option');
  }

  /** @param node */
  appendChild(node: StubElement | StubText) {
    this.insertBefore(node, null);
    return node;
  }

  /**
   */
  insertBefore(node: StubElement | StubText, ref: StubElement | StubText | null) {
    if (node.parentNode !== null) node.parentNode.removeChild(node);
    const index = ref == null ? this.childNodes.length : this.childNodes.indexOf(ref);
    if (index < 0) throw new Error('insertBefore: reference node not found');
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }

  /** @param node */
  removeChild(node: StubElement | StubText) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('removeChild: node not found');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  /**
   */
  replaceChild(next: StubElement | StubText, old: StubElement | StubText) {
    this.insertBefore(next, old);
    this.removeChild(old);
    return old;
  }

  /**
   */
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  /** @param name */
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  /** @param name */
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNames() { return [...this.attributes.keys()]; }

  /** Focus tracking: the document records the active element. */
  focus() {
    this.ownerDocument.activeElement = this;
  }

  /** Text-control selection: focuses and marks the selection. */
  select() {
    this.focus();
    this.selected = true;
  }

  /** A fixed layout box, enough for measurement plumbing tests. */
  getBoundingClientRect() {
    return { x: 1, y: 2, width: 30, height: 40, top: 2, left: 1, right: 31, bottom: 42 };
  }

  /**
   */
  addEventListener(type: string, listener: Function) {
    let set = this.listeners.get(type);
    if (set === undefined) this.listeners.set(type, set = new Set());
    set.add(listener);
  }

  /**
   */
  removeEventListener(type: string, listener: Function) {
    this.listeners.get(type)?.delete(listener);
  }

  set textContent(value: any) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes.length = 0;
    if (value !== '') this.appendChild(new StubText(this.ownerDocument, String(value)));
  }
}

export class StubDocument {
  declare activeElement: StubElement | null;
  declare listeners: Map<string, Set<Function>>;

  constructor() {
    /** @type  The last focused element. */
    this.activeElement = null;
    /** @type  document-level listeners (e.g.
     * a drag widget's window-of-drag pointermove/up) — `fire()`-able. */
    this.listeners = new Map();
  }

  /**
   */
  addEventListener(type: string, listener: Function) {
    let set = this.listeners.get(type);
    if (set === undefined) this.listeners.set(type, set = new Set());
    set.add(listener);
  }

  /**
   */
  removeEventListener(type: string, listener: Function) {
    this.listeners.get(type)?.delete(listener);
  }

  /** @param tag */
  createElement(tag: string) {
    return new StubElement(this, tag);
  }

  /**
   */
  createElementNS(ns: string, tag: string) {
    return new StubElement(this, tag, ns);
  }

  /** @param text */
  createTextNode(text: string) {
    return new StubText(this, text);
  }
}

/**
 * Fire an event on a stub node: calls its own listeners for `type` with
 * a minimal event object (no bubbling).
 * @param [props] - Extra event members (e.g. `key`)
 *   or a `target` override for input events.
 */
export function fire(node: StubElement, type: string, props: Record<string, any> = {}) {
  const event = { type, target: node, currentTarget: node, ...props };
  for (const listener of node.listeners.get(type) ?? []) {
    listener(event);
  }
  return event;
}

/**
 * Serialize a stub tree to markup for easy assertions. Attributes render
 * in insertion order; no escaping (tests control their own text).
 */
export function serialize(node: StubElement | StubText): string {
  if (node instanceof StubText) return node.nodeValue;
  let out = '<' + node.tagName;
  for (const [name, value] of node.attributes) {
    out += value === '' ? ' ' + name : ` ${name}="${value}"`;
  }
  out += '>';
  for (const child of node.childNodes) out += serialize(child);
  return out + '</' + node.tagName + '>';
}

/** A fresh `{ document, container }` pair for one test. */
export function createStubHost() {
  const document = new StubDocument();
  const container = document.createElement('div');
  return { document, container };
}
