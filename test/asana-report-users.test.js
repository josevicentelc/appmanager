import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AsanaStore } from '../src/asana-storage.js';

test('lists unique Asana story authors for the daily-report selector', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'appmanager-asana-users-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new AsanaStore(directory);
  const projectGid = '120001';
  for (const [taskGid, authorName] of [['1', 'Ana Pérez'], ['2', 'Rubén Hernández'], ['3', 'Ana Pérez']]) {
    await store.saveTask(projectGid, taskGid, { stories: [{ created_by: { name: authorName } }] });
  }
  assert.deepEqual(await store.listStoryAuthorNames([projectGid]), ['Ana Pérez', 'Rubén Hernández']);
});
