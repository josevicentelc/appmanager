import type { AuthorSearchPlan } from "../application/query-planner.js";
import type { EngineeringMemoryDb } from "../db/database.js";
import type { RetrievalCoverage, RetrievedCandidate } from "./retrieval-service.js";

export interface AuthorSearchCoverage extends RetrievalCoverage {
  mode: "author_search";
  requestedAuthor: string;
  matchedAuthors: string[];
  totalCommits: number;
  analyzedCommits: number;
  missingKnowledgeCommits: number;
}

export interface AuthorSearchResult {
  candidates: RetrievedCandidate[];
  coverage: AuthorSearchCoverage;
}

export interface CommitSearchFilters {
  author?: string;
  committer?: string;
  contentTerms?: string[];
  fromDate?: string;
  toDate?: string;
  versions?: string[];
  hashes?: string[];
  filePaths?: string[];
  factTypes?: string[];
  statuses?: string[];
  match?: "all" | "any";
  sort?: "newest" | "oldest";
}

export interface CommitSearchCoverage extends RetrievalCoverage {
  mode: "structured_search";
  filters: CommitSearchFilters;
  totalCommits: number;
  analyzedCommits: number;
  missingKnowledgeCommits: number;
}

export const commitSearchToolDefinition = {
  name: "search_commits",
  description: "Search Git commits using combinable metadata and indexed-knowledge filters.",
  supportedFilters: ["repository", "author", "committer", "content", "date", "version", "hash", "file", "factType", "status"]
} as const;

interface AuthorCommitRow {
  repository_key: string;
  commit_hash: string;
  subject: string;
  committed_at: string;
  author_name: string;
  committer_name: string;
  summary: string | null;
  intent: string | null;
  model: string | null;
  version_tags: string | null;
  file_paths: string | null;
  fact_blob: string | null;
  fact_types: string | null;
  status: string;
}

export async function searchCommits(
  db: EngineeringMemoryDb,
  filters: CommitSearchFilters,
  options: { repositoryKey?: string | null; pageSize: number; maxCandidates: number }
): Promise<{ candidates: RetrievedCandidate[]; coverage: CommitSearchCoverage }> {
  const rows = await loadCommitRows(db, options.repositoryKey ?? null);
  const predicates = buildPredicates(filters);
  const match = filters.match ?? "all";
  const filtered = rows.filter((row) => predicates.length === 0
    || (match === "all" ? predicates.every((predicate) => predicate(row)) : predicates.some((predicate) => predicate(row))));
  filtered.sort((left, right) => filters.sort === "oldest"
    ? left.committed_at.localeCompare(right.committed_at)
    : right.committed_at.localeCompare(left.committed_at));
  const pageSize = Math.max(1, options.pageSize);
  const maxCandidates = Math.max(1, options.maxCandidates);
  const selected = filtered.slice(0, maxCandidates);
  const analyzedCommits = filtered.filter((row) => row.summary !== null).length;
  return {
    candidates: selected.map((row, index) => candidateFromRow(row, filtered.length - index)),
    coverage: {
      mode: "structured_search",
      filters,
      totalCommits: filtered.length,
      analyzedCommits,
      missingKnowledgeCommits: filtered.length - analyzedCommits,
      totalCandidates: filtered.length,
      returnedCandidates: selected.length,
      pageSize,
      pagesRead: Math.ceil(selected.length / pageSize),
      truncated: filtered.length > selected.length,
      requestedMaxCandidates: maxCandidates
    }
  };
}

export async function searchCommitsByAuthor(
  db: EngineeringMemoryDb,
  plan: AuthorSearchPlan,
  options: { repositoryKey?: string | null; pageSize: number; maxCandidates: number }
): Promise<AuthorSearchResult> {
  const result = await searchCommits(db, { author: plan.authorQuery }, options);
  const effectiveRows = result.candidates;
  const matchedAuthors = [...new Set(effectiveRows.map((row) => row.authorName))].sort();
  return {
    candidates: effectiveRows,
    coverage: {
      ...result.coverage,
      mode: "author_search",
      requestedAuthor: plan.authorQuery,
      matchedAuthors
    }
  };
}

async function loadCommitRows(db: EngineeringMemoryDb, repositoryKey: string | null): Promise<AuthorCommitRow[]> {
  return db.all<AuthorCommitRow[]>(`
    SELECT r.key AS repository_key, c.hash AS commit_hash, c.subject, c.committed_at,
      c.author_name, c.committer_name, c.status, ck.summary, ck.intent, ck.model,
      (SELECT GROUP_CONCAT(cv.tag, char(10)) FROM commit_versions cv WHERE cv.commit_id = c.id) AS version_tags,
      (SELECT GROUP_CONCAT(cf.path, char(10)) FROM commit_files cf WHERE cf.commit_id = c.id) AS file_paths,
      (SELECT GROUP_CONCAT(kf.fact_type || ' ' || kf.title || ' ' || kf.content, char(10)) FROM knowledge_facts kf WHERE kf.commit_knowledge_id = ck.id) AS fact_blob,
      (SELECT GROUP_CONCAT(DISTINCT kf.fact_type) FROM knowledge_facts kf WHERE kf.commit_knowledge_id = ck.id) AS fact_types
    FROM commits c
    JOIN repositories r ON r.id = c.repository_id
    LEFT JOIN commit_knowledge ck ON ck.id = (
      SELECT inner_ck.id FROM commit_knowledge inner_ck
      WHERE inner_ck.commit_id = c.id
      ORDER BY inner_ck.created_at DESC, inner_ck.id DESC LIMIT 1
    )
    WHERE (? IS NULL OR r.key = ?)
    ORDER BY c.committed_at DESC
  `, repositoryKey, repositoryKey);
}

function candidateFromRow(row: AuthorCommitRow, score: number): RetrievedCandidate {
  return {
      repositoryKey: row.repository_key,
      commitHash: row.commit_hash,
      shortHash: row.commit_hash.slice(0, 8),
      subject: row.subject,
      committedAt: row.committed_at,
      authorName: row.author_name,
      committerName: row.committer_name,
      summary: row.summary ?? "No hay conocimiento analizado para este commit.",
      intent: row.intent,
      model: row.model ?? "not-analyzed",
      versionTags: row.version_tags?.split("\n").filter(Boolean) ?? [],
      score,
      scoreBreakdown: { matchedTerms: [], factMatches: 0, summaryMatches: 0, subjectMatches: 0, authorMatches: 0 },
      facts: []
  };
}

function buildPredicates(filters: CommitSearchFilters): Array<(row: AuthorCommitRow) => boolean> {
  const predicates: Array<(row: AuthorCommitRow) => boolean> = [];
  if (filters.author) predicates.push((row) => normalizeName(row.author_name).includes(normalizeName(filters.author ?? "")));
  if (filters.committer) predicates.push((row) => normalizeName(row.committer_name).includes(normalizeName(filters.committer ?? "")));
  if (filters.fromDate) predicates.push((row) => row.committed_at >= `${filters.fromDate}T00:00:00`);
  if (filters.toDate) predicates.push((row) => row.committed_at < nextDay(filters.toDate ?? ""));
  addListPredicate(predicates, filters.hashes, (row) => row.commit_hash);
  addListPredicate(predicates, filters.versions, (row) => row.version_tags ?? "");
  addListPredicate(predicates, filters.filePaths, (row) => row.file_paths ?? "");
  addListPredicate(predicates, filters.factTypes, (row) => row.fact_types ?? "");
  addListPredicate(predicates, filters.statuses, (row) => row.status);
  if (filters.contentTerms?.length) {
    predicates.push((row) => {
      const content = normalizeName([row.subject, row.summary, row.intent, row.fact_blob, row.file_paths].filter(Boolean).join(" "));
      return filters.contentTerms?.every((term) => content.includes(normalizeName(term))) ?? true;
    });
  }
  return predicates;
}

function addListPredicate(
  predicates: Array<(row: AuthorCommitRow) => boolean>,
  values: string[] | undefined,
  readValue: (row: AuthorCommitRow) => string
): void {
  if (!values?.length) return;
  predicates.push((row) => values.some((value) => normalizeName(readValue(row)).includes(normalizeName(value))));
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString();
}

function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}
