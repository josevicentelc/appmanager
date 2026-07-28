import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AsanaStore } from '../src/asana-storage.js';

test('stores raw Asana material and retrieves structured task knowledge', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'appmanager-asana-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new AsanaStore(directory);
  const projectGid = '120001'; const taskGid = '120002';
  await store.saveTask(projectGid, taskGid, {
    task: { gid: taskGid, name: 'Preparar despliegue' }, stories: [{ gid: '1', text: 'Se ha revisado el plan.' }],
    attachments: [{ gid: '2', name: 'plan.md', downloaded: true, localPath: 'attachments/2__plan.md' }],
    analysis: { project: { gid: projectGid, name: 'Plataforma' }, task: { gid: taskGid, name: 'Preparar despliegue', completed: false, modifiedAt: '2026-01-01T00:00:00Z' }, briefDescription: 'Plan de despliegue', objective: 'Publicar la versión', statusSummary: 'En curso', tags: ['servidor'], workPerformed: ['Revisión'], decisions: [], blockers: ['Pendiente de aprobación'], risksOrFollowUps: [] },
    status: { state: 'completed', remoteModifiedAt: '2026-01-01T00:00:00Z' }
  });
  const found = await store.searchAnalyses([projectGid], { query: 'despliegue servidor' });
  assert.equal(found.length, 1);
  assert.equal(found[0].source, `asana:${projectGid}@${taskGid}`);
  assert.deepEqual(await store.getTaskStories(projectGid, taskGid), [{ gid: '1', text: 'Se ha revisado el plan.' }]);
  assert.equal((await store.getAttachments(projectGid, taskGid))[0].name, 'plan.md');
});
