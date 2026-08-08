import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeTools } from '../src/chat-tools.js';

test('general knowledge lookup includes dated Asana story activity', async () => {
  const tools = createKnowledgeTools({
    store: { searchAnalysesPage: async () => ({ results: [], totalMatches: 0 }) },
    asanaStore: {
      searchAnalyses: async () => [],
      searchStoryActivity: async (_projects, options) => {
        assert.equal(options.from, '2026-08-07');
        assert.equal(options.to, '2026-08-07');
        return [{ source: 'asana:120001@120010', projectGid: '120001', taskGid: '120010', task: { name: 'Preparar despliegue' }, briefDescription: 'Publicar versiÃ³n', events: [{ date: '2026-08-07T11:30:00.000Z', text: 'Revisado.' }] }];
      }
    },
    commitClassifier: {},
    getConfig: () => ({ asanaProjects: ['120001'], asanaImportSince: '2026-01-01' })
  });
  const result = await tools.safeKnowledgeTool({ function: { name: 'get_knowledge', arguments: JSON.stringify({ from: '2026-08-07', to: '2026-08-07' }) } }, []);
  assert.equal(result.totalAsanaActivityMatches, 1);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].kind, 'asana_activity');
  assert.equal(result.results[0].taskGid, '120010');
  assert.equal(result.results[0].events[0].text, 'Revisado.');
});
