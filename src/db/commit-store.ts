import { createHash } from "node:crypto";
import type { CommitAnalysis } from "../ai/commit-analysis-schema.js";
import { makeSourceKey, type CommitSnapshot } from "../git/git-client.js";
import type { EngineeringMemoryDb } from "./database.js";

export interface StoreCommitAnalysisInput {
  repositoryKey: string;
  repositoryDisplayName: string;
  snapshot: CommitSnapshot;
  analysis: CommitAnalysis;
  model: string;
  versionTags: string[];
}

export interface StoredCommitAnalysis {
  repositoryId: number;
  commitId: number;
  knowledgeId: number;
  factCount: number;
  referenceCount: number;
}

export interface StoreIgnoredCommitInput {
  repositoryKey: string;
  repositoryDisplayName: string;
  snapshot: CommitSnapshot;
  reason: string;
  versionTags: string[];
}

export interface StoredIgnoredCommit {
  repositoryId: number;
  commitId: number;
}

export async function syncCommitVersionTags(
  db: EngineeringMemoryDb,
  repositoryKey: string,
  commitHash: string,
  versionTags: string[]
): Promise<void> {
  const row = await db.get<{ id: number }>(
    `SELECT c.id FROM commits c JOIN repositories r ON r.id = c.repository_id
     WHERE r.key = ? AND c.hash = ?`,
    repositoryKey,
    commitHash
  );
  if (row !== undefined) {
    await replaceCommitVersions(db, row.id, versionTags);
  }
}

export async function storeCommitAnalysis(
  db: EngineeringMemoryDb,
  input: StoreCommitAnalysisInput
): Promise<StoredCommitAnalysis> {
  await db.exec("BEGIN IMMEDIATE;");
  try {
    const repositoryId = await upsertRepository(
      db,
      input.repositoryKey,
      input.repositoryDisplayName,
      input.snapshot.repositoryPath
    );
    const commitId = await upsertCommit(db, repositoryId, input.snapshot, "indexed");
    await replaceCommitVersions(db, commitId, input.versionTags);
    const sourceKeyToChunkId = await replaceCommitFilesAndChunks(db, commitId, input.snapshot);
    const knowledgeId = await replaceCommitKnowledge(db, commitId, input);
    const factCount = await replaceKnowledgeFacts(db, knowledgeId, input.analysis, sourceKeyToChunkId);
    const referenceCount = await replaceTopLevelReferences(db, knowledgeId, input.analysis, sourceKeyToChunkId);
    await db.exec("COMMIT;");
    return { repositoryId, commitId, knowledgeId, factCount, referenceCount };
  } catch (error) {
    await db.exec("ROLLBACK;");
    throw error;
  }
}

export async function storeIgnoredCommit(
  db: EngineeringMemoryDb,
  input: StoreIgnoredCommitInput
): Promise<StoredIgnoredCommit> {
  await db.exec("BEGIN IMMEDIATE;");
  try {
    const repositoryId = await upsertRepository(
      db,
      input.repositoryKey,
      input.repositoryDisplayName,
      input.snapshot.repositoryPath
    );
    const commitId = await upsertCommit(db, repositoryId, input.snapshot, "ignored", input.reason);
    await replaceCommitVersions(db, commitId, input.versionTags);
    await db.exec("COMMIT;");
    return { repositoryId, commitId };
  } catch (error) {
    await db.exec("ROLLBACK;");
    throw error;
  }
}

async function replaceCommitVersions(
  db: EngineeringMemoryDb,
  commitId: number,
  versionTags: string[]
): Promise<void> {
  await db.run("DELETE FROM commit_versions WHERE commit_id = ?", commitId);
  for (const tag of [...new Set(versionTags)].sort()) {
    await db.run(
      "INSERT INTO commit_versions (commit_id, tag) VALUES (?, ?)",
      commitId,
      tag
    );
  }
}

async function upsertRepository(
  db: EngineeringMemoryDb,
  repositoryKey: string,
  repositoryDisplayName: string,
  repositoryPath: string
): Promise<number> {
  await db.run(
    `
    INSERT INTO repositories (key, display_name, local_path)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      display_name = excluded.display_name,
      local_path = excluded.local_path,
      updated_at = CURRENT_TIMESTAMP
    `,
    repositoryKey,
    repositoryDisplayName,
    repositoryPath
  );
  const row = await db.get<{ id: number }>("SELECT id FROM repositories WHERE key = ?", repositoryKey);
  if (!row) {
    throw new Error(`Repository was not stored: ${repositoryKey}`);
  }
  return row.id;
}

async function upsertCommit(
  db: EngineeringMemoryDb,
  repositoryId: number,
  snapshot: CommitSnapshot,
  status: "indexed" | "ignored",
  ignoredReason?: string
): Promise<number> {
  await db.run(
    `
    INSERT INTO commits (
      repository_id, hash, first_parent_hash, author_name, author_email, authored_at,
      committer_name, committer_email, committed_at, subject, body, status, raw_metadata
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repository_id, hash) DO UPDATE SET
      first_parent_hash = excluded.first_parent_hash,
      author_name = excluded.author_name,
      author_email = excluded.author_email,
      authored_at = excluded.authored_at,
      committer_name = excluded.committer_name,
      committer_email = excluded.committer_email,
      committed_at = excluded.committed_at,
      subject = excluded.subject,
      body = excluded.body,
      status = excluded.status,
      raw_metadata = excluded.raw_metadata,
      updated_at = CURRENT_TIMESTAMP
    `,
    repositoryId,
    snapshot.metadata.hash,
    snapshot.metadata.parents[0] ?? null,
    snapshot.metadata.authorName,
    snapshot.metadata.authorEmail,
    snapshot.metadata.authoredAt,
    snapshot.metadata.committerName,
    snapshot.metadata.committerEmail,
    snapshot.metadata.committedAt,
    snapshot.metadata.subject,
    snapshot.metadata.body,
    status,
    JSON.stringify({
      ...snapshot.metadata,
      ...(ignoredReason === undefined ? {} : { ignoredReason })
    })
  );
  const row = await db.get<{ id: number }>(
    "SELECT id FROM commits WHERE repository_id = ? AND hash = ?",
    repositoryId,
    snapshot.metadata.hash
  );
  if (!row) {
    throw new Error(`Commit was not stored: ${snapshot.metadata.hash}`);
  }
  return row.id;
}

async function replaceCommitFilesAndChunks(
  db: EngineeringMemoryDb,
  commitId: number,
  snapshot: CommitSnapshot
): Promise<Map<string, number>> {
  await db.run("DELETE FROM commit_files WHERE commit_id = ?", commitId);
  const sourceKeyToChunkId = new Map<string, number>();

  for (const file of snapshot.files) {
    const fileResult = await db.run(
      `
      INSERT INTO commit_files (commit_id, path, previous_path, change_type, additions, deletions, language)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      commitId,
      file.path,
      file.previousPath,
      file.changeType,
      file.additions,
      file.deletions,
      detectLanguage(file.path)
    );
    const commitFileId = fileResult.lastID;
    if (commitFileId === undefined) {
      throw new Error(`Could not store commit file ${file.path}`);
    }

    const sourceKey = makeSourceKey(snapshot.metadata.hash, file.path);
    const chunkContent = extractFileDiff(snapshot.diff, file.path);
    const chunkResult = await db.run(
      `
      INSERT INTO diff_chunks (commit_file_id, source_key, old_start, old_end, new_start, new_end, content, token_count, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      commitFileId,
      sourceKey,
      null,
      null,
      null,
      null,
      chunkContent,
      estimateTokens(chunkContent),
      sha256(chunkContent)
    );
    if (chunkResult.lastID === undefined) {
      throw new Error(`Could not store diff chunk ${sourceKey}`);
    }
    sourceKeyToChunkId.set(sourceKey, chunkResult.lastID);
  }

  return sourceKeyToChunkId;
}

async function replaceCommitKnowledge(
  db: EngineeringMemoryDb,
  commitId: number,
  input: StoreCommitAnalysisInput
): Promise<number> {
  await db.run(
    `
    INSERT INTO commit_knowledge (
      commit_id, schema_version, prompt_version, model, summary, intent, confidence,
      analysis_status, raw_model_output
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(commit_id, schema_version, prompt_version, model) DO UPDATE SET
      summary = excluded.summary,
      intent = excluded.intent,
      confidence = excluded.confidence,
      analysis_status = excluded.analysis_status,
      raw_model_output = excluded.raw_model_output,
      created_at = CURRENT_TIMESTAMP
    `,
    commitId,
    "commit-analysis-v1",
    "spike-v1",
    input.model,
    input.analysis.summary,
    input.analysis.intent,
    input.analysis.confidence,
    "validated",
    JSON.stringify(input.analysis)
  );
  const row = await db.get<{ id: number }>(
    `
    SELECT id FROM commit_knowledge
    WHERE commit_id = ? AND schema_version = ? AND prompt_version = ? AND model = ?
    `,
    commitId,
    "commit-analysis-v1",
    "spike-v1",
    input.model
  );
  if (!row) {
    throw new Error(`Knowledge was not stored for commit ${commitId}`);
  }
  await db.run("DELETE FROM knowledge_facts WHERE commit_knowledge_id = ?", row.id);
  await db.run("DELETE FROM source_references WHERE commit_knowledge_id = ?", row.id);
  return row.id;
}

async function replaceKnowledgeFacts(
  db: EngineeringMemoryDb,
  knowledgeId: number,
  analysis: CommitAnalysis,
  sourceKeyToChunkId: Map<string, number>
): Promise<number> {
  let count = 0;

  for (const value of analysis.domains) {
    await insertFact(db, knowledgeId, "domain", value, value, analysis.confidence, false, {}, [], sourceKeyToChunkId);
    count += 1;
  }
  for (const value of analysis.components) {
    await insertFact(db, knowledgeId, "component", value, value, analysis.confidence, false, {}, [], sourceKeyToChunkId);
    count += 1;
  }
  for (const value of analysis.symbols) {
    await insertFact(db, knowledgeId, "symbol", value, value, analysis.confidence, false, {}, [], sourceKeyToChunkId);
    count += 1;
  }
  for (const value of analysis.behaviorChanges) {
    await insertFact(
      db,
      knowledgeId,
      "behavior_change",
      value.after,
      JSON.stringify({ before: value.before, after: value.after }),
      analysis.confidence,
      false,
      {},
      value.evidence,
      sourceKeyToChunkId
    );
    count += 1;
  }
  for (const value of analysis.possibleSymptoms) {
    await insertFact(db, knowledgeId, "possible_symptom", value.symptom, value.symptom, analysis.confidence, true, {}, value.evidence, sourceKeyToChunkId);
    count += 1;
  }
  for (const value of analysis.riskAreas) {
    await insertFact(db, knowledgeId, "risk", value.risk, value.risk, analysis.confidence, true, {}, value.evidence, sourceKeyToChunkId);
    count += 1;
  }
  for (const value of analysis.tests) {
    await insertFact(db, knowledgeId, "test", value.description, value.description, analysis.confidence, true, {}, value.evidence, sourceKeyToChunkId);
    count += 1;
  }
  for (const value of analysis.configurationChanges) {
    await insertFact(
      db,
      knowledgeId,
      "configuration_change",
      value.description,
      value.description,
      analysis.confidence,
      false,
      {},
      value.evidence,
      sourceKeyToChunkId
    );
    count += 1;
  }
  for (const value of analysis.compatibilityNotes) {
    await insertFact(db, knowledgeId, "compatibility_note", value, value, analysis.confidence, true, {}, [], sourceKeyToChunkId);
    count += 1;
  }
  for (const value of analysis.investigationQuestions) {
    await insertFact(db, knowledgeId, "investigation_question", value, value, analysis.confidence, true, {}, [], sourceKeyToChunkId);
    count += 1;
  }

  return count;
}

async function insertFact(
  db: EngineeringMemoryDb,
  knowledgeId: number,
  factType: string,
  title: string,
  content: string,
  confidence: number,
  isInference: boolean,
  metadata: Record<string, unknown>,
  references: CommitAnalysis["sourceReferences"],
  sourceKeyToChunkId: Map<string, number>
): Promise<void> {
  const result = await db.run(
    `
    INSERT INTO knowledge_facts (commit_knowledge_id, fact_type, title, content, confidence, is_inference, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    knowledgeId,
    factType,
    title,
    content,
    confidence,
    isInference ? 1 : 0,
    JSON.stringify(metadata)
  );
  if (result.lastID === undefined) {
    throw new Error(`Could not store fact ${factType}:${title}`);
  }
  for (const reference of references) {
    await insertReference(db, {
      knowledgeFactId: result.lastID,
      knowledgeId: null,
      reference,
      sourceKeyToChunkId,
      referenceType: "fact_evidence"
    });
  }
}

async function replaceTopLevelReferences(
  db: EngineeringMemoryDb,
  knowledgeId: number,
  analysis: CommitAnalysis,
  sourceKeyToChunkId: Map<string, number>
): Promise<number> {
  let count = 0;
  for (const reference of analysis.sourceReferences) {
    await insertReference(db, {
      knowledgeFactId: null,
      knowledgeId,
      reference,
      sourceKeyToChunkId,
      referenceType: "analysis_source"
    });
    count += 1;
  }
  return count;
}

async function insertReference(
  db: EngineeringMemoryDb,
  input: {
    knowledgeFactId: number | null;
    knowledgeId: number | null;
    reference: CommitAnalysis["sourceReferences"][number];
    sourceKeyToChunkId: Map<string, number>;
    referenceType: string;
  }
): Promise<void> {
  await db.run(
    `
    INSERT INTO source_references (
      knowledge_fact_id, commit_knowledge_id, diff_chunk_id, file_path, start_line, end_line, reference_type
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    input.knowledgeFactId,
    input.knowledgeId,
    input.sourceKeyToChunkId.get(input.reference.sourceId) ?? null,
    filePathFromSourceId(input.reference.sourceId),
    input.reference.startLine,
    input.reference.endLine,
    input.referenceType
  );
}

function extractFileDiff(diff: string, path: string): string {
  const marker = `diff --git a/${path} b/${path}`;
  const start = diff.indexOf(marker);
  if (start === -1) {
    return diff;
  }
  const next = diff.indexOf("\ndiff --git ", start + marker.length);
  return next === -1 ? diff.slice(start) : diff.slice(start, next);
}

function filePathFromSourceId(sourceId: string): string {
  const marker = ":file:";
  const index = sourceId.indexOf(marker);
  return index === -1 ? sourceId : sourceId.slice(index + marker.length);
}

function detectLanguage(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx")) return "cpp";
  if (lower.endsWith(".h") || lower.endsWith(".hpp")) return "cpp";
  return null;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
