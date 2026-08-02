import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutiveReportService } from '../src/reports.js';

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
