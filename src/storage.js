import fs from 'node:fs/promises';
import path from 'node:path';

const safeRepositoryName = (repository) => repository.replace('/', '__');

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export class FileStore {
  constructor(dataDirectory) { this.dataDirectory = dataDirectory; }
  repositoryDirectory(repository) { return path.join(this.dataDirectory, 'repositories', safeRepositoryName(repository)); }
  stateFile(repository) { return path.join(this.repositoryDirectory(repository), 'state.json'); }
  commitDirectory(repository, sha) { return path.join(this.repositoryDirectory(repository), 'commits', sha); }
  async getState(repository) {
    return readJson(this.stateFile(repository), { repository, lastCheckedAt: null, processedCommits: 0, failedCommits: 0, lastError: null, updatedAt: null });
  }
  async saveState(repository, state) { await writeJson(this.stateFile(repository), { ...state, updatedAt: new Date().toISOString() }); }
  async getCommitStatus(repository, sha) { return readJson(path.join(this.commitDirectory(repository, sha), 'status.json'), null); }
  async saveCommit(repository, sha, raw, diff, analysis, status) {
    const directory = this.commitDirectory(repository, sha);
    await fs.mkdir(directory, { recursive: true });
    await Promise.all([
      writeJson(path.join(directory, 'github-raw.json'), raw),
      fs.writeFile(path.join(directory, 'diff.patch'), diff || '', 'utf8'),
      analysis ? writeJson(path.join(directory, 'analysis.json'), analysis) : Promise.resolve(),
      writeJson(path.join(directory, 'status.json'), status)
    ]);
  }
  async saveCommitStatus(repository, sha, status) { await writeJson(path.join(this.commitDirectory(repository, sha), 'status.json'), status); }
  async saveAnalysis(repository, sha, analysis) { await writeJson(path.join(this.commitDirectory(repository, sha), 'analysis.json'), analysis); }
  async listCommitShas(repository) {
    try { return (await fs.readdir(path.join(this.repositoryDirectory(repository), 'commits'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async getAnalysis(repository, sha) { return readJson(path.join(this.commitDirectory(repository, sha), 'analysis.json'), null); }
  async listAnalyses(repositories, limit = 100) {
    const analyses = [];
    for (const repository of repositories) {
      const shas = await this.listCommitShas(repository);
      for (const sha of shas) {
        const analysis = await this.getAnalysis(repository, sha);
        if (analysis) analyses.push(analysis);
      }
    }
    return analyses.sort((a, b) => String(b.commitDate ?? '').localeCompare(String(a.commitDate ?? ''))).slice(0, limit);
  }
  async listRepositoryStates(repositories) { return Promise.all(repositories.map((repository) => this.getState(repository))); }
  async getRepositoryProgress(repository, targetTotal = 0) {
    const commitsDirectory = path.join(this.repositoryDirectory(repository), 'commits');
    let entries = [];
    try { entries = await fs.readdir(commitsDirectory, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const counts = { completed: 0, pending: 0, analyzing: 0, unknown: 0 };
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const status = await readJson(path.join(commitsDirectory, entry.name, 'status.json'), null);
      if (status?.state === 'completed') counts.completed += 1;
      else if (status?.state === 'pending') counts.pending += 1;
      else if (status?.state === 'analyzing') counts.analyzing += 1;
      else counts.unknown += 1;
    }));
    const downloaded = counts.completed + counts.pending + counts.analyzing + counts.unknown;
    const total = Math.max(downloaded, targetTotal || 0);
    return { total, downloaded, ...counts, percentage: total ? Math.round((counts.completed / total) * 100) : 0 };
  }
}
