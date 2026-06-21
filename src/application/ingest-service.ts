import { basename, resolve } from "node:path";
import type { AppConfig } from "../config.js";
import { OpenAiCompatibleProvider } from "../ai/openai-compatible-provider.js";
import type { RepositoryConfig } from "../repositories/repository-config.js";
import { readCommitSnapshot } from "../git/git-client.js";
import { filterCommitSnapshot } from "../analysis/filter-snapshot.js";
import { redactSecrets } from "../security/redact-secrets.js";
import {
  storeCommitAnalysis,
  storeIgnoredCommit,
  type StoredCommitAnalysis,
  type StoredIgnoredCommit
} from "../db/commit-store.js";
import type { EngineeringMemoryDb } from "../db/database.js";

export interface IngestCommitOptions {
  repositoryPath: string;
  commitish: string;
  repositoryKey?: string;
  repositoryDisplayName?: string;
  filter?: {
    include: string[];
    exclude: string[];
  };
}

export interface IndexedCommitResult {
  status: "indexed";
  commitHash: string;
  subject: string;
  summary: string;
  ignoredFiles: string[];
  stored: StoredCommitAnalysis;
}

export interface IgnoredCommitResult {
  status: "ignored";
  commitHash: string;
  subject: string;
  reason: string;
  ignoredFiles: string[];
  stored: StoredIgnoredCommit;
}

export type IngestCommitResult = IndexedCommitResult | IgnoredCommitResult;

export async function ingestCommit(
  db: EngineeringMemoryDb,
  config: AppConfig,
  options: IngestCommitOptions
): Promise<IngestCommitResult> {
  const snapshot = await readCommitSnapshot(options.repositoryPath, options.commitish, Number.MAX_SAFE_INTEGER);
  const filtered = filterCommitSnapshot(
    snapshot,
    options.filter ?? { include: ["**/*"], exclude: [] },
    config.analysis.maxDiffChars
  );
  const repositoryKey = options.repositoryKey ?? basename(resolve(options.repositoryPath));
  const repositoryDisplayName = options.repositoryDisplayName ?? repositoryKey;

  if (filtered.snapshot.files.length === 0 || filtered.snapshot.diff.trim() === "") {
    const reason = filtered.snapshot.files.length === 0
      ? "No changed files matched the repository analysis filters"
      : "Matched files did not contain an analyzable text diff";
    const stored = await storeIgnoredCommit(db, {
      repositoryKey,
      repositoryDisplayName,
      snapshot,
      reason
    });
    return {
      status: "ignored",
      commitHash: snapshot.metadata.hash,
      subject: snapshot.metadata.subject,
      reason,
      ignoredFiles: filtered.ignoredFiles.map((file) => file.path),
      stored
    };
  }

  const redacted = redactSecrets(filtered.snapshot.diff);
  const provider = new OpenAiCompatibleProvider(config.ai);
  const analysis = await provider.analyzeCommit({
    repositoryPath: filtered.snapshot.repositoryPath,
    commitHash: filtered.snapshot.metadata.hash,
    subject: filtered.snapshot.metadata.subject,
    body: filtered.snapshot.metadata.body,
    files: filtered.snapshot.files,
    diff: redacted.text,
    diffWasTruncated: filtered.snapshot.diffWasTruncated,
    redactions: redacted.redactions
  });

  const stored = await storeCommitAnalysis(db, {
    repositoryKey,
    repositoryDisplayName,
    snapshot: filtered.snapshot,
    analysis,
    model: config.ai.chatModel
  });

  return {
    status: "indexed",
    commitHash: filtered.snapshot.metadata.hash,
    subject: filtered.snapshot.metadata.subject,
    summary: analysis.summary,
    ignoredFiles: filtered.ignoredFiles.map((file) => file.path),
    stored
  };
}

export function ingestOptionsFromRepository(
  repository: RepositoryConfig,
  commitish: string
): IngestCommitOptions {
  return {
    repositoryPath: repository.checkout.localPath,
    commitish,
    repositoryKey: repository.id,
    repositoryDisplayName: repository.displayName,
    filter: repository.analysis
  };
}
