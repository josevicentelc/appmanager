import type { CommitRangePlan, DateRangePlan, VersionRangePlan } from "../application/query-planner.js";
import type { EngineeringMemoryDb } from "../db/database.js";
import { listCommitsBetween, resolveCommit } from "../git/git-client.js";
import { loadRepositoryConfigs, type RepositoryConfig } from "../repositories/repository-config.js";
import type { RetrievalCoverage, RetrievedCandidate, RetrievedFact } from "./retrieval-service.js";

export type RangePlan = VersionRangePlan | DateRangePlan | CommitRangePlan;

export interface RangeCoverage extends RetrievalCoverage {
  mode: RangePlan["kind"];
  fromLabel: string;
  toLabel: string;
  fromCommit: string | null;
  toCommit: string | null;
  commitsInRange: number;
  analyzedCommitsInRange: number;
  missingKnowledgeCommits: number;
}

export interface RangeRetrievalResult {
  candidates: RetrievedCandidate[];
  coverage: RangeCoverage;
}

interface CommitKnowledgeRow {
  knowledge_id: number;
  repository_key: string;
  commit_hash: string;
  subject: string;
  committed_at: string;
  author_name: string;
  committer_name: string;
  summary: string;
  intent: string | null;
  model: string;
  version_tags: string | null;
}

interface VersionEndpoint {
  repositoryKey: string;
  commitHash: string;
  tag: string;
}

export async function retrieveRangeCandidates(
  db: EngineeringMemoryDb,
  plan: RangePlan,
  options: { repositoryKey?: string | null; pageSize: number; maxCandidates: number }
): Promise<RangeRetrievalResult> {
  const pageSize = Math.max(1, options.pageSize);
  const maxCandidates = Math.max(1, options.maxCandidates);
  const scope = options.repositoryKey ?? null;
  const repositories = await loadRepositoryConfigs().catch(() => []);

  if (plan.kind === "date_range") {
    return retrieveDateRange(db, plan, { repositoryKey: scope, pageSize, maxCandidates });
  }

  const endpoints = plan.kind === "version_range"
    ? await resolveVersionRangeEndpoints(db, plan, scope, repositories)
    : await resolveCommitRangeEndpoints(db, plan, scope, repositories);
  if (endpoints === null) {
    return emptyRangeResult(plan, pageSize, maxCandidates, planFromLabel(plan), planToLabel(plan));
  }

  const repository = repositories.find((candidate) => candidate.id === endpoints.from.repositoryKey);
  const hashRange = repository === undefined
    ? await listStoredHashesBetweenDates(db, endpoints.from.repositoryKey, endpoints.from.commitHash, endpoints.to.commitHash)
    : await listCommitsBetween(
      repository.checkout.localPath,
      endpoints.from.commitHash,
      endpoints.to.commitHash,
      repository.checkout.branch,
      repository.projectRoot === null ? [] : [repository.projectRoot]
    );

  const rows = await loadKnowledgeRowsForHashes(db, endpoints.from.repositoryKey, hashRange);
  const candidates = rows.map((row, index) => candidateFromRow(row, hashRange.length - index));
  for (const candidate of candidates) {
    candidate.facts = await loadFacts(db, candidate.commitHash, candidate.repositoryKey, 8);
  }
  const selected = candidates.slice(0, maxCandidates);

  return {
    candidates: selected,
    coverage: {
      mode: plan.kind,
      fromLabel: endpoints.from.tag,
      toLabel: endpoints.to.tag,
      fromCommit: endpoints.from.commitHash,
      toCommit: endpoints.to.commitHash,
      commitsInRange: hashRange.length,
      analyzedCommitsInRange: candidates.length,
      missingKnowledgeCommits: Math.max(0, hashRange.length - candidates.length),
      totalCandidates: candidates.length,
      returnedCandidates: selected.length,
      pageSize,
      pagesRead: Math.ceil(selected.length / pageSize),
      truncated: candidates.length > selected.length,
      requestedMaxCandidates: maxCandidates
    }
  };
}

async function retrieveDateRange(
  db: EngineeringMemoryDb,
  plan: DateRangePlan,
  options: { repositoryKey: string | null; pageSize: number; maxCandidates: number }
): Promise<RangeRetrievalResult> {
  const rows = await db.all<CommitKnowledgeRow[]>(`
    SELECT ck.id AS knowledge_id, r.key AS repository_key, c.hash AS commit_hash,
      c.subject, c.committed_at, c.author_name, c.committer_name, ck.summary,
      ck.intent, ck.model,
      (SELECT GROUP_CONCAT(cv.tag, char(10)) FROM commit_versions cv WHERE cv.commit_id = c.id) AS version_tags
    FROM commit_knowledge ck
    JOIN commits c ON c.id = ck.commit_id
    JOIN repositories r ON r.id = c.repository_id
    WHERE datetime(c.committed_at) >= datetime(?)
      AND datetime(c.committed_at) < datetime(?)
      AND (? IS NULL OR r.key = ?)
    GROUP BY ck.id
    ORDER BY c.committed_at ASC
  `, `${plan.fromDate}T00:00:00.000Z`, nextDayIso(plan.toDate), options.repositoryKey, options.repositoryKey);
  const candidates = rows.map((row, index) => candidateFromRow(row, rows.length - index));
  for (const candidate of candidates) {
    candidate.facts = await loadFacts(db, candidate.commitHash, candidate.repositoryKey, 8);
  }
  const selected = candidates.slice(0, options.maxCandidates);
  return {
    candidates: selected,
    coverage: {
      mode: plan.kind,
      fromLabel: plan.fromDate,
      toLabel: plan.toDate,
      fromCommit: null,
      toCommit: null,
      commitsInRange: candidates.length,
      analyzedCommitsInRange: candidates.length,
      missingKnowledgeCommits: 0,
      totalCandidates: candidates.length,
      returnedCandidates: selected.length,
      pageSize: options.pageSize,
      pagesRead: Math.ceil(selected.length / options.pageSize),
      truncated: candidates.length > selected.length,
      requestedMaxCandidates: options.maxCandidates
    }
  };
}

async function resolveVersionRangeEndpoints(
  db: EngineeringMemoryDb,
  plan: VersionRangePlan,
  repositoryKey: string | null,
  repositories: RepositoryConfig[]
): Promise<{ from: VersionEndpoint; to: VersionEndpoint } | null> {
  const from = await resolveVersionEndpoint(db, plan.fromVersion, repositoryKey, repositories);
  const to = await resolveVersionEndpoint(db, plan.toVersion, from?.repositoryKey ?? repositoryKey, repositories);
  if (from === null || to === null || from.repositoryKey !== to.repositoryKey) {
    return null;
  }
  return { from, to };
}

async function resolveCommitRangeEndpoints(
  db: EngineeringMemoryDb,
  plan: CommitRangePlan,
  repositoryKey: string | null,
  repositories: RepositoryConfig[]
): Promise<{ from: VersionEndpoint; to: VersionEndpoint } | null> {
  const repository = repositoryKey === null ? null : repositories.find((candidate) => candidate.id === repositoryKey) ?? null;
  if (repository !== null) {
    return {
      from: {
        repositoryKey: repository.id,
        commitHash: await resolveCommit(repository.checkout.localPath, plan.fromCommit),
        tag: plan.fromCommit
      },
      to: {
        repositoryKey: repository.id,
        commitHash: await resolveCommit(repository.checkout.localPath, plan.toCommit),
        tag: plan.toCommit
      }
    };
  }

  const from = await findStoredCommitEndpoint(db, plan.fromCommit, repositoryKey);
  const to = await findStoredCommitEndpoint(db, plan.toCommit, from?.repositoryKey ?? repositoryKey);
  if (from === null || to === null || from.repositoryKey !== to.repositoryKey) {
    return null;
  }
  return { from, to };
}

async function resolveVersionEndpoint(
  db: EngineeringMemoryDb,
  version: string,
  repositoryKey: string | null,
  repositories: RepositoryConfig[]
): Promise<VersionEndpoint | null> {
  const stored = await findStoredVersionEndpoint(db, version, repositoryKey);
  if (stored !== null) {
    return stored;
  }

  if (repositoryKey === null) {
    return null;
  }
  const repository = repositories.find((candidate) => candidate.id === repositoryKey);
  if (repository === undefined) {
    return null;
  }
  for (const tag of versionTagCandidates(version)) {
    try {
      return {
        repositoryKey,
        commitHash: await resolveCommit(repository.checkout.localPath, tag),
        tag
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function findStoredVersionEndpoint(
  db: EngineeringMemoryDb,
  version: string,
  repositoryKey: string | null
): Promise<VersionEndpoint | null> {
  const rows = await db.all<Array<VersionEndpoint & { committed_at: string }>>(`
    SELECT r.key AS repositoryKey, c.hash AS commitHash, cv.tag, c.committed_at
    FROM commit_versions cv
    JOIN commits c ON c.id = cv.commit_id
    JOIN repositories r ON r.id = c.repository_id
    WHERE (? IS NULL OR r.key = ?)
    ORDER BY c.committed_at DESC
  `, repositoryKey, repositoryKey);
  return rows
    .map((row) => ({ row, score: scoreTagMatch(version, row.tag) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.row.committed_at.localeCompare(a.row.committed_at))[0]?.row ?? null;
}

async function findStoredCommitEndpoint(
  db: EngineeringMemoryDb,
  commit: string,
  repositoryKey: string | null
): Promise<VersionEndpoint | null> {
  const row = await db.get<VersionEndpoint>(`
    SELECT r.key AS repositoryKey, c.hash AS commitHash, c.hash AS tag
    FROM commits c
    JOIN repositories r ON r.id = c.repository_id
    WHERE c.hash LIKE ?
      AND (? IS NULL OR r.key = ?)
    ORDER BY c.committed_at DESC
    LIMIT 1
  `, `${commit}%`, repositoryKey, repositoryKey);
  return row ?? null;
}

async function listStoredHashesBetweenDates(
  db: EngineeringMemoryDb,
  repositoryKey: string,
  fromCommit: string,
  toCommit: string
): Promise<string[]> {
  const endpoints = await db.all<Array<{ hash: string; committed_at: string }>>(`
    SELECT c.hash, c.committed_at
    FROM commits c
    JOIN repositories r ON r.id = c.repository_id
    WHERE r.key = ? AND c.hash IN (?, ?)
  `, repositoryKey, fromCommit, toCommit);
  const from = endpoints.find((row) => row.hash === fromCommit);
  const to = endpoints.find((row) => row.hash === toCommit);
  if (from === undefined || to === undefined) {
    return [];
  }
  const rows = await db.all<Array<{ hash: string }>>(`
    SELECT c.hash
    FROM commits c
    JOIN repositories r ON r.id = c.repository_id
    WHERE r.key = ?
      AND datetime(c.committed_at) > datetime(?)
      AND datetime(c.committed_at) <= datetime(?)
    ORDER BY c.committed_at ASC
  `, repositoryKey, from.committed_at, to.committed_at);
  return rows.map((row) => row.hash);
}

async function loadKnowledgeRowsForHashes(
  db: EngineeringMemoryDb,
  repositoryKey: string,
  hashes: string[]
): Promise<CommitKnowledgeRow[]> {
  if (hashes.length === 0) {
    return [];
  }
  const placeholders = hashes.map(() => "?").join(", ");
  return db.all<CommitKnowledgeRow[]>(`
    SELECT ck.id AS knowledge_id, r.key AS repository_key, c.hash AS commit_hash,
      c.subject, c.committed_at, c.author_name, c.committer_name, ck.summary,
      ck.intent, ck.model,
      (SELECT GROUP_CONCAT(cv.tag, char(10)) FROM commit_versions cv WHERE cv.commit_id = c.id) AS version_tags
    FROM commit_knowledge ck
    JOIN commits c ON c.id = ck.commit_id
    JOIN repositories r ON r.id = c.repository_id
    WHERE r.key = ?
      AND c.hash IN (${placeholders})
    GROUP BY ck.id
  `, repositoryKey, ...hashes).then((rows) => {
    const order = new Map(hashes.map((hash, index) => [hash, index]));
    return rows.sort((a, b) => (order.get(a.commit_hash) ?? 0) - (order.get(b.commit_hash) ?? 0));
  });
}

async function loadFacts(
  db: EngineeringMemoryDb,
  commitHash: string,
  repositoryKey: string,
  limit: number
): Promise<RetrievedFact[]> {
  const rows = await db.all<Array<{
    id: number;
    fact_type: string;
    title: string;
    content: string;
    confidence: number;
    is_inference: number;
  }>>(`
    SELECT kf.id, kf.fact_type, kf.title, kf.content, kf.confidence, kf.is_inference
    FROM knowledge_facts kf
    JOIN commit_knowledge ck ON ck.id = kf.commit_knowledge_id
    JOIN commits c ON c.id = ck.commit_id
    JOIN repositories r ON r.id = c.repository_id
    WHERE r.key = ? AND c.hash = ?
    ORDER BY
      CASE kf.fact_type
        WHEN 'behavior_change' THEN 0
        WHEN 'configuration_change' THEN 1
        WHEN 'risk' THEN 2
        ELSE 3
      END,
      kf.id
    LIMIT ?
  `, repositoryKey, commitHash, limit);

  const facts: RetrievedFact[] = [];
  for (const row of rows) {
    const references = await db.all<Array<{
      file_path: string;
      start_line: number | null;
      end_line: number | null;
      reference_type: string;
    }>>(`
      SELECT file_path, start_line, end_line, reference_type
      FROM source_references
      WHERE knowledge_fact_id = ?
      ORDER BY id
      LIMIT 3
    `, row.id);
    facts.push({
      factType: row.fact_type,
      title: row.title,
      content: row.content,
      confidence: row.confidence,
      isInference: row.is_inference === 1,
      references: references.map((reference) => ({
        filePath: reference.file_path,
        startLine: reference.start_line,
        endLine: reference.end_line,
        referenceType: reference.reference_type
      }))
    });
  }
  return facts;
}

function candidateFromRow(row: CommitKnowledgeRow, score: number): RetrievedCandidate {
  return {
    repositoryKey: row.repository_key,
    commitHash: row.commit_hash,
    shortHash: row.commit_hash.slice(0, 8),
    subject: row.subject,
    committedAt: row.committed_at,
    authorName: row.author_name,
    committerName: row.committer_name,
    summary: row.summary,
    intent: row.intent,
    model: row.model,
    versionTags: row.version_tags?.split("\n").filter(Boolean) ?? [],
    score,
    scoreBreakdown: {
      matchedTerms: [],
      factMatches: 0,
      summaryMatches: 0,
      subjectMatches: 0,
      authorMatches: 0
    },
    facts: []
  };
}

function emptyRangeResult(
  plan: RangePlan,
  pageSize: number,
  maxCandidates: number,
  fromLabel: string,
  toLabel: string
): RangeRetrievalResult {
  return {
    candidates: [],
    coverage: {
      mode: plan.kind,
      fromLabel,
      toLabel,
      fromCommit: null,
      toCommit: null,
      commitsInRange: 0,
      analyzedCommitsInRange: 0,
      missingKnowledgeCommits: 0,
      totalCandidates: 0,
      returnedCandidates: 0,
      pageSize,
      pagesRead: 0,
      truncated: false,
      requestedMaxCandidates: maxCandidates
    }
  };
}

function planFromLabel(plan: RangePlan): string {
  if (plan.kind === "version_range") return plan.fromVersion;
  if (plan.kind === "date_range") return plan.fromDate;
  return plan.fromCommit;
}

function planToLabel(plan: RangePlan): string {
  if (plan.kind === "version_range") return plan.toVersion;
  if (plan.kind === "date_range") return plan.toDate;
  return plan.toCommit;
}

function versionTagCandidates(version: string): string[] {
  const cleaned = version.trim();
  return [...new Set([
    cleaned,
    `v${cleaned}`,
    `version-${cleaned}`,
    `release-${cleaned}`
  ])];
}

function scoreTagMatch(version: string, tag: string): number {
  const normalizedVersion = normalizeVersion(version);
  const normalizedTag = normalizeVersion(tag);
  if (normalizedTag === normalizedVersion) return 100;
  if (normalizedTag.endsWith(`-${normalizedVersion}`)) return 80;
  if (normalizedTag.endsWith(`/${normalizedVersion}`)) return 80;
  if (normalizedTag.includes(normalizedVersion)) return 40;
  return 0;
}

function normalizeVersion(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^version[-_/]?/, "")
    .replace(/^release[-_/]?/, "")
    .replace(/^v(?=\d)/, "");
}

function nextDayIso(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString();
}
