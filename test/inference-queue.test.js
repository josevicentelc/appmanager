import assert from 'node:assert/strict';
import test from 'node:test';
import { InferenceQueue } from '../src/inference-queue.js';

test('serializes inferences and prioritizes interactive work already waiting in the queue', async () => {
  const queue = new InferenceQueue(); const events = [];
  let releaseBackground;
  const background = queue.run('background', async () => { events.push('background:start'); await new Promise((resolve) => { releaseBackground = resolve; }); events.push('background:end'); }, 10);
  const secondBackground = queue.run('background-two', async () => { events.push('background-two'); }, 10);
  const chat = queue.run('chat', async () => { events.push('chat'); }, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['background:start']);
  assert.deepEqual(queue.status(), { active: 'background', pending: 2, queued: ['chat', 'background-two'] });
  releaseBackground();
  await Promise.all([background, chat, secondBackground]);
  assert.deepEqual(events, ['background:start', 'background:end', 'chat', 'background-two']);
});
