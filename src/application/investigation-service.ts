import type { AppConfig } from "../config.js";
import { OpenAiCompatibleProvider } from "../ai/openai-compatible-provider.js";
import type { EngineeringMemoryDb } from "../db/database.js";
import {
  buildHighLevelContext,
  buildInvestigationContext,
  retrieveCandidates,
  type RetrievedCandidate
} from "../retrieval/retrieval-service.js";
import type { InvestigationAudience } from "../domain/investigation-audience.js";

export interface InvestigationResult {
  question: string;
  answer: string;
  context: string;
  candidates: RetrievedCandidate[];
  audience: InvestigationAudience;
}

export type InvestigationProgressStage = "retrieving" | "building_context" | "answering";

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
  const effectiveLimit = resolveRequestedLimit(input.question, input.limit);
  const candidates = await retrieveCandidates(db, input.question, input.repositoryKey === undefined
    ? { limit: effectiveLimit }
    : { repositoryKey: input.repositoryKey, limit: effectiveLimit });

  if (candidates.length === 0) {
    return {
      question: input.question,
      answer: "No he encontrado commits candidatos en la memoria indexada para esa pregunta.",
      context: "",
      candidates,
      audience: input.audience
    };
  }

  input.onProgress?.("building_context");
  const context = input.audience === "user"
    ? buildHighLevelContext(input.question, candidates)
    : buildInvestigationContext(input.question, candidates);
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
    audience: input.audience
  };
}

export function resolveRequestedLimit(question: string, fallback: number): number {
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

  return fallback;
}
