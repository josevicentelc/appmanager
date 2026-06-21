import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openEngineeringMemoryDb, type EngineeringMemoryDb } from "../db/database.js";
import {
  buildHighLevelContext,
  buildInvestigationContext,
  retrieveCandidates
} from "./retrieval-service.js";

describe("commit author retrieval", () => {
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

  it("retrieves and exposes Git author and committer metadata", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "engineering-memory-retrieval-"));
    db = await openEngineeringMemoryDb(join(temporaryDirectory, "test.sqlite"));
    await db.run(
      "INSERT INTO repositories (key, display_name, local_path) VALUES (?, ?, ?)",
      "project",
      "Project",
      temporaryDirectory
    );
    await db.run(`
      INSERT INTO commits (
        repository_id, hash, author_name, author_email, authored_at,
        committer_name, committer_email, committed_at, subject, body, status, raw_metadata
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, '', 'indexed', '{}')
    `,
    "a".repeat(40),
    "Alice Developer",
    "alice@example.invalid",
    "2026-06-20T10:00:00Z",
    "Morgan Integrator",
    "morgan@example.invalid",
    "2026-06-20T11:00:00Z",
    "Implement task digest"
    );
    await db.run(`
      INSERT INTO commit_knowledge (
        commit_id, schema_version, prompt_version, model, summary, intent,
        confidence, analysis_status, raw_model_output
      ) VALUES (1, 'commit-analysis-v1', 'spike-v1', 'test-model', ?, ?, 1, 'validated', '{}')
    `, "Implementó la tarea digerida", "Procesar actividad de ingeniería");

    const candidates = await retrieveCandidates(db, "quien hizo la tarea digerida", { limit: 5 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.authorName).toBe("Alice Developer");
    expect(candidates[0]?.committerName).toBe("Morgan Integrator");
    expect(buildInvestigationContext("quien", candidates)).toContain("Git author: Alice Developer");
    expect(buildInvestigationContext("quien", candidates)).toContain("Git committer: Morgan Integrator");
    expect(buildHighLevelContext("quien", candidates)).toContain("Git author: Alice Developer");

    const candidatesByAuthor = await retrieveCandidates(db, "que hizo Alice Developer", { limit: 5 });
    expect(candidatesByAuthor[0]?.authorName).toBe("Alice Developer");
    expect(candidatesByAuthor[0]?.scoreBreakdown.authorMatches).toBeGreaterThan(0);
  });
});
