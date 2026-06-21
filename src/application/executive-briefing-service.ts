import type { AppConfig } from "../config.js";
import type { EngineeringMemoryDb } from "../db/database.js";
import { OpenAiCompatibleProvider } from "../ai/openai-compatible-provider.js";
import type { ExecutiveBriefing } from "../ai/executive-briefing-schema.js";

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

export async function buildExecutiveBriefing(
  db: EngineeringMemoryDb,
  config: AppConfig,
  options: { days: number; repositoryKey: string | null; refresh: boolean; language: "es" | "en" }
): Promise<ExecutiveBriefingResult> {
  const cacheKey = `${options.repositoryKey ?? "all"}:${options.days}:${options.language}`;
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
  const briefing = await provider.generateExecutiveBriefing({
    periodDays: options.days,
    repositoryKey: options.repositoryKey,
    language: options.language,
    evidence: rows
  });
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
    LIMIT 80
  `, `-${days} days`, repositoryKey, repositoryKey);
}
