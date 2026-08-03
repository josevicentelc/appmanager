import fs from 'node:fs/promises';
import path from 'node:path';

const safeName = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, '_');
const words = (value) => String(value ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}_./-]{2,}/gu) ?? [];
async function writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); await fs.rename(temporary, file); }
async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }

export class AsanaStore {
  constructor(dataDirectory) { this.root = path.join(dataDirectory, 'asana'); }
  projectDirectory(projectGid) { return path.join(this.root, 'projects', safeName(projectGid)); }
  taskDirectory(projectGid, taskGid) { return path.join(this.projectDirectory(projectGid), 'tasks', safeName(taskGid)); }
  stateFile(projectGid) { return path.join(this.projectDirectory(projectGid), 'state.json'); }
  async getState(projectGid) { return readJson(this.stateFile(projectGid), { projectGid, lastSyncedAt: null, processedTasks: 0, failedTasks: 0, sync: null, lastError: null }); }
  async saveState(projectGid, state) { await writeJson(this.stateFile(projectGid), { ...state, updatedAt: new Date().toISOString() }); }
  async getTaskStatus(projectGid, taskGid) { return readJson(path.join(this.taskDirectory(projectGid, taskGid), 'status.json'), null); }
  async getTaskAnalysis(projectGid, taskGid) { return readJson(path.join(this.taskDirectory(projectGid, taskGid), 'analysis.json'), null); }
  async getTaskRaw(projectGid, taskGid) { return readJson(path.join(this.taskDirectory(projectGid, taskGid), 'task-raw.json'), null); }
  async getTaskStories(projectGid, taskGid) { return readJson(path.join(this.taskDirectory(projectGid, taskGid), 'stories-raw.json'), []); }
  async getAttachments(projectGid, taskGid) { return readJson(path.join(this.taskDirectory(projectGid, taskGid), 'attachments.json'), []); }
  async saveTask(projectGid, taskGid, { task, stories, attachments, analysis, status }) {
    const directory = this.taskDirectory(projectGid, taskGid);
    await Promise.all([
      task ? writeJson(path.join(directory, 'task-raw.json'), task) : Promise.resolve(),
      stories ? writeJson(path.join(directory, 'stories-raw.json'), stories) : Promise.resolve(),
      attachments ? writeJson(path.join(directory, 'attachments.json'), attachments) : Promise.resolve(),
      analysis ? writeJson(path.join(directory, 'analysis.json'), analysis) : Promise.resolve(),
      status ? writeJson(path.join(directory, 'status.json'), status) : Promise.resolve()
    ]);
  }
  attachmentFile(projectGid, taskGid, relativePath) {
    const directory = this.taskDirectory(projectGid, taskGid);
    const target = path.resolve(directory, String(relativePath ?? ''));
    if (!target.startsWith(`${directory}${path.sep}`)) throw new Error('Invalid attachment path.');
    return target;
  }
  async saveAttachment(projectGid, taskGid, attachment, data) {
    const directory = path.join(this.taskDirectory(projectGid, taskGid), 'attachments');
    await fs.mkdir(directory, { recursive: true });
    const filename = `${safeName(attachment.gid)}__${safeName(attachment.name)}`;
    const target = path.join(directory, filename);
    await fs.writeFile(target, data);
    return path.relative(this.taskDirectory(projectGid, taskGid), target).replace(/\\/g, '/');
  }
  async attachmentExists(projectGid, taskGid, relativePath) { try { await fs.access(this.attachmentFile(projectGid, taskGid, relativePath)); return true; } catch { return false; } }
  async readAttachment(projectGid, taskGid, relativePath) { return fs.readFile(this.attachmentFile(projectGid, taskGid, relativePath)); }
  async listTaskGids(projectGid) { try { return (await fs.readdir(path.join(this.projectDirectory(projectGid), 'tasks'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
  async findProjectForTask(projectGids, taskGid) {
    for (const projectGid of projectGids) if ((await this.listTaskGids(projectGid)).includes(String(taskGid))) return projectGid;
    return null;
  }
  async findAttachment(projectGids, attachmentGid) {
    for (const projectGid of projectGids) {
      for (const taskGid of await this.listTaskGids(projectGid)) {
        const attachment = (await this.getAttachments(projectGid, taskGid)).find((item) => String(item.gid) === String(attachmentGid));
        if (attachment) return { projectGid, taskGid, attachment };
      }
    }
    return null;
  }
  async listAnalyses(projectGids, { createdSince = '', createdUntil = '' } = {}) {
    const analyses = [];
    for (const projectGid of projectGids) for (const taskGid of await this.listTaskGids(projectGid)) {
      const analysis = await this.getTaskAnalysis(projectGid, taskGid);
      if (!analysis) continue;
      const createdAt = analysis.task?.createdAt ?? (await this.getTaskRaw(projectGid, taskGid))?.created_at ?? '';
      if (createdSince && (!createdAt || createdAt < `${createdSince}T00:00:00.000Z`)) continue;
      if (createdUntil && (!createdAt || createdAt > `${createdUntil}T23:59:59.999Z`)) continue;
      analyses.push(createdAt && !analysis.task?.createdAt ? { ...analysis, task: { ...analysis.task, createdAt } } : analysis);
    }
    return analyses.sort((a, b) => String(b.task?.modifiedAt ?? '').localeCompare(String(a.task?.modifiedAt ?? '')));
  }
  async listStoryAuthorNames(projectGids) {
    const names = new Set();
    for (const projectGid of projectGids) for (const taskGid of await this.listTaskGids(projectGid)) {
      for (const story of await this.getTaskStories(projectGid, taskGid)) {
        const name = String(story?.created_by?.name ?? '').trim();
        if (name) names.add(name);
      }
    }
    return [...names].sort((left, right) => left.localeCompare(right, 'es'));
  }
  async listStoryActivityByAuthor(projectGids, { author, from, to } = {}) {
    const selectedAuthor = String(author ?? '').trim();
    if (!selectedAuthor) return [];
    const activities = [];
    for (const projectGid of projectGids) for (const taskGid of await this.listTaskGids(projectGid)) {
      const [task, analysis, stories] = await Promise.all([this.getTaskRaw(projectGid, taskGid), this.getTaskAnalysis(projectGid, taskGid), this.getTaskStories(projectGid, taskGid)]);
      const events = stories.filter((story) => String(story?.created_by?.name ?? '').trim() === selectedAuthor)
        .filter((story) => String(story.created_at ?? '') >= `${from}T00:00:00.000Z` && String(story.created_at ?? '') <= `${to}T23:59:59.999Z`)
        .map((story) => ({ gid: story.gid ?? null, type: story.type ?? null, resourceSubtype: story.resource_subtype ?? null, date: story.created_at, text: story.text ?? null, oldValue: story.old_value ?? null, newValue: story.new_value ?? null }));
      if (events.length) activities.push({ projectGid, taskGid, task, analysis, events });
    }
    return activities.sort((left, right) => String(left.events[0]?.date ?? '').localeCompare(String(right.events[0]?.date ?? '')));
  }
  async searchAnalyses(projectGids, { query = '', projectGid = '', createdSince = '', createdUntil = '', completed, limit = 12 } = {}) {
    const terms = [...new Set(words(query))];
    return (await this.listAnalyses(projectGids, { createdSince, createdUntil })).filter((analysis) => !projectGid || analysis.project?.gid === projectGid)
      .filter((analysis) => completed === undefined || analysis.task?.completed === completed)
      .map((analysis) => {
        const searchable = [analysis.project?.name, analysis.task?.name, analysis.task?.assigneeName, analysis.briefDescription, analysis.objective, analysis.statusSummary, ...(analysis.tags ?? []), ...(analysis.workPerformed ?? []), ...(analysis.decisions ?? []), ...(analysis.blockers ?? []), ...(analysis.risksOrFollowUps ?? [])].join(' ').toLocaleLowerCase();
        return { analysis, score: terms.reduce((total, term) => total + (searchable.includes(term) ? 1 : 0), 0) };
      }).filter(({ score }) => !terms.length || score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(Number(limit) || 12, 30)))
      .map(({ analysis }) => ({ source: `asana:${analysis.project?.gid}@${analysis.task?.gid}`, project: analysis.project, task: analysis.task, briefDescription: analysis.briefDescription, tags: analysis.tags ?? [], blockers: analysis.blockers ?? [] }));
  }
}
