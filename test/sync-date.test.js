import assert from 'node:assert/strict';
import test from 'node:test';
import { isWithinImportRange } from '../src/sync.js';

const commit = (authorDate, committerDate = authorDate) => ({ commit: { author: { date: authorDate }, committer: { date: committerDate } } });

test('excludes an old authored commit even when GitHub exposes it due to a recent committer date', () => {
  assert.equal(isWithinImportRange(commit('2025-04-15T09:00:00Z', '2026-07-20T09:00:00Z'), '2026-03-01'), false);
});

test('includes commits authored on or after the inclusive import boundary', () => {
  assert.equal(isWithinImportRange(commit('2026-03-01T00:00:00Z'), '2026-03-01'), true);
  assert.equal(isWithinImportRange(commit('2026-03-01T00:00:00.001Z'), '2026-03-01'), true);
  assert.equal(isWithinImportRange(commit('2026-02-28T23:59:59.999Z'), '2026-03-01'), false);
});
