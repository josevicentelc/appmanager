import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAppConfigInput } from '../src/request-handler.js';

test('normalizes persisted application configuration at the HTTP boundary', () => {
  const config = normalizeAppConfigInput({
    importSince: '2026-01-01', asanaImportSince: '2026-02-01', model: 'local-model',
    language: 'es', syncIntervalMinutes: '15', repositories: ['owner/repo', 'owner/repo'],
    repositoryNotes: { 'owner/repo': ' Arquitectura ' }, asanaProjects: ['123', 'invalid']
  }, { reportInstructions: 'Mantén el tono ejecutivo.' });
  assert.deepEqual(config.repositories, ['owner/repo']);
  assert.deepEqual(config.asanaProjects, ['123']);
  assert.equal(config.repositoryNotes['owner/repo'], 'Arquitectura');
  assert.equal(config.reportInstructions, 'Mantén el tono ejecutivo.');
  assert.equal(config.syncIntervalMinutes, 15);
});

test('rejects invalid repository identifiers', () => {
  assert.throws(() => normalizeAppConfigInput({
    importSince: '2026-01-01', asanaImportSince: '2026-01-01', language: 'es',
    syncIntervalMinutes: 5, repositories: ['not-a-repository'], asanaProjects: []
  }, {}), /Repositorio inválido/);
});
