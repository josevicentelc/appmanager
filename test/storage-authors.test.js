import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileStore } from '../src/storage.js';

test('aggregates commit authors from raw GitHub metadata with date filters', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'appmanager-authors-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new FileStore(directory); const repository = 'owner/repo';
  const save = (sha, name, email, login, date) => store.saveCommit(repository, sha, { sha, author: login ? { login } : null, commit: { author: { name, email, date } } }, '', { repository, sha, commitDate: date }, { state: 'completed' });
  await save('a1', 'Ana', 'ana@example.test', 'ana', '2026-03-01T00:00:00Z');
  await save('a2', 'Ana Different', 'ana@example.test', 'ana', '2026-03-05T00:00:00Z');
  await save('b1', 'Bruno', 'bruno@example.test', 'bruno', '2026-02-28T23:59:59Z');
  const result = await store.listCommitAuthors([repository], { from: '2026-03-01' });
  assert.equal(result.matchedCommits, 2);
  assert.deepEqual(result.authors, [{ name: 'Ana', email: 'ana@example.test', githubLogin: 'ana', commits: 2, repositories: [repository], firstCommitDate: '2026-03-01T00:00:00Z', lastCommitDate: '2026-03-05T00:00:00Z' }]);
});
