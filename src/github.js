import fs from 'node:fs/promises';
import https from 'node:https';

export class GitHubClient {
  constructor(token, caCertFile = null) { this.token = token; this.caCertFile = caCertFile; this.ca = null; }
  async request(path, accept = 'application/vnd.github+json') {
    if (this.caCertFile && !this.ca) this.ca = await fs.readFile(this.caCertFile);
    const response = await new Promise((resolve, reject) => {
      const request = https.request({ hostname: 'api.github.com', path, method: 'GET', ca: this.ca ?? undefined, headers: { Accept: accept, Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'appmanager-local' } }, (incoming) => {
        let content = ''; incoming.setEncoding('utf8'); incoming.on('data', (chunk) => { content += chunk; });
        incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, content }));
      });
      request.on('error', reject); request.end();
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`GitHub ${response.status}: ${response.content}`);
    return { text: async () => response.content, json: async () => JSON.parse(response.content) };
  }
  async getRepository(repository) { return (await this.request(`/repos/${repository}`)).json(); }
  async listTags(repository) {
    const tags = [];
    for (let page = 1; page <= 20; page += 1) {
      const batch = await (await this.request(`/repos/${repository}/tags?per_page=100&page=${page}`)).json();
      tags.push(...batch.map((tag) => ({ name: tag.name, sha: tag.commit.sha })));
      if (batch.length < 100) break;
    }
    return tags;
  }
  async listRepositories() {
    const repositories = [];
    for (let page = 1; page <= 20; page += 1) {
      const batch = await (await this.request(`/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=full_name&page=${page}`)).json();
      repositories.push(...batch.map((repo) => ({ fullName: repo.full_name, private: repo.private, defaultBranch: repo.default_branch, updatedAt: repo.updated_at, description: repo.description })));
      if (batch.length < 100) break;
    }
    return repositories;
  }
  async listCommits(repository, since) {
    const commits = [];
    for (let page = 1; page <= 20; page += 1) {
      const params = new URLSearchParams({ per_page: '100', page: String(page) });
      if (since) params.set('since', new Date(`${since}T00:00:00Z`).toISOString());
      const batch = await (await this.request(`/repos/${repository}/commits?${params}`)).json();
      commits.push(...batch);
      if (batch.length < 100) break;
    }
    return commits;
  }
  async getCommit(repository, sha) { return (await this.request(`/repos/${repository}/commits/${sha}`)).json(); }
  async getCommitDiff(repository, sha) { return (await this.request(`/repos/${repository}/commits/${sha}`, 'application/vnd.github.diff')).text(); }
}
