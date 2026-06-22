export type InvestigationPlan =
  | VersionRangePlan
  | DateRangePlan
  | CommitRangePlan
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

export function planInvestigationQuery(question: string): InvestigationPlan {
  const normalized = normalizeQuestion(question);
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
