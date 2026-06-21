import type { EngineeringMemoryDb } from "./database.js";

export async function hasCommitKnowledge(
  db: EngineeringMemoryDb,
  repositoryKey: string,
  commitHash: string,
  model: string
): Promise<boolean> {
  const row = await db.get<{ id: number }>(
    `
    SELECT ck.id
    FROM commit_knowledge ck
    JOIN commits c ON c.id = ck.commit_id
    JOIN repositories r ON r.id = c.repository_id
    WHERE r.key = ?
      AND c.hash = ?
      AND ck.schema_version = ?
      AND ck.prompt_version = ?
      AND ck.model = ?
    LIMIT 1
    `,
    repositoryKey,
    commitHash,
    "commit-analysis-v1",
    "spike-v1",
    model
  );

  return row !== undefined;
}

export async function isCommitProcessed(
  db: EngineeringMemoryDb,
  repositoryKey: string,
  commitHash: string,
  model: string
): Promise<boolean> {
  const row = await db.get<{ id: number }>(
    `
    SELECT c.id
    FROM commits c
    JOIN repositories r ON r.id = c.repository_id
    LEFT JOIN commit_knowledge ck
      ON ck.commit_id = c.id
      AND ck.schema_version = ?
      AND ck.prompt_version = ?
      AND ck.model = ?
    WHERE r.key = ?
      AND c.hash = ?
      AND (c.status = 'ignored' OR ck.id IS NOT NULL)
    LIMIT 1
    `,
    "commit-analysis-v1",
    "spike-v1",
    model,
    repositoryKey,
    commitHash
  );

  return row !== undefined;
}
