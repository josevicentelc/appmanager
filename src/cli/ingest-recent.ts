import { loadConfig } from "../config.js";
import { openEngineeringMemoryDb } from "../db/database.js";
import { isCommitProcessed } from "../db/knowledge-queries.js";
import { syncCommitVersionTags } from "../db/commit-store.js";
import { listRecentCommits, resolveCommit } from "../git/git-client.js";
import { ingestCommit, ingestOptionsFromRepository, readRepositoryVersionTags } from "../application/ingest-service.js";
import { getEnabledRepository, loadRepositoryConfigs } from "../repositories/repository-config.js";
import { hasFlag, readFlag } from "./args.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requestedRepositoryId = readFlag(args, "repository") ?? readFlag(args, "repo");
  const countFlag = readFlag(args, "count");
  const configPath = readFlag(args, "config") ?? "config/application.yaml";
  const repositoriesPath = readFlag(args, "repositories") ?? "config/repositories.yaml";
  const dryRun = hasFlag(args, "dry-run");
  const reanalyze = hasFlag(args, "reanalyze");

  const config = await loadConfig(configPath);
  const repositories = await loadRepositoryConfigs(repositoriesPath);
  const repositoryId = requestedRepositoryId ?? repositories.find((candidate) => candidate.enabled)?.id;
  if (repositoryId === undefined) {
    throw new Error("No enabled repository or monorepo project is configured");
  }
  const repository = getEnabledRepository(repositories, repositoryId);
  const count = countFlag === null
    ? repository.polling.initialHistory.count ?? 50
    : Number(countFlag);

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("--count must be a positive integer");
  }

  const branchHead = await resolveCommit(repository.checkout.localPath, repository.checkout.branch);
  const commits = await listRecentCommits(
    repository.checkout.localPath,
    repository.checkout.branch,
    count,
    repository.projectRoot === null ? [] : [repository.projectRoot]
  );
  const db = await openEngineeringMemoryDb(config.database.path);
  const results: Array<Record<string, unknown>> = [];

  try {
    for (const commitHash of commits) {
      const alreadyProcessed = await isCommitProcessed(db, repository.id, commitHash, config.ai.chatModel);
      if (alreadyProcessed && !reanalyze) {
        const versionTags = await readRepositoryVersionTags(repository, commitHash);
        if (!dryRun) {
          await syncCommitVersionTags(db, repository.id, commitHash, versionTags);
        }
        results.push({ commitHash, status: "skipped_already_processed", versionTags });
        continue;
      }

      if (dryRun) {
        results.push({ commitHash, status: alreadyProcessed ? "would_reanalyze" : "would_ingest" });
        continue;
      }

      try {
        const result = await ingestCommit(db, config, ingestOptionsFromRepository(repository, commitHash));
        results.push(result.status === "ignored"
          ? {
            commitHash,
            status: "ignored",
            subject: result.subject,
            reason: result.reason,
            ignoredFiles: result.ignoredFiles
          }
          : {
            commitHash,
            status: "indexed",
            subject: result.subject,
            summary: result.summary,
            ignoredFiles: result.ignoredFiles,
            factCount: result.stored.factCount
          });
      } catch (error) {
        results.push({
          commitHash,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    console.log(JSON.stringify({
      repository: repository.id,
      branch: repository.checkout.branch,
      branchHead,
      count,
      dryRun,
      reanalyze,
      results
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
