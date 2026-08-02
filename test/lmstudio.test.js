import assert from 'node:assert/strict';
import test from 'node:test';
import { LMStudioClient } from '../src/lmstudio.js';

test('preserves failed structured-output diagnostics', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    { choices: [{ finish_reason: 'length', message: { content: 'not json', reasoning_content: 'first reasoning' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'still not json', reasoning_content: 'fallback reasoning' } }] }
  ];
  globalThis.fetch = async () => ({ ok: true, json: async () => responses.shift() });
  try {
    await assert.rejects(
      new LMStudioClient('http://localhost/v1').structuredChat({ model: 'test', messages: [], jsonSchema: { name: 'test', schema: {} } }),
      (error) => error.llmOutput === 'still not json' && error.llmReasoning === 'fallback reasoning' && error.llmFinishReason === 'stop'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('accepts structured JSON returned in reasoning content', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: '{"items":[]}' } }] }) });
  try {
    const result = await new LMStudioClient('http://localhost/v1').structuredChat({ model: 'test', messages: [], jsonSchema: { name: 'test', schema: {} } });
    assert.deepEqual(result, { items: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
