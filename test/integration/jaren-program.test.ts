import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironment } from '@tangleai/context/environment';
import { createProgramAuthor, createProgramRunner, readProgramAnswer } from '@tangleai/agents/program';
import { createLongHorizonAgent } from '@tangleai/agents/recursive';
import { createStructuredOutput } from '@tangleai/models/structured';
import { type ProgramRunResult } from '@tangleai/agents/program-result';
import { compileJsonQuery, analyzeQuery, annotateTypes } from '@jarenjs/json/query';

it('the migrated program mechanisms preserve failed and large cited leaves through real recursion', async () => {
  const environment = createEnvironment();
  await environment.put('corpus', ['[D1:1] timeout', '[D1:2] Boston'].map(line => line.padEnd(1800, '.')).join('\n'));
  const evidence = { records: [{ text: 'A supported fact about Boston. '.repeat(90), ids: ['D1:2'] }] };
  const client = { endpoint: { provider: 'openrouter' }, complete: async ({ messages }: any) => {
    const example = /right shape:\n([^\n]+)/.exec(messages[0].content);
    if (example) return { message: { content: example[1] } };
    if (messages[1].content.includes('[D1:1]')) throw new Error('simulated provider timeout');
    return { message: { content: JSON.stringify(evidence) } };
  } };
  const programs: ProgramRunResult[] = [];
  const result = await createLongHorizonAgent({ client, environment,
    compileQuery: compileJsonQuery, analyzeQuery, annotateTypes, depth: 1,
    createProgramAuthor, createStructuredOutput, createEnvironment,
    createProgramRunner: (options: any) => {
      const runner = createProgramRunner(options);
      return { run: async (doc: any, hooks: any) => {
        const output = await runner.run(doc, hooks);
        programs.push(output);
        return output;
      } };
    },
  }).run('Collect evidence.');
  assert.equal(result.ok, true, result.error);
  const root = programs.at(-1)!;
  assert.equal(root.ok, true);
  if (!root.ok) return;
  const truncated: boolean = root.answer.truncated;
  assert.equal(truncated, true);
  // @ts-expect-error the installed declarations must retain numeric accounting
  const invalid: string = root.subcalls;
  void invalid;
  const full = await readProgramAnswer(environment, root.answer, { maxChars: 64000 });
  assert.equal(full.ok, true);
  if (!full.ok) return;
  const items = JSON.parse(full.answer.text);
  assert.equal(items.length, 2);
  assert.equal(items[0].value, null);
  assert.match(items[0].error, /simulated provider timeout/);
  assert.deepEqual(items[1].value, evidence);
  assert.equal(root.failed, 1);
});
