import { loadConfig } from "../config.js";
import { loadRepositoryConfigs } from "../repositories/repository-config.js";
import { CommitDigestDaemon } from "./commit-digest-daemon.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const repositories = await loadRepositoryConfigs();
  const daemon = new CommitDigestDaemon(config, repositories);
  await daemon.start();

  const shutdown = async (): Promise<void> => {
    await daemon.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
