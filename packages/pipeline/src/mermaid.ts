/**
 * The pipeline document, projected to Mermaid text.
 *
 * Uses the suite's own projection chain — the `dag-to-flowchart` JSLT
 * stylesheet shipped by @jarenjs/mermaid, `transformJson` from
 * @jarenjs/json, `toMermaid` over a diagram document — so the drawing
 * is DERIVED from the executable document, never hand-drawn. Node
 * statuses are deliberately NOT painted into the diagram; the UI
 * renders them as a strip beside it (data changes fast, topology
 * doesn't).
 */

import { toMermaid, diagramDocument } from '@jarenjs/mermaid';
import { transformJson } from '@jarenjs/json/jslt';
import dagToFlowchart from '@jarenjs/mermaid/stylesheets/dag-to-flowchart.jslt.json' with { type: 'json' };

import { PIPELINE_DAG } from './dag.ts';

export function dagToMermaid(doc: any = PIPELINE_DAG): string {
  const ast = transformJson(dagToFlowchart, doc);
  return toMermaid(diagramDocument('flowchart', {}, ast, { hash: '0', direction: 'TD', title: null }));
}
