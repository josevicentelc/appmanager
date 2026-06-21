import type { EngineeringMemoryDb } from "../db/database.js";

export interface RetrievedFact {
  factType: string;
  title: string;
  content: string;
  confidence: number;
  isInference: boolean;
  references: Array<{
    filePath: string;
    startLine: number | null;
    endLine: number | null;
    referenceType: string;
  }>;
}

export interface RetrievedCandidate {
  repositoryKey: string;
  commitHash: string;
  shortHash: string;
  subject: string;
  committedAt: string;
  summary: string;
  intent: string | null;
  model: string;
  score: number;
  scoreBreakdown: {
    matchedTerms: string[];
    factMatches: number;
    summaryMatches: number;
    subjectMatches: number;
  };
  facts: RetrievedFact[];
}

export async function retrieveCandidates(
  db: EngineeringMemoryDb,
  question: string,
  options: { repositoryKey?: string | null; limit: number }
): Promise<RetrievedCandidate[]> {
  const terms = getSearchTerms(question);

  const rows = await db.all<Array<{
    knowledge_id: number;
    repository_key: string;
    commit_hash: string;
    subject: string;
    committed_at: string;
    summary: string;
    intent: string | null;
    model: string;
    fact_blob: string | null;
  }>>(
    `
    SELECT
      ck.id AS knowledge_id,
      r.key AS repository_key,
      c.hash AS commit_hash,
      c.subject,
      c.committed_at,
      ck.summary,
      ck.intent,
      ck.model,
      GROUP_CONCAT(kf.fact_type || ' ' || kf.title || ' ' || kf.content, char(10)) AS fact_blob
    FROM commit_knowledge ck
    JOIN commits c ON c.id = ck.commit_id
    JOIN repositories r ON r.id = c.repository_id
    LEFT JOIN knowledge_facts kf ON kf.commit_knowledge_id = ck.id
    WHERE (? IS NULL OR r.key = ?)
    GROUP BY ck.id
    `,
    options.repositoryKey ?? null,
    options.repositoryKey ?? null
  );

  const hashPrefixes = getCommitHashPrefixes(question);
  const hashMatchedRows = hashPrefixes.length > 0
    ? rows.filter((row) => hashPrefixes.some((prefix) => row.commit_hash.startsWith(prefix)))
    : [];

  const scored = hashMatchedRows.length > 0
    ? hashMatchedRows
      .slice(0, options.limit)
      .map((row, index) => scoreRow(row, terms, 100 - index))
    : isRecentSummaryQuestion(question) || terms.length === 0
    ? rows
      .sort((a, b) => b.committed_at.localeCompare(a.committed_at))
      .slice(0, options.limit)
      .map((row, index) => scoreRow(row, terms, options.limit - index))
    : rows
      .map((row) => scoreRow(row, terms))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit);

  for (const candidate of scored) {
    candidate.facts = await loadRelevantFacts(db, candidate, terms, question, 8);
  }

  return scored;
}

function scoreRow(
  row: {
    knowledge_id: number;
    repository_key: string;
    commit_hash: string;
    subject: string;
    committed_at: string;
    summary: string;
    intent: string | null;
    model: string;
    fact_blob: string | null;
  },
  terms: string[],
  fallbackScore?: number
): RetrievedCandidate & { knowledgeId: number } {
  const subjectMatches = countMatches(row.subject, terms);
  const summaryMatches = countMatches(`${row.summary} ${row.intent ?? ""}`, terms);
  const factMatches = countMatches(row.fact_blob ?? "", terms);
  const matchedTerms = terms.filter((term) => normalizeText(`${row.subject} ${row.summary} ${row.intent ?? ""} ${row.fact_blob ?? ""}`).includes(term));
  const score = fallbackScore ?? (subjectMatches * 4 + summaryMatches * 3 + factMatches * 2 + matchedTerms.length);

  return {
    knowledgeId: row.knowledge_id,
    repositoryKey: row.repository_key,
    commitHash: row.commit_hash,
    shortHash: row.commit_hash.slice(0, 8),
    subject: row.subject,
    committedAt: row.committed_at,
    summary: row.summary,
    intent: row.intent,
    model: row.model,
    score,
    scoreBreakdown: {
      matchedTerms,
      factMatches,
      summaryMatches,
      subjectMatches
    },
    facts: []
  };
}

async function loadRelevantFacts(
  db: EngineeringMemoryDb,
  candidate: RetrievedCandidate & { knowledgeId?: number },
  terms: string[],
  question: string,
  limit: number
): Promise<RetrievedFact[]> {
  const knowledgeId = candidate.knowledgeId;
  if (knowledgeId === undefined) {
    return [];
  }

  const rows = await db.all<Array<{
    id: number;
    fact_type: string;
    title: string;
    content: string;
    confidence: number;
    is_inference: number;
  }>>(
    `
    SELECT id, fact_type, title, content, confidence, is_inference
    FROM knowledge_facts
    WHERE commit_knowledge_id = ?
    `,
    knowledgeId
  );

  const ranked = rows
    .map((row) => ({
      row,
      score: countMatches(`${row.fact_type} ${row.title} ${row.content}`, terms) + priorityFactBoost(row.fact_type, question)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const facts: RetrievedFact[] = [];
  for (const item of ranked) {
    const references = await db.all<Array<{
      file_path: string;
      start_line: number | null;
      end_line: number | null;
      reference_type: string;
    }>>(
      `
      SELECT file_path, start_line, end_line, reference_type
      FROM source_references
      WHERE knowledge_fact_id = ?
      ORDER BY id
      LIMIT 3
      `,
      item.row.id
    );

    facts.push({
      factType: item.row.fact_type,
      title: item.row.title,
      content: item.row.content,
      confidence: item.row.confidence,
      isInference: item.row.is_inference === 1,
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

export function buildInvestigationContext(question: string, candidates: RetrievedCandidate[]): string {
  const sections = [
    `QUESTION\n${question}`,
    "CANDIDATES"
  ];

  candidates.forEach((candidate, index) => {
    const facts = candidate.facts.map((fact, factIndex) => {
      const references = fact.references.map((reference) => (
        `${candidate.repositoryKey} ${candidate.shortHash} ${reference.filePath}:${reference.startLine ?? "?"}-${reference.endLine ?? "?"}`
      ));
      return [
        `  FACT ${factIndex + 1} [${fact.factType}] ${fact.isInference ? "INFERENCE" : "FACT"}`,
        `  Title: ${fact.title}`,
        `  Content: ${fact.content}`,
        references.length > 0 ? `  References: ${references.join("; ")}` : "  References: none"
      ].join("\n");
    });

    sections.push([
      `CANDIDATE ${index + 1}`,
      `Repository: ${candidate.repositoryKey}`,
      `Commit: ${candidate.commitHash}`,
      `Date: ${candidate.committedAt}`,
      `Subject: ${candidate.subject}`,
      `Summary: ${candidate.summary}`,
      `Intent: ${candidate.intent ?? "unknown"}`,
      `Score: ${candidate.score}`,
      `Matched terms: ${candidate.scoreBreakdown.matchedTerms.join(", ") || "none"}`,
      ...facts
    ].join("\n"));
  });

  return sections.join("\n\n");
}

export function buildHighLevelContext(question: string, candidates: RetrievedCandidate[]): string {
  const sections = [
    `QUESTION\n${question}`,
    "HIGH-LEVEL PRODUCT CHANGES"
  ];

  candidates.forEach((candidate, index) => {
    sections.push([
      `CHANGE ${index + 1}`,
      `Date: ${candidate.committedAt}`,
      `Description: ${candidate.summary}`,
      `Purpose: ${candidate.intent ?? "Not specified"}`
    ].join("\n"));
  });

  return sections.join("\n\n");
}

function getSearchTerms(question: string): string[] {
  const stopwords = new Set([
    "para", "pero", "como", "cuando", "donde", "cual", "que", "por", "con", "sin",
    "los", "las", "una", "unos", "unas", "del", "the", "and", "what", "when", "where",
    "commits", "commit", "cambio", "cambios", "toca", "tocan", "sobre", "tiene", "tienen",
    "cual", "cuál", "fue", "han", "has", "hay", "del", "desde", "hasta", "añadio", "anadio",
    "añadido", "anadido"
  ]);

  const terms = normalizeText(question)
    .match(/[a-z0-9_]{3,}/g) ?? [];

  return [...new Set(expandTerms(terms))]
    .filter((term) => !stopwords.has(term))
    .filter((term) => !extraStopwords.has(term))
    .slice(0, 12);
}

const extraStopwords = new Set([
  "explicame",
  "explica",
  "poco",
  "cosas",
  "hecho",
  "hicieron",
  "ultimas",
  "ultimos",
  "reciente",
  "recientes"
]);

function expandTerms(terms: string[]): string[] {
  const expanded = [...terms];
  if (terms.some((term) => term.startsWith("riesg"))) {
    expanded.push("risk", "riesgo");
  }
  if (terms.some((term) => term.startsWith("memori"))) {
    expanded.push("memory", "memoria");
  }
  if (terms.some((term) => term.startsWith("herramient") || term === "tool")) {
    expanded.push("tool", "tools", "herramienta");
  }
  return expanded;
}

function priorityFactBoost(factType: string, question: string): number {
  const normalizedQuestion = normalizeText(question);
  if (factType === "risk" && /\briesg|\brisk/.test(normalizedQuestion)) {
    return 10;
  }
  if (factType === "possible_symptom" && /\bsintom|\bsymptom/.test(normalizedQuestion)) {
    return 8;
  }
  if (factType === "behavior_change") {
    return 1;
  }
  return 0;
}

function isRecentSummaryQuestion(question: string): boolean {
  const normalized = normalizeText(question);
  return /\bultim|\brecient|\bque se ha hecho|\bque se hizo|\bcosas que se han hecho|\bultimas cosas/.test(normalized);
}

function getCommitHashPrefixes(question: string): string[] {
  return [...new Set(
    (question.toLowerCase().match(/\b[0-9a-f]{7,40}\b/g) ?? [])
      .filter((value) => /[a-f]/.test(value))
  )];
}

function countMatches(text: string, terms: string[]): number {
  const normalized = normalizeText(text);
  return terms.reduce((count, term) => count + (normalized.includes(term) ? 1 : 0), 0);
}

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
