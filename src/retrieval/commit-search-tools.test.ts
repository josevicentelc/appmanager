import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openEngineeringMemoryDb, type EngineeringMemoryDb } from "../db/database.js";
import { searchCommits, searchCommitsByAuthor } from "./commit-search-tools.js";

let directory: string | null = null;
let db: EngineeringMemoryDb | null = null;

afterEach(async () => {
  await db?.close();
  db = null;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = null;
});

describe("searchCommitsByAuthor", () => {
  it("returns analyzed and non-analyzed commits and reports ambiguous partial names", async () => {
    directory = await mkdtemp(join(tmpdir(), "author-search-"));
    db = await openEngineeringMemoryDb(join(directory, "memory.sqlite"));
    await db.run("INSERT INTO repositories (key, display_name, local_path) VALUES ('repo', 'Repo', 'C:/repo')");
    await insertCommit(db, "a".repeat(40), "Juan Sevila", "First", "2026-01-01T00:00:00Z");
    await insertCommit(db, "b".repeat(40), "Juan Pascual", "Second", "2026-01-02T00:00:00Z");
    await insertCommit(db, "c".repeat(40), "Ana", "Other", "2026-01-03T00:00:00Z");
    await db.run(`INSERT INTO commit_knowledge (commit_id, schema_version, prompt_version, model, summary, confidence, analysis_status, raw_model_output)
      VALUES (1, 'v1', 'p1', 'model', 'Analyzed', 1, 'validated', '{}')`);

    const result = await searchCommitsByAuthor(db, {
      kind: "author_search", authorQuery: "Juan", rawText: "commits de Juan"
    }, { pageSize: 5, maxCandidates: 20 });

    expect(result.candidates.map((candidate) => candidate.authorName)).toEqual(["Juan Pascual", "Juan Sevila"]);
    expect(result.coverage).toMatchObject({
      totalCommits: 2,
      analyzedCommits: 1,
      missingKnowledgeCommits: 1,
      matchedAuthors: ["Juan Pascual", "Juan Sevila"],
      truncated: false
    });

    await db.run("INSERT INTO commit_files (commit_id, path, change_type) VALUES (1, 'src/audio/player.ts', 'modified')");
    const filtered = await searchCommits(db, {
      author: "Juan Sevila",
      fromDate: "2026-01-01",
      toDate: "2026-01-01",
      contentTerms: ["Analyzed"],
      filePaths: ["audio/player.ts"],
      match: "all"
    }, { pageSize: 10, maxCandidates: 20 });

    expect(filtered.candidates.map((candidate) => candidate.commitHash)).toEqual(["a".repeat(40)]);
    expect(filtered.coverage.filters).toMatchObject({ author: "Juan Sevila", filePaths: ["audio/player.ts"] });

    await db.run("INSERT INTO repositories (key, display_name, local_path) VALUES ('voxelcore/electronics', 'Electronics', '')");
    await insertCommit(db, "d".repeat(40), "josevicentevoxelcare", "Electronics work", "2026-01-04T00:00:00Z", 2);
    const multiDimension = await searchCommits(db, {
      repositoryKeys: ["electronics", "webapp"],
      author: "Jose Vicente",
      match: "all"
    }, { pageSize: 10, maxCandidates: 20 });
    expect(multiDimension.candidates.map((candidate) => candidate.subject)).toEqual(["Electronics work"]);
  });
});

async function insertCommit(database: EngineeringMemoryDb, hash: string, author: string, subject: string, date: string, repositoryId = 1): Promise<void> {
  await database.run(`INSERT INTO commits (repository_id, hash, author_name, author_email, authored_at, committer_name, committer_email, committed_at, subject, body, status, raw_metadata)
    VALUES (?, ?, ?, '', ?, ?, '', ?, ?, '', 'indexed', '{}')`, repositoryId, hash, author, date, author, date, subject);
}
