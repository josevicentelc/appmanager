import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { openEngineeringMemoryDb } from "../db/database.js";
import { answerInvestigationQuestion } from "../application/investigation-service.js";
import { loadRepositoryConfigs } from "../repositories/repository-config.js";
import { digestDaemonStatus } from "../daemon/status.js";
import { isInvestigationAudience } from "../domain/investigation-audience.js";
import { buildExecutiveBriefing } from "../application/executive-briefing-service.js";
import { buildEmployeeWorkReports, listEmployeeAuthors, maxAuthorsPerReport, parseReportPeriod } from "../application/employee-work-report-service.js";

export async function startHttpServer(): Promise<Server> {
  const config = await loadConfig();
  const server = createServer(async (request, response) => {
    try {
      await routeRequest(request, response, config);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(config.server.port, config.server.host, () => {
      server.off("error", reject);
      console.log(`Engineering Memory server listening on http://${config.server.host}:${config.server.port}`);
      resolveListen();
    });
  });
  return server;
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: Awaited<ReturnType<typeof loadConfig>>
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (request.method === "GET" && url.pathname === "/") {
    sendHtml(response, await readFile("src/server/public/index.html", "utf8"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/styles.css") {
    sendCss(response, await readFile("src/server/public/styles.css", "utf8"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/app.js") {
    sendJavaScript(response, await readFile("src/server/public/app.js", "utf8"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/assets/voxelsensei.png") {
    sendPng(response, await readFile("src/server/public/assets/voxelsensei.png"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      model: config.ai.chatModel,
      database: config.database.path,
      digestDaemon: digestDaemonStatus
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/repositories") {
    const repositories = await loadRepositoryConfigs();
    sendJson(response, 200, {
      repositories: repositories
        .filter((repository) => repository.enabled)
        .map((repository) => ({
          id: repository.id,
          displayName: repository.displayName,
          branch: repository.checkout.branch,
          localPath: repository.checkout.localPath,
          sourceRepositoryId: repository.sourceRepositoryId,
          projectId: repository.projectId,
          projectRoot: repository.projectRoot,
          tagPatterns: repository.versioning.tags
        }))
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/summary") {
    const db = await openEngineeringMemoryDb(config.database.path);
    try {
      const counts = await db.get(`
        SELECT
          (SELECT COUNT(*) FROM repositories) AS repositories,
          (SELECT COUNT(*) FROM commits) AS commits,
          (SELECT COUNT(*) FROM knowledge_facts) AS facts,
          (SELECT COUNT(*) FROM source_references) AS sourceReferences
      `);
      sendJson(response, 200, { counts });
    } finally {
      await db.close();
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJsonBody<{
      question?: unknown;
      repositoryKey?: unknown;
      limit?: unknown;
      includeContext?: unknown;
      audience?: unknown;
    }>(request);
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      sendJson(response, 400, { error: "question is required" });
      return;
    }

    const limit = typeof body.limit === "number" && Number.isInteger(body.limit) && body.limit > 0
      ? body.limit
      : 5;
    const repositoryKey = typeof body.repositoryKey === "string" && body.repositoryKey.trim() !== ""
      ? body.repositoryKey.trim()
      : null;
    const audience = isInvestigationAudience(body.audience) ? body.audience : "developer";

    const db = await openEngineeringMemoryDb(config.database.path);
    try {
      const result = await answerInvestigationQuestion(db, config, {
        question,
        repositoryKey,
        limit,
        audience
      });
      sendJson(response, 200, {
        answer: result.answer,
        audience: result.audience,
        candidates: audience === "user"
          ? result.candidates.map((candidate) => ({
            summary: candidate.summary,
            committedAt: candidate.committedAt
          }))
          : result.candidates,
        context: audience === "developer" && body.includeContext === true ? result.context : undefined
      });
    } finally {
      await db.close();
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat/stream") {
    const body = await readJsonBody<{
      question?: unknown;
      repositoryKey?: unknown;
      limit?: unknown;
      audience?: unknown;
      includeContext?: unknown;
    }>(request);
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      sendJson(response, 400, { error: "question is required" });
      return;
    }

    const limit = typeof body.limit === "number" && Number.isInteger(body.limit) && body.limit > 0
      ? body.limit
      : 5;
    const repositoryKey = typeof body.repositoryKey === "string" && body.repositoryKey.trim() !== ""
      ? body.repositoryKey.trim()
      : null;
    const audience = isInvestigationAudience(body.audience) ? body.audience : "developer";

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.flushHeaders();

    const db = await openEngineeringMemoryDb(config.database.path);
    try {
      const result = await answerInvestigationQuestion(db, config, {
        question,
        repositoryKey,
        limit,
        audience,
        onProgress: (stage) => sendEvent(response, {
          type: "status",
          stage,
          message: progressMessage(stage)
        })
      });
      sendEvent(response, {
        type: "result",
        data: {
          answer: result.answer,
          audience: result.audience,
          candidates: audience === "user"
            ? result.candidates.map((candidate) => ({
              summary: candidate.summary,
              committedAt: candidate.committedAt
            }))
            : result.candidates,
          context: audience === "developer" && body.includeContext === true
            ? result.context
            : undefined
        }
      });
    } catch (error) {
      sendEvent(response, {
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await db.close();
      response.end();
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/dashboard") {
    sendHtml(response, await readFile("src/server/public/dashboard.html", "utf8"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/dashboard.css") {
    sendCss(response, await readFile("src/server/public/dashboard.css", "utf8"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/dashboard.js") {
    sendJavaScript(response, await readFile("src/server/public/dashboard.js", "utf8"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/executive/briefing") {
    const requestedDays = Number.parseInt(url.searchParams.get("days") ?? "30", 10);
    const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
    const repositoryKey = url.searchParams.get("repository")?.trim() || null;
    const refresh = url.searchParams.get("refresh") === "true";
    const language = url.searchParams.get("language") === "en" ? "en" : "es";
    const db = await openEngineeringMemoryDb(config.database.path);
    try {
      sendJson(response, 200, await buildExecutiveBriefing(db, config, { days, repositoryKey, refresh, language }));
    } finally {
      await db.close();
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/employee-reports/authors") {
    const repositoryKeys = (await loadRepositoryConfigs())
      .filter((repository) => repository.enabled)
      .map((repository) => repository.id);
    const db = await openEngineeringMemoryDb(config.database.path);
    try {
      sendJson(response, 200, { authors: await listEmployeeAuthors(db, repositoryKeys) });
    } finally {
      await db.close();
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/employee-reports") {
    const body = await readJsonBody<{
      from?: unknown;
      to?: unknown;
      authorNames?: unknown;
      language?: unknown;
    }>(request);
    if (typeof body.from !== "string" || typeof body.to !== "string") {
      sendJson(response, 400, { error: "from y to son obligatorios y deben usar YYYY-MM-DD" });
      return;
    }
    const authorNames = body.authorNames === null || body.authorNames === undefined
      ? null
      : Array.isArray(body.authorNames) && body.authorNames.every((name) => typeof name === "string")
        ? body.authorNames
        : undefined;
    if (authorNames === undefined) {
      sendJson(response, 400, { error: "authorNames debe ser null o una lista de nombres" });
      return;
    }
    try {
      parseReportPeriod(body.from, body.to);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (authorNames !== null && new Set(authorNames).size > maxAuthorsPerReport) {
      sendJson(response, 400, { error: `El informe admite un máximo de ${maxAuthorsPerReport} empleados` });
      return;
    }
    const db = await openEngineeringMemoryDb(config.database.path);
    try {
      const repositoryKeys = (await loadRepositoryConfigs())
        .filter((repository) => repository.enabled)
        .map((repository) => repository.id);
      sendJson(response, 200, await buildEmployeeWorkReports(db, config, {
        from: body.from,
        to: body.to,
        authorNames,
        language: body.language === "en" ? "en" : "es",
        repositoryKeys
      }));
    } finally {
      await db.close();
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/metrics/dashboard") {
    const db = await openEngineeringMemoryDb(config.database.path);
    try {
      const metrics = await getDashboardMetrics(db);
      sendJson(response, 200, metrics);
    } finally {
      await db.close();
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/metrics/velocity") {
    const db = await openEngineeringMemoryDb(config.database.path);
    try {
      const params = new URLSearchParams(url.search);
      const days = parseInt(params.get("days") ?? "30", 10);
      const velocity = await getVelocityMetrics(db, days);
      sendJson(response, 200, velocity);
    } finally {
      await db.close();
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/metrics/report") {
    const db = await openEngineeringMemoryDb(config.database.path);
    try {
      const params = new URLSearchParams(url.search);
      const period = (params.get("period") ?? "weekly") as "weekly" | "monthly";
      const report = await generateReport(db, period);
      sendJson(response, 200, report);
    } finally {
      await db.close();
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/metrics/stability") {
    const db = await openEngineeringMemoryDb(config.database.path);
    try {
      const params = new URLSearchParams(url.search);
      const repositoryKey = params.get("repository") ?? null;
      const stability = await getStabilityMetrics(db, repositoryKey);
      sendJson(response, 200, stability);
    } finally {
      await db.close();
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function sendCss(response: ServerResponse, css: string): void {
  response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
  response.end(css);
}

function sendJavaScript(response: ServerResponse, javaScript: string): void {
  response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
  response.end(javaScript);
}

function sendPng(response: ServerResponse, png: Buffer): void {
  response.writeHead(200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400"
  });
  response.end(png);
}

function sendEvent(response: ServerResponse, event: unknown): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function getDashboardMetrics(db: any) {
  const result = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM commits) AS totalCommits,
      (SELECT COUNT(DISTINCT author_name) FROM commits) AS totalAuthors,
      (SELECT COUNT(*) FROM repositories) AS totalRepositories,
      (SELECT COUNT(*) FROM knowledge_facts) AS totalFacts,
      (SELECT AVG(COALESCE(additions + deletions, 0)) FROM commit_files) AS avgFilesPerCommit,
      (SELECT COUNT(*) FROM commits WHERE committed_at > datetime('now', '-7 days')) AS commitsLast7Days,
      (SELECT COUNT(*) FROM commits WHERE committed_at > datetime('now', '-30 days')) AS commitsLast30Days
  `);

  const avgFilesPerCommit = result.avgFilesPerCommit || 0;

  return {
    summary: {
      totalCommits: result.totalCommits || 0,
      totalAuthors: result.totalAuthors || 0,
      totalRepositories: result.totalRepositories || 0,
      totalFacts: result.totalFacts || 0
    },
    activity: {
      avgFilesPerCommit: Math.round(avgFilesPerCommit * 100) / 100,
      last7Days: result.commitsLast7Days || 0,
      last30Days: result.commitsLast30Days || 0
    },
    generatedAt: new Date().toISOString()
  };
}

async function getVelocityMetrics(db: any, days: number) {
  const dailyCommits = await db.all(`
    SELECT
      DATE(c.committed_at) AS day,
      COUNT(*) AS commits,
      COUNT(DISTINCT c.author_name) AS authors,
      COALESCE(SUM(COALESCE(cf.additions, 0) + COALESCE(cf.deletions, 0)), 0) AS filesChanged
    FROM commits c
    LEFT JOIN commit_files cf ON c.id = cf.commit_id
    WHERE c.committed_at > datetime('now', ?)
    GROUP BY DATE(c.committed_at)
    ORDER BY day DESC
  `, [`-${days} days`]);

  const totalCommits = dailyCommits.reduce((sum: number, row: any) => sum + row.commits, 0);
  const avgCommitsPerDay = dailyCommits.length > 0 ? totalCommits / dailyCommits.length : 0;
  const avgAuthorsPerDay = dailyCommits.length > 0 
    ? dailyCommits.reduce((sum: number, row: any) => sum + row.authors, 0) / dailyCommits.length
    : 0;

  return {
    period: { days, from: new Date(Date.now() - days * 86400000).toISOString() },
    velocity: {
      totalCommits,
      averagePerDay: Math.round(avgCommitsPerDay * 100) / 100,
      averageAuthorsPerDay: Math.round(avgAuthorsPerDay * 100) / 100
    },
    dailyBreakdown: dailyCommits
  };
}

async function getStabilityMetrics(db: any, repositoryKey: string | null) {
  let bugfixes, features, total;

  if (repositoryKey) {
    bugfixes = await db.get(`
      SELECT COUNT(*) AS count FROM commits c
      INNER JOIN repositories r ON c.repository_id = r.id
      WHERE r.key = ?
      AND (c.subject LIKE '%fix%' OR c.subject LIKE '%bug%' OR c.subject LIKE '%hotfix%')
    `, [repositoryKey]);

    features = await db.get(`
      SELECT COUNT(*) AS count FROM commits c
      INNER JOIN repositories r ON c.repository_id = r.id
      WHERE r.key = ?
      AND (c.subject LIKE '%feat%' OR c.subject LIKE '%feature%')
    `, [repositoryKey]);

    total = await db.get(`
      SELECT COUNT(*) AS count FROM commits c
      INNER JOIN repositories r ON c.repository_id = r.id
      WHERE r.key = ?
    `, [repositoryKey]);
  } else {
    bugfixes = await db.get(`
      SELECT COUNT(*) AS count FROM commits
      WHERE subject LIKE '%fix%' OR subject LIKE '%bug%' OR subject LIKE '%hotfix%'
    `);

    features = await db.get(`
      SELECT COUNT(*) AS count FROM commits
      WHERE subject LIKE '%feat%' OR subject LIKE '%feature%'
    `);

    total = await db.get(`
      SELECT COUNT(*) AS count FROM commits
    `);
  }

  const stabilityIndex = total.count > 0 
    ? Math.round(((total.count - bugfixes.count) / total.count) * 100)
    : 0;

  return {
    repository: repositoryKey,
    stability: {
      index: stabilityIndex,
      bugfixesCount: bugfixes.count,
      featuresCount: features.count,
      totalCommits: total.count
    },
    riskLevel: stabilityIndex > 80 ? "low" : stabilityIndex > 60 ? "medium" : "high"
  };
}

async function generateReport(db: any, period: "weekly" | "monthly") {
  const daysAgo = period === "weekly" ? 7 : 30;
  const periodName = period === "weekly" ? "última semana" : "último mes";

  const commits = await db.all(`
    SELECT
      r.key AS repository_key,
      c.author_name AS author,
      DATE(c.committed_at) AS day,
      COUNT(*) AS commitCount,
      COALESCE(SUM(COALESCE(cf.additions, 0) + COALESCE(cf.deletions, 0)), 0) AS totalFilesChanged
    FROM commits c
    INNER JOIN repositories r ON c.repository_id = r.id
    LEFT JOIN commit_files cf ON c.id = cf.commit_id
    WHERE c.committed_at > datetime('now', ?)
    GROUP BY r.key, c.author_name, DATE(c.committed_at)
    ORDER BY day DESC
  `, [`-${daysAgo} days`]);

  const topAuthors = await db.all(`
    SELECT
      author_name AS author,
      COUNT(*) AS commits,
      COALESCE(SUM(COALESCE(cf.additions, 0) + COALESCE(cf.deletions, 0)), 0) AS filesChanged
    FROM commits c
    LEFT JOIN commit_files cf ON c.id = cf.commit_id
    WHERE c.committed_at > datetime('now', ?)
    GROUP BY c.author_name
    ORDER BY commits DESC
    LIMIT 5
  `, [`-${daysAgo} days`]);

  const topModifiedFiles = await db.all(`
    SELECT
      cf.path AS files,
      COUNT(*) AS timesChanged
    FROM commit_files cf
    INNER JOIN commits c ON cf.commit_id = c.id
    WHERE c.committed_at > datetime('now', ?)
    GROUP BY cf.path
    ORDER BY timesChanged DESC
    LIMIT 10
  `, [`-${daysAgo} days`]);

  return {
    period: { type: period, name: periodName, days: daysAgo },
    summary: {
      totalCommits: commits.length,
      activeAuthors: new Set(commits.map((c: any) => c.author)).size,
      generatedAt: new Date().toISOString()
    },
    topContributors: topAuthors,
    mostModifiedAreas: topModifiedFiles,
    dailyActivity: commits
  };
}

function progressMessage(stage: "retrieving" | "building_context" | "answering"): string {
  switch (stage) {
    case "retrieving":
      return "Buscando cambios relevantes";
    case "building_context":
      return "Preparando evidencias y contexto";
    case "answering":
      return "Pensando en la respuesta";
  }
}

const entryPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (fileURLToPath(import.meta.url) === entryPath) {
  startHttpServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
