import { initializeReports } from './reports-ui.js';
import { createApiClient } from './client-api.js';

const $ = (selector) => document.querySelector(selector);
let config;
let conversation = [];
let chatBusy = false;
let debugEvents = [];
let currentAgentActivity = null;
let currentThinking = '';

const { api, streamChat } = createApiClient(() => showLogin());

function message(text, error = false) {
  $('#formStatus').textContent = text;
  $('#formStatus').className = error ? 'error' : 'success';
}

function escapeHtml(value) {
  const node = document.createElement('span');
  node.textContent = value;
  return node.innerHTML;
}

function formatAssistantMessage(value) {
  const localAttachmentUrl = (url) => url
    .replace(/https:\/\/storage\.googleapis\.com\/asana-attachments\/\d{1,30}\/(\d{1,30})(?:[?#][^\s)]*)?/g, '/api/asana/attachments/by-id/$1')
    .replace(/https:\/\/app\.asana\.com\/api\/attachments\/\d{1,30}\/\d{1,30}\/(\d{1,30})(?:[?#][^\s)]*)?/g, '/api/asana/attachments/by-id/$1');
  const asanaTaskLinks = (text) => text.replace(/\[asana:(\d{1,30})@(\d{1,30})\]/g, (_match, projectGid, taskGid) => `<a class="asana-task-link" href="https://app.asana.com/0/${projectGid}/${taskGid}" target="_blank" rel="noopener noreferrer">[asana:${projectGid}@${taskGid}]</a>`);
  const inline = (text) => asanaTaskLinks(escapeHtml(localAttachmentUrl(text))).replace(/!\[([^\]]*)\]\((\/api\/asana\/attachments\/(?:by-id\/)?\d{1,30}(?:\/\d{1,30}\/\d{1,30})?)\)/g, '<img class="asana-attachment-image" src="$2" alt="$1" loading="lazy">').replace(/\[([^\]]+)\]\((\/api\/asana\/attachments\/(?:by-id\/)?\d{1,30}(?:\/\d{1,30}\/\d{1,30})?)\)/g, '<a class="asana-attachment-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`\n]+)`/g, '<code>$1</code>');
  return value.split('```').map((segment, index) => {
    if (index % 2) return `<pre><code>${escapeHtml(segment.replace(/^[\w+-]+\r?\n/, ''))}</code></pre>`;
    const output = [];
    let list = null;
    const closeList = () => { if (list) { output.push(`</${list}>`); list = null; } };
    for (const line of segment.split(/\r?\n/)) {
      const bullet = line.match(/^\s*[-*]\s+(.+)/);
      const numbered = line.match(/^\s*\d+\.\s+(.+)/);
      if (bullet || numbered) {
        const desired = bullet ? 'ul' : 'ol';
        if (list !== desired) { closeList(); list = desired; output.push(`<${list}>`); }
        output.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      } else {
        closeList();
        const heading = line.match(/^\s*#{1,3}\s+(.+)/);
        if (heading) output.push(`<h3>${inline(heading[1])}</h3>`);
        else if (line.trim()) output.push(`<p>${inline(line)}</p>`);
      }
    }
    closeList();
    return output.join('');
  }).join('');
}

function formatAttachment(attachment) {
  if (!attachment?.chatUrl || !attachment?.name) return '';
  const name = escapeHtml(attachment.name);
  const url = escapeHtml(attachment.chatUrl);
  const downloadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg>';
  return attachment.inline ? `<figure class="attachment-preview"><img class="asana-attachment-image" src="${url}" alt="${name}" loading="lazy"><a class="attachment-download" href="${url}" download title="Descargar ${name}" aria-label="Descargar ${name}">${downloadIcon}</a></figure>` : `<a class="asana-attachment-link" href="${url}" download>Descargar ${name}</a>`;
}

const debugStageLabels = {
  request: 'Petición', initial_context: 'Contexto inicial', planning_started: 'Planificación iniciada',
  planning_completed: 'Decisión del LLM', planning_stopped: 'Planificación detenida',
  tool_started: 'Herramienta iniciada', tool_completed: 'Herramienta completada',
  agent_activity: 'Actividad de agente',
  final_generation_started: 'Respuesta final iniciada', final_generation_completed: 'Respuesta final completada',
  server_error: 'Error del servidor', client_error: 'Error'
};

function renderDebug() {
  const panel = $('#debugPanel');
  panel.hidden = !$('#debugMode').checked;
  const toolCalls = debugEvents.filter((item) => item.stage === 'tool_completed').length;
  const rounds = debugEvents.filter((item) => item.stage === 'planning_completed').length;
  $('#debugSummary').textContent = debugEvents.length ? `${rounds} ronda(s) · ${toolCalls} herramienta(s)` : 'Esperando consulta…';
  $('#debugTrace').innerHTML = debugEvents.map((item) => {
    const details = { ...item };
    delete details.requestId; delete details.timestamp; delete details.stage;
    const time = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '';
    const error = item.stage === 'client_error' || item.stage === 'server_error' || details.result?.error;
    return `<article class="debug-entry ${escapeHtml(item.stage || '')}${error ? ' error' : ''}"><header><time>${escapeHtml(time)}</time><strong>${escapeHtml(debugStageLabels[item.stage] || item.stage)}</strong></header>${Object.keys(details).length ? `<pre>${escapeHtml(JSON.stringify(details, null, 2))}</pre>` : ''}</article>`;
  }).join('');
  panel.scrollTop = panel.scrollHeight;
}

function showAgentActivity(value) {
  currentAgentActivity = value;
  $('#agentActivity').hidden = true;
  renderMessages();
}

const assistantIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9h8M8 13h5m-7 7 3.2-3H18a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3v3Z"/></svg>';
const userIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>';

function emptyChatHtml() {
  return `<div class="empty-chat"><div class="empty-orb">${assistantIcon}</div><h2>Tu código tiene una historia.<br>Pregúntale.</h2><p>Explora decisiones técnicas, cambios recientes y riesgos usando el conocimiento de tus repositorios.</p><div class="suggestions"><button class="suggestion" data-prompt="Resume los cambios más importantes de los últimos commits"><span>Resumen</span>¿Qué ha cambiado recientemente?</button><button class="suggestion" data-prompt="¿Qué riesgos técnicos o tareas pendientes detectas?"><span>Riesgos</span>Detecta posibles problemas</button><button class="suggestion" data-prompt="Explica la evolución técnica reciente de los repositorios"><span>Evolución</span>Comprende las decisiones</button></div></div>`;
}

function renderMessages() {
  const messages = $('#messages');
  if (!conversation.length) {
    messages.innerHTML = emptyChatHtml();
    return;
  }
  messages.innerHTML = conversation.map((item, index) => {
    const waiting = item.role === 'assistant' && !item.content && chatBusy;
    const streaming = item.role === 'assistant' && chatBusy && index === conversation.length - 1 && item.content;
    const content = waiting ? '<span class="typing" aria-label="AppManager está escribiendo"><i></i><i></i><i></i></span>' : item.role === 'assistant' ? formatAssistantMessage(item.content) : escapeHtml(item.content);
    const mode = item.role === 'assistant' ? ($('#chatMode').value === 'executive' ? 'Ejecutivo' : 'Developer') : '';
    const isActiveAssistant = item.role === 'assistant' && chatBusy && index === conversation.length - 1;
    const activity = isActiveAssistant && currentAgentActivity ? `<div class="message-activity${currentAgentActivity.stage === 'client_error' || currentAgentActivity.stage === 'server_error' ? ' error' : ''}"><i></i><span>${escapeHtml(currentAgentActivity.message || currentAgentActivity.stage)}</span></div>` : '';
    const thinking = isActiveAssistant && currentThinking ? `<div class="thinking-bubble" aria-live="polite"><div class="thinking-label"><i></i><span>Razonando</span></div><p>${escapeHtml(currentThinking)}</p></div>` : '';
    const attachments = item.role === 'assistant' ? (item.attachments ?? []).map(formatAttachment).join('') : '';
    return `<div class="message-row ${item.role}${streaming ? ' streaming' : ''}"><div class="avatar">${item.role === 'user' ? userIcon : assistantIcon}</div><div class="message-content"><div class="message-meta">${item.role === 'user' ? 'Tú' : 'AppManager'}<span>${mode}</span></div><div class="message-body">${thinking}${content}${attachments}${activity}</div></div></div>`;
  }).join('');
  messages.scrollTop = messages.scrollHeight;
}

function setChatBusy(busy) {
  chatBusy = busy;
  $('#messages').setAttribute('aria-busy', String(busy));
  $('#sendButton').disabled = busy;
  $('#chatQuestion').disabled = busy;
  $('#sendButton').setAttribute('aria-label', busy ? 'Generando respuesta' : 'Enviar mensaje');
}

async function load() {
  config = await api('/api/config');
  const [models, githubRepositories, asanaProjects, asanaReportUsers] = await Promise.all([api('/api/models'), api('/api/github-repositories'), api('/api/asana-projects'), api('/api/asana-report-users')]);
  $('#importSince').value = config.importSince;
  $('#asanaImportSince').value = config.asanaImportSince;
  $('#interval').value = config.syncIntervalMinutes;
  $('#language').value = config.language;
  $('#model').innerHTML = '<option value="">Selecciona un modelo</option>' + models.models.map((id) => `<option ${id === config.model ? 'selected' : ''} value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('');
  $('#repositoryChoices').innerHTML = githubRepositories.repositories.map((repo) => `<article class="repository-context"><label class="repository-choice"><input type="checkbox" value="${escapeHtml(repo.fullName)}" ${config.repositories.includes(repo.fullName) ? 'checked' : ''}><span><strong>${escapeHtml(repo.fullName)}</strong><small>${repo.private ? 'Privado' : 'Público'} · ${escapeHtml(repo.description || 'Sin descripción')}</small></span></label><label class="repository-note-label">Contexto para el LLM<textarea data-repository-note="${escapeHtml(repo.fullName)}" maxlength="6000" placeholder="Arquitectura, propósito, dominio, convenciones o terminología…">${escapeHtml(config.repositoryNotes?.[repo.fullName] || '')}</textarea></label></article>`).join('') || '<p>No hay repositorios disponibles para este token.</p>';
  $('#asanaConfigHint').textContent = asanaProjects.configured ? 'Selecciona los proyectos cuyas tareas, comentarios, cambios de estado y adjuntos se conservarán localmente.' : 'Configura ASANA_TOKEN y ASANA_WORKSPACE_ID en .env y reinicia la aplicación para activar Asana.';
  $('#asanaProjectChoices').innerHTML = asanaProjects.projects.map((project) => `<label class="repository-choice"><input type="checkbox" value="${escapeHtml(project.gid)}" ${config.asanaProjects.includes(project.gid) ? 'checked' : ''}><span><strong>${escapeHtml(project.name)}</strong><small>${project.archived ? 'Archivado' : 'Activo'} · ${escapeHtml(project.gid)}</small></span></label>`).join('') || (asanaProjects.configured ? '<p>No hay proyectos disponibles para este token de Asana.</p>' : '');
  $('#dailyReportUser').innerHTML = '<option value="">Selecciona un usuario</option>' + asanaReportUsers.users.map((user) => `<option value="${escapeHtml(user)}">${escapeHtml(user)}</option>`).join('');
  $('#dailyReportUser').disabled = !asanaReportUsers.users.length;
  $('#reportInstructions').value = config.reportInstructions || '';
  $('#chatContext').textContent = config.repositories.length ? `${config.repositories.length} repositorio(s) seleccionado(s) como fuente de conocimiento.` : 'Selecciona y sincroniza repositorios en Configuración para alimentar el chat.';
  await refreshStatus();
}

async function refreshStatus() {
  const status = await api('/api/status');
  const running = status.sync.running;
  const asanaRunning = status.asana?.running;
  $('#runStatus').textContent = running ? `Procesando ${status.sync.current?.repository ?? ''}…` : status.sync.lastRun ? `Última ejecución: ${new Date(status.sync.lastRun.completedAt).toLocaleString()}` : 'Todavía no se ha ejecutado ninguna sincronización.';
  const current = status.sync.current;
  const activityText = { checking_repository: 'GitHub: comprobando acceso al repositorio.', listing_commits: 'GitHub: consultando el historial de commits.', listing_tags: 'GitHub: consultando tags y versiones publicadas.', downloading_commit: 'GitHub: descargando metadatos y diff del commit.', digesting_commit: 'LM Studio: analizando el contexto y diff del commit.', saving_analysis: 'Almacenamiento local: guardando el análisis estructurado.', skipping_existing: 'Almacenamiento local: el commit ya estaba analizado; se omite.' };
  const queueStatus = status.inferenceQueue?.active ? ` LM Studio: ${status.inferenceQueue.active}${status.inferenceQueue.pending ? ` · ${status.inferenceQueue.pending} en cola` : ''}.` : '';
  $('#syncActivity').textContent = (current ? `${activityText[current.stage] || 'Sincronizando.'} ${current.position ? `(${current.position}/${current.total}) ` : ''}${current.sha ? `${current.sha.slice(0, 12)}${current.message ? ` — ${current.message}` : ''}` : ''}` : 'No hay ninguna sincronización activa.') + queueStatus;
  $('#syncButton').disabled = running;
  $('#asanaSyncButton').disabled = !status.asana?.configured || asanaRunning || !config.asanaProjects.length;
  $('#repositories').innerHTML = status.repositories.map((repo) => {
    const active = status.sync.current?.repository === repo.repository;
    const { progress, state } = repo;
    const description = active ? $('#syncActivity').textContent : state.lastError || (state.lastCheckedAt ? `Comprobado: ${new Date(state.lastCheckedAt).toLocaleString()}` : 'Pendiente de primera sincronización');
    return `<article><strong>${escapeHtml(repo.repository)}</strong><span>${progress.completed}/${progress.total} analizados · ${progress.pending} pendientes · ${progress.analyzing} en análisis</span><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percentage}"><i style="width:${progress.percentage}%"></i></div><small>${progress.percentage}% · ${escapeHtml(description)}</small></article>`;
  }).join('');
  const asanaActivity = { listing_tasks: 'Asana: obteniendo tareas del proyecto.', downloading_task: 'Asana: descargando tarea, comentarios y adjuntos.', digesting_task: 'LM Studio: digiriendo la tarea de Asana.', saving_analysis: 'Almacenamiento local: guardando el conocimiento de Asana.', skipping_existing: 'Almacenamiento local: la tarea no ha cambiado; se omite.' };
  asanaActivity.syncing_pull_requests = 'GitHub: actualizando la caché local de pull requests.';
  const asanaCurrent = status.asana?.current;
  $('#repositories').innerHTML += (status.asanaProjects ?? []).map(({ projectGid, state }) => `<article><strong>Asana · ${escapeHtml(projectGid)}</strong><span>${escapeHtml(state.sync?.state || 'pendiente')}</span><small>${escapeHtml(asanaCurrent?.projectGid === projectGid ? `${asanaActivity[asanaCurrent.stage] || 'Sincronizando.'} (${asanaCurrent.position || 0}/${asanaCurrent.total || 0})` : state.lastError || (state.lastSyncedAt ? `Sincronizado: ${new Date(state.lastSyncedAt).toLocaleString()}` : 'Pendiente de primera sincronización'))}</small></article>`).join('');
}

function showPanel(tabName) {
  $('#chatPanel').hidden = tabName !== 'chat';
  $('#reportsPanel').hidden = tabName !== 'reports';
  $('#settingsPanel').hidden = tabName !== 'settings';
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tabName));
}

document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => showPanel(tab.dataset.tab)));

initializeReports({ $, api, getConfig: () => config, setConfig: (nextConfig) => { config = nextConfig; } });

$('#newChatButton').addEventListener('click', () => { conversation = []; debugEvents = []; currentAgentActivity = null; $('#agentActivity').hidden = true; renderMessages(); renderDebug(); $('#chatQuestion').focus(); });

$('#debugMode').addEventListener('change', (event) => {
  localStorage.setItem('appmanager.debug', String(event.currentTarget.checked));
  renderDebug();
});

$('#messages').addEventListener('click', (event) => {
  const suggestion = event.target.closest('.suggestion');
  if (!suggestion) return;
  $('#chatQuestion').value = suggestion.dataset.prompt;
  $('#chatQuestion').dispatchEvent(new Event('input'));
  $('#chatQuestion').focus();
});

$('#chatQuestion').addEventListener('input', (event) => {
  event.target.style.height = 'auto';
  event.target.style.height = `${Math.min(event.target.scrollHeight, 128)}px`;
});

$('#chatQuestion').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (!chatBusy && event.currentTarget.value.trim()) $('#chatForm').requestSubmit();
  }
});

$('#chatForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = $('#chatQuestion').value.trim();
  if (!question) return;
  const history = conversation.slice();
  conversation.push({ role: 'user', content: question });
  $('#chatQuestion').value = '';
  $('#chatQuestion').style.height = 'auto';
  setChatBusy(true);
  conversation.push({ role: 'assistant', content: '', attachments: [] });
  debugEvents = [];
  currentThinking = '';
  renderMessages();
  renderDebug();
  showAgentActivity({ stage: 'started', message: 'Preparando la consulta…' });
  try {
    await streamChat({ question, history, mode: $('#chatMode').value, debug: $('#debugMode').checked }, { onDelta: (text) => {
      currentThinking = '';
      conversation[conversation.length - 1].content += text;
      renderMessages();
    }, onDebug: (entry) => {
      debugEvents.push(entry);
      renderDebug();
    }, onActivity: (activity) => {
      showAgentActivity(activity);
    }, onThinking: (thinking) => {
      currentThinking += thinking.text || '';
      renderMessages();
    }, onAttachment: (attachment) => {
      if (!attachment?.chatUrl) return;
      const attachments = conversation[conversation.length - 1].attachments;
      if (!attachments.some((item) => item.chatUrl === attachment.chatUrl)) attachments.push(attachment);
      renderMessages();
    } });
  } catch (error) {
    conversation[conversation.length - 1].content = `No he podido responder: ${error.message}`;
    if ($('#debugMode').checked) {
      debugEvents.push({ timestamp: new Date().toISOString(), stage: 'client_error', error: error.message });
      renderDebug();
    }
    showAgentActivity({ stage: 'client_error', message: error.message });
  } finally {
    setChatBusy(false);
    currentAgentActivity = null;
    currentThinking = '';
    renderMessages();
    $('#chatQuestion').focus();
  }
});

$('#configForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    config = await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importSince: $('#importSince').value, asanaImportSince: $('#asanaImportSince').value, model: $('#model').value, syncIntervalMinutes: Number($('#interval').value), language: $('#language').value, repositories: [...document.querySelectorAll('#repositoryChoices input:checked')].map((input) => input.value), repositoryNotes: Object.fromEntries([...document.querySelectorAll('[data-repository-note]')].map((input) => [input.dataset.repositoryNote, input.value])), asanaProjects: [...document.querySelectorAll('#asanaProjectChoices input:checked')].map((input) => input.value) }) });
    message(`${config.repositories.length} repositorio(s) y ${config.asanaProjects.length} proyecto(s) de Asana guardados.`);
    $('#chatContext').textContent = config.repositories.length ? `${config.repositories.length} repositorio(s) seleccionado(s) como fuente de conocimiento.` : 'Selecciona y sincroniza repositorios en Configuración para alimentar el chat.';
    await refreshStatus();
  } catch (error) { message(error.message, true); }
});

$('#syncButton').addEventListener('click', async () => {
  try {
    const result = await api('/api/sync', { method: 'POST' });
    message(`Sincronización terminada: ${result.repositories.reduce((total, repo) => total + repo.processed, 0)} commits procesados.`);
    await refreshStatus();
  } catch (error) { message(error.message, true); }
});

$('#asanaSyncButton').addEventListener('click', async () => {
  try {
    const result = await api('/api/asana/sync', { method: 'POST' });
    const processed = result.projects.reduce((total, project) => total + project.processed, 0);
    message(`Sincronización de Asana terminada: ${processed} tarea(s) procesada(s).`);
    await refreshStatus();
  } catch (error) { message(error.message, true); }
});

function showLogin() {
  $('#appShell').hidden = true; $('#loginScreen').hidden = false;
  $('#loginPassword').value = ''; $('#loginUsername').focus();
}

let statusTimer;
async function startAuthenticated() {
  $('#loginScreen').hidden = true; $('#appShell').hidden = false;
  $('#debugMode').checked = localStorage.getItem('appmanager.debug') === 'true';
  renderMessages(); renderDebug();
  await load();
  clearInterval(statusTimer); statusTimer = setInterval(() => refreshStatus().catch(() => {}), 5000);
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#loginStatus').textContent = '';
  try {
    await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#loginUsername').value, password: $('#loginPassword').value }) });
    await startAuthenticated();
  } catch (error) { $('#loginStatus').textContent = error.message; }
});

$('#logoutButton').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  clearInterval(statusTimer); conversation = []; debugEvents = []; showLogin();
});

api('/api/auth/session').then((session) => session.authenticated ? startAuthenticated() : showLogin()).catch(showLogin);
