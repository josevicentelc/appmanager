import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment, loadAppConfig, saveAppConfig } from './config.js';
import { FileStore } from './storage.js';
import { GitHubClient } from './github.js';
import { LMStudioClient } from './lmstudio.js';
import { SyncService } from './sync.js';
import { CommitClassificationAgent } from './agents.js';
import { AsanaClient } from './asana.js';
import { AsanaStore } from './asana-storage.js';
import { AsanaSyncService } from './asana-sync.js';
import { PullRequestStore } from './pr-storage.js';
import { DailyReportService, ExecutiveReportService } from './reports.js';
import { LocalAuthenticator } from './auth.js';
import { InferenceQueue, QueuedLMStudioClient } from './inference-queue.js';
import { createKnowledgeTools } from './chat-tools.js';
import { createChatController } from './chat-controller.js';
import { createRequestHandler } from './request-handler.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = await loadEnvironment(root);
let appConfig = await loadAppConfig(environment);
const store = new FileStore(environment.dataDirectory);
const github = new GitHubClient(environment.githubToken, environment.githubCaCertFile);
const inferenceQueue = new InferenceQueue();
const lmStudio = new QueuedLMStudioClient(new LMStudioClient(environment.lmStudioBaseUrl), inferenceQueue);
const commitClassifier = new CommitClassificationAgent(lmStudio);
const sync = new SyncService({ environment, store, github, lmStudio, getConfig: () => appConfig });
const asanaStore = new AsanaStore(environment.dataDirectory);
const pullRequestStore = new PullRequestStore(environment.dataDirectory);
const executiveReports = new ExecutiveReportService({ store, asanaStore, pullRequestStore });
const dailyReports = new DailyReportService({ asanaStore, lmStudio });
const asana = new AsanaClient({ token: environment.asanaToken, workspaceId: environment.asanaWorkspaceId, caCertFile: environment.asanaCaCertFile, timeoutMs: environment.asanaTimeoutMs, maxRetries: environment.asanaMaxRetries, maxAttachmentBytes: environment.asanaMaxAttachmentBytes });
const asanaSync = new AsanaSyncService({ environment, store: asanaStore, asana, github, pullRequestStore, lmStudio, getConfig: () => appConfig });
const authenticator = new LocalAuthenticator({ username: environment.authUsername, password: environment.authPassword, secureCookie: environment.authCookieSecure, sessionHours: environment.authSessionHours });
const publicDirectory = path.join(root, 'public');

const knowledgeTools = createKnowledgeTools({ store, asanaStore, commitClassifier, getConfig: () => appConfig });
const handleChat = createChatController({ store, asanaStore, lmStudio, knowledgeTools, getConfig: () => appConfig });

const setConfig = async (nextConfig) => {
  appConfig = nextConfig;
  await saveAppConfig(environment, appConfig);
};
const handleRequest = createRequestHandler({
  environment, publicDirectory, authenticator, store, github, lmStudio, asana,
  asanaStore, sync, asanaSync, inferenceQueue, executiveReports, dailyReports,
  handleChat, getConfig: () => appConfig, setConfig
});
const server = http.createServer(handleRequest);

server.listen(environment.appPort, () => console.log(`AppManager disponible en http://localhost:${environment.appPort}`));
const scheduledSync = () => {
  sync.run().catch((error) => console.error('Error de sincronización GitHub programada:', error));
  if ((appConfig.asanaProjects ?? []).length) asanaSync.run().catch((error) => console.error('Error de sincronización Asana programada:', error));
};
let timer = setInterval(scheduledSync, appConfig.syncIntervalMinutes * 60_000);
setInterval(() => {
  const desired = appConfig.syncIntervalMinutes * 60_000;
  if (timer._idleTimeout !== desired) { clearInterval(timer); timer = setInterval(scheduledSync, desired); }
}, 10_000);
