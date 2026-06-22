import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openEngineeringMemoryDb, type EngineeringMemoryDb } from "../db/database.js";
import { retrieveRangeCandidates } from "./version-range-retrieval.js";

let directory: string | null = null;
let db: EngineeringMemoryDb | null = null;

afterEach(async () => {
  await db?.close();
  db = null;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = null;
});

describe("recent version retrieval", () => {
  it("uses real consecutive tags to retrieve the latest version intervals", async () => {
    directory = await mkdtemp(join(tmpdir(), "recent-versions-"));
    db = await openEngineeringMemoryDb(join(directory, "memory.sqlite"));
    await db.run("INSERT INTO repositories (key, display_name, local_path) VALUES ('memory-only', 'Memory', '')");
    for (let version = 1; version <= 4; version += 1) {
      const result = await db.run(`INSERT INTO commits (repository_id, hash, author_name, author_email, authored_at, committer_name, committer_email, committed_at, subject, body, status, raw_metadata)
        VALUES (1, ?, 'Author', '', ?, 'Author', '', ?, ?, '', 'indexed', '{}')`,
        String(version).repeat(40), `2026-01-0${version}T00:00:00Z`, `2026-01-0${version}T00:00:00Z`, `Version ${version}`);
      await db.run("INSERT INTO commit_versions (commit_id, tag) VALUES (?, ?)", result.lastID, `app#1.0.${version}`);
      await db.run(`INSERT INTO commit_knowledge (commit_id, schema_version, prompt_version, model, summary, confidence, analysis_status, raw_model_output)
        VALUES (?, 'v1', 'p1', 'model', ?, 1, 'validated', '{}')`, result.lastID, `Summary ${version}`);
    }

    const result = await retrieveRangeCandidates(db, {
      kind: "recent_versions", count: 3, rawText: "últimas 3 versiones"
    }, { repositoryKey: "memory-only", pageSize: 5, maxCandidates: 20 });

    expect(result.coverage.includedVersions).toEqual(["app#1.0.4", "app#1.0.3", "app#1.0.2"]);
    expect(result.candidates.map((candidate) => candidate.subject)).toEqual(["Version 2", "Version 3", "Version 4"]);
    expect(result.coverage).toMatchObject({ commitsInRange: 3, analyzedCommitsInRange: 3, truncated: false });
  });
});
