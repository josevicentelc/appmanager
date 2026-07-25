const $ = (selector) => document.querySelector(selector);
let config;
async function api(path, options) { const response = await fetch(path, options); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Error inesperado'); return data; }
function message(text, error = false) { $('#formStatus').textContent = text; $('#formStatus').className = error ? 'error' : 'success'; }
function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
async function load() {
  config = await api('/api/config'); const [models, githubRepositories] = await Promise.all([api('/api/models'), api('/api/github-repositories')]);
  $('#importSince').value = config.importSince; $('#interval').value = config.syncIntervalMinutes; $('#language').value = config.language;
  $('#model').innerHTML = '<option value="">Selecciona un modelo</option>' + models.models.map((id) => `<option ${id === config.model ? 'selected' : ''} value="${id}">${id}</option>`).join('');
  $('#repositoryChoices').innerHTML = githubRepositories.repositories.map((repo) => `<label class="repository-choice"><input type="checkbox" value="${escapeHtml(repo.fullName)}" ${config.repositories.includes(repo.fullName) ? 'checked' : ''}><span><strong>${escapeHtml(repo.fullName)}</strong><small>${repo.private ? 'Privado' : 'Público'} · ${escapeHtml(repo.description || 'Sin descripción')}</small></span></label>`).join('') || '<p>No hay repositorios disponibles para este token.</p>';
  await refreshStatus();
}
async function refreshStatus() {
  const status = await api('/api/status'); const running = status.sync.running;
  $('#runStatus').textContent = running ? `Procesando ${status.sync.current?.repository ?? ''}…` : status.sync.lastRun ? `Última ejecución: ${new Date(status.sync.lastRun.completedAt).toLocaleString()}` : 'Todavía no se ha ejecutado ninguna sincronización.';
  const current = status.sync.current;
  const activityText = {
    checking_repository: 'GitHub: comprobando acceso al repositorio.',
    listing_commits: 'GitHub: consultando el historial de commits.',
    listing_tags: 'GitHub: consultando tags y versiones publicadas.',
    downloading_commit: 'GitHub: descargando metadatos y diff del commit.',
    digesting_commit: 'LM Studio: analizando el contexto y diff del commit.',
    saving_analysis: 'Almacenamiento local: guardando el análisis estructurado.',
    skipping_existing: 'Almacenamiento local: el commit ya estaba analizado; se omite.'
  };
  $('#syncActivity').textContent = current ? `${activityText[current.stage] || 'Sincronizando.'} ${current.position ? `(${current.position}/${current.total}) ` : ''}${current.sha ? `${current.sha.slice(0, 12)}${current.message ? ` — ${current.message}` : ''}` : ''}` : 'No hay ninguna sincronización activa.';
  $('#syncButton').disabled = running;
  $('#repositories').innerHTML = status.repositories.map((repo) => {
    const active = status.sync.current?.repository === repo.repository; const progress = repo.progress; const state = repo.state;
    const description = active ? ($('#syncActivity').textContent) : state.lastError || (state.lastCheckedAt ? `Comprobado: ${new Date(state.lastCheckedAt).toLocaleString()}` : 'Pendiente de primera sincronización');
    return `<article><strong>${escapeHtml(repo.repository)}</strong><span>${progress.completed}/${progress.total} analizados · ${progress.pending} pendientes · ${progress.analyzing} en análisis</span><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percentage}"><i style="width:${progress.percentage}%"></i></div><small>${progress.percentage}% · ${escapeHtml(description)}</small></article>`;
  }).join('');
}
$('#configForm').addEventListener('submit', async (event) => { event.preventDefault(); try { config = await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importSince: $('#importSince').value, model: $('#model').value, syncIntervalMinutes: Number($('#interval').value), language: $('#language').value, repositories: [...document.querySelectorAll('#repositoryChoices input:checked')].map((input) => input.value) }) }); message(`${config.repositories.length} repositorio(s) guardados.`); await refreshStatus(); } catch (error) { message(error.message, true); } });
$('#syncButton').addEventListener('click', async () => { try { const result = await api('/api/sync', { method: 'POST' }); message(`Sincronización terminada: ${result.repositories.reduce((total, repo) => total + repo.processed, 0)} commits procesados.`); await refreshStatus(); } catch (error) { message(error.message, true); } });
load().catch((error) => message(error.message, true)); setInterval(() => refreshStatus().catch(() => {}), 5000);
