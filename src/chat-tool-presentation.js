/** Formats bounded debug payloads and human-readable tool progress messages. */
export function createToolPresentation(toolArguments) {
  function debugValue(value, depth = 0, key = '') {
    if (typeof value === 'string') {
      const limit = key === 'llmOutput' || key === 'llmReasoning' ? 8_000 : 500;
      return value.length > limit ? `${value.slice(0, limit)}…` : value;
    }
    if (value === null || typeof value !== 'object') return value;
    if (depth > 4) return '[depth limited]';
    if (Array.isArray(value)) return value.slice(0, 12).map((item) => debugValue(item, depth + 1, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 20).map(([entryKey, item]) => [entryKey, debugValue(item, depth + 1, entryKey)]));
    return null;
  }
  
  function summarizeToolResult(name, result) {
    if (result?.error) return { error: result.error };
    if (name === 'get_knowledge') return { returned: result.returned, totalCommitMatches: result.totalCommitMatches, results: (result.results ?? []).map((item) => ({ kind: item.kind, source: item.source, id: item.sha ?? item.taskGid, date: item.date, title: item.title })) };
    if (name === 'search_commit_knowledge') return {
      resultCount: result.results?.length ?? 0, totalMatches: result.totalMatches, offset: result.offset,
      hasMore: result.hasMore, nextOffset: result.nextOffset,
      matches: (result.results ?? []).map((item) => ({ source: item.source, commitDate: item.commitDate, tags: item.tags })), note: result.note
    };
    if (name === 'list_commit_authors') return { matchedCommits: result.matchedCommits, authorCount: result.authors?.length ?? 0, authors: result.authors };
    if (name === 'search_commits_by_author') return { resultCount: result.results?.length ?? 0, results: (result.results ?? []).map((item) => ({ source: item.source, commitDate: item.commitDate, message: item.originalMessage, summary: item.changeSummary })) };
    if (name === 'get_commit_knowledge') return { found: Boolean(result.analysis), source: result.analysis ? `${result.analysis.repository}@${result.analysis.sha}` : null };
    if (name === 'delegate_commit_classification') return {
      coverage: result.coverage,
      relevantCount: result.relevant?.length ?? 0,
      relevant: (result.relevant ?? []).map((item) => ({ source: `${item.repository}@${item.sha}`, category: item.category, confidence: item.confidence })),
      excludedCount: result.excluded?.length ?? 0
    };
    if (name === 'search_diff_hunks') return {
      resultCount: result.results?.length ?? 0, sources: (result.results ?? []).map((item) => item.source),
      searchedCommits: result.searchedCommits, scopeTruncated: result.scopeTruncated,
      topHunk: result.topHunk ? { source: result.topHunk.source, lines: result.topHunk.totalLines, characters: result.topHunk.content?.length ?? 0, truncated: result.topHunk.truncated, nextStartLine: result.topHunk.nextStartLine } : null
    };
    if (name === 'read_diff_hunk' || name === 'read_file_at_commit') return { source: result.source, startLine: result.startLine, endLine: result.endLine, totalLines: result.totalLines, characters: result.content?.length ?? 0, truncated: result.truncated, nextStartLine: result.nextStartLine };
    if (name === 'search_asana_tasks') return { resultCount: result.results?.length ?? 0, results: (result.results ?? []).map((item) => ({ source: item.source, task: item.task?.name, completed: item.task?.completed, project: item.project?.name, tags: item.tags })) };
    if (name === 'get_asana_task_knowledge') return { source: result.source, found: Boolean(result.analysis), task: result.analysis?.task?.name, stories: result.raw?.stories?.length ?? 0, attachments: result.raw?.attachments?.length ?? 0 };
    if (name === 'show_asana_attachment') return result.attachment ? { attachment: { name: result.attachment.name, contentType: result.attachment.contentType, inline: result.attachment.inline } } : result;
    return debugValue(result);
  }
  
  function toolActivityMessage(name, completed = false) {
    const messages = {
      get_knowledge: ['Consultando el índice de conocimiento…', 'Consulta del índice de conocimiento completada.'],
      search_commit_knowledge: ['Buscando en el conocimiento de los commits…', 'Búsqueda de commits completada.'],
      list_commit_authors: ['Consultando los autores de los commits…', 'Consulta de autores completada.'],
      search_commits_by_author: ['Buscando commits del autor indicado…', 'Búsqueda de commits del autor completada.'],
      get_commit_knowledge: ['Leyendo el análisis completo del commit…', 'Análisis del commit recuperado.'],
      search_diff_hunks: ['Buscando en los diffs del código…', 'Búsqueda en diffs completada.'],
      read_diff_hunk: ['Leyendo un fragmento del diff…', 'Fragmento del diff recuperado.'],
      read_file_at_commit: ['Leyendo el archivo en el commit…', 'Contenido del archivo recuperado.'],
      search_asana_tasks: ['Buscando en las tareas de Asana…', 'Búsqueda de tareas de Asana completada.'],
      get_asana_task_knowledge: ['Leyendo los detalles y adjuntos de la tarea de Asana…', 'Detalles de la tarea de Asana recuperados.'],
      show_asana_attachment: ['Preparando el adjunto de Asana…', 'Adjunto de Asana mostrado en el chat.'],
      delegate_commit_classification: ['Delegando la clasificación de los commits…', 'Clasificación de commits completada.']
    };
    return messages[name]?.[completed ? 1 : 0] ?? `${completed ? 'Herramienta completada' : 'Ejecutando herramienta'}: ${name}.`;
  }
  
  function detailedToolActivityMessage(name, rawArguments, completed = false) {
    if (completed) return toolActivityMessage(name, true);
    const input = toolArguments(rawArguments);
    const concise = (value, maximum = 80) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maximum);
    const scope = () => {
      const filters = [];
      if (input.repository) filters.push(`repositorio ${concise(input.repository)}`);
      if (input.projectGid) filters.push(`proyecto ${concise(input.projectGid)}`);
      if (input.from || input.to) filters.push(`fecha ${input.from || 'inicio'} a ${input.to || 'hoy'}`);
      return filters.length ? ` (${filters.join(', ')})` : '';
    };
    const query = concise(input.query);
    const querySuffix = query ? ` para «${query}»` : '';
    const messages = {
      get_knowledge: `Consultando el conocimiento local${querySuffix}${scope()}…`,
      search_commit_knowledge: `Buscando commits${querySuffix}${scope()}${input.tags?.length ? `, etiquetas: ${input.tags.map((tag) => concise(tag, 30)).join(', ')}` : ''}…`,
      list_commit_authors: `Consultando autores de commits${scope()}…`,
      search_commits_by_author: `Buscando commits de ${concise(input.author) || 'un autor'}${scope()}…`,
      get_commit_knowledge: `Leyendo el análisis del commit ${concise(input.sha, 12)}${input.repository ? ` en ${concise(input.repository)}` : ''}…`,
      search_diff_hunks: `Buscando en los diffs${querySuffix}${input.path ? `, archivo ${concise(input.path)}` : ''}${scope()}…`,
      read_diff_hunk: `Leyendo el hunk ${concise(input.hunkId)} de ${concise(input.path)}…`,
      read_file_at_commit: `Leyendo ${concise(input.path)} (líneas ${input.startLine || 1}–${input.endLine || '?'})…`,
      search_asana_tasks: `Buscando en las tareas de Asana${querySuffix}${scope()}${typeof input.completed === 'boolean' ? input.completed ? ', solo completadas' : ', solo pendientes' : ''}…`,
      get_asana_task_knowledge: `Leyendo los detalles de la tarea de Asana ${concise(input.taskGid)}…`,
      show_asana_attachment: `Preparando el adjunto «${concise(input.attachmentName)}» de Asana…`,
      delegate_commit_classification: `Clasificando ${Array.isArray(input.commits) ? input.commits.length : 'los'} commits por tema…`
    };
    return messages[name] ?? toolActivityMessage(name);
  }
  
  
  return { debugValue, summarizeToolResult, detailedToolActivityMessage };
}

