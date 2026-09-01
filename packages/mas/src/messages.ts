/**
 * The three message adapters — pure, versioned, order-preserving.
 *
 * An adapter changes REPRESENTATION, never topology: it renders one
 * node's aggregated inbound units (entry values first, then message
 * deliveries in edge-document order — the one authoritative aggregation
 * order) into the request an agent sees. It never inspects completion
 * time, resolves a provider, or drops an invalid unit; delivery
 * validation is the node lifecycle's and an invalid value fails there
 * as `TMAS2004` with the value retained on the attempt.
 *
 *   plain             `[source]` paragraphs
 *   markdown-sections stable `## source` sections; a content line that
 *                     would read as a section header is escaped with a
 *                     leading backslash — the only escaping the
 *                     protocol requires
 *   json-schema       the aggregated port object as canonical-ish JSON
 *                     (stable two-space rendering); local validation
 *                     happens at the boundary, not here
 */

export interface MasInboundUnit {
  /** The source invocation id, or 'input' for a workflow entry value. */
  source: string;
  port: string;
  payload: unknown;
}

export interface MasRenderableInput {
  /** Aggregated values keyed by input port, in declared port order. */
  value: Record<string, unknown>;
  /** Ordered inbound units: entry deliveries, then edge-document order. */
  units: ReadonlyArray<MasInboundUnit>;
}

export interface MasMessageAdapter {
  id: string;
  version: string;
  render(input: MasRenderableInput): string;
}

function textOf(payload: unknown): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

export const plainAdapter: MasMessageAdapter = {
  id: 'plain',
  version: '0.1',
  render(input) {
    return input.units.map((unit) => `[${unit.source}]\n${textOf(unit.payload)}`).join('\n\n');
  },
};

const SECTION_HEADER = /^## [a-z][a-z0-9-]*$/;

export const markdownSectionsAdapter: MasMessageAdapter = {
  id: 'markdown-sections',
  version: '0.1',
  render(input) {
    return input.units.map((unit) => {
      const body = textOf(unit.payload)
        .split('\n')
        .map((line) => (SECTION_HEADER.test(line) ? `\\${line}` : line))
        .join('\n');
      return `## ${unit.source}\n\n${body}`;
    }).join('\n\n');
  },
};

export const jsonSchemaAdapter: MasMessageAdapter = {
  id: 'json-schema',
  version: '0.1',
  render(input) {
    return JSON.stringify(input.value, null, 2);
  },
};

export const BUILTIN_MESSAGE_ADAPTERS: ReadonlyMap<string, MasMessageAdapter> = new Map([
  [plainAdapter.id, plainAdapter],
  [markdownSectionsAdapter.id, markdownSectionsAdapter],
  [jsonSchemaAdapter.id, jsonSchemaAdapter],
]);
