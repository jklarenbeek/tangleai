/**
 * The trajectory-blind draft. What matters here is not how good the drafted
 * directory is — it is a scripted answer — but that the request could not have
 * seen either half of the split, and that a directory which does not hold
 * together never becomes a bundle.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { draftS0, guidanceLeakCheck, renderSkillScope, type SkillScope } from '@tangleai/trace2skill';
import { forbiddenTerms, scriptedClient } from './fixture.ts';

const SCOPE_INPUT: SkillScope = {
  scopeKey: 'tabular-extract',
  description: 'Answer one question about one small delimited table and return the bare value.',
  tools: [{ name: 'read_file', description: 'Read one file the task names.' }],
  answerShape: 'A bare value: a count as an integer, an identifier lower-cased.',
};

const DIRECTORY = {
  files: [
    { path: 'SKILL.md', content: '# Tabular extraction\n\nRead the named file and answer with the value alone.\n\nSee [conventions](references/conventions.md).\n' },
    { path: 'references/conventions.md', content: '- The first line of a delimited file is a header.\n' },
  ],
};

it('the draft seals a creation directory from the scope alone', async () => {
  const client = scriptedClient([{ answer: JSON.stringify(DIRECTORY) }]);
  const drafted = await draftS0(client, SCOPE_INPUT);
  assert.ok(drafted.valid, drafted.valid ? '' : JSON.stringify(drafted.issues));
  assert.equal(drafted.value.snapshot.bundle.mode, 'creation');
  assert.equal(drafted.value.snapshot.bundle.origin, 'parametric-draft');
  assert.equal(drafted.value.snapshot.bundle.parentId, null);
  assert.equal(drafted.value.snapshot.bundle.status, 'staged');
  assert.deepEqual(drafted.value.snapshot.bundle.files.map(file => file.path), ['SKILL.md', 'references/conventions.md']);
  assert.equal(drafted.value.attempts, 1);
  assert.equal(client.calls, 1);

  // Two drafts of one scripted answer seal the same identity.
  const again = await draftS0(scriptedClient([{ answer: JSON.stringify(DIRECTORY) }]), SCOPE_INPUT);
  assert.ok(again.valid);
  assert.equal(again.value.snapshot.bundle.id, drafted.value.snapshot.bundle.id);
  assert.equal(again.value.requestDigest, drafted.value.requestDigest);
});

it('the draft cannot address either split', async () => {
  const client = scriptedClient([{ answer: JSON.stringify(DIRECTORY) }]);
  const drafted = await draftS0(client, SCOPE_INPUT);
  assert.ok(drafted.valid);
  const text = drafted.value.requestText;
  assert.ok(text.endsWith(renderSkillScope(SCOPE_INPUT)), 'the digested text is the scope this draft was given');

  // No task instance, no input path and no registered answer can be in it —
  // the signature has no member any of them could arrive through.
  const sent = client.requests[0] as { messages: Array<{ content: string }> };
  const wire = sent.messages.map(message => message.content).join('\n\n');
  for (const carried of [text, wire]) {
    assert.equal(/task-\d\d/.test(carried), false, 'a task id reached the draft');
    assert.equal(carried.includes('inputs/'), false, 'an input path reached the draft');
  }
  const leak = guidanceLeakCheck(text, await forbiddenTerms());
  assert.ok(leak.valid, leak.valid ? '' : JSON.stringify(leak.issues));
  assert.deepEqual(Object.keys(SCOPE_INPUT).sort(), ['answerShape', 'description', 'scopeKey', 'tools']);
  // Everything the digest covers is also on the wire; what the wire adds is
  // the structured-output envelope, which is derived from the schema alone.
  assert.ok(wire.includes(renderSkillScope(SCOPE_INPUT)));
});

it('a directory that does not hold together is refused after its repair round', async () => {
  const broken = { files: [{ path: 'SKILL.md', content: '# Draft\n\nSee [missing](references/absent.md).\n' }] };
  const client = scriptedClient([{ answer: JSON.stringify(broken) }]);
  const drafted = await draftS0(client, SCOPE_INPUT, { maxRepairs: 1 });
  assert.ok(!drafted.valid);
  assert.equal(drafted.issues[0].code, 'TT2S1005');
  assert.equal(client.calls, 2, 'the gate sends the format refusal back once');
});

it('an unsafe path in a drafted directory never becomes a file', async () => {
  const escaping = { files: [{ path: '../SKILL.md', content: '# Draft\n\nText.\n' }] };
  const drafted = await draftS0(scriptedClient([{ answer: JSON.stringify(escaping) }]), SCOPE_INPUT, { maxRepairs: 0 });
  assert.ok(!drafted.valid);
  assert.equal(drafted.issues[0].code, 'TT2S1005');
});

it('a reply that is not a directory is a refusal rather than an empty bundle', async () => {
  const drafted = await draftS0(scriptedClient([{ answer: 'not json' }]), SCOPE_INPUT, { maxRepairs: 0 });
  assert.ok(!drafted.valid);
  assert.equal(drafted.issues[0].code, 'TT2S1005');
});
