import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './config.js';
import { FileStore } from './storage.js';
import { GitHubClient } from './github.js';
import { releaseVersions, tagsByCommit } from './tags.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = process.argv[2];
if (!repository) throw new Error('Uso: node src/backfill-git-tags.js propietario/repositorio');
const environment = await loadEnvironment(root);
const store = new FileStore(environment.dataDirectory);
const github = new GitHubClient(environment.githubToken, environment.githubCaCertFile);
const suppliedTags = process.env.GIT_TAGS_JSON ? JSON.parse(process.env.GIT_TAGS_JSON) : null;
const map = tagsByCommit(suppliedTags ?? await github.listTags(repository));
let updated = 0;
const storedShas = await store.listCommitShas(repository);
for (const sha of storedShas) {
  const analysis = await store.getAnalysis(repository, sha);
  if (!analysis) continue;
  const gitTags = map.get(sha) ?? [];
  await store.saveAnalysis(repository, sha, { ...analysis, gitTags, releaseVersions: releaseVersions(gitTags) });
  updated += 1;
}
console.log(JSON.stringify({ repository, updatedAnalyses: updated, taggedCommits: [...map].filter(([sha]) => storedShas.includes(sha)).length }));
