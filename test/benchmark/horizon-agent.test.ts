import { it } from 'node:test';
import assert from 'node:assert/strict';
import { addressedLines, coveragePlan, evidenceProgram, MAX_PIECE_CHARS,
  runBoundedQa, type HorizonClient } from '../../benchmark/lib/horizon-agent.ts';

const corpus = Array.from({ length: 480 }, (_, index) =>
  `[D1:${index + 1}] (20 April 2023) Alex: ${index === 479 ? 'I will visit Boston and meet Sam there.' : 'An unrelated conversation turn. '.repeat(3)}`).join('\n');

function scripted(options: { author?: (program: any, attempt: number) => any,
  leaf?: (lines: Map<string, string>) => unknown, answer?: (evidence: any, attempt: number) => unknown } = {}) {
  const calls = { author: 0, leaf: 0, answer: 0 };
  const client: HorizonClient = {
    endpoint: { provider: 'openrouter' },
    async complete(request: any) {
      const name = request.responseFormat?.name;
      let value: unknown;
      if (name === 'jaren_program') {
        calls.author++;
        const size = Number(/line chunk size (\d+)/.exec(request.messages[0].content)![1]);
        const program = evidenceProgram(size, 'Extract facts relevant to the question, including places.');
        value = options.author?.(program, calls.author) ?? program;
      } else if (name === 'horizon_evidence') {
        calls.leaf++;
        const content: string = request.messages[1].content;
        const lines = addressedLines(content.slice(content.indexOf('--- piece')));
        value = options.leaf?.(lines) ?? { records: [...lines].filter(([, line]) => line.includes('Boston'))
          .map(([id, line]) => ({ text: line, ids: [id] })) };
      } else if (name === 'horizon_answer') {
        calls.answer++;
        const content: string = request.messages[1].content;
        const evidence = JSON.parse(content.slice(content.indexOf('\nEvidence: ') + '\nEvidence: '.length));
        value = options.answer?.(evidence, calls.answer)
          ?? { status: 'answered', answer: 'United States', citations: ['D1:480'] };
      } else throw new Error(`Unexpected request ${name}`);
      return { message: { role: 'assistant', content: JSON.stringify(value) }, usage: { total_tokens: 10 } };
    },
  };
  return { calls, client };
}
const run = (client: HorizonClient, text = corpus) => runBoundedQa({ client, corpus: text,
  question: 'Which country will Alex and Sam meet in?', turns: 10, maxSubcalls: 4, concurrency: 4, clock: Date.now });

it('covers late evidence without splitting lines or exceeding the per-piece read bound', async () => {
  const plan = coveragePlan(corpus, 4);
  assert.ok(plan.pieces.length <= 4);
  assert.equal(plan.pieces.map((piece) => piece.text).join(''), corpus);
  assert.ok(plan.pieces.every((piece) => piece.text.length <= MAX_PIECE_CHARS));
  const { client, calls } = scripted({ answer: (evidence) => {
    assert.ok(evidence.sourceTurns.some((line: string) => line.includes('Boston')));
    return { status: 'answered', answer: 'United States', citations: ['D1:480'] };
  } });
  const result = await run(client);
  assert.equal(result.status, 'answered', result.error ?? '');
  assert.equal(result.metrics.visitedChars, corpus.length);
  assert.equal(result.metrics.visitedPieces, plan.pieces.length);
  assert.equal(calls.leaf, plan.pieces.length);
  assert.equal(result.metrics.calls, calls.author + calls.leaf + calls.answer);
  assert.deepEqual(JSON.parse(result.answer!.text), { answer: 'United States', citations: ['D1:480'] });
});

it('repairs sequence-cardinality mistakes before any leaf calls', async () => {
  let leavesAtRepair = -1;
  const wire = scripted({ author: (program, attempt) => {
    if (attempt === 1) program.steps[2].query = { slot: 'corpus', value: '$[*]' };
    else leavesAtRepair = wire.calls.leaf;
    return program;
  } });
  const result = await run(wire.client);
  assert.equal(result.status, 'answered', result.error ?? '');
  assert.equal(leavesAtRepair, 0);
  assert.equal(result.metrics.authorAttempts, 2);
  assert.equal(result.metrics.programFailures, 0);
});

it('repairs a runtime schema failure without buying identical leaf requests twice', async () => {
  const { client, calls } = scripted({ author: (program, attempt) => {
    if (attempt === 1) program.steps[2].outputSchema = {
      type: 'object', required: ['slot', 'value'], properties: {
        slot: { type: 'string' }, value: { type: 'array', maxItems: 0 },
      },
    };
    return program;
  } });
  const result = await run(client);
  assert.equal(result.status, 'answered', result.error ?? '');
  assert.equal(result.metrics.programFailures, 1);
  assert.equal(result.metrics.programAttempts, 2);
  assert.equal(result.metrics.executionRepairs, 1);
  assert.equal(result.metrics.reusedSubcalls, calls.leaf);
  assert.equal(calls.leaf, result.metrics.totalPieces);
  assert.equal(result.metrics.calls, calls.author + calls.leaf + calls.answer);
});

it('classifies no evidence as abstention and never an empty successful answer', async () => {
  const { client, calls } = scripted({ leaf: () => ({ records: [] }) });
  const result = await run(client);
  assert.equal(result.status, 'abstained');
  assert.equal(result.ok, false);
  assert.equal(result.answer, null);
  assert.equal(calls.answer, 0);
});

it('rejects empty or unsupported final answers after one bounded repair', async () => {
  for (const answer of [{ status: 'answered', answer: '', citations: ['D1:480'] },
    { status: 'answered', answer: 'United States', citations: ['D99:1'] }]) {
    const { client, calls } = scripted({ answer: () => answer });
    const result = await run(client);
    assert.equal(result.status, 'invalid');
    assert.equal(result.answer, null);
    assert.equal(calls.answer, 2);
  }
});

it('refuses a corpus that cannot fit instead of silently reading its prefix', async () => {
  const { client, calls } = scripted();
  const result = await run(client, `[D1:1] ${'x'.repeat(MAX_PIECE_CHARS + 1)}`);
  assert.equal(result.status, 'failed');
  assert.match(result.error!, /coverage-limit/);
  assert.deepEqual(calls, { author: 0, leaf: 0, answer: 0 });
});

it('reads the full checked evidence slot instead of its truncated answer preview', async () => {
  const { client } = scripted({
    leaf: (lines) => ({ records: Array.from({ length: 7 }, (_, i) => ({
      text: `${i}: ${'A supported fact about travel. '.repeat(16)}`, ids: [[...lines.keys()][0]],
    })) }),
    answer: (evidence) => {
      assert.ok(JSON.stringify(evidence.records).length > 8000);
      assert.equal(evidence.records.length, 7 * coveragePlan(corpus, 4).pieces.length);
      return { status: 'answered', answer: 'travel', citations: evidence.records[0].ids };
    },
  });
  const result = await run(client);
  assert.equal(result.status, 'answered', result.error ?? '');
});

it('rejects fabricated leaf citations before they can reach synthesis', async () => {
  const { client, calls } = scripted({ leaf: () => ({ records: [{ text: 'Boston', ids: ['D99:1'] }] }) });
  const result = await run(client);
  assert.equal(result.ok, false);
  assert.equal(result.trajectory[1].failed, calls.leaf);
  assert.equal(calls.answer, 0);
});

it('shares one turn cap across author repairs, extraction and synthesis repairs', async () => {
  const wire = scripted({ author: (program, attempt) => {
    if (attempt === 1) program.steps[2].query = { slot: 'corpus', value: '$[*].value' };
    return program;
  }, answer: (_evidence, attempt) => attempt === 1
    ? { status: 'answered', answer: '', citations: [] }
    : { status: 'answered', answer: 'United States', citations: ['D1:480'] } });
  const result = await runBoundedQa({ client: wire.client, corpus: '[D1:480] (20 April 2023) Alex: Meet me in Boston.',
    question: 'Which country?', turns: 5, maxSubcalls: 1, concurrency: 4, clock: Date.now });
  assert.equal(result.status, 'answered', result.error ?? '');
  assert.deepEqual(wire.calls, { author: 2, leaf: 1, answer: 2 });
  assert.equal(result.metrics.calls, 5);
});

it('honors cancellation before authoring without sending a request', async () => {
  const wire = scripted();
  const controller = new AbortController();
  controller.abort();
  const result = await runBoundedQa({ client: wire.client, corpus, question: 'Where?',
    turns: 10, maxSubcalls: 4, concurrency: 4, clock: Date.now, signal: controller.signal });
  assert.equal(result.ok, false);
  assert.deepEqual(wire.calls, { author: 0, leaf: 0, answer: 0 });
});

it('retains a failed leaf in the census while synthesizing from remaining checked evidence', async () => {
  const wire = scripted({ leaf: (lines) => {
    if (lines.has('D1:1')) throw new Error('A simulated provider timeout');
    return { records: [...lines].filter(([, line]) => line.includes('Boston'))
      .map(([id, line]) => ({ text: line, ids: [id] })) };
  } });
  const result = await run(wire.client);
  assert.equal(result.status, 'answered', result.error ?? '');
  assert.equal(result.trajectory[1].failed, 1);
  assert.equal(result.metrics.calls, wire.calls.author + wire.calls.leaf + wire.calls.answer);
});
