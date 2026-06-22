import type { AppConfig } from "../config.js";
import type { EngineeringMemoryDb } from "../db/database.js";
import { OpenAiCompatibleProvider } from "../ai/openai-compatible-provider.js";
import { executiveBriefingSchema, type ExecutiveBriefing } from "../ai/executive-briefing-schema.js";

interface EvidenceRow {
  repositoryKey: string;
  commitHash: string;
  committedAt: string;
  subject: string;
  summary: string;
  intent: string | null;
  confidence: number;
  facts: string | null;
}

export interface ExecutiveBriefingResult {
  briefing: ExecutiveBriefing | null;
  coverage: { days: number; commitsAnalyzed: number; repositories: number; from: string; to: string };
  generatedAt: string;
  cached: boolean;
  emptyReason?: string;
}

const cache = new Map<string, { expiresAt: number; value: ExecutiveBriefingResult }>();
const executiveEvidenceBatchSize = 50;

export async function buildExecutiveBriefing(
  db: EngineeringMemoryDb,
  config: AppConfig,
  options: { days: number; repositoryKey: string | null; refresh: boolean; language: "es" | "en" }
): Promise<ExecutiveBriefingResult> {
  const cacheKey = `${options.repositoryKey ?? "all"}:${options.days}:${options.language}:${config.ai.chatModel}`;
  const cached = cache.get(cacheKey);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cached: true };
  }

  const rows = await loadEvidence(db, options.days, options.repositoryKey);
  const now = new Date();
  const coverage = {
    days: options.days,
    commitsAnalyzed: rows.length,
    repositories: new Set(rows.map((row) => row.repositoryKey)).size,
    from: new Date(now.getTime() - options.days * 86_400_000).toISOString(),
    to: now.toISOString()
  };

  if (rows.length === 0) {
    return { briefing: null, coverage, generatedAt: now.toISOString(), cached: false, emptyReason: "No hay commits analizados en este periodo." };
  }

  const provider = new OpenAiCompatibleProvider(config.ai);
  const evidenceBatches = chunkEvidence(rows, executiveEvidenceBatchSize);
  const partialBriefings: ExecutiveBriefing[] = [];
  for (const batch of evidenceBatches) {
    partialBriefings.push(await provider.generateExecutiveBriefing({
      periodDays: options.days,
      repositoryKey: options.repositoryKey,
      language: options.language,
      evidence: batch
    }));
  }
  const briefing = combineExecutiveBriefings(partialBriefings);
  const result: ExecutiveBriefingResult = { briefing, coverage, generatedAt: now.toISOString(), cached: false };
  cache.set(cacheKey, { expiresAt: Date.now() + 15 * 60_000, value: result });
  return result;
}

async function loadEvidence(db: EngineeringMemoryDb, days: number, repositoryKey: string | null): Promise<EvidenceRow[]> {
  return db.all<EvidenceRow[]>(`
    SELECT r.key AS repositoryKey, c.hash AS commitHash, c.committed_at AS committedAt,
      c.subject, ck.summary, ck.intent, ck.confidence,
      GROUP_CONCAT(kf.fact_type || ': ' || kf.title || ' - ' || kf.content, char(10)) AS facts
    FROM commit_knowledge ck
    JOIN commits c ON c.id = ck.commit_id
    JOIN repositories r ON r.id = c.repository_id
    LEFT JOIN knowledge_facts kf ON kf.commit_knowledge_id = ck.id
    WHERE c.committed_at >= datetime('now', ?)
      AND (? IS NULL OR r.key = ?)
    GROUP BY ck.id
    ORDER BY c.committed_at DESC
  `, `-${days} days`, repositoryKey, repositoryKey);
}

function combineExecutiveBriefings(briefings: ExecutiveBriefing[]): ExecutiveBriefing {
  if (briefings.length === 1) {
    return briefings[0] as ExecutiveBriefing;
  }
  const achievements = briefings.flatMap((briefing) => briefing.achievements);
  const risks = briefings.flatMap((briefing) => briefing.risks);
  const decisions = briefings.flatMap((briefing) => briefing.decisions);
  const watchItems = briefings.flatMap((briefing) => briefing.watchItems);
  const limitations = [
    ...briefings.flatMap((briefing) => briefing.limitations),
    "La evidencia se proceso en lotes y el informe final consolida los elementos principales de cada seccion."
  ];
  return executiveBriefingSchema.parse({
    headline: briefings[0]?.headline ?? "Resumen ejecutivo",
    executiveSummary: briefings.map((briefing) => briefing.executiveSummary).join(" "),
    overallAttention: strongestAttention(briefings.map((briefing) => briefing.overallAttention)),
    achievements: achievements.slice(0, 5),
    risks: risks.slice(0, 5),
    decisions: decisions.slice(0, 5),
    watchItems: watchItems.slice(0, 5),
    limitations: [...new Set(limitations)].slice(0, 5)
  });
}

function strongestAttention(values: ExecutiveBriefing["overallAttention"][]): ExecutiveBriefing["overallAttention"] {
  if (values.includes("action")) return "action";
  if (values.includes("watch")) return "watch";
  return "normal";
}

function chunkEvidence<T>(evidence: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < evidence.length; index += size) {
    chunks.push(evidence.slice(index, index + size));
  }
  return chunks;
}
