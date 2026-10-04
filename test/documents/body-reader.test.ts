import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readBoundedResponseBytes } from '@tangleai/documents/fetch';

it('bounded response capture cancels a pending body read on abort', async () => {
  let cancelled = 0;
  const controller = new AbortController(), response = new Response(new ReadableStream({ cancel() { cancelled++; } }));
  const pending = readBoundedResponseBytes(response, 32, undefined, controller.signal);
  controller.abort(new Error('fixture cancellation'));
  await assert.rejects(pending, /fixture cancellation/); assert.equal(cancelled, 1);
});
it('bounded capture counts the whole over-limit chunk before refusing it', async () => {
  let charged = 0, cancelled = 0;
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16)); }, cancel() { cancelled++; } }));
  await assert.rejects(readBoundedResponseBytes(response, 8, count => { charged += count; }), /exceeds/);
  assert.equal(charged, 16); assert.equal(cancelled, 1);
});
it('capture charges an already delivered chunk even when abort wins before its continuation', async () => {
  const controller = new AbortController(); let charged = 0;
  const pending = readBoundedResponseBytes(new Response(new Uint8Array(16)), 32, count => { charged += count; }, controller.signal);
  controller.abort(new Error('cancel after delivery'));
  await assert.rejects(pending, /cancel after delivery/); assert.equal(charged, 16);
});
