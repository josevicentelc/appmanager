import type { AppConfig } from "../config.js";
import { OpenAiCompatibleProvider } from "../ai/openai-compatible-provider.js";
import { employeeWorkReportSchema, type EmployeeWorkReport } from "../ai/employee-work-report-schema.js";
import type { EngineeringMemoryDb } from "../db/database.js";

export interface EmployeeAuthor {
  authorName: string;
  analyzedCommits: number;
  firstCommitAt: string;
  lastCommitAt: string;
}

export interface EmployeeEvidenceRow {
  authorName: string;
  repositoryKey: string;
  commitHash: string;
  committedAt: string;
  subject: string;
  summary: string;
  intent: string | null;
  confidence: number;
  versionTags: string | null;
  facts: string | null;
}

export interface CombinedEmployeeWorkReport {
  period: { from: string; to: string };
  reports: Array<{
    authorName: string;
    evidenceCommits: number;
    evidenceTruncated: boolean;
    report: EmployeeWorkReport;
  }>;
  emptyAuthors: string[];
  failedAuthors: Array<{ authorName: string; error: string }>;
  generatedAt: string;
}

export const maxAuthorsPerReport = 50;
const reportEvidenceBatchSize = 50;

export async function listEmployeeAuthors(
  db: EngineeringMemoryDb,
  repositoryKeys: string[] | null = null
): Promise<EmployeeAuthor[]> {
  const repositories = normalizeRepositoryKeys(repositoryKeys);
  const repositoryClause = repositories === null
    ? ""
    : repositories.length === 0
      ? "AND 1 = 0"
      : `AND r.key IN (${repositories.map(() => "?").join(", ")})`;
  return db.all<EmployeeAuthor[]>(`
    SELECT c.author_name AS authorName, COUNT(DISTINCT c.id) AS analyzedCommits,
      MIN(c.committed_at) AS firstCommitAt, MAX(c.committed_at) AS lastCommitAt
    FROM commits c
    JOIN commit_knowledge ck ON ck.commit_id = c.id
    JOIN repositories r ON r.id = c.repository_id
    WHERE 1 = 1 ${repositoryClause}
    GROUP BY c.author_name
    ORDER BY c.author_name COLLATE NOCASE
  `, ...(repositories ?? []));
}

export async function loadEmployeeEvidence(
  db: EngineeringMemoryDb,
  from: string,
  to: string,
  authorNames: string[] | null,
  model: string,
  repositoryKeys: string[] | null = null
): Promise<EmployeeEvidenceRow[]> {
  const period = parseReportPeriod(from, to);
  const selected = authorNames === null ? [] : [...new Set(authorNames.map((name) => name.trim()).filter(Boolean))];
  const authorClause = selected.length === 0
    ? ""
    : `AND c.author_name IN (${selected.map(() => "?").join(", ")})`;
  const repositories = normalizeRepositoryKeys(repositoryKeys);
  const repositoryClause = repositories === null
    ? ""
    : repositories.length === 0
      ? "AND 1 = 0"
      : `AND r.key IN (${repositories.map(() => "?").join(", ")})`;
  return db.all<EmployeeEvidenceRow[]>(`
    SELECT c.author_name AS authorName, r.key AS repositoryKey, c.hash AS commitHash,
      c.committed_at AS committedAt, c.subject, ck.summary, ck.intent, ck.confidence,
      (SELECT GROUP_CONCAT(cv.tag, char(10)) FROM commit_versions cv WHERE cv.commit_id = c.id) AS versionTags,
      GROUP_CONCAT(kf.fact_type || ': ' || kf.title || ' - ' || kf.content, char(10)) AS facts
    FROM commits c
    JOIN commit_knowledge ck ON ck.id = (
      SELECT ck2.id FROM commit_knowledge ck2
      WHERE ck2.commit_id = c.id AND ck2.model = ?
      ORDER BY ck2.created_at DESC, ck2.id DESC
      LIMIT 1
    )
    JOIN repositories r ON r.id = c.repository_id
    LEFT JOIN knowledge_facts kf ON kf.commit_knowledge_id = ck.id
    WHERE datetime(c.committed_at) >= datetime(?) AND datetime(c.committed_at) < datetime(?)
      ${authorClause}
      ${repositoryClause}
    GROUP BY ck.id
    ORDER BY c.author_name COLLATE NOCASE, c.committed_at DESC
  `, model, period.fromInstant, period.toExclusive, ...selected, ...(repositories ?? []));
}

export async function buildEmployeeWorkReports(
  db: EngineeringMemoryDb,
  config: AppConfig,
  options: {
    from: string;
    to: string;
    authorNames: string[] | null;
    language: "es" | "en";
    repositoryKeys: string[] | null;
  }
): Promise<CombinedEmployeeWorkReport> {
  const period = parseReportPeriod(options.from, options.to);
  const selectedAuthorNames = options.authorNames === null
    ? null
    : [...new Set(options.authorNames.map((name) => name.trim()).filter(Boolean))];
  if (selectedAuthorNames !== null && selectedAuthorNames.length > maxAuthorsPerReport) {
    throw new Error(`El informe admite un máximo de ${maxAuthorsPerReport} empleados por ejecución`);
  }
  const evidence = await loadEmployeeEvidence(
    db,
    options.from,
    options.to,
    selectedAuthorNames,
    config.ai.chatModel,
    options.repositoryKeys
  );
  const requestedAuthors = options.authorNames === null
    ? [...new Set(evidence.map((row) => row.authorName))]
    : selectedAuthorNames ?? [];
  if (requestedAuthors.length > maxAuthorsPerReport) {
    throw new Error(`El informe admite un máximo de ${maxAuthorsPerReport} empleados por ejecución`);
  }

  const evidenceByAuthor = new Map<string, EmployeeEvidenceRow[]>();
  for (const row of evidence) {
    const rows = evidenceByAuthor.get(row.authorName) ?? [];
    rows.push(row);
    evidenceByAuthor.set(row.authorName, rows);
  }

  const provider = new OpenAiCompatibleProvider(config.ai);
  const reports: CombinedEmployeeWorkReport["reports"] = [];
  const emptyAuthors: string[] = [];
  const failedAuthors: CombinedEmployeeWorkReport["failedAuthors"] = [];
  for (const authorName of requestedAuthors) {
    const allAuthorEvidence = evidenceByAuthor.get(authorName) ?? [];
    if (allAuthorEvidence.length === 0) {
      emptyAuthors.push(authorName);
      continue;
    }
    const evidenceByRepository = new Map<string, EmployeeEvidenceRow[]>();
    for (const row of allAuthorEvidence) {
      const repositoryEvidence = evidenceByRepository.get(row.repositoryKey) ?? [];
      repositoryEvidence.push(row);
      evidenceByRepository.set(row.repositoryKey, repositoryEvidence);
    }
    const partialReports: EmployeeWorkReport[] = [];
    const repositoryErrors: string[] = [];
    for (const [repositoryKey, repositoryEvidence] of evidenceByRepository) {
      const batches = chunkEvidence(repositoryEvidence, reportEvidenceBatchSize);
      for (const [index, batch] of batches.entries()) {
        try {
          partialReports.push(await generateRepositoryReportWithRetry(
            provider,
            authorName,
            period,
            options.language,
            batch
          ));
        } catch (error) {
          const batchLabel = batches.length === 1 ? "" : ` lote ${index + 1}/${batches.length}`;
          repositoryErrors.push(`${repositoryKey}${batchLabel}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (partialReports.length > 0) {
      const report = combineRepositoryReports(partialReports, repositoryErrors);
      reports.push({
        authorName,
        evidenceCommits: allAuthorEvidence.length,
        evidenceTruncated: false,
        report
      });
    } else {
      failedAuthors.push({
        authorName,
        error: repositoryErrors.join("; ") || "No se pudo generar ningún bloque de repositorio"
      });
    }
  }

  return {
    period: { from: period.from, to: period.to },
    reports,
    emptyAuthors,
    failedAuthors,
    generatedAt: new Date().toISOString()
  };
}

async function generateRepositoryReportWithRetry(
  provider: OpenAiCompatibleProvider,
  authorName: string,
  period: { from: string; to: string },
  language: "es" | "en",
  evidence: EmployeeEvidenceRow[]
): Promise<EmployeeWorkReport> {
  try {
    return await provider.generateEmployeeWorkReport({
      authorName,
      from: period.from,
      to: period.to,
      language,
      evidence
    });
  } catch (firstError) {
    const retryLimit = Math.max(1, Math.ceil(evidence.length / 2));
    try {
      return await provider.generateEmployeeWorkReport({
        authorName,
        from: period.from,
        to: period.to,
        language,
        evidence: evidence.slice(0, retryLimit)
      });
    } catch (retryError) {
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
      const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`primer intento: ${firstMessage}; reintento: ${retryMessage}`);
    }
  }
}

function combineRepositoryReports(
  partialReports: EmployeeWorkReport[],
  repositoryErrors: string[]
): EmployeeWorkReport {
  const repositoriesByKey = new Map<string, EmployeeWorkReport["repositories"][number]>();
  const consolidationLimitations: string[] = [];
  for (const partial of partialReports) {
    for (const repository of partial.repositories) {
      const existing = repositoriesByKey.get(repository.repositoryKey);
      if (existing === undefined) {
        repositoriesByKey.set(repository.repositoryKey, {
          ...repository,
          focusAreas: [...repository.focusAreas],
          tasks: [...repository.tasks]
        });
      } else {
        existing.summary = `${existing.summary} ${repository.summary}`.trim();
        existing.focusAreas = [...new Set([...existing.focusAreas, ...repository.focusAreas])].slice(0, 8);
        const mergedTasks = [...existing.tasks, ...repository.tasks];
        if (mergedTasks.length > 12) {
          consolidationLimitations.push(`El repositorio ${repository.repositoryKey} tuvo mas de 12 grupos de tareas; el informe final muestra los 12 primeros grupos consolidados.`);
        }
        existing.tasks = mergedTasks.slice(0, 12);
      }
    }
  }
  return employeeWorkReportSchema.parse({
    summary: partialReports.map((report) => report.summary).join(" "),
    repositories: [...repositoriesByKey.values()],
    limitations: [...new Set([
      ...partialReports.flatMap((report) => report.limitations),
      ...consolidationLimitations,
      ...repositoryErrors.map((error) => `No se pudo generar un bloque: ${error}`)
    ])].slice(0, 5)
  });
}

function chunkEvidence(evidence: EmployeeEvidenceRow[], size: number): EmployeeEvidenceRow[][] {
  const chunks: EmployeeEvidenceRow[][] = [];
  for (let index = 0; index < evidence.length; index += size) {
    chunks.push(evidence.slice(index, index + size));
  }
  return chunks;
}

export function parseReportPeriod(from: string, to: string): {
  from: string;
  to: string;
  fromInstant: string;
  toExclusive: string;
} {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new Error("from y to deben usar el formato YYYY-MM-DD");
  }
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  if (fromDate > toDate) {
    throw new Error("from no puede ser posterior a to");
  }
  const rangeDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (rangeDays > 366) {
    throw new Error("El periodo del informe no puede superar 366 días");
  }
  return {
    from,
    to,
    fromInstant: fromDate.toISOString(),
    toExclusive: new Date(toDate.getTime() + 86_400_000).toISOString()
  };
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function normalizeRepositoryKeys(repositoryKeys: string[] | null): string[] | null {
  return repositoryKeys === null
    ? null
    : [...new Set(repositoryKeys.map((key) => key.trim()).filter(Boolean))];
}
