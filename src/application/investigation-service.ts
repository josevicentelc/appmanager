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
import type { InvestigationAudience } from "../domain/investigation-audience.js";

export interface InvestigationResult {
  question: string;
  answer: string;
  context: string;
  candidates: RetrievedCandidate[];
  coverage: RetrievalCoverage | RangeCoverage;
  audience: InvestigationAudience;
}

export type InvestigationProgressStage = "retrieving" | "building_context" | "answering";

const defaultMaxCandidates = 200;
const hardMaxCandidates = 500;

export async function answerInvestigationQuestion(
  db: EngineeringMemoryDb,
  config: AppConfig,
  input: {
    question: string;
    repositoryKey?: string | null;
    limit: number;
    audience: InvestigationAudience;
    onProgress?: (stage: InvestigationProgressStage) => void;
  }
): Promise<InvestigationResult> {
  input.onProgress?.("retrieving");
  const explicitLimit = resolveExplicitRequestedLimit(input.question);
  const pageSize = Math.min(Math.max(input.limit, 1), 50);
  const maxCandidates = Math.min(explicitLimit ?? defaultMaxCandidates, hardMaxCandidates);
  const plan = planInvestigationQuery(input.question);
  const retrieval = plan.kind === "candidate_search"
    ? await retrieveCandidateSet(db, input.question, input.repositoryKey === undefined
      ? { pageSize, maxCandidates }
      : { repositoryKey: input.repositoryKey, pageSize, maxCandidates })
    : await retrieveRangeCandidates(db, plan, input.repositoryKey === undefined
      ? { pageSize, maxCandidates }
      : { repositoryKey: input.repositoryKey, pageSize, maxCandidates });
  const candidates = retrieval.candidates;

  if (candidates.length === 0) {
    const context = buildCoverageContext(retrieval.coverage);
    return {
      question: input.question,
      answer: emptyAnswerForCoverage(retrieval.coverage),
      context,
      candidates,
      coverage: retrieval.coverage,
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
  const provider = new OpenAiCompatibleProvider(config.ai);
  input.onProgress?.("answering");
  const answer = await provider.answerQuestion({
    question: input.question,
    context,
    audience: input.audience
  });

  return {
    question: input.question,
    answer,
    context,
    candidates,
    coverage: retrieval.coverage,
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

function buildCoverageContext(coverage: RetrievalCoverage | RangeCoverage): string {
  if (isRangeCoverage(coverage)) {
    return [
      "RANGE COVERAGE",
      `Mode: ${coverage.mode}`,
      `From: ${coverage.fromLabel}${coverage.fromCommit === null ? "" : ` (${coverage.fromCommit})`}`,
      `To: ${coverage.toLabel}${coverage.toCommit === null ? "" : ` (${coverage.toCommit})`}`,
      `Commits in range: ${coverage.commitsInRange}`,
      `Analyzed commits in range: ${coverage.analyzedCommitsInRange}`,
      `Commits without indexed knowledge: ${coverage.missingKnowledgeCommits}`,
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

function emptyAnswerForCoverage(coverage: RetrievalCoverage | RangeCoverage): string {
  if (!isRangeCoverage(coverage)) {
    return "No he encontrado commits candidatos en la memoria indexada para esa pregunta.";
  }
  if (coverage.commitsInRange > 0 && coverage.analyzedCommitsInRange === 0) {
    return `He localizado ${coverage.commitsInRange} commits en el rango solicitado, pero ninguno tiene conocimiento indexado para poder resumirlo con evidencia. Conviene digerir ese rango antes de generar el informe.`;
  }
  return "No he podido resolver commits analizados para el rango solicitado. Revisa que los tags, fechas o hashes existan en la memoria y que el repositorio seleccionado sea el correcto.";
}
