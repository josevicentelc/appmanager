const textLines = (text) => {
  const records = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline + 1;
    records.push({ start, end, value: text.slice(start, newline < 0 ? end : newline).replace(/\r$/, '') });
    start = end;
  }
  return records;
};

const patchPath = (value) => {
  const clean = String(value ?? '').split('\t', 1)[0].trim();
  if (!clean || clean === '/dev/null') return null;
  const unquoted = clean.startsWith('"') && clean.endsWith('"') ? clean.slice(1, -1).replace(/\\"/g, '"') : clean;
  return unquoted.replace(/^[ab]\//, '');
};

const range = (start, count) => ({ start: Number(start), lines: count === undefined ? 1 : Number(count) });

export function buildDiffIndex(diff) {
  const text = String(diff ?? '');
  const files = [];
  let file = null;
  let hunk = null;

  const finishHunk = (end) => {
    if (!hunk) return;
    hunk.end = end;
    file.hunks.push(hunk);
    hunk = null;
  };
  const finishFile = (end) => {
    if (!file) return;
    finishHunk(end);
    file.end = end;
    files.push(file);
    file = null;
  };

  for (const line of textLines(text)) {
    if (line.value.startsWith('diff --git ')) {
      finishFile(line.start);
      file = { oldPath: null, newPath: null, binary: false, start: line.start, end: text.length, hunks: [] };
      continue;
    }
    if (!file && line.value.startsWith('--- ')) file = { oldPath: null, newPath: null, binary: false, start: line.start, end: text.length, hunks: [] };
    if (!file) continue;
    if (line.value.startsWith('--- ')) file.oldPath = patchPath(line.value.slice(4));
    else if (line.value.startsWith('+++ ')) file.newPath = patchPath(line.value.slice(4));
    else if (line.value.startsWith('Binary files ') || line.value === 'GIT binary patch') file.binary = true;
    else if (line.value.startsWith('@@ ')) {
      finishHunk(line.start);
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line.value);
      hunk = {
        id: `h${file.hunks.length + 1}`,
        header: line.value,
        oldRange: match ? range(match[1], match[2]) : null,
        newRange: match ? range(match[3], match[4]) : null,
        section: match?.[5]?.trim() ?? '',
        start: line.start,
        end: text.length
      };
    }
  }
  finishFile(text.length);
  return { version: 2, length: text.length, files };
}

const words = (value) => String(value ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}_.$:/-]{2,}/gu) ?? [];

function matchingSnippet(text, query, maxLines = 36) {
  const lines = String(text).split(/\r?\n/);
  const terms = words(query);
  const phrase = String(query ?? '').toLocaleLowerCase();
  let match = lines.findIndex((line) => line.toLocaleLowerCase().includes(phrase));
  if (match < 0) match = lines.findIndex((line) => terms.some((term) => line.toLocaleLowerCase().includes(term)));
  if (match < 0) match = 0;
  const before = Math.floor(maxLines / 3);
  const start = Math.max(0, match - before);
  const end = Math.min(lines.length, start + maxLines);
  return { text: lines.slice(start, end).join('\n'), omittedBefore: start, omittedAfter: Math.max(0, lines.length - end) };
}

export function searchIndexedDiff(diff, index, { query, path = '', limit = 8 } = {}) {
  const phrase = String(query ?? '').toLocaleLowerCase();
  const terms = [...new Set(words(query))];
  const pathQuery = String(path ?? '').toLocaleLowerCase();
  const results = [];
  for (const file of index.files ?? []) {
    const filePath = file.newPath ?? file.oldPath ?? '';
    if (pathQuery && !filePath.toLocaleLowerCase().includes(pathQuery)) continue;
    for (const hunk of file.hunks ?? []) {
      const hunkText = diff.slice(hunk.start, hunk.end);
      const haystack = `${filePath}\n${hunkText}`.toLocaleLowerCase();
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      if (terms.length && !matchedTerms.length && !(phrase && haystack.includes(phrase))) continue;
      const score = matchedTerms.length + (phrase && haystack.includes(phrase) ? 4 : 0) + (pathQuery && filePath.toLocaleLowerCase().includes(pathQuery) ? 2 : 0);
      results.push({ filePath, hunk, score, snippet: matchingSnippet(hunkText, query) });
    }
  }
  return results.sort((a, b) => b.score - a.score || a.hunk.start - b.hunk.start).slice(0, limit);
}

export function paginateText(text, { startLine = 1, maxLines = 250, maxCharacters = 30_000 } = {}) {
  const lines = String(text).split(/\r?\n/);
  const requestedStart = Math.max(1, Math.floor(Number(startLine) || 1));
  if (requestedStart > lines.length) return null;
  const selected = [];
  let characters = 0;
  let lineTruncated = false;
  for (const line of lines.slice(requestedStart - 1, requestedStart - 1 + Math.max(1, maxLines))) {
    const separator = selected.length ? 1 : 0;
    if (characters + separator + line.length > maxCharacters) {
      if (!selected.length) {
        selected.push(line.slice(0, maxCharacters));
        lineTruncated = line.length > maxCharacters;
      }
      break;
    }
    selected.push(line);
    characters += separator + line.length;
  }
  const endLine = requestedStart + selected.length - 1;
  const hasMore = endLine < lines.length;
  return {
    content: selected.join('\n'), startLine: requestedStart, endLine, totalLines: lines.length,
    truncated: hasMore || lineTruncated,
    nextStartLine: hasMore && !lineTruncated ? endLine + 1 : null,
    lineTruncated
  };
}

export function readIndexedHunk(diff, index, filePath, hunkId, options = {}) {
  const file = (index.files ?? []).find((item) => (item.newPath ?? item.oldPath) === filePath);
  const hunk = file?.hunks?.find((item) => item.id === hunkId);
  if (!file || !hunk) return null;
  const page = paginateText(diff.slice(hunk.start, hunk.end), options);
  return page ? { file, hunk, ...page } : null;
}
