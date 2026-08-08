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
    task: { gid: taskGid, name: 'Preparar despliegue', created_at: '2026-01-01T00:00:00Z' }, stories: [{ gid: '1', text: 'Se ha revisado el plan.' }],
    attachments: [{ gid: '2', name: 'plan.md', downloaded: true, localPath: 'attachments/2__plan.md' }],
    analysis: { project: { gid: projectGid, name: 'Plataforma' }, task: { gid: taskGid, name: 'Preparar despliegue', completed: false, modifiedAt: '2026-01-01T00:00:00Z' }, briefDescription: 'Plan de despliegue', objective: 'Publicar la versión', statusSummary: 'En curso', tags: ['servidor'], workPerformed: ['Revisión'], decisions: [], blockers: ['Pendiente de aprobación'], risksOrFollowUps: [] },
    status: { state: 'completed', remoteModifiedAt: '2026-01-01T00:00:00Z' }
  });
  const found = await store.searchAnalyses([projectGid], { query: 'despliegue servidor' });
  assert.equal(found.length, 1);
  assert.equal(found[0].source, `asana:${projectGid}@${taskGid}`);
  assert.equal((await store.searchAnalyses([projectGid], { createdUntil: '2025-12-31' })).length, 0);
  assert.deepEqual(await store.getTaskStories(projectGid, taskGid), [{ gid: '1', text: 'Se ha revisado el plan.' }]);
  assert.equal((await store.getAttachments(projectGid, taskGid))[0].name, 'plan.md');
  assert.deepEqual(await store.findAttachment([projectGid], '2'), { projectGid, taskGid, attachment: { gid: '2', name: 'plan.md', downloaded: true, localPath: 'attachments/2__plan.md' } });
  assert.equal(await store.findAttachment([projectGid], 'missing'), null);
  assert.equal(await store.findProjectForTask([projectGid], taskGid), projectGid);
  assert.throws(() => store.attachmentFile(projectGid, taskGid, '../outside.txt'), /Invalid attachment path/);
});

test('searches Asana stories by activity date instead of task creation date', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'appmanager-asana-activity-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new AsanaStore(directory);
  const projectGid = '120001';
  await store.saveTask(projectGid, '120010', {
    task: { gid: '120010', name: 'Preparar despliegue', permalink_url: 'https://app.asana.com/0/120010', created_at: '2026-01-01T00:00:00Z' },
    stories: [
      { gid: 'event-1', created_at: '2026-08-07T11:30:00.000Z', created_by: { name: 'Ana' }, text: 'He revisado el plan de despliegue.', type: 'comment' },
      { gid: 'event-2', created_at: '2026-08-08T11:30:00.000Z', created_by: { name: 'Luis' }, text: 'Pendiente de aprobaciÃ³n.', type: 'comment' }
    ],
    analysis: { task: { gid: '120010', name: 'Preparar despliegue' }, briefDescription: 'PublicaciÃ³n de una versiÃ³n.' }
  });
  await store.saveTask(projectGid, '120011', {
    task: { gid: '120011', name: 'Otra tarea', created_at: '2026-08-07T00:00:00Z' },
    stories: [{ gid: 'event-3', created_at: '2026-08-08T11:30:00.000Z', created_by: { name: 'Ana' }, text: 'Actividad posterior.', type: 'comment' }]
  });

  const matches = await store.searchStoryActivity([projectGid], { from: '2026-08-07', to: '2026-08-07', query: 'despliegue', author: 'Ana' });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].source, `asana:${projectGid}@120010`);
  assert.equal(matches[0].task.permalinkUrl, 'https://app.asana.com/0/120010');
  assert.deepEqual(matches[0].events.map((event) => event.gid), ['event-1']);
});
