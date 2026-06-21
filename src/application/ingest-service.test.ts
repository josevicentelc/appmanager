import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execa } from "execa";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { openEngineeringMemoryDb, type EngineeringMemoryDb } from "../db/database.js";
import { isCommitProcessed } from "../db/knowledge-queries.js";
import { ingestCommit } from "./ingest-service.js";

describe("ingestCommit", () => {
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

  it("stores commits with no matching files as ignored and processed", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "engineering-memory-"));
    db = await openEngineeringMemoryDb(join(temporaryDirectory, "test.sqlite"));
    const repositoryPath = join(temporaryDirectory, "repository");
    await execa("git", ["init", repositoryPath]);
    await execa("git", ["-C", repositoryPath, "config", "user.name", "Test Author"]);
    await execa("git", ["-C", repositoryPath, "config", "user.email", "test@example.invalid"]);
    await writeFile(join(repositoryPath, "fixture.txt"), "fixture\n", "utf8");
    await execa("git", ["-C", repositoryPath, "add", "fixture.txt"]);
    await execa("git", ["-C", repositoryPath, "commit", "-m", "Add fixture"]);
    await execa("git", ["-C", repositoryPath, "tag", "service-v1.0.0"]);
    await execa("git", ["-C", repositoryPath, "tag", "-a", "service/v1.0.0", "-m", "Release"]);
    const config: AppConfig = {
      ai: {
        baseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "test",
        chatModel: "test-model",
        timeoutMs: 1000,
        temperature: 0.1,
        maxOutputTokens: 1000
      },
      analysis: { maxDiffChars: 120_000 },
      database: { path: join(temporaryDirectory, "test.sqlite") },
      server: { host: "127.0.0.1", port: 8080 }
    };

    const result = await ingestCommit(db, config, {
      repositoryPath,
      commitish: "HEAD",
      repositoryKey: "ignored-fixture",
      repositoryDisplayName: "Ignored Fixture",
      filter: {
        include: ["**/*"],
        exclude: ["**/*"]
      },
      versionTags: { include: ["service**"], exclude: [] }
    });

    expect(result.status).toBe("ignored");
    expect(await isCommitProcessed(
      db,
      "ignored-fixture",
      result.commitHash,
      config.ai.chatModel
    )).toBe(true);

    const stored = await db.get<{ status: string }>(
      "SELECT status FROM commits WHERE hash = ?",
      result.commitHash
    );
    expect(stored?.status).toBe("ignored");
    expect(result.versionTags).toEqual(["service-v1.0.0", "service/v1.0.0"]);
    const versions = await db.all<Array<{ tag: string }>>(
      "SELECT tag FROM commit_versions WHERE commit_id = ?",
      result.stored.commitId
    );
    expect(versions.map((version) => version.tag)).toEqual(["service-v1.0.0", "service/v1.0.0"]);
  });
});
