import test from 'node:test';
import assert from 'node:assert/strict';
import { CommitClassificationAgent } from '../src/agents.js';

const commit = (index) => ({
  repository: 'owner/project',
  sha: String(index).padStart(40, '0'),
  commitDate: `2026-01-${String(index).padStart(2, '0')}T10:00:00Z`,
  originalMessage: index % 2 ? 'feat(server): endpoint' : 'feat(frontend): screen',
  briefDescription: 'Change',
  technicalDetails: { filesChanged: [index % 2 ? 'src/server.js' : 'public/app.js'] }
});

const classification = (item) => ({
  repository: item.repository,
  sha: item.sha,
  relevant: item.originalMessage.includes('server'),
  category: item.originalMessage.includes('server') ? 'server' : 'frontend',
  reason: 'Classified from commit message and file path.',
  evidence: item.filesChanged,
  confidence: 'high'
});

test('classification agent retries missing commits and verifies complete coverage', async () => {
  const commits = [commit(1), commit(2), commit(3)];
  let call = 0;
  const lmStudio = {
    async structuredChat({ messages }) {
      call += 1;
      const supplied = JSON.parse(messages[1].content.split('\n\nCommits:\n')[1]);
      return { items: call === 1 ? supplied.slice(0, 2).map(classification) : supplied.map(classification) };
    }
  };
  const result = await new CommitClassificationAgent(lmStudio).run({ model: 'test', language: 'es', task: 'Cambios de servidor', commits });
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.requested, 3);
  assert.equal(result.coverage.processed, 3);
  assert.equal(result.coverage.attempts, 2);
  assert.equal(result.relevant.length, 2);
});

test('classification agent reports references the worker failed to classify', async () => {
  const commits = [commit(1), commit(2)];
  const lmStudio = { async structuredChat() { return { items: [] }; } };
  const result = await new CommitClassificationAgent(lmStudio).run({ model: 'test', language: 'es', task: 'Cambios de servidor', commits });
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.processed, 0);
  assert.equal(result.coverage.missing.length, 2);
});

test('classification agent keeps the chat recoverable when structured output fails', async () => {
  const commits = [commit(1)];
  const activities = [];
  const lmStudio = { async structuredChat() { throw new Error('El modelo no devolvió un objeto JSON.'); } };
  const result = await new CommitClassificationAgent(lmStudio).run({ model: 'test', language: 'es', task: 'Cambios de servidor', commits, onActivity: (activity) => activities.push(activity) });
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.attempts, 2);
  assert.equal(activities.filter((activity) => activity.stage === 'agent_batch_failed').length, 2);
});
