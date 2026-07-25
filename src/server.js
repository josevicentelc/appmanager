import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment, loadAppConfig, saveAppConfig } from './config.js';
import { FileStore } from './storage.js';
import { GitHubClient } from './github.js';
import { LMStudioClient } from './lmstudio.js';
import { SyncService } from './sync.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = await loadEnvironment(root);
let appConfig = await loadAppConfig(environment);
const store = new FileStore(environment.dataDirectory);
const github = new GitHubClient(environment.githubToken, environment.githubCaCertFile);
const lmStudio = new LMStudioClient(environment.lmStudioBaseUrl);
const sync = new SyncService({ environment, store, github, lmStudio, getConfig: () => appConfig });
const publicDirectory = path.join(root, 'public');

function sendJson(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
async function body(request) { let text = ''; for await (const chunk of request) text += chunk; return text ? JSON.parse(text) : {}; }
function publicConfig() { return { ...appConfig, lmStudioBaseUrl: environment.lmStudioBaseUrl, dataDirectory: environment.dataDirectory }; }

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/api/config') return sendJson(response, 200, publicConfig());
    if (request.method === 'PUT' && url.pathname === '/api/config') {
      const input = await body(request);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.importSince ?? '')) return sendJson(response, 400, { error: 'importSince debe tener formato YYYY-MM-DD.' });
      if (!['es', 'en'].includes(input.language)) return sendJson(response, 400, { error: 'Idioma inválido.' });
      const interval = Number(input.syncIntervalMinutes);
      if (!Number.isFinite(interval) || interval < 1 || interval > 1440) return sendJson(response, 400, { error: 'El intervalo debe estar entre 1 y 1440 minutos.' });
      const repositories = Array.isArray(input.repositories) ? [...new Set(input.repositories.map((repo) => String(repo).trim()).filter(Boolean))] : [];
      const invalid = repositories.filter((repo) => !/^[^/\s]+\/[^/\s]+$/.test(repo));
      if (invalid.length) return sendJson(response, 400, { error: `Repositorio inválido: ${invalid[0]}` });
      appConfig = { importSince: input.importSince, model: String(input.model ?? ''), language: input.language, syncIntervalMinutes: interval, repositories };
      await saveAppConfig(environment, appConfig); return sendJson(response, 200, publicConfig());
    }
    if (request.method === 'GET' && url.pathname === '/api/models') return sendJson(response, 200, { models: await lmStudio.models() });
    if (request.method === 'GET' && url.pathname === '/api/github-repositories') return sendJson(response, 200, { repositories: await github.listRepositories() });
    if (request.method === 'GET' && url.pathname === '/api/status') {
      const states = await store.listRepositoryStates(appConfig.repositories);
      const repositories = await Promise.all(states.map(async (state) => ({ repository: state.repository, state, progress: await store.getRepositoryProgress(state.repository, state.sync?.total ?? 0) })));
      return sendJson(response, 200, { sync: sync.status(), repositories });
    }
    if (request.method === 'POST' && url.pathname === '/api/sync') { const result = await sync.run(); return sendJson(response, result.started ? 202 : 409, result); }
    if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { ok: true });
    if (request.method === 'GET') {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const target = path.resolve(publicDirectory, file);
      if (!target.startsWith(publicDirectory)) return sendJson(response, 403, { error: 'Ruta no permitida.' });
      const content = await fs.readFile(target);
      const type = target.endsWith('.css') ? 'text/css' : target.endsWith('.js') ? 'application/javascript' : 'text/html';
      response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return response.end(content);
    }
    sendJson(response, 404, { error: 'No encontrado.' });
  } catch (error) { sendJson(response, 500, { error: error.message }); }
});

server.listen(environment.appPort, () => console.log(`AppManager disponible en http://localhost:${environment.appPort}`));
let timer = setInterval(() => sync.run().catch((error) => console.error('Error de sincronización programada:', error)), appConfig.syncIntervalMinutes * 60_000);
setInterval(() => {
  const desired = appConfig.syncIntervalMinutes * 60_000;
  if (timer._idleTimeout !== desired) { clearInterval(timer); timer = setInterval(() => sync.run().catch((error) => console.error('Error de sincronización programada:', error)), desired); }
}, 10_000);
