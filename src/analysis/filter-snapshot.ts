import type { CommitFileChange, CommitSnapshot } from "../git/git-client.js";

export interface SnapshotFilter {
  include: string[];
  exclude: string[];
}

export interface FilteredSnapshot {
  snapshot: CommitSnapshot;
  ignoredFiles: CommitFileChange[];
}

export function filterCommitSnapshot(
  snapshot: CommitSnapshot,
  filter: SnapshotFilter,
  maxDiffChars = Number.POSITIVE_INFINITY
): FilteredSnapshot {
  const includedFiles = snapshot.files.filter((file) => shouldIncludePath(file.path, filter));
  const ignoredFiles = snapshot.files.filter((file) => !includedFiles.includes(file));
  const includedPaths = new Set(includedFiles.map((file) => file.path));
  const filteredDiff = filterDiffByPath(snapshot.diff, includedPaths);
  const diffWasTruncated = filteredDiff.length > maxDiffChars;

  return {
    ignoredFiles,
    snapshot: {
      ...snapshot,
      files: includedFiles,
      diff: diffWasTruncated ? filteredDiff.slice(0, maxDiffChars) : filteredDiff,
      diffWasTruncated
    }
  };
}

export function shouldIncludePath(path: string, filter: SnapshotFilter): boolean {
  const normalized = normalizePath(path);
  const include = filter.include.length === 0 ? ["**/*"] : filter.include;
  return include.some((pattern) => globMatches(pattern, normalized)) &&
    !filter.exclude.some((pattern) => globMatches(pattern, normalized));
}

function filterDiffByPath(diff: string, includedPaths: Set<string>): string {
  if (includedPaths.size === 0 || diff.trim() === "") {
    return "";
  }

  const sections = diff.split(/(?=^diff --git )/m);
  return sections
    .filter((section) => {
      const path = extractPathFromDiffHeader(section);
      return path !== null && includedPaths.has(path);
    })
    .join("")
    .trim();
}

function extractPathFromDiffHeader(section: string): string | null {
  const firstLine = section.split(/\r?\n/, 1)[0] ?? "";
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(firstLine);
  return match?.[2] ?? null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function globMatches(pattern: string, path: string): boolean {
  return globToRegExp(normalizePath(pattern)).test(path);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length;) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      const after = pattern[index + 2];
      if (after === "/") {
        source += "(?:.*/)?";
        index += 3;
      } else {
        source += ".*";
        index += 2;
      }
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }

    source += escapeRegExp(char ?? "");
    index += 1;
  }
  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}
