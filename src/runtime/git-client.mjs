import { spawn } from "node:child_process";
import { resolve } from "node:path";

export async function readCommitSnapshot(repositoryPath, commitish, maxDiffChars) {
  await assertGitRepository(repositoryPath);
  const hash = await resolveCommit(repositoryPath, commitish);
  const metadata = await readCommitMetadata(repositoryPath, hash);
  const files = await readCommitFiles(repositoryPath, hash);
  const fullDiff = await readCommitDiff(repositoryPath, hash);

  return {
    repositoryPath,
    metadata,
    files,
    diff: fullDiff.length > maxDiffChars ? fullDiff.slice(0, maxDiffChars) : fullDiff,
    diffWasTruncated: fullDiff.length > maxDiffChars
  };
}

async function assertGitRepository(repositoryPath) {
  const stdout = await git(repositoryPath, ["rev-parse", "--is-inside-work-tree"]);
  if (stdout.trim() !== "true") {
    throw new Error(`${repositoryPath} is not a Git work tree`);
  }
}

async function resolveCommit(repositoryPath, commitish) {
  return (await git(repositoryPath, ["rev-parse", `${commitish}^{commit}`])).trim();
}

async function readCommitMetadata(repositoryPath, hash) {
  const separator = "\u001f";
  const format = ["%H", "%P", "%an", "%ae", "%aI", "%cn", "%ce", "%cI", "%s", "%b"].join(separator);
  const stdout = await git(repositoryPath, ["show", "--no-patch", `--format=${format}`, hash]);
  const [fullHash, parentsRaw, authorName, authorEmail, authoredAt, committerName, committerEmail, committedAt, subject, ...bodyParts] =
    stdout.split(separator);

  if (!fullHash || !authorName || !authorEmail || !authoredAt || !committerName || !committerEmail || !committedAt || !subject) {
    throw new Error(`Could not parse metadata for commit ${hash}`);
  }

  return {
    hash: fullHash,
    parents: parentsRaw ? parentsRaw.split(" ") : [],
    authorName,
    authorEmail,
    authoredAt,
    committerName,
    committerEmail,
    committedAt,
    subject,
    body: bodyParts.join(separator).trim()
  };
}

async function readCommitFiles(repositoryPath, hash) {
  const nameStatus = await git(repositoryPath, ["show", "--format=", "--name-status", "--find-renames", "--find-copies", "-z", hash]);
  const numstat = await git(repositoryPath, ["show", "--format=", "--numstat", "-z", hash]);
  const statsByPath = parseNumstat(numstat);
  const tokens = nameStatus.split("\0").filter(Boolean);
  const files = [];

  for (let index = 0; index < tokens.length;) {
    const status = tokens[index];
    const changeType = status[0] ?? "";

    if (changeType === "R" || changeType === "C") {
      const previousPath = tokens[index + 1];
      const path = tokens[index + 2];
      if (!previousPath || !path) {
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
    if (!path) {
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

function parseNumstat(stdout) {
  const result = new Map();
  for (const token of stdout.split("\0").filter(Boolean)) {
    const [additionsRaw, deletionsRaw, path] = token.split("\t");
    if (!additionsRaw || !deletionsRaw || !path) {
      continue;
    }
    result.set(path, {
      additions: additionsRaw === "-" ? null : Number(additionsRaw),
      deletions: deletionsRaw === "-" ? null : Number(deletionsRaw)
    });
  }
  return result;
}

async function readCommitDiff(repositoryPath, hash) {
  return git(repositoryPath, [
    "show",
    "--format=",
    "--find-renames",
    "--find-copies",
    "--unified=80",
    "--no-ext-diff",
    "--no-textconv",
    hash
  ]);
}

function git(repositoryPath, args) {
  return new Promise((resolve, reject) => {
    const absoluteRepositoryPath = resolvePath(repositoryPath);
    const child = spawn("git", ["-c", `safe.directory=${absoluteRepositoryPath}`, "-C", absoluteRepositoryPath, ...args], {
      shell: false,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0"
      }
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`git ${args.join(" ")} failed with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

function resolvePath(path) {
  return resolve(path);
}
