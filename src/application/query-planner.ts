export type InvestigationPlan =
  | VersionRangePlan
  | DateRangePlan
  | CommitRangePlan
  | RecentVersionsPlan
  | AuthorRepositoriesPlan
  | RecentRepositoryChangesPlan
  | AuthorSearchPlan
  | CandidateSearchPlan;

export interface VersionRangePlan {
  kind: "version_range";
  fromVersion: string;
  toVersion: string;
  rawText: string;
}

export interface DateRangePlan {
  kind: "date_range";
  fromDate: string;
  toDate: string;
  rawText: string;
}

export interface CommitRangePlan {
  kind: "commit_range";
  fromCommit: string;
  toCommit: string;
  rawText: string;
}

export interface CandidateSearchPlan {
  kind: "candidate_search";
}

export interface AuthorSearchPlan {
  kind: "author_search";
  authorQuery: string;
  rawText: string;
}

export interface RecentVersionsPlan {
  kind: "recent_versions";
  count: number;
  rawText: string;
}

export interface AuthorRepositoriesPlan {
  kind: "author_repositories";
  authorQuery: string;
  repositoryQueries: string[];
  rawText: string;
}

export interface RecentRepositoryChangesPlan {
  kind: "recent_repository_changes";
  repositoryQueries: string[];
  count: number;
  rawText: string;
}

export function planInvestigationQuery(question: string): InvestigationPlan {
  const normalized = normalizeQuestion(question);
  const recentRepositoryChanges = detectRecentRepositoryChanges(normalized);
  if (recentRepositoryChanges !== null) {
    return { kind: "recent_repository_changes", ...recentRepositoryChanges };
  }
  const authorRepositories = detectAuthorRepositories(normalized);
  if (authorRepositories !== null) {
    return { kind: "author_repositories", ...authorRepositories };
  }
  const authorSearch = detectAuthorSearch(normalized);
  if (authorSearch !== null) {
    return { kind: "author_search", ...authorSearch };
  }
  const recentVersions = detectRecentVersions(normalized);
  if (recentVersions !== null) {
    return { kind: "recent_versions", ...recentVersions };
  }
  const versionRange = detectVersionRange(normalized);
  if (versionRange !== null) {
    return { kind: "version_range", ...versionRange };
  }

  const dateRange = detectDateRange(normalized);
  if (dateRange !== null) {
    return { kind: "date_range", ...dateRange };
  }

  const commitRange = detectCommitRange(normalized);
  if (commitRange !== null) {
    return { kind: "commit_range", ...commitRange };
  }

  return { kind: "candidate_search" };
}

function detectRecentRepositoryChanges(question: string): Omit<RecentRepositoryChangesPlan, "kind"> | null {
  const pattern = /\b(?:listame|muestrame|dame|resume)?\s*(?:los\s+)?ultim\w*\s*(\d{1,2})?\s*(?:cambios|commits)\s+(?:en|de)\s+(.+?)\s*[?.!]*$/i;
  const match = pattern.exec(question);
  const repositoryQueries = match?.[2]?.split(/\s+y\s+|\s*,\s*/).map((value) => value.trim()).filter(Boolean) ?? [];
  if (repositoryQueries.length === 0) return null;
  return {
    repositoryQueries,
    count: Math.min(Math.max(Number(match?.[1] ?? 20), 1), 100),
    rawText: match?.[0] ?? question
  };
}

function detectAuthorRepositories(question: string): Omit<AuthorRepositoriesPlan, "kind"> | null {
  const patterns = [
    /\ben que ha estado trabajando\s+(.+?)\s+en\s+(?:los\s+)?repositorios?\s+(?:de\s+)?(.+?)\s*[?.!]*$/i,
    /\bque ha (?:hecho|trabajado)\s+(.+?)\s+en\s+(?:los\s+)?repositorios?\s+(?:de\s+)?(.+?)\s*[?.!]*$/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(question);
    const authorQuery = match?.[1]?.trim();
    const repositoryQueries = match?.[2]?.split(/\s+y\s+|\s*,\s*/).map((value) => value.trim()).filter(Boolean) ?? [];
    if (authorQuery && repositoryQueries.length > 0) {
      return { authorQuery, repositoryQueries, rawText: match?.[0] ?? question };
    }
  }
  return null;
}

function detectRecentVersions(question: string): Omit<RecentVersionsPlan, "kind"> | null {
  const patterns = [
    /\b(?:ultim\w*|recient\w*)\s+(\d{1,2})\s+version(?:es)?\b/i,
    /\blast\s+(\d{1,2})\s+versions?\b/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(question);
    const count = Number(match?.[1]);
    if (match && Number.isInteger(count) && count > 0) {
      return { count: Math.min(count, 20), rawText: match[0] };
    }
  }
  return null;
}

function detectAuthorSearch(question: string): Omit<AuthorSearchPlan, "kind"> | null {
  const patterns = [
    /\b(?:todos\s+los\s+)?commits?\s+(?:hechos?|realizados?|creados?|escritos?)\s+por\s+(.+?)\s*[?.!]*$/i,
    /\b(?:todos\s+los\s+)?commits?\s+de\s+(.+?)\s*[?.!]*$/i,
    /\b(?:all\s+)?commits?\s+(?:authored|made|created)\s+by\s+(.+?)\s*[?.!]*$/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(question);
    const authorQuery = match?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (authorQuery) {
      return { authorQuery, rawText: match?.[0] ?? question };
    }
  }
  return null;
}

function detectVersionRange(question: string): Omit<VersionRangePlan, "kind"> | null {
  const patterns = [
    /\bentre\s+(?:la\s+)?version\s+([a-z0-9._/-]+)\s+y\s+(?:la\s+)?version\s+([a-z0-9._/-]+)\b/i,
    /\bentre\s+(?:la\s+)?version\s+([a-z0-9._/-]+)\s+y\s+(?:la\s+)?([a-z0-9._/-]+)\b/i,
    /\bentre\s+v?([0-9][a-z0-9._/-]*)\s+y\s+v?([0-9][a-z0-9._/-]*)\b/i,
    /\bde\s+(?:la\s+)?version\s+([a-z0-9._/-]+)\s+a\s+(?:la\s+)?version\s+([a-z0-9._/-]+)\b/i,
    /\bde\s+(?:la\s+)?version\s+([a-z0-9._/-]+)\s+a\s+(?:la\s+)?([a-z0-9._/-]+)\b/i,
    /\bde\s+v?([0-9][a-z0-9._/-]*)\s+a\s+v?([0-9][a-z0-9._/-]*)\b/i,
    /\bdesde\s+(?:la\s+)?version\s+([a-z0-9._/-]+)\s+hasta\s+(?:la\s+)?version\s+([a-z0-9._/-]+)\b/i,
    /\bdesde\s+(?:la\s+)?version\s+([a-z0-9._/-]+)\s+hasta\s+(?:la\s+)?([a-z0-9._/-]+)\b/i,
    /\bdesde\s+v?([0-9][a-z0-9._/-]*)\s+hasta\s+v?([0-9][a-z0-9._/-]*)\b/i
  ];
  return firstRangeMatch(question, patterns, "fromVersion", "toVersion");
}

function detectDateRange(question: string): Omit<DateRangePlan, "kind"> | null {
  const patterns = [
    /\bentre\s+(\d{4}-\d{2}-\d{2})\s+y\s+(\d{4}-\d{2}-\d{2})\b/i,
    /\bde\s+(\d{4}-\d{2}-\d{2})\s+a\s+(\d{4}-\d{2}-\d{2})\b/i,
    /\bdesde\s+(\d{4}-\d{2}-\d{2})\s+hasta\s+(\d{4}-\d{2}-\d{2})\b/i
  ];
  return firstRangeMatch(question, patterns, "fromDate", "toDate");
}

function detectCommitRange(question: string): Omit<CommitRangePlan, "kind"> | null {
  const patterns = [
    /\bentre\s+([0-9a-f]{7,40})\s+y\s+([0-9a-f]{7,40})\b/i,
    /\bde\s+([0-9a-f]{7,40})\s+a\s+([0-9a-f]{7,40})\b/i,
    /\bdesde\s+([0-9a-f]{7,40})\s+hasta\s+([0-9a-f]{7,40})\b/i
  ];
  return firstRangeMatch(question, patterns, "fromCommit", "toCommit");
}

function firstRangeMatch<TFrom extends string, TTo extends string>(
  question: string,
  patterns: RegExp[],
  fromKey: TFrom,
  toKey: TTo
): ({ rawText: string } & Record<TFrom | TTo, string>) | null {
  for (const pattern of patterns) {
    const match = pattern.exec(question);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return {
        rawText: match[0],
        [fromKey]: match[1],
        [toKey]: match[2]
      } as { rawText: string } & Record<TFrom | TTo, string>;
    }
  }
  return null;
}

function normalizeQuestion(question: string): string {
  return question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}
