import fs from 'node:fs/promises';
import path from 'node:path';
import { buildDiffIndex, readIndexedHunk, searchIndexedDiff } from './diff.js';

const safeRepositoryName = (repository) => repository.replace('/', '__');
const words = (value) => String(value ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}_./-]{2,}/gu) ?? [];
const compactAnalysis = (analysis) => ({ source: `${analysis.repository}@${analysis.sha}`, repository: analysis.repository, sha: analysis.sha, commitDate: analysis.commitDate, originalMessage: analysis.originalMessage, tags: analysis.tags ?? [], gitTags: analysis.gitTags ?? [], briefDescription: analysis.briefDescription, changeSummary: analysis.changeSummary, filesChanged: analysis.technicalDetails?.filesChanged ?? [], risksOrFollowUps: analysis.technicalDetails?.risksOrFollowUps ?? [] });

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
  async getCommitRaw(repository, sha) { return readJson(path.join(this.commitDirectory(repository, sha), 'github-raw.json'), null); }
  async saveCommit(repository, sha, raw, diff, analysis, status) {
    const directory = this.commitDirectory(repository, sha);
    const diffText = diff || '';
    await fs.mkdir(directory, { recursive: true });
    await Promise.all([
      writeJson(path.join(directory, 'github-raw.json'), raw),
      fs.writeFile(path.join(directory, 'diff.patch'), diffText, 'utf8'),
      writeJson(path.join(directory, 'diff-index.json'), buildDiffIndex(diffText)),
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
  async getDiff(repository, sha) {
    try { return await fs.readFile(path.join(this.commitDirectory(repository, sha), 'diff.patch'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async getDiffIndex(repository, sha, knownDiff) {
    const file = path.join(this.commitDirectory(repository, sha), 'diff-index.json');
    const existing = await readJson(file, null);
    if (existing?.version === 2) return existing;
    const diff = knownDiff === undefined ? await this.getDiff(repository, sha) : knownDiff;
    if (diff === null) return null;
    const index = buildDiffIndex(diff);
    await writeJson(file, index);
    return index;
  }
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
  async searchAnalyses(repositories, { query = '', repository = '', tags = [], from = '', to = '', limit = 8 } = {}) {
    const requestedTags = new Set((Array.isArray(tags) ? tags : []).map((tag) => String(tag).toLocaleLowerCase()).filter(Boolean));
    const queryWords = [...new Set(words(query))];
    const candidates = await this.listAnalyses(repositories, Number.MAX_SAFE_INTEGER);
    return candidates.filter((analysis) => !repository || analysis.repository === repository)
      .filter((analysis) => !from || String(analysis.commitDate ?? '') >= from)
      .filter((analysis) => !to || String(analysis.commitDate ?? '') <= `${to}T23:59:59.999Z`)
      .filter((analysis) => !requestedTags.size || [...requestedTags].every((tag) => (analysis.tags ?? []).some((value) => String(value).toLocaleLowerCase() === tag)))
      .map((analysis) => {
        const searchable = [analysis.repository, analysis.originalMessage, analysis.briefDescription, analysis.changeSummary, ...(analysis.tags ?? []), ...(analysis.gitTags ?? []), ...(analysis.technicalDetails?.filesChanged ?? []), ...(analysis.technicalDetails?.keyChanges ?? []), ...(analysis.technicalDetails?.potentialImpact ?? []), ...(analysis.technicalDetails?.risksOrFollowUps ?? [])].join(' ').toLocaleLowerCase();
        const score = queryWords.reduce((total, word) => total + (searchable.includes(word) ? 1 : 0), 0) + (query && searchable.includes(String(query).toLocaleLowerCase()) ? 3 : 0);
        return { analysis, score };
      }).filter(({ score }) => !queryWords.length || score > 0)
      .sort((a, b) => b.score - a.score || String(b.analysis.commitDate ?? '').localeCompare(String(a.analysis.commitDate ?? '')))
      .slice(0, Math.max(1, Math.min(Number(limit) || 8, 12))).map(({ analysis }) => compactAnalysis(analysis));
  }
  async searchDiffHunks(repositories, { query, repository = '', sha = '', path: filePath = '', from = '', to = '', limit = 8, maxCommits = 500 } = {}) {
    let candidates;
    if (sha && repository) {
      candidates = [{ repository, sha, commitDate: (await this.getAnalysis(repository, sha))?.commitDate ?? '' }];
    } else {
      candidates = (await this.listAnalyses(repositories, Number.MAX_SAFE_INTEGER))
        .filter((analysis) => !repository || analysis.repository === repository)
        .filter((analysis) => !from || String(analysis.commitDate ?? '') >= from)
        .filter((analysis) => !to || String(analysis.commitDate ?? '') <= `${to}T23:59:59.999Z`)
        .map((analysis) => ({ repository: analysis.repository, sha: analysis.sha, commitDate: analysis.commitDate }));
    }
    const scopeTruncated = candidates.length > maxCommits;
    candidates = candidates.slice(0, maxCommits);
    const matches = [];
    for (const candidate of candidates) {
      const diff = await this.getDiff(candidate.repository, candidate.sha);
      if (diff === null) continue;
      const index = await this.getDiffIndex(candidate.repository, candidate.sha, diff);
      if (!index) continue;
      for (const match of searchIndexedDiff(diff, index, { query, path: filePath, limit })) {
        matches.push({
          source: `${candidate.repository}@${candidate.sha}:${match.filePath}:${match.hunk.id}`,
          repository: candidate.repository, sha: candidate.sha, commitDate: candidate.commitDate,
          filePath: match.filePath, hunkId: match.hunk.id, header: match.hunk.header,
          oldRange: match.hunk.oldRange, newRange: match.hunk.newRange, section: match.hunk.section,
          snippet: match.snippet, score: match.score
        });
      }
    }
    const ranked = matches.sort((a, b) => b.score - a.score || String(b.commitDate ?? '').localeCompare(String(a.commitDate ?? ''))).slice(0, limit);
    const top = ranked[0];
    const topHunk = top ? await this.readDiffHunk(top.repository, top.sha, top.filePath, top.hunkId, {
      startLine: 1, maxLines: 1_000, maxCharacters: 60_000
    }) : null;
    const results = ranked.map(({ snippet, ...match }) => match);
    return { results, topHunk, searchedCommits: candidates.length, scopeTruncated };
  }
  async readDiffHunk(repository, sha, filePath, hunkId, options = {}) {
    const diff = await this.getDiff(repository, sha);
    if (diff === null) return null;
    const index = await this.getDiffIndex(repository, sha, diff);
    if (!index) return null;
    const result = readIndexedHunk(diff, index, filePath, hunkId, options);
    if (!result) return null;
    return {
      source: `${repository}@${sha}:${filePath}:${hunkId}`,
      repository, sha, filePath, hunkId, header: result.hunk.header,
      oldRange: result.hunk.oldRange, newRange: result.hunk.newRange,
      content: result.content, startLine: result.startLine, endLine: result.endLine,
      totalLines: result.totalLines, truncated: result.truncated,
      nextStartLine: result.nextStartLine, lineTruncated: result.lineTruncated
    };
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
