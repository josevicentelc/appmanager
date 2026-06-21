import { execa } from "execa";
import { resolve } from "node:path";

export interface CommitMetadata {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  committerName: string;
  committerEmail: string;
  committedAt: string;
  subject: string;
  body: string;
}

export interface CommitFileChange {
  path: string;
  previousPath: string | null;
  changeType: string;
  additions: number | null;
  deletions: number | null;
}

export interface CommitSnapshot {
  repositoryPath: string;
  metadata: CommitMetadata;
  files: CommitFileChange[];
  diff: string;
  diffWasTruncated: boolean;
}

const fieldSeparator = "\u001f";
const recordSeparator = "\u001e";

export async function assertGitRepository(repositoryPath: string): Promise<void> {
  const result = await git(repositoryPath, ["rev-parse", "--is-inside-work-tree"]);
  if (result.stdout.trim() !== "true") {
    throw new Error(`${repositoryPath} is not a Git work tree`);
  }
}

export async function resolveCommit(repositoryPath: string, commitish: string): Promise<string> {
  const result = await git(repositoryPath, ["rev-parse", `${commitish}^{commit}`]);
  return result.stdout.trim();
}

export async function listRecentCommits(
  repositoryPath: string,
  branch: string,
  count: number
): Promise<string[]> {
  return (await listCommitsNewestFirst(repositoryPath, branch, { count })).reverse();
}

export async function listCommitsNewestFirst(
  repositoryPath: string,
  branch: string,
  options: { count?: number; since?: string }
): Promise<string[]> {
  await assertGitRepository(repositoryPath);
  const args = ["log", "--format=%H"];
  if (options.count !== undefined) {
    args.push(`-${options.count}`);
  }
  if (options.since !== undefined) {
    args.push(`--since=${options.since}`);
  }
  args.push(branch);
  const result = await git(repositoryPath, args);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function readCommitSnapshot(
  repositoryPath: string,
  commitish: string,
  maxDiffChars: number
): Promise<CommitSnapshot> {
  await assertGitRepository(repositoryPath);
  const hash = await resolveCommit(repositoryPath, commitish);
  const metadata = await readCommitMetadata(repositoryPath, hash);
  const files = await readCommitFiles(repositoryPath, hash);
  const fullDiff = await readCommitDiff(repositoryPath, hash);
  const diffWasTruncated = fullDiff.length > maxDiffChars;
  const diff = diffWasTruncated ? fullDiff.slice(0, maxDiffChars) : fullDiff;

  return {
    repositoryPath,
    metadata,
    files,
    diff,
    diffWasTruncated
  };
}

async function readCommitMetadata(repositoryPath: string, hash: string): Promise<CommitMetadata> {
  const format = [
    "%H",
    "%P",
    "%an",
    "%ae",
    "%aI",
    "%cn",
    "%ce",
    "%cI",
    "%s",
    "%b"
  ].join(fieldSeparator);

  const result = await git(repositoryPath, ["show", "--no-patch", `--format=${format}`, hash]);
  const [fullHash, parentsRaw, authorName, authorEmail, authoredAt, committerName, committerEmail, committedAt, subject, ...bodyParts] =
    result.stdout.split(fieldSeparator);

  if (!fullHash || !authorName || !authorEmail || !authoredAt || !committerName || !committerEmail || !committedAt || !subject) {
    throw new Error(`Could not parse metadata for commit ${hash}`);
  }

  return {
    hash: fullHash,
    parents: parentsRaw === "" || parentsRaw === undefined ? [] : parentsRaw.split(" "),
    authorName,
    authorEmail,
    authoredAt,
    committerName,
    committerEmail,
    committedAt,
    subject,
    body: bodyParts.join(fieldSeparator).trim()
  };
}

async function readCommitFiles(repositoryPath: string, hash: string): Promise<CommitFileChange[]> {
  const nameStatus = await git(repositoryPath, ["show", "--format=", "--name-status", "--find-renames", "--find-copies", "-z", hash]);
  const numstat = await git(repositoryPath, ["show", "--format=", "--numstat", "-z", hash]);
  const statsByPath = parseNumstat(numstat.stdout);
  const tokens = nameStatus.stdout.split("\0").filter((token) => token.length > 0);
  const files: CommitFileChange[] = [];

  for (let index = 0; index < tokens.length;) {
    const status = tokens[index];
    if (status === undefined) {
      break;
    }

    const changeType = status[0] ?? "";
    if (changeType === "R" || changeType === "C") {
      const previousPath = tokens[index + 1];
      const path = tokens[index + 2];
      if (previousPath === undefined || path === undefined) {
        throw new Error(`Could not parse renamed/copied file entry for commit ${hash}`);
      }
      const stats = statsByPath.get(path);
      files.push({
        path,
        previousPath,
        changeType,
        additions: stats?.additions ?? null,
        deletions: stats?.deletions ?? null
      });
      index += 3;
      continue;
    }

    const path = tokens[index + 1];
    if (path === undefined) {
      throw new Error(`Could not parse file entry for commit ${hash}`);
    }
    const stats = statsByPath.get(path);
    files.push({
      path,
      previousPath: null,
      changeType,
      additions: stats?.additions ?? null,
      deletions: stats?.deletions ?? null
    });
    index += 2;
  }

  return files;
}

function parseNumstat(stdout: string): Map<string, { additions: number | null; deletions: number | null }> {
  const result = new Map<string, { additions: number | null; deletions: number | null }>();
  const tokens = stdout.split("\0").filter((token) => token.length > 0);

  for (const token of tokens) {
    const [additionsRaw, deletionsRaw, path] = token.split("\t");
    if (additionsRaw === undefined || deletionsRaw === undefined || path === undefined) {
      continue;
    }
    result.set(path, {
      additions: additionsRaw === "-" ? null : Number(additionsRaw),
      deletions: deletionsRaw === "-" ? null : Number(deletionsRaw)
    });
  }

  return result;
}

async function readCommitDiff(repositoryPath: string, hash: string): Promise<string> {
  const result = await git(repositoryPath, [
    "show",
    "--format=",
    "--find-renames",
    "--find-copies",
    "--unified=80",
    "--no-ext-diff",
    "--no-textconv",
    hash
  ]);
  return result.stdout;
}

async function git(repositoryPath: string, args: string[]): Promise<{ stdout: string }> {
  const absoluteRepositoryPath = resolve(repositoryPath);
  const result = await execa("git", ["-c", `safe.directory=${absoluteRepositoryPath}`, "-C", absoluteRepositoryPath, ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0"
    },
    reject: true
  });
  return { stdout: result.stdout };
}

export function makeSourceKey(commitHash: string, filePath: string): string {
  return `commit:${commitHash}:file:${filePath}`;
}

export { fieldSeparator, recordSeparator };
