import type { AppConfig } from "../config.js";
import { OpenAiCompatibleProvider } from "../ai/openai-compatible-provider.js";
import type { EngineeringMemoryDb } from "../db/database.js";
import { planInvestigationQuery } from "./query-planner.js";
import {
  buildHighLevelContext,
  buildInvestigationContext,
  retrieveCandidateSet,
  type RetrievalCoverage,
  type RetrievedCandidate
} from "../retrieval/retrieval-service.js";
import { retrieveRangeCandidates, type RangeCoverage } from "../retrieval/version-range-retrieval.js";
import {
  searchCommits,
  searchCommitsByAuthor,
  type AuthorSearchCoverage,
  type CommitSearchCoverage,
  type CommitSearchFilters
} from "../retrieval/commit-search-tools.js";
import type { InvestigationAudience } from "../domain/investigation-audience.js";

export interface InvestigationResult {
  question: string;
  answer: string;
  context: string;
  candidates: RetrievedCandidate[];
  coverage: InvestigationCoverage;
  toolsUsed: InvestigationToolUsage[];
  audience: InvestigationAudience;
}

export type InvestigationProgressStage = "planning" | "using_tool" | "building_context" | "answering";
export interface InvestigationToolUsage { name: string; detail: string; }

const defaultMaxCandidates = 200;
const hardMaxCandidates = 500;
type InvestigationCoverage = RetrievalCoverage | RangeCoverage | AuthorSearchCoverage | CommitSearchCoverage;

export async function answerInvestigationQuestion(
  db: EngineeringMemoryDb,
  config: AppConfig,
  input: {
    question: string;
    repositoryKey?: string | null;
    limit: number;
    audience: InvestigationAudience;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    onProgress?: (stage: InvestigationProgressStage, detail?: string) => void;
  }
): Promise<InvestigationResult> {
  input.onProgress?.("planning");
  const explicitLimit = resolveExplicitRequestedLimit(input.question);
  const pageSize = Math.min(Math.max(input.limit, 1), 50);
  const maxCandidates = Math.min(explicitLimit ?? defaultMaxCandidates, hardMaxCandidates);
  const plan = planInvestigationQuery(input.question);
  const provider = new OpenAiCompatibleProvider(config.ai);
  const modelPlan = plan.kind === "candidate_search"
    ? await provider.planCommitQuery(input.question, input.history ?? []).catch(() => null)
    : null;
  let retrieval: { candidates: RetrievedCandidate[]; coverage: InvestigationCoverage };
  let tool: InvestigationToolUsage;
  const options = input.repositoryKey === undefined
    ? { pageSize, maxCandidates }
    : { repositoryKey: input.repositoryKey, pageSize, maxCandidates };
  if (plan.kind === "candidate_search" && modelPlan?.action === "structured_search") {
    const filters = compactFilters(modelPlan.filters);
    const structuredOptions = filters.repositoryKeys?.length
      ? { pageSize, maxCandidates }
      : options;
    tool = { name: "search_commits", detail: describeFilters(filters) };
    input.onProgress?.("using_tool", `${tool.name}: ${tool.detail}`);
    retrieval = await searchCommits(db, filters, structuredOptions);
  } else if (plan.kind === "candidate_search") {
    tool = { name: "semantic_commit_search", detail: "relevancia en resúmenes, hechos y metadatos" };
    input.onProgress?.("using_tool", `${tool.name}: ${tool.detail}`);
    const retrievalQuery = modelPlan?.retrievalQuery.trim() || input.question;
    retrieval = await retrieveCandidateSet(db, retrievalQuery, options);
  } else if (plan.kind === "author_search") {
    tool = { name: "search_commits", detail: `autor contiene "${plan.authorQuery}"` };
    input.onProgress?.("using_tool", `${tool.name}: ${tool.detail}`);
    retrieval = await searchCommitsByAuthor(db, plan, options);
  } else if (plan.kind === "author_repositories") {
    const filters: CommitSearchFilters = {
      author: plan.authorQuery,
      repositoryKeys: plan.repositoryQueries,
      match: "all",
      sort: "newest"
    };
    tool = { name: "search_commits", detail: describeFilters(filters) };
    input.onProgress?.("using_tool", `${tool.name}: ${tool.detail}`);
    retrieval = await searchCommits(db, filters, { pageSize, maxCandidates });
  } else if (plan.kind === "recent_repository_changes") {
    const filters: CommitSearchFilters = {
      repositoryKeys: plan.repositoryQueries,
      match: "all",
      sort: "newest"
    };
    tool = { name: "search_commits", detail: `${describeFilters(filters)}; limit=${plan.count}` };
    input.onProgress?.("using_tool", `${tool.name}: ${tool.detail}`);
    retrieval = await searchCommits(db, filters, { pageSize, maxCandidates: plan.count });
  } else {
    tool = { name: "search_commit_range", detail: `${plan.kind}: ${plan.rawText}` };
    input.onProgress?.("using_tool", `${tool.name}: ${tool.detail}`);
    retrieval = await retrieveRangeCandidates(db, plan, options);
  }
  const candidates = retrieval.candidates;

  if (candidates.length === 0) {
    const context = buildCoverageContext(retrieval.coverage);
    return {
      question: input.question,
      answer: emptyAnswerForCoverage(retrieval.coverage),
      context,
      candidates,
      coverage: retrieval.coverage,
      toolsUsed: [tool],
      audience: input.audience
    };
  }

  input.onProgress?.("building_context");
  const evidenceContext = input.audience === "user"
    ? buildHighLevelContext(input.question, candidates)
    : buildInvestigationContext(input.question, candidates);
  const context = [
    buildCoverageContext(retrieval.coverage),
    evidenceContext
  ].join("\n\n");
  input.onProgress?.("answering");
  const answer = await provider.answerQuestion({
    question: input.question,
    context,
    audience: input.audience,
    history: input.history ?? []
  });

  return {
    question: input.question,
    answer,
    context,
    candidates,
    coverage: retrieval.coverage,
    toolsUsed: [tool],
    audience: input.audience
  };
}

export function resolveRequestedLimit(question: string, fallback: number): number {
  return resolveExplicitRequestedLimit(question) ?? fallback;
}

export function resolveExplicitRequestedLimit(question: string): number | null {
  const normalized = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const numericMatch = /\b(?:ultim\w*|recient\w*)\s+(\d{1,2})\b/.exec(normalized) ??
    /\b(\d{1,2})\s+(?:ultim\w*\s+)?(?:cambios|commits)\b/.exec(normalized);
  if (numericMatch?.[1] !== undefined) {
    return Math.min(Math.max(Number(numericMatch[1]), 1), 20);
  }

  const wordNumbers: Record<string, number> = {
    cinco: 5,
    diez: 10,
    quince: 15,
    veinte: 20
  };
  for (const [word, value] of Object.entries(wordNumbers)) {
    if (new RegExp(`\\b(?:ultim\\w*|recient\\w*)\\s+${word}\\b`).test(normalized)) {
      return value;
    }
  }

  return null;
}

function buildCoverageContext(coverage: InvestigationCoverage): string {
  if (isAuthorCoverage(coverage)) {
    return [
      "AUTHOR SEARCH COVERAGE",
      `Requested author: ${coverage.requestedAuthor}`,
      `Matched Git authors: ${coverage.matchedAuthors.join(", ") || "none"}`,
      `Commits found: ${coverage.totalCommits}`,
      `Commits with indexed knowledge: ${coverage.analyzedCommits}`,
      `Commits without indexed knowledge: ${coverage.missingKnowledgeCommits}`,
      `Included commits: ${coverage.returnedCandidates}`,
      `Truncated: ${coverage.truncated ? `yes, capped at ${coverage.requestedMaxCandidates}` : "no"}`
    ].join("\n");
  }
  if (isStructuredCoverage(coverage)) {
    return [
      "STRUCTURED SEARCH COVERAGE",
      `Applied filters: ${JSON.stringify(coverage.filters)}`,
      `Commits found: ${coverage.totalCommits}`,
      `Commits with indexed knowledge: ${coverage.analyzedCommits}`,
      `Commits without indexed knowledge: ${coverage.missingKnowledgeCommits}`,
      `Included commits: ${coverage.returnedCandidates}`,
      `Truncated: ${coverage.truncated ? `yes, capped at ${coverage.requestedMaxCandidates}` : "no"}`
    ].join("\n");
  }
  if (isRangeCoverage(coverage)) {
    return [
      "RANGE COVERAGE",
      `Mode: ${coverage.mode}`,
      `From: ${coverage.fromLabel}${coverage.fromCommit === null ? "" : ` (${coverage.fromCommit})`}`,
      `To: ${coverage.toLabel}${coverage.toCommit === null ? "" : ` (${coverage.toCommit})`}`,
      `Commits in range: ${coverage.commitsInRange}`,
      `Analyzed commits in range: ${coverage.analyzedCommitsInRange}`,
      `Commits without indexed knowledge: ${coverage.missingKnowledgeCommits}`,
      ...(coverage.includedVersions?.length ? [`Included versions: ${coverage.includedVersions.join(", ")}`] : []),
      `Included analyzed commits: ${coverage.returnedCandidates}`,
      `Internal page size: ${coverage.pageSize}`,
      `Pages read: ${coverage.pagesRead}`,
      `Truncated: ${coverage.truncated ? `yes, capped at ${coverage.requestedMaxCandidates}` : "no"}`
    ].join("\n");
  }

  return [
    "RETRIEVAL COVERAGE",
    `Matched analyzed commits: ${coverage.totalCandidates}`,
    `Included analyzed commits: ${coverage.returnedCandidates}`,
    `Internal page size: ${coverage.pageSize}`,
    `Pages read: ${coverage.pagesRead}`,
    `Truncated: ${coverage.truncated ? `yes, capped at ${coverage.requestedMaxCandidates}` : "no"}`
  ].join("\n");
}

function isRangeCoverage(coverage: RetrievalCoverage | RangeCoverage): coverage is RangeCoverage {
  return "commitsInRange" in coverage;
}

function isAuthorCoverage(coverage: InvestigationCoverage): coverage is AuthorSearchCoverage {
  return "mode" in coverage && coverage.mode === "author_search";
}

function isStructuredCoverage(coverage: InvestigationCoverage): coverage is CommitSearchCoverage {
  return "mode" in coverage && coverage.mode === "structured_search";
}

function emptyAnswerForCoverage(coverage: InvestigationCoverage): string {
  if (isAuthorCoverage(coverage)) {
    return `No he encontrado commits cuyo autor Git coincida con "${coverage.requestedAuthor}" en el repositorio seleccionado.`;
  }
  if (!isRangeCoverage(coverage)) {
    return "No he encontrado commits candidatos en la memoria indexada para esa pregunta.";
  }
  if (coverage.commitsInRange > 0 && coverage.analyzedCommitsInRange === 0) {
    return `He localizado ${coverage.commitsInRange} commits en el rango solicitado, pero ninguno tiene conocimiento indexado para poder resumirlo con evidencia. Conviene digerir ese rango antes de generar el informe.`;
  }
  return "No he podido resolver commits analizados para el rango solicitado. Revisa que los tags, fechas o hashes existan en la memoria y que el repositorio seleccionado sea el correcto.";
}

function compactFilters(filters: {
  repositoryKeys: string[];
  author: string | null; committer: string | null; contentTerms: string[];
  fromDate: string | null; toDate: string | null; versions: string[]; hashes: string[];
  filePaths: string[]; factTypes: string[]; statuses: string[];
  match: "all" | "any"; sort: "newest" | "oldest";
}): CommitSearchFilters {
  return {
    ...(filters.repositoryKeys.length === 0 ? {} : { repositoryKeys: filters.repositoryKeys }),
    ...(filters.author === null ? {} : { author: filters.author }),
    ...(filters.committer === null ? {} : { committer: filters.committer }),
    ...(filters.contentTerms.length === 0 ? {} : { contentTerms: filters.contentTerms }),
    ...(filters.fromDate === null ? {} : { fromDate: filters.fromDate }),
    ...(filters.toDate === null ? {} : { toDate: filters.toDate }),
    ...(validExplicitVersions(filters.versions).length === 0 ? {} : { versions: validExplicitVersions(filters.versions) }),
    ...(filters.hashes.length === 0 ? {} : { hashes: filters.hashes }),
    ...(filters.filePaths.length === 0 ? {} : { filePaths: filters.filePaths }),
    ...(filters.factTypes.length === 0 ? {} : { factTypes: filters.factTypes }),
    ...(filters.statuses.length === 0 ? {} : { statuses: filters.statuses }),
    match: filters.match,
    sort: filters.sort
  };
}

function validExplicitVersions(versions: string[]): string[] {
  return versions.filter((version) => !/^(?:last|latest|recent|ultim|recient)[\s_-]*\d*/i.test(
    version.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  ));
}

function describeFilters(filters: CommitSearchFilters): string {
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length > 0));
  return entries.length === 0
    ? "sin filtros adicionales"
    : entries.map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(", ") : String(value)}`).join("; ");
}
