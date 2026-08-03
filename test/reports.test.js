import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyReportService, ExecutiveReportService } from '../src/reports.js';

test('builds executive-report evidence from dated Asana activity and cached PR commits', async () => {
  const sha = 'a'.repeat(40);
  const store = {
    async rankAnalyses() { return [{ repository: 'owner/repo', sha, commitDate: '2026-08-02T11:00:00Z', originalMessage: 'feat: deploy' }]; },
    async getCommitRaw() { return { commit: { author: { name: 'Ana', email: 'ana@example.com' } }, author: { login: 'ana' } }; }
  };
  const asanaStore = {
    async listTaskGids() { return ['100']; },
    async getTaskRaw() { return { gid: '100', name: 'Despliegue', modified_at: '2026-08-02T10:00:00Z' }; },
    async getTaskStories() { return [{ type: 'comment', resource_subtype: 'comment_added', created_at: '2026-08-02T09:00:00Z', created_by: { name: 'Ana' }, text: 'Despliegue revisado.' }]; },
    async getTaskAnalysis() { return { task: { gid: '100' } }; }
  };
  const pullRequestStore = { async list() { return [{ repository: 'owner/repo', number: 12, commits: [{ sha: 'b'.repeat(40) }], pullRequest: { mergeCommitSha: sha }, asanaTasks: [{ projectGid: '10', taskGid: '100' }] }]; } };
  const result = await new ExecutiveReportService({ store, asanaStore, pullRequestStore }).collect({ repositories: ['owner/repo'], projectGids: ['10'], from: '2026-08-02', to: '2026-08-02' });
  assert.equal(result.coverage.pairedCommits, 1);
  assert.equal(result.entries[0].type, 'asana_commit');
  assert.equal(result.entries[0].commit.author.name, 'Ana');
  assert.equal(result.entries[0].task.activity[0].text, 'Despliegue revisado.');
});

test('generates one daily LLM report for every task with selected-user activity', async () => {
  const requests = [];
  const asanaStore = {
    async listStoryActivityByAuthor() { return [{ projectGid: '10', taskGid: '100', task: { name: 'Despliegue' }, analysis: { briefDescription: 'Preparar despliegue' }, events: [{ date: '2026-08-03T08:00:00Z', text: 'Validé la publicación.' }] }]; }
  };
  const lmStudio = { async structuredChat(request) { requests.push(request); return { summary: 'Validó la publicación.', activityType: 'validation', outcome: 'La publicación quedó validada.', confidence: 'high' }; } };
  const result = await new DailyReportService({ asanaStore, lmStudio }).generate({ model: 'test', language: 'es', projectGids: ['10'], author: 'Ana Pérez', from: '2026-08-03', to: '2026-08-03', instructions: 'Prioriza riesgos.' });
  assert.equal(result.coverage.generated, 1);
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[1].content, /Prioriza riesgos/);
  assert.match(requests[0].messages[1].content, /Ana Pérez/);
});
