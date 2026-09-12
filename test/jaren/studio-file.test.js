import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createStudioFileAuthor } from '@tangleai/jaren/studio';
import { fileSkeleton } from '@jarenjs/studio';

it('authors one model grammar and repairs a semantic compiler refusal before accepting', async () => {
  const requests = [];
  const good = JSON.parse(fileSkeleton('model'));
  const bad = structuredClone(good);
  bad.collections.notes.key = '/';
  bad.collections.notes.indexes = [{ name: 'broken', path: '$[*]' }];
  const replies = [bad, good];
  const client = { endpoint: { provider: 'openrouter' }, complete: async (request) => {
    requests.push(request); return { message: { content: JSON.stringify(replies.shift()) } };
  } };
  const result = await createStudioFileAuthor({ client }).author({ project: { files: [] },
    name: 'notes.model', kind: 'model', prompt: 'Create a notes model.' });
  assert.equal(result.attempts, 2);
  assert.deepEqual(JSON.parse(result.file.text), good);
  assert.match(requests[0].responseFormat.schema.$id, /jaren-model/);
  assert.doesNotMatch(JSON.stringify(requests[0].responseFormat.schema), /jaren-project/);
  assert.match(JSON.stringify(requests[1].messages), /JD0004/);
});
