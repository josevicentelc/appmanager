const textAttachment = (attachment) => attachment.downloaded && (attachment.contentType?.startsWith('text/') || /\.(txt|md|json|csv|log|ya?ml)$/i.test(attachment.name ?? ''));
export const isCreatedSince = (task, importSince) => {
  const createdAt = new Date(task?.created_at);
  const cutoff = new Date(`${importSince}T00:00:00.000Z`);
  return Number.isFinite(createdAt.getTime()) && Number.isFinite(cutoff.getTime()) && createdAt >= cutoff;
};

export class AsanaSyncService {
  constructor({ environment, store, asana, lmStudio, getConfig }) {
    this.environment = environment; this.store = store; this.asana = asana; this.lmStudio = lmStudio; this.getConfig = getConfig;
    this.running = false; this.current = null; this.lastRun = null;
  }
  status() { return { configured: this.asana.configured(), running: this.running, current: this.current, lastRun: this.lastRun }; }
  async run() {
    if (!this.asana.configured()) return { started: false, reason: 'Configura ASANA_TOKEN y ASANA_WORKSPACE_ID en .env.' };
    if (this.running) return { started: false, reason: 'Ya hay una sincronización de Asana en curso.' };
    const projects = this.getConfig().asanaProjects ?? [];
    if (!projects.length) return { started: false, reason: 'Selecciona al menos un proyecto de Asana.' };
    this.running = true;
    const summary = { started: true, startedAt: new Date().toISOString(), completedAt: null, projects: [], errors: [] };
    try {
      for (const projectGid of projects) {
        const state = await this.store.getState(projectGid);
        try {
          this.current = { projectGid, stage: 'listing_tasks', position: 0, total: 0, taskGid: null };
          const allTasks = await this.asana.listProjectTasks(projectGid);
          const importSince = this.getConfig().asanaImportSince;
          const tasks = allTasks.filter((task) => isCreatedSince(task, importSince));
          await this.store.saveState(projectGid, { ...state, projectGid, sync: { state: 'running', total: tasks.length, startedAt: new Date().toISOString() }, lastError: null });
          let processed = 0; let skipped = 0; let failed = 0;
          for (const [index, compact] of tasks.entries()) {
            const existing = await this.store.getTaskStatus(projectGid, compact.gid);
            if (existing?.state === 'completed' && existing.remoteModifiedAt === compact.modified_at) {
              skipped += 1;
              this.current = { projectGid, stage: 'skipping_existing', position: index + 1, total: tasks.length, taskGid: compact.gid, taskName: compact.name };
              continue;
            }
            try {
              this.current = { projectGid, stage: 'downloading_task', position: index + 1, total: tasks.length, taskGid: compact.gid, taskName: compact.name };
              const [task, stories, attachmentRecords] = await Promise.all([this.asana.getTask(compact.gid), this.asana.getStories(compact.gid), this.asana.getAttachments(compact.gid)]);
              const attachments = [];
              const attachmentText = [];
              for (const attachment of attachmentRecords) {
                const prior = existing?.attachments?.find((item) => item.gid === attachment.gid);
                let downloaded = prior?.localPath && await this.store.attachmentExists(projectGid, compact.gid, prior.localPath) ? { ...prior, downloaded: true } : null;
                let data;
                if (downloaded && textAttachment(downloaded)) data = await this.store.readAttachment(projectGid, compact.gid, downloaded.localPath);
                if (!downloaded) {
                  const result = await this.asana.downloadAttachment(attachment);
                  downloaded = { ...attachment, downloaded: result.downloaded, downloadReason: result.reason ?? null, size: result.size ?? null, contentType: result.contentType ?? null, localPath: null };
                  data = result.data;
                  if (result.downloaded) downloaded.localPath = await this.store.saveAttachment(projectGid, compact.gid, { gid: attachment.gid, name: result.name }, result.data);
                }
                attachments.push(downloaded);
                if (data && textAttachment(downloaded)) attachmentText.push({ name: downloaded.name, content: data.toString('utf8').slice(0, 12_000) });
              }
              await this.store.saveTask(projectGid, compact.gid, { task, stories, attachments, status: { state: 'analyzing', remoteModifiedAt: compact.modified_at, attachments, attempts: (existing?.attempts ?? 0) + 1, startedAt: new Date().toISOString(), error: null } });
              this.current = { projectGid, stage: 'digesting_task', position: index + 1, total: tasks.length, taskGid: compact.gid, taskName: task.name };
              const analysis = await this.lmStudio.analyzeAsanaTask({ model: this.getConfig().model, language: this.getConfig().language, project: { gid: projectGid, name: task.projects?.find((project) => project.gid === projectGid)?.name ?? null }, task, stories, attachments, attachmentText });
              analysis.schemaVersion = 1; analysis.source = 'asana'; analysis.project = { ...analysis.project, gid: projectGid, name: task.projects?.find((project) => project.gid === projectGid)?.name ?? analysis.project?.name ?? null };
              analysis.task = { ...analysis.task, gid: task.gid, name: task.name, permalinkUrl: task.permalink_url, createdAt: task.created_at ?? null, completed: task.completed, modifiedAt: task.modified_at, assigneeName: task.assignee?.name ?? null };
              this.current = { projectGid, stage: 'saving_analysis', position: index + 1, total: tasks.length, taskGid: compact.gid, taskName: task.name };
              await this.store.saveTask(projectGid, compact.gid, { analysis, status: { state: 'completed', remoteModifiedAt: compact.modified_at, attachments, attempts: (existing?.attempts ?? 0) + 1, processedAt: new Date().toISOString(), error: null } });
              processed += 1;
            } catch (error) {
              failed += 1;
              await this.store.saveTask(projectGid, compact.gid, { status: { state: 'pending', remoteModifiedAt: compact.modified_at, attempts: (existing?.attempts ?? 0) + 1, lastAttemptAt: new Date().toISOString(), error: error.message, llmDiagnostics: error.llmOutput !== undefined ? { output: error.llmOutput, reasoning: error.llmReasoning, finishReason: error.llmFinishReason } : null } });
            }
          }
          await this.store.saveState(projectGid, { ...state, projectGid, lastSyncedAt: new Date().toISOString(), processedTasks: (state.processedTasks ?? 0) + processed, failedTasks: (state.failedTasks ?? 0) + failed, sync: { state: failed ? 'completed_with_pending' : 'completed', total: tasks.length, completedAt: new Date().toISOString() }, lastError: failed ? `${failed} tarea(s) pendientes.` : null });
          summary.projects.push({ projectGid, found: tasks.length, excludedByCreatedAt: allTasks.length - tasks.length, processed, skipped, failed });
        } catch (error) {
          await this.store.saveState(projectGid, { ...state, projectGid, sync: { state: 'error', failedAt: new Date().toISOString() }, lastError: error.message });
          summary.errors.push({ projectGid, error: error.message });
        }
      }
    } finally {
      summary.completedAt = new Date().toISOString(); this.current = null; this.running = false; this.lastRun = summary;
    }
    return summary;
  }
}
