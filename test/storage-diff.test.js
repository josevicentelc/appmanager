import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileStore } from '../src/storage.js';

const repository = 'owner/project';
const sha = '1234567890abcdef1234567890abcdef12345678';
const diff = `diff --git a/src/auth.js b/src/auth.js
--- a/src/auth.js
+++ b/src/auth.js
@@ -4,2 +4,3 @@ function authorize(token) {
+  validateSignature(token);
   return true;
 }
`;

test('persists, searches and reads diff hunks through FileStore', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'appmanager-test-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new FileStore(directory);
  await store.saveCommit(repository, sha, { parents: [] }, diff, {
    repository, sha, commitDate: '2026-01-02T10:00:00Z', originalMessage: 'Validate auth token',
    tags: ['security'], technicalDetails: {}
  }, { state: 'completed' });

  const search = await store.searchDiffHunks([repository], { query: 'validateSignature', limit: 3 });
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].source, `${repository}@${sha}:src/auth.js:h1`);
  assert.equal('snippet' in search.results[0], false);
  assert.match(search.topHunk.content, /validateSignature\(token\)/);
  assert.equal(search.topHunk.truncated, false);

  const hunk = await store.readDiffHunk(repository, sha, 'src/auth.js', 'h1');
  assert.match(hunk.content, /validateSignature\(token\)/);
  assert.equal(hunk.truncated, false);
});
