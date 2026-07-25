export class SyncService {
  constructor({ environment, store, github, lmStudio, getConfig }) {
    this.environment = environment; this.store = store; this.github = github; this.lmStudio = lmStudio; this.getConfig = getConfig;
    this.running = false; this.current = null; this.lastRun = null;
  }
  status() { return { running: this.running, current: this.current, lastRun: this.lastRun }; }
  async run() {
    if (this.running) return { started: false, reason: 'Ya hay una sincronización en curso.' };
    this.running = true; const startedAt = new Date().toISOString(); const summary = { started: true, startedAt, completedAt: null, repositories: [], errors: [] };
    try {
      const repositories = this.getConfig().repositories;
      for (const repository of repositories) {
        this.current = { repository, stage: 'checking_repository', sha: null, position: 0, total: 0 };
        const state = await this.store.getState(repository);
        const config = this.getConfig();
        // Changing the configured historical limit deliberately triggers a full re-scan.
        // This allows expanding the range and recovering commits whose local digestion was removed.
        const historicalRescan = state.importSince !== config.importSince;
        const since = historicalRescan ? config.importSince : (state.lastCheckedAt ? state.lastCheckedAt.slice(0, 10) : config.importSince);
        try {
          const remote = await this.github.getRepository(repository);
          this.current = { repository, stage: 'listing_commits', sha: null, position: 0, total: 0, since };
          const commits = await this.github.listCommits(repository, since);
          this.current = { repository, stage: 'listing_tags', sha: null, position: 0, total: commits.length };
          const repositoryTags = await this.github.listTags(repository);
          const tagMap = new Map();
          for (const tag of repositoryTags) tagMap.set(tag.sha, [...(tagMap.get(tag.sha) ?? []), tag.name]);
          await this.store.saveState(repository, { ...state, repository, defaultBranch: remote.default_branch, sync: { state: 'running', total: commits.length, startedAt: new Date().toISOString() }, lastError: null });
          let processed = 0; let failed = 0; let skipped = 0;
          const orderedCommits = [...commits].reverse();
          for (const [index, item] of orderedCommits.entries()) {
            const existing = await this.store.getCommitStatus(repository, item.sha);
            const commitMessage = item.commit?.message?.split('\n')[0] ?? '';
            if (existing?.state === 'completed') {
              this.current = { repository, stage: 'skipping_existing', sha: item.sha, message: commitMessage, position: index + 1, total: orderedCommits.length };
              skipped += 1; continue;
            }
            try {
              this.current = { repository, stage: 'downloading_commit', sha: item.sha, message: commitMessage, position: index + 1, total: orderedCommits.length };
              const [raw, diff] = await Promise.all([this.github.getCommit(repository, item.sha), this.github.getCommitDiff(repository, item.sha)]);
              await this.store.saveCommit(repository, item.sha, raw, diff, null, { state: 'analyzing', attempts: (existing?.attempts ?? 0) + 1, startedAt: new Date().toISOString(), error: null });
              const gitTags = tagMap.get(item.sha) ?? [];
              const releaseVersions = gitTags.flatMap((tag) => { const match = /^v[\s-]?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/i.exec(tag.trim()); return match ? [match[1]] : []; });
              this.current = { repository, stage: 'digesting_commit', sha: item.sha, message: commitMessage, position: index + 1, total: orderedCommits.length, gitTags };
              const analysis = await this.lmStudio.analyze({ model: config.model, language: config.language, repository, commit: raw, diff, gitTags, releaseVersions });
              this.current = { repository, stage: 'saving_analysis', sha: item.sha, message: commitMessage, position: index + 1, total: orderedCommits.length, gitTags };
              analysis.schemaVersion = 1; analysis.repository = repository; analysis.sha = item.sha;
              analysis.gitTags = gitTags; analysis.releaseVersions = releaseVersions;
              await this.store.saveCommit(repository, item.sha, raw, diff, analysis, { state: 'completed', attempts: (existing?.attempts ?? 0) + 1, processedAt: new Date().toISOString(), error: null });
              processed += 1;
            } catch (error) {
              failed += 1;
              await this.store.saveCommitStatus(repository, item.sha, { state: 'pending', attempts: (existing?.attempts ?? 0) + 1, lastAttemptAt: new Date().toISOString(), error: error.message });
            }
          }
          await this.store.saveState(repository, { ...state, repository, defaultBranch: remote.default_branch, importSince: config.importSince, lastCheckedAt: new Date().toISOString(), processedCommits: state.processedCommits + processed, failedCommits: state.failedCommits + failed, sync: { state: failed ? 'completed_with_pending' : 'completed', total: commits.length, completedAt: new Date().toISOString() }, lastError: failed ? `${failed} commit(s) pendientes de análisis.` : null });
          summary.repositories.push({ repository, found: commits.length, processed, skipped, failed });
        } catch (error) {
          await this.store.saveState(repository, { ...state, repository, sync: { state: 'error', total: state.sync?.total ?? 0, failedAt: new Date().toISOString() }, lastError: error.message });
          summary.errors.push({ repository, error: error.message });
        }
      }
    } finally {
      summary.completedAt = new Date().toISOString(); this.lastRun = summary; this.current = null; this.running = false;
    }
    return summary;
  }
}
