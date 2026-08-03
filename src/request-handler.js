import { dailyReportMarkdown, executiveReportMarkdown } from './report-markdown.js';
import { markdownPdf } from './pdf.js';
import { readJsonBody, safeDownloadFilename, sendJson, sendPdf, sendPublicFile } from './http-utils.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ASANA_GID_PATTERN = /^\d{1,30}$/;
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

export function normalizeAppConfigInput(input, previousConfig) {
  if (!DATE_PATTERN.test(input.importSince ?? '')) throw new Error('importSince debe tener formato YYYY-MM-DD.');
  if (!['es', 'en'].includes(input.language)) throw new Error('Idioma inválido.');
  const syncIntervalMinutes = Number(input.syncIntervalMinutes);
  if (!Number.isFinite(syncIntervalMinutes) || syncIntervalMinutes < 1 || syncIntervalMinutes > 1440) throw new Error('El intervalo debe estar entre 1 y 1440 minutos.');

  const repositories = Array.isArray(input.repositories)
    ? [...new Set(input.repositories.map((repository) => String(repository).trim()).filter(Boolean))]
    : [];
  const invalidRepository = repositories.find((repository) => !/^[^/\s]+\/[^/\s]+$/.test(repository));
  if (invalidRepository) throw new Error(`Repositorio inválido: ${invalidRepository}`);

  const rawNotes = input.repositoryNotes && typeof input.repositoryNotes === 'object' && !Array.isArray(input.repositoryNotes)
    ? input.repositoryNotes
    : {};
  const repositoryNotes = Object.fromEntries(repositories
    .map((repository) => [repository, String(rawNotes[repository] ?? '').trim().slice(0, 6_000)])
    .filter(([, note]) => note));
  const asanaProjects = Array.isArray(input.asanaProjects)
    ? [...new Set(input.asanaProjects.map((project) => String(project).trim()).filter((project) => ASANA_GID_PATTERN.test(project)))]
    : [];
  if (!DATE_PATTERN.test(input.asanaImportSince ?? '')) throw new Error('La fecha inicial de Asana debe tener formato YYYY-MM-DD.');

  return {
    importSince: input.importSince,
    model: String(input.model ?? ''),
    language: input.language,
    syncIntervalMinutes,
    repositories,
    repositoryNotes,
    asanaProjects,
    asanaImportSince: input.asanaImportSince,
    reportInstructions: String(input.reportInstructions ?? previousConfig.reportInstructions ?? '').trim().slice(0, 6_000)
  };
}

function validReportPeriod(from, to) {
  return DATE_PATTERN.test(from) && DATE_PATTERN.test(to) && from <= to;
}

/**
 * Creates the HTTP application boundary. Business services are injected so this
 * module only handles authentication, validation, routing and response formats.
 */
export function createRequestHandler(dependencies) {
  const {
    environment, publicDirectory, authenticator, store, github, lmStudio, asana,
    asanaStore, sync, asanaSync, inferenceQueue, executiveReports, dailyReports,
    handleChat, getConfig, setConfig
  } = dependencies;

  const publicConfig = () => ({ ...getConfig(), lmStudioBaseUrl: environment.lmStudioBaseUrl, dataDirectory: environment.dataDirectory });

  async function sendAsanaAttachment(response, projectGid, taskGid, attachment) {
    const data = await asanaStore.readAttachment(projectGid, taskGid, attachment.localPath);
    const contentType = String(attachment.contentType ?? 'application/octet-stream').split(';')[0].toLocaleLowerCase();
    const inline = INLINE_IMAGE_TYPES.has(contentType);
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeDownloadFilename(attachment.name, 'attachment')}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox'
    });
    response.end(data);
  }

  return async function handleRequest(request, response) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);

      // Authentication routes stay public; every data route below requires a session.
      if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        const input = await readJsonBody(request);
        const result = authenticator.login({ username: String(input.username ?? '').slice(0, 256), password: String(input.password ?? '').slice(0, 1_024), ip: request.socket.remoteAddress ?? 'unknown' });
        if (!result.ok) return sendJson(response, result.status, { error: result.error });
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': result.cookie });
        return response.end(JSON.stringify({ authenticated: true, expiresAt: new Date(result.expiresAt).toISOString() }));
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        response.writeHead(204, { 'Set-Cookie': authenticator.logout(request) });
        return response.end();
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/session') return sendJson(response, 200, { authenticated: authenticator.isAuthenticated(request) });
      const publicAsset = request.method === 'GET' && ['/', '/app.css', '/app.js', '/reports-ui.js', '/client-api.js'].includes(url.pathname);
      if (!publicAsset && !authenticator.isAuthenticated(request)) return sendJson(response, 401, { error: 'Autenticación requerida.' });

      let config = getConfig();
      if (request.method === 'GET' && url.pathname === '/api/config') return sendJson(response, 200, publicConfig());
      if (request.method === 'PUT' && url.pathname === '/api/config') {
        const input = await readJsonBody(request);
        try { config = normalizeAppConfigInput(input, config); }
        catch (error) { return sendJson(response, 400, { error: error.message }); }
        await setConfig(config);
        return sendJson(response, 200, publicConfig());
      }
      if (request.method === 'PUT' && url.pathname === '/api/report-instructions') {
        const input = await readJsonBody(request);
        config = { ...config, reportInstructions: String(input.instructions ?? '').trim().slice(0, 6_000) };
        await setConfig(config);
        return sendJson(response, 200, { reportInstructions: config.reportInstructions });
      }

      // Read-only catalogs and synchronization status.
      if (request.method === 'GET' && url.pathname === '/api/models') return sendJson(response, 200, { models: await lmStudio.models() });
      if (request.method === 'GET' && url.pathname === '/api/github-repositories') return sendJson(response, 200, { repositories: await github.listRepositories() });
      if (request.method === 'GET' && url.pathname === '/api/asana-projects') return sendJson(response, 200, asana.configured() ? { configured: true, projects: await asana.listProjects() } : { configured: false, projects: [] });
      if (request.method === 'GET' && url.pathname === '/api/asana-report-users') return sendJson(response, 200, { users: await asanaStore.listStoryAuthorNames(config.asanaProjects ?? []) });
      if (request.method === 'GET' && url.pathname === '/api/status') {
        const states = await store.listRepositoryStates(config.repositories);
        const repositories = await Promise.all(states.map(async (state) => ({ repository: state.repository, state, progress: await store.getRepositoryProgress(state.repository, state.sync?.total ?? 0) })));
        const asanaProjects = await Promise.all((config.asanaProjects ?? []).map(async (projectGid) => ({ projectGid, state: await asanaStore.getState(projectGid) })));
        return sendJson(response, 200, { sync: sync.status(), repositories, asana: asanaSync.status(), asanaProjects, inferenceQueue: inferenceQueue.status() });
      }
      if (request.method === 'POST' && url.pathname === '/api/sync') { const result = await sync.run(); return sendJson(response, result.started ? 202 : 409, result); }
      if (request.method === 'POST' && url.pathname === '/api/asana/sync') { const result = await asanaSync.run(); return sendJson(response, result.started ? 202 : 409, result); }

      // Locally cached Asana attachments are served through authenticated routes.
      const attachmentByIdMatch = request.method === 'GET' && url.pathname.match(/^\/api\/asana\/attachments\/by-id\/(\d{1,30})$/);
      if (attachmentByIdMatch) {
        const found = await asanaStore.findAttachment(config.asanaProjects ?? [], attachmentByIdMatch[1]);
        if (!found?.attachment?.downloaded || !found.attachment.localPath) return sendJson(response, 404, { error: 'Adjunto no disponible localmente.' });
        return sendAsanaAttachment(response, found.projectGid, found.taskGid, found.attachment);
      }
      const attachmentMatch = request.method === 'GET' && url.pathname.match(/^\/api\/asana\/attachments\/(\d{1,30})\/(\d{1,30})\/(\d{1,30})$/);
      if (attachmentMatch) {
        const [, projectGid, taskGid, attachmentGid] = attachmentMatch;
        if (!(config.asanaProjects ?? []).includes(projectGid)) return sendJson(response, 404, { error: 'Adjunto no encontrado.' });
        const attachment = (await asanaStore.getAttachments(projectGid, taskGid)).find((item) => String(item.gid) === attachmentGid && item.downloaded && item.localPath);
        if (!attachment) return sendJson(response, 404, { error: 'Adjunto no disponible localmente.' });
        return sendAsanaAttachment(response, projectGid, taskGid, attachment);
      }

      // Report routes validate deterministic inputs before invoking their services.
      if (request.method === 'POST' && url.pathname === '/api/reports/executive') {
        const input = await readJsonBody(request);
        const from = String(input.from ?? ''); const to = String(input.to ?? '');
        if (!validReportPeriod(from, to)) return sendJson(response, 400, { error: 'Selecciona un rango de fechas válido.' });
        const report = await executiveReports.collect({ repositories: config.repositories, projectGids: config.asanaProjects ?? [], from, to });
        return sendPdf(response, markdownPdf(executiveReportMarkdown(report)), `informe-ejecutivo-${from}_a_${to}.pdf`);
      }
      if (request.method === 'POST' && url.pathname === '/api/reports/daily') {
        const input = await readJsonBody(request);
        const from = String(input.from ?? ''); const to = String(input.to ?? ''); const author = String(input.author ?? '').trim();
        if (!validReportPeriod(from, to)) return sendJson(response, 400, { error: 'Selecciona un rango de fechas válido.' });
        if (!author) return sendJson(response, 400, { error: 'Selecciona un usuario para el informe diario.' });
        const knownAuthors = await asanaStore.listStoryAuthorNames(config.asanaProjects ?? []);
        if (!knownAuthors.includes(author)) return sendJson(response, 400, { error: 'El usuario seleccionado no pertenece a las tareas Asana configuradas.' });
        const report = await dailyReports.generate({ model: config.model, language: config.language, projectGids: config.asanaProjects ?? [], author, from, to, instructions: config.reportInstructions ?? '' });
        return sendPdf(response, markdownPdf(dailyReportMarkdown(report)), `informe-diario-${from}_a_${to}-${safeDownloadFilename(author)}.pdf`);
      }

      if (request.method === 'POST' && url.pathname === '/api/chat') return handleChat(request, response);
      if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { ok: true });
      if (request.method === 'GET') return sendPublicFile(response, publicDirectory, url.pathname);
      return sendJson(response, 404, { error: 'No encontrado.' });
    } catch (error) {
      // SSE errors are already serialized by the chat controller after headers begin.
      if (response.headersSent) return response.destroy(error);
      return sendJson(response, 500, { error: error.message });
    }
  };
}
