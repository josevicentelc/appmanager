import { basename, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { openEngineeringMemoryDb } from "../db/database.js";
import { ingestCommit, ingestOptionsFromRepository } from "../application/ingest-service.js";
import { getEnabledRepository, loadRepositoryConfigs } from "../repositories/repository-config.js";
import { readFlag } from "./args.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repositoryPath = readFlag(args, "repo");
  const configuredRepositoryId = readFlag(args, "repository");
  const commitish = readFlag(args, "commit") ?? "HEAD";
  const configPath = readFlag(args, "config") ?? "config/application.yaml";
  const repositoryKey = readFlag(args, "repository-key");

  if (!repositoryPath && !configuredRepositoryId) {
    throw new Error("Usage: npm run ingest:commit -- (--repo <path> | --repository <id>) [--commit HEAD]");
  }

  const config = await loadConfig(configPath);
  const ingestOptions = configuredRepositoryId === null
    ? {
      repositoryPath: repositoryPath as string,
      commitish,
      repositoryKey: repositoryKey ?? basename(resolve(repositoryPath as string)),
      repositoryDisplayName: repositoryKey ?? basename(resolve(repositoryPath as string))
    }
    : ingestOptionsFromRepository(
      getEnabledRepository(await loadRepositoryConfigs(), configuredRepositoryId),
      commitish
    );
  const db = await openEngineeringMemoryDb(config.database.path);
  try {
    const result = await ingestCommit(db, config, ingestOptions);

    console.log(JSON.stringify({
      database: config.database.path,
      ...result
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
