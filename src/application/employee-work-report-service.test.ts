import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openEngineeringMemoryDb, type EngineeringMemoryDb } from "../db/database.js";
import {
  listEmployeeAuthors,
  loadEmployeeEvidence,
  parseReportPeriod
} from "./employee-work-report-service.js";

describe("employee work report evidence", () => {
  let db: EngineeringMemoryDb | null = null;
  let temporaryDirectory: string | null = null;

  afterEach(async () => {
    if (db !== null) {
      await db.close();
      db = null;
    }
    if (temporaryDirectory !== null) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  it("lists digested Git authors and filters their evidence by inclusive dates", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "engineering-memory-employees-"));
    db = await openEngineeringMemoryDb(join(temporaryDirectory, "test.sqlite"));
    await db.run("INSERT INTO repositories (key, display_name, local_path) VALUES ('project', 'Project', ?)", temporaryDirectory);
    await insertCommit(db, 1, "a".repeat(40), "Jose Vicente", "Roberta QA", "2026-06-19T10:00:00.000Z");
    await insertCommit(db, 2, "b".repeat(40), "Other Author", "Other Author", "2026-06-20T10:00:00.000Z");
    await insertCommit(db, 3, "c".repeat(40), "Undigested Author", "Undigested Author", "2026-06-19T12:00:00.000Z", false);
    await db.run("INSERT INTO repositories (id, key, display_name, local_path) VALUES (2, 'stale-fixture', 'Stale Fixture', ?)", temporaryDirectory);
    await insertCommit(db, 4, "d".repeat(40), "Engineering Memory", "Engineering Memory", "2026-06-19T12:00:00.000Z", true, 2);

    const authors = await listEmployeeAuthors(db, ["project"]);
    expect(authors.map((author) => author.authorName)).toEqual(["Jose Vicente", "Other Author"]);

    const evidence = await loadEmployeeEvidence(db, "2026-06-19", "2026-06-19", ["Jose Vicente"], "test-model", ["project"]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.authorName).toBe("Jose Vicente");
    expect(evidence[0]?.commitHash).toBe("a".repeat(40));
  });

  it("validates and converts an inclusive report period", () => {
    expect(parseReportPeriod("2026-06-01", "2026-06-30")).toMatchObject({
      fromInstant: "2026-06-01T00:00:00.000Z",
      toExclusive: "2026-07-01T00:00:00.000Z"
    });
    expect(() => parseReportPeriod("2026-06-31", "2026-07-01")).toThrow("YYYY-MM-DD");
    expect(() => parseReportPeriod("2026-07-01", "2026-06-01")).toThrow("posterior");
    expect(() => parseReportPeriod("2025-01-01", "2026-06-01")).toThrow("366 días");
  });
});

async function insertCommit(
  db: EngineeringMemoryDb,
  id: number,
  hash: string,
  authorName: string,
  committerName: string,
  committedAt: string,
  digested = true,
  repositoryId = 1
): Promise<void> {
  await db.run(`
    INSERT INTO commits (
      id, repository_id, hash, author_name, author_email, authored_at,
      committer_name, committer_email, committed_at, subject, body, status, raw_metadata
    ) VALUES (?, ?, ?, ?, 'author@example.invalid', ?, ?, 'committer@example.invalid', ?, 'Task', '', 'indexed', '{}')
  `, id, repositoryId, hash, authorName, committedAt, committerName, committedAt);
  if (digested) {
    await db.run(`
      INSERT INTO commit_knowledge (
        commit_id, schema_version, prompt_version, model, summary, intent,
        confidence, analysis_status, raw_model_output
      ) VALUES (?, 'commit-analysis-v1', 'spike-v1', 'test-model', 'Implemented task', 'Deliver change', 1, 'validated', '{}')
    `, id);
  }
}
