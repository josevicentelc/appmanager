import fs from 'node:fs/promises';
import path from 'node:path';

const safeName = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, '_');
async function writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); await fs.rename(temporary, file); }
async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }

export class PullRequestStore {
  constructor(dataDirectory) { this.root = path.join(dataDirectory, 'pr'); }
  pullRequestFile(repository, number) { return path.join(this.root, safeName(repository), `${safeName(number)}.json`); }
  async get(repository, number) { return readJson(this.pullRequestFile(repository, number), null); }
  async save(record) { await writeJson(this.pullRequestFile(record.repository, record.number), record); return record; }
  async list() {
    const records = [];
    let repositories;
    try { repositories = await fs.readdir(this.root, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    for (const repository of repositories.filter((entry) => entry.isDirectory())) {
      const directory = path.join(this.root, repository.name);
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const record = await readJson(path.join(directory, entry.name), null);
        if (record) records.push(record);
      }
    }
    return records;
  }
  async findByCommit(repository, sha) {
    return (await this.list()).filter((record) => record.repository === repository && record.commits?.some((commit) => commit.sha === sha));
  }
}

