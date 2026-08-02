import assert from 'node:assert/strict';
import test from 'node:test';
import { isCreatedSince } from '../src/asana-sync.js';

test('only accepts Asana tasks created on or after the configured date', () => {
  assert.equal(isCreatedSince({ created_at: '2026-03-01T00:00:00Z' }, '2026-03-01'), true);
  assert.equal(isCreatedSince({ created_at: '2026-02-28T23:59:59.999Z' }, '2026-03-01'), false);
  assert.equal(isCreatedSince({ created_at: null }, '2026-03-01'), false);
});
