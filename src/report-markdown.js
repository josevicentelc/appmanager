/** Escapes user and external text before inserting it into generated Markdown. */
const markdownText = (value) => String(value ?? '')
  .replace(/[\\`*_{}\[\]<>#+|]/g, '\\$&')
  .replace(/\r?\n/g, ' ')
  .trim();

const listValue = (value) => Array.isArray(value)
  ? value
  : typeof value === 'string' && value.trim() ? [value] : [];

function statusTransition(activity) {
  const text = String(activity.text ?? '');
  const match = text.match(/\bfrom\s+["“]([^"”]+)["”]\s+to\s+["“]([^"”]+)["”]/i);
  return match ? { from: match[1], to: match[2] } : { from: activity.from, to: activity.to };
}

function appendReadableTaskDetails(lines, task) {
  const analysis = task.analysis ?? {};
  const author = task.createdBy ?? task.task?.created_by?.name ?? null;
  if (author) lines.push(`Autor de la tarea: ${markdownText(author)}`, '');

  const description = analysis.briefDescription || analysis.objective || task.task?.notes;
  if (description) lines.push(`Resumen de la tarea: ${markdownText(description).slice(0, 900)}`, '');

  // A complete chain is reduced to its first and last stages for human readability.
  const transitions = task.activity
    .filter((activity) => activity.type === 'status_change')
    .map(statusTransition)
    .filter((transition) => transition.from || transition.to);
  const stages = [];
  for (const transition of transitions) {
    if (transition.from && stages.at(-1) !== transition.from) stages.push(transition.from);
    if (transition.to && stages.at(-1) !== transition.to) stages.push(transition.to);
  }
  if (stages.length === 1) lines.push(`Estado durante el período: ${markdownText(stages[0])}`, '');
  if (stages.length > 1) lines.push(`Avance durante el período: ${markdownText(stages[0])} → ${markdownText(stages.at(-1))}`, '');

  if (analysis.objective && analysis.objective !== description) lines.push(`Objetivo: ${markdownText(analysis.objective).slice(0, 600)}`, '');
  if (analysis.statusSummary) lines.push(`Estado actual: ${markdownText(analysis.statusSummary).slice(0, 500)}`, '');
  const workPerformed = listValue(analysis.workPerformed);
  if (workPerformed.length) lines.push(`Trabajo registrado: ${workPerformed.slice(0, 6).map(markdownText).join('; ')}`, '');

  const comments = task.activity.filter((activity) => activity.type === 'comment' && activity.text);
  if (comments.length) {
    lines.push('Comentarios de Asana:');
    for (const comment of comments.slice(0, 8)) lines.push(`    ${comment.author ? `${markdownText(comment.author)}: ` : ''}${markdownText(comment.text)}`);
    lines.push('');
  }
}

export function executiveReportMarkdown(report) {
  const lines = ['# Informe ejecutivo', '', `Período: ${report.period.from} a ${report.period.to}`, '', '## Cobertura', '', `Commits encontrados: ${report.coverage.commits}`, `Tareas de Asana con actividad: ${report.coverage.activeAsanaTasks}`, `Pull requests cacheados: ${report.coverage.cachedPullRequests}`, `Asociaciones verificadas Asana/commit: ${report.coverage.pairedCommits}`, '', '## Actividad cronológica', ''];
  if (!report.entries.length) lines.push('No hay actividad local sincronizada para el período indicado.');
  for (const entry of report.entries) {
    const date = String(entry.date ?? '').slice(0, 10) || 'Sin fecha';
    if (entry.type === 'asana_commit') {
      lines.push(`### ${date} — ${markdownText(entry.task.task.name)}`);
      appendReadableTaskDetails(lines, entry.task);
      lines.push(`Commit asociado: ${markdownText(entry.commit.repository)}@${entry.commit.sha.slice(0, 12)}`, `Autor del commit: ${markdownText(entry.commit.author.name || entry.commit.author.login || 'No disponible')}`, `Pull request: #${entry.pullRequest.number}${entry.pullRequest.pullRequest?.title ? ` — ${markdownText(entry.pullRequest.pullRequest.title)}` : ''}`, `Descripción del commit: ${markdownText(entry.commit.originalMessage || entry.commit.briefDescription)}`);
    } else if (entry.type === 'commit') {
      lines.push(`### ${date} — ${markdownText(entry.commit.repository)}@${entry.commit.sha.slice(0, 12)}`, `Autor del commit: ${markdownText(entry.commit.author.name || entry.commit.author.login || 'No disponible')}`, `Descripción del commit: ${markdownText(entry.commit.originalMessage || entry.commit.briefDescription)}`, 'No se encontró una tarea de Asana relacionada en la caché local de pull requests.');
    } else {
      lines.push(`### ${date} — ${markdownText(entry.task.task.name)}`);
      appendReadableTaskDetails(lines, entry.task);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function dailyReportMarkdown(report) {
  const lines = ['# Informe diario', '', `Período: ${report.period.from} a ${report.period.to}`, `Usuario: ${markdownText(report.author)}`, '', '## Cobertura', '', `Tareas con actividad: ${report.coverage.tasksWithActivity}`, `Informes generados: ${report.coverage.generated}`, `Informes no generados: ${report.coverage.failed}`, '', '## Actividad por tarea', ''];
  if (!report.entries.length) lines.push('No se encontró actividad de este usuario en tareas de Asana durante el período.');
  for (const entry of report.entries) {
    const title = entry.task?.name || entry.analysis?.task?.name || entry.taskGid;
    const asanaUrl = entry.task?.permalink_url || entry.analysis?.task?.permalinkUrl || '';
    const description = entry.analysis?.briefDescription || entry.analysis?.objective || entry.task?.notes || 'No hay una descripción disponible.';
    lines.push(`### ${markdownText(title)}`, '', `Enlace de Asana: ${asanaUrl || 'No disponible'}`, '', `Descripción: ${markdownText(description).slice(0, 900)}`, '');
    if (entry.error) lines.push(`No se pudo generar el análisis de esta tarea: ${markdownText(entry.error)}`);
    else {
      const details = [entry.report.summary, entry.report.outcome].filter(Boolean).map(markdownText).join(' ');
      lines.push(`Resumen del trabajo realizado: ${details || 'No se generó un resumen.'}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
