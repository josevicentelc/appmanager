import { randomUUID } from 'node:crypto';
import { paginateText } from './diff.js';
import { CHAT_TOOLS } from './chat-tool-definitions.js';
import { createToolPresentation } from './chat-tool-presentation.js';

/**
 * Owns the complete tool boundary exposed to the chat director.
 *
 * The factory keeps infrastructure dependencies explicit and makes authorization
 * checks use the latest persisted configuration through getConfig().
 */
export function createKnowledgeTools({ store, asanaStore, commitClassifier, getConfig }) {
  const inlineImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
  function toolArguments(value) { try { const parsed = JSON.parse(value ?? '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
  function xmlToolCalls(content) {
    const calls = [];
    const blocks = String(content ?? '').matchAll(/<function=([A-Za-z0-9_]+)>\s*([\s\S]*?)<\/function>/g);
    for (const block of blocks) {
      const parameters = {};
      for (const parameter of block[2].matchAll(/<parameter=([A-Za-z0-9_]+)>\s*([\s\S]*?)<\/parameter>/g)) {
        const value = parameter[2].trim();
        parameters[parameter[1]] = value === 'true' ? true : value === 'false' ? false : /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
      }
      calls.push({ id: `xml_${randomUUID()}`, type: 'function', function: { name: block[1], arguments: JSON.stringify(parameters) } });
    }
    return calls;
  }
  const validSha = (value) => /^[0-9a-f]{7,64}$/i.test(String(value ?? ''));
  const validAsanaGid = (value) => /^\d{1,30}$/.test(String(value ?? ''));
  const validPath = (value) => {
    const candidate = String(value ?? '');
    return candidate.length > 0 && candidate.length <= 500 && !candidate.includes('\0') && !candidate.includes('\\') && !candidate.startsWith('/') && !candidate.split('/').some((part) => !part || part === '.' || part === '..');
  };
  const selectedAsanaProject = (projectGid) => (getConfig().asanaProjects ?? []).includes(String(projectGid));
  async function runKnowledgeTool(call, repositories, onActivity = () => {}) {
    const input = toolArguments(call.function?.arguments);
    if (input.task_gid && !input.taskGid) input.taskGid = input.task_gid;
    if (input.project_gid && !input.projectGid) input.projectGid = input.project_gid;
    if (input.repository_name && !input.repository) input.repository = input.repository_name;
    if (call.function?.name === 'get_knowledge') {
      const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : '';
      const query = String(input.query ?? '').trim().slice(0, 300);
      const kinds = new Set((Array.isArray(input.kinds) ? input.kinds : []).filter((kind) => kind === 'commit' || kind === 'asana_task' || kind === 'asana_activity'));
      const includeCommits = !kinds.size || kinds.has('commit');
      const includeTasks = !kinds.size || kinds.has('asana_task');
      const includeAsanaActivity = !kinds.size || kinds.has('asana_activity');
      const repository = repositories.includes(input.repository) ? input.repository : '';
      const projectGid = input.projectGid && selectedAsanaProject(input.projectGid) ? String(input.projectGid) : '';
      if (input.repository && !repository) return { error: 'Requested repository is not selected.' };
      if (input.projectGid && !projectGid) return { error: 'Requested Asana project is not selected.' };
      const limit = Math.max(1, Math.min(Number(input.limit) || 20, 50));
      const [commitPage, taskMatches, activityMatches] = await Promise.all([
        includeCommits ? store.searchAnalysesPage(repositories, { query, repository, from: date(input.from), to: date(input.to), limit }) : Promise.resolve({ results: [], totalMatches: 0 }),
        includeTasks ? asanaStore.searchAnalyses(getConfig().asanaProjects ?? [], { query, projectGid, createdSince: date(input.from) || getConfig().asanaImportSince, createdUntil: date(input.to), limit }) : Promise.resolve([]),
        includeAsanaActivity ? asanaStore.searchStoryActivity(getConfig().asanaProjects ?? [], { query, projectGid, from: date(input.from), to: date(input.to), limit }) : Promise.resolve([])
      ]);
      const results = [
        ...commitPage.results.map((item) => ({ kind: 'commit', source: item.source, repository: item.repository, sha: item.sha, date: item.commitDate, description: item.briefDescription || item.changeSummary || item.originalMessage, title: item.originalMessage, tags: item.tags })),
        ...taskMatches.map((item) => ({ kind: 'asana_task', source: item.source, projectGid: item.project?.gid, project: item.project?.name, taskGid: item.task?.gid, date: item.task?.createdAt, title: item.task?.name, description: item.briefDescription, tags: item.tags, completed: item.task?.completed })),
        ...activityMatches.map((item) => ({ kind: 'asana_activity', source: item.source, projectGid: item.projectGid, taskGid: item.taskGid, date: item.events[0]?.date ?? null, title: item.task?.name, description: item.briefDescription, events: item.events }))
      ].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))).slice(0, limit);
      return { results, totalCommitMatches: commitPage.totalMatches, totalAsanaTaskMatches: taskMatches.length, totalAsanaActivityMatches: activityMatches.length, returned: results.length };
    }
    if (call.function?.name === 'search_commit_knowledge') {
      const repository = repositories.includes(input.repository) ? input.repository : '';
      const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? value : '';
      const options = {
        query: String(input.query ?? '').slice(0, 300), repository,
        tags: Array.isArray(input.tags) ? input.tags.slice(0, 8).map((tag) => String(tag).slice(0, 80)) : [],
        from: date(input.from), to: date(input.to), offset: Math.max(0, Math.floor(Number(input.offset) || 0)),
        limit: Math.max(1, Math.min(Number(input.limit) || 20, 50))
      };
      return { ...await store.searchAnalysesPage(repositories, options), ...(input.repository && !repository ? { note: 'Requested repository is not selected.' } : {}) };
    }
    if (call.function?.name === 'list_commit_authors') {
      const repository = repositories.includes(input.repository) ? input.repository : '';
      if (input.repository && !repository) return { error: 'Requested repository is not selected.' };
      const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : '';
      return store.listCommitAuthors(repositories, { repository, from: date(input.from), to: date(input.to) });
    }
    if (call.function?.name === 'search_commits_by_author') {
      const repository = repositories.includes(input.repository) ? input.repository : '';
      if (input.repository && !repository) return { error: 'Requested repository is not selected.' };
      const author = String(input.author ?? '').trim().slice(0, 200);
      if (!author) return { error: 'An author name, email, or login is required.' };
      const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : '';
      return { results: await store.findCommitsByAuthor(repositories, { author, repository, from: date(input.from), to: date(input.to), limit: Math.max(1, Math.min(Number(input.limit) || 20, 50)) }) };
    }
    if (call.function?.name === 'get_commit_knowledge') {
      if (!repositories.includes(input.repository) || !validSha(input.sha)) return { error: 'Invalid or unauthorized commit reference.' };
      const analysis = await store.getAnalysis(input.repository, input.sha);
      return analysis ? { analysis } : { error: 'No analysis exists for that commit.' };
    }
    if (call.function?.name === 'delegate_commit_classification') {
      const task = String(input.task ?? '').trim().slice(0, 2_000);
      const requested = Array.isArray(input.commits) ? input.commits.slice(0, 24) : [];
      if (!task || !requested.length) return { error: 'A task and at least one commit reference are required.' };
      const references = [...new Map(requested.map((item) => [`${item?.repository}@${item?.sha}`, item])).values()];
      const invalidReferences = references.filter((item) => !repositories.includes(item?.repository) || !validSha(item?.sha)).map((item) => `${item?.repository}@${item?.sha}`);
      const validReferences = references.filter((item) => repositories.includes(item?.repository) && validSha(item?.sha));
      const loaded = await Promise.all(validReferences.map(async (item) => ({ item, analysis: await store.getAnalysis(item.repository, String(item.sha)) })));
      const missingLocal = loaded.filter(({ analysis }) => !analysis).map(({ item }) => `${item.repository}@${item.sha}`);
      const analyses = loaded.map(({ analysis }) => analysis).filter(Boolean);
      onActivity({ stage: 'agent_started', agent: 'commit_classifier', task, commits: analyses.length });
      const result = await commitClassifier.run({ model: getConfig().model, language: getConfig().language, task, commits: analyses, onActivity });
      const missing = [...invalidReferences, ...missingLocal, ...result.coverage.missing];
      const coverage = { ...result.coverage, requested: references.length, processed: result.coverage.processed, missing, complete: missing.length === 0 && result.coverage.processed === references.length };
      onActivity({ stage: 'agent_completed', agent: 'commit_classifier', coverage, relevant: result.relevant.length });
      return { ...result, coverage };
    }
    if (call.function?.name === 'search_diff_hunks') {
      const query = String(input.query ?? '').trim().slice(0, 300);
      const repository = repositories.includes(input.repository) ? input.repository : '';
      if (!query) return { error: 'A non-empty diff query is required.' };
      if (input.repository && !repository) return { error: 'Requested repository is not selected.' };
      if (input.sha && (!repository || !validSha(input.sha))) return { error: 'A valid repository and exact SHA are required when filtering by commit.' };
      if (input.path && !validPath(input.path)) return { error: 'Invalid repository-relative path.' };
      const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? value : '';
      return store.searchDiffHunks(repositories, {
        query, repository, sha: input.sha ? String(input.sha) : '', path: input.path ? String(input.path) : '',
        from: date(input.from), to: date(input.to), limit: Math.max(1, Math.min(Number(input.limit) || 6, 8))
      });
    }
    if (call.function?.name === 'read_diff_hunk') {
      if (!repositories.includes(input.repository) || !validSha(input.sha) || !validPath(input.path) || !/^h\d{1,6}$/.test(String(input.hunkId ?? ''))) return { error: 'Invalid or unauthorized diff reference.' };
      const hunk = await store.readDiffHunk(input.repository, String(input.sha), String(input.path), String(input.hunkId), {
        startLine: Math.max(1, Math.floor(Number(input.startLine) || 1)),
        maxLines: Math.max(1, Math.min(Math.floor(Number(input.maxLines) || 250), 250)),
        maxCharacters: 30_000
      });
      return hunk ?? { error: 'Diff hunk not found.' };
    }
    if (call.function?.name === 'read_file_at_commit') {
      if (!repositories.includes(input.repository) || !validSha(input.sha) || !validPath(input.path)) return { error: 'Invalid or unauthorized file reference.' };
      if (!await store.getCommitStatus(input.repository, String(input.sha))) return { error: 'The requested commit is not present in local synchronized knowledge.' };
      const startLine = Math.max(1, Math.floor(Number(input.startLine) || 1));
      const requestedEnd = Math.max(startLine, Math.floor(Number(input.endLine) || startLine + 99));
      const endLine = Math.min(requestedEnd, startLine + 199);
      const revision = input.revision === 'before' ? 'before' : 'after';
      let resolvedSha = String(input.sha);
      if (revision === 'before') {
        const raw = await store.getCommitRaw(input.repository, resolvedSha);
        resolvedSha = raw?.parents?.[0]?.sha ?? '';
        if (!validSha(resolvedSha)) return { error: 'The commit has no locally known parent revision.' };
      }
      const content = await github.getFileContent(input.repository, resolvedSha, String(input.path));
      if (content.includes('\0')) return { error: 'Binary files cannot be read as chat context.' };
      const lines = content.split(/\r?\n/);
      if (startLine > lines.length) return { error: 'The requested start line is beyond the end of the file.' };
      const targetEndLine = Math.min(endLine, lines.length);
      const segment = lines.slice(startLine - 1, targetEndLine).join('\n');
      const page = paginateText(segment, { startLine: 1, maxLines: endLine - startLine + 1, maxCharacters: 30_000 });
      const actualEndLine = startLine + page.endLine - 1;
      const hasMore = actualEndLine < lines.length;
      const nextStartLine = hasMore ? actualEndLine + 1 : null;
      return {
        source: `${input.repository}@${resolvedSha}:${input.path}:L${startLine}-L${actualEndLine}`,
        repository: input.repository, requestedCommit: input.sha, revision, sha: resolvedSha, path: input.path,
        content: page.content, startLine, endLine: actualEndLine, totalLines: lines.length,
        truncated: requestedEnd > endLine || page.truncated, hasMore, nextStartLine, lineTruncated: page.lineTruncated
      };
    }
    if (call.function?.name === 'search_asana_tasks') {
      const projectGid = input.projectGid && selectedAsanaProject(input.projectGid) ? String(input.projectGid) : '';
      if (input.projectGid && !projectGid) return { error: 'Requested Asana project is not selected.' };
      return { results: await asanaStore.searchAnalyses(getConfig().asanaProjects ?? [], { query: String(input.query ?? '').slice(0, 300), projectGid, createdSince: getConfig().asanaImportSince, completed: typeof input.completed === 'boolean' ? input.completed : undefined, limit: Math.max(1, Math.min(Number(input.limit) || 12, 30)) }) };
    }
    if (call.function?.name === 'search_asana_activity') {
      const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : '';
      const from = date(input.from); const to = date(input.to);
      const projectGid = input.projectGid && selectedAsanaProject(input.projectGid) ? String(input.projectGid) : '';
      if (!from || !to || from > to) return { error: 'A valid activity date range is required.' };
      if (input.projectGid && !projectGid) return { error: 'Requested Asana project is not selected.' };
      return { results: await asanaStore.searchStoryActivity(getConfig().asanaProjects ?? [], { from, to, projectGid, query: String(input.query ?? '').slice(0, 300), author: String(input.author ?? '').slice(0, 200), limit: Math.max(1, Math.min(Number(input.limit) || 20, 50)) }) };
    }
    if (call.function?.name === 'get_asana_task_knowledge') {
      const taskGid = String(input.taskGid ?? '');
      const requestedProjectGid = String(input.projectGid ?? '');
      const projectGid = selectedAsanaProject(requestedProjectGid) ? requestedProjectGid : await asanaStore.findProjectForTask(getConfig().asanaProjects ?? [], taskGid);
      if (!projectGid || !validAsanaGid(taskGid)) return { error: 'Invalid or unauthorized Asana task reference.' };
      const [analysis, task, stories, attachments] = await Promise.all([
        asanaStore.getTaskAnalysis(projectGid, taskGid), asanaStore.getTaskRaw(projectGid, taskGid),
        asanaStore.getTaskStories(projectGid, taskGid), asanaStore.getAttachments(projectGid, taskGid)
      ]);
      const safeAttachments = attachments.map((attachment) => ({ gid: attachment.gid, name: attachment.name, createdAt: attachment.created_at ?? null, contentType: attachment.contentType ?? null, size: attachment.size ?? null, downloaded: attachment.downloaded === true, downloadReason: attachment.downloadReason ?? null, chatUrl: attachment.downloaded && attachment.localPath && validAsanaGid(attachment.gid) ? `/api/asana/attachments/${projectGid}/${taskGid}/${attachment.gid}` : null }));
      return analysis ? { source: `asana:${projectGid}@${taskGid}`, analysis, raw: { task, stories, attachments: safeAttachments } } : { error: 'No local knowledge exists for that Asana task.' };
    }
    if (call.function?.name === 'show_asana_attachment') {
      const taskGid = String(input.taskGid ?? '');
      const requestedProjectGid = String(input.projectGid ?? '');
      const projectGid = selectedAsanaProject(requestedProjectGid) ? requestedProjectGid : await asanaStore.findProjectForTask(getConfig().asanaProjects ?? [], taskGid);
      const attachmentName = String(input.attachmentName ?? '').trim();
      if (!projectGid || !validAsanaGid(taskGid) || !attachmentName) return { error: 'A valid local Asana task reference and attachment name are required.' };
      const matches = (await asanaStore.getAttachments(projectGid, taskGid)).filter((attachment) => attachment.name === attachmentName);
      if (matches.length !== 1) return { error: matches.length ? 'More than one attachment has that name; request a unique attachment name.' : 'The requested attachment was not found on this task.' };
      const attachment = matches[0];
      if (!attachment.downloaded || !attachment.localPath) return { error: 'The requested attachment is not available locally.' };
      const contentType = String(attachment.contentType ?? '').split(';')[0].toLocaleLowerCase();
      return { attachment: { name: attachment.name, contentType, chatUrl: `/api/asana/attachments/${projectGid}/${taskGid}/${attachment.gid}`, inline: inlineImageTypes.has(contentType) } };
    }
    return { error: 'Unknown tool.' };
  }
  
  async function safeKnowledgeTool(call, repositories, onActivity) {
    try { return await runKnowledgeTool(call, repositories, onActivity); }
    catch (error) { return { error: `Tool execution failed: ${error.message}` }; }
  }
  
  async function classifyCommitSet(task, candidates, onActivity = () => {}) {
    const maximum = 200;
    const selected = candidates.slice(0, maximum);
    const relevant = [];
    const excluded = [];
    const missing = candidates.slice(maximum).map((item) => item.source);
    let processed = 0;
    let attempts = 0;
    onActivity({ stage: 'agent_started', agent: 'commit_classifier', task, commits: selected.length, totalCandidates: candidates.length });
    for (let offset = 0; offset < selected.length; offset += 24) {
      const references = selected.slice(offset, offset + 24);
      const analyses = (await Promise.all(references.map((item) => store.getAnalysis(item.repository, item.sha)))).filter(Boolean);
      const result = await commitClassifier.run({ model: getConfig().model, language: getConfig().language, task, commits: analyses, onActivity });
      relevant.push(...result.relevant);
      excluded.push(...result.excluded);
      missing.push(...result.coverage.missing);
      processed += result.coverage.processed;
      attempts += result.coverage.attempts;
    }
    const coverage = { requested: candidates.length, processed, missing, complete: missing.length === 0 && processed === candidates.length, attempts };
    onActivity({ stage: 'agent_completed', agent: 'commit_classifier', coverage, relevant: relevant.length, excluded: excluded.length });
    return { task: String(task).slice(0, 2_000), coverage, relevant, excluded };
  }
  
  const { debugValue, summarizeToolResult, detailedToolActivityMessage } = createToolPresentation(toolArguments);

  return {
    definitions: CHAT_TOOLS,
    toolArguments,
    xmlToolCalls,
    safeKnowledgeTool,
    classifyCommitSet,
    debugValue,
    summarizeToolResult,
    detailedToolActivityMessage
  };
}
