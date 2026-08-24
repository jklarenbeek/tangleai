/**
 * The Tangle memory loop as a `jaren-dag` 0.1 document.
 *
 * This is the SAME loop the walking skeleton runs inline, lifted into a
 * flow document so that (a) @jarenjs/flow executes it with real
 * per-node observability (`onNode` → the run log → the desktop DAG
 * page, current and historical), and (b) @jarenjs/mermaid can project
 * the topology for display from the document itself — the picture the
 * user sees IS the thing that runs, not an illustration of it.
 *
 * Stage order is the twice-learned design rule: the novelty gate only
 * filters near-verbatim repeats, contradictions are resolved BEFORE
 * crystallization (a contradiction is ~0.95-similar to what it
 * contradicts), and the crystallizer merges only what survived with its
 * meaning intact.
 *
 * Each stage hands its summary to the `report` output node through a
 * ported edge; the unported spine carries the data each next stage
 * needs. Handlers are injected at compile time (`createPipeline`) — the
 * document names them, the host provides them, jarenjs's DI rule.
 */

export const PIPELINE_DAG = {
  $dag: '0.1',
  nodes: {
    observations: { kind: 'input' },
    embed: { kind: 'task', run: 'embed' },
    novelty: { kind: 'task', run: 'novelty' },
    contradiction: { kind: 'task', run: 'contradiction' },
    crystallize: { kind: 'task', run: 'crystallize' },
    report: { kind: 'output' },
  },
  edges: [
    { from: 'observations', to: 'embed' },
    { from: 'embed', to: 'novelty' },
    { from: 'novelty', to: 'contradiction' },
    { from: 'contradiction', to: 'crystallize' },
    { from: 'embed', to: 'report', port: 'embed' },
    { from: 'novelty', to: 'report', port: 'novelty' },
    { from: 'contradiction', to: 'report', port: 'contradiction' },
    { from: 'crystallize', to: 'report', port: 'crystallize' },
  ],
};

/** The node ids, in pipeline order — what the UI renders as the status strip. */
export const PIPELINE_NODES = ['observations', 'embed', 'novelty', 'contradiction', 'crystallize', 'report'] as const;
