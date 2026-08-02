const inRange = (value, from, to) => {
  const date = String(value ?? '');
  return Boolean(date) && (!from || date >= `${from}T00:00:00.000Z`) && (!to || date <= `${to}T23:59:59.999Z`);
};
const isComment = (story) => story?.resource_subtype === 'comment_added' || story?.type === 'comment';
const isStatusChange = (story) => /(?:section|status)_/i.test(String(story?.resource_subtype ?? '')) || (story?.type === 'system' && Boolean(story?.section || story?.new_value || story?.old_value));
const taskKey = (projectGid, taskGid) => `${projectGid}@${taskGid}`;
const commitAuthor = (raw) => ({ name: raw?.commit?.author?.name ?? raw?.author?.login ?? null, login: raw?.author?.login ?? null, email: raw?.commit?.author?.email ?? null });

export class ExecutiveReportService {
  constructor({ store, asanaStore, pullRequestStore }) { this.store = store; this.asanaStore = asanaStore; this.pullRequestStore = pullRequestStore; }

  async collect({ repositories, projectGids, from, to }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('El rango del informe no es válido.');
    const [commitReferences, pullRequests] = await Promise.all([
      this.store.rankAnalyses(repositories, { query: '', from, to }),
      this.pullRequestStore.list()
    ]);
    const tasks = new Map();
    for (const projectGid of projectGids) for (const taskGid of await this.asanaStore.listTaskGids(projectGid)) {
      const [task, stories, analysis] = await Promise.all([this.asanaStore.getTaskRaw(projectGid, taskGid), this.asanaStore.getTaskStories(projectGid, taskGid), this.asanaStore.getTaskAnalysis(projectGid, taskGid)]);
      const activity = stories.filter((story) => inRange(story.created_at, from, to) && (isComment(story) || isStatusChange(story))).map((story) => ({
        type: isComment(story) ? 'comment' : 'status_change', date: story.created_at, author: story.created_by?.name ?? null,
        text: story.text ?? null, from: story.old_value ?? null, to: story.new_value ?? story.section?.name ?? null
      }));
      if (task && activity.length) tasks.set(taskKey(projectGid, taskGid), { projectGid, taskGid, task, analysis, activity });
    }

    const pullRequestsByCommit = new Map();
    for (const pullRequest of pullRequests) for (const sha of new Set([...(pullRequest.commits ?? []).map((commit) => commit.sha), pullRequest.pullRequest?.mergeCommitSha].filter(Boolean))) {
      const key = `${pullRequest.repository}@${sha}`;
      const current = pullRequestsByCommit.get(key) ?? [];
      current.push(pullRequest); pullRequestsByCommit.set(key, current);
    }

    const entries = []; const matchedTaskKeys = new Set();
    for (const reference of commitReferences) {
      const raw = await this.store.getCommitRaw(reference.repository, reference.sha);
      const commit = { ...reference, author: commitAuthor(raw) };
      const relatedTasks = (pullRequestsByCommit.get(`${reference.repository}@${reference.sha}`) ?? []).flatMap((pullRequest) => (pullRequest.asanaTasks ?? []).map((relation) => ({ pullRequest, task: tasks.get(taskKey(relation.projectGid, relation.taskGid)) }))).filter(({ task }) => task);
      if (!relatedTasks.length) entries.push({ type: 'commit', date: reference.commitDate, commit, pullRequests: pullRequestsByCommit.get(`${reference.repository}@${reference.sha}`) ?? [] });
      for (const related of relatedTasks) {
        matchedTaskKeys.add(taskKey(related.task.projectGid, related.task.taskGid));
        entries.push({ type: 'asana_commit', date: reference.commitDate, task: related.task, commit, pullRequest: related.pullRequest });
      }
    }
    for (const [key, task] of tasks) if (!matchedTaskKeys.has(key)) entries.push({ type: 'asana', date: task.activity.at(-1)?.date ?? task.task.modified_at, task });
    entries.sort((left, right) => String(left.date ?? '').localeCompare(String(right.date ?? '')) || left.type.localeCompare(right.type));
    return {
      period: { from, to }, entries,
      coverage: { commits: commitReferences.length, activeAsanaTasks: tasks.size, cachedPullRequests: pullRequests.length, pairedCommits: entries.filter((entry) => entry.type === 'asana_commit').length }
    };
  }
}
